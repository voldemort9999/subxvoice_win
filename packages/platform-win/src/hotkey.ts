import { type Hotkey, type HotkeyBinding, type HotkeyEvent, type Mode, SubxError } from "@subx/core";
import { isKeyDown, VK } from "./win32";

const POLL_MS = 15; // imperceptible next to a ~800 ms pipeline

/** A key name maps to the virtual keys that satisfy it — either side of the keyboard counts. */
export const KEYS: Record<string, number[]> = {
  ctrl: [VK.control],
  shift: [VK.shift],
  alt: [VK.alt],
  win: [VK.lwin, VK.rwin],
  space: [0x20],
  tab: [0x09],
  enter: [0x0d],
  esc: [0x1b],
  backspace: [0x08],
  capslock: [0x14],
  insert: [0x2d],
  delete: [0x2e],
  home: [0x24],
  end: [0x23],
  pageup: [0x21],
  pagedown: [0x22],
  left: [0x25],
  up: [0x26],
  right: [0x27],
  down: [0x28],
  pause: [0x13],
  scrolllock: [0x91],
  numlock: [0x90],
  menu: [0x5d],
  // One side of a modifier, for a modifier held on its own (Right Ctrl, Right Alt).
  lshift: [0xa0],
  rshift: [0xa1],
  lctrl: [0xa2],
  rctrl: [0xa3],
  lalt: [0xa4],
  ralt: [0xa5],
  lwin: [0x5b],
  rwin: [0x5c],
  // The US-layout names of the punctuation keys; on other layouts the same physical key.
  semicolon: [0xba],
  equal: [0xbb],
  comma: [0xbc],
  minus: [0xbd],
  period: [0xbe],
  slash: [0xbf],
  backquote: [0xc0],
  bracketleft: [0xdb],
  backslash: [0xdc],
  bracketright: [0xdd],
  quote: [0xde],
  numpadmultiply: [0x6a],
  numpadadd: [0x6b],
  numpadsubtract: [0x6d],
  numpaddecimal: [0x6e],
  numpaddivide: [0x6f],
};

// Letters and digits use their ASCII code as the virtual key; F1–F24 run on from 0x70. Generated
// rather than listed, because forty-odd hand-written entries are forty-odd chances to mistype one.
for (let index = 0; index < 26; index++) KEYS[String.fromCharCode(97 + index)] = [0x41 + index];
for (let digit = 0; digit <= 9; digit++) KEYS[String(digit)] = [0x30 + digit];
for (let digit = 0; digit <= 9; digit++) KEYS[`numpad${digit}`] = [0x60 + digit];
for (let n = 1; n <= 24; n++) KEYS[`f${n}`] = [0x6f + n];

/** One side of a modifier → its name alone, and the generic name it has in a chord. */
const SIDES: Record<number, { alone: string; chord: string }> = {
  160: { alone: "lshift", chord: "shift" },
  161: { alone: "rshift", chord: "shift" },
  162: { alone: "lctrl", chord: "ctrl" },
  163: { alone: "rctrl", chord: "ctrl" },
  164: { alone: "lalt", chord: "alt" },
  165: { alone: "ralt", chord: "alt" },
  91: { alone: "lwin", chord: "win" },
  92: { alone: "rwin", chord: "win" },
};
const MODIFIER_ORDER = ["ctrl", "shift", "alt", "win"];
/**
 * Every other key by its virtual code, for naming what was held. Not the generic Ctrl, Shift and
 * Alt codes: Windows reports each with its side's, and the side names the key.
 */
const NAME_OF = new Map<number, string>();
const GENERIC = new Set<number>([VK.control, VK.shift, VK.alt]);
for (const [name, codes] of Object.entries(KEYS)) {
  const [code] = codes;
  if (
    codes.length === 1 &&
    code !== undefined &&
    !(code in SIDES) &&
    !GENERIC.has(code) &&
    !NAME_OF.has(code)
  )
    NAME_OF.set(code, name);
}

/**
 * The binding for the keys held at a chord's fullest, as `parseBinding` reads it, or null when no
 * key in it can be bound. Windows reports Ctrl, Shift and Alt twice — the generic code and the
 * side's — so the sides decide: in a chord any side counts ("ctrl+win"), a modifier alone keeps its
 * side ("rctrl"), and AltGr, which Windows sends as Left Ctrl + Right Alt, is Right Alt.
 */
/**
 * Codes no hand binds: the generic modifiers (the side names the key), media and browser keys
 * (Windows reported a Play/Pause held with nothing pressed, S-023), gamepad, IME and typed-character
 * codes, and the mouse.
 */
function unbindable(vk: number): boolean {
  return (
    vk < SCAN_FIRST ||
    vk > 0xff ||
    GENERIC.has(vk) ||
    (vk >= 0xa6 && vk <= 0xb7) ||
    (vk >= 0xc3 && vk <= 0xda) ||
    vk === 0xe5 ||
    vk === 0xe7
  );
}

/**
 * A key's name; one with none (a laptop's own key, 0xFF, vendor codes) by its number, "vk255" — so
 * whatever a key sends can be bound (user, 2026-11-20: "fn key ho hi nahi rahi").
 */
const nameOf = (vk: number): string | undefined =>
  NAME_OF.get(vk) ?? (vk in SIDES || unbindable(vk) ? undefined : `vk${vk}`);

/** "vk255" → 0xFF, only for a code with no name of its own ("vk65" is not a way round "a"). */
function numbered(name: string): number | undefined {
  const match = /^vk(\d{1,3})$/.exec(name);
  const vk = match ? Number(match[1]) : Number.NaN;
  return Number.isInteger(vk) && nameOf(vk) === name ? vk : undefined;
}

export function bindingFor(held: Iterable<number>): string | null {
  const codes = [...new Set(held)].filter((vk) => vk in SIDES || nameOf(vk) !== undefined);
  if (codes.length === 0) return null;
  const sides = codes.filter((vk) => vk in SIDES);
  const others = codes.filter((vk) => !(vk in SIDES));
  if (others.length === 0) {
    if (sides.length === 2 && sides.includes(0xa2) && sides.includes(0xa5)) return "ralt";
    if (sides.length === 1) return SIDES[sides[0] as number]?.alone ?? null;
  }
  const modifiers = new Set(sides.map((vk) => SIDES[vk]?.chord));
  return [
    ...MODIFIER_ORDER.filter((name) => modifiers.has(name)),
    ...others.map((vk) => nameOf(vk) as string),
  ].join("+");
}

/**
 * Hold-to-talk means the keys stay down for the length of a sentence, and a single key that typing
 * presses (a letter, Space, Ctrl) would fire constantly while the user types, so those need a
 * second key. A key typing never presses may stand alone (user, 2026-11-20: "func key ko bhi set
 * kar saku"): F1–F24, Pause, Scroll Lock. It still reaches the app in front — no hook swallows it
 * (journal 001) — so Settings says to pick one that app does not use.
 */
const MIN_KEYS = 2;
const ALONE = new Set([
  "pause",
  "scrolllock",
  ...Array.from({ length: 24 }, (_, i) => `f${i + 1}`),
  // Typing rarely uses the right-hand Ctrl and Alt alone; a shortcut made with one cancels the
  // dictation it started (any other key does), so the cost of a stray press is a flicker.
  "rctrl",
  "ralt",
]);

/** Mouse buttons live below 0x07 and must never count as "some other key". */
const SCAN_FIRST = 0x08;
/** 0xFF included: it is what keys with no virtual key of their own report. */
const SCAN_LAST = 0xff;

export function parseBinding(keys: string): number[][] {
  const groups = keys
    .toLowerCase()
    .split("+")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => {
      const vk = numbered(name);
      return KEYS[name] ?? (vk === undefined ? undefined : [vk]);
    });
  if (groups.length === 0 || groups.some((group) => !group)) {
    throw new SubxError("unsupported", `Unsupported hotkey: ${keys}`);
  }
  return groups as number[][];
}

/**
 * Hold-to-talk by polling real key state — see win32.ts for why this is not a keyboard hook.
 * Pressing any other key while holding sends "cancel", so Win+Ctrl+Left still switches desktops.
 */
const VK_ESCAPE = 0x1b;

export class WinHotkey implements Hotkey {
  private timer: NodeJS.Timeout | null = null;
  private bindings: { groups: number[][]; own: Set<number>; mode: Mode }[] = [];
  private held: Mode | null = null;
  private cancelled = false;
  private changedAt = 0;
  /** Other keys already down when the chord was pressed (see tick). */
  private already = new Set<number>();
  private escape = false;
  private escapeDown = false;
  private readonly down: (vk: number) => boolean;

  /** `down` is injectable so the state machine can be tested without a keyboard. */
  constructor(down: (vk: number) => boolean = isKeyDown) {
    this.down = down;
  }

  /** Ctrl + Win: no Windows shortcut uses the pair on its own. */
  defaultBindings(): HotkeyBinding[] {
    return [{ keys: "ctrl+win", mode: "exact" }];
  }

  /** Suggestions only — Windows watches any combination `accepts` allows. */
  supportedKeys(): string[] {
    return ["ctrl+win", "ctrl+alt", "alt+win", "ctrl+shift+alt"];
  }

  accepts(keys: string): boolean {
    try {
      const key = keys.trim().toLowerCase();
      // A key with no name of its own ("vk255") is no typing key, so it may stand alone too.
      return parseBinding(keys).length >= MIN_KEYS || ALONE.has(key) || numbered(key) !== undefined;
    } catch {
      return false;
    }
  }

  async register(bindings: HotkeyBinding[], onEvent: (event: HotkeyEvent) => void): Promise<void> {
    this.bindings = bindings.map((binding) => {
      const groups = parseBinding(binding.keys);
      return { groups, own: new Set(groups.flat()), mode: binding.mode };
    });
    await this.unregisterAll();
    this.timer = setInterval(() => this.tick(onEvent), POLL_MS);
    // Polling must never hold up quitting.
    this.timer.unref?.();
  }

  async unregisterAll(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.held = null;
    this.cancelled = false;
  }

  /**
   * Esc as "cancel", only while a dictation is open (the Mac app's rule): a hands-free dictation
   * has no key held, so Esc is the way out. An Esc already down when watching starts is not a press.
   */
  watchEscape(on: boolean): void {
    this.escape = on;
    this.escapeDown = on && this.down(VK_ESCAPE);
  }

  /** A bound chord is held right now — so the assistant's touch watch does not count it as the user using the PC. */
  chordHeld(): boolean {
    return this.held !== null;
  }

  /**
   * Date.now() of the chord's last press or release; 0 before any. Its first key goes down before
   * the pair is recognised and its last key-up after it clears, so touch.ts uses this edge too.
   */
  chordChangedAt(): number {
    return this.changedAt;
  }

  /**
   * Records a new hotkey from the keys the user holds, read by this same poll: the chord at its
   * fullest, ended when every key is let go. Settings recorded through the page's key events before,
   * which named the Windows key "cmd" and most keys nothing (user, 2026-11-20). Keys already down at
   * the start (the click on "Change", a stuck media key) are left out until let go; Esc alone stops.
   * The caller unregisters the watch first, or holding the current hotkey would start a dictation.
   */
  record(onHeld: (keys: string) => void): { done: Promise<string | null>; cancel(): void; tick(): void } {
    const before = new Set<number>();
    for (let vk = 0x01; vk <= SCAN_LAST; vk += 1) if (this.down(vk)) before.add(vk);
    const peak = new Set<number>();
    let over = false;
    let finish!: (keys: string | null) => void;
    const done = new Promise<string | null>((resolve) => {
      finish = resolve;
    });
    const end = (keys: string | null) => {
      if (over) return;
      over = true;
      clearInterval(timer);
      finish(keys);
    };
    const tick = () => {
      if (over) return;
      for (const vk of before) if (!this.down(vk)) before.delete(vk);
      const now: number[] = [];
      for (let vk = SCAN_FIRST; vk <= SCAN_LAST; vk += 1) if (!before.has(vk) && this.down(vk)) now.push(vk);
      if (now.length === 0) {
        if (peak.size > 0) end(bindingFor(peak));
        return;
      }
      if (peak.size === 0 && now.length === 1 && now[0] === VK_ESCAPE) return end(null);
      const shown = bindingFor(peak);
      for (const vk of now) peak.add(vk);
      const keys = bindingFor(peak);
      if (keys && keys !== shown) onHeld(keys);
    };
    const timer = setInterval(tick, POLL_MS);
    timer.unref?.();
    return { done, cancel: () => end(null), tick };
  }

  /** One poll. Exposed for tests; the interval calls it. */
  tick(onEvent: (event: HotkeyEvent) => void): void {
    if (this.escape) {
      const down = this.down(VK_ESCAPE);
      if (down && !this.escapeDown) onEvent({ type: "cancel", key: VK_ESCAPE });
      this.escapeDown = down;
    }
    if (this.held === null) {
      const match = this.bindings.find((b) => b.groups.every((g) => g.some(this.down)));
      if (!match) return;
      this.held = match.mode;
      this.changedAt = Date.now();
      this.cancelled = false;
      // Keys already down are not "another key pressed while holding": a media key Windows kept
      // reporting as held (0xB3, dev PC 2026-11-18) cancelled every command the moment it began.
      this.already = new Set(otherKeysDown(match.own, this.down));
      onEvent({ type: "pressed", mode: match.mode });
      return;
    }

    const binding = this.bindings.find((item) => item.mode === this.held);
    const stillDown = binding?.groups.every((group) => group.some(this.down)) ?? false;
    if (!stillDown) {
      const mode = this.held;
      this.held = null;
      this.changedAt = Date.now();
      if (!this.cancelled) onEvent({ type: "released", mode });
      this.cancelled = false;
      return;
    }
    // Only scan the whole keyboard while the hotkey is actually held — a rare, short window.
    // A key that was down at the press counts again once it has been let go and pressed anew.
    for (const vk of this.already) if (!this.down(vk)) this.already.delete(vk);
    const other = binding
      ? otherKeysDown(binding.own, this.down).find((vk) => !this.already.has(vk))
      : undefined;
    if (!this.cancelled && other !== undefined) {
      this.cancelled = true;
      onEvent({ type: "cancel", key: other });
    }
  }
}

/**
 * Ctrl, Shift and Alt each report through a generic code *and* a side-specific one. Holding the
 * binding's own Ctrl would otherwise look like "some other key" and cancel every dictation.
 */
const SIBLINGS: Record<number, number[]> = {
  [VK.control]: [0xa2, 0xa3],
  [VK.shift]: [0xa0, 0xa1],
  [VK.alt]: [0xa4, 0xa5],
  // A one-sided binding: its own generic code is reported with it.
  160: [VK.shift],
  161: [VK.shift],
  162: [VK.control],
  163: [VK.control],
  164: [VK.alt],
  // AltGr is Right Alt with a Left Ctrl Windows adds itself.
  165: [VK.alt, VK.control, 0xa2],
};

export function anyOtherKeyDown(
  own: Set<number>,
  down: (vk: number) => boolean = isKeyDown,
  already: ReadonlySet<number> = new Set(),
): boolean {
  return otherKeysDown(own, down).some((vk) => !already.has(vk));
}

/** Every key down now besides the binding's own (and their left/right siblings). */
function otherKeysDown(own: Set<number>, down: (vk: number) => boolean): number[] {
  const ignore = new Set(own);
  for (const vk of own) for (const sibling of SIBLINGS[vk] ?? []) ignore.add(sibling);
  const found: number[] = [];
  for (let vk = SCAN_FIRST; vk <= SCAN_LAST; vk += 1) if (!ignore.has(vk) && down(vk)) found.push(vk);
  return found;
}
