import { describe, expect, it } from "vitest";
import { WinSystem } from "./system";

/**
 * Reading the screen around the cursor on this machine — opt-in with LIVE=1. Only reads (whatever
 * window has the focus while it runs); nothing is clicked or typed.
 */
const live = process.env.LIVE === "1" && process.platform === "win32";

describe.skipIf(!live)("WinSystem.screenText on this machine", () => {
  it("reads the window in front within its budget, or says nothing", async () => {
    const system = new WinSystem();
    try {
      await system.outputMuted(); // starts the worker, so the timing below is the read alone
      const started = performance.now();
      const text = await system.screenText("Title from the app");
      const ms = performance.now() - started;
      console.log(`screen: ${text?.length ?? 0} characters in ${Math.round(ms)} ms`);
      if (text !== null) expect(text.startsWith("Title from the app")).toBe(true);
      // 200 ms of reading, plus the worker's round trip.
      expect(ms).toBeLessThan(600);
    } finally {
      system.dispose();
    }
  }, 30_000);
});
