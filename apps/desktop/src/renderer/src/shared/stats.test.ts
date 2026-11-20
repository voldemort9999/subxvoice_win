import type { SessionRecord } from "@subx/core";
import { describe, expect, it } from "vitest";
import { DAY_MS } from "./format";
import {
  ASSUMED_TYPING_WPM,
  byApp,
  byDay,
  byHour,
  cleanup,
  longest,
  median,
  personalBests,
  rhythm,
  scripts,
  speakingMs,
  timeSavedMs,
  totalWords,
  wordCount,
  wordsPerMinute,
} from "./stats";

function record(partial: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: Math.random().toString(36).slice(2),
    createdAt: Date.now(),
    mode: "exact",
    context: {},
    rawText: "",
    finalText: "",
    timings: { sttMs: 0, rulesMs: 0, llmMs: 0, insertMs: 0, totalMs: 0 },
    ...partial,
  };
}

describe("counting words", () => {
  it("ignores the whitespace a transcript arrives with", () => {
    expect(wordCount("  hello   there  ")).toBe(2);
    expect(wordCount("")).toBe(0);
    expect(wordCount("   ")).toBe(0);
    // Devanagari words are words too — splitting on whitespace is script-agnostic.
    expect(wordCount("मेरा नाम भावेश है")).toBe(4);
  });
});

describe("time saved", () => {
  it("compares speaking against the typing speed we assume", () => {
    // 40 words at 40 wpm is a minute of typing; it took 10 seconds to say.
    const words = Array.from({ length: 40 }, () => "word").join(" ");
    const saved = timeSavedMs([record({ finalText: words, audioMs: 10_000 })]);
    expect(saved).toBe(60_000 - 10_000);
    expect(ASSUMED_TYPING_WPM).toBe(40);
  });

  it("never claims a negative saving", () => {
    // A long pause with two words in it: typing would have been quicker, which is not worth saying.
    expect(timeSavedMs([record({ finalText: "two words", audioMs: 30_000 })])).toBe(0);
  });

  it("is zero before anything is dictated", () => {
    expect(timeSavedMs([])).toBe(0);
    expect(wordsPerMinute([])).toBe(0);
    expect(totalWords([])).toBe(0);
    expect(speakingMs([])).toBe(0);
  });
});

describe("speaking rate", () => {
  it("is words over the time spent talking", () => {
    const words = Array.from({ length: 30 }, () => "word").join(" ");
    expect(wordsPerMinute([record({ finalText: words, audioMs: 15_000 })])).toBe(120);
  });
});

describe("median", () => {
  it("takes the middle value, and the mean of the two middles when even", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3); // (2+3)/2 rounded
    expect(median([])).toBe(0);
  });
});

describe("grouping for the charts", () => {
  it("keeps empty days so the chart does not lie about rhythm", () => {
    const now = Date.now();
    const buckets = byDay([record({ createdAt: now, finalText: "one two", audioMs: 1000 })], 7);
    expect(buckets).toHaveLength(7);
    expect(buckets[6]?.words).toBe(2);
    expect(buckets[0]?.records).toEqual([]);
  });

  it("drops dictations older than the window instead of folding them into day one", () => {
    const buckets = byDay([record({ createdAt: Date.now() - 30 * DAY_MS, finalText: "old" })], 7);
    expect(buckets.reduce((total, bucket) => total + bucket.words, 0)).toBe(0);
  });

  it("ranks apps by how often they were dictated into", () => {
    const apps = byApp([
      record({ context: { appName: "Code" }, finalText: "a b" }),
      record({ context: { appName: "Code" }, finalText: "c" }),
      record({ context: { appName: "chrome" }, finalText: "d" }),
      // No app name: macOS cannot read one yet, and an "Unknown" bar would look like a bug.
      record({ finalText: "e" }),
    ]);
    expect(apps.map((app) => app.name)).toEqual(["Code", "chrome"]);
    expect(apps[0]?.count).toBe(2);
    expect(apps[0]?.words).toBe(3);
  });

  it("buckets by hour across the whole day", () => {
    const at9 = new Date();
    at9.setHours(9, 30, 0, 0);
    const hours = byHour([record({ createdAt: at9.getTime() })]);
    expect(hours).toHaveLength(24);
    expect(hours[9]).toBe(1);
    expect(hours[10]).toBe(0);
  });
});

describe("what SUBXVoice did for the user", () => {
  it("counts rewrites and the words they took out", () => {
    const result = cleanup([
      record({ rawText: "um so I I think yes", finalText: "I think yes" }),
      record({ rawText: "already fine", finalText: "already fine" }),
      record({ rawText: "", finalText: "" }),
    ]);
    expect(result).toEqual({ spoken: 2, rewritten: 1, trimmed: 3 });
  });

  it("finds the scripts used and the dictations that mixed them", () => {
    const result = scripts([
      record({ finalText: "मुझे पता है, and there are a lot of things to do" }),
      record({ finalText: "kal milte hain" }),
      record({ finalText: "君のお母さん" }),
    ]);
    expect(result.mixed).toBe(1);
    expect(result.used.map((script) => script.name)).toEqual(["Latin", "Devanagari", "Japanese"]);
  });

  it("keeps personal bests honest: no speed from a two-second clip", () => {
    const today = Date.now();
    const bests = personalBests([
      record({ finalText: "one two", audioMs: 500, createdAt: today }),
      record({ finalText: "one two three four five six", audioMs: 3000, createdAt: today - DAY_MS }),
      record({ finalText: "a b", audioMs: 4000, createdAt: today - 3 * DAY_MS }),
    ]);
    expect(bests.fastest).toBe(120);
    expect(bests.longestStreak).toBe(2);
    expect(bests.bestDay?.words).toBe(6);
  });

  it("names the time of day the user talks most, once there is enough", () => {
    const hours = Array.from({ length: 24 }, () => 0);
    hours[23] = 4;
    expect(rhythm(hours)).toBeNull();
    hours[23] = 6;
    expect(rhythm(hours)?.label).toBe("Night owl");
  });
});

describe("longest dictation", () => {
  it("is the one with the most words, and null when there are none", () => {
    expect(longest([])).toBeNull();
    const big = record({ finalText: "one two three" });
    expect(longest([record({ finalText: "one" }), big])).toBe(big);
  });
});
