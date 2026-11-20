import type { AssistantEvent, UserReply } from "@subx/core";
import { romanWords } from "./lang";
import type { AssistantTool } from "./tool";

/**
 * How long a question or approval waits. Spec §4 said 5 minutes; the user, demo hand test
 * 2026-11-19: "bahut zyada time tak aise hi pada rehta hai … aisa nahi hona chahiye". An unanswered
 * question parks the work; an unanswered approval only skips that one action (see `approve`).
 */
export const WAIT_FOR_USER_MS = 60_000;

/**
 * What became of an approval. "moved-on": the user spoke a new instruction instead of yes or no —
 * it goes to the model at once and the action may be asked about again. "unanswered": nobody
 * answered in time — the action is skipped, the rest of the work goes on.
 */
export type Approval = "yes" | "no" | "moved-on" | "unanswered";
/** Questions per command. The prompt asks for one; code stops the second extra (spec §4). */
export const QUESTION_CAP = 2;
/**
 * Not "decide and finish": in the friend's 5,440-run bench (2026-11-18, situation 11, "Ar ko likho
 * hi" with Aryan and Aarnav both fitting) the push to finish turned into guessing a person, and the
 * layer scored lower there than no layer. Who or which is the user's to say, never the model's.
 */
const NO_QUESTIONS_LEFT =
  "No questions left. Do the parts that do not depend on the answer. If a choice only the user can make is still open (which person, which file, which app), do not guess: stop and say exactly what you need from them.";

// "nahi" is checked before "haan": "theek hai, mat bhejo" must never count as a yes.
const SPOKEN_NO = /\b(nahi|nahin|na|no|mat|cancel|rehne do|deny|ruko mat)\b/i;
const SPOKEN_YES = /\b(haan|haa|ha|han|yes|ok|okay|theek|thik|kar do|bhej do|allow|chalo|ji)\b/i;

/** Words in an answer: "haan haan bhej do yaar" is one; a new task is longer. */
const SHORT_REPLY_WORDS = 5;

/**
 * Whether spoken words are short enough to be an answer to a yes/no or a two-way question. A whole
 * instruction that contains "ok" or "nahi" is not one: "ओके, तो बेसिकली एक काम करो … ईमेल" was taken
 * for a yes, Enter was pressed, and the email asked for was lost (demo hand test, 2026-11-19).
 */
export function isShortReply(text: string): boolean {
  return (
    romanWords(text)
      .split(/[\s,.!?।]+/u)
      .filter(Boolean).length <= SHORT_REPLY_WORDS
  );
}

/** A spoken reply to an approval: yes, no, or neither — then it is new instructions. */
export function spokenApproval(text: string): boolean | undefined {
  if (!isShortReply(text)) return undefined;
  const roman = romanWords(text);
  if (SPOKEN_NO.test(roman)) return false;
  if (SPOKEN_YES.test(roman)) return true;
  return undefined;
}

type Answer = string | boolean | undefined;
type Pending = { kind: "ask" | "approve"; settle: (answer: Answer) => void };

export interface UserChannelOptions {
  runId: string;
  onEvent: (event: AssistantEvent) => void;
  /** Called once when something went unanswered for `waitForUserMs`; the run then stops. */
  onPark: (what: string) => void;
  waitForUserMs?: number;
}

/**
 * Everything that waits on the user — the guard's approvals and the model's questions — goes
 * through one channel, so a click and a spoken reply settle either the same way, and both park
 * the work when nobody answers.
 */
export function createUserChannel(options: UserChannelOptions) {
  const waitMs = options.waitForUserMs ?? WAIT_FOR_USER_MS;
  const pending = new Map<string, Pending>();
  let serial = 0;
  let questions = 0;

  /** Settles on the user's answer, or with `timedOut` after the wait. */
  function wait(kind: Pending["kind"], show: (id: string) => AssistantEvent, timedOut: () => Answer) {
    const id = `${options.runId}-${kind}-${++serial}`;
    return new Promise<Answer>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(timedOut());
      }, waitMs);
      pending.set(id, {
        kind,
        settle: (answer) => {
          clearTimeout(timer);
          pending.delete(id);
          resolve(answer);
        },
      });
      options.onEvent(show(id));
    });
  }

  /** A question shown in the capsule. Not counted against the model's budget on its own. */
  function ask(question: string, choices?: string[]) {
    return wait(
      "ask",
      (id) => ({ kind: "ask", id, question, ...(choices ? { choices } : {}) }),
      () => {
        options.onPark(question);
        return undefined;
      },
    );
  }

  const askUser: AssistantTool = {
    name: "ask_user",
    description:
      "Ask the user something only they know — which of several matches, which instance, a preference — and wait for the answer. Never ask what a tool can find out.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "One short question, in the user's language." },
        choices: {
          type: "array",
          items: { type: "string" },
          description: "The options, when there is a list.",
        },
      },
      required: ["question"],
      additionalProperties: false,
    },
    risk: "safe",
    readOnly: true,
    async run(input) {
      const { question, choices } = input as { question: string; choices?: string[] };
      if (++questions > QUESTION_CAP) return { text: NO_QUESTIONS_LEFT };
      const answer = await ask(question, choices);
      return {
        text:
          answer === undefined ? "No answer — the work is parked." : `The user answered: ${String(answer)}`,
      };
    },
  };

  const notifyUser: AssistantTool = {
    name: "notify_user",
    description:
      "Tell the user something without waiting — before long screen work, or when something sensitive was seen and left alone.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "One short line, in the user's language." } },
      required: ["text"],
      additionalProperties: false,
    },
    risk: "safe",
    readOnly: true,
    async run(input) {
      options.onEvent({ kind: "inform", text: (input as { text: string }).text });
      return { text: "Told the user." };
    },
  };

  return {
    tools: [askUser, notifyUser],

    /** The harness's own questions (e.g. stop or continue?); the model's budget is untouched. */
    ask,

    /** The guard's approval: "yes" only on an explicit yes (see `Approval`). */
    async approve(what: string, why: string): Promise<Approval> {
      const answer = await wait(
        "approve",
        (id) => ({ kind: "approve", id, what, why }),
        () => "unanswered",
      );
      if (answer === true) return "yes";
      if (answer === "moved-on" || answer === "unanswered") return answer;
      return "no";
    },

    /**
     * Settles what the reply is for. False when the words are not an answer and must go to the
     * model as new instructions — the caller steers them.
     */
    answer(reply: UserReply): boolean {
      if (reply.kind === "speech") {
        const [id, item] = [...pending.entries()].at(-1) ?? [];
        if (!id || !item) return false;
        if (item.kind === "ask") {
          item.settle(reply.text);
          return true;
        }
        const allowed = spokenApproval(reply.text);
        if (allowed === undefined) {
          // Neither yes nor no but a new instruction ("Priya ko Hi message karo" while RN's send
          // waited): the loop sits inside this approval, so leaving it open kept the words from
          // the model and the question on screen (demo hand test, 2026-11-19).
          item.settle("moved-on");
          return false;
        }
        item.settle(allowed);
        return true;
      }
      const item = pending.get(reply.id);
      if (!item) return false;
      if (reply.kind === "approval") item.settle(reply.allowed);
      else if (reply.kind === "choice") item.settle(reply.value);
      else item.settle(reply.inserted);
      return true;
    },

    /**
     * The user stopped the work: every approval still waiting is a no, every question goes
     * unanswered — otherwise the loop sits on them until the 5-minute park (T9–T13 review, I6).
     */
    cancelAll(): void {
      for (const item of [...pending.values()]) item.settle(item.kind === "approve" ? false : undefined);
    },

    pending(): { id: string; kind: Pending["kind"] } | null {
      const last = [...pending.entries()].at(-1);
      return last ? { id: last[0], kind: last[1].kind } : null;
    },
  };
}
