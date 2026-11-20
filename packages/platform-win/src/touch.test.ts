import type { Touch } from "@subx/core";
import { describe, expect, it } from "vitest";
import { WinUserInputWatch } from "./touch";

/** Windows' "last input" clock and the app's own signals, driven by the test. */
function setup() {
  let now = 10_000;
  let lastInput = 0;
  let injected = 0;
  let chord = false;
  let chordAt = 0;
  let dictating = false;
  const watch = new WinUserInputWatch({
    lastInputAt: () => lastInput,
    injectedAt: () => injected,
    chordHeld: () => chord,
    chordChangedAt: () => chordAt,
    dictationActive: () => dictating,
    now: () => now,
  });
  const seen: Touch[] = [];
  watch.onTouch((t) => seen.push(t));
  return {
    watch,
    seen,
    /** The user (or anyone) produced input at the current time, then a poll ran. */
    input(at = now) {
      lastInput = at;
      watch.tick();
    },
    later(ms: number) {
      now += ms;
    },
    inject() {
      injected = now;
    },
    chord(on: boolean) {
      chord = on;
      chordAt = now;
    },
    dictate(on: boolean) {
      dictating = on;
    },
  };
}

describe("WinUserInputWatch — only input that can upset the work counts (user, 2026-11-18)", () => {
  /** Windows' clock plus what is pressed and which window is in front. */
  function hands(own: (at: number) => boolean = () => false) {
    let now = 10_000;
    let lastInput = 0;
    let pressed = new Set<number>();
    let front = 1;
    const watch = new WinUserInputWatch({
      lastInputAt: () => lastInput,
      injectedAt: () => 0,
      own,
      chordHeld: () => false,
      dictationActive: () => false,
      pressed: () => pressed,
      foreground: () => front,
      now: () => now,
    });
    const seen: Touch[] = [];
    watch.onTouch((t) => seen.push(t));
    return {
      seen,
      watch,
      now: () => now,
      input(opts: { press?: number[]; front?: number } = {}) {
        pressed = new Set(opts.press ?? []);
        if (opts.front) front = opts.front;
        lastInput = now;
        watch.tick();
        now += 400;
        watch.tick();
      },
      /** Time passes with no input at all — a window may still come to the front on its own. */
      idle(opts: { front?: number } = {}) {
        if (opts.front) front = opts.front;
        now += 3000;
        watch.tick();
      },
    };
  }

  it("does not take a window our own action brought forward for a switch when the touchpad later twitches (laptop demo, 2026-11-19)", () => {
    const h = hands();
    h.idle({ front: 2 }); // WhatsApp / a YouTube tab came forward from our action, no input
    h.input(); // a twitch of the touchpad seconds later
    h.input();
    expect(h.seen).toEqual([]);
  });

  it("never counts keys no hand pressed: gamepad, IME, typed-character and media codes", () => {
    for (const vk of [0xe7, 0xe5, 0xc3, 0xda, 0xb3, 0xff]) {
      const h = hands();
      h.input({ press: [vk] });
      expect(h.seen, `vk 0x${vk.toString(16)}`).toEqual([]);
    }
  });

  it("ignores input the app itself sent outside the screen executor (a paste, a UIA click)", () => {
    let from = Number.POSITIVE_INFINITY;
    const h = hands((at) => at >= from);
    from = h.now();
    h.input({ press: [0x11, 0x56] }); // Ctrl+V from WhatsApp's own typing
    h.input({ press: [0x01] }); // the UIA click into the message box
    expect(h.seen).toEqual([]);
  });

  it("ignores the mouse merely moving", () => {
    const h = hands();
    h.input();
    h.input();
    expect(h.seen).toEqual([]);
    expect(h.watch.idleMs()).toBe(Number.POSITIVE_INFINITY);
  });

  it("counts a click, a key, or a switch to another window", () => {
    const click = hands();
    click.input({ press: [0x01] });
    expect(click.seen.length).toBeGreaterThan(0);
    const key = hands();
    key.input({ press: [0x41] });
    expect(key.seen.length).toBeGreaterThan(0);
    const alttab = hands();
    alttab.input({ front: 2 });
    expect(alttab.seen.length).toBeGreaterThan(0);
  });

  // Demo hand test, 2026-11-19 17:19: "Aapko kaam hai?" came up as the user started the next
  // Ctrl+Alt — Ctrl went down well before Alt, past the chord margin, and counted as a touch.
  it("never counts a modifier pressed on its own: it changes nothing in any app", () => {
    for (const vk of [0x10, 0x11, 0x12, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0x5b, 0x5c]) {
      const h = hands();
      h.input({ press: [vk] });
      expect(h.seen, `vk 0x${vk.toString(16)}`).toEqual([]);
    }
  });

  it("still counts a shortcut the user types, by its non-modifier key", () => {
    const h = hands();
    h.input({ press: [0xa2] }); // Ctrl
    h.input({ press: [0xa2, 0x43] }); // Ctrl+C
    expect(h.seen.length).toBeGreaterThan(0);
  });

  it("does not count a key that was already down", () => {
    const h = hands();
    h.input({ press: [0x41] }); // first seen: one touch
    h.input({ press: [0x41] }); // still down while the mouse moves: neither new nor longer
    expect(new Set(h.seen.map((t) => t.startedAt)).size).toBe(1);
    expect(h.seen.every((t) => t.heldMs === 0)).toBe(true);
  });
});

describe("WinUserInputWatch", () => {
  it("reports a touch while the user keeps using the mouse, and how long it has lasted", () => {
    const s = setup();
    s.input();
    s.later(300);
    s.input();
    expect(s.seen.at(-1)).toEqual({ startedAt: 10_000, heldMs: 300 });
    expect(s.watch.idleMs()).toBe(0);
  });

  it("starts a new touch after a gap", () => {
    const s = setup();
    s.input();
    s.later(2000);
    s.input();
    // A new touch is told only once it is old enough not to be the hotkey's first key.
    s.later(300);
    s.watch.tick();
    expect(s.seen.at(-1)).toEqual({ startedAt: 12_000, heldMs: 0 });
  });

  it("does not count the hotkey's first key, pressed before the chord is recognised (review I8)", () => {
    const s = setup();
    s.input(); // Ctrl goes down at 10 000; Alt follows
    s.later(120);
    s.chord(true); // the hotkey poll recognises Ctrl+Alt at 10 120
    s.input();
    s.later(500);
    s.watch.tick();
    expect(s.seen).toEqual([]);
  });

  it("does not count the hotkey's release, polled after the chord was let go (review I8)", () => {
    const s = setup();
    s.chord(true);
    s.input();
    s.later(2000);
    s.chord(false); // released at 12 000
    s.later(40);
    s.input(); // the last key-up, seen by the touch poll after the hotkey had cleared
    s.later(500);
    s.watch.tick();
    expect(s.seen).toEqual([]);
  });

  it("ignores input the executor injected", () => {
    const s = setup();
    s.inject();
    s.later(50);
    s.input();
    expect(s.seen).toEqual([]);
    expect(s.watch.idleMs()).toBe(Number.POSITIVE_INFINITY);
  });

  it("ignores the app's own hotkey and a dictation landing", () => {
    const s = setup();
    s.chord(true);
    s.input();
    s.chord(false);
    s.dictate(true);
    s.later(500);
    s.input();
    expect(s.seen).toEqual([]);
    expect(s.watch.dictationActive()).toBe(true);
  });

  it("goes quiet once the user stops", () => {
    const s = setup();
    s.input();
    s.later(1000);
    s.watch.tick();
    const count = s.seen.length;
    s.later(100);
    s.watch.tick();
    expect(s.seen.length).toBe(count);
    expect(s.watch.idleMs()).toBe(1100);
  });
});
