/** 16 kHz mono PCM — the one audio format every STT plug receives. */
export interface AudioClip {
  samples: Int16Array;
  sampleRate: number;
}

/**
 * Which key was held. "command" is Windows' Follow My Words key: its words go to the assistant,
 * never to the paste (apps/desktop workflow.ts).
 */
export type Mode = "exact" | "style" | "command";

/** What the user is looking at while speaking. Every field is optional — OS support varies. */
export interface AppContext {
  appName?: string;
  appId?: string;
  windowTitle?: string;
  url?: string;
  selectedText?: string;
}

/** A word the user cares about, plus the spellings STT tends to produce instead. */
export interface DictionaryEntry {
  word: string;
  /** The user's own rules: these spellings are replaced with `word` wherever they appear. */
  misheardAs: string[];
  /** Who put it here: the user, or learned from a fix they made after a paste. */
  source?: "you" | "learned";
  /** When it was added, in ms. */
  addedAt?: number;
  /**
   * For a learned word: what SUBXVoice had written instead. Shown in the dictionary and given to
   * the rewrite as a hint; never replaced blindly, because a common word ("seller's") would then
   * be changed in sentences that mean it.
   */
  writtenAs?: string[];
  /** The app the fix was made in, for the dictionary to say where it was learned. */
  learnedIn?: string;
}

/** Milliseconds spent in each pipeline stage. */
export interface Timings {
  sttMs: number;
  rulesMs: number;
  /** Records from before the server did the rewriting; new ones count it in `sttMs`. */
  llmMs?: number;
  insertMs: number;
  totalMs: number;
}

/** One dictation, as stored in local history. */
export interface SessionRecord {
  id: string;
  createdAt: number;
  mode: Mode;
  context: AppContext;
  rawText: string;
  finalText: string;
  audioPath?: string;
  /** Length of the recording. */
  audioMs?: number;
  /**
   * Set when rewriting or transliteration could not run, so the text went in as it was heard.
   * The words are never lost, but the user is told why they are in the wrong script.
   */
  rewriteError?: string;
  timings: Timings;
}
