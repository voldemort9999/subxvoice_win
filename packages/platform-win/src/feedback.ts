import type { AudioFeedback } from "@subx/core";

/**
 * The Mac app's start/stop sounds and "mute other audio while dictating", on Windows (Mac UI port,
 * 2026-11-19). The sounds are made here as short WAVs and played from memory, asynchronously, so a
 * cue never waits on a file or delays the dictation it marks.
 */

export interface FeedbackDeps {
  /** Starts playing a WAV and returns at once (PlaySoundW, SND_MEMORY | SND_ASYNC). */
  play(wav: Buffer): void;
  isMuted(): Promise<boolean>;
  setMuted(on: boolean): Promise<void>;
}

const RATE = 22_050;

/** A WAV of each frequency in turn, `ms` each, quiet and faded so it never clicks. */
export function tone(freqs: number[], ms: number, volume = 0.18): Buffer {
  const per = Math.round((RATE * ms) / 1000);
  const fade = Math.round(RATE * 0.008);
  const samples = per * freqs.length;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(RATE, 24);
  wav.writeUInt32LE(RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(samples * 2, 40);
  freqs.forEach((freq, n) => {
    for (let i = 0; i < per; i++) {
      const edge = Math.min(1, i / fade, (per - i) / fade);
      const value = Math.sin((2 * Math.PI * freq * i) / RATE) * volume * edge;
      wav.writeInt16LE(Math.round(value * 32767), 44 + (n * per + i) * 2);
    }
  });
  return wav;
}

const SOUNDS = {
  start: tone([660, 880], 55),
  stop: tone([880, 660], 55),
  notice: tone([990], 90),
} as const;

export class WinAudioFeedback implements AudioFeedback {
  /** Whether we muted the output (so only we unmute it); null while nothing is ours. */
  private ours: boolean | null = null;
  /** Mute and unmute run in order: a quick start/stop must not unmute before the mute landed. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: FeedbackDeps) {}

  cue(sound: "start" | "stop" | "notice"): void {
    this.deps.play(SOUNDS[sound]);
  }

  muteOutput(on: boolean): void {
    this.queue = this.queue
      .then(async () => {
        if (on) {
          if (this.ours !== null) return;
          // Already muted by the user: leave it, and leave it muted afterwards.
          this.ours = !(await this.deps.isMuted());
          if (this.ours) await this.deps.setMuted(true);
        } else {
          const ours = this.ours;
          this.ours = null;
          if (ours) await this.deps.setMuted(false);
        }
      })
      .catch((error) => console.warn("[feedback] mute failed:", error));
  }
}
