import type { SessionRecord } from "@subx/core";

export const DAY_MS = 24 * 60 * 60 * 1000;

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function formatSpeechTotal(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} seconds`;
  const minutes = ms / 60_000;
  return `${minutes < 10 ? minutes.toFixed(1) : Math.round(minutes)} minutes`;
}

/**
 * A span of time as a person would say it: "4m", "1h 12m", "2 days". Used for totals like time
 * saved, where minutes stop being meaningful once there are hours of them.
 */
export function formatSpan(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** Big counts stay readable: 1200 → "1,200". */
export const formatCount = (value: number) => value.toLocaleString();

export function formatTime(timestamp: number): string {
  // Always with AM/PM: "5:58" alone leaves the reader to guess morning or evening.
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * The start of the day `days` calendar days from `dayStart` (negative goes back). Not `± n × 24 h`:
 * where clocks change, one day a year is 23 hours long and one 25, and stepping by 24 h then lands
 * an hour off midnight, so the streak broke and charts dropped days there (2026-11-20).
 */
export function addDays(dayStart: number, days: number): number {
  const date = new Date(dayStart);
  date.setDate(date.getDate() + days);
  return startOfDay(date.getTime());
}

/** "1 word", "1,698 words". */
export const formatWords = (count: number) => `${formatCount(count)} ${count === 1 ? "word" : "words"}`;

export function dayLabel(timestamp: number): string {
  const today = startOfDay(Date.now());
  const day = startOfDay(timestamp);
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  const date = new Date(timestamp);
  // This week a day's name is enough; further back the date says more than the weekday does.
  if (day > addDays(today, -7)) return date.toLocaleDateString("en-GB", { weekday: "long" });
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Days in a row, ending today (or yesterday), with at least one dictation. */
export function streakDays(records: SessionRecord[]): number {
  return streakOf(new Set(records.map((record) => startOfDay(record.createdAt))));
}

/** The streak over the starts of the days that had a dictation. */
export function streakOf(days: Set<number>): number {
  let day = startOfDay(Date.now());
  if (!days.has(day)) day = addDays(day, -1);
  let streak = 0;
  while (days.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}
