import type { SessionRecord } from "@subx/core";
import { dayKey } from "../shared/day-key";
import type { DayTotal } from "../shared/ipc";
import { wordCount } from "../shared/words";
import { JsonFile, JsonHistoryStore } from "./stores";

interface Kept {
  version: 1;
  /** By the Mac's own calendar day, "2026-11-20". */
  days: Record<string, DayTotal>;
}

/**
 * Words, speaking time and dictations per day, kept apart from the history. Home and Insights used
 * to add these up from the history, so deleting dictations (or keeping them only 7 days) shrank
 * "Dictated words", "Time saved" and the streak with them (2026-11-20). Counts only, never text.
 * Built once from the history this Mac has; after that every dictation is added as it is saved.
 */
export class DailyTotals {
  private readonly file: JsonFile<Kept | null>;
  private kept: Kept | null = null;
  private loading: Promise<Kept> | null = null;
  /** Bumped by forget(): a load that started for the account before must not land in the next. */
  private generation = 0;

  constructor(
    path: () => string,
    private readonly history: () => Promise<SessionRecord[]>,
  ) {
    this.file = new JsonFile<Kept | null>(path, null);
  }

  /** The account changed: what is held belongs to the one before. */
  forget(): void {
    this.kept = null;
    this.loading = null;
    this.generation++;
  }

  async days(): Promise<Record<string, DayTotal>> {
    const kept = await this.load();
    return Object.fromEntries(Object.entries(kept.days).map(([day, total]) => [day, { ...total }]));
  }

  /** A dictation was saved: its words count on its day. */
  async added(record: SessionRecord): Promise<void> {
    const kept = await this.load();
    const total = dayOf(kept, record.createdAt);
    total.words += wordCount(record.finalText);
    total.dictations += 1;
    total.speakingMs += record.audioMs ?? 0;
    await this.file.write(kept);
  }

  /** The dictation's audio was saved after it: its length counts on the dictation's day. */
  async spoke(createdAt: number, audioMs: number): Promise<void> {
    if (!(audioMs > 0)) return;
    const kept = await this.load();
    dayOf(kept, createdAt).speakingMs += audioMs;
    await this.file.write(kept);
  }

  load(): Promise<Kept> {
    if (this.kept) return Promise.resolve(this.kept);
    if (this.loading) return this.loading;
    const generation = this.generation;
    const loading = (async () => {
      const stored = await this.file.read();
      let kept: Kept;
      if (stored?.version === 1 && stored.days && typeof stored.days === "object") {
        kept = stored;
      } else {
        kept = { version: 1, days: {} };
        for (const record of await this.history()) {
          const total = dayOf(kept, record.createdAt);
          total.words += wordCount(record.finalText);
          total.dictations += 1;
          total.speakingMs += record.audioMs ?? 0;
        }
        if (generation === this.generation) await this.file.write(kept);
      }
      if (generation === this.generation) this.kept = kept;
      return kept;
    })();
    this.loading = loading;
    loading.catch(() => {
      if (this.loading === loading) this.loading = null;
    });
    return loading;
  }
}

function dayOf(kept: Kept, timestamp: number): DayTotal {
  const key = dayKey(timestamp);
  kept.days[key] ??= { words: 0, speakingMs: 0, dictations: 0 };
  return kept.days[key];
}

/**
 * The history store, telling the daily totals about each dictation. Deleting from the history is
 * not passed on: the totals keep what was said even when the text is gone. A failure to count is
 * logged and never fails the save (the text is already pasted by then).
 */
export class CountedHistoryStore extends JsonHistoryStore {
  constructor(
    path: () => string,
    private readonly totals: DailyTotals,
    private readonly log: (message: string) => void = console.warn,
  ) {
    super(path);
  }

  override async save(record: SessionRecord): Promise<void> {
    // Built from the history before this record joins it, so it is not counted twice.
    await this.totals.load().catch(() => {});
    await super.save(record);
    await this.totals.added(record).catch((error: unknown) => this.log(`daily totals: ${String(error)}`));
  }

  override async attachAudio(id: string, audioPath: string, audioMs: number): Promise<void> {
    const record = await this.find(id);
    await super.attachAudio(id, audioPath, audioMs);
    if (record)
      await this.totals
        .spoke(record.createdAt, audioMs)
        .catch((error: unknown) => this.log(`daily totals: ${String(error)}`));
  }

  override forget(): void {
    super.forget();
    this.totals.forget();
  }
}
