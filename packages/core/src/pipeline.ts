import type { DeciderProvider } from "./contracts/decider";
import type { LlmProvider } from "./contracts/llm";
import type { TextInserter } from "./contracts/platform";
import type { DictionaryStore, HistoryStore } from "./contracts/store";
import type { SttProvider, Transcript } from "./contracts/stt";
import { SubxError } from "./errors";
import {
  dictationPrompt,
  emailPrompt,
  INTENT_CRITERIA,
  INTENT_QUESTION,
  messagePrompt,
  needsTransliteration,
  styleRewritePrompt,
  tidyDictation,
} from "./prompts";
import { Router } from "./router";
import { applyRules } from "./rules";
import type {
  AppContext,
  AudioClip,
  Intent,
  Mode,
  ScriptPreference,
  SessionRecord,
  WritingTone,
} from "./types";

/**
 * How sure the classifier must be before the user's own words are replaced by something written
 * for them. Set high on purpose: a missed "write an email" costs one retry, while a wrongly
 * composed email throws the dictation away and pastes an invention in its place.
 */
const INTENT_CONFIDENCE = 0.7;

/**
 * Trigger phrases are a stated intent, so they skip the classifier entirely — no round trip, no
 * threshold, no chance of being second-guessed. Anything the router does not recognise still goes
 * to the model.
 */
const TRIGGER_INTENT: Record<string, Intent> = {
  email: "email",
  slack_message: "message",
};

export interface PipelineDeps {
  stt: SttProvider;
  /** Needed for style mode only. */
  llm?: LlmProvider;
  /** Classifies dictation vs. "write me an email/message". Without it, only trigger phrases route. */
  decider?: DeciderProvider;
  inserter: TextInserter;
  history: HistoryStore;
  dictionary: DictionaryStore;
  router?: Router;
}

export type Outcome =
  /** `pasteError` is set when the text could not be typed; the dictation is still saved to history. */
  | { kind: "inserted"; record: SessionRecord; pasteError?: string }
  | { kind: "command"; command: string; rest: string; context: AppContext }
  | { kind: "empty" };

export interface ProcessOptions {
  /** Read from settings on every dictation, so changing it takes effect immediately. */
  script?: ScriptPreference;
  /** Shown while the LLM is still working, so the pill can display the raw words first. */
  onTranscript?: (text: string) => void;
  /** Tone for a composed email, from settings. */
  emailTone?: WritingTone;
  /** Tone for a composed chat message, from settings. */
  messageTone?: WritingTone;
  /** Signed off with, when the account has one. */
  userName?: string;
  /** Told as soon as the intent is known, so the pill can say "Writing an email…". */
  onIntent?: (intent: Intent) => void;
}

/**
 * A dictation in progress. Audio is pushed in as the user speaks; `finish` returns the final
 * outcome once they let go. This is what keeps release→paste fast: with a streaming STT plug the
 * words are recognised live, so only the last fragment is still outstanding at release.
 */
export interface DictationSession {
  /** Feed a chunk of 16 kHz mono PCM. Safe to call before the stream has finished opening. */
  push(samples: Int16Array): void;
  /** Stop, transcribe the rest, run rules/router/LLM, insert, and record. */
  finish(): Promise<Outcome>;
  /** Partial text recognised so far, for a live preview. "" until the plug reports something. */
  partial(): string;
}

/**
 * Words commands are made of, offered to speech recognition as likely when hearing a command.
 * Spoken among Hindi, "Pictures wale folder" came back as "search folder", "features wale folder"
 * and "इस तरह वाले folder" across seven tries, and every one of them searched the wrong place.
 */
const COMMAND_TERMS = [
  "Pictures",
  "Documents",
  "Downloads",
  "Desktop",
  "Videos",
  "Music",
  "folder",
  "File Explorer",
  "WhatsApp",
  "YouTube",
  "Chrome",
  "BlueStacks",
  "Notepad",
  "screenshot",
];

/** Added to the system prompt when an answer came back in the script it was meant to convert. */
const STILL_NATIVE =
  "IMPORTANT: every word of your reply must be in Latin (Roman) letters. Not one Devanagari " +
  "character may remain — a reply in Devanagari is wrong, however well it is punctuated.";

/** Audio in → text at the cursor. Talks only to plug-point interfaces, never to a vendor or OS. */
export class Pipeline {
  private readonly deps: PipelineDeps;
  private readonly router: Router;

  constructor(deps: PipelineDeps) {
    this.deps = deps;
    this.router = deps.router ?? new Router();
  }

  /**
   * Opens a streaming dictation. The STT stream (and its websocket) is opened now, so by the time
   * the user lets go it is warm and only the tail of the audio is left to finalise.
   */
  async open(mode: Mode, context: AppContext, options: ProcessOptions = {}): Promise<DictationSession> {
    const dictionary = await this.deps.dictionary.all();
    const vocabulary = dictionary.map((entry) => entry.word);

    // Prefer the live stream; fall back to buffering for plugs that only do batch (e.g. the fake).
    const stream = this.deps.stt.startStream ? await this.deps.stt.startStream({ vocabulary }) : null;
    const buffered: Int16Array[] = [];

    return {
      push: (samples) => {
        if (stream) stream.push(samples);
        else buffered.push(samples);
      },
      partial: () => stream?.partial() ?? "",
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

  /**
   * Hearing only: the same warm stream and dictionary corrections as dictation, and nothing after
   * — no routing, no rewrite, no paste, no history. Command mode takes the words from here and
   * decides for itself what to do with them.
   */
  async listen(): Promise<{ push(samples: Int16Array): void; finish(): Promise<string> }> {
    const dictionary = await this.deps.dictionary.all();
    const vocabulary = [...COMMAND_TERMS, ...dictionary.map((entry) => entry.word)];
    const stream = this.deps.stt.startStream ? await this.deps.stt.startStream({ vocabulary }) : null;
    const buffered: Int16Array[] = [];
    return {
      push: (samples) => {
        if (stream) stream.push(samples);
        else buffered.push(samples);
      },
      finish: async () => {
        const transcript = stream
          ? await stream.finish()
          : await this.deps.stt.transcribe({ samples: concat(buffered), sampleRate: 16000 }, { vocabulary });
        return applyRules(transcript.text, dictionary);
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

  /** Everything after speech-to-text: dictionary rules, routing, the LLM, insertion and history. */
  private async complete(
    transcript: Transcript,
    mode: Mode,
    context: AppContext,
    dictionary: Awaited<ReturnType<DictionaryStore["all"]>>,
    options: ProcessOptions,
    sttMs: number,
  ): Promise<Outcome> {
    const clock = stopwatch();
    const script = options.script ?? "roman";

    const text = applyRules(transcript.text, dictionary);
    const rulesMs = clock.lap();
    if (!text) return { kind: "empty" };
    options.onTranscript?.(text);

    const route = this.router.route(text, mode);
    const triggered = route.kind === "command" ? TRIGGER_INTENT[route.command] : undefined;
    // A command with no intent of its own is something else entirely — a custom trigger someone
    // added — and is handed back for the app to deal with.
    if (route.kind === "command" && !triggered) {
      return { kind: "command", command: route.command, rest: route.rest, context };
    }

    // The whole sentence goes to the writer, not route.rest: "to my manager about tomorrow's
    // leave" loses who it is for once the trigger is stripped.
    const intent = triggered ?? (await this.classify(text));
    options.onIntent?.(intent);

    // Composing replaces the user's words; dictating only rewrites their script. Either way one
    // model call, and either way a failure falls back to what was actually heard.
    const rewritten =
      intent === "dictation"
        ? await this.finalise(
            text,
            context,
            script,
            mode,
            dictionary.map((entry) => entry.word),
          )
        : await this.compose(text, intent, script, options);
    const finalText = rewritten.text;
    const llmMs = clock.lap();

    // A failed paste must never lose what the user said: record it anyway and report the error.
    let pasteError: string | undefined;
    try {
      await this.deps.inserter.insert(finalText);
    } catch (error) {
      pasteError = error instanceof Error ? error.message : String(error);
    }
    const insertMs = clock.lap();

    const record: SessionRecord = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      mode: mode,
      intent,
      context,
      rawText: transcript.text,
      finalText,
      ...(rewritten.error ? { rewriteError: rewritten.error } : {}),
      timings: { sttMs, rulesMs, llmMs, insertMs, totalMs: sttMs + clock.total() },
    };
    await this.deps.history.save(record);
    return pasteError ? { kind: "inserted", record, pasteError } : { kind: "inserted", record };
  }

  /**
   * What the speaker wanted: their words typed, or an email or message written for them.
   *
   * Falls back to plain dictation on anything unexpected — no classifier, a low-confidence
   * answer, or a failed call. That bias is deliberate: typing what someone said is never the
   * wrong thing to do, while composing when they did not ask for it destroys their dictation.
   */
  private async classify(text: string): Promise<Intent> {
    if (!this.deps.decider) return "dictation";
    try {
      const decision = await this.deps.decider.decide({
        state: [text],
        criteria: INTENT_CRITERIA,
        instructions: INTENT_QUESTION,
      });
      if (decision.confidence < INTENT_CONFIDENCE) return "dictation";
      return decision.choice as Intent;
    } catch {
      return "dictation";
    }
  }

  /** Writes the email or message the speaker described, instead of typing what they said. */
  private async compose(
    text: string,
    intent: Exclude<Intent, "dictation">,
    script: ScriptPreference,
    options: ProcessOptions,
  ): Promise<{ text: string; error?: string }> {
    if (!this.deps.llm) {
      return { text, error: "Writing is unavailable, so the words went in as heard." };
    }
    const tone = (intent === "email" ? options.emailTone : options.messageTone) ?? "professional";
    const system =
      intent === "email"
        ? emailPrompt({ tone, userName: options.userName })
        : messagePrompt({ tone, userName: options.userName }, script);
    try {
      const response = await this.deps.llm.complete({
        system,
        messages: [{ role: "user", content: text }],
        // Composing produces more than it is given, unlike transliteration.
        maxTokens: 2000,
      });
      const written = response.text.trim();
      if (!written) return { text, error: "Writing came back empty, so the words went in as heard." };
      return { text: written };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { text, error: `Writing failed (${reason}), so the words went in as heard.` };
    }
  }

  /**
   * The text as it should be typed, and why it is not, when it is not.
   *
   * The user's own words are never lost: if the model is missing or the call fails, what was heard
   * goes in unchanged. Returning the reason instead of swallowing it is the point — a dictation
   * that silently lands in Devanagari after the user asked for Roman looks like a broken feature
   * rather than a failed request.
   */
  private async finalise(
    text: string,
    context: AppContext,
    script: ScriptPreference,
    mode: Mode,
    vocabulary: string[] = [],
  ): Promise<{ text: string; error?: string }> {
    // Style mode exists to rewrite, so without a model there is nothing honest to return — the raw
    // words are not "styled" text. Exact mode is different: the words are already what was asked
    // for, only in the wrong script.
    if (mode === "style" && !this.deps.llm) {
      throw new SubxError("unsupported", "Style mode needs an LLM provider");
    }
    // Every Roman dictation goes to the model, English included: it is also where misheard words
    // are repaired and the chat style applied (user, 2026-11-16). That costs pure English about a
    // second it did not pay before. The native-script setting still skips the model.
    const wanted = mode === "style" || script === "roman";
    if (!wanted) return { text };
    // The last silent path: no model means the script stays as heard, and the user should know
    // that rather than conclude the setting does nothing. English needs no script change, so it
    // goes in as heard with nothing to report.
    if (!this.deps.llm) {
      return needsTransliteration(text, script)
        ? { text, error: "Rewriting is unavailable, so the words went in as heard." }
        : { text };
    }

    const casual = mode !== "style";
    const finish = (written: string) => (casual ? tidyDictation(written) : written);
    const system = casual ? dictationPrompt(vocabulary) : styleRewritePrompt(context, script);
    try {
      const response = await this.deps.llm.complete({
        system,
        messages: [{ role: "user", content: text }],
      });
      const rewritten = response.text.trim();
      if (!rewritten) return { text, error: "Rewriting came back empty, so the words went in as heard." };
      // Asked for Roman and still got Devanagari: the call succeeded but did not do the one thing
      // it was for, which from the outside is indistinguishable from the feature being broken.
      // Asked once more, firmly: on 2026-11-14 a 900-character dictation came back cleaned up but
      // still in Devanagari, while the same text sent again came back in Roman both times — the
      // first answer had come from a fallback upstream, not Groq.
      if (needsTransliteration(rewritten, script)) {
        const again = await this.deps.llm
          .complete({ system: `${system}\n\n${STILL_NATIVE}`, messages: [{ role: "user", content: text }] })
          .then((response) => response.text.trim())
          .catch(() => "");
        if (again && !needsTransliteration(again, script)) return { text: finish(again) };
        return { text: rewritten, error: "Rewriting left the text in its original script." };
      }
      return { text: finish(rewritten) };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { text, error: `Rewriting failed (${reason}), so the words went in as heard.` };
    }
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
