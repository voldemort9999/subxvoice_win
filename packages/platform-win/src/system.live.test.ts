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
});
