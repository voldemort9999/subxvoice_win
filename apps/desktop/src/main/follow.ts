import { type Lang, languageOf } from "@subx/assistant";
import type { Assistant, AssistantEvent, AssistantRun, UserReply } from "@subx/core";

/**
 * Follow My Words, routed: the command key starts the assistant, and while a run is working,
 * whatever the user says on that key goes to it — an answer, a correction, "ruk jao" — instead of
 * starting a second task (design §1a, plan T15). A run lasts minutes; the hotkey's own press is
 * over in seconds, so the run lives here, not in the dictation that heard it.
 */
export interface FollowDeps {
  /** Built per run, so a model or settings change applies to the next command. */
  assistant(): Assistant;
  /** Every event of the running task, for the capsule. */
  onEvent(event: AssistantEvent): void;
}

export interface Follow {
  /** What the user said on the command key. Returns the capsule's one-line acknowledgement. */
  said(text: string): string;
  /** A capsule button: an answer, an Allow / Don't, an insert. Ignored with nothing running. */
  reply(reply: UserReply): void;
  /** The command key went down: a run in progress holds its next step for what is about to be said. */
  hold(): void;
  busy(): boolean;
}

/**
 * A capsule press as it arrives from the renderer, checked before it reaches a run: an approval is
 * a yes only when `allowed` is literally true, so a malformed message can never send or pay.
 */
export function parseReply(value: unknown): UserReply | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 2000;
  if (r.kind === "speech") return text(r.text) ? { kind: "speech", text: r.text } : null;
  if (!text(r.id)) return null;
  if (r.kind === "approval" && typeof r.allowed === "boolean")
    return { kind: "approval", id: r.id, allowed: r.allowed === true };
  if (r.kind === "choice" && text(r.value)) return { kind: "choice", id: r.id, value: r.value };
  if (r.kind === "insert" && typeof r.inserted === "boolean")
    return { kind: "insert", id: r.id, inserted: r.inserted };
  return null;
}

/** The capsule's own lines, in the language of the request (packages/assistant lang.ts). */
const ACK = {
  hi: { started: "Kar raha hoon…", heard: "Sun liya", working: "Samajh raha hoon…" },
  en: { started: "On it…", heard: "Got it", working: "Working on it…" },
} as const;

export function createFollow(deps: FollowDeps): Follow {
  let active: AssistantRun | null = null;
  let lang: Lang = "hi";
  return {
    said(text) {
      if (active) {
        active.reply({ kind: "speech", text });
        return ACK[lang].heard;
      }
      lang = languageOf(text);
      // The model's first answer takes seconds; until then the capsule must not look idle.
      deps.onEvent({ kind: "working", text: ACK[lang].working, lang });
      const run = deps.assistant().start(text, deps.onEvent);
      active = run;
      void run.finished.finally(() => {
        if (active === run) active = null;
      });
      return ACK[lang].started;
    },
    reply(reply) {
      active?.reply(reply);
    },
    hold() {
      active?.hold();
    },
    busy: () => active !== null,
  };
}
