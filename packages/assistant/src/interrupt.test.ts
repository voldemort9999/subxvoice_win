import type { Touch, UserInputWatch } from "@subx/core";
import { describe, expect, it } from "vitest";
import { createInterrupts } from "./interrupt";
import { say } from "./lang";

/** A watch and a clock the test drives by hand. */
function setup(reply: () => unknown = () => "Continue") {
  let now = 0;
  let lastInput = Number.NEGATIVE_INFINITY;
  let dictating = false;
  let listener: ((t: Touch) => void) | null = null;
  const watch: UserInputWatch = {
    onTouch: (cb) => {
      listener = cb;
      return () => {
        listener = null;
      };
    },
    idleMs: () => now - lastInput,
    dictationActive: () => dictating,
  };
  const asked: string[] = [];
  let paused = 0;
  const interrupts = createInterrupts({
    watch,
    ask: async (question) => {
      asked.push(question);
      return reply();
    },
    onPaused: () => paused++,
    now: () => now,
    // Each wait moves the clock, and ends a dictation that has been going for a second.
    sleep: async (ms) => {
      now += ms;
      if (dictating && now >= 1000) dictating = false;
    },
  });
  const touch = (startedAt: number, heldMs: number) => {
    lastInput = startedAt + heldMs;
    now = Math.max(now, lastInput);
    listener?.({ startedAt, heldMs });
  };
  return {
    interrupts,
    touch,
    asked,
    paused: () => paused,
    at: () => now,
    dictate: () => {
      dictating = true;
    },
  };
}

describe("an instruction spoken instead of answering 'Aapko kaam hai?' (demo hand test, 2026-11-19)", () => {
  const asked = (answer: string) => {
    const steered: string[] = [];
    let now = 0;
    let listener: ((t: Touch) => void) | null = null;
    const interrupts = createInterrupts({
      watch: {
        onTouch: (cb) => {
          listener = cb;
          return () => {};
        },
        idleMs: () => 10_000,
        dictationActive: () => false,
      },
      ask: async () => answer,
      onPaused: () => {},
      steer: (text) => steered.push(text),
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    // TypeScript cannot see the assignment inside onTouch, so it narrows `listener` to null.
    (listener as ((t: Touch) => void) | null)?.({ startedAt: 0, heldMs: 3000 });
    return { interrupts, steered };
  };

  it("carries the words to the model and goes on, instead of dropping them", async () => {
    const said = "एक ईमेल कंपोज करो मेरे बैच मैनेजर को, क्योंकि मैं कल अब्सेंट रहूँगा कॉलेज में।";
    const s = asked(said);
    expect(await s.interrupts.beforeScreenAction()).toBe("go");
    expect(s.steered).toEqual([said]);
  });

  it("still hears a short spoken 'later', in either script", async () => {
    for (const later of ["baad mein", "बाद में"]) {
      const s = asked(later);
      expect(await s.interrupts.beforeScreenAction(), later).toBe("park");
      expect(s.steered).toEqual([]);
    }
  });
});

describe("user touches while the assistant works", () => {
  it("runs at once when nobody touched anything", async () => {
    const s = setup();
    expect(await s.interrupts.beforeScreenAction()).toBe("go");
    expect(s.at()).toBe(0);
  });

  it("holds the next screen action after a short first touch until 1.5 s of quiet", async () => {
    const s = setup();
    s.touch(100, 300); // ends at 400
    expect(await s.interrupts.beforeScreenAction()).toBe("go");
    expect(s.at()).toBeGreaterThanOrEqual(1900);
    expect(s.asked).toEqual([]);
  });

  it("asks after a second touch", async () => {
    const s = setup();
    s.touch(100, 200);
    s.touch(5000, 200);
    expect(await s.interrupts.beforeScreenAction()).toBe("go");
    expect(s.asked).toEqual([say().touchQuestion]);
    expect(s.paused()).toBe(1);
  });

  it("asks after one touch of two seconds or more", async () => {
    const s = setup();
    s.touch(100, 2000);
    await s.interrupts.beforeScreenAction();
    expect(s.asked).toEqual([say().touchQuestion]);
  });

  it("parks the work on 'baad mein'", async () => {
    const s = setup(() => "Baad mein");
    s.touch(100, 2500);
    expect(await s.interrupts.beforeScreenAction()).toBe("park");
  });

  it("parks when the question goes unanswered", async () => {
    const s = setup(() => undefined);
    s.touch(100, 2500);
    expect(await s.interrupts.beforeScreenAction()).toBe("park");
  });

  it("does not count the click that answered a question as a new touch", async () => {
    const s = setup();
    s.interrupts.answered(); // e.g. Allow pressed on the capsule
    s.touch(100, 150);
    s.touch(900, 150);
    expect(await s.interrupts.beforeScreenAction()).toBe("go");
    expect(s.asked).toEqual([]);
  });

  it("starts counting afresh after the user says continue", async () => {
    const s = setup();
    s.touch(100, 2500);
    await s.interrupts.beforeScreenAction();
    s.touch(9000, 200);
    await s.interrupts.beforeScreenAction();
    expect(s.asked).toHaveLength(1);
  });

  it("waits out a dictation, then has the screen read again", async () => {
    const s = setup();
    s.dictate();
    expect(await s.interrupts.beforeScreenAction()).toBe("reobserve");
    expect(s.at()).toBeGreaterThanOrEqual(1000);
  });
});
