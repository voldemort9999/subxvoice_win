import type { AudioClip } from "../types";

export interface SttCapabilities {
  /** Can return text while the user is still speaking. */
  streaming: boolean;
  /** Handles language switches mid-sentence (e.g. Hindi → English → Spanish). */
  codeSwitching: boolean;
  /** Accepts dictionary words as recognition hints. */
  vocabularyHints: boolean;
}

export interface SttOptions {
  /** Words from the user's dictionary. */
  vocabulary: string[];
  /** The same words with the spellings they have come out as before, for plugs that can use them. */
  hints?: { word: string; heard: string[] }[];
  /** Leave empty to auto-detect — we never force one language. */
  languageHint?: string;
  /** The app the words will be pasted into, for plugs that shape the text by app (our backend). */
  app?: string;
  /** Called with the words recognised so far, each time they change, for a live preview. */
  onPartial?: (text: string) => void;
}

export interface Transcript {
  text: string;
  /** Detected languages in order of appearance, e.g. ["hi", "en"]. */
  languages: string[];
  confidence?: number;
  /** What the recogniser heard, before the server rewrote it. */
  raw?: string;
  /** Why the server returned the words as heard instead of rewriting them. */
  rewriteError?: string;
}

/** Speech → text. One implementation per vendor (or our own model). */
export interface SttProvider {
  readonly id: string;
  readonly capabilities: SttCapabilities;
  transcribe(audio: AudioClip, options: SttOptions): Promise<Transcript>;
  /** Only present when `capabilities.streaming` is true. */
  startStream?(options: SttOptions): Promise<SttStream>;
}

export interface SttStream {
  push(samples: Int16Array): void;
  /** Text recognised so far; may still change. */
  partial(): string;
  finish(): Promise<Transcript>;
  /** Close without a result. Absent: the stream is drained with `finish` and its result dropped. */
  cancel?(): void;
}
