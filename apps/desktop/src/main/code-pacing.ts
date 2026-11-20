import type { CodeSent } from "../shared/ipc";

/** A minute between emailed codes, and no more than three in ten minutes, per address. */
export const CODE_GAP_MS = 60_000;
export const CODE_WINDOW_MS = 10 * 60_000;
export const CODES_PER_WINDOW = 3;

/**
 * Paces the sign-in codes this app asks for. A pause keeps a slow inbox from turning into a pile of
 * codes where only the newest works, and the cap keeps a stuck user (or a script) from flooding an
 * address and our sender's reputation with it. Kept in memory: it is there for people, not attackers.
 */
export class CodePacing {
  private readonly sent = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Milliseconds until `email` may be sent another code; 0 when it may be now. */
  waitFor(email: string): number {
    const recent = this.recent(email);
    const last = recent.at(-1);
    if (last === undefined) return 0;
    const now = this.now();
    // At the cap, the next code waits for the oldest of the three to leave the window.
    const until =
      recent.length >= CODES_PER_WINDOW
        ? (recent[recent.length - CODES_PER_WINDOW] ?? last) + CODE_WINDOW_MS
        : last + CODE_GAP_MS;
    return Math.max(0, until - now);
  }

  record(email: string): void {
    this.sent.set(email, [...this.recent(email), this.now()]);
  }

  status(email: string): CodeSent {
    return {
      resendIn: Math.ceil(this.waitFor(email) / 1000),
      left: Math.max(0, CODES_PER_WINDOW - this.recent(email).length),
    };
  }

  /** What to tell someone asking again before they may. */
  tooSoon(email: string): string {
    const { resendIn, left } = this.status(email);
    if (left === 0) {
      const minutes = Math.max(1, Math.ceil(resendIn / 60));
      return `That's ${CODES_PER_WINDOW} codes in 10 minutes. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}, or continue with Google.`;
    }
    return `Wait ${resendIn} ${resendIn === 1 ? "second" : "seconds"} before asking for another code.`;
  }

  private recent(email: string): number[] {
    const since = this.now() - CODE_WINDOW_MS;
    return (this.sent.get(email) ?? []).filter((at) => at > since);
  }
}
