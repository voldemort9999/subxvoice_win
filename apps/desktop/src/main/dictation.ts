import type { AudioClip, HotkeyEvent, Mode } from "@subx/core";
import type { PillState } from "../shared/ipc";
import { forPeople } from "../shared/plain-words";
import type { MicSource } from "./mic";
import type { PillWindow } from "./pill";

export const SAMPLE_RATE = 16000;
const MIN_HOLD_MS = 250; // a shorter press is an accidental tap
/** A second press this soon after a tap locks the dictation hands-free. */
const DOUBLE_TAP_MS = 400;
const RESULT_VISIBLE_MS = 1500;
/** Long enough to read "Added … to dictionary" and reach for Undo. */
const NOTICE_VISIBLE_MS = 5000;
/** "No text box · Copy": time to notice, move the mouse there and click (user, 2026-11-21: 15 s). */
const UNPLACED_VISIBLE_MS = 15_000;
/**
 * A run still processing after this is stuck, not slow: the pill once sat on "•••" until the app
 * was restarted, and every later key press was ignored because the state never left "processing".
 */
const STUCK_MS = 60_000;

/**
 * One dictation in flight. The engine opens an STT stream the moment the key goes down, so audio is
 * recognised while the user speaks and only the tail is left to finalise on release.
 */
export interface DictationRun {
  /** Feed a chunk of 16 kHz mono PCM. */
  push(samples: Int16Array): void;
  /**
   * Finalise: `clip` is the whole recording, kept for history audio. Returns the pill message and,
   * when the text could not be put in the script the user asked for, the reason.
   */
  finish(clip: AudioClip): Promise<{ text: string; warning?: string; nowhere?: boolean }>;
  /** Discard without typing anything. */
  cancel(): void;
}

export interface DictationEngine {
  /** Open a session for one dictation. Called on key-press. */
  open(mode: Mode): Promise<DictationRun>;
}

export interface DictationHooks {
  /**
   * The microphone is live (true), and then no longer (false): finished, cancelled or failed.
   * Called exactly once each way per dictation. Sounds, muting and Esc hang off this.
   */
  listening?(on: boolean): void;
  /** A message the user should notice (a learned word, nowhere to type) has just appeared. */
  alert?(): void;
}

/**
 * Turns hotkey events into pill states, streaming audio to the engine as the user speaks.
 *
 * Two ways to dictate: hold the key and let go; or tap it twice and talk with hands free, then
 * press it once more to finish. Esc (or any other key while holding) cancels either.
 */
export class DictationController {
  private readonly pill: PillWindow;
  private readonly mic: MicSource;
  private readonly engine: DictationEngine;
  private readonly hooks: DictationHooks;
  private state: "idle" | "listening" | "processing" = "idle";
  /** The screen is locked; see setLocked. */
  private screenLocked = false;
  /** Hands-free: the key is no longer held, and the next press finishes. */
  private locked = false;
  /** A tap was released; a second press inside DOUBLE_TAP_MS locks, otherwise it is cancelled. */
  private tapTimer: NodeJS.Timeout | undefined;
  private live = false;
  private text = "";
  private mode: Mode = "exact";
  private pressedAt = 0;
  private chunks: Int16Array[] = [];
  /** Audio captured before the STT stream finished opening; flushed once it is ready. */
  private pending: Int16Array[] = [];
  private run: DictationRun | null = null;
  private opening: Promise<void> = Promise.resolve();
  private resetTimer: NodeJS.Timeout | undefined;
  /** A notice that arrived while a dictation or its result was on the pill; shown after. */
  private queued: PillState | null = null;
  /** Where a run is, so a stuck one says in the log where it stopped. */
  private stage = "";
  /**
   * Which press the fields above belong to. A tap's cancel waits for its stream to open, and by
   * then the next press has started: the old cancel then cleared the new press's `run`, its audio
   * piled up in `pending`, and its release found no run and returned with the pill on "•••" — and
   * every press after it ignored, for good. Work from an older press checks this and keeps out.
   */
  private press = 0;

  constructor(pill: PillWindow, mic: MicSource, engine: DictationEngine, hooks: DictationHooks = {}) {
    this.pill = pill;
    this.mic = mic;
    this.engine = engine;
    this.hooks = hooks;
  }

  /**
   * The Mac is locked: no dictation starts, and one already running is dropped without typing.
   * Speech on the lock screen would otherwise be recorded and typed into the login window.
   */
  setLocked(locked: boolean): void {
    this.screenLocked = locked;
    if (locked && this.state === "listening") void this.cancel();
  }

  handleHotkey(event: HotkeyEvent): void {
    if (this.screenLocked) return;
    if (event.type === "cancel") {
      if (this.state === "listening") void this.cancel();
      return;
    }
    if (event.type === "pressed") {
      if (this.state === "idle") this.start(event.mode);
      else if (this.state === "listening" && this.tapTimer) this.lock();
      else if (this.state === "listening" && this.locked) void this.finish();
      return;
    }
    // Released. In hands-free mode the key is not held, so its releases mean nothing.
    if (this.state !== "listening" || this.locked) return;
    if (Date.now() - this.pressedAt < MIN_HOLD_MS) {
      // Either an accidental tap or the first half of a double tap: wait to see which.
      this.tapTimer = setTimeout(() => {
        this.tapTimer = undefined;
        void this.cancel();
      }, DOUBLE_TAP_MS);
      return;
    }
    void this.finish();
  }

  /**
   * Something to tell the user that is not about the dictation in hand ("Added Aarnav to
   * dictionary"). Never covers a dictation: it waits until the pill has nothing else to show.
   */
  notice(state: PillState): void {
    if (this.state !== "idle" || this.resetTimer) {
      this.queued = state;
      return;
    }
    this.show(state, NOTICE_VISIBLE_MS);
  }

  /** A made-up state on the real pill, from Settings; never over a dictation. */
  demo(state: PillState): void {
    if (this.state !== "idle") return;
    this.show(state, NOTICE_VISIBLE_MS, true);
  }

  /** A short confirmation once the user has acted on the pill (Copy). */
  confirm(message: string): void {
    if (this.state !== "idle") return;
    this.show({ kind: "done", message }, RESULT_VISIBLE_MS);
  }

  /** Back to idle now, e.g. once the user has acted on a notice. */
  dismiss(): void {
    if (this.state !== "idle") return;
    clearTimeout(this.resetTimer);
    this.resetTimer = undefined;
    this.pill.setState({ kind: "idle" });
  }

  /** Words heard so far, shown in the pill while the user is still speaking. */
  heard(text: string): void {
    if (this.state !== "listening") return;
    this.text = text;
    this.showListening();
  }

  private lock(): void {
    clearTimeout(this.tapTimer);
    this.tapTimer = undefined;
    this.locked = true;
    this.showListening();
  }

  private showListening(): void {
    this.pill.setState({
      kind: "listening",
      ...(this.locked ? { locked: true } : {}),
      ...(this.text ? { text: this.text } : {}),
    });
  }

  /** Fires the hooks once per change, however many paths lead out of listening. */
  private setLive(on: boolean): void {
    if (on === this.live) return;
    this.live = on;
    this.hooks.listening?.(on);
  }

  private start(mode: Mode): void {
    clearTimeout(this.resetTimer);
    this.resetTimer = undefined;
    const press = ++this.press;
    this.state = "listening";
    this.locked = false;
    this.text = "";
    this.setLive(true);
    this.mode = mode;
    this.pressedAt = Date.now();
    this.chunks = [];
    this.pending = [];
    this.run = null;
    // Not just repositioned: every dictation is a chance to notice the pill has died and
    // bring it back, which is the moment the user would otherwise find it missing.
    this.pill.revive();
    this.pill.setState({ kind: "listening" });

    // Open the STT stream and the mic together, so neither waits on the other. Chunks that arrive
    // before the stream is ready are held in `pending` and flushed the moment it opens.
    this.opening = this.engine
      .open(mode)
      .then((run) => {
        if (press !== this.press || this.state === "idle") {
          run.cancel(); // cancelled during the ~200 ms open, or a newer press has taken over
          return;
        }
        this.run = run;
        for (const chunk of this.pending) run.push(chunk);
        this.pending = [];
      })
      .catch((error: unknown) => {
        if (press === this.press) this.failOpen(error);
      });

    this.mic
      .start((samples) => {
        this.chunks.push(samples);
        this.pill.level(rms(samples));
        if (this.run) this.run.push(samples);
        else this.pending.push(samples);
      })
      .catch((error: unknown) => {
        if (this.state !== "listening") return;
        this.chunks = [];
        this.setLive(false);
        this.showResult({ kind: "error", message: message(error) });
      });
  }

  private async finish(): Promise<void> {
    clearTimeout(this.tapTimer);
    this.tapTimer = undefined;
    this.locked = false;
    this.setLive(false);
    this.state = "processing";
    this.pill.setState({ kind: "processing" });
    const started = Date.now();
    const watchdog = setTimeout(() => {
      if (this.state !== "processing") return;
      console.log(`dictation: stuck for ${STUCK_MS / 1000} s at "${this.stage}" — released`);
      this.showResult({ kind: "error", message: "That took too long. Try again." });
    }, STUCK_MS);
    this.stage = "stopping the microphone";
    await this.mic.stop();
    this.stage = "waiting for the speech stream to open";
    await this.opening; // make sure the stream finished opening (or failed)

    const clip: AudioClip = { samples: concat(this.chunks), sampleRate: SAMPLE_RATE };
    this.chunks = [];
    const run = this.run;
    this.run = null;
    if (!run) {
      clearTimeout(watchdog);
      // Usually the open failed and failOpen already showed why. If nothing did, saying so here is
      // what keeps "processing" from outliving the run — the pill stuck on "•••" came from this.
      if (this.state === "processing") {
        console.log("dictation: released with no speech stream — nothing to finish");
        this.showResult({ kind: "error", message: "Couldn't start listening. Try again." });
      }
      return;
    }

    this.stage = "finishing (transcript, then the command or the paste)";
    try {
      const result = await run.finish(clip);
      if (this.state === "processing" && result.nowhere) {
        // Nowhere to type it: offered for longer, since the user has to act on it.
        this.state = "idle";
        this.show({ kind: "unplaced", text: result.text }, UNPLACED_VISIBLE_MS);
      } else if (this.state === "processing")
        this.showResult({ kind: "done", message: result.text, warning: result.warning });
    } catch (error) {
      if (this.state === "processing") this.showResult({ kind: "error", message: message(error) });
    } finally {
      clearTimeout(watchdog);
      const took = Date.now() - started;
      if (took > 15_000) console.log(`dictation: slow — ${took} ms, last at "${this.stage}"`);
    }
  }

  private async cancel(): Promise<void> {
    const press = this.press;
    clearTimeout(this.tapTimer);
    this.tapTimer = undefined;
    this.locked = false;
    this.setLive(false);
    this.state = "idle";
    const queued = this.queued;
    this.queued = null;
    if (queued) this.show(queued, NOTICE_VISIBLE_MS);
    else this.pill.setState({ kind: "idle" });
    await this.mic.stop();
    await this.opening;
    // A new press may have started while this waited; its run and audio are not this one's to drop.
    if (press !== this.press) return;
    this.run?.cancel();
    this.run = null;
    this.chunks = [];
    this.pending = [];
  }

  private failOpen(error: unknown): void {
    if (this.state === "idle") return;
    this.run = null;
    this.pending = [];
    this.locked = false;
    clearTimeout(this.tapTimer);
    this.tapTimer = undefined;
    this.setLive(false);
    void this.mic.stop();
    this.showResult({ kind: "error", message: message(error) });
  }

  /** Shows the result briefly; a new dictation can start right away. */
  private showResult(state: PillState): void {
    this.state = "idle";
    this.show(state, RESULT_VISIBLE_MS);
  }

  private show(state: PillState, ms: number, demo = false): void {
    clearTimeout(this.resetTimer);
    this.pill.setState(state, demo);
    // Heard as well as seen: these wait for the user to act, and the pill may be out of view.
    if (state.kind === "learned" || state.kind === "unplaced") this.hooks.alert?.();
    this.resetTimer = setTimeout(() => {
      this.resetTimer = undefined;
      if (this.state !== "idle") return;
      const queued = this.queued;
      this.queued = null;
      if (queued) this.show(queued, NOTICE_VISIBLE_MS);
      else this.pill.setState({ kind: "idle" });
    }, ms);
  }
}

/** What the pill says about a failure: our own sentence, or a plain one with the original logged. */
function message(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (forPeople(raw)) return raw.trim();
  console.error(`dictation: ${raw}`);
  return "That didn't work. Try again.";
}

function rms(samples: Int16Array): number {
  let sumSquares = 0;
  for (const sample of samples) sumSquares += (sample / 32768) ** 2;
  return Math.sqrt(sumSquares / Math.max(1, samples.length));
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
