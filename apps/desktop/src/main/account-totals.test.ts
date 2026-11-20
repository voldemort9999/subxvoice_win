import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DayTotal } from "../shared/ipc";
import { AccountTotals, FRESH_MS, mergeDays } from "./account-totals";
import type { Stats } from "./backend";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "subx-totals-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const usage = (used: number) => ({ used, limit: 7200, remaining: 7200 - used });

function build(stats: Stats, local: Record<string, DayTotal> = {}) {
  let now = 1_000_000;
  let asked = 0;
  let changes = 0;
  const versions: string[] = [];
  let answer = stats;
  const totals = new AccountTotals({
    backend: {
      stats: async () => {
        asked++;
        return answer;
      },
    },
    local: async () => local,
    path: () => join(dir, "account-totals.json"),
    onChange: () => changes++,
    onSettingsVersion: (version) => versions.push(version),
    now: () => now,
  });
  return {
    totals,
    asked: () => asked,
    changes: () => changes,
    versions,
    later: (ms: number) => (now += ms),
    answer: (next: Stats) => (answer = next),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("account totals", () => {
  it("shows the account's words (every device) where the server counted them, and this Mac's before", () => {
    const local = {
      "2026-11-20": { words: 2776, speakingMs: 970_000, dictations: 56 },
      "2026-11-21": { words: 100, speakingMs: 60_000, dictations: 3 },
    };
    const days = mergeDays(local, [
      { day: "2026-11-20", seconds: 1356, words: null, dictations: null },
      { day: "2026-11-21", seconds: 90, words: 150, dictations: 5 },
    ]);
    expect(days["2026-11-20"]).toEqual(local["2026-11-20"]);
    expect(days["2026-11-21"]).toEqual({ words: 150, speakingMs: 90_000, dictations: 5 });
  });

  it("asks the server once, then not again for 30 s however often the window reads", async () => {
    const t = build({ usage: usage(60), days: [], settingsVersion: "v1" });
    await t.totals.usage();
    for (let i = 0; i < 5; i++) await t.totals.days();
    await settle();
    expect(t.asked()).toBe(1);
    t.later(FRESH_MS + 1);
    await t.totals.days();
    await settle();
    expect(t.asked()).toBe(2);
  });

  it("after a dictation takes the server's totals from the dictation itself: no request", async () => {
    const t = build({ usage: usage(60), days: [], settingsVersion: "v1" });
    await t.totals.refresh();
    const before = t.asked();
    await t.totals.live({
      type: "usage",
      usage: usage(90),
      today: { day: "2026-11-21", seconds: 90, words: 40, dictations: 2 },
      settingsVersion: "v2",
    });
    expect(t.asked()).toBe(before);
    expect((await t.totals.usage())?.remaining).toBe(7110);
    expect((await t.totals.days())["2026-11-21"]).toEqual({ words: 40, speakingMs: 90_000, dictations: 2 });
    expect(t.versions).toContain("v2");
    expect(t.changes()).toBeGreaterThan(0);
  });

  it("ignores totals that are not shaped as expected", async () => {
    const t = build({ usage: usage(0), days: [], settingsVersion: null });
    await t.totals.refresh();
    const changes = t.changes();
    await t.totals.live({ type: "usage", usage: { used: "a lot" }, today: {} });
    await t.totals.live(null);
    expect(t.changes()).toBe(changes);
  });

  it("keeps the last numbers when offline, and shows them at once when the app opens again", async () => {
    const t = build({
      usage: usage(120),
      days: [{ day: "2026-11-21", seconds: 120, words: 70, dictations: 3 }],
      settingsVersion: null,
    });
    await t.totals.refresh();
    // A new start: the numbers come from disk before any answer.
    const offline = new AccountTotals({
      backend: {
        stats: async () => {
          throw new Error("offline");
        },
      },
      local: async () => ({}),
      path: () => join(dir, "account-totals.json"),
      onChange: () => {},
      onSettingsVersion: () => {},
    });
    expect((await offline.usage())?.used).toBe(120);
    expect((await offline.days())["2026-11-21"]?.words).toBe(70);
  });

  it("offline or signed out, does not try again on every read", async () => {
    let tries = 0;
    const totals = new AccountTotals({
      backend: {
        stats: async () => {
          tries++;
          throw new Error("offline");
        },
      },
      local: async () => ({}),
      path: () => join(dir, "offline.json"),
      onChange: () => {},
      onSettingsVersion: () => {},
    });
    for (let i = 0; i < 5; i++) await totals.days();
    await settle();
    expect(tries).toBe(1);
  });

  it("passes on the settings version, so the dictionary is pulled only when it moved", async () => {
    const t = build({ usage: usage(0), days: [], settingsVersion: "v7" });
    await t.totals.refresh();
    expect(t.versions).toEqual(["v7"]);
  });

  it("a forced refresh asks even when fresh (a dictation was refused)", async () => {
    const t = build({ usage: usage(0), days: [], settingsVersion: null });
    await t.totals.refresh();
    t.answer({ usage: usage(7200), days: [], settingsVersion: null });
    await t.totals.refresh(true);
    expect(t.asked()).toBe(2);
    expect((await t.totals.usage())?.remaining).toBe(0);
  });
});
