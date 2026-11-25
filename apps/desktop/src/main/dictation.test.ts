import { afterEach, describe, expect, it, vi } from "vitest";
import type { PillState } from "../shared/ipc";
import { DictationController, type DictationEngine, type DictationRun } from "./dictation";
import type { MicSource } from "./mic";
import type { PillWindow } from "./pill";

const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
/** Longer than the double-tap window, so a lone tap has been judged an accident. */
const PAST_DOUBLE_TAP = 450;

function fakeRun(text: string) {
  const run: DictationRun & { finished: boolean; cancelled: boolean } = {
    finished: false,
    cancelled: false,
    push: () => {},
    finish: async () => {
      run.finished = true;
      return { text };
    },
    cancel: () => {
      run.cancelled = true;
    },
  };
  return run;
}

describe("DictationController", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps a tap's late cancel away from the press that followed it", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const states: PillState[] = [];
    const pill = { revive: () => {}, setState: (state: PillState) => states.push(state), level: () => {} };
    const mic: MicSource = { start: async () => {}, stop: async () => {} };
    const opens: ((run: DictationRun) => void)[] = [];
    const engine: DictationEngine = { open: () => new Promise((resolve) => opens.push(resolve)) };
    const controller = new DictationController(pill as unknown as PillWindow, mic, engine);
    const [first, second] = [fakeRun("tap"), fakeRun("hello")];

    controller.handleHotkey({ type: "pressed", mode: "style" });
    now = 100; // a tap: released before MIN_HOLD_MS, so cancelled — and its cancel waits on the open
    controller.handleHotkey({ type: "released", mode: "style" });
    await settle(PAST_DOUBLE_TAP);
    now = 200;
    controller.handleHotkey({ type: "pressed", mode: "style" });
    opens[1]?.(second);
    await settle();
    opens[0]?.(first); // the tap's stream opens last, and its cancel wakes up
    await settle();
    now = 2000;
    controller.handleHotkey({ type: "released", mode: "style" });
    await settle();

    expect(first.cancelled).toBe(true);
    expect(second.finished).toBe(true);
    // Typed: straight back to rest, no tick and no words (the Mac app, e079b6e).
    expect(states.at(-1)).toEqual({ kind: "idle" });
    // Not stuck: the next press opens a new stream.
    controller.handleHotkey({ type: "pressed", mode: "style" });
    expect(opens).toHaveLength(3);
  });

  it("does nothing on the lock screen, and drops a dictation the moment the Mac locks", async () => {
    const pill = { revive: () => {}, setState: () => {}, level: () => {} };
    const mic: MicSource = { start: async () => {}, stop: async () => {} };
    let opened = 0;
    const run = fakeRun("secret");
    const engine: DictationEngine = {
      open: async () => {
        opened++;
        return run;
      },
    };
    const controller = new DictationController(pill as unknown as PillWindow, mic, engine);

    controller.setLocked(true);
    controller.handleHotkey({ type: "pressed", mode: "style" });
    expect(opened).toBe(0);

    controller.setLocked(false);
    controller.handleHotkey({ type: "pressed", mode: "style" });
    await settle();
    controller.setLocked(true); // locked mid-sentence
    await settle();
    expect(run.cancelled).toBe(true);
    expect(run.finished).toBe(false);
  });

  it("never leaves processing when a release finds no stream", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const states: PillState[] = [];
    const pill = { revive: () => {}, setState: (state: PillState) => states.push(state), level: () => {} };
    const mic: MicSource = { start: async () => {}, stop: async () => {} };
    const engine: DictationEngine = { open: async () => fakeRun("x") };
    const controller = new DictationController(pill as unknown as PillWindow, mic, engine);
    controller.handleHotkey({ type: "pressed", mode: "exact" });
    await settle();
    // Something cleared the run behind the controller's back; the release must still end the run.
    (controller as unknown as { run: null }).run = null;
    now = 1000;
    controller.handleHotkey({ type: "released", mode: "exact" });
    await settle();
    expect(states.at(-1)).toEqual({ kind: "error", message: "Couldn't start listening. Try again." });
  });

  it("locks hands-free on a double tap and finishes on the next press", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const states: PillState[] = [];
    const live: boolean[] = [];
    const pill = { revive: () => {}, setState: (state: PillState) => states.push(state), level: () => {} };
    const mic: MicSource = { start: async () => {}, stop: async () => {} };
    const run = fakeRun("hands free");
    const engine: DictationEngine = { open: async () => run };
    const controller = new DictationController(pill as unknown as PillWindow, mic, engine, {
      listening: (on) => live.push(on),
    });

    controller.handleHotkey({ type: "pressed", mode: "exact" });
    now = 80;
    controller.handleHotkey({ type: "released", mode: "exact" });
    now = 200;
    controller.handleHotkey({ type: "pressed", mode: "exact" });
    now = 260;
    controller.handleHotkey({ type: "released", mode: "exact" });
    await settle(PAST_DOUBLE_TAP);
    // Still listening long after both taps: the second press locked it, nothing cancelled it.
    expect(run.cancelled).toBe(false);
    expect(states.at(-1)).toEqual({ kind: "listening", locked: true });
    // The app the words will go into, shown while listening (the Mac app's pill).
    controller.appIcon("data:image/png;base64,AA");
    expect(states.at(-1)).toEqual({ kind: "listening", locked: true, icon: "data:image/png;base64,AA" });

    now = 5000;
    controller.handleHotkey({ type: "pressed", mode: "exact" });
    await settle();
    expect(run.finished).toBe(true);
    expect(states.at(-1)).toEqual({ kind: "idle" });
    // Nothing heard is ever shown while listening (fbeacae).
    expect(states.some((state) => state.kind === "listening" && "text" in state)).toBe(false);
    expect(live).toEqual([true, false]);
  });

  it("cancels a hands-free dictation on Esc without typing it", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const live: boolean[] = [];
    const pill = { revive: () => {}, setState: () => {}, level: () => {} };
    const mic: MicSource = { start: async () => {}, stop: async () => {} };
    const run = fakeRun("never typed");
    const controller = new DictationController(
      pill as unknown as PillWindow,
      mic,
      { open: async () => run },
      { listening: (on) => live.push(on) },
    );
    controller.handleHotkey({ type: "pressed", mode: "exact" });
    now = 80;
    controller.handleHotkey({ type: "released", mode: "exact" });
    controller.handleHotkey({ type: "pressed", mode: "exact" });
    await settle();
    controller.handleHotkey({ type: "cancel" });
    await settle();
    expect(run.cancelled).toBe(true);
    expect(run.finished).toBe(false);
    expect(live).toEqual([true, false]);
  });

  it("drops a lone tap once the double-tap window has passed", async () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const pill = { revive: () => {}, setState: () => {}, level: () => {} };
    const mic: MicSource = { start: async () => {}, stop: async () => {} };
    const run = fakeRun("tap");
    const controller = new DictationController(pill as unknown as PillWindow, mic, { open: async () => run });
    controller.handleHotkey({ type: "pressed", mode: "exact" });
    await settle();
    now = 90;
    controller.handleHotkey({ type: "released", mode: "exact" });
    expect(run.cancelled).toBe(false); // not yet: it may be the first half of a double tap
    await settle(PAST_DOUBLE_TAP);
    expect(run.cancelled).toBe(true);
    expect(run.finished).toBe(false);
  });
});
