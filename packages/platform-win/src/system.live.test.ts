import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WinSystem } from "./system";

/**
 * The output mute on this machine — opt-in with LIVE=1. Reads the mute state only; nothing is
 * changed, so nothing the user hears moves.
 */
const live = process.env.LIVE === "1" && process.platform === "win32";

describe.skipIf(!live)("WinSystem on this machine", () => {
  it("reads whether the output is muted", async () => {
    const system = new WinSystem();
    try {
      expect(typeof (await system.outputMuted())).toBe("boolean");
    } finally {
      system.dispose();
    }
  }, 30_000);

  it("names an app as Windows does, from its executable", async () => {
    const system = new WinSystem();
    const notepad = join(process.env.SystemRoot ?? String.raw`C:\Windows`, "System32", "notepad.exe");
    try {
      expect(await system.fileDescription(notepad)).toMatch(/notepad/i);
      // A name with a quote in it is passed safely, and a file that is gone names nothing.
      expect(await system.fileDescription(String.raw`C:\Nowhere\it's gone.exe`)).toBeNull();
    } finally {
      system.dispose();
    }
  }, 30_000);
});
