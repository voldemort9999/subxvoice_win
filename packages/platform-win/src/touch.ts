import type { Touch, UserInputWatch } from "@subx/core";
import { lastInputAt } from "./win32";

/**
 * The user's own mouse and keyboard while the assistant works (design §5), by polling Windows'
 * "last input" time — never a low-level hook (journal 001: Windows silently drops a hook whose
 * callback runs slow). That time moves for every input, so three kinds are taken out: what the
 * executor injected (its own timestamp), the app's own hotkey being held, and a dictation landing
 * (the key-down, then the paste the inserter sends).
 */

export interface TouchDeps {
  /** Date.now() of the last input Windows saw, from any source. */
  lastInputAt?: () => number;
  /** The executor's last injection (ScreenInput.lastInjectedAt). */
  injectedAt: () => number;
  /** Input the rest of the app sent: direct actions' pastes and keys, UIA clicks (own-input.ts). */
  own?: (at: number) => boolean;
  /** When that other input last ended. */
  ownEndedAt?: () => number;
  /** The hotkey poller holds Ctrl+Alt or Ctrl+Win right now. */
  chordHeld: () => boolean;
  /** Date.now() of the chord's last press or release (WinHotkey.chordChangedAt); 0 before any. */
  chordChangedAt?: () => number;
  /** Mouse buttons and keys down right now (virtual-key codes). */
  pressed?: () => ReadonlySet<number>;
  /** The window in front right now. */
  foreground?: () => number;
  dictationActive: () => boolean;
  now?: () => number;
  pollMs?: number;
}

/** Input this close around an injection is the executor's own (Windows' clock ticks ~16 ms). */
const OWN_BEFORE_MS = 100;
const OWN_AFTER_MS = 150;
/** A pause longer than this ends a touch: the next input starts a new one. */
const GAP_MS = 700;
const POLL_MS = 100;
/**
 * The chord's own key presses fall just outside "held": its first key goes down before the
 * hotkey poll recognises the pair, and its last key-up lands after the poll has cleared it. Input
 * this close to a press or release is the hotkey, and a touch is only told once it is this old,
 * so one that turns out to be the chord's first key is dropped before anyone hears of it
 * (T9–T13 review, I8: the press and release were counted as two touches and asked "kaam hai?").
 */
const CHORD_MARGIN_MS = 300;
/** A window our own action opened can come to the front this long after it. */
const OWN_WINDOW_MS = 1500;

/**
 * Keys and buttons a hand presses. Anything else read as "down" — media keys (a stuck Play/Pause
 * cancelled every chord, S-023), gamepad codes (0xC3–0xDA), IME and typed-character codes (0xE5,
 * 0xE7 is every character our own Unicode typing sends) — is not the user (laptop demo, 2026-11-19).
 */
const HAND_KEYS = new Set<number>([
  0x01,
  0x02,
  0x04,
  0x05,
  0x06, // mouse buttons
  0x08,
  0x09,
  0x0d,
  0x10,
  0x11,
  0x12,
  0x13,
  0x14,
  0x1b,
  ...range(0x20, 0x2f), // space, page/arrow keys, insert, delete
  ...range(0x30, 0x39),
  ...range(0x41, 0x5d), // letters, Windows keys, menu
  ...range(0x60, 0x87), // numpad, F1–F24
  0x90,
  0x91,
  ...range(0xa0, 0xa5), // left/right shift, ctrl, alt
  ...range(0xba, 0xc0),
  ...range(0xdb, 0xdf),
  0xe2,
]);

/**
 * Shift, Ctrl, Alt and the Windows keys. Held on their own they change nothing in any app, and they
 * are how every chord starts: the user's Ctrl, pressed a moment before Alt to speak the next
 * command, came up as "Aapko kaam hai?" (demo hand test, 2026-11-19). A shortcut still counts, by
 * its other key.
 */
const MODIFIERS = new Set<number>([0x10, 0x11, 0x12, 0x5b, 0x5c, ...range(0xa0, 0xa5)]);

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

export class WinUserInputWatch implements UserInputWatch {
  private readonly listeners = new Set<(touch: Touch) => void>();
  private timer: NodeJS.Timeout | null = null;
  private seen = Number.NEGATIVE_INFINITY;
  private lastUser = Number.NEGATIVE_INFINITY;
  private touch: { startedAt: number; lastAt: number } | null = null;
  private lastPressed = new Set<number>();
  private lastFront: number | undefined;
  private readonly lastInput: () => number;
  private readonly now: () => number;

  constructor(private readonly deps: TouchDeps) {
    this.lastInput = deps.lastInputAt ?? lastInputAt;
    this.now = deps.now ?? Date.now;
    this.lastFront = deps.foreground?.();
  }

  onTouch(cb: (touch: Touch) => void): () => void {
    this.listeners.add(cb);
    if (!this.timer && !this.deps.lastInputAt) {
      // What happened before the run is not a touch, and what was in front then is long gone.
      this.seen = this.lastInput();
      this.lastFront = this.deps.foreground?.();
      this.lastPressed = new Set(this.deps.pressed?.() ?? []);
      this.timer = setInterval(() => this.tick(), this.deps.pollMs ?? POLL_MS);
      this.timer.unref?.();
    }
    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  idleMs(): number {
    return this.now() - this.lastUser;
  }

  dictationActive(): boolean {
    return this.deps.dictationActive();
  }

  /**
   * Whether the input could upset the work: a button or key pressed since the last input (a key
   * already down, like a stuck media key, is not new), or the user switching windows. The mouse
   * merely moving does not count — the user, 2026-11-18: "mouse hilane se koi farq nahi padta;
   * Windows switch karun ya iske kaam mein dikkat doon, tab kehna chahiye".
   * ponytail: a click shorter than the poll that stays in the same window is missed; a low-level
   * hook would catch it, and is ruled out (journal 001).
   */
  private upsets(ownAt: number, frontChanged: boolean): boolean {
    if (!this.deps.pressed && !this.deps.foreground) return true;
    const pressed = new Set([...(this.deps.pressed?.() ?? [])].filter((vk) => HAND_KEYS.has(vk)));
    const fresh = [...pressed].some((vk) => !this.lastPressed.has(vk) && !MODIFIERS.has(vk));
    this.lastPressed = pressed;
    // A switch only together with input in the same poll, and not just after our own: a window our
    // action brought up seconds later used to stay "new" until the next stray input — a touchpad
    // twitch — which then read as the user switching windows (laptop demo, 2026-11-19).
    const switched = frontChanged && this.now() - ownAt > OWN_WINDOW_MS;
    return fresh || switched;
  }

  /** One poll. Exposed for tests; the interval calls it. */
  tick(): void {
    const at = this.lastInput();
    const chordAt = this.deps.chordChangedAt?.() ?? Number.NEGATIVE_INFINITY;
    // The window in front is followed every poll, input or not, so it is never stale.
    const front = this.deps.foreground?.();
    const frontChanged = front !== undefined && this.lastFront !== undefined && front !== this.lastFront;
    this.lastFront = front;
    if (at > this.seen) {
      this.seen = at;
      const injected = this.deps.injectedAt();
      const own =
        (at >= injected - OWN_BEFORE_MS && at <= injected + OWN_AFTER_MS) || (this.deps.own?.(at) ?? false);
      const ownAt = Math.max(injected, this.deps.ownEndedAt?.() ?? Number.NEGATIVE_INFINITY);
      const chord = this.deps.chordHeld() || Math.abs(at - chordAt) <= CHORD_MARGIN_MS;
      if (!own && !chord && !this.deps.dictationActive() && this.upsets(ownAt, frontChanged)) {
        this.lastUser = at;
        if (!this.touch || at - this.touch.lastAt > GAP_MS) this.touch = { startedAt: at, lastAt: at };
        else this.touch.lastAt = at;
      }
    }
    if (!this.touch) return;
    // Started just before the chord was recognised: it was the chord's first key.
    if (this.touch.startedAt >= chordAt - CHORD_MARGIN_MS && this.touch.startedAt <= chordAt) {
      this.touch = null;
      return;
    }
    if (this.now() - this.touch.lastAt > GAP_MS) {
      this.touch = null;
      return;
    }
    if (this.now() - this.touch.startedAt < CHORD_MARGIN_MS) return;
    const touch = { startedAt: this.touch.startedAt, heldMs: this.touch.lastAt - this.touch.startedAt };
    for (const listener of this.listeners) listener(touch);
  }
}
