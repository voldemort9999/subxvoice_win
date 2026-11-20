// The user's dictation settings (languages, style…) and dictionary, kept on this Mac.
//
// The Mac's copy is the one that is used: every dictation sends it to the server with the start,
// so the server never reads its database on the way to the first word (user, 2026-11-19: "bina
// baat har request DB pe kyun"). The server's copy is how another device gets the same settings.
//
// The dictionary syncs word by word (2026-11-21). Sending the whole list made the server's copy
// whatever device wrote last: a word just added on the other device was dropped, and a word deleted
// here came back from the other device's list. Now this Mac remembers the list as the server last
// gave it (the base) and compares three lists:
//   this Mac vs the base  → what changed here, sent as words to add and to remove;
//   the server vs the base → what changed elsewhere, applied here word by word.
// The server tells every device when the account's settings moved (a version, sent after each
// dictation and with the stats), so this Mac pulls only when something changed.
import type { DictionaryEntry, DictionaryStore } from "@subx/core";
import type { VoiceSettings } from "../shared/ipc";
import { type Backend, type DictionaryChange, OfflineError } from "./backend";
import { JsonFile } from "./stores";

/** Whatever the server keeps; only `languages` is typed here, the rest passes through unread. */
type Settings = VoiceSettings & Record<string, unknown>;

/** A dictionary word as the server keeps it. */
type ServerWord = { word: string; misheardAs: string[] };

interface Kept {
  /** The server's settings as last pulled or written; their dictionary is the base. */
  settings: Settings | null;
  /** A setting changed here while the server could not be reached; sent at the next sync. */
  dirty: boolean;
  /** The settings version of `settings`: a different one from the server means pull. */
  version?: string | null;
}

const key = (word: string) => word.trim().toLowerCase();
const sameWord = (a: ServerWord, b: ServerWord) =>
  a.word === b.word && [...a.misheardAs].sort().join("\n") === [...b.misheardAs].sort().join("\n");
const serverWord = (entry: ServerWord): ServerWord => ({
  word: entry.word,
  misheardAs: [...entry.misheardAs],
});
const wordsOf = (settings: Settings | null): ServerWord[] | null =>
  settings && Array.isArray(settings.dictionary)
    ? (settings.dictionary as ServerWord[]).filter((entry) => typeof entry?.word === "string")
    : null;

export class VoiceSettingsCopy {
  private readonly file: JsonFile<Kept>;
  private kept: Kept | null = null;

  constructor(
    path: () => string,
    private readonly backend: Backend,
    private readonly dictionary: DictionaryStore,
    /** Words changed here because of another device: the dictionary page reads its list again. */
    private readonly onWordsChanged: () => void = () => {},
  ) {
    this.file = new JsonFile<Kept>(path, { settings: null, dirty: false, version: null });
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
   * cannot be reached the change is still kept here, used at once, and sent at the next sync. The
   * dictionary never goes this way (it would replace the list): only word by word.
   */
  async update(patch: Partial<VoiceSettings>): Promise<VoiceSettings> {
    const { dictionary: _words, ...change } = patch as Record<string, unknown>;
    const kept = await this.load();
    try {
      const saved = await this.backend.update(change);
      await this.adopt(saved.value as Settings, saved.version);
      return (await this.load()).settings ?? (saved.value as Settings);
    } catch (error) {
      if (!(error instanceof OfflineError) || !kept.settings) throw error;
      const next = { ...kept.settings, ...change } as Settings;
      await this.save({ ...kept, settings: next, dirty: true });
      return next;
    }
  }

  /** The dictionary changed here (a word added, edited, learned or deleted): send what changed. */
  pushDictionary(): Promise<void> {
    return this.run(false);
  }

  /**
   * The server's settings version, as a dictation's totals or the stats reported it. Pulls only when
   * it is not the one this Mac has: another device changed something.
   */
  versionSeen(version: string | null | undefined): Promise<void> {
    if (!version || version === this.kept?.version) return Promise.resolve();
    return this.load().then((kept) => (kept.version === version ? undefined : this.run(true)));
  }

  /**
   * At start and at sign-in: a setting changed here while offline is sent; then the server's
   * settings are pulled and the dictionary reconciled both ways. Never throws: offline, the Mac's
   * copy simply stays in use.
   */
  async sync(): Promise<void> {
    try {
      const kept = await this.load();
      if (kept.dirty && kept.settings) {
        const { dictionary: _words, ...settings } = kept.settings;
        const saved = await this.backend.update(settings);
        await this.adopt(saved.value as Settings, saved.version);
      }
    } catch (error) {
      console.warn("voice settings: sync skipped:", error instanceof Error ? error.message : error);
    }
    await this.run(true);
  }

  // One at a time: a change made while a sync runs is picked up by another round right after it,
  // never by a second sync running alongside (three at once once kept one word of three).
  private running: Promise<void> | null = null;
  private again = false;
  private pullAgain = false;

  private run(pull: boolean): Promise<void> {
    if (this.running) {
      this.again = true;
      this.pullAgain ||= pull;
      return this.running;
    }
    this.running = (async () => {
      let wantPull = pull;
      try {
        do {
          this.again = false;
          await this.once(wantPull);
          wantPull = this.pullAgain;
          this.pullAgain = false;
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async once(pull: boolean): Promise<void> {
    try {
      if (pull) {
        const server = await this.backend.settings();
        await this.adopt(server.value as Settings, server.version);
      }
      const change = await this.changesHere();
      if (!change) return;
      const saved = await this.backend.changeDictionary(change);
      const kept = await this.load();
      const settings = { ...(kept.settings ?? {}), dictionary: saved.value } as Settings;
      await this.adopt(settings, saved.version, new Set(change.upsert.map((entry) => key(entry.word))));
    } catch (error) {
      // Offline or refused: the words still work here (they go with each dictation), and what
      // changed here is found again by the next comparison.
      console.warn("dictionary: sync skipped:", error instanceof Error ? error.message : error);
    }
  }

  /** This Mac's list against the base: words added or edited here, and words deleted here. */
  private async changesHere(): Promise<DictionaryChange | null> {
    const base = new Map(
      (wordsOf((await this.load()).settings) ?? []).map((entry) => [key(entry.word), entry]),
    );
    const here = await this.dictionary.all();
    const upsert = here
      .filter((entry) => {
        const was = base.get(key(entry.word));
        return !was || !sameWord(serverWord(entry), was);
      })
      .map(serverWord);
    const present = new Set(here.map((entry) => key(entry.word)));
    const remove = [...base.values()]
      .filter((entry) => !present.has(key(entry.word)))
      .map((entry) => entry.word);
    return upsert.length || remove.length ? { upsert, remove } : null;
  }

  /**
   * Takes the server's settings as the new base, after applying here what changed elsewhere (the
   * server's list against the old base), one word at a time so a word changed here meanwhile is kept.
   * `sent`: the words this Mac itself just sent (the list is the answer to that change). One of them
   * missing here was deleted here while it was on its way, so it is not added back.
   */
  private async adopt(server: Settings, version: string | null, sent = new Set<string>()): Promise<void> {
    const kept = await this.load();
    const theirs = wordsOf(server);
    let changed = false;
    if (theirs) {
      const oldBase = wordsOf(kept.settings);
      const before = oldBase ? new Map(oldBase.map((entry) => [key(entry.word), entry])) : null;
      const here = new Map((await this.dictionary.all()).map((entry) => [key(entry.word), entry]));
      const now = new Map(theirs.map((entry) => [key(entry.word), entry]));
      for (const [word, entry] of now) {
        const mine = here.get(word);
        const was = before?.get(word);
        if (!mine) {
          // Not here: added elsewhere, unless it was here before and deleted here (still to send).
          if (!was && !sent.has(word)) {
            await this.dictionary.upsert({ ...serverWord(entry), source: "you", addedAt: Date.now() });
            changed = true;
          }
        } else if (was && sameWord(serverWord(mine), was) && !sameWord(entry, was)) {
          // Edited elsewhere and not here: take theirs, keeping what only this Mac knows about it.
          // The store matches words exactly, so a change of capitals replaces the old spelling.
          if (mine.word !== entry.word) await this.dictionary.remove(mine.word);
          await this.dictionary.upsert({ ...mine, word: entry.word, misheardAs: [...entry.misheardAs] });
          changed = true;
        }
      }
      if (before) {
        for (const [word, was] of before) {
          const mine = here.get(word);
          // Deleted elsewhere, and not changed here since: delete here too.
          if (!now.has(word) && mine && sameWord(serverWord(mine), was)) {
            await this.dictionary.remove(mine.word);
            changed = true;
          }
        }
      }
    }
    await this.save({ ...kept, settings: server, ...(version ? { version } : {}) });
    if (changed) this.onWordsChanged();
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

export type { DictionaryEntry };
