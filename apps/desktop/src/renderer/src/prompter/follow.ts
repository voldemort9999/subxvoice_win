/**
 * How the teleprompter moves: Glide (comes up to speed and to rest gently), Syllables (how long a
 * text takes to say, in any script), Pace (how much of a script has been read, from the voice) and
 * VoiceActivity (whether someone is speaking, from the microphone's sound alone, in any language).
 * Ported from the Mac app's SUBXCore (bff5b3e, 6c30257), number for number; nothing here sends,
 * records or recognises words.
 */

// ---------------------------------------------------------------------------------------------
// Glide

/**
 * How far the text has risen, as it goes and stops. It never jumps between moving and still: it
 * takes a quarter of a second to come up to speed and a little longer to come to rest, which reads
 * as calm when a voice starts and stops many times a minute. Worked out from the times it was told
 * to go or stop, so the screen can ask at any moment without it being stepped on a timer.
 */
export class Glide {
  static readonly speedUp = 0.25;
  static readonly slowDown = 0.35;

  /** Where it was, how fast (0 to 1 of `speed`), and where that was heading, at `since`. */
  private base = 0;
  private since = 0;
  private from = 0;
  private to = 0;

  /** Points a second at full speed. */
  constructor(public speed: number) {}

  /** Moving (up to speed) or coming to rest, from `time` on. */
  go(on: boolean, time: number): void {
    const target = on ? 1 : 0;
    if (target === this.to) return;
    this.settle(time);
    this.to = target;
  }

  /** A new speed counts from `time`, not from the start. */
  setSpeed(speed: number, time: number): void {
    this.settle(time);
    this.speed = speed;
  }

  /** Back to the top, still. */
  reset(time: number): void {
    this.base = 0;
    this.since = time;
    this.from = 0;
    this.to = 0;
  }

  /** Points risen by `time`. */
  position(time: number): number {
    const dt = Math.max(time - this.since, 0);
    const ramp = this.rampTime();
    if (dt <= ramp) {
      const slope = this.to > this.from ? 1 / Glide.speedUp : -1 / Glide.slowDown;
      return this.base + this.speed * (this.from * dt + (slope * dt * dt) / 2);
    }
    return this.base + this.speed * (((this.from + this.to) / 2) * ramp + this.to * (dt - ramp));
  }

  /** How fast, 0 to 1 of `speed`, at `time`. */
  pace(time: number): number {
    const dt = Math.max(time - this.since, 0);
    if (dt >= this.rampTime()) return this.to;
    return this.to > this.from ? this.from + dt / Glide.speedUp : this.from - dt / Glide.slowDown;
  }

  /** Still, and staying so, from `time`: nothing to draw until it goes again. */
  resting(time: number): boolean {
    return this.to === 0 && this.pace(time) === 0;
  }

  private rampTime(): number {
    return this.to > this.from
      ? (this.to - this.from) * Glide.speedUp
      : (this.from - this.to) * Glide.slowDown;
  }

  private settle(time: number): void {
    const now = Math.max(time, this.since);
    this.base = this.position(now);
    this.from = this.pace(now);
    this.since = now;
  }
}

// ---------------------------------------------------------------------------------------------
// Syllables

const ALPHABETIC = /\p{Alphabetic}/u;
const MARK = /\p{M}/u;
const VOWELS = new Set([..."aeiouyæøœ", ..."аеёиоуыэюяіїєў", ..."αεηιουω"]);
/** Kana said with the one before, and the long-vowel mark: no syllable of their own. */
const SMALL_KANA = new Set([
  0x3041, 0x3043, 0x3045, 0x3047, 0x3049, 0x3063, 0x3083, 0x3085, 0x3087, 0x308e, 0x30a1, 0x30a3, 0x30a5,
  0x30a7, 0x30a9, 0x30c3, 0x30e3, 0x30e5, 0x30e7, 0x30ee, 0x30fc, 0x30fb,
]);

type Kind = "alphabet" | "syllabic" | "kana" | "abjad" | "other";
const inRange = (v: number, ranges: [number, number][]) => ranges.some(([a, b]) => v >= a && v <= b);
function kindOf(v: number): Kind {
  if (
    inRange(v, [
      [0x41, 0x24f],
      [0x1e00, 0x1eff],
      [0x370, 0x3ff],
      [0x1f00, 0x1fff],
      [0x400, 0x52f],
    ])
  )
    return "alphabet";
  if (
    inRange(v, [
      [0x900, 0xdff],
      [0xe00, 0xeff],
      [0xf00, 0xfff],
      [0x1000, 0x109f],
      [0x1780, 0x17ff],
      [0x1200, 0x137f],
      [0x3400, 0x4dbf],
      [0x4e00, 0x9fff],
      [0xf900, 0xfaff],
      [0xac00, 0xd7af],
    ])
  )
    return "syllabic";
  if (v >= 0x3040 && v <= 0x30ff) return "kana";
  if (
    inRange(v, [
      [0x590, 0x5ff],
      [0x600, 0x6ff],
      [0x750, 0x77f],
      [0x8a0, 0x8ff],
      [0xfb1d, 0xfdff],
      [0xfe70, 0xfeff],
    ])
  )
    return "abjad";
  return "other";
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * About how many syllables a text takes to say, in any script, without knowing its words (the Mac's
 * Syllables). Latin, Cyrillic, Greek: groups of vowel letters in a word. The scripts of South and
 * Southeast Asia: written syllables. Chinese characters, Korean blocks, Ethiopic, kana: one each
 * (not small kana). Arabic, Hebrew: half a letter. Digits: one and a half each.
 */
export function syllables(text: string): number {
  let total = 0;
  let groups = 0;
  let letters = 0;
  let inVowels = false;
  let digits = 0;
  const endWord = () => {
    if (letters > 0) total += Math.max(groups, 1);
    groups = 0;
    letters = 0;
    inVowels = false;
    total += digits * 1.5;
    digits = 0;
  };
  for (const { segment } of graphemes.segment(text)) {
    const first = segment.codePointAt(0) ?? 0;
    const scalar = String.fromCodePoint(first);
    const alphabetic = ALPHABETIC.test(scalar);
    switch (kindOf(first)) {
      case "alphabet": {
        if (!alphabetic) {
          endWord();
          break;
        }
        letters += 1;
        const base = segment.normalize("NFD").charAt(0).toLowerCase();
        if (VOWELS.has(base)) {
          if (!inVowels) groups += 1;
          inVowels = true;
        } else inVowels = false;
        break;
      }
      case "syllabic":
        endWord();
        if (alphabetic) total += 1;
        break;
      case "kana":
        endWord();
        if (!SMALL_KANA.has(first)) total += 1;
        break;
      case "abjad":
        endWord();
        if (alphabetic && !MARK.test(scalar)) total += 0.5;
        break;
      default:
        if (/^[0-9]$/.test(segment)) {
          if (letters > 0) endWord();
          digits += 1;
        } else if (alphabetic) {
          endWord();
          total += 0.5;
        } else endWord();
    }
  }
  endWord();
  return total;
}

// ---------------------------------------------------------------------------------------------
// Pace

export interface PaceLanguage {
  /** Syllables heard for each syllable written. */
  heardPerWritten: number;
  /** Syllables of text said in a second of speaking. */
  writtenPerSecond: number;
  /** How much the syllables count (the rest is the seconds). */
  bySound: number;
}

const L = (heardPerWritten: number, writtenPerSecond: number, bySound: number): PaceLanguage => ({
  heardPerWritten,
  writtenPerSecond,
  bySound,
});

/** Per language, measured on FLEURS with the Mac's voice bench (2026-11-24). */
export const PACE_LANGUAGES: Record<string, PaceLanguage> = {
  ar: L(0.84, 5.04, 0.5),
  bn: L(0.7, 5.33, 0.3),
  "zh-Hans": L(0.72, 5.2, 0),
  "zh-Hant": L(0.72, 5.2, 0),
  de: L(0.89, 4.76, 0.5),
  en: L(0.72, 5.16, 0.7),
  es: L(0.75, 5.76, 0),
  fr: L(0.7, 6.21, 0.5),
  hi: L(0.65, 6.74, 1),
  ja: L(0.67, 6.07, 0.5),
  ru: L(0.81, 5.28, 0.7),
  sw: L(0.64, 4.9, 0.5),
  ta: L(0.51, 7.81, 0.3),
  th: L(0.38, 10.19, 1),
  ur: L(0.74, 5.87, 0.5),
  vi: L(0.81, 3.91, 0.7),
  yo: L(0.82, 4.12, 0),
};
/** Any other language: the middle of those measured, half and half. */
export const PACE_OTHER = L(0.72, 5.3, 0.5);

/**
 * How much of a script has been read, from the reader's voice, in any language: by the syllables
 * heard and by the seconds spoken, mixed as the voice bench found best for the script's language.
 */
export class Pace {
  readonly language: PaceLanguage;
  readonly written: number;

  constructor(script: string, languageCode: string | null) {
    this.language = (languageCode && PACE_LANGUAGES[languageCode]) || PACE_OTHER;
    this.written = Math.max(syllables(script), 1);
  }

  /** How much of the script has been said (0 to 1). */
  read(heard: number, seconds: number): number {
    const bySound = heard / this.language.heardPerWritten;
    const byTime = seconds * this.language.writtenPerSecond;
    const said = this.language.bySound * bySound + (1 - this.language.bySound) * byTime;
    return Math.min(Math.max(said / this.written, 0), 1);
  }
}

/**
 * The script's language, from the text itself (the Mac asks NLLanguageRecognizer): by its script,
 * and for Latin letters, English only where its commonest words are there.
 */
export function languageOf(text: string): string | null {
  const sample = text.slice(0, 2000);
  const count = (re: RegExp) => sample.match(re)?.length ?? 0;
  const scripts: [string, number][] = [
    ["hi", count(/[ऀ-ॿ]/g)],
    ["bn", count(/[ঀ-৿]/g)],
    ["ta", count(/[஀-௿]/g)],
    ["th", count(/[฀-๿]/g)],
    ["ar", count(/[؀-ۿ]/g)],
    ["ja", count(/[぀-ヿ]/g) * 3],
    ["zh-Hans", count(/[一-鿿]/g)],
    ["ru", count(/[Ѐ-ӿ]/g)],
    ["latin", count(/[A-Za-zÀ-ɏ]/g)],
  ];
  const [top, n] = scripts.reduce((best, next) => (next[1] > best[1] ? next : best));
  if (n === 0) return null;
  if (top !== "latin") return top;
  const english = sample.toLowerCase().match(/\b(the|and|is|to|of|you|that|it|in|for)\b/g)?.length ?? 0;
  return english >= 2 ? "en" : null;
}

// ---------------------------------------------------------------------------------------------
// VoiceActivity

/** A second-order filter (Butterworth), one sample at a time. */
class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}

  run(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  /** Long silence must not leave the state in denormals, which are slow. */
  flush(): void {
    if (Math.abs(this.z1) < 1e-20) this.z1 = 0;
    if (Math.abs(this.z2) < 1e-20) this.z2 = 0;
  }

  static make(cutoff: number, high: boolean): Biquad {
    const w = (2 * Math.PI * cutoff) / VoiceActivity.sampleRate;
    const alpha = Math.sin(w) / (2 * 0.7071067811865476);
    const c = Math.cos(w);
    const a0 = 1 + alpha;
    const b0 = high ? (1 + c) / 2 : (1 - c) / 2;
    const b1 = high ? -(1 + c) : 1 - c;
    return new Biquad(b0 / a0, b1 / a0, b0 / a0, (-2 * c) / a0, (1 - alpha) / a0);
  }
}

const FRAME = 320; // 20 ms
const FRAME_SECONDS = 0.02;
const START_FRAMES = 3;
const HOLD_FRAMES = 1;
const STOP_FRAMES = 20;
const WARM_FRAMES = 15;
const HISS_CROSSINGS = 0.3;
const STEP = 2;
const MOVING_STEPS = 3;
const QUIETEST = -90;
const HOLD_MARGIN = 4;
const SYLLABLE_RISE = 3;
const SYLLABLE_FALL = 2;
const SYLLABLE_GAP = 4;
const DYING_AWAY = 10;
const DYING_AWAY_HELD = 16;
const PITCHED = 0.5;
const PERIOD_MIN = 20;
const PERIOD_MAX = 114;
const WINDOW = 240;
/** A per-frame smoothing step for a time constant of `seconds`. */
const k = (seconds: number) => FRAME_SECONDS / (seconds + FRAME_SECONDS);
const bits = (n: number) => {
  let count = 0;
  for (let v = n; v; v &= v - 1) count += 1;
  return count;
};

/**
 * Whether someone is speaking, from the microphone's sound alone, in any language (the Mac's
 * VoiceActivity): per 20 ms frame of 16 kHz, the energy in the voice band against the room's own
 * level, learnt as it goes; voice when well above the room, with a pitch (70–400 Hz), not hiss and
 * not steady. Speaking starts after 60 ms of unbroken voice (not while a sound dies away), goes on
 * through the gaps between words, and stops after 400 ms without voice. Counts syllables as it goes.
 */
export class VoiceActivity {
  static readonly sampleRate = 16000;
  private sens: number;
  speaking = false;
  syllables = 0;
  /** How loud the voice is above the room, 0 to 1, for a meter. */
  level = 0;
  /** The room's level in the voice band (dB), as learnt. */
  room = QUIETEST;

  private readonly rumble = Biquad.make(100, true);
  private readonly bandLow = Biquad.make(300, true);
  private readonly bandHigh = Biquad.make(3000, false);
  private readonly pitchHigh = Biquad.make(1000, false);
  private readonly recent = new Float64Array(WINDOW);
  private recentAt = 0;
  private filled = 0;
  private energy = 0;
  private crossings = 0;
  private wasPositive = false;
  private frames = 0;
  private lastBand = QUIETEST;
  private steps = 0;
  private voiceInARow = 0;
  private peak: number | null = null;
  private trough = QUIETEST;
  private sinceSyllable = 0;
  private lastLevel = QUIETEST;
  private loudest = QUIETEST;
  private quietLeft = 0;

  /** 0 hears only a loud, close voice; 1 a soft one. */
  constructor(sensitivity = 0.5) {
    this.sens = Math.min(Math.max(sensitivity, 0), 1);
  }

  set sensitivity(value: number) {
    this.sens = Math.min(Math.max(value, 0), 1);
  }

  /** How far above the room a frame must be (dB). */
  private get threshold(): number {
    return 12 - 8 * this.sens;
  }

  /** The next samples (16 kHz mono, as Int16 or floats in -1..1). True when `speaking` changed. */
  hear(samples: ArrayLike<number>, floats = false): boolean {
    const before = this.speaking;
    for (let i = 0; i < samples.length; i++) {
      const sample = (samples[i] ?? 0) * (floats ? 1 : 1 / 32768);
      const x = this.rumble.run(sample);
      const band = this.bandHigh.run(this.bandLow.run(x));
      this.energy += band * band;
      const low = this.pitchHigh.run(x);
      if (this.filled % 2 === 0) {
        this.recent[this.recentAt] = low;
        this.recentAt = (this.recentAt + 1) % WINDOW;
      }
      const positive = x >= 0;
      if (positive !== this.wasPositive) this.crossings += 1;
      this.wasPositive = positive;
      this.filled += 1;
      if (this.filled === FRAME) this.endFrame();
    }
    return this.speaking !== before;
  }

  private endFrame(): void {
    const band = 10 * Math.log10(this.energy / FRAME + 1e-12);
    const hiss = this.crossings / FRAME > HISS_CROSSINGS;
    this.energy = 0;
    this.crossings = 0;
    this.filled = 0;
    this.rumble.flush();
    this.bandLow.flush();
    this.bandHigh.flush();
    this.pitchHigh.flush();

    this.frames += 1;
    const first = this.frames === 1;
    const warming = this.frames <= WARM_FRAMES;

    const stepped = !first && Math.abs(band - this.lastBand) >= STEP;
    this.lastBand = band;
    this.steps = ((this.steps << 1) | (stepped ? 1 : 0)) & 0xff;
    const steady = bits(this.steps) < MOVING_STEPS;

    const above = band - Math.max(this.room, QUIETEST);
    const need = this.speaking ? this.threshold - HOLD_MARGIN : this.threshold;
    const voice = !warming && !hiss && !steady && above >= need && this.pitch() >= PITCHED;

    if (first) this.room = band;
    else if (warming) this.room += (band - this.room) * 0.3;
    else if (band < this.room) this.room += (band - this.room) * k(0.05);
    else this.room += (band - this.room) * k(!this.speaking && (steady || hiss) ? 0.3 : 4);
    this.room = Math.max(this.room, QUIETEST);

    this.countSyllables(band, voice);

    this.voiceInARow = voice ? this.voiceInARow + 1 : 0;
    this.loudest = above >= need ? Math.max(this.loudest, band) : QUIETEST;
    if (!this.speaking) {
      if (this.voiceInARow >= START_FRAMES && band >= this.loudest - DYING_AWAY) {
        this.speaking = true;
        this.quietLeft = STOP_FRAMES;
      }
    } else if (this.voiceInARow >= HOLD_FRAMES && band >= this.loudest - DYING_AWAY_HELD) {
      this.quietLeft = STOP_FRAMES;
    } else {
      this.quietLeft -= 1;
      if (this.quietLeft <= 0) {
        this.speaking = false;
        this.voiceInARow = 0;
      }
    }

    const target = warming ? 0 : Math.min(Math.max((above - 3) / 36, 0), 1);
    this.level += (target - this.level) * k(target > this.level ? 0.02 : 0.18);
  }

  private countSyllables(band: number, voice: boolean): void {
    const level = (band + this.lastLevel) / 2;
    this.lastLevel = band;
    this.sinceSyllable += 1;
    const ripe = this.sinceSyllable >= SYLLABLE_GAP;
    if (voice) {
      if (this.peak !== null && level <= this.peak - SYLLABLE_FALL) {
        if (this.peak - this.trough >= SYLLABLE_RISE && ripe) {
          this.syllables += 1;
          this.sinceSyllable = 0;
        }
        this.peak = null;
        this.trough = level;
      } else if (level > (this.peak ?? this.trough)) {
        this.peak = level;
      } else if (this.peak === null) {
        this.trough = Math.min(this.trough, level);
      }
    } else {
      if (this.peak !== null && this.peak - this.trough >= SYLLABLE_RISE && ripe) {
        this.syllables += 1;
        this.sinceSyllable = 0;
      }
      this.peak = null;
      this.trough = level;
    }
  }

  /** How alike the last 30 ms is to itself one period later, at the best period (0 to 1). */
  private pitch(): number {
    const n = WINDOW;
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = this.recent[(this.recentAt + i) % n] ?? 0;
    const total = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) total[i + 1] = (total[i] ?? 0) + (w[i] ?? 0) * (w[i] ?? 0);
    const all = total[n] ?? 0;
    if (all <= 1e-12) return 0;
    let best = 0;
    for (let lag = PERIOD_MIN; lag <= PERIOD_MAX; lag++) {
      let sum = 0;
      for (let i = 0; i < n - lag; i++) sum += (w[i] ?? 0) * (w[i + lag] ?? 0);
      const energy = Math.sqrt((total[n - lag] ?? 0) * (all - (total[lag] ?? 0)));
      if (energy > 0) best = Math.max(best, sum / energy);
    }
    return best;
  }
}
