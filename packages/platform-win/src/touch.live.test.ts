import { describe, expect, it } from "vitest";
import { lastInputAt } from "./win32";

/** Reads Windows' last-input time on this machine — opt-in with LIVE=1; injects nothing. */
const live = process.env.LIVE === "1" && process.platform === "win32";

describe.skipIf(!live)("lastInputAt on this machine", () => {
  it("gives a real time in the past, on Date.now()'s clock", () => {
    const at = lastInputAt();
    const ago = Date.now() - at;
    console.log(`last input ${ago} ms ago`);
    expect(ago).toBeGreaterThanOrEqual(0);
    expect(ago).toBeLessThan(24 * 3600 * 1000);
  });
});
