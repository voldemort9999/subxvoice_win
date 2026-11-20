import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionRecord } from "@subx/core";
import { afterEach, describe, expect, it } from "vitest";
import { dayKey } from "../shared/day-key";
import { CountedHistoryStore, DailyTotals } from "./daily-totals";

const record = (id: string, createdAt: number, finalText: string, audioMs?: number) =>
  ({
    id,
    createdAt,
    finalText,
    rawText: finalText,
    mode: "exact",
    context: {},
    ...(audioMs ? { audioMs } : {}),
  }) as unknown as SessionRecord;

describe("daily totals", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  const setup = async (accountDir: () => string) => {
    const totals: DailyTotals = new DailyTotals(
      () => join(accountDir(), "daily-totals.json"),
      (): Promise<SessionRecord[]> => history.recent(Number.MAX_SAFE_INTEGER),
    );
    const history: CountedHistoryStore = new CountedHistoryStore(
      () => join(accountDir(), "history.json"),
      totals,
      () => {},
    );
    return { totals, history };
  };

  it("builds itself once from the history already on this Mac", async () => {
    dir = await mkdtemp(join(tmpdir(), "subx-totals-"));
    const now = Date.now();
    await writeFile(
      join(dir, "history.json"),
      JSON.stringify([record("a", now, "kal main office jaunga", 4000), record("b", now, "theek hai", 1000)]),
    );
    const { totals } = await setup(() => dir);
    expect(await totals.days()).toEqual({ [dayKey(now)]: { words: 6, speakingMs: 5000, dictations: 2 } });
    const saved = JSON.parse(await readFile(join(dir, "daily-totals.json"), "utf8"));
    expect(saved.days[dayKey(now)].words).toBe(6);
  });

  it("counts a new dictation once, with its audio length when that is saved after it", async () => {
    dir = await mkdtemp(join(tmpdir(), "subx-totals-"));
    const now = Date.now();
    await writeFile(join(dir, "history.json"), JSON.stringify([record("a", now, "pehli baat", 2000)]));
    const { totals, history } = await setup(() => dir);
    await history.save(record("b", now, "doosri baat abhi"));
    await history.attachAudio("b", join(dir, "b.wav"), 3000);
    expect(await totals.days()).toEqual({ [dayKey(now)]: { words: 5, speakingMs: 5000, dictations: 2 } });
  });

  // Deleting dictations (or keeping them 7 days) used to shrink "Dictated words", "Time saved" and
  // the streak with them (2026-11-20).
  it("keeps what was said when dictations are deleted", async () => {
    dir = await mkdtemp(join(tmpdir(), "subx-totals-"));
    const now = Date.now();
    const { totals, history } = await setup(() => dir);
    await history.save(record("a", now, "one two three", 1000));
    await history.save(record("b", now, "four five", 1000));
    await history.remove("a");
    await history.removeWhere(() => true);
    expect((await history.recent(10)).length).toBe(0);
    expect((await totals.days())[dayKey(now)]).toEqual({ words: 5, speakingMs: 2000, dictations: 2 });
  });

  it("keeps each account's totals in its own folder", async () => {
    dir = await mkdtemp(join(tmpdir(), "subx-totals-"));
    let account = join(dir, "first");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "first"));
    await mkdir(join(dir, "second"));
    const { totals, history } = await setup(() => account);
    const now = Date.now();
    await history.save(record("a", now, "pehle account ki baat"));
    account = join(dir, "second");
    history.forget();
    expect(await totals.days()).toEqual({});
    await history.save(record("b", now, "doosra"));
    expect((await totals.days())[dayKey(now)]?.words).toBe(1);
  });
});
