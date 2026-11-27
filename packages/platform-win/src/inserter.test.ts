import { beforeEach, describe, expect, it, vi } from "vitest";

const written: string[] = [];
const chords: number[][] = [];
vi.mock("electron", () => ({ clipboard: { writeText: async (text: string) => void written.push(text) } }));
vi.mock("./clipboard", () => ({ snapshotClipboard: async () => null, restoreClipboardLater: () => {} }));
vi.mock("./win32", () => ({
  VK: { control: 0x11, v: 0x56, y: 0x59, z: 0x5a },
  waitForModifiersUp: async () => true,
  sendChord: (modifiers: number[], vk: number) => {
    chords.push([...modifiers, vk]);
    return true;
  },
}));

const { WinInserter } = await import("./inserter");

// User, 2026-11-21: with no text box selected, offer Copy in the pill instead of pasting nowhere —
// only then, never when the words did land.
describe("WinInserter: pasting only where text can go", () => {
  beforeEach(() => {
    written.length = 0;
    chords.length = 0;
  });

  it("pastes when the focus takes text", async () => {
    const inserter = new WinInserter({ focusTakesText: async () => true });
    expect(await inserter.insert("hello")).toBe("pasted");
    expect(written).toEqual(["hello"]);
    expect(chords).toEqual([[0x11, 0x56]]);
  });

  it("touches nothing and says nowhere when the focus clearly takes no text", async () => {
    const inserter = new WinInserter({ focusTakesText: async () => false });
    expect(await inserter.insert("hello")).toBe("nowhere");
    expect(written).toEqual([]);
    expect(chords).toEqual([]);
  });

  it("pastes as always when it cannot tell, or the check is slow or fails", async () => {
    for (const focusTakesText of [
      async () => null,
      () => new Promise<boolean | null>((resolve) => setTimeout(() => resolve(false), 2000)),
      async (): Promise<boolean | null> => {
        throw new Error("PowerShell gone");
      },
    ]) {
      chords.length = 0;
      const inserter = new WinInserter({ focusTakesText, checkMs: 50 });
      expect(await inserter.insert("hello")).toBe("pasted");
      expect(chords).toEqual([[0x11, 0x56]]);
    }
  });

  // User, 2026-11-21: "checking ka bhi ache se daalna ki check kar sake ki hua hai ya nahi" — and
  // Copy must come wherever the words did not land, not only where the focus looked wrong.
  it("checks after pasting that the words landed, and offers Copy when they did not", async () => {
    const landed = new WinInserter({
      focusTakesText: async () => null,
      readField: async () => "Hi, hello there",
      verifyMs: 300,
    });
    expect(await landed.insert("hello")).toBe("pasted");

    const lost = new WinInserter({
      focusTakesText: async () => null,
      readField: async () => "",
      verifyMs: 300,
    });
    expect(await lost.insert("hello")).toBe("nowhere");
  });

  it("trusts the paste where the box cannot be read back", async () => {
    const inserter = new WinInserter({
      focusTakesText: async () => null,
      readField: async () => null,
      verifyMs: 300,
    });
    expect(await inserter.insert("hello")).toBe("pasted");
  });

  it("finds the words even when the box wraps them differently", async () => {
    let reads = 0;
    const inserter = new WinInserter({
      focusTakesText: async () => true,
      readField: async () => (++reads < 3 ? "" : "Line one\r\nline   two"),
      verifyMs: 1000,
    });
    expect(await inserter.insert("Line one line two")).toBe("pasted");
  });

  it("warms the check at key-down, so key-up does not wait for it to start", () => {
    const warm = vi.fn();
    new WinInserter({ focusTakesText: async () => true, warm }).prepare();
    expect(warm).toHaveBeenCalledOnce();
  });
});

// A snippet chosen on the pill after the words went in as said (Mac c8eec41): swapped only where the
// undo took back exactly the paste; anywhere else nothing changes and the caller copies it instead.
describe("WinInserter.replaceLast", () => {
  beforeEach(() => {
    written.length = 0;
    chords.length = 0;
  });

  function withCaret(places: (number | null)[]) {
    const inserter = new WinInserter({
      focusTakesText: async () => true,
      caret: async () => places.shift() ?? null,
      undoMs: 0,
    });
    return inserter;
  }

  it("takes the paste back and puts the snippet in its place", async () => {
    const inserter = withCaret([20, 10]);
    await inserter.insert("my email.!");
    chords.length = 0;
    expect(await inserter.replaceLast("me@example.com")).toBe(true);
    expect(chords).toEqual([
      [0x11, 0x5a],
      [0x11, 0x56],
    ]);
    expect(written.at(-1)).toBe("me@example.com");
  });

  it("changes nothing where the cursor cannot be read", async () => {
    const inserter = withCaret([null]);
    await inserter.insert("my email");
    chords.length = 0;
    expect(await inserter.replaceLast("x")).toBe(false);
    expect(chords).toEqual([]);
  });

  it("puts back what the undo took when it took more than the paste", async () => {
    const inserter = withCaret([20, 5]);
    await inserter.insert("my email.!");
    chords.length = 0;
    expect(await inserter.replaceLast("x")).toBe(false);
    expect(chords).toEqual([
      [0x11, 0x5a],
      [0x11, 0x59],
    ]);
  });

  it("leaves it where the undo did nothing (a terminal)", async () => {
    const inserter = withCaret([20, 20]);
    await inserter.insert("my email.!");
    chords.length = 0;
    expect(await inserter.replaceLast("x")).toBe(false);
    expect(chords).toEqual([[0x11, 0x5a]]);
  });
});
