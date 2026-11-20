// The account's numbers, every device together: today's allowance and each day's minutes, words and
// dictations (subxvoice-api `GET /v1/stats`, and the totals each dictation sends back after its text).
//
// One account on a Mac and a Windows PC showed 2,776 words on one and 713 on the other (2026-11-21):
// each counted only its own history. The server counts every device, so its numbers are shown; this
// Mac's own count fills in the days before the server counted words.
//
// Requests: none after a dictation (its totals come back on the dictation's own connection), and
// one when the window opens or comes back to the front, at most every 30 s. What was last known is
// shown at once and kept on disk, so the window never waits on the network to draw.

import type { DayTotal, Usage } from "../shared/ipc";
import type { Backend, ServerDay, Stats } from "./backend";
import { JsonFile } from "./stores";

/** How old the numbers may be before opening the window asks again. */
export const FRESH_MS = 30_000;

interface Kept {
  usage: Usage | null;
  days: ServerDay[];
  /** When they came from the server (0: never); after a dictation, today's day is newer still. */
  fetchedAt: number;
}

export class AccountTotals {
  private readonly file: JsonFile<Kept>;
  private kept: Kept | null = null;
  private fetching: Promise<void> | null = null;
  /** The last try, answered or not: offline or signed out, it is not tried again on every read. */
  private triedAt = 0;

  constructor(
    private readonly deps: {
      backend: Pick<Backend, "stats">;
      /** This Mac's own counts per day (its history), for days the server has no word count for. */
      local: () => Promise<Record<string, DayTotal>>;
      /** Where the last numbers are kept (in the account's folder). */
      path: () => string;
      /** The numbers changed: the window reads them again (from here, not the network). */
      onChange: () => void;
      /** The settings version the server reported: the dictionary may have changed elsewhere. */
      onSettingsVersion: (version: string) => void;
      now?: () => number;
    },
  ) {
    this.file = new JsonFile<Kept>(deps.path, { usage: null, days: [], fetchedAt: 0 });
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Another account signed in: its numbers are read from its own folder. */
  forget(): void {
    this.kept = null;
    this.triedAt = 0;
  }

  /**
   * Asks the server unless the numbers are fresh (`force`: always, e.g. a dictation was refused).
   * Never throws: offline, what is known stays.
   */
  refresh(force = false): Promise<void> {
    if (this.fetching) return this.fetching;
    this.fetching = (async () => {
      try {
        const kept = await this.load();
        if (!force && (this.now() - kept.fetchedAt < FRESH_MS || this.now() - this.triedAt < FRESH_MS))
          return;
        this.triedAt = this.now();
        const stats = await this.deps.backend.stats();
        if (!isStats(stats)) return;
        await this.save({ usage: stats.usage, days: stats.days, fetchedAt: this.now() });
        this.deps.onChange();
        if (stats.settingsVersion) this.deps.onSettingsVersion(stats.settingsVersion);
      } catch (error) {
        console.warn("account totals: not refreshed:", error instanceof Error ? error.message : error);
      } finally {
        this.fetching = null;
      }
    })();
    return this.fetching;
  }

  /**
   * What a dictation sent back after its text: today's day and the allowance, as the server has them
   * now. Replaces today here, no request. Anything not shaped as expected is ignored.
   */
  async live(message: unknown): Promise<void> {
    const totals = message as { usage?: unknown; today?: unknown; settingsVersion?: unknown } | null;
    if (!totals || !isUsage(totals.usage) || !isDay(totals.today)) return;
    const today = totals.today;
    const kept = await this.load();
    const days = kept.days.filter((day) => day.day !== today.day);
    days.push(today);
    days.sort((a, b) => a.day.localeCompare(b.day));
    await this.save({ ...kept, usage: totals.usage, days });
    this.deps.onChange();
    if (typeof totals.settingsVersion === "string") this.deps.onSettingsVersion(totals.settingsVersion);
  }

  /** Today's allowance: what is known now, refreshed in the background when old. */
  async usage(): Promise<Usage | null> {
    const kept = await this.load();
    if (!kept.usage) {
      await this.refresh();
      return (await this.load()).usage;
    }
    void this.refresh();
    return kept.usage;
  }

  /**
   * Each day's totals for Home, Insights and the menu bar: the account's (every device) where the
   * server counted words, this Mac's own otherwise. Refreshed in the background when old.
   */
  async days(): Promise<Record<string, DayTotal>> {
    void this.refresh();
    return mergeDays(await this.deps.local(), (await this.load()).days);
  }

  private async load(): Promise<Kept> {
    this.kept ??= await this.file.read();
    return this.kept;
  }

  private async save(next: Kept): Promise<void> {
    this.kept = next;
    await this.file.write(next);
  }
}

/** The account's day where the server counted its words; this Mac's own count where it did not. */
export function mergeDays(local: Record<string, DayTotal>, server: ServerDay[]): Record<string, DayTotal> {
  const days = { ...local };
  for (const day of server) {
    if (day.words === null) continue;
    days[day.day] = {
      words: day.words,
      speakingMs: Math.round(day.seconds * 1000),
      dictations: day.dictations ?? 0,
    };
  }
  return days;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function isUsage(value: unknown): value is Usage {
  const usage = value as Usage | null;
  return !!usage && isNumber(usage.used) && isNumber(usage.limit) && isNumber(usage.remaining);
}

function isDay(value: unknown): value is ServerDay {
  const day = value as ServerDay | null;
  return (
    !!day &&
    typeof day.day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(day.day) &&
    isNumber(day.seconds) &&
    (day.words === null || isNumber(day.words)) &&
    (day.dictations === null || isNumber(day.dictations))
  );
}

function isStats(value: unknown): value is Stats {
  const stats = value as Stats | null;
  return !!stats && isUsage(stats.usage) && Array.isArray(stats.days) && stats.days.every(isDay);
}
