import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { clipboardHas, writePrivateClipboardText } from "./win32";

/**
 * The dictation's trip through the clipboard, on this machine: opt-in with LIVE=1 (it replaces what
 * is on the clipboard). The text must read back as written, with the formats that keep it out of
 * Windows' clipboard history and cloud clipboard.
 */
const live = process.env.LIVE === "1" && process.platform === "win32";

describe.skipIf(!live)("private clipboard text (live)", () => {
  it("puts the text on the clipboard, kept out of history and the cloud clipboard", () => {
    const text = "SUBXVoice live test — हिंदी and Hinglish";
    expect(writePrivateClipboardText(text)).toBe(true);
    const back = execFileSync(
      "powershell",
      ["-NoProfile", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw"],
      {
        encoding: "utf8",
      },
    ).replace(/\r?\n$/, "");
    expect(back).toBe(text);
    expect(clipboardHas("ExcludeClipboardContentFromMonitorProcessing")).toBe(true);
    expect(clipboardHas("CanIncludeInClipboardHistory")).toBe(true);
    expect(clipboardHas("CanUploadToCloudClipboard")).toBe(true);
  });
});
