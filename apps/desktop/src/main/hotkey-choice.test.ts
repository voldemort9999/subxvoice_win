import { describe, expect, it } from "vitest";
import { hotkeyRefusal } from "./hotkey-choice";

const accepts = (keys: string) => keys !== "a" && keys !== "lctrl";

describe("hotkeyRefusal", () => {
  it("takes a chord this PC can watch", () => {
    expect(hotkeyRefusal("ctrl+win", accepts, "ctrl+alt")).toBeNull();
    expect(hotkeyRefusal("f9", accepts, "ctrl+alt")).toBeNull();
  });

  it("explains a single key that typing presses", () => {
    expect(hotkeyRefusal("a", accepts, "ctrl+alt")).toMatch(/while you type/);
    expect(hotkeyRefusal("lctrl", accepts, "ctrl+alt")).toMatch(/F1–F24/);
  });

  it("keeps Follow My Words' keys for Follow My Words", () => {
    expect(hotkeyRefusal("ctrl+alt", () => true, "ctrl+alt")).toMatch(/Follow My Words/);
  });
});
