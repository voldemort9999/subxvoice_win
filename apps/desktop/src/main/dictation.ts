import type { AudioClip, HotkeyEvent, Mode } from "@subx/core";
import type { PillState } from "../shared/ipc";
import type { MicSource } from "./mic";
import type { PillWindow } from "./pill";

const SAMPLE_RATE = 16000;
const MIN_HOLD_MS = 250; // a shorter press is an accidental tap
const RESULT_VISIBLE_MS = 1500;
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
  finish(clip: AudioClip): Promise<{ text: string; warning?: string }>;
  /** Discard without typing anything. */
  cancel(): void;
}

export interface DictationEngine {
  /** Open a session for one dictation. Called on key-press. */
  open(mode: Mode): Promise<DictationRun>;
}

/** Turns hotkey events into pill states, streaming audio to the engine as the user speaks. */
export class DictationController {
  private readonly pill: PillWindow;
  private readonly mic: MicSource;
  private readonly engine: DictationEngine;
  private state: "idle" | "listening" | "processing" = "idle";
  private mode: Mode = "exact";
  private pressedAt = 0;
  private chunks: Int16Array[] = [];
  /** Audio captured before the STT stream finished opening; flushed once it is ready. */
  private pending: Int16Array[] = [];
  private run: DictationRun | null = null;
  private opening: Promise<void> = Promise.resolve();
  private resetTimer: NodeJS.Timeout | undefined;
  /** Where a run is, so a stuck one says in the log where it stopped. */
  private stage = "";
  /**
   * Which press the fields above belong to. A tap's cancel waits for its stream to open, and by
   * then the next press has started: the old cancel then cleared the new press's `run`, its audio
   * piled up in `pending`, and its release found no run and returned with the pill on "•••" — and
   * every press after it ignored, for good. Work from an older press checks this and keeps out.
   */
  private press = 0;

  constructor(pill: PillWindow, mic: MicSource, engine: DictationEngine) {
    this.pill = pill;
    this.mic = mic;
    this.engine = engine;
  }

  handleHotkey(event: HotkeyEvent): void {
    if (event.type === "pressed" && this.state === "idle") this.start(event.mode);
    else if (event.type === "released" && this.state === "listening") void this.finish();
    else if (event.type === "cancel" && this.state === "listening") void this.cancel();
  }

  private start(mode: Mode): void {
    clearTimeout(this.resetTimer);
    const press = ++this.press;
    this.state = "listening";
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
        this.showResult({ kind: "error", message: message(error) });
      });
  }

  private async finish(): Promise<void> {
    if (Date.now() - this.pressedAt < MIN_HOLD_MS) {
      await this.cancel();
      return;
    }
    this.state = "processing";
    this.pill.setState({ kind: "processing" });
    const started = Date.now();
    const watchdog = setTimeout(() => {
      if (this.state !== "processing") return;
      console.log(`dictation: stuck for ${STUCK_MS / 1000} s at "${this.stage}" — released`);
      this.showResult({ kind: "error", message: "That took too long — try again" });
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
        this.showResult({ kind: "error", message: "Couldn't start listening — try again" });
      }
      return;
    }

    this.stage = "finishing (transcript, then the command or the paste)";
    try {
      const result = await run.finish(clip);
      if (this.state === "processing")
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
    this.state = "idle";
    this.pill.setState({ kind: "idle" });
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
    void this.mic.stop();
    this.showResult({ kind: "error", message: message(error) });
  }

  /** Shows the result briefly; a new dictation can start right away. */
  private showResult(state: PillState): void {
    this.state = "idle";
    this.pill.setState(state);
    this.resetTimer = setTimeout(() => this.pill.setState({ kind: "idle" }), RESULT_VISIBLE_MS);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
