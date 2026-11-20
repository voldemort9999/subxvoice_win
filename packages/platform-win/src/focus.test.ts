import { describe, expect, it } from "vitest";
import { type FocusInfo, takesText } from "./focus";

const focus = (info: Partial<FocusInfo>): FocusInfo => ({
  controlType: 50033,
  className: "",
  framework: "Win32",
  value: false,
  readOnly: false,
  password: false,
  ...info,
});

describe("takesText: paste, or offer Copy in the pill", () => {
  it("takes a text box, a password box and a writable value", () => {
    expect(takesText(focus({ controlType: 50004 }))).toBe(true);
    expect(takesText(focus({ password: true }))).toBe(true);
    expect(takesText(focus({ value: true }))).toBe(true);
    // Claude Code's chat input in VS Code, as Windows reports it (2026-11-21).
    expect(
      takesText(
        focus({ controlType: 50004, className: "messageInput_cKsPxg", framework: "Chrome", value: true }),
      ),
    ).toBe(true);
  });

  // Read from this PC, 2026-11-21: the taskbar search box, and VS Code's chat history.
  it("takes Windows Search's box, and refuses VS Code's conversation area", () => {
    expect(
      takesText(focus({ controlType: 50004, className: "RichEditBox", framework: "XAML", value: true })),
    ).toBe(true);
    expect(
      takesText(
        focus({
          controlType: 50026,
          className: "messagesContainer_07S1Yg",
          framework: "Chrome",
          readOnly: true,
        }),
      ),
    ).toBe(false);
  });

  it("says no for nothing focused, the desktop, and controls that never take text", () => {
    expect(takesText(null)).toBe(false);
    expect(takesText(focus({ className: "Progman" }))).toBe(false);
    expect(takesText(focus({ controlType: 50000 }))).toBe(false); // a button
    expect(takesText(focus({ controlType: 50007 }))).toBe(false); // a file in a list
    expect(takesText(focus({ value: true, readOnly: true }))).toBe(false);
  });

  // User, 2026-11-21: in VS Code, outside a text box, the words were pasted nowhere and no Copy came.
  it("trusts Chromium: anything there that is neither an Edit nor a writable value takes no text", () => {
    expect(takesText(focus({ framework: "Chrome", controlType: 50026 }))).toBe(false); // a group: chat history
    expect(takesText(focus({ framework: "Chrome", controlType: 50030 }))).toBe(false); // a page's document
  });

  it("stays unsure where a terminal or an editor may take text, or Chromium has not built its tree", () => {
    expect(takesText(focus({ controlType: 50033 }))).toBeNull(); // a Win32 pane
    expect(takesText(focus({ controlType: 50030 }))).toBeNull(); // Notepad's document
    expect(
      takesText(focus({ framework: "Chrome", controlType: 50033, className: "Chrome_RenderWidgetHostHWND" })),
    ).toBeNull();
  });
});
