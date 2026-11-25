import { describe, expect, it } from "vitest";
import { allowanceProblem } from "./workflow";

const usage = (words: { percentUsed: number | null; out: boolean; unlimited?: boolean }, plan = "free") => ({
  used: 60,
  limit: 7200,
  remaining: 7140,
  plan,
  words: { used: 1, unlimited: false, ...words, per: "week" as const, resetsAt: "2026-11-23T00:00:00+05:30" },
});

describe("why a dictation could not start", () => {
  it("says the words are used up and when they come back, never how many there were", () => {
    expect(allowanceProblem(usage({ percentUsed: 100, out: true }))).toBe(
      "You've used this week's free words. They come back on Monday. Upgrade in Settings to keep going.",
    );
    expect(allowanceProblem(usage({ percentUsed: 100, out: true }, "pro"))).toBe(
      "You've used this week's words. They come back on Monday.",
    );
  });

  it("says nothing while words are left or there is no limit, so the real failure shows", () => {
    expect(allowanceProblem(usage({ percentUsed: 40, out: false }))).toBeNull();
    expect(allowanceProblem(usage({ percentUsed: null, out: false, unlimited: true }, "pro"))).toBeNull();
    expect(allowanceProblem(null)).toBeNull();
  });

  it("an older server without words: the day's time", () => {
    expect(allowanceProblem({ used: 7200, limit: 7200, remaining: 0 })).toBe(
      "You've used today's dictation time. It resets tomorrow.",
    );
  });
});
