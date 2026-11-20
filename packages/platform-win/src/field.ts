import type { FieldReader } from "@subx/core";

/**
 * Reads back the box a dictation was pasted into, so the user's own fixes can be learned (the Mac
 * app's `FieldWatcher.swift`, on Windows; Mac UI port 2026-11-19). UIA's focused element and its
 * Value, polled: Windows sends no event a poll would not also see, and a poll costs one small
 * PowerShell call. The text never leaves the PC; only a learned word is kept (main/learner.ts).
 */

export interface FieldDeps {
  /** The focused box's text; null when nothing readable has the focus (or it is a password box). */
  read(): Promise<string | null>;
  /** The window in front: the user moving elsewhere ends the watch. */
  foreground(): number;
  pollMs?: number;
}

const POLL_MS = 400;

export class WinFieldReader implements FieldReader {
  constructor(private readonly deps: FieldDeps) {}

  watch(onText: (text: string) => void, onEnd: (reason?: string) => void, ms: number): { stop(): void } {
    const window = this.deps.foreground();
    const until = Date.now() + ms;
    let last: string | null = null;
    let done = false;
    let timer: NodeJS.Timeout | undefined;
    const end = (reason: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      onEnd(reason);
    };
    const poll = async () => {
      if (done) return;
      if (Date.now() >= until) return end("time");
      if (this.deps.foreground() !== window) return end("moved");
      const text = await this.deps.read().catch(() => null);
      if (done) return;
      if (text === null) return end("unreadable");
      if (text !== last) {
        last = text;
        onText(text);
      }
      timer = setTimeout(poll, this.deps.pollMs ?? POLL_MS);
    };
    void poll();
    return { stop: () => end("stopped") };
  }
}
