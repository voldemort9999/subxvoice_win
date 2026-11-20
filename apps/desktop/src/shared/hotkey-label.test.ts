import { describe, expect, it } from "vitest";
import { hotkeyLabel } from "./hotkey-label";

describe("showing a hotkey to the user", () => {
  it("formats any combination, not just the suggested ones", () => {
    expect(hotkeyLabel("ctrl+win")).toBe("Ctrl + Win");
    expect(hotkeyLabel("ctrl+shift+f9")).toBe("Ctrl + Shift + F9");
    expect(hotkeyLabel("alt+k")).toBe("Alt + K");
    expect(hotkeyLabel("ctrl+pageup")).toBe("Ctrl + Page Up");
  });

  // The names the Windows recorder now produces (platform-win hotkey.ts bindingFor).
  it("names one-sided modifiers, punctuation and numpad keys the way the keyboard shows them", () => {
    expect(hotkeyLabel("rctrl")).toBe("Right Ctrl");
    expect(hotkeyLabel("ralt")).toBe("Right Alt");
    expect(hotkeyLabel("ctrl+semicolon")).toBe("Ctrl + ;");
    expect(hotkeyLabel("alt+numpad7")).toBe("Alt + Numpad 7");
    expect(hotkeyLabel("ctrl+menu")).toBe("Ctrl + Menu");
    expect(hotkeyLabel("scrolllock")).toBe("Scroll Lock");
    expect(hotkeyLabel("vk255")).toBe("Key 255");
  });

  it("keeps the names macOS keys are known by", () => {
    expect(hotkeyLabel("fn")).toBe("fn 🌐");
    expect(hotkeyLabel("right_option")).toBe("right ⌥ Option");
  });

  it("has something to say before the hotkey is known", () => {
    expect(hotkeyLabel(undefined)).toBe("the hotkey");
  });
});
