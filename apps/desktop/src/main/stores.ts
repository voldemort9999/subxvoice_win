// Local JSON-file stores. They implement the core store interfaces, so they can be swapped for
// SQLite later without touching anything else.
import { readFile, rename, writeFile } from "node:fs/promises";
import type { DictionaryEntry, DictionaryStore, HistoryStore, SessionRecord } from "@subx/core";

export class JsonFile<T> {
  private readonly path: () => string;
  private readonly fallback: T;
  private pending: Promise<void> = Promise.resolve();

  /** The path is read per call: a sign-in moves these files to that account's own folder. */
  constructor(path: () => string, fallback: T) {
    this.path = path;
    this.fallback = fallback;
  }

  async read(): Promise<T> {
    try {
      return JSON.parse(await readFile(this.path(), "utf8")) as T;
    } catch {
      // A fresh copy each time. Handing out the one fallback object let a store that started
      // without a file add to it, so the next account to start without a file was handed the last
      // account's dictations, and saved them as its own (found 2026-11-20).
      return structuredClone(this.fallback);
    }
  }

  /**
   * Writes are queued and atomic (temp file + rename), so a crash never leaves half a file. The
   * path is fixed when the write is asked for, not when it runs: a save that started for one account
   * must not land in the next one's folder after a switch. One failed write (a full disk) fails only
   * itself; the queue carries on.
   */
  write(value: T): Promise<void> {
    const path = this.path();
    const next = this.pending
      .catch(() => {})
      .then(async () => {
        const temp = `${path}.tmp`;
        await writeFile(temp, JSON.stringify(value));
        await rename(temp, path);
      });
    this.pending = next;
    return next;
  }
}

export class JsonHistoryStore implements HistoryStore {
  private readonly file: JsonFile<SessionRecord[]>;
  private records: SessionRecord[] | null = null;

  constructor(path: () => string) {
    this.file = new JsonFile(path, []);
  }

  /** Drop what is held in memory, because it belongs to the account that just signed out. */
  forget(): void {
    this.records = null;
  }

  async save(record: SessionRecord): Promise<void> {
    const records = await this.load();
    records.unshift(record);
    await this.file.write(records);
  }

  async recent(limit: number): Promise<SessionRecord[]> {
    return (await this.load()).slice(0, limit);
  }

  async find(id: string): Promise<SessionRecord | undefined> {
    return (await this.load()).find((record) => record.id === id);
  }

  async remove(id: string): Promise<void> {
    const records = await this.load();
    this.records = records.filter((record) => record.id !== id);
    await this.file.write(this.records);
  }

  /** Takes out every record `drop` picks and returns them, so their recordings can go too. */
  async removeWhere(drop: (record: SessionRecord) => boolean): Promise<SessionRecord[]> {
    const records = await this.load();
    const removed = records.filter(drop);
    if (removed.length === 0) return [];
    this.records = records.filter((record) => !drop(record));
    await this.file.write(this.records);
    return removed;
  }

  /** The pipeline writes the record; the app saves the audio afterwards, off the critical path. */
  async attachAudio(id: string, audioPath: string, audioMs: number): Promise<void> {
    const records = await this.load();
    const record = records.find((item) => item.id === id);
    if (!record) return;
    record.audioPath = audioPath;
    record.audioMs = audioMs;
    await this.file.write(records);
  }

  /** Changes one record in place (a snippet swapped in after the paste); false when it is gone. */
  async update(id: string, change: (record: SessionRecord) => void): Promise<boolean> {
    const records = await this.load();
    const record = records.find((item) => item.id === id);
    if (!record) return false;
    change(record);
    await this.file.write(records);
    return true;
  }

  private async load(): Promise<SessionRecord[]> {
    this.records ??= await this.file.read();
    return this.records;
  }
}

export class JsonDictionaryStore implements DictionaryStore {
  private readonly file: JsonFile<DictionaryEntry[]>;
  private entries: DictionaryEntry[] | null = null;

  constructor(path: () => string) {
    this.file = new JsonFile(path, []);
  }

  /** Drop what is held in memory, because it belongs to the account that just signed out. */
  forget(): void {
    this.entries = null;
  }

  async all(): Promise<DictionaryEntry[]> {
    return this.load();
  }

  async upsert(entry: DictionaryEntry): Promise<void> {
    const entries = await this.load();
    const index = entries.findIndex((existing) => existing.word === entry.word);
    if (index >= 0) entries[index] = entry;
    else entries.push(entry);
    await this.file.write(entries);
  }

  async remove(word: string): Promise<void> {
    const entries = await this.load();
    this.entries = entries.filter((entry) => entry.word !== word);
    await this.file.write(this.entries);
  }

  private async load(): Promise<DictionaryEntry[]> {
    this.entries ??= await this.file.read();
    return this.entries;
  }
}

export class JsonSettingsStore<T extends object> {
  private readonly file: JsonFile<Partial<T>>;
  private readonly defaults: T;
  /** Only the fields the user has explicitly set — never the defaults themselves. */
  private stored: Partial<T> | null = null;

  constructor(path: () => string, defaults: T) {
    this.file = new JsonFile(path, {});
    this.defaults = defaults;
  }

  async all(): Promise<T> {
    // Defaults are applied live on every read, so a field the user never chose always tracks the
    // current default — changing a default takes effect instead of being frozen in the saved file.
    this.stored ??= await this.file.read();
    return { ...this.defaults, ...this.stored };
  }

  async update(patch: Partial<T>): Promise<T> {
    this.stored ??= await this.file.read();
    this.stored = { ...this.stored, ...patch };
    await this.file.write(this.stored); // persist only what was explicitly set
    return { ...this.defaults, ...this.stored };
  }
}
