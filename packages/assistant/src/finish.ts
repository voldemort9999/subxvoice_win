import type { AgentMessage } from "./pi";

/**
 * Claude Code's habit, the one that lifted long flows most in the S-019 bench (Sonnet 2/4 → 6/8):
 * before stopping, re-read the request and prove each part with tools. Rewritten from the bench's
 * CHECK_PROMPT for the assistant's reply-language rule.
 */
export const SELF_CHECK =
  "Before you finish, check your work silently — the user never sees this check. Re-read the user's original request and go through every part of it in your head. For each part, confirm with tools (the screen, the UI tree or the state) that it is done right now — not just attempted. If a part is not done, do it now. If the user changed who or what while you worked, make sure nothing was left behind for the old target (a draft typed to the wrong person is cleared). A part that needs a choice only the user can make, and that they have not answered, is reported as not done — never guessed. Your final reply is spoken to the user: only one short line saying what you did and anything you could not do, in the same language as the user's original request, not the language of this message. No list, no checklist, no mention of checking.";

export const MALFORMED_RETRY =
  "Your last message was a malformed tool call. Call the tool properly with JSON arguments.";

/** What gpt-oss and others leaked as text instead of a real tool call in the S-019 bench. */
const MALFORMED_MARKS = ["<|", "to=functions", "</assistant"];

/**
 * Also a line that is one of the run's own tool names, with or without arguments: Qwen3-235B
 * answered "set_volume(level=80)" and "get_state" as plain text, and each run ended with nothing
 * done (T19b mid-model bench).
 */
export function isMalformed(text: string, toolNames: readonly string[] = []): boolean {
  if (MALFORMED_MARKS.some((mark) => text.includes(mark))) return true;
  return text.split("\n").some((line) => {
    // "set_volume(level=80)", "set_volume {…}", or the bare name alone on its line ("get_state").
    const m = /^\s*`?([a-z_][a-z0-9_]*)`?\s*(\(|\{|$)/i.exec(line);
    return m !== null && toolNames.includes(m[1] as string);
  });
}

const say = (text: string): AgentMessage => ({
  role: "user",
  content: [{ type: "text", text }],
  timestamp: Date.now(),
});

/**
 * Decides what to tell the model when it would stop: one retry for a malformed tool call, then one
 * self-check — only when the run actually did something (a run that only read or asked has
 * nothing to verify).
 */
export function createFinisher(state: {
  lastText(): string;
  acted(): boolean;
  /** Checklist parts still open (src/checklist.ts), when the checklist is on. */
  pending?(): string | undefined;
  /** The run's tools, to recognise a call written out as text. */
  toolNames?: readonly string[];
  /**
   * Actions the guard asked about that the user never allowed (said no, spoke a new task instead,
   * or did not answer), and that were not allowed later. The model is told, so its reply cannot
   * say "bhej diya" for a send that never happened (demo hand test, 2026-11-19).
   */
  undone?(): string[];
}) {
  const malformed = () => isMalformed(state.lastText(), state.toolNames);
  let checked = false;
  let retried = false;
  let pushbacks = 0;
  return {
    followUps(): AgentMessage[] {
      if (malformed()) {
        if (retried) return [];
        retried = true;
        return [say(MALFORMED_RETRY)];
      }
      // At most twice, as in the friend's layer (eval/layered.ts MAX_PUSHBACKS): a part the model
      // cannot do must not loop the run until the turn cap.
      const open = pushbacks < 2 ? state.pending?.() : undefined;
      if (open) {
        pushbacks++;
        return [say(open)];
      }
      if (checked || !state.acted()) return [];
      checked = true;
      const undone = state.undone?.() ?? [];
      return [
        say(
          undone.length
            ? `${SELF_CHECK}\n\nNot done, because the user did not allow it — never say these were done: ${undone.join("; ")}.`
            : SELF_CHECK,
        ),
      ];
    },
    /** True when the model kept answering with a broken tool call after its one retry. */
    gaveUp(): boolean {
      return retried && malformed();
    },
  };
}
