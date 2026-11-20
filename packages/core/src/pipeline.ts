import type { TextInserter } from "./contracts/platform";
import type { DictionaryStore, HistoryStore } from "./contracts/store";
import type { SttProvider, Transcript } from "./contracts/stt";
import { applyDictionary } from "./rules";
import type { AppContext, AudioClip, Mode, SessionRecord } from "./types";

export interface PipelineDeps {
  /** Hears the user and returns the finished text (our server: Soniox, then the rewrite). */
  stt: SttProvider;
  inserter: TextInserter;
  history: HistoryStore;
  dictionary: DictionaryStore;
}

export type Outcome =
  /**
   * `pasteError`: the text could not be typed (the dictation is still saved to history).
   * `nowhere`: nothing that takes text had the focus, so nothing was typed.
   */
  { kind: "inserted"; record: SessionRecord; pasteError?: string; nowhere?: true } | { kind: "empty" };

export interface ProcessOptions {
  /** The finished words, as soon as they are known, before they are pasted. */
  onTranscript?: (text: string) => void;
  /** The words recognised so far, while the user is still speaking. */
  onPartial?: (text: string) => void;
}

/**
 * A dictation in progress. Audio is pushed in as the user speaks; `finish` returns the outcome
 * once they let go. This is what keeps release→paste fast: the words are recognised (and
 * rewritten, on the server) while the user talks, so only the last fragment is left at release.
 */
export interface DictationSession {
  /** Feed a chunk of 16 kHz mono PCM. Safe to call before the stream has finished opening. */
  push(samples: Int16Array): void;
  /** Stop, take the finished text, apply the user's own rules, paste and record. */
  finish(): Promise<Outcome>;
  /** Partial text recognised so far, for a live preview. "" until the plug reports something. */
  partial(): string;
  /** Drop the dictation: nothing is typed and nothing is saved. */
  cancel(): void;
}

/**
 * Audio in → text at the cursor. The server hears and writes; what is left here is the user's own
 * replacement rules, the paste and the history. Talks only to plug-point interfaces.
 */
export class Pipeline {
  private readonly deps: PipelineDeps;

  constructor(deps: PipelineDeps) {
    this.deps = deps;
  }

  /**
   * Opens a streaming dictation. The STT stream (and its websocket) is opened now, so by the time
   * the user lets go it is warm and only the tail of the audio is left to finalise.
   */
  async open(mode: Mode, context: AppContext, options: ProcessOptions = {}): Promise<DictationSession> {
    const dictionary = await this.deps.dictionary.all();
    const vocabulary = dictionary.map((entry) => entry.word);
    // Each word with the spellings it has come out as, a hint for the server's rewrite.
    const hints = dictionary.map((entry) => ({
      word: entry.word,
      heard: [...entry.misheardAs, ...(entry.writtenAs ?? [])].slice(0, 5),
    }));
    const sttOptions = {
      vocabulary,
      hints,
      ...(context.appName ? { app: context.appName } : {}),
      ...(options.onPartial ? { onPartial: options.onPartial } : {}),
    };
    // Prefer the live stream; fall back to buffering for plugs that only do batch (the fake).
    const stream = this.deps.stt.startStream ? await this.deps.stt.startStream(sttOptions) : null;
    const buffered: Int16Array[] = [];

    return {
      push: (samples) => {
        if (stream) stream.push(samples);
        else buffered.push(samples);
      },
      partial: () => stream?.partial() ?? "",
      // Never through complete(): that is what types and records, and a cancel must do neither.
      cancel: () => {
        if (stream?.cancel) stream.cancel();
        else void stream?.finish().catch(() => {});
      },
      finish: async () => {
        // Clock starts at finish(), i.e. key-release: this is the tail the user actually waits on,
        // not the time already spent streaming while they spoke.
        const clock = stopwatch();
        const transcript: Transcript = stream
          ? await stream.finish()
          : await this.deps.stt.transcribe({ samples: concat(buffered), sampleRate: 16000 }, { vocabulary });
        return this.complete(transcript, mode, context, dictionary, options, clock.lap());
      },
    };
  }

  /** Batch entry point: the whole clip at once. Kept for tests and non-streaming callers. */
  async process(
    audio: AudioClip,
    mode: Mode,
    context: AppContext,
    options: ProcessOptions = {},
  ): Promise<Outcome> {
    const session = await this.open(mode, context, options);
    session.push(audio.samples);
    return session.finish();
  }

  /** After the server: the user's own replacement rules, the paste and the history. */
  private async complete(
    transcript: Transcript,
    mode: Mode,
    context: AppContext,
    dictionary: Awaited<ReturnType<DictionaryStore["all"]>>,
    options: ProcessOptions,
    sttMs: number,
  ): Promise<Outcome> {
    const clock = stopwatch();
    // Spacing is left alone: the server's line breaks (lists, emails) are part of the text.
    const text = applyDictionary(transcript.text, dictionary).trim();
    const rulesMs = clock.lap();
    if (!text) return { kind: "empty" };
    options.onTranscript?.(text);

    // A failed paste must never lose what the user said: record it anyway and report the error.
    let pasteError: string | undefined;
    let nowhere = false;
    try {
      nowhere = (await this.deps.inserter.insert(text)) === "nowhere";
    } catch (error) {
      pasteError = error instanceof Error ? error.message : String(error);
    }
    const insertMs = clock.lap();

    const record: SessionRecord = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      mode,
      context,
      rawText: transcript.raw ?? transcript.text,
      finalText: text,
      ...(transcript.rewriteError ? { rewriteError: transcript.rewriteError } : {}),
      timings: { sttMs, rulesMs, insertMs, totalMs: sttMs + clock.total() },
    };
    await this.deps.history.save(record);
    if (pasteError) return { kind: "inserted", record, pasteError };
    return nowhere ? { kind: "inserted", record, nowhere: true } : { kind: "inserted", record };
  }
}

function concat(chunks: Int16Array[]): Int16Array {
  const out = new Int16Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function stopwatch() {
  const start = performance.now();
  let last = start;
  return {
    lap() {
      const now = performance.now();
      const ms = Math.round(now - last);
      last = now;
      return ms;
    },
    total: () => Math.round(performance.now() - start),
  };
}
