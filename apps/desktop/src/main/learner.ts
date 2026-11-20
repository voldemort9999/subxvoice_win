// Learning the user's words from their own fixes: after a paste the
// field is read back for a while, and a word the user corrected in what we wrote joins the
// dictionary, so the recogniser and the rewrite get it right next time.
//
//   paste ──► watch the field (1 min) ──► latest reading that still holds our text
//         ──► settle: when the watch ends, the text leaves the field (sent), or the next dictation
//         ──► names at once; other words on the second identical fix ──► dictionary + notice
//
// Only the last reading counts, not every keystroke: halfway through retyping "Aarnav" the field
// says "Aar", which is not a lesson. The field's text is never stored or logged.
import { type DictionaryEntry, editsIn, type FieldReader, type LearnedWord } from "@subx/core";
import type { PendingFix } from "../shared/ipc";
import { JsonFile } from "./stores";

/** Long enough to fix a word and read it over; a chat message is usually sent well before. */
export const WATCH_MS = 60_000;
/**
 * Once the user has changed something and then left the field alone this long, the fix is taken
 * as done and learned, rather than waiting out the whole watch.
 */
export const QUIET_MS = 4000;
/** An ordinary word (no capital, no digit) is learned when the same fix has been seen this often. */
const SEEN_FOR_ORDINARY = 2;

export interface LearnerDeps {
  field: FieldReader | undefined;
  dictionary: {
    all(): Promise<DictionaryEntry[]>;
    upsert(entry: DictionaryEntry): Promise<void>;
    remove(word: string): Promise<void>;
  };
  /** Where fixes seen once, and words the user removed, are kept (the account's folder). */
  memoryPath: () => string;
  enabled(): Promise<boolean>;
  /** Words just added, for the notice; the dictionary has already been saved. */
  onLearned(words: string[]): void;
  log?(line: string): void;
}

interface Memory {
  /** Ordinary-word fixes seen fewer than SEEN_FOR_ORDINARY times, keyed "heardAs→word". A bare
   * count is how the first version kept them, before the fix itself was remembered. */
  seen: Record<string, number | Omit<PendingFix, "key">>;
  /** Words the user took out of the dictionary: never learned again, or deleting it would be pointless. */
  removed: string[];
}

const fold = (word: string) => word.toLocaleLowerCase();
/** Whitespace as one space: a field read back may wrap or break lines where we pasted spaces. */
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

export class EditLearner {
  private readonly deps: LearnerDeps;
  private readonly memory: JsonFile<Memory>;
  private watch: { stop(): void } | null = null;
  /** What the latest reading that still held our text says the user fixed. */
  private latest: LearnedWord[] = [];
  /** That reading had our text changed, though into nothing learnable: said in the log on settling. */
  private changedOnly = false;
  private settling: Promise<void> = Promise.resolve();
  private quiet: NodeJS.Timeout | undefined;
  /** The app the last paste went into, so a learned word can say where it was fixed. */
  private app: string | undefined;

  constructor(deps: LearnerDeps) {
    this.deps = deps;
    this.memory = new JsonFile(deps.memoryPath, { seen: {}, removed: [] });
  }

  /** Called once the text is at the cursor. Settles whatever the previous paste taught first. */
  async pasted(text: string, app?: string): Promise<void> {
    await this.settle();
    this.app = app;
    if (!this.deps.field || !text.trim() || !(await this.deps.enabled().catch(() => false))) return;
    this.latest = [];
    // ⌘V is only a key press: the first reading can come before the app has put the text in.
    // Until our text has been seen in the field, its absence means "not yet", not "sent".
    let seen = false;
    const watch = this.deps.field.watch(
      (field) => {
        if (this.watch !== watch) return; // a reading for an earlier paste
        const edits = editsIn(text, field);
        if (edits === null) {
          // Our text has left the field (sent, cleared): the reading before that is the user's
          // final word on it, so settle on it now rather than wait out the minute.
          if (seen) void this.settle("the text left the field");
          return;
        }
        seen = true;
        this.latest = edits;
        this.changedOnly = edits.length === 0 && !squash(field).includes(squash(text));
        clearTimeout(this.quiet);
        if (edits.length > 0) this.quiet = setTimeout(() => void this.settle("the edit is done"), QUIET_MS);
      },
      (reason) => {
        if (this.watch !== watch) return;
        if (!seen) this.deps.log?.(`learn: could not read the field (${reason ?? "unknown"})`);
        void this.settle(reason ?? "the watch ended");
      },
      WATCH_MS,
    );
    this.watch = watch;
  }

  /** Stop watching and keep what the user fixed. Also called when the next dictation starts. */
  settle(why = "a new dictation"): Promise<void> {
    clearTimeout(this.quiet);
    const watch = this.watch;
    this.watch = null;
    watch?.stop();
    const edits = this.latest;
    this.latest = [];
    if (watch && edits.length > 0) this.deps.log?.(`learn: ${edits.length} fix(es) to weigh, because ${why}`);
    // Without this, a fix the rules turned down left no trace at all ("Maujooma" → "Mojmar",
    // Windows hand test 2026-11-20). The words stay out of the log: the field is private.
    if (watch && edits.length === 0 && this.changedOnly)
      this.deps.log?.(`learn: the box was changed, but not as a one-word respelling (${why})`);
    this.changedOnly = false;
    if (edits.length > 0) this.settling = this.settling.then(() => this.learn(edits)).catch(() => {});
    return this.settling;
  }

  /** Another account is signing in: what this one's fields said is not theirs to learn. */
  forget(): void {
    clearTimeout(this.quiet);
    const watch = this.watch;
    this.watch = null;
    watch?.stop();
    this.latest = [];
  }

  /** Fixes seen once, newest first: shown in the dictionary as "waiting for one more fix". */
  async pending(): Promise<PendingFix[]> {
    const memory = await this.memory.read();
    return Object.entries(memory.seen)
      .map(([key, value]) => {
        if (typeof value !== "number") return { key, ...value };
        const [heardAs = "", word = ""] = key.split("→");
        return { key, word, heardAs, at: 0, count: value };
      })
      .sort((a, b) => b.at - a.at);
  }

  /** The user says a waiting fix is right: it goes into the dictionary now. */
  async acceptPending(key: string): Promise<void> {
    const memory = await this.memory.read();
    const fix = (await this.pending()).find((item) => item.key === key);
    if (!fix) return;
    delete memory.seen[key];
    await this.memory.write(memory);
    await this.deps.dictionary.upsert(this.entry(fix.word, fix.heardAs, fix.app));
  }

  /** The user says a waiting fix is not a word to learn: it is forgotten. */
  async dropPending(key: string): Promise<void> {
    const memory = await this.memory.read();
    delete memory.seen[key];
    await this.memory.write(memory);
  }

  /** Words the user removed, which are not learned again. */
  async removedWords(): Promise<string[]> {
    return (await this.memory.read()).removed;
  }

  /** The user lets a removed word be learned again. */
  async allowAgain(word: string): Promise<void> {
    const memory = await this.memory.read();
    memory.removed = memory.removed.filter((known) => fold(known) !== fold(word));
    await this.memory.write(memory);
  }

  private entry(word: string, heardAs: string, app?: string): DictionaryEntry {
    // Vocabulary, plus what it was written as for the dictionary to show and the rewrite to use
    // as a hint; never a "misheard as" rule, which would replace a common word in every sentence.
    return {
      word,
      misheardAs: [],
      source: "learned",
      addedAt: Date.now(),
      writtenAs: [heardAs],
      ...(app ? { learnedIn: app } : {}),
    };
  }

  /** The user took a word out of the dictionary (Undo in the pill, or the Dictionary page). */
  async removed(word: string): Promise<void> {
    const memory = await this.memory.read();
    if (!memory.removed.some((known) => fold(known) === fold(word))) memory.removed.push(word);
    await this.memory.write(memory);
  }

  private async learn(edits: LearnedWord[]): Promise<void> {
    const memory = await this.memory.read();
    const removed = new Set(memory.removed.map(fold));
    const entries = await this.deps.dictionary.all();
    const known = new Map(entries.map((entry) => [fold(entry.word), entry]));
    const added: string[] = [];
    for (const edit of edits) {
      if (removed.has(fold(edit.word))) continue;
      const existing = known.get(fold(edit.word));
      if (existing) {
        // Already a word of theirs, newly spelled wrong another way: remember that spelling too,
        // quietly (no notice, nothing new for the user to undo).
        const before = [...existing.misheardAs, ...(existing.writtenAs ?? [])].map(fold);
        if (!before.includes(fold(edit.heardAs))) {
          await this.deps.dictionary.upsert({
            ...existing,
            writtenAs: [...(existing.writtenAs ?? []), edit.heardAs],
          });
        }
        continue;
      }
      if (!edit.name) {
        const key = `${fold(edit.heardAs)}→${fold(edit.word)}`;
        const before = memory.seen[key];
        const count = (typeof before === "number" ? before : (before?.count ?? 0)) + 1;
        if (count < SEEN_FOR_ORDINARY) {
          memory.seen[key] = {
            word: edit.word,
            heardAs: edit.heardAs,
            at: Date.now(),
            count,
            ...(this.app ? { app: this.app } : {}),
          };
          continue;
        }
        delete memory.seen[key];
      }
      const entry = this.entry(edit.word, edit.heardAs, this.app);
      await this.deps.dictionary.upsert(entry);
      known.set(fold(edit.word), entry);
      added.push(edit.word);
    }
    await this.memory.write(memory);
    if (added.length > 0) {
      this.deps.log?.(`learned from an edit: ${added.join(", ")}`);
      this.deps.onLearned(added);
    }
  }
}
