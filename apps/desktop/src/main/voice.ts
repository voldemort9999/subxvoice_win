// The user's dictation settings (languages, style…) kept on this Mac.
//
// The Mac's copy is the one that is used: every dictation sends it to the server with the start,
// so the server never reads its database on the way to the first word (user, 2026-11-19: "bina
// baat har request DB pe kyun"). The server's copy exists for another device: it is pulled when the
// app starts and when someone signs in, and pushed whenever something changes here. The dictionary
// rides along the same way: its words go with each dictation, and the list is pushed on change.
import type { DictionaryEntry, DictionaryStore } from "@subx/core";
import type { VoiceSettings } from "../shared/ipc";
import { type Backend, OfflineError } from "./backend";
import { JsonFile } from "./stores";

/** Whatever the server keeps; only `languages` is typed here, the rest passes through unread. */
type Settings = VoiceSettings & Record<string, unknown>;

interface Kept {
  settings: Settings | null;
  /** Changed here while the server could not be reached; sent at the next sync. */
  dirty: boolean;
}

export class VoiceSettingsCopy {
  private readonly file: JsonFile<Kept>;
  private kept: Kept | null = null;

  constructor(
    path: () => string,
    private readonly backend: Backend,
    private readonly dictionary: DictionaryStore,
  ) {
    this.file = new JsonFile<Kept>(path, { settings: null, dirty: false });
  }

  /** The account changed: what is held belongs to the one before. */
  forget(): void {
    this.kept = null;
  }

  /** For the Settings screen. Pulled from the server the first time, if this Mac has none yet. */
  async current(): Promise<VoiceSettings | null> {
    if (!(await this.load()).settings) await this.sync();
    return (await this.load()).settings;
  }

  /** What a dictation sends: everything but the dictionary, whose words go separately as terms. */
  async forDictation(): Promise<Record<string, unknown> | null> {
    const settings = (await this.load()).settings;
    if (!settings) return null;
    const { dictionary: _words, ...rest } = settings;
    return rest;
  }

  /**
   * A change from the Settings screen. Sent to the server first, which checks it; if the server
   * cannot be reached the change is still kept here, used at once, and sent at the next sync.
   */
  async update(patch: Partial<VoiceSettings>): Promise<VoiceSettings> {
    const kept = await this.load();
    try {
      const saved = (await this.backend.update(patch as Record<string, unknown>)) as Settings;
      await this.save({ settings: saved, dirty: false });
      return saved;
    } catch (error) {
      if (!(error instanceof OfflineError) || !kept.settings) throw error;
      const next = { ...kept.settings, ...patch } as Settings;
      await this.save({ settings: next, dirty: true });
      return next;
    }
  }

  /**
   * The dictionary changed here: the server's copy follows, so another Mac gets the same words.
   * One push at a time, and a change during a push sends the whole list again once it is done. Three
   * words added together used to start three pushes at once; the first (one word) landed last and the
   * server kept one word of three (2026-11-20).
   */
  pushDictionary(): Promise<void> {
    if (this.pushing) {
      this.pushAgain = true;
      return this.pushing;
    }
    this.pushing = (async () => {
      try {
        do {
          this.pushAgain = false;
          await this.pushOnce();
        } while (this.pushAgain);
      } finally {
        this.pushing = null;
      }
    })();
    return this.pushing;
  }

  private pushing: Promise<void> | null = null;
  private pushAgain = false;

  private async pushOnce(): Promise<void> {
    const entries = await this.dictionary.all();
    const kept = await this.load();
    try {
      const saved = (await this.backend.update({
        dictionary: entries,
      } as Partial<VoiceSettings>)) as Settings;
      await this.save({ settings: saved, dirty: kept.dirty });
    } catch {
      // Offline or refused: the words still work here (they go with each dictation); the next sync
      // sends the whole copy again.
      if (kept.settings)
        await this.save({ settings: { ...kept.settings, dictionary: entries }, dirty: true });
    }
  }

  /**
   * At start and at sign-in. A change made here while offline is sent; otherwise the server's copy
   * is taken (it may have been changed on another device), and its dictionary words that this Mac
   * does not have are added. Never throws: offline, the Mac's copy simply stays in use.
   */
  async sync(): Promise<void> {
    try {
      const kept = await this.load();
      if (kept.dirty && kept.settings) {
        const words = await this.dictionary.all();
        const saved = (await this.backend.update({ ...kept.settings, dictionary: words })) as Settings;
        await this.save({ settings: saved, dirty: false });
        return;
      }
      const server = (await this.backend.settings()) as Settings;
      await this.save({ settings: server, dirty: false });
      const theirs = Array.isArray(server.dictionary) ? (server.dictionary as DictionaryEntry[]) : [];
      const mine = new Set((await this.dictionary.all()).map((entry) => entry.word.toLowerCase()));
      for (const entry of theirs) {
        if (typeof entry?.word === "string" && !mine.has(entry.word.toLowerCase()))
          await this.dictionary.upsert(entry);
      }
      // And the other way: words only this Mac has (added before it synced, or offline) go up, so
      // the next device gets them too.
      const known = new Set(theirs.map((entry) => entry?.word?.toLowerCase()));
      if ((await this.dictionary.all()).some((entry) => !known.has(entry.word.toLowerCase())))
        await this.pushDictionary();
    } catch (error) {
      console.warn("voice settings: sync skipped:", error instanceof Error ? error.message : error);
    }
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
