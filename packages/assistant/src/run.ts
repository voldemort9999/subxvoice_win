import type { Api, Model } from "@earendil-works/pi-ai";
import type { Assistant, AssistantEvent, AssistantRun, UserInputWatch, UserReply } from "@subx/core";
import { createUserChannel } from "./ask";
import { CHECKLIST_INSTRUCTIONS, createChecklist } from "./checklist";
import { createFinisher } from "./finish";
import { decide, strings } from "./guard";
import { cleanHistory, hygienicStream } from "./hygiene";
import { createInterrupts } from "./interrupt";
import { languageOf, romanWords, say, setLanguage } from "./lang";
import { Agent, type StreamFn } from "./pi";
import { type Fallback, resilientStream } from "./retry";
import { type AssistantTool, toAgentTool } from "./tool";

export interface AssistantConfig {
  model: Model<Api>;
  stream: StreamFn;
  systemPrompt: string;
  tools: AssistantTool[];
  /** The backend session token for proxied providers; Bedrock reads its own credentials. */
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  /** How long a question or approval waits before the work is parked (spec: 5 minutes). */
  waitForUserMs?: number;
  /** Model turns per command before the run is stopped (the bench's longest task took 31). */
  maxTurns?: number;
  /** Model spend per command, in USD, before the run is stopped. */
  maxCostUsd?: number;
  /** One line of what is true now (focused window, volume…), appended after each action. */
  observeState?: () => Promise<string>;
  /** The user's own mouse and keyboard (design §5); without it nothing is held. */
  watch?: UserInputWatch;
  /**
   * Lets go of whatever the screen tools still hold (ScreenInput.releaseAll). Called once at the
   * end of every run — done, error, cap, park or stop — so a left_mouse_down whose run died never
   * turns the user's next mouse move into a drag (T9–T13 review, C1).
   */
  releaseInput?: () => Promise<void>;
  /** Where the same run continues after the main model keeps failing (src/retry.ts). */
  fallback?: Fallback;
  /** Backoff step between retries of a failed model call; tests shorten it. */
  retryDelayMs?: number;
  /** The multi-part checklist (src/checklist.ts); off until the mid-model A/B says otherwise. */
  checklist?: boolean;
  /** How long a hold waits for the user's words before the work carries on (a tap, a cancelled press). */
  holdMs?: number;
  /**
   * One line per tool call and per result, input and errors included, for the app's log: with
   * only tool names logged, a hand test could not say why a close or a question failed (S-024).
   */
  trace?: (line: string) => void;
  /**
   * The user writes in Roman letters (their script setting): no tool call may carry Devanagari.
   * The prompt's note alone did not hold — Celeris copied Soniox's Devanagari transcript into what
   * it typed ("Hi" → हाय, "Priya" → पriya; demo hand test, 2026-11-19) — so code refuses the call
   * and the model writes it again in Roman, the way Pi's schema check makes it retry.
   */
  romanOnly?: boolean;
}

const DEVANAGARI = /[ऀ-ॿ]/;
const ROMAN_ONLY =
  "Not done: this user writes in Roman (Latin) letters, and these arguments contain Devanagari. Write every Hindi word in Roman letters as they would type it (हाय → Hi, प्रिया → Priya, मैं कल नहीं आऊंगा → main kal nahi aaunga) — transliterate, never translate — and call it again.";

/** A tool result's text, for the trace: images are left out, long text cut. */
function resultText(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] } | undefined)?.content ?? [];
  return content
    .flatMap((c) => (c.type === "text" && c.text ? [c.text] : c.type === "image" ? ["[image]"] : []))
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

const DICTATED =
  "Not done: the user dictated something just now, so the screen may have changed. Take a screenshot (or read the tree) again, then do this step.";

// Kimi read a bare "do not try another way" as "stop the whole task" and left the other two drafts
// untyped (T8 bench) — so each says exactly what it covers.
const REFUSED =
  "Not done: the user said no to this one action. Do not do it any other way, leave what is already done as it is, and carry on with the rest of the request.";
const ALREADY_REFUSED =
  "Not done: the user already said no to this action. Do not ask or try it again; carry on with the rest of the request.";
const MOVED_ON =
  "Not done yet: instead of answering, the user gave a new instruction, which follows. Do that first. Then, if this action is still part of what they asked, call it once more — they will be asked again.";
const UNANSWERED =
  "Not done: no answer from the user in time. Do not try it again in this run. Finish the rest, and end by saying plainly that this one is ready but not done, so they can ask for it.";

export const MAX_TURNS = 40;
export const MAX_COST_USD = 0.25;
/** A press with no words after it (a tap, a cancelled press) holds the work this long at most. */
export const HOLD_MS = 12_000;

let runCount = 0;

/** Said on the command key mid-run: stop, but ask first (design §1a). Checked before anything else. */
const STOP_PATTERN =
  /\b(ruk jao|ruk ja|ruko|rukiye|band karo|band kar do|bas karo|kuch mat karo|stop|cancel karo)\b/i;
/** Devanagari is read through `romanWords` first (lang.ts). */
const STOP_WORDS = { test: (text: string) => STOP_PATTERN.test(romanWords(text)) };

/**
 * "band mat karo", "rukna mat", "mat ruko": the no must sit next to the stop word. A loose "na" or
 * "nahi" anywhere is not enough — "band kar do na" means please stop.
 */
const NEGATED =
  /\b(band|ruk\w*|stop|bas)\s+(mat|nahi|nahin)\b|\b(mat|nahi|nahin)\s+(band|ruk\w*)\b|\bdon'?t\s+stop\b/i;

/** The answer to the stop question: stop, carry on, or something else to do instead. */
export function stopChoice(answer: unknown): "stop" | "continue" | "redirect" {
  if (answer === undefined) return "stop";
  const text = romanWords(String(answer));
  const stopWord = STOP_WORDS.test(text) || /\b(band|stop|bas|cancel|khatam|chhodo|rukna)\b/i.test(text);
  // A second "ruk jao" while this question is open is the same stop, not a new instruction.
  if (stopWord) return NEGATED.test(text) ? "continue" : "stop";
  if (/\b(continue|chalu|karte raho|aage|jaari|haan|ha|ok)\b/i.test(text)) return "continue";
  return "redirect";
}

/** "Send it {"to":"Aryan"}" — what the approval shows, kept to one line. */
function describeCall(what: string, args: unknown): string {
  const detail = JSON.stringify(args ?? {});
  return detail === "{}" ? what : `${what} ${detail.length > 120 ? `${detail.slice(0, 117)}...` : detail}`;
}

/**
 * One spoken command → one run of the vendored Pi loop. This file turns Pi's events into the
 * capsule's events and wires the guard (design §3) and the user channel (§4) into the loop;
 * steering and the final check are layered on in T6–T7 of
 * docs/superpowers/plans/2026-11-18-assistant-harness.md.
 */
export function createAssistant(config: AssistantConfig): Assistant {
  return {
    start(said: string, onEvent: (event: AssistantEvent) => void): AssistantRun {
      // The harness speaks the language of the request (lang.ts).
      setLanguage(languageOf(said));
      const id = `run-${++runCount}`;
      let parked: string | undefined;
      let stopped = false;
      /** Set while the stop question is open; tool calls wait on it. */
      let stopGate: Promise<"stop" | "continue"> | undefined;
      /** Tools that finished, for the report when the user stops the work. */
      const done: string[] = [];
      /** Approvals refused or left unanswered in this run, by what was asked, with what to tell the model. */
      const refused = new Map<string, string>();
      /** Asked-about actions not (yet) allowed, by the same key; told to the self-check. */
      const undone = new Map<string, string>();
      let acted = false;
      let capped: "cost" | "turns" | undefined;
      let turns = 0;
      let spent = 0;
      let lastText = "";
      let failure: string | undefined;
      const list = config.checklist ? createChecklist() : undefined;
      const park = (what: string) => {
        if (parked) return;
        parked = what;
        onEvent({ kind: "parked", text: say().parked(what) });
        agent.abort();
      };
      const channel = createUserChannel({
        runId: id,
        onEvent,
        waitForUserMs: config.waitForUserMs,
        onPark: park,
      });
      const interrupts = config.watch
        ? createInterrupts({
            watch: config.watch,
            ask: (question, choices) => channel.ask(question, choices),
            onPaused: () => onEvent({ kind: "paused", reason: "user-input" }),
            // `steer` is defined below; it is only called once the run is going.
            steer: (text) => steer(text),
          })
        : undefined;
      const allTools = [...config.tools, ...channel.tools, ...(list ? [list.tool] : [])];
      const tools = new Map(allTools.map((t) => [t.name, t]));
      const finisher = createFinisher({
        lastText: () => lastText,
        acted: () => acted,
        pending: list?.pending,
        toolNames: [...tools.keys()],
        undone: () => [...undone.values()],
      });

      const agent = new Agent({
        initialState: {
          systemPrompt: list ? `${config.systemPrompt}\n\n${CHECKLIST_INSTRUCTIONS}` : config.systemPrompt,
          model: config.model,
          tools: allTools.map(toAgentTool),
          thinkingLevel: "low",
        },
        // Message hygiene for any model (src/hygiene.ts, plan T14 a–e): replies repaired before
        // their tools run, the history cleaned before each request.
        streamFn: hygienicStream(
          resilientStream(config.stream, { fallback: config.fallback, delayMs: config.retryDelayMs }),
        ),
        transformContext: async (messages) => cleanHistory(messages),
        getApiKey: config.getApiKey,
        toolExecution: "sequential",
        // The guard runs before every call, one call at a time even inside a batch.
        beforeToolCall: async ({ toolCall, args }) => {
          // The user pressed the key to speak: this step was chosen before their words, so it
          // waits for them, and is not done once they come — the model decides again from them.
          const spoke = held ? await held.done : undefined;
          if (stopped || (stopGate && (await stopGate) === "stop")) {
            return { block: true, reason: "Stopped by the user." };
          }
          if (spoke !== undefined)
            return {
              block: true,
              reason:
                "Not done: the user spoke before this step ran — their words come next. Decide again from them.",
            };
          const tool = tools.get(toolCall.name);
          if (!tool) return undefined;
          if (config.romanOnly && strings(args).some((value) => DEVANAGARI.test(value)))
            return { block: true, reason: ROMAN_ONLY };
          const usesInput = typeof tool.usesInput === "function" ? tool.usesInput(args) : tool.usesInput;
          if (usesInput && interrupts) {
            const go = await interrupts.beforeScreenAction();
            if (go === "park") {
              park(said);
              return { block: true, reason: "Parked: the user needs the PC now." };
            }
            if (go === "reobserve") return { block: true, reason: DICTATED };
          }
          const decision = await decide(tool, args);
          if (decision.kind === "allow") return undefined;
          if (decision.kind === "never") return { block: true, reason: `Not done: ${decision.why}` };
          // No means no for the rest of the run: the same action at a new pixel or a fresh element
          // id is the same action (T11 full bench: Kimi retried "Place order" and the user was asked
          // twice). Numbers are left out of the key for that reason; names and texts stay in, so a
          // No to Aryan's message is not a No to Mummy's.
          const key = [toolCall.name, decision.what, ...strings(args).sort()].join("\u0001");
          const before = refused.get(key);
          if (before) return { block: true, reason: before };
          const answer = await channel.approve(describeCall(decision.what, args), decision.why);
          // An Allow clicked while the stop question is open waits for that answer (review I6).
          const allowed = answer === "yes" && !stopped && !(stopGate && (await stopGate) === "stop");
          if (stopped) return { block: true, reason: "Stopped by the user." };
          if (allowed) {
            undone.delete(key);
            return undefined;
          }
          undone.set(key, decision.what);
          // Not a no: their words are steered in right after this, and this action stays open.
          if (answer === "moved-on") return { block: true, reason: MOVED_ON };
          const reason = answer === "unanswered" ? UNANSWERED : REFUSED;
          refused.set(key, answer === "unanswered" ? UNANSWERED : ALREADY_REFUSED);
          return { block: true, reason };
        },
        // After an action (not a look), show the model what is true now, so it checks instead of assumes.
        afterToolCall: async ({ toolCall, result, isError }) => {
          const tool = tools.get(toolCall.name);
          if (isError || !tool || tool.readOnly || !config.observeState) return undefined;
          const state = await config.observeState();
          return {
            content: [...result.content, { type: "text", text: ` [state after this action] ${state}` }],
          };
        },
        getFollowUpMessages: async () => (stopped || parked || capped ? [] : finisher.followUps()),
      });

      const cap = (why: "cost" | "turns") => {
        if (capped) return;
        capped = why;
        agent.abort();
      };
      // Seconds since the run began on every line, and each tool's own time: the gap between one
      // result and the next call is the model thinking (S-024, "ek click mein 5–10 s").
      const began = Date.now();
      const trace = (line: string) =>
        config.trace?.(`+${((Date.now() - began) / 1000).toFixed(1)} s ${line}`);
      agent.subscribe((e) => {
        if (e.type === "tool_execution_start") {
          onEvent({ kind: "working", text: e.toolName });
          trace(`${e.toolName} ${JSON.stringify(e.args ?? {}).slice(0, 300)}`);
        }
        if (e.type === "tool_execution_end")
          trace(
            `${e.toolName} → ${e.isError ? "ERROR " : ""}${resultText(e.result)}${e.durationMs !== undefined ? ` (${Math.round(e.durationMs)} ms)` : ""}`,
          );
        if (e.type === "tool_execution_end" && !e.isError) {
          done.push(e.toolName);
          if (!tools.get(e.toolName)?.readOnly) acted = true;
        }
        if (e.type === "message_end" && e.message.role === "assistant") {
          const text = e.message.content
            .flatMap((c) => (c.type === "text" ? [c.text] : []))
            .join("")
            .trim();
          if (text) lastText = text;
          if (e.message.stopReason === "error") failure = e.message.errorMessage ?? "unknown error";
          spent += e.message.usage?.cost?.total ?? 0;
          if (spent > (config.maxCostUsd ?? MAX_COST_USD)) cap("cost");
        }
        if (e.type === "turn_end" && ++turns >= (config.maxTurns ?? MAX_TURNS)) cap("turns");
      });

      // "Overrides anything earlier": wording from the friend's bench layer (eval/layered.ts), where
      // a mid-run redirect passed 75–81% with it against 25–44% without the layer.
      const steer = (text: string) =>
        agent.steer({
          role: "user",
          content: [
            {
              type: "text",
              text: `[User said while you were working — this overrides anything earlier it contradicts] ${text}`,
            },
          ],
          timestamp: Date.now(),
        });

      /**
       * A press of the command key mid-run (S-024: "maine kaha ruko, ye karta raha"): no new step
       * starts until the user's words arrive — they then decide — or HOLD_MS passes with none.
       */
      let held: { done: Promise<string | undefined>; release: (spoke?: string) => void } | null = null;
      const release = (spoke?: string) => {
        const was = held;
        held = null;
        was?.release(spoke);
      };
      const hold = () => {
        if (held) return;
        let settle!: (spoke?: string) => void;
        const done = new Promise<string | undefined>((resolve) => {
          settle = resolve;
        });
        const timer = setTimeout(() => release(undefined), config.holdMs ?? HOLD_MS);
        held = {
          done,
          release: (spoke) => {
            clearTimeout(timer);
            settle(spoke);
          },
        };
      };

      /** Pause at the next action and ask stop-or-continue; never a blind abort. */
      const requestStop = () => {
        release(undefined);
        if (stopGate || stopped) return;
        onEvent({ kind: "paused", reason: "stop-request" });
        stopGate = channel.ask(say().stopQuestion, [...say().stopChoices]).then((answer) => {
          const choice = stopChoice(answer);
          if (choice === "stop") {
            stopped = true;
            channel.cancelAll();
            agent.abort();
            return "stop";
          }
          stopGate = undefined;
          if (choice === "redirect") steer(String(answer));
          return "continue";
        });
      };

      const ending = (): { ok: boolean; text: string } => {
        const sofar = done.join(", ");
        if (stopped && !parked) return { ok: false, text: say().stopped(sofar) };
        if (parked) return { ok: false, text: say().parked(parked) };
        if (capped) return { ok: false, text: say().capped(capped, sofar) };
        if (failure) return { ok: false, text: say().noModel(failure) };
        if (finisher.gaveUp()) return { ok: false, text: say().garbled };
        return { ok: true, text: lastText };
      };
      // What is open now, before the first step: "BlueStacks mein Zomato" with BlueStacks already
      // open started a second one, because nothing told the model it was there (S-024).
      const opening = config.observeState
        ? config
            .observeState()
            .then((state) => (state ? `${said}\n\n[On the PC right now] ${state}` : said))
            .catch(() => said)
        : Promise.resolve(said);
      const finished = opening
        .then((first) => agent.prompt(first))
        .then(ending, (error: unknown) =>
          parked ? ending() : { ok: false, text: say().noModel(String(error)) },
        )
        .then(async (result) => {
          // A failed release must not hide the run's own ending.
          await config.releaseInput?.().catch(() => undefined);
          interrupts?.dispose();
          onEvent({ kind: "done", ...result });
          return result;
        });

      return {
        id,
        reply(reply: UserReply) {
          // Whatever the user just pressed or said to us is not "using the PC".
          interrupts?.answered();
          if (reply.kind !== "speech") {
            channel.answer(reply);
            return;
          }
          // A held step gives way to these words (the steering below carries them to the model).
          const wasHeld = held !== null;
          if (wasHeld && !STOP_WORDS.test(reply.text)) release(reply.text);
          // Stop words first: "ruk jao" must never be taken as the answer to a pending question.
          if (!stopGate && STOP_WORDS.test(reply.text)) return requestStop();
          if (channel.answer(reply)) return;
          steer(reply.text);
        },
        stop: requestStop,
        hold,
        finished,
      };
    },
  };
}
