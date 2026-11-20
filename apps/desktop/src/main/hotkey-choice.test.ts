import { describe, expect, it } from "vitest";
import { hotkeyRefusal } from "./hotkey-choice";

const accepts = (keys: string) => keys !== "a" && keys !== "lctrl";

describe("hotkeyRefusal", () => {
  it("takes a chord this PC can watch", () => {
    expect(hotkeyRefusal("ctrl+win", accepts)).toBeNull();
    expect(hotkeyRefusal("ctrl+alt", accepts)).toBeNull();
    expect(hotkeyRefusal("f9", accepts)).toBeNull();
  });

  it("explains a single key that typing presses", () => {
    expect(hotkeyRefusal("a", accepts)).toMatch(/while you type/);
    expect(hotkeyRefusal("lctrl", accepts)).toMatch(/F1–F24/);
  });
});
