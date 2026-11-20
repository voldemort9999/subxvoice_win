import type { MouseButton, ScreenCapture, ScreenInput, ScrollDirection } from "@subx/core";
import {
  getCursorPos,
  type InputEvent,
  scanCodeOf,
  sendInputs,
  setCursorPos,
  waitForModifiersUp,
} from "./win32";

export type { InputEvent };

/**
 * The assistant's mouse and keyboard. The action set and key names mirror Anthropic's computer
 * toolset (`computer_use_demo/tools/computer.py`, which drives xdotool): clicks with held
 * modifiers, a scroll amount in wheel notches, `hold_key` for a duration, typing that turns line
 * breaks into Return. The Windows side follows what pyautogui and CursorTouch Windows-MCP proved:
 * the cursor is placed with SetCursorPos and buttons and keys go through SendInput — exact physical
 * pixels on every display, where SendInput's 0–65535 absolute coordinates round on a large
 * virtual desktop. Keys carry their scan code as well, for games and emulators (BlueStacks) that
 * read it instead of the virtual key; typing is KEYEVENTF_UNICODE, never the clipboard.
 */

const KEYEVENTF_EXTENDEDKEY = 0x1;
const KEYEVENTF_KEYUP = 0x2;
const KEYEVENTF_UNICODE = 0x4;

const BUTTON_FLAGS: Record<MouseButton, [down: number, up: number]> = {
  left: [0x0002, 0x0004],
  right: [0x0008, 0x0010],
  middle: [0x0020, 0x0040],
};
const MOUSEEVENTF_WHEEL = 0x0800;
const MOUSEEVENTF_HWHEEL = 0x1000;
const WHEEL_DELTA = 120;

/** Names → virtual keys: the toolset's (xdotool keysyms) first, then the spellings Windows users say. */
const KEYS: Record<string, number> = {
  ctrl: 0x11,
  control: 0x11,
  control_l: 0x11,
  control_r: 0x11,
  ctl: 0x11,
  shift: 0x10,
  shift_l: 0x10,
  shift_r: 0x10,
  alt: 0x12,
  alt_l: 0x12,
  alt_r: 0x12,
  option: 0x12,
  super: 0x5b,
  super_l: 0x5b,
  win: 0x5b,
  windows: 0x5b,
  meta: 0x5b,
  cmd: 0x5b,
  command: 0x5b,
  super_r: 0x5c,
  return: 0x0d,
  enter: 0x0d,
  kp_enter: 0x0d,
  tab: 0x09,
  iso_left_tab: 0x09,
  escape: 0x1b,
  esc: 0x1b,
  backspace: 0x08,
  back: 0x08,
  delete: 0x2e,
  del: 0x2e,
  insert: 0x2d,
  ins: 0x2d,
  home: 0x24,
  end: 0x23,
  page_up: 0x21,
  pageup: 0x21,
  pgup: 0x21,
  prior: 0x21,
  page_down: 0x22,
  pagedown: 0x22,
  pgdn: 0x22,
  next: 0x22,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28,
  space: 0x20,
  caps_lock: 0x14,
  capslock: 0x14,
  num_lock: 0x90,
  scroll_lock: 0x91,
  print: 0x2c,
  printscreen: 0x2c,
  prtsc: 0x2c,
  pause: 0x13,
  break: 0x13,
  menu: 0x5d,
  apps: 0x5d,
  // US layout positions; on another layout the key in that place is pressed.
  minus: 0xbd,
  equal: 0xbb,
  plus: 0xbb,
  comma: 0xbc,
  period: 0xbe,
  slash: 0xbf,
  backslash: 0xdc,
  semicolon: 0xba,
  apostrophe: 0xde,
  grave: 0xc0,
  bracketleft: 0xdb,
  bracketright: 0xdd,
  xf86audioraisevolume: 0xaf,
  volume_up: 0xaf,
  xf86audiolowervolume: 0xae,
  volume_down: 0xae,
  xf86audiomute: 0xad,
  volume_mute: 0xad,
  xf86audioplay: 0xb3,
  media_play_pause: 0xb3,
  xf86audionext: 0xb0,
  media_next: 0xb0,
  xf86audioprev: 0xb1,
  media_prev: 0xb1,
  xf86back: 0xa6,
  browser_back: 0xa6,
  xf86forward: 0xa7,
  browser_forward: 0xa7,
};
for (let n = 1; n <= 24; n++) KEYS[`f${n}`] = 0x6f + n;
for (let n = 0; n <= 9; n++) KEYS[`kp_${n}`] = 0x60 + n;

/**
 * Keys Windows only reads right with KEYEVENTF_EXTENDEDKEY: without it the arrows, Home/End and
 * the like arrive as their numeric-keypad twins.
 */
const EXTENDED = new Set([
  0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2d, 0x2e, 0x5b, 0x5c, 0x5d, 0x2c, 0x90,
]);

/** "ctrl+shift+t" → virtual keys in press order. Unknown names throw, naming the key. */
export function parseCombo(combo: string): number[] {
  const names = combo.split("+").map((name) => name.trim());
  if (names.some((name) => !name)) throw new Error(`"${combo}" is missing a key name`);
  return names.map((name) => {
    const known = KEYS[name.toLowerCase()];
    if (known !== undefined) return known;
    if (/^[a-z0-9]$/i.test(name)) return name.toUpperCase().charCodeAt(0);
    throw new Error(`Unknown key "${name}" in "${combo}"`);
  });
}

const keyEvent = (vk: number, up: boolean, scan = 0): InputEvent => ({
  kind: "key",
  vk,
  scan,
  flags: (up ? KEYEVENTF_KEYUP : 0) | (EXTENDED.has(vk) ? KEYEVENTF_EXTENDEDKEY : 0),
});

/** Text → Unicode key events; a line break is a real Return and a tab a real Tab, as apps expect. */
export function typeEvents(text: string): InputEvent[] {
  const events: InputEvent[] = [];
  for (const unit of text.replace(/\r\n?/g, "\n")) {
    const vk = unit === "\n" ? 0x0d : unit === "\t" ? 0x09 : 0;
    if (vk) {
      events.push(keyEvent(vk, false), keyEvent(vk, true));
      continue;
    }
    // A character outside the BMP is two UTF-16 units; each is sent on its own, as Windows wants.
    for (let i = 0; i < unit.length; i++) {
      const code = unit.charCodeAt(i);
      events.push(
        { kind: "key", vk: 0, scan: code, flags: KEYEVENTF_UNICODE },
        { kind: "key", vk: 0, scan: code, flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP },
      );
    }
  }
  return events;
}

/** The OS side, swappable so the sequencing is tested without moving anything. */
export interface Native {
  send(events: InputEvent[]): void;
  /** Physical pixels. */
  setCursor(x: number, y: number): void;
  getCursor(): [number, number];
  scanCode(vk: number): number;
  /** False when the user still holds Ctrl/Alt/Shift/Win after a short wait. */
  modifiersUp(): Promise<boolean>;
}

export const windowsNative: Native = {
  send(events) {
    const sent = sendInputs(events);
    if (sent !== events.length) throw new Error(`Windows took ${sent} of ${events.length} input events`);
  },
  setCursor: setCursorPos,
  getCursor: getCursorPos,
  scanCode: scanCodeOf,
  modifiersUp: () => waitForModifiersUp(1500),
};

/** Units sent per batch when typing, and the pause between: apps drop characters fed faster. */
const TYPE_CHUNK = 40;
const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const TYPE_PAUSE_MS = 10;
/** After the cursor lands: a web page's button shows its hover state before it takes a click. */
const HOVER_MS = 20;
const DRAG_STEPS = 10;
const DRAG_STEP_MS = 15;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class WinScreenInput implements ScreenInput {
  /** Keys and buttons pressed and not yet released, so an abort lets go of exactly these. */
  private readonly heldKeys = new Set<number>();
  private readonly heldButtons = new Set<MouseButton>();
  private injectedAt = 0;

  constructor(
    private readonly capture: Pick<ScreenCapture, "toPhysical" | "toShot">,
    private readonly native: Native = windowsNative,
  ) {}

  async click(
    x: number,
    y: number,
    o: { button?: MouseButton; count?: 1 | 2 | 3; modifiers?: string[] } = {},
  ): Promise<void> {
    const mods = o.modifiers?.length ? parseCombo(o.modifiers.join("+")) : [];
    await this.ready();
    this.place(x, y);
    await sleep(HOVER_MS);
    const [down, up] = BUTTON_FLAGS[o.button ?? "left"];
    const clicks: InputEvent[] = [];
    for (let i = 0; i < (o.count ?? 1); i++)
      clicks.push({ kind: "mouse", flags: down, data: 0 }, { kind: "mouse", flags: up, data: 0 });
    this.withKeys(mods, clicks);
  }

  async drag(from: [number, number], to: [number, number]): Promise<void> {
    const end = this.capture.toPhysical(...to); // checked before anything is pressed
    await this.ready();
    const start = this.place(...from);
    await this.button("left", true);
    for (let step = 1; step < DRAG_STEPS; step++) {
      await sleep(DRAG_STEP_MS);
      this.native.setCursor(
        Math.round(start[0] + ((end[0] - start[0]) * step) / DRAG_STEPS),
        Math.round(start[1] + ((end[1] - start[1]) * step) / DRAG_STEPS),
      );
    }
    await sleep(DRAG_STEP_MS);
    this.native.setCursor(...end);
    await sleep(DRAG_STEP_MS);
    await this.button("left", false);
  }

  async move(x: number, y: number): Promise<void> {
    this.place(x, y);
  }

  mouseDown(): Promise<void> {
    return this.button("left", true);
  }

  mouseUp(): Promise<void> {
    return this.button("left", false);
  }

  async scroll(
    at: [number, number] | null,
    direction: ScrollDirection,
    amount: number,
    modifiers: string[] = [],
  ): Promise<void> {
    const mods = modifiers.length ? parseCombo(modifiers.join("+")) : [];
    await this.ready();
    if (at) {
      this.place(...at);
      await sleep(HOVER_MS);
    }
    const flags = direction === "up" || direction === "down" ? MOUSEEVENTF_WHEEL : MOUSEEVENTF_HWHEEL;
    const data = direction === "up" || direction === "right" ? WHEEL_DELTA : -WHEEL_DELTA;
    const notches = Math.max(1, Math.round(amount));
    this.withKeys(
      mods,
      Array.from({ length: notches }, () => ({ kind: "mouse" as const, flags, data })),
    );
  }

  async type(text: string): Promise<void> {
    await this.ready();
    const events = typeEvents(text);
    for (let i = 0; i < events.length; ) {
      if (i) await sleep(TYPE_PAUSE_MS);
      let end = Math.min(i + TYPE_CHUNK * 2, events.length);
      // An emoji is two code units; a batch ending on its high half would leave the app holding
      // half a character for the pause (T9–T13 review).
      const last = events[end - 1];
      if (end < events.length && last?.kind === "key" && last.vk === 0 && isHighSurrogate(last.scan))
        end += 2;
      this.inject(events.slice(i, end));
      i = end;
    }
  }

  async key(combo: string, repeat = 1): Promise<void> {
    const vks = parseCombo(combo);
    await this.ready();
    for (let i = 0; i < Math.max(1, repeat); i++) this.withKeys(vks, []);
  }

  async holdKey(combo: string, seconds: number, signal?: AbortSignal): Promise<void> {
    const vks = parseCombo(combo);
    await this.ready();
    // ready() can wait up to 1.5 s for the user's modifiers; an abort in that time means no hold.
    if (signal?.aborted) return;
    this.press(vks, false);
    try {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, seconds * 1000);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    } finally {
      this.press([...vks].reverse(), true);
    }
  }

  async cursor(): Promise<[number, number]> {
    return this.capture.toShot(...this.native.getCursor());
  }

  /** One failed release (UIPI, a desktop switch) must not leave the others down. */
  async releaseAll(): Promise<void> {
    for (const button of [...this.heldButtons]) {
      try {
        await this.button(button, false);
      } catch {
        this.heldButtons.delete(button);
      }
    }
    for (const vk of [...this.heldKeys].reverse()) {
      try {
        this.press([vk], true);
      } catch {
        this.heldKeys.delete(vk);
      }
    }
  }

  lastInjectedAt(): number {
    return this.injectedAt;
  }

  /**
   * The assistant is started by holding Ctrl + Alt: typing while they are still down would turn
   * every letter into a shortcut. Waits for the user's hands; refuses rather than guess.
   */
  private async ready(): Promise<void> {
    if (!(await this.native.modifiersUp()))
      throw new Error("A Ctrl, Alt, Shift or Windows key is still held down; nothing was pressed");
  }

  /** Screenshot point → cursor there. Returns the physical point. */
  private place(x: number, y: number): [number, number] {
    const point = this.capture.toPhysical(x, y);
    this.native.setCursor(...point);
    this.injectedAt = Date.now();
    return point;
  }

  private async button(button: MouseButton, down: boolean): Promise<void> {
    const [downFlag, upFlag] = BUTTON_FLAGS[button];
    if (!down && !this.heldButtons.has(button)) return;
    this.inject([{ kind: "mouse", flags: down ? downFlag : upFlag, data: 0 }]);
    if (down) this.heldButtons.add(button);
    else this.heldButtons.delete(button);
  }

  /** Holds `vks` around `inner` in one batch: down in order, inner, up in reverse. */
  private withKeys(vks: number[], inner: InputEvent[]): void {
    this.inject([
      ...vks.map((vk) => keyEvent(vk, false, this.native.scanCode(vk))),
      ...inner,
      ...[...vks].reverse().map((vk) => keyEvent(vk, true, this.native.scanCode(vk))),
    ]);
  }

  private press(vks: number[], up: boolean): void {
    this.inject(vks.map((vk) => keyEvent(vk, up, this.native.scanCode(vk))));
    for (const vk of vks) up ? this.heldKeys.delete(vk) : this.heldKeys.add(vk);
  }

  private inject(events: InputEvent[]): void {
    if (!events.length) return;
    this.native.send(events);
    this.injectedAt = Date.now();
  }
}
