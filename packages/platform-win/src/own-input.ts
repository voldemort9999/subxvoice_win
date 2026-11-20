/**
 * When this app itself sends input — not only the screen executor (input.ts), but a paste or a
 * Ctrl+L from a direct action, and the mouse clicks UIA actions make from PowerShell. The touch
 * watch reads Windows' "last input" clock, which every one of these moves; the laptop demo
 * (2026-11-19) asked "Aapko kaam hai?" right after WhatsApp's own typing because only the executor
 * was known to be us.
 */

/** Windows' input clock and ours are a tick (~16 ms) apart; a little slack either side. */
const BEFORE_MS = 100;
const AFTER_MS = 150;

let depth = 0;
let since = Number.NEGATIVE_INFINITY;
let until = Number.NEGATIVE_INFINITY;

/** One input sent just now (a chord, a batch). */
export function markOwnInput(now = Date.now()): void {
  if (depth > 0) return;
  since = now;
  until = now;
}

/** Everything `fn` sends while it runs — a whole direct action, a PowerShell UIA click — is ours. */
export async function asOwnInput<T>(fn: () => Promise<T>): Promise<T> {
  if (depth++ === 0) since = Date.now();
  try {
    return await fn();
  } finally {
    if (--depth === 0) until = Date.now();
  }
}

/** Whether input Windows timed at `at` was ours. */
export function isOwnInput(at: number): boolean {
  if (depth > 0) return at >= since - BEFORE_MS;
  return at >= since - BEFORE_MS && at <= until + AFTER_MS;
}

/** When our last input ended (now, while some is still being sent). */
export function ownInputEndedAt(now = Date.now()): number {
  return depth > 0 ? now : until;
}
