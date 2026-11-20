import { describe, expect, it } from "vitest";
import { type InputEvent, type Native, parseCombo, typeEvents, WinScreenInput } from "./input";

describe("parseCombo", () => {
  it("reads modifiers and a letter", () => {
    expect(parseCombo("ctrl+shift+t")).toEqual([0x11, 0x10, 0x54]);
  });

  it("reads the toolset's key names", () => {
    expect(parseCombo("Return")).toEqual([0x0d]);
    expect(parseCombo("super")).toEqual([0x5b]);
    expect(parseCombo("Page_Down")).toEqual([0x22]);
    expect(parseCombo("alt+F4")).toEqual([0x12, 0x73]);
    expect(parseCombo("ctrl+minus")).toEqual([0x11, 0xbd]);
  });

  it("accepts Windows spellings, any case, spaces around +", () => {
    expect(parseCombo("Win + E")).toEqual([0x5b, 0x45]);
    expect(parseCombo("ENTER")).toEqual([0x0d]);
    expect(parseCombo("ctrl+pgdn")).toEqual([0x11, 0x22]);
    expect(parseCombo("cmd+5")).toEqual([0x5b, 0x35]);
  });

  it("names the key it does not know", () => {
    expect(() => parseCombo("ctrl+frobnicate")).toThrow(/"frobnicate"/);
    expect(() => parseCombo("")).toThrow(/key/);
  });
});

describe("typeEvents", () => {
  const unicode = (code: number, up: boolean): InputEvent => ({
    kind: "key",
    vk: 0,
    scan: code,
    flags: up ? 6 : 4,
  });

  it("types Unicode code units, Devanagari and emoji included", () => {
    expect(typeEvents("aब😀")).toEqual([
      unicode(0x61, false),
      unicode(0x61, true),
      unicode(0x092c, false),
      unicode(0x092c, true),
      unicode(0xd83d, false),
      unicode(0xd83d, true),
      unicode(0xde00, false),
      unicode(0xde00, true),
    ]);
  });

  it("presses Return for a line break and Tab for a tab", () => {
    const events = typeEvents("a\r\nb\tc");
    const vks = events
      .filter((e) => e.kind === "key" && e.vk !== 0)
      .map((e) => (e.kind === "key" ? e.vk : 0));
    expect(vks).toEqual([0x0d, 0x0d, 0x09, 0x09]);
    expect(events).toHaveLength(10);
  });
});

/** Records what reached "Windows", one readable line per operation. */
function fake(cursor: [number, number] = [0, 0]) {
  const log: string[] = [];
  let modifiersHeld = false;
  let failures = 0;
  const batches: InputEvent[][] = [];
  const native: Native = {
    send(events) {
      if (failures > 0) {
        failures--;
        throw new Error("SendInput blocked");
      }
      batches.push(events);
      for (const e of events) {
        if (e.kind === "mouse") log.push(`mouse ${e.flags.toString(16)}${e.data ? ` ${e.data}` : ""}`);
        else if (e.vk)
          log.push(`key ${e.vk.toString(16)} ${e.flags & 2 ? "up" : "down"}${e.flags & 1 ? " ext" : ""}`);
        else log.push(`char ${String.fromCharCode(e.scan)} ${e.flags & 2 ? "up" : "down"}`);
      }
    },
    setCursor(x, y) {
      cursor = [x, y];
      log.push(`cursor ${x},${y}`);
    },
    getCursor: () => cursor,
    scanCode: () => 0,
    modifiersUp: async () => !modifiersHeld,
  };
  // Screenshot pixels are half the physical ones, on a display at x = 1000.
  const capture = {
    toPhysical: (x: number, y: number): [number, number] => [1000 + x * 2, y * 2],
    toShot: (x: number, y: number): [number, number] => [(x - 1000) / 2, y / 2],
  };
  const input = new WinScreenInput(capture, native);
  return {
    log,
    input,
    batches,
    holdModifiers: () => (modifiersHeld = true),
    failNextSend: () => failures++,
  };
}

describe("WinScreenInput", () => {
  it("double-clicks at the mapped point with a modifier held", async () => {
    const { log, input } = fake();
    await input.click(100, 50, { count: 2, modifiers: ["ctrl"] });
    expect(log).toEqual([
      "cursor 1200,100",
      "key 11 down",
      "mouse 2",
      "mouse 4",
      "mouse 2",
      "mouse 4",
      "key 11 up",
    ]);
    expect(input.lastInjectedAt()).toBeGreaterThan(0);
  });

  it("right- and middle-clicks", async () => {
    const { log, input } = fake();
    await input.click(0, 0, { button: "right" });
    await input.click(0, 0, { button: "middle" });
    expect(log.filter((l) => l.startsWith("mouse"))).toEqual(["mouse 8", "mouse 10", "mouse 20", "mouse 40"]);
  });

  it("scrolls one notch per amount, vertical and horizontal", async () => {
    const { log, input } = fake();
    await input.scroll([10, 10], "down", 3);
    await input.scroll(null, "left", 1, ["shift"]);
    expect(log).toEqual([
      "cursor 1020,20",
      "mouse 800 -120",
      "mouse 800 -120",
      "mouse 800 -120",
      "key 10 down",
      "mouse 1000 -120",
      "key 10 up",
    ]);
  });

  it("presses a combo in order and lets go in reverse; arrows are extended keys", async () => {
    const { log, input } = fake();
    await input.key("ctrl+shift+t");
    await input.key("Left", 2);
    expect(log).toEqual([
      "key 11 down",
      "key 10 down",
      "key 54 down",
      "key 54 up",
      "key 10 up",
      "key 11 up",
      "key 25 down ext",
      "key 25 up ext",
      "key 25 down ext",
      "key 25 up ext",
    ]);
  });

  it("drags with the button held across the moves", async () => {
    const { log, input } = fake();
    await input.drag([0, 0], [100, 0]);
    expect(log[0]).toBe("cursor 1000,0");
    expect(log[1]).toBe("mouse 2");
    expect(log.at(-2)).toBe("cursor 1200,0");
    expect(log.at(-1)).toBe("mouse 4");
    expect(log.filter((l) => l.startsWith("cursor")).length).toBeGreaterThan(5);
  });

  it("releases a held key when the hold is aborted", async () => {
    const { log, input } = fake();
    const abort = new AbortController();
    const held = input.holdKey("shift", 30, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(log).toEqual(["key 10 down"]);
    abort.abort();
    await held;
    expect(log).toEqual(["key 10 down", "key 10 up"]);
  });

  it("releaseAll lets go of only what it pressed", async () => {
    const { log, input } = fake();
    await input.mouseDown();
    await input.releaseAll();
    await input.releaseAll();
    expect(log).toEqual(["mouse 2", "mouse 4"]);
  });

  it("releaseAll still lets go of the rest when one release fails (review C1)", async () => {
    const { log, input, failNextSend } = fake();
    await input.mouseDown();
    const abort = new AbortController();
    const held = input.holdKey("shift", 30, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    failNextSend();
    await input.releaseAll();
    expect(log).toEqual(["mouse 2", "key 10 down", "key 10 up"]);
    abort.abort();
    await held;
  });

  it("never splits an emoji across two typing batches", async () => {
    const { input, batches } = fake();
    await input.type(`${"a".repeat(39)}😀b`);
    for (const batch of batches) {
      const last = batch.at(-1);
      const code = last?.kind === "key" ? last.scan : 0;
      // A batch may end on a key-up; the up of a high surrogate must be followed by its pair.
      expect(code >= 0xd800 && code <= 0xdbff).toBe(false);
    }
  });

  it("does not hold the key when the abort came while waiting for the user's modifiers", async () => {
    const { log, input } = fake();
    const abort = new AbortController();
    abort.abort();
    await input.holdKey("shift", 30, abort.signal);
    expect(log).toEqual([]);
  });

  it("reports the cursor in screenshot coordinates", async () => {
    const { input } = fake([1200, 100]);
    expect(await input.cursor()).toEqual([100, 50]);
  });

  it("refuses to type while the user still holds a modifier", async () => {
    const { input, holdModifiers, log } = fake();
    holdModifiers();
    await expect(input.type("hi")).rejects.toThrow(/held/);
    expect(log).toEqual([]);
  });
});
