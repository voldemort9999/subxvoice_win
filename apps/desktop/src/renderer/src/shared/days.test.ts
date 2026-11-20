import type { SessionRecord } from "@subx/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, dayLabel, startOfDay, streakDays } from "./format";
import { byDay } from "./stats";

// Where clocks change, one day is 23 hours and one 25: stepping back by 24 h landed an hour off
// midnight, so a 5-day streak across 1 Nov 2026 in New York showed 2 and "7 days" lost 3 of 5 days.
// Tests run in Node; the renderer's types have no `process`, so it is reached through globalThis.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

describe("days across a clock change (New York, 1 Nov 2026)", () => {
  const zone = env.TZ;
  beforeAll(() => {
    env.TZ = "America/New_York";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T15:00:00-05:00"));
  });
  afterAll(() => {
    vi.useRealTimers();
    env.TZ = zone;
  });

  const days = [
    "2026-10-30T10:00:00-04:00",
    "2026-10-31T10:00:00-04:00",
    "2026-11-01T10:00:00-05:00",
    "2026-11-02T10:00:00-05:00",
    "2026-11-03T10:00:00-05:00",
  ];
  const records = days.map(
    (iso, i) =>
      ({
        id: String(i),
        createdAt: new Date(iso).getTime(),
        finalText: "one two",
        rawText: "",
        mode: "exact",
        context: {},
      }) as unknown as SessionRecord,
  );

  it("runs in a zone that really changes its clocks on 1 Nov", () => {
    expect(new Date("2026-10-30T10:00:00-04:00").getTimezoneOffset()).toBe(240);
    expect(new Date("2026-11-03T10:00:00-05:00").getTimezoneOffset()).toBe(300);
  });

  it("steps back one calendar day at a time", () => {
    const today = startOfDay(Date.now());
    expect(new Date(addDays(today, -3)).getDate()).toBe(31);
    expect(new Date(addDays(today, -3)).getHours()).toBe(0);
  });

  it("keeps the streak and the 7-day chart whole", () => {
    expect(streakDays(records)).toBe(5);
    expect(byDay(records, 7).flatMap((bucket) => bucket.records)).toHaveLength(5);
    expect(dayLabel(new Date("2026-11-02T10:00:00-05:00").getTime())).toBe("Yesterday");
  });
});
