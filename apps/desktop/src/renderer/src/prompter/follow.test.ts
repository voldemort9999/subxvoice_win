import { describe, expect, it } from "vitest";
import { Glide, languageOf, Pace, syllables, VoiceActivity } from "./follow";

// The Mac app's VoiceActivityTests, GlideTests and PaceTests, case for case. The sounds are made,
// not recorded: a voice is a pitch with its overtones rising and falling four times a second; a fan
// is steady noise under 1 kHz; hiss is white noise.
const RATE = 16000;

/** A deterministic noise source, so every run hears the same (the Mac's LCG). */
function noise() {
  let state = 0x9e3779b97f4a7c15n;
  return () => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
    const signed = BigInt.asIntN(64, state >> 11n);
    return Number(signed % 2_000_001n) / 1_000_000 - 1;
  };
}

function samples(seconds: number, make: (t: number) => number): number[] {
  return Array.from({ length: Math.floor(seconds * RATE) }, (_, i) =>
    Math.trunc(Math.max(-32767, Math.min(32767, make(i / RATE) * 32767))),
  );
}
const voice = (seconds: number, loud = 0.1, pitch = 140) =>
  samples(seconds, (t) => {
    const rise = 0.5 - 0.5 * Math.cos(2 * Math.PI * 4 * t);
    let x = 0;
    for (let k = 1; k <= 20 && k * pitch < 3500; k++) x += Math.sin(2 * Math.PI * k * pitch * t) / k;
    return (loud * rise * x) / 2;
  });
const silence = (seconds: number) => samples(seconds, () => 0);
const room = (seconds: number, loud = 0.0005) => {
  const next = noise();
  return samples(seconds, () => loud * next());
};
const fan = (seconds: number, loud = 0.05) => {
  const next = noise();
  let low = 0;
  return samples(seconds, () => {
    low += (next() - low) * 0.3;
    return loud * low * 3;
  });
};
const hiss = (seconds: number, loud = 0.05) => {
  const next = noise();
  return samples(seconds, () => loud * next());
};

/** Fed in 50 ms pieces, as the microphone gives them: whether speaking after each piece, by time. */
function run(detector: VoiceActivity, parts: number[][]): Map<number, boolean> {
  const all = parts.flat();
  const heard = new Map<number, boolean>();
  for (let at = 0; at < all.length; ) {
    const end = Math.min(at + 800, all.length);
    detector.hear(all.slice(at, end));
    at = end;
    heard.set(Math.round((at / RATE) * 100) / 100, detector.speaking);
  }
  return heard;
}
function speaking(heard: Map<number, boolean>, from: number, to: number): number {
  const inside = [...heard].filter(([time]) => time > from && time <= to);
  return inside.filter(([, on]) => on).length / Math.max(inside.length, 1);
}
const firstSpeaking = (heard: Map<number, boolean>, after: number) =>
  Math.min(...[...heard].filter(([time, on]) => time > after && on).map(([time]) => time));

describe("VoiceActivity", () => {
  it("starts quickly on a voice and stops on silence", () => {
    const heard = run(new VoiceActivity(), [room(1), voice(3), room(2)]);
    expect(speaking(heard, 0, 1)).toBe(0);
    expect(firstSpeaking(heard, 1)).toBeLessThanOrEqual(1.2);
    expect(speaking(heard, 1.2, 4)).toBe(1);
    expect(speaking(heard, 4.6, 6)).toBe(0);
  });

  it("is not stopped by a breath between words", () => {
    const heard = run(new VoiceActivity(), [room(1), voice(2), room(0.25), voice(2)]);
    expect(speaking(heard, 1.3, 5.25)).toBe(1);
  });

  it("does not take a fan switched on for a voice", () => {
    expect(speaking(run(new VoiceActivity(), [room(1), fan(4)]), 0, 5)).toBe(0);
  });

  it("hears a voice over a fan", () => {
    const speech = voice(3);
    const over = fan(3, 0.008).map((value, i) => Math.max(-32768, Math.min(32767, value + (speech[i] ?? 0))));
    const heard = run(new VoiceActivity(), [fan(2, 0.008), over, fan(2, 0.008)]);
    expect(speaking(heard, 0, 2)).toBe(0);
    expect(speaking(heard, 2.3, 5)).toBe(1);
    expect(speaking(heard, 5.6, 7)).toBe(0);
  });

  it("does not take hiss or key clicks for a voice", () => {
    expect(speaking(run(new VoiceActivity(), [room(1), hiss(3)]), 0, 4)).toBe(0);
    const next = noise();
    const key = [...samples(0.005, () => 0.4 * next()), ...room(0.195)];
    const clicks = Array.from({ length: 15 }, () => key);
    expect(speaking(run(new VoiceActivity(), [room(1), ...clicks]), 0, 4)).toBe(0);
  });

  it("needs more sensitivity for a soft voice", () => {
    const parts = [room(1, 0.002), voice(2, 0.0025)];
    const keen = speaking(run(new VoiceActivity(1), parts), 1.3, 3);
    expect(keen).toBeGreaterThan(0.9);
    expect(speaking(run(new VoiceActivity(0), parts), 1.3, 3)).toBeLessThan(keen);
  });

  it("stays calm in digital silence", () => {
    const detector = new VoiceActivity();
    expect(speaking(run(detector, [silence(3)]), 0, 3)).toBe(0);
    expect(detector.level).toBe(0);
    expect(Number.isFinite(detector.room)).toBe(true);
  });
});

describe("Glide", () => {
  it("comes up to speed and to rest", () => {
    const glide = new Glide(40);
    glide.go(true, 0);
    expect(glide.pace(0.1)).toBeGreaterThan(0);
    expect(glide.pace(0.1)).toBeLessThan(1);
    expect(glide.pace(0.3)).toBe(1);
    expect(Math.abs(glide.position(1.25) - (40 * 0.125 + 40))).toBeLessThan(0.001);
    glide.go(false, 2);
    expect(glide.resting(2.2)).toBe(false);
    expect(glide.resting(2.4)).toBe(true);
    expect(glide.position(10)).toBe(glide.position(2.4));
  });

  it("stops smoothly halfway up, and never goes backwards", () => {
    const glide = new Glide(40);
    glide.go(true, 0);
    glide.go(false, 0.1);
    expect(Math.abs(glide.pace(0.1) - 0.4)).toBeLessThan(0.001);
    expect(glide.resting(0.1 + 0.4 * Glide.slowDown + 0.001)).toBe(true);
    let last = 0;
    for (let step = 0; step <= 40; step++) {
      const now = glide.position(step * 0.01);
      expect(now).toBeGreaterThanOrEqual(last - 1e-9);
      last = now;
    }
  });

  it("counts a new speed from now, and reset is the top", () => {
    const glide = new Glide(20);
    glide.go(true, 0);
    const before = glide.position(2);
    glide.setSpeed(60, 2);
    expect(glide.position(2)).toBe(before);
    expect(Math.abs(glide.position(3) - (before + 60))).toBeLessThan(0.001);
    glide.reset(5);
    expect(glide.position(9)).toBe(0);
    expect(glide.resting(5)).toBe(true);
  });
});

describe("Pace", () => {
  it("counts scripts in syllables", () => {
    expect(syllables("banana")).toBe(3);
    expect(syllables("नमस्ते")).toBe(3);
    expect(syllables("你好世界")).toBe(4);
    expect(syllables("きょうは")).toBe(3);
    expect(syllables("안녕하세요")).toBe(5);
    expect(syllables("Привет")).toBe(2);
    expect(syllables("مرحبا")).toBe(2.5);
    expect(syllables("2026")).toBe(6);
    expect(syllables("...")).toBe(0);
  });

  it("mixes syllables and seconds by language", () => {
    const english = new Pace("banana ".repeat(100), "en");
    expect(english.written).toBe(300);
    expect(Math.abs(english.read(Math.trunc(150 * 0.72), 150 / 5.16) - 0.5)).toBeLessThan(0.01);
    const mandarin = new Pace("你好".repeat(100), "zh-Hans");
    expect(mandarin.read(0, 10)).toBe(mandarin.read(500, 10));
    expect(english.read(10_000, 10_000)).toBe(1);
    expect(new Pace("hello there", "xx").read(1, 0.2)).toBeGreaterThan(0);
  });

  it("knows a script's language from its letters", () => {
    expect(languageOf("नमस्ते दोस्तों, आज हम बात करेंगे")).toBe("hi");
    expect(languageOf("The plan is to ship it and to tell you")).toBe("en");
    expect(languageOf("你好世界")).toBe("zh-Hans");
    expect(languageOf("Hola amigos, vamos a empezar")).toBeNull();
  });
});
