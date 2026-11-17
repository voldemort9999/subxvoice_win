import type { DeciderProvider } from "../contracts/decider";
import type { LlmProvider, LlmRequest, LlmResponse } from "../contracts/llm";
import type { AgentMemory } from "./memory";
import type { ActionSource, AgentAction, AgentEvent, AgentOutcome } from "./types";

/**
 * One command, start to finish:
 *
 *   split what was said into steps ─► for each step: the decider picks the action that does it ─►
 *   the writer fills that action's details (only if it has any) ─► run
 *
 * The number of steps is fixed before anything runs. The first version asked the decider after
 * every step whether more was needed, and on real use it rarely said no: "type hai" typed it six
 * times, "set the volume to 100%" set it twice, and "close the BlueStacks instance manager" went
 * on to close the main BlueStacks window, which nobody asked for. A planned list cannot repeat
 * itself, and nothing has to recognise "done".
 *
 * The decider is a classifier: it cannot invent an action, only pick one it was offered. So the
 * menu is the whole space of what can happen; the writer supplies values, never decides.
 */

/** A request with more parts than this is not one command. */
const MAX_STEPS = 6;

/**
 * Below this the decider is guessing. Measured on 21 Hinglish commands: right answers came back
 * at 0.71–1.00, the one wrong answer at 0.50.
 */
const MIN_CONFIDENCE = 0.5;

/**
 * Acting on the wrong thing is worse for some actions than others. Closing windows and stopping
 * programs lose work, so a guess that would be acted on elsewhere is not acted on there.
 */
const RISKY_CONFIDENCE = 0.7;

/**
 * A risky action Jev chose but under 0.7 is still done when the writer, asked separately, chooses
 * the same one — down to this. At 0.5 "band karo" is split between closing and killing, and stays
 * refused.
 */
const AGREED_RISKY_CONFIDENCE = 0.6;

/** Offered on every step, so a step no action can do is not forced onto the nearest one. */
const NOTHING_FITS = "nothing_fits";

export const AGENT_QUESTION =
  "Choose the action that carries out this step. If none of them can, choose nothing_fits.";

/**
 * "This step only": for "Aryan ke paas message bhejna hai, hi" the step "Type Aryan into WhatsApp's
 * search box" was filled with "hi" — the writer read the whole request instead of its step.
 */
export const ARGS_SYSTEM =
  "You fill in the details for one action on the user's computer, for THIS STEP only. What the user " +
  "said is the whole request and other steps do the rest of it; take the values this step names " +
  "(in 'Type Aryan into the search box' the text is Aryan, whatever else the user said). The user " +
  "spoke Hindi, English or a mix of both, possibly written in Devanagari. Reply with one JSON object " +
  "holding the fields themselves, not wrapped in the action's name. No prose, no code fences.";

/**
 * Every rule after the first few is a failure from a real session (2026-11-11): unclear speech was
 * turned into a YouTube search or typed out ("अन्बुकरो" → "anbukaro"), a misheard app name
 * ("cloud app" for Claude) became "open Chrome, search YouTube", a plan copied the wording of an
 * earlier result ("Close 1 window") instead of naming its target, and one request typed the same
 * text twice.
 */
const SPLIT_SYSTEM =
  "You turn what the user said to their computer into the actions it asks for, in order. What they " +
  "said comes from speech recognition: Hindi, English or a mix, possibly in Devanagari, and names " +
  "are often misheard — an app may arrive as a word that only sounds like it. Each step is one short " +
  "English instruction in your own words — never a capability's wording copied — that one of the " +
  "listed capabilities can carry out, and names what it acts on: the app, window, file or folder. Use as few steps as the capabilities allow — playing a song " +
  "on YouTube is two steps: search it by address, then click the 1st result. Rules: " +
  "(1) Never add a step the user did not ask for, and never repeat one; a key pressed several times " +
  "is one step with the count. " +
  "(2) Search or play on the web only when the user asked to search, play, watch or open a website. " +
  "Never use a web search as a fallback for something you did not understand. " +
  "(3) To open an app, the step is 'Open the app <name as heard>', even if the name looks wrong — " +
  "the app list is checked later for the closest-sounding app. Never replace it with a web search. " +
  "(4) Type only when the user asked for words to be written or typed (likho, type karo, write). " +
  "Chat or a greeting like 'hello kaise ho' is not a request: no steps. Words to type, search or " +
  "send stay as they said them, in Roman letters, never translated. A message or email the user " +
  "asks to be written for them is one step, 'Type an email to <who> saying <what>', for the " +
  "typing action to compose — not the words to type. " +
  "(4b) A question about what an app is showing — is WhatsApp logged in, what is the top email — " +
  "is one step that reads the screen. Never answer it by opening, typing or searching. " +
  // "WhatsApp quit kar" was planned as "Close the app WhatsApp", which Jev split between closing
  // windows and stopping the program — both risky, so nothing was done, twice.
  "(5) Closing, quitting or 'band karo' for an app is 'Close the window <app>' — stopping its " +
  "program is only for 'force', 'kill' or an app that hangs. Closing a browser tab is pressing " +
  "Ctrl+W, never closing the browser's window. Opening " +
  "something 'on Chrome' or 'in the browser' that is a website (WhatsApp Web, Gmail, YouTube) is " +
  "opening that website — one step, no separate 'open Chrome'. " +
  "(6) Use what was done earlier only to understand words like 'it', 'usmein' or 'wapas'; never " +
  "copy an earlier result as a step, and never plan an earlier command again. " +
  "(8) Prefer a direct capability over the screen: volume, apps, windows, keys, files, and websites " +
  "or searches by address are always done directly. Use the screen — clicking, typing into a " +
  "particular box, reading — only for what is inside an app's window and nothing direct can do: " +
  "playing the second video in the results, opening a chat, searching inside an app. Each screen " +
  "step does one thing to one element and names the app. Writing a message to someone on WhatsApp " +
  "is ONE step, 'Message <name> on WhatsApp: <message>' — that capability opens WhatsApp, finds the " +
  "chat and types it, whatever WhatsApp is showing. Searching for something stops at typing it into " +
  "the search box; open a " +
  "chat or result only when the user asked to open it or to message someone. " +
  "(9) Never send. Writing or 'sending' a message, mail or post types it and stops there — no Enter, " +
  "no Send button — even when the user says 'bhejo' or 'send'. Only a command whose whole request is " +
  "to send what is already typed ('ab send kar do', 'bhej do isse') is one step: send the typed " +
  "message. " +
  "(7) If something asked for fits no capability, keep it as its own step anyway, so it is refused " +
  "honestly. If you cannot tell what they want at all, there are no steps. " +
  // Examples, because rules alone did not hold: "WhatsApp pe Aryan ko hi bhejo" was planned as
  // just "type hi into the message box" with no chat open, and "YouTube kholo" as an app.
  // Each example is a real command that went wrong: WhatsApp not in front, so no search box to
  // type into; a search "in this tab" sent to a new tab; YouTube's mini player taken for a window.
  // Messaging is one step since a planned four-step version broke whenever one step was skipped.
  "Examples: 'WhatsApp pe Aryan ko hi bhejo' → [\"Message Aryan on WhatsApp: hi\"]. " +
  "'dost Aarnav ko bolo kal milte hain' → [\"Message Aarnav on WhatsApp: kal milte hain\"]. " +
  "'YouTube pe 4th video chalao' → [\"Click the 4th result in YouTube\"]. " +
  "'YouTube kholo' → [\"Open the website youtube.com\"]. " +
  // "Chalao" plays, "search karo" only searches: the user asked for a song and got a results page.
  '\'YouTube pe Kesariya chalao\' → ["Search YouTube for Kesariya", "Click the 1st result in ' +
  'YouTube"]. \'YouTube pe Kesariya search karo\' → ["Search YouTube for Kesariya"]. ' +
  // Both were planned as "open google.com, type into its box, press Enter", the second one into
  // Google's box because the command before it had opened Google.
  "'Google pe aaj ka weather search karo' → [\"Search Google for aaj ka weather\"]. " +
  "'YouTube pe Kahani YT channel search karo' → [\"Search YouTube for Kahani YT channel\"] — the " +
  "site the user names now wins over the one the last command used. " +
  // Carrying on where the last command left off, without the user naming the place again.
  "Continuing after a YouTube search: 'first wala chalao' → [\"Click the 1st result in YouTube\"]; " +
  '\'ab Kesariya chalao\' → ["Search YouTube for Kesariya", "Click the 1st result in YouTube"]. ' +
  "Continuing after messaging Aryan: 'usko hello bhi likho' → [\"Message Aryan on WhatsApp: " +
  "hello\"]. Continuing after opening Chrome: 'YouTube kholo' → [\"Open the website " +
  'youtube.com in this tab"]. ' +
  "'isi YouTube tab mein MCU portal search karo' → [\"Type MCU portal into YouTube's search box\", " +
  '"Press Enter"] — in the page that is open, because the user said so; otherwise a search opens ' +
  "by address. " +
  "'YouTube ki chhoti / minimized video ko bada karo' → [\"Click the Expand button of YouTube's mini " +
  'player"] — a player inside a page is not a window; minimize and maximize are for whole windows ' +
  "only. " +
  "'ab send kar do' → [\"Send the typed message\"]. " +
  // The place was dropped from "Pictures wale folder mein mera resume hoga, khol ke dikhao", and
  // the newest resume — in Downloads — was shown instead of the one in Pictures.
  "Finding, showing or opening a file is one step that keeps where the user said it is: 'Pictures " +
  "folder mein mera resume hoga, dikhao / kholo / dhoondo' → [\"Find the file resume in " +
  "Pictures\"]; 'is folder mein invoice dhoondo' → [\"Find the file invoice in the folder open in " +
  'File Explorer"]. ' +
  "Never put a double quote inside a step; use single quotes. " +
  'Reply with one JSON object: {"steps": string[]}. No prose, no code fences.';

export interface AgentDeps {
  decider: DeciderProvider;
  writer: LlmProvider;
  sources: ActionSource[];
  memory: AgentMemory;
  onEvent?(event: AgentEvent): void;
  log?(line: string): void;
}

export async function runCommand(said: string, deps: AgentDeps): Promise<AgentOutcome> {
  const done: string[] = [];
  const finish = (message: string, ok: boolean): AgentOutcome => {
    deps.memory.remember(said, done);
    return { message, ok, steps: done };
  };
  // What has been achieved so far, for a run that stops partway.
  const sofar = () => done.join(" · ");
  // A run that stops partway says what it did *and* what it could not: "Opened Google Chrome"
  // alone, with the second step silently dropped, read as success in real use.
  const stopped = (alone: string, partly: string) =>
    finish(done.length ? `${sofar()} · then ${partly}` : alone, done.length > 0);

  deps.onEvent?.({ kind: "thinking" });
  let plan: string[] | null;
  try {
    const [facts, actions] = await gather(deps.sources, deps.log);
    plan = await split(
      said,
      actions,
      deps.memory.recall(),
      facts,
      deps.writer,
      deps.log,
      deps.memory.continuing(),
    );
  } catch (error) {
    deps.log?.(`agent: planning failed — ${reason(error)}`);
    return finish("Couldn't reach the assistant — check the connection", false);
  }
  if (plan === null) return finish("Didn't catch that — try again", false);
  deps.log?.(`agent: plan ${JSON.stringify(plan)}`);
  if (!plan.length) return finish("That isn't something I can do", false);
  const kept = holdBackSending(plan, said);
  const notSent = kept.length < plan.length;
  if (notSent) deps.log?.(`agent: held back ${JSON.stringify(plan.filter((step) => !kept.includes(step)))}`);
  plan = kept;

  for (const [index, step] of plan.slice(0, MAX_STEPS).entries()) {
    deps.onEvent?.({ kind: "thinking" });
    const [facts, actions] = await gather(deps.sources, deps.log);
    const state = [
      `User said: "${said}"`,
      `This step: ${step}`,
      ...(done.length ? [`Already done for this request: ${done.join("; ")}`] : []),
      ...facts,
    ];

    let choice: string;
    let confidence: number;
    let probabilities: Record<string, number> | undefined;
    try {
      ({ choice, confidence, probabilities } = await deps.decider.decide({
        state,
        criteria: menu(actions),
        instructions: AGENT_QUESTION,
      }));
    } catch (error) {
      deps.log?.(`agent: deciding failed — ${reason(error)}`);
      return stopped("Couldn't reach the assistant — check the connection", "couldn't reach the assistant");
    }
    // The runners-up, because a low confidence is only fixable once you know what took the votes.
    const rivals = Object.entries(probabilities ?? {})
      .filter(([id]) => id !== choice)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 2)
      .map(([id, p]) => `${id} ${p.toFixed(2)}`)
      .join(", ");
    deps.log?.(
      `agent: step ${index + 1} "${step}" → ${choice} (${confidence.toFixed(2)}${rivals ? `; then ${rivals}` : ""})`,
    );

    let action = actions.find((candidate) => candidate.id === choice);
    if (!action || confidence < (action.risky ? RISKY_CONFIDENCE : MIN_CONFIDENCE)) {
      // Jev unsure between two right answers stopped real commands: "search YouTube for MCU
      // portal" was open_web 0.42 against screen_type 0.41. The writer then picks between Jev's top
      // two; it is acted on only if it is one of them and loses nothing — a risky action still
      // needs Jev's own 0.7. A sure nothing_fits is an answer and is not second-guessed.
      const settled = choice === NOTHING_FITS && confidence >= MIN_CONFIDENCE;
      const top = Object.entries(probabilities ?? {})
        .filter(([id]) => id !== NOTHING_FITS)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 2)
        .map(([id]) => id);
      const second =
        settled || !top.length
          ? null
          : await secondAction(
              deps.writer,
              actions.filter((candidate) => top.includes(candidate.id)),
              state,
            ).catch(() => null);
      if (second) deps.log?.(`agent: second opinion → ${second}`);
      // A risky action still needs Jev itself to have chosen it, over the floor, and the writer to
      // pick the same one on its own: "Notepad band karo" was close_windows at 0.69 with the writer
      // agreeing, and nothing was done.
      const agreed = actions.find(
        (candidate) =>
          candidate.id === second &&
          candidate.available !== false &&
          (!candidate.risky || (candidate.id === choice && confidence >= AGREED_RISKY_CONFIDENCE)),
      );
      if (!agreed) {
        // Partway through, a guess is still not a reason to act; what is done stays done.
        return action
          ? stopped("Didn't catch that — try again", `didn't catch: ${step}`)
          : stopped(`I can't do that yet: ${step}`, `couldn't: ${step}`);
      }
      action = agreed;
    }
    if (action.available === false) {
      const why = action.unavailable ?? "That isn't switched on yet";
      return stopped(why, why.charAt(0).toLowerCase() + why.slice(1));
    }

    let args: Record<string, unknown> = {};
    if (action.args) {
      let filled: Record<string, unknown> | null;
      try {
        filled = await fillArgs(action, step, state, deps.writer, deps.log);
      } catch (error) {
        deps.log?.(`agent: filling ${action.id} failed — ${reason(error)}`);
        filled = null;
      }
      if (!filled)
        return stopped(
          "Couldn't work out the details — try saying it differently",
          `couldn't work out: ${step}`,
        );
      args = filled;
    }

    deps.onEvent?.({ kind: "doing", what: step });
    try {
      const result = await action.run(args, { said, step });
      done.push(result.did);
      deps.onEvent?.({ kind: "did", what: result.did });
      deps.log?.(`agent: ${action.id} ${JSON.stringify(args)} → ${result.did}`);
      if (result.answer) return finish(result.answer, true);
    } catch (error) {
      deps.log?.(`agent: ${action.id} ${JSON.stringify(args)} failed — ${reason(error)}`);
      return finish(done.length ? `${sofar()} · then: ${reason(error)}` : reason(error), done.length > 0);
    }
  }
  return finish(notSent ? `${sofar()} · not sent — say "send it" when it looks right` : sofar(), true);
}

/**
 * The user's rule (2026-11-11): writing a message types it and stops; sending is a command of its
 * own. The planner was told so and still planned "Type hi in WhatsApp", "Press Enter" for "Aarnav
 * ko hi bhejo" — so after anything is typed, a send step is dropped here, whatever was planned.
 * Enter survives only when the user said "enter" or "search" themselves ("weather type karo aur
 * enter maro" is a web search, not a message). "Ab send kar do" on its own types nothing, so it
 * passes.
 */
const TYPING = /\b(type|write|compose)\b/i;
const SENDING = /\bsend\b|\benter\b/i;
const ASKED_FOR_ENTER = /enter|एंटर|search|सर्च/i;

export function holdBackSending(plan: string[], said: string): string[] {
  const typed = plan.findIndex((step) => TYPING.test(step));
  if (typed < 0) return plan;
  return plan.filter(
    (step, index) =>
      index <= typed || !SENDING.test(step) || (!/\bsend\b/i.test(step) && ASKED_FOR_ENTER.test(said)),
  );
}

/** Every source asked at once; one that fails is left out rather than sinking the command. */
async function gather(
  sources: ActionSource[],
  log?: (line: string) => void,
): Promise<[string[], AgentAction[]]> {
  const results = await Promise.all(
    sources.map(async (source) => {
      try {
        return [await source.observe(), await source.actions()] as const;
      } catch (error) {
        log?.(`agent: a source failed — ${reason(error)}`);
        return [[], []] as const;
      }
    }),
  );
  return [results.flatMap(([facts]) => facts), results.flatMap(([, actions]) => actions)];
}

/** Option key → what it does. An unavailable action says so, so it is chosen only when nothing else fits. */
export function menu(actions: AgentAction[]): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const action of actions) {
    criteria[action.id] =
      action.available === false ? `${action.describe}. NOT AVAILABLE YET` : action.describe;
  }
  criteria[NOTHING_FITS] = "None of these actions can carry out this step";
  return criteria;
}

/**
 * What was said, as the ordered steps it asks for. The writer sees the capabilities, so that it
 * cuts the request at the same grain the actions work at: "play Kesariya on YouTube" is one search,
 * not open-then-type-then-click.
 */
async function split(
  said: string,
  actions: AgentAction[],
  earlier: string[],
  now: string[],
  writer: LlmProvider,
  log?: (line: string) => void,
  continuing?: { seconds: number; did: string[] } | null,
): Promise<string[] | null> {
  const capabilities = actions.map((action) =>
    action.available === false ? `- ${action.describe} (not available yet)` : `- ${action.describe}`,
  );
  const response = await completeOnce(writer, {
    system: SPLIT_SYSTEM,
    messages: [
      {
        role: "user",
        // Earlier commands under their own heading. Shown as plain lines, a finished "kill
        // msedgewebview2" was planned again for "shutdown karo", and "Stop the app Rome" was
        // carried into the next command.
        content: [
          "Capabilities:",
          ...capabilities,
          ...(earlier.length
            ? [
                "Earlier commands — ALREADY DONE, shown only to explain words like 'it' or 'wapas'. Never plan them again:",
                ...earlier,
              ]
            : []),
          ...(now.length ? ["Right now:", ...now] : []),
          // The user should not have to say "YouTube" again a moment after opening it.
          ...(continuing
            ? [
                `Continuing: the last command, ${continuing.seconds} s ago, did: ${continuing.did.join("; ")}. ` +
                  "A command that names no app, site or window carries on in that same place.",
              ]
            : []),
          `The command to plan: "${said}"`,
        ].join("\n"),
      },
    ],
    maxTokens: 300,
    json: true,
  });
  const parsed = parseArgs(response.text, "steps", '{"steps": string[]}');
  const steps = Array.isArray(parsed?.steps) ? parsed.steps : repairSteps(response.text);
  if (!steps) {
    log?.(`agent: could not read the plan: ${JSON.stringify(response.text.slice(0, 400))}`);
    return null;
  }
  // A step said twice is one step: the same text was once typed twice, the second time cut short
  // because the first was shown to the writer truncated. A key pressed twice is one step with a count.
  const seen = new Set<string>();
  return steps
    .map((step) => String(step).trim())
    .filter((step) => step && !seen.has(step.toLowerCase()) && seen.add(step.toLowerCase()));
}

async function fillArgs(
  action: AgentAction,
  step: string,
  state: string[],
  writer: LlmProvider,
  log?: (line: string) => void,
): Promise<Record<string, unknown> | null> {
  const facts = action.facts ? await action.facts() : [];
  const response = await completeOnce(writer, {
    system: ARGS_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `Action: ${action.id} — ${action.describe}`,
          `Fields: ${action.args}`,
          ...state,
          ...facts,
        ].join("\n"),
      },
    ],
    maxTokens: 400,
    json: true,
  });
  const args = parseArgs(response.text, action.id, action.args);
  // What the writer actually said is the only way to tell a bad prompt from a bad model.
  if (!args)
    log?.(
      `agent: could not read details for ${action.id} (${step}): ${JSON.stringify(response.text.slice(0, 400))}`,
    );
  return args;
}

const SECOND_ACTION_SYSTEM =
  "You choose which action carries out one step on the user's computer. Reply with only the action's " +
  'id, such as "open_web", or "none" if neither does.';

async function secondAction(
  writer: LlmProvider,
  candidates: AgentAction[],
  state: string[],
): Promise<string | null> {
  const response = await completeOnce(writer, {
    system: SECOND_ACTION_SYSTEM,
    messages: [
      {
        role: "user",
        content: [...candidates.map((action) => `${action.id}: ${action.describe}`), ...state].join("\n"),
      },
    ],
    maxTokens: 10,
  });
  const said = response.text.trim().toLowerCase();
  return candidates.find((action) => said.includes(action.id))?.id ?? null;
}

/**
 * A plan whose JSON broke on a quote inside a step — gemini once wrote
 * `{"steps": ["Play on YouTube "motor वाला""]}` and the whole command was dropped. The steps are
 * the strings between `["` and `"]`, split where `", "` separates them.
 */
export function repairSteps(text: string): string[] | null {
  const inside = /"steps"\s*:\s*\[\s*"([\s\S]*)"\s*\]/.exec(text)?.[1];
  if (inside === undefined) return null;
  return inside.split(/"\s*,\s*"/).map((step) => step.replace(/\\"/g, '"').trim());
}

/**
 * One retry. OpenRouter's "Provider returned error" came back on 2 of ~60 calls in one session,
 * and each time the command was simply said again and worked.
 */
async function completeOnce(writer: LlmProvider, request: LlmRequest): Promise<LlmResponse> {
  try {
    return await writer.complete(request);
  } catch {
    // Straight back failed every time when the provider was struggling; a short pause did not.
    await new Promise((resolve) => setTimeout(resolve, 700));
    return writer.complete(request);
  }
}

/**
 * The writer's JSON, read leniently where leniency is safe. Models sometimes fence it, wrap the
 * fields in the action's name — `{"set_volume": {"level": 50}}`, about a third of gpt-oss-120b's
 * replies — return a bare list for an action whose only field is a list (gemini-2.5-flash-lite on
 * `close_windows`), or follow a complete object with stray characters — gemini once answered
 * `{"url": "…"}` then `\n"}`. Each of those has exactly one possible meaning, so each is undone
 * here. Anything else is refused rather than guessed at.
 */
export function parseArgs(text: string, actionId: string, spec?: string): Record<string, unknown> | null {
  const json = firstJson(text);
  if (json === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (Array.isArray(value)) {
    const fields = [...(spec ?? "").matchAll(/"(\w+)"\s*:/g)].map((match) => match[1]);
    return fields.length === 1 ? { [fields[0] as string]: value } : null;
  }
  if (!isObject(value)) return null;
  const keys = Object.keys(value);
  const inner = value[actionId];
  if (keys.length === 1 && keys[0] === actionId && isObject(inner)) return inner;
  return value;
}

/**
 * The first complete JSON object or array in `text`, or null when it never closes. Brackets inside
 * strings are not counted, so a URL or a typed sentence containing `}` cannot end it early. A
 * fence or prose before it is skipped; anything after it is ignored.
 */
function firstJson(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === "\\") index++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
