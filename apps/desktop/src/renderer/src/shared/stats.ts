// Everything the dashboard shows is derived from the history we already keep — no extra tracking,
// nothing sent anywhere. Pure functions over SessionRecord[], so they are testable without a mic.
import type { SessionRecord } from "@subx/core";
import { DAY_MS, startOfDay } from "./format";

/**
 * Typing speed we compare dictation against, for "time saved". 40 wpm is a common figure for
 * sustained prose typing on a full keyboard — fast for most people, so the estimate stays
 * conservative rather than flattering. Shown as an estimate in the UI, never as a measurement.
 */
export const ASSUMED_TYPING_WPM = 40;

/** Devanagari block. Used to tell which script a transcript came back in. */
const DEVANAGARI = /[ऀ-ॿ]/;

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export const totalWords = (records: SessionRecord[]) =>
  records.reduce((total, record) => total + wordCount(record.finalText), 0);

export const speakingMs = (records: SessionRecord[]) =>
  records.reduce((total, record) => total + (record.audioMs ?? 0), 0);

/**
 * How much longer those words would have taken to type. Negative is possible in principle (a long
 * pause with few words), so it is clamped: "you saved less than nothing" is noise, not insight.
 */
export function timeSavedMs(records: SessionRecord[]): number {
  const typingMs = (totalWords(records) / ASSUMED_TYPING_WPM) * 60_000;
  return Math.max(0, typingMs - speakingMs(records));
}

/** Speaking rate across the given records, or 0 when nothing has been said yet. */
export function wordsPerMinute(records: SessionRecord[]): number {
  const minutes = speakingMs(records) / 60_000;
  return minutes > 0 ? Math.round(totalWords(records) / minutes) : 0;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

/**
 * Median time in each stage, measured from key-release. Medians rather than averages because one
 * cold socket or one slow LLM call would drag a mean around and misrepresent the typical wait.
 */
export function latency(records: SessionRecord[]) {
  const done = records.filter((record) => record.timings.totalMs > 0);
  return {
    stt: median(done.map((record) => record.timings.sttMs)),
    llm: median(done.map((record) => record.timings.llmMs)),
    insert: median(done.map((record) => record.timings.insertMs)),
    total: median(done.map((record) => record.timings.totalMs)),
    samples: done.length,
  };
}

export interface DayBucket {
  start: number;
  records: SessionRecord[];
  words: number;
  ms: number;
}

/** One bucket per day, oldest first, including the days with nothing in them. */
export function byDay(records: SessionRecord[], days: number): DayBucket[] {
  const today = startOfDay(Date.now());
  const buckets = new Map<number, SessionRecord[]>();
  for (let index = 0; index < days; index++) {
    buckets.set(today - (days - 1 - index) * DAY_MS, []);
  }
  for (const record of records) {
    const day = startOfDay(record.createdAt);
    buckets.get(day)?.push(record);
  }
  return [...buckets].map(([start, dayRecords]) => ({
    start,
    records: dayRecords,
    words: totalWords(dayRecords),
    ms: speakingMs(dayRecords),
  }));
}

export interface AppBucket {
  name: string;
  count: number;
  words: number;
}

/**
 * Where the dictations went, busiest first. Records with no app name are left out rather than
 * lumped into "Unknown": some windows give no readable app name, and an "Unknown" bar topping
 * the chart would look like a bug.
 */
export function byApp(records: SessionRecord[], limit = 6): AppBucket[] {
  const apps = new Map<string, AppBucket>();
  for (const record of records) {
    const name = record.context.appName;
    if (!name) continue;
    const bucket = apps.get(name) ?? { name, count: 0, words: 0 };
    bucket.count++;
    bucket.words += wordCount(record.finalText);
    apps.set(name, bucket);
  }
  return [...apps.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

/** Dictations per hour of the day, 0–23, so the quiet hours are visible too. */
export function byHour(records: SessionRecord[]): number[] {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const record of records) {
    const hour = new Date(record.createdAt).getHours();
    hours[hour] = (hours[hour] ?? 0) + 1;
  }
  return hours;
}

/**
 * What the pipeline is actually doing with the speech. `cleaned` counts the dictations the LLM
 * changed; `devanagari` counts the ones speech-to-text returned in Devanagari, which is what the
 * transliteration pass exists for.
 */
export function pipelineMix(records: SessionRecord[]) {
  const spoken = records.filter((record) => record.finalText || record.rawText);
  return {
    total: spoken.length,
    cleaned: spoken.filter((record) => record.rawText && record.rawText !== record.finalText).length,
    devanagari: spoken.filter((record) => DEVANAGARI.test(record.rawText)).length,
    romanOut: spoken.filter((record) => record.finalText && !DEVANAGARI.test(record.finalText)).length,
  };
}

export const hasDevanagari = (text: string) => DEVANAGARI.test(text);

/** The longest single dictation, which is usually the one worth re-reading. */
export const longest = (records: SessionRecord[]) =>
  records.reduce<SessionRecord | null>(
    (best, record) => (wordCount(record.finalText) > wordCount(best?.finalText ?? "") ? record : best),
    null,
  );
