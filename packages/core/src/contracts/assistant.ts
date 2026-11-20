/**
 * The assistant that replaces Follow My Words' fixed pipeline: one run per spoken command, which can
 * tell the user things, ask them, and be talked to while it works. The app only sees these types;
 * the loop itself lives in `@subx/assistant`. See
 * docs/superpowers/specs/2026-11-18-assistant-harness-design.md §1, §1a, §4.
 */

/** What a run tells the capsule. `id` ties a question to the reply that settles it. */
export type AssistantEvent =
  /** `lang`: set on a run's first event, so the capsule labels its buttons in the user's language. */
  | { kind: "working"; text: string; lang?: "hi" | "en" }
  | { kind: "inform"; text: string }
  | { kind: "ask"; id: string; question: string; choices?: string[] }
  | { kind: "approve"; id: string; what: string; why: string }
  | { kind: "draft"; id: string; text: string }
  | { kind: "paused"; reason: "user-input" | "stop-request" }
  | { kind: "parked"; text: string }
  | { kind: "done"; ok: boolean; text: string };

/** What the user does back: a click on the capsule, or speech on the command key mid-run. */
export type UserReply =
  | { kind: "choice"; id: string; value: string }
  | { kind: "approval"; id: string; allowed: boolean }
  | { kind: "insert"; id: string; inserted: boolean }
  | { kind: "speech"; text: string };

export interface AssistantRun {
  readonly id: string;
  reply(reply: UserReply): void;
  /** Pause and ask whether to stop or continue — never a blind abort (design §1a). */
  stop(): void;
  /**
   * The user pressed the command key: start no new step until their words arrive (they then
   * decide what happens) or a short while passes with none.
   */
  hold(): void;
  readonly finished: Promise<{ ok: boolean; text: string }>;
}

export interface Assistant {
  start(said: string, onEvent: (event: AssistantEvent) => void): AssistantRun;
}

/** The code guard's verdict on one tool call, before it runs (design §3). */
export type GuardDecision =
  | { kind: "allow" }
  | { kind: "ask"; what: string; why: string }
  | { kind: "never"; why: string };
