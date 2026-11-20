import type { UserInputWatch } from "@subx/core";
import { isShortReply } from "./ask";
import { romanWords, say } from "./lang";

/**
 * What the assistant does when the user uses their own mouse or keyboard mid-task (design §5, the
 * user's own rules, 2026-11-18): a short first touch is let be — the next screen action waits
 * until they have been still for a moment; a second touch, or one that goes on, means they need the
 * PC, so it asks. Dictation (Ctrl+Win) is allowed during a run: the next screen action waits for
 * the paste to land, then the screen is read again, so a click never steals focus from a paste.
 * Only actions that move the mouse or press keys come through here; tree and domain actions run on.
 */

/** Still this long after a touch, and the work goes on. */
const QUIET_MS = 1500;
/** A touch this long is not a brush of the mouse: ask. */
const LONG_TOUCH_MS = 2000;
const POLL_MS = 100;

export interface InterruptDeps {
  watch: UserInputWatch;
  /** The harness's own question (not the model's budget); undefined when it went unanswered. */
  ask(question: string, choices: string[]): Promise<unknown>;
  onPaused(): void;
  /** Words spoken instead of an answer, for the model as a new instruction. */
  steer?(text: string): void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Interrupts {
  /** Waits as the rules say. "reobserve": a dictation landed meanwhile — look before acting. */
  beforeScreenAction(): Promise<"go" | "park" | "reobserve">;
  /**
   * The user just answered something on the capsule. That click or key is not a touch, and the
   * count starts again — or every Allow would bring "Aapko kaam hai?" one step closer.
   */
  answered(): void;
  dispose(): void;
}

const wantsLater = (answer: unknown) =>
  answer === undefined || /\b(baad|later|abhi nahi|nahi|ruk)/i.test(romanWords(String(answer)));

/**
 * Speech that is not an answer but a new task: "एक ईमेल कंपोज करो …", said while "Aapko kaam hai?"
 * was up, was taken as "continue" and the email was lost until said twice more (demo hand test,
 * 2026-11-19). It goes to the model, and the work goes on.
 */
const isInstruction = (answer: unknown) => typeof answer === "string" && !isShortReply(answer);

export function createInterrupts(deps: InterruptDeps): Interrupts {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let touches = 0;
  let lastStart = Number.NaN;
  let hold = false;
  let needAsk = false;
  /** Touches that start before this are the user answering us, not using the PC. */
  let quietUntil = Number.NEGATIVE_INFINITY;

  const reset = () => {
    touches = 0;
    hold = false;
    needAsk = false;
    quietUntil = now() + QUIET_MS;
  };

  const unsubscribe = deps.watch.onTouch((touch) => {
    if (touch.startedAt < quietUntil) return;
    if (touch.startedAt !== lastStart) {
      lastStart = touch.startedAt;
      touches++;
    }
    hold = true;
    if (touches >= 2 || touch.heldMs >= LONG_TOUCH_MS) needAsk = true;
  });

  return {
    async beforeScreenAction() {
      let dictated = false;
      for (;;) {
        if (deps.watch.dictationActive()) {
          dictated = true;
          await sleep(POLL_MS);
          continue;
        }
        if (needAsk) {
          deps.onPaused();
          const answer = await deps.ask(say().touchQuestion, [...say().touchChoices]);
          reset();
          if (isInstruction(answer)) {
            deps.steer?.(String(answer));
            return dictated ? "reobserve" : "go";
          }
          return wantsLater(answer) ? "park" : dictated ? "reobserve" : "go";
        }
        if (hold && deps.watch.idleMs() < QUIET_MS) {
          await sleep(POLL_MS);
          continue;
        }
        hold = false;
        return dictated ? "reobserve" : "go";
      }
    },
    answered: reset,
    dispose: unsubscribe,
  };
}
