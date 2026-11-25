// Everything the dashboard shows is derived from the history we already keep — no extra tracking,
// nothing sent anywhere. Pure functions over SessionRecord[], so they are testable without a mic.
import type { SessionRecord } from "@subx/core";
import { dayKey, dayKeyStart } from "../../../shared/day-key";
import type { DayTotal } from "../../../shared/ipc";
import { wordCount } from "../../../shared/words";
import { addDays, DAY_MS, startOfDay, streakOf } from "./format";

/**
 * Typing speed we compare dictation against, for "time saved". 40 wpm is a common figure for
 * sustained prose typing on a full keyboard — fast for most people, so the estimate stays
 * conservative rather than flattering. Shown as an estimate in the UI, never as a measurement.
 */
export const ASSUMED_TYPING_WPM = 40;

// One counter for every language, shared with the daily totals the main process keeps.
export { wordCount };

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
  // Calendar days, not multiples of 24 h: across a clock change those missed every earlier day's
  // dictations (New York, 1 Nov: three of five days left out of "7 days").
  for (let index = 0; index < days; index++) {
    buckets.set(addDays(today, -(days - 1 - index)), []);
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
 * lumped into "Unknown": on macOS the context reader is not built yet, and an "Unknown" bar
 * topping the chart would look like a bug.
 */
export function byApp(records: SessionRecord[], limit = Number.POSITIVE_INFINITY): AppBucket[] {
  const apps = new Map<string, AppBucket>();
  for (const record of records) {
    const name = record.context.appName;
    if (!name) continue;
    const bucket = apps.get(name) ?? { name, count: 0, words: 0 };
    bucket.count++;
    bucket.words += wordCount(record.finalText);
    apps.set(name, bucket);
  }
  // By words, as the list shows them (by dictations, an app with 53 words sat above one with 79).
  return [...apps.values()].sort((a, b) => b.words - a.words || b.count - a.count).slice(0, limit);
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

/** The longest single dictation, which is usually the one worth re-reading. */
export const longest = (records: SessionRecord[]) =>
  records.reduce<SessionRecord | null>(
    (best, record) => (wordCount(record.finalText) > wordCount(best?.finalText ?? "") ? record : best),
    null,
  );

/** A dictation SUBXVoice changed before pasting: tidied, corrected, laid out or put in a script. */
const rewritten = (record: SessionRecord) => Boolean(record.rawText) && record.rawText !== record.finalText;

/**
 * What SUBXVoice did with the words, which is what the user cannot see happen: how often it
 * rewrote what was heard, and how many words it took out (fillers, repeats, words taken back).
 */
export function cleanup(records: SessionRecord[]) {
  const spoken = records.filter((record) => record.finalText || record.rawText);
  const changed = spoken.filter(rewritten);
  return {
    spoken: spoken.length,
    rewritten: changed.length,
    trimmed: changed.reduce(
      (total, record) => total + Math.max(0, wordCount(record.rawText) - wordCount(record.finalText)),
      0,
    ),
  };
}

/**
 * Writing systems, each shown by a few of its own letters. Scripts rather than languages: the
 * script is in the text for certain, where telling Hindi from Marathi would be a guess.
 */
const SCRIPTS: { name: string; sample: string; test: RegExp }[] = [
  { name: "Latin", sample: "Abc", test: /\p{Script=Latin}/u },
  { name: "Devanagari", sample: "अआइ", test: /\p{Script=Devanagari}/u },
  { name: "Gujarati", sample: "અઆઇ", test: /\p{Script=Gujarati}/u },
  { name: "Bengali", sample: "অআই", test: /\p{Script=Bengali}/u },
  { name: "Gurmukhi", sample: "ਅਆਇ", test: /\p{Script=Gurmukhi}/u },
  { name: "Tamil", sample: "அஆஇ", test: /\p{Script=Tamil}/u },
  { name: "Telugu", sample: "అఆఇ", test: /\p{Script=Telugu}/u },
  { name: "Kannada", sample: "ಅಆಇ", test: /\p{Script=Kannada}/u },
  { name: "Malayalam", sample: "അആഇ", test: /\p{Script=Malayalam}/u },
  { name: "Arabic", sample: "ابت", test: /\p{Script=Arabic}/u },
  { name: "Cyrillic", sample: "Абв", test: /\p{Script=Cyrillic}/u },
  { name: "Japanese", sample: "かな", test: /[\p{Script=Hiragana}\p{Script=Katakana}]/u },
  { name: "Chinese", sample: "漢字", test: /\p{Script=Han}/u },
  { name: "Korean", sample: "한글", test: /\p{Script=Hangul}/u },
];

function scriptsIn(text: string) {
  const found = SCRIPTS.filter((script) => script.test.test(text));
  // Japanese is written in kana and kanji together; kanji beside kana is Japanese, not Chinese.
  return found.some((script) => script.name === "Japanese")
    ? found.filter((script) => script.name !== "Chinese")
    : found;
}

/**
 * The scripts the user's words came out in, most used first, and how many dictations mixed two
 * or more in one go ("मुझे पता है, and there are a lot of things to do").
 */
export function scripts(records: SessionRecord[]) {
  const counts = new Map<string, number>();
  let mixed = 0;
  for (const record of records) {
    const found = scriptsIn(record.finalText || record.rawText);
    if (found.length > 1) mixed++;
    for (const script of found) counts.set(script.name, (counts.get(script.name) ?? 0) + 1);
  }
  const used = SCRIPTS.filter((script) => counts.has(script.name))
    .map((script) => ({ name: script.name, sample: script.sample, count: counts.get(script.name) ?? 0 }))
    .sort((a, b) => b.count - a.count);
  return { used, mixed };
}

/** Too short a clip makes a silly speed (two words in half a second is 240 wpm). */
const MIN_CLIP_MS = 3000;
const MIN_WORDS = 5;

/** The best of the user's own numbers. Null fields when there is nothing to measure yet. */
export function personalBests(records: SessionRecord[]) {
  let fastest = 0;
  for (const record of records) {
    const words = wordCount(record.finalText);
    const ms = record.audioMs ?? 0;
    if (ms < MIN_CLIP_MS || words < MIN_WORDS) continue;
    fastest = Math.max(fastest, Math.round(words / (ms / 60_000)));
  }
  const days = new Map<number, number>();
  for (const record of records) {
    const day = startOfDay(record.createdAt);
    days.set(day, (days.get(day) ?? 0) + wordCount(record.finalText));
  }
  let bestDay: { start: number; words: number } | null = null;
  for (const [start, words] of days) if (!bestDay || words > bestDay.words) bestDay = { start, words };
  return {
    fastest: fastest || null,
    bestDay: bestDay?.words ? bestDay : null,
    longestStreak: longestStreak([...days.keys()]),
  };
}

/** The longest run of consecutive days with a dictation, ever (the Home number is the current one). */
function longestStreak(days: number[]): number {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let index = 0; index < sorted.length; index++) {
    const gap = index === 0 ? 0 : (sorted[index] as number) - (sorted[index - 1] as number);
    // Days, not exact multiples of 24 h: a clock change makes one day 23 or 25 hours long.
    run = index > 0 && Math.round(gap / DAY_MS) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** When in the day the user talks most, as a name for it. Null with too little to go on. */
export function rhythm(hours: number[]): { label: string; peak: number } | null {
  const total = hours.reduce((sum, count) => sum + count, 0);
  if (total < 5) return null;
  const peak = hours.indexOf(Math.max(...hours));
  const label =
    peak >= 5 && peak < 9
      ? "Early bird"
      : peak >= 9 && peak < 12
        ? "Morning talker"
        : peak >= 12 && peak < 17
          ? "Afternoon flow"
          : peak >= 17 && peak < 21
            ? "Evening voice"
            : "Night owl";
  return { label, peak };
}

/** Words as pages of a paperback, a size everyone can picture. */
export const WORDS_PER_PAGE = 250;

/**
 * The daily totals kept apart from the history (main/daily-totals.ts), so Home and Insights stay
 * right when dictations are deleted or kept only for a while.
 */
export type DayTotals = Record<string, DayTotal>;

/** Everything from the start of `fromDay` (a day start) on; everything when it is left out. */
export function sumTotals(days: DayTotals, fromDay = Number.NEGATIVE_INFINITY): DayTotal {
  const sum: DayTotal = { words: 0, speakingMs: 0, dictations: 0 };
  for (const [key, total] of Object.entries(days)) {
    if (dayKeyStart(key) < fromDay) continue;
    sum.words += total.words;
    sum.speakingMs += total.speakingMs;
    sum.dictations += total.dictations;
  }
  return sum;
}

/** As timeSavedMs, from a total. */
export const savedMsOf = (total: DayTotal) =>
  Math.max(0, (total.words / ASSUMED_TYPING_WPM) * 60_000 - total.speakingMs);

/** As wordsPerMinute, from a total. */
export const speedOf = (total: DayTotal) =>
  total.speakingMs > 0 ? Math.round(total.words / (total.speakingMs / 60_000)) : 0;

const activeDays = (days: DayTotals) =>
  Object.entries(days)
    .filter(([, total]) => total.dictations > 0)
    .map(([key]) => dayKeyStart(key));

/** Days in a row, ending today (or yesterday), with at least one dictation. */
export const streakOfTotals = (days: DayTotals) => streakOf(new Set(activeDays(days)));

/** The best day and the longest streak, from the totals. */
export function bestsOfTotals(days: DayTotals) {
  let bestDay: { start: number; words: number } | null = null;
  for (const [key, total] of Object.entries(days))
    if (total.words > 0 && (!bestDay || total.words > bestDay.words))
      bestDay = { start: dayKeyStart(key), words: total.words };
  return { bestDay, longestStreak: longestStreak(activeDays(days)) };
}

/** The words of the day that starts at `dayStart`. */
export const wordsOn = (days: DayTotals, dayStart: number) => days[dayKey(dayStart)]?.words ?? 0;

/** The start of the first day of the last `days` calendar days, today included. */
export const rangeStart = (days: number) => addDays(startOfDay(Date.now()), -(days - 1));
