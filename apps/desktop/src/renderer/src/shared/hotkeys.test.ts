import { describe, expect, it } from "vitest";
import { hotkeyLabel } from "./format";
import { type Chord, comboFrom, keyName } from "./hotkeys";

const chord = (partial: Partial<Chord>): Chord => ({
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  code: "",
  ...partial,
});

describe("naming the key that was pressed", () => {
  it("reads letters, digits and function keys off the physical code", () => {
    expect(keyName("KeyK")).toBe("k");
    expect(keyName("Digit7")).toBe("7");
    expect(keyName("F9")).toBe("f9");
    expect(keyName("F24")).toBe("f24");
    expect(keyName("Space")).toBe("space");
    expect(keyName("ArrowLeft")).toBe("left");
  });

  it("ignores the modifiers, which the event flags already cover", () => {
    expect(keyName("ControlLeft")).toBeNull();
    expect(keyName("MetaRight")).toBeNull();
    expect(keyName("ShiftLeft")).toBeNull();
  });

  it("returns nothing for keys the watcher has no name for", () => {
    expect(keyName("F25")).toBeNull();
    expect(keyName("IntlBackslash")).toBeNull();
  });
});

describe("recording a chord", () => {
  it("builds the binding the hotkey watcher parses", () => {
    expect(comboFrom(chord({ ctrlKey: true, metaKey: true, code: "MetaLeft" }))).toBe("ctrl+win");
    expect(comboFrom(chord({ ctrlKey: true, shiftKey: true, code: "KeyK" }))).toBe("ctrl+shift+k");
    expect(comboFrom(chord({ altKey: true, code: "F9" }))).toBe("alt+f9");
  });

  it("spells the same chord the same way whichever key landed last", () => {
    const first = comboFrom(chord({ ctrlKey: true, altKey: true, shiftKey: true, code: "AltLeft" }));
    const second = comboFrom(chord({ ctrlKey: true, altKey: true, shiftKey: true, code: "ShiftLeft" }));
    expect(first).toBe("ctrl+shift+alt");
    expect(second).toBe(first);
  });

  it("refuses a single key, which would fire while typing", () => {
    expect(comboFrom(chord({ ctrlKey: true, code: "ControlLeft" }))).toBeNull();
    expect(comboFrom(chord({ code: "KeyK" }))).toBeNull();
    expect(comboFrom(chord({ code: "" }))).toBeNull();
  });
});

describe("showing a hotkey to the user", () => {
  it("formats any combination, not just the suggested ones", () => {
    expect(hotkeyLabel("ctrl+win")).toBe("Ctrl + Win");
    expect(hotkeyLabel("ctrl+shift+f9")).toBe("Ctrl + Shift + F9");
    expect(hotkeyLabel("alt+k")).toBe("Alt + K");
    expect(hotkeyLabel("ctrl+pageup")).toBe("Ctrl + Page Up");
  });

  it("has something to say before the hotkey is known", () => {
    expect(hotkeyLabel(undefined)).toBe("the hotkey");
  });
});
