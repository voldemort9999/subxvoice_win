import { useSyncExternalStore } from "react";

/**
 * The window's two themes, Light and Dark (the Mac app dropped Butter, Ink and Plum, 96d78ad: every
 * new screen had to be checked in each). Each is three colours in roughly 60 / 30 / 10, and its
 * values live in styles.css under [data-theme]; `swatch` repeats them only so Settings can show
 * each theme before it is picked.
 *
 * Kept per PC in localStorage, like any appearance choice: it describes this screen, not the
 * person, and it must apply before the first paint, which a settings round trip cannot do.
 */
export const THEMES = [
  {
    id: "light",
    name: "Light",
    feel: "Soft cream and a clear blue, for a well-lit room.",
    swatch: { page: "#fbf8f1", side: "#f3eee2", accent: "#1d5aae" },
  },
  {
    id: "dark",
    name: "Dark",
    feel: "Low glare for late hours. Warm charcoal and a soft blue, so nothing on screen shouts.",
    swatch: { page: "#1b1a18", side: "#24221f", accent: "#8db8f2" },
  },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

/**
 * Font pairs: a display face for headings and figures, a text face for everything else. Open
 * licences only (SIL OFL), because they ship inside the app; the free fonts on showcase sites are
 * often free for personal use only. Mono stays JetBrains Mono in every pair.
 */
export const FONTS = [
  {
    id: "mac",
    name: "Windows",
    feel: "Plain and light, the way Windows writes",
    display: '"Segoe UI Variable Display", "Segoe UI", -apple-system',
    weight: 500,
  },
  {
    id: "funnel",
    name: "Funnel",
    feel: "Modern and friendly",
    display: '"Funnel Display Variable"',
    weight: 600,
  },
  {
    id: "grotesk",
    name: "Grotesk",
    feel: "Clean and neutral",
    display: '"Hanken Grotesk Variable"',
    weight: 600,
  },
  {
    id: "editorial",
    name: "Editorial",
    feel: "Elegant, like a magazine",
    display: '"Instrument Serif"',
    weight: 400,
  },
  {
    id: "syne",
    name: "Syne",
    feel: "Artistic and a little unusual",
    display: '"Syne Variable"',
    weight: 600,
  },
  { id: "wide", name: "Wide", feel: "Wide and technical", display: '"Unbounded Variable"', weight: 500 },
] as const;

export type FontId = (typeof FONTS)[number]["id"];

/** "system" follows Windows' own light/dark setting, and is where every PC starts. */
export type ThemeChoice = ThemeId | "system";

/**
 * A choice saved before there were only two themes keeps its meaning: Night was the dark one;
 * Butter, Ink and Plum all had light pages (the Mac's ThemeChoice(key:)).
 */
export function choiceFor(stored: string | null): ThemeChoice {
  if (stored === null || stored === "system") return "system";
  return stored === "dark" || stored === "night" ? "dark" : "light";
}

const THEME_KEY = "subx.theme.v3";
const FONT_KEY = "subx.font";
const listeners = new Set<() => void>();

function read<T extends string>(key: string, allowed: readonly { id: T }[], fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return allowed.find((option) => option.id === stored)?.id ?? fallback;
  } catch {
    return fallback;
  }
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const dark = window.matchMedia("(prefers-color-scheme: dark)");
let choice: ThemeChoice = choiceFor(stored(THEME_KEY));
const resolve = (value: ThemeChoice): ThemeId =>
  value === "system" ? (dark.matches ? "dark" : "light") : value;
let theme: ThemeId = resolve(choice);
// Windows' own font until the person picks something else (the user's call, 2026-11-20).
let font: FontId = read(FONT_KEY, FONTS, "mac");

/** Called once before React renders, so the first frame is already in the chosen look. */
export function applyStoredTheme(): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.font = font;
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage refused: the choice still applies for this window.
  }
  for (const listener of listeners) listener();
}

export function setTheme(next: ThemeChoice): void {
  choice = next;
  theme = resolve(next);
  document.documentElement.dataset.theme = theme;
  save(THEME_KEY, next);
}

// When Windows switches between light and dark, a window set to "system" follows at once.
dark.addEventListener("change", () => {
  if (choice !== "system") return;
  theme = resolve(choice);
  document.documentElement.dataset.theme = theme;
  for (const listener of listeners) listener();
});

export function setFont(next: FontId): void {
  font = next;
  document.documentElement.dataset.font = next;
  save(FONT_KEY, next);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The theme on screen now, "system" already resolved. */
export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribe, () => theme);
}

/** What the user picked, which may be "system". */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, () => choice);
}

/** Whether a theme or font has ever been picked here, for Home's "make it yours" step. */
export function hasChosenLook(): boolean {
  try {
    return localStorage.getItem(THEME_KEY) !== null || localStorage.getItem(FONT_KEY) !== null;
  } catch {
    return false;
  }
}

export function useFont(): FontId {
  return useSyncExternalStore(subscribe, () => font);
}
