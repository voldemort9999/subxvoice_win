import type { MicDevice } from "@subx/core";
import { Menu, type MenuItemConstructorOptions, Tray } from "electron";
import { hotkeyLabel } from "../shared/hotkey-label";
import type { VoiceLanguages } from "../shared/ipc";
import { MENU_BAR } from "../shared/mark";
import { brandIcon } from "./brand";

/** What the menu shows, read fresh each time it opens, so it is never out of date. */
export interface TrayState {
  signedIn: boolean;
  name: string;
  today: { words: number; dictations: number };
  hotkey: string;
  /** Null: this Mac has no native microphone list (the menu then leaves the submenu out). */
  microphones: MicDevice[] | null;
  /** "" follows the Mac's default input. */
  microphoneId: string;
  /** Null until the account's settings have been read once. */
  languages: VoiceLanguages | null;
  paused: boolean;
  /** The most recent dictation's text, or null when there is none. */
  last: string | null;
}

export interface TrayActions {
  open(): void;
  openSettings(tab: string): void;
  useMicrophone(id: string): void;
  setHinglish(on: boolean): void;
  setPaused(paused: boolean): void;
  copyLast(): void;
  checkForUpdates(): void;
}

/**
 * The menu bar icon and its menu: a glance at today, the two things people switch most (the
 * microphone and Hinglish), a pause, and the last dictation for when it landed in the wrong place.
 * Built on each click rather than set once, because every line in it can change between clicks.
 */
export function createTray(read: () => Promise<TrayState>, actions: TrayActions): Tray {
  const tray = new Tray(trayIcon());
  tray.setToolTip("SUBXVoice");
  const show = async () => {
    const state = await read().catch(() => null);
    tray.popUpContextMenu(Menu.buildFromTemplate(state ? menu(state, actions) : fallback(actions)));
  };
  tray.on("click", () => void show());
  tray.on("right-click", () => void show());
  return tray;
}

export function menu(state: TrayState, actions: TrayActions): MenuItemConstructorOptions[] {
  if (!state.signedIn) {
    return [
      { label: "Sign in to start dictating", click: actions.open },
      { type: "separator" },
      { label: "Quit SUBXVoice", role: "quit" },
    ];
  }
  const items: MenuItemConstructorOptions[] = [
    { label: state.name ? `Hi, ${state.name}` : "SUBXVoice", enabled: false },
    { label: todayLine(state.today), enabled: false },
    {
      label: state.paused
        ? "Paused: the hotkey does nothing"
        : `Hold ${hotkeyLabel(state.hotkey)} to dictate`,
      enabled: false,
    },
    { type: "separator" },
  ];
  if (state.microphones) items.push({ label: "Microphone", submenu: microphones(state, actions) });
  items.push(
    { label: "Languages", submenu: languages(state, actions) },
    {
      label: "Pause dictation",
      type: "checkbox",
      checked: state.paused,
      click: () => actions.setPaused(!state.paused),
    },
    { type: "separator" },
    {
      label: "Copy last dictation",
      enabled: !!state.last,
      // The start of it, so it is clear which one is about to be copied.
      ...(state.last ? { sublabel: preview(state.last) } : {}),
      click: actions.copyLast,
    },
    { type: "separator" },
    { label: "Open SUBXVoice", click: actions.open },
    { label: "Settings...", click: () => actions.openSettings("general") },
    { label: "Check for Updates...", click: actions.checkForUpdates },
    { type: "separator" },
    { label: "Quit SUBXVoice", role: "quit" },
  );
  return items;
}

function microphones(state: TrayState, actions: TrayActions): MenuItemConstructorOptions[] {
  const devices = state.microphones ?? [];
  const defaultName = devices.find((device) => device.isDefault)?.name;
  // A chosen microphone that is unplugged is not in the list; the Mac's default is then in use.
  const chosen = devices.some((device) => device.id === state.microphoneId) ? state.microphoneId : "";
  return [
    {
      label: defaultName ? `Windows default (${defaultName})` : "Windows default",
      type: "radio",
      checked: chosen === "",
      click: () => actions.useMicrophone(""),
    },
    { type: "separator" },
    ...devices.map(
      (device): MenuItemConstructorOptions => ({
        label: device.name,
        type: "radio",
        checked: chosen === device.id,
        click: () => actions.useMicrophone(device.id),
      }),
    ),
  ];
}

function languages(state: TrayState, actions: TrayActions): MenuItemConstructorOptions[] {
  const set = state.languages;
  const spoken =
    !set || set.spoken === "auto" || set.spoken.length === 0
      ? "Auto-detect"
      : set.spoken.map((code) => languageName(code)).join(", ");
  return [
    { label: spoken, enabled: false },
    ...(set?.writeIn
      ? [{ label: `Always written in ${languageName(set.writeIn)}`, enabled: false } as const]
      : []),
    { type: "separator" },
    {
      label: "Hinglish",
      sublabel: "Hindi in English letters",
      type: "checkbox",
      checked: !!set?.hinglish,
      enabled: !!set,
      click: () => actions.setHinglish(!set?.hinglish),
    },
    { type: "separator" },
    { label: "Change Languages...", click: () => actions.openSettings("dictation") },
  ];
}

/** When the state cannot be read, the menu still opens and still quits. */
function fallback(actions: TrayActions): MenuItemConstructorOptions[] {
  return [
    { label: "Open SUBXVoice", click: actions.open },
    { type: "separator" },
    { label: "Quit SUBXVoice", role: "quit" },
  ];
}

const count = new Intl.NumberFormat("en");

function todayLine({ words, dictations }: TrayState["today"]): string {
  if (dictations === 0) return "Nothing dictated yet today";
  const wordsText = `${count.format(words)} ${words === 1 ? "word" : "words"}`;
  const dictationsText = `${count.format(dictations)} ${dictations === 1 ? "dictation" : "dictations"}`;
  return `Today: ${wordsText} in ${dictationsText}`;
}

function preview(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 40 ? `"${line.slice(0, 39).trimEnd()}..."` : `"${line}"`;
}

/** "hi" → "Hindi", in English; the code itself if the system does not know it. */
function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * 18 pt, the size of the system's own menu bar icons, drawn at 2x so it is sharp on Retina. The
 * scale factor matters: at 1 the 36 pixels are taken as 36 points and the icon is twice too big.
 */
const POINTS = 18;
const SCALE = 2;

/** The menu bar wants a template image it tints for light and dark, so the X goes alone. */
function trayIcon() {
  const image = brandIcon(POINTS * SCALE, { plate: false, shade: 0, proportions: MENU_BAR }, SCALE);
  image.setTemplateImage(true);
  return image;
}
