import { useSyncExternalStore } from "react";

/**
 * The window's themes. Each is three colours in roughly 60 / 30 / 10 — the page, the instruments
 * on it, and one accent for the voice — and its values live in styles.css under [data-theme].
 * `swatch` repeats them here only so Settings can show each theme before it is picked.
 *
 * Kept per Mac in localStorage, like any appearance choice: it describes this screen, not the
 * person, and it must apply before the first paint, which a settings round trip cannot do.
 */
export const THEMES = [
  {
    id: "butter",
    name: "Butter",
    feel: "Warm and calm. Cream is easy on the eyes; ultramarine reads as trust and clarity.",
    swatch: { page: "#f2e8c8", side: "#161412", accent: "#3046e8" },
  },
  {
    id: "light",
    name: "Light",
    feel: "Clean and bright, for a well-lit room. White paper, a grey sidebar, and the logo's blue for what matters.",
    swatch: { page: "#ffffff", side: "#f3f3f5", accent: "#3b4fe0" },
  },
  {
    id: "night",
    name: "Night",
    feel: "Low glare for late hours. Charcoal throughout and dim cream text, so nothing on screen shouts.",
    swatch: { page: "#191715", side: "#2e2a26", accent: "#7c89f5" },
  },
  {
    id: "ink",
    name: "Ink",
    feel: "Deep focus. Navy steadies attention; a deep teal marks what to act on, without shouting.",
    swatch: { page: "#e8ecf3", side: "#13203a", accent: "#1b7d74" },
  },
  {
    id: "plum",
    name: "Plum",
    feel: "Creative and warm. Plum leans to imagination; a soft rose keeps it gentle.",
    swatch: { page: "#f3ecf1", side: "#2c1830", accent: "#a84d78" },
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

/** "system" follows the Mac's own light/dark setting: Light by day, Night by night. */
export type ThemeChoice = ThemeId | "system";
const SYSTEM_THEMES: Record<"light" | "dark", ThemeId> = { light: "light", dark: "night" };

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

const dark = window.matchMedia("(prefers-color-scheme: dark)");
let choice: ThemeChoice = read<ThemeChoice>(THEME_KEY, [...THEMES, { id: "system" }], "butter");
const resolve = (value: ThemeChoice): ThemeId =>
  value === "system" ? SYSTEM_THEMES[dark.matches ? "dark" : "light"] : value;
let theme: ThemeId = resolve(choice);
// Mac's own font and Butter until the person picks something else (the user's call, 2026-11-20).
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

// When the Mac switches between light and dark, a window set to "system" follows at once.
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
