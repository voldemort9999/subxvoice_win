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
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function dayLabel(timestamp: number): string {
  const today = startOfDay(Date.now());
  const day = startOfDay(timestamp);
  if (day === today) return "Today";
  if (day === today - DAY_MS) return "Yesterday";
  return new Date(timestamp).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

/** Days in a row, ending today (or yesterday), with at least one dictation. */
export function streakDays(records: SessionRecord[]): number {
  const days = new Set(records.map((record) => startOfDay(record.createdAt)));
  let day = startOfDay(Date.now());
  if (!days.has(day)) day -= DAY_MS;
  let streak = 0;
  while (days.has(day)) {
    streak++;
    day -= DAY_MS;
  }
  return streak;
}

const KEY_LABELS: Record<string, string> = {
  ctrl: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  win: "Win",
  esc: "Esc",
  pageup: "Page Up",
  pagedown: "Page Down",
  capslock: "Caps Lock",
};

/**
 * "ctrl+shift+f9" → "Ctrl + Shift + F9". Windows accepts any combination, so this formats one
 * rather than looking it up.
 */
export function hotkeyLabel(keys: string | undefined): string {
  if (!keys) return "the hotkey";
  return keys
    .split("+")
    .map((key) => KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : titleCase(key)))
    .join(" + ");
}

/** "f9" → "F9", "home" → "Home". */
const titleCase = (key: string) =>
  /^f\d+$/.test(key) ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
