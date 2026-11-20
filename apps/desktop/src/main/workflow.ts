// The dictation workflow: one place that owns what happens between the key going down and the
// text landing at the cursor.
//
//   key down ──► open the server socket ──► stream audio while speaking
//   key up   ──► the server finishes the text ──► your dictionary ──► paste ──► history
//
// The controller above it only knows about the hotkey, the pill and the microphone; the pipeline
// below it only knows about plug-point interfaces. Everything app-specific — which settings apply,
// what the pill says, where the audio file goes, what a failure reads like — lives here.
import type {
  AppContext,
  AudioClip,
  ContextReader,
  Mode,
  Pipeline,
  SessionRecord,
  Transcript,
} from "@subx/core";
import type { DictationEngine, DictationRun } from "./dictation";

export interface WorkflowDeps {
  pipeline: Pipeline;
  context: ContextReader;
  history: {
    save(record: SessionRecord): Promise<void>;
    attachAudio(id: string, audioPath: string, audioMs: number): Promise<void>;
  };
  saveRecording(clip: AudioClip): Promise<string>;
  /** The finished words, shown in the pill as they are pasted. */
  onHeard(text: string): void;
  /** Words recognised so far, while the user is still speaking. */
  onPartial?(text: string): void;
  onHistoryChanged(): void;
  /** The text is at the cursor, so whatever the user now fixes in it can be learned. */
  onPasted?(text: string, app?: string): void;
  /** Whether an account is signed in. Dictation runs on its session, so without one it refuses. */
  signedIn?(): Promise<boolean>;
  /**
   * Today's remaining dictation seconds, asked for only when opening fails — the happy path must
   * not pay for a round trip it does not need.
   */
  remainingSeconds?(): Promise<number | null>;
  log?(line: string): void;
  /** Hearing alone, for the command key: the same server socket, nothing pasted or recorded. */
  listen?(): Promise<{ push(samples: Int16Array): void; finish(): Promise<Transcript>; cancel(): void }>;
  /** Follow My Words: the assistant takes the words; returns the pill's acknowledgement. */
  follow?(said: string): string;
}

export function createWorkflow(deps: WorkflowDeps): DictationEngine {
  return {
    async open(mode: Mode): Promise<DictationRun> {
      // Checked before the microphone opens: signing out must stop dictation, not merely make it
      // fail at the far end of a network call.
      if (deps.signedIn && !(await deps.signedIn().catch(() => false))) {
        throw new Error("Sign in to SUBXVoice to dictate.");
      }

      if (mode === "command") return openCommand(deps);

      const context = await deps.context.current().catch(() => ({}) as AppContext);
      // The lock or login screen is in front: nothing is recorded there, even if the lock event
      // was missed (it is the second guard; DictationController.setLocked is the first).
      if (context.appId === "com.apple.loginwindow" || context.appName === "loginwindow") {
        throw new Error("Unlock your PC to dictate.");
      }

      // Opening here, on key-press, is what keeps release→paste short: the socket is already
      // warm and the words are recognised while the user is still speaking.
      let session: Awaited<ReturnType<Pipeline["open"]>>;
      try {
        session = await deps.pipeline.open(mode, context, {
          onTranscript: deps.onHeard,
          ...(deps.onPartial ? { onPartial: deps.onPartial } : {}),
        });
      } catch (error) {
        throw await explain(deps, error);
      }

      return {
        push: (samples) => session.push(samples),
        finish: async (clip) => {
          const outcome = await session.finish();

          if (outcome.kind === "empty") {
            deps.log?.("dictation: nothing heard");
            return { text: "Nothing heard" };
          }
          const { record } = outcome;
          deps.onHistoryChanged();
          // The text is already at the cursor; the recording is written afterwards so disk I/O
          // never sits on the user's critical path.
          void keepAudio(deps, clip, record.id);
          deps.log?.(summarise(record, outcome.pasteError));
          // The transcript is saved either way; a failed paste is surfaced so the pill shows why
          // nothing appeared, rather than silently doing nothing.
          if (outcome.pasteError) throw new Error(outcome.pasteError);
          // Not pasted anywhere, so there is no field to learn from.
          if (outcome.nowhere) return { text: record.finalText, nowhere: true };
          deps.onPasted?.(record.finalText, record.context.appName);
          return { text: record.finalText, warning: record.rewriteError };
        },
        // Not finish(): that would type and record what was said, which is what cancel undoes.
        cancel: () => session.cancel(),
      };
    },
  };
}

/**
 * The command key: the words go to the assistant, whose run outlives this key press and answers
 * through the capsule. The server's rewrite is for pasting; a command is read as it was heard
 * (`raw`), so "WhatsApp par Priya ko hi bhejo" is never turned into a polished sentence first.
 */
async function openCommand(deps: WorkflowDeps): Promise<DictationRun> {
  const { listen, follow } = deps;
  if (!listen || !follow) throw new Error("Follow My Words isn't available on this computer");
  let hearing: Awaited<ReturnType<NonNullable<WorkflowDeps["listen"]>>>;
  try {
    hearing = await listen();
  } catch (error) {
    throw await explain(deps, error);
  }
  return {
    push: (samples) => hearing.push(samples),
    finish: async () => {
      const heard = await hearing.finish();
      const said = (heard.raw ?? heard.text).trim();
      if (!said) return { text: "Nothing heard" };
      deps.onHeard(said);
      deps.log?.(`command: "${said}"`);
      return { text: follow(said) };
    },
    cancel: () => hearing.cancel(),
  };
}

/**
 * The backend refuses an exhausted account before the upgrade, which reaches the app as a plain
 * connection failure. Saying "sign in again" there would send the user nowhere.
 */
async function explain(deps: WorkflowDeps, error: unknown): Promise<unknown> {
  const remaining = await deps.remainingSeconds?.().catch(() => null);
  if (remaining !== null && remaining !== undefined && remaining <= 0) {
    return new Error("You've used today's dictation time. It resets tomorrow.");
  }
  return error;
}

async function keepAudio(deps: WorkflowDeps, clip: AudioClip, id: string): Promise<void> {
  try {
    await deps.history.attachAudio(id, await deps.saveRecording(clip), durationMs(clip));
    deps.onHistoryChanged();
  } catch (error) {
    deps.log?.(`dictation: could not save audio — ${message(error)}`);
  }
}

const durationMs = (clip: AudioClip) => Math.round((clip.samples.length / clip.sampleRate) * 1000);

/** One line per dictation, so a wrong result or a slow stage is obvious without a debugger. */
function summarise(record: SessionRecord, pasteError?: string): string {
  const { sttMs, insertMs, totalMs } = record.timings;
  const changed = record.rawText !== record.finalText;
  const tail = pasteError
    ? ` | PASTE FAILED: ${pasteError}`
    : ` | server ${sttMs}ms · insert ${insertMs}ms · total ${totalMs}ms`;
  // The server pastes the words as heard when its rewrite fails (a Hinglish reply still in
  // Devanagari twice, a timeout); without the reason the log could not tell that from a good result.
  const why = record.rewriteError ? ` | REWRITE FAILED: ${record.rewriteError}` : "";
  return `dictation: "${record.rawText}"${changed ? ` → "${record.finalText}"` : " (unchanged)"}${tail}${why}`;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
