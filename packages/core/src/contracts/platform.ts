import type { AppContext, AudioClip, Mode } from "../types";

export type HotkeyEvent =
  | { type: "pressed"; mode: Mode }
  | { type: "released"; mode: Mode }
  /** `key`: what cancelled it, for the log (Windows: the virtual-key code). */
  | { type: "cancel"; key?: number };

export interface HotkeyBinding {
  /** e.g. "fn", "right_option". */
  keys: string;
  mode: Mode;
}

export interface Hotkey {
  /** This OS's default hold-to-talk keys, used until the user picks their own. */
  defaultBindings(): HotkeyBinding[];
  /**
   * Keys worth suggesting in Settings. On an OS that only watches a fixed set this is the whole
   * set; where any combination works it is a shortlist of good ones, and `accepts` is what
   * decides. The vocabulary differs per OS — "fn" on the Mac.
   */
  supportedKeys(): string[];
  /**
   * Whether this OS can watch `keys`. Settings is not the only way in — settings.json is a file
   * the user can edit — so this is the check that actually guards registration.
   */
  accepts(keys: string): boolean;
  register(bindings: HotkeyBinding[], onEvent: (event: HotkeyEvent) => void): Promise<void>;
  unregisterAll(): Promise<void>;
  /**
   * Also report Esc, as "cancel", while `on`. Only for as long as a dictation is open: a
   * hands-free one is cancelled with Esc, and no other key is ever watched by name.
   */
  watchEscape?(on: boolean): void;
  /**
   * Told each time a key that writes is pressed (letters, digits, punctuation, space; not with a
   * shortcut's Ctrl, ⌘ or Win), never which one. For a snippet's offer, which typing withdraws, and
   * the typing tip. Watched only while a listener is attached; returns the way to detach it.
   */
  onTyped?(listener: () => void): () => void;
  /**
   * Records a new binding from the keys the user holds, read the way they will be watched, so
   * Settings can never record a chord this OS cannot watch. Resolves null when cancelled (Esc alone,
   * or `cancel`). The caller stops the watch first. Without it, Settings records from page key events.
   */
  record?(onHeld: (keys: string) => void): { done: Promise<string | null>; cancel(): void };
}

/** What the user hears around a dictation. Optional: an OS without it simply stays quiet. */
export interface AudioFeedback {
  /** "notice": a message on the pill that wants attention (a learned word, nowhere to type). */
  cue(sound: "start" | "stop" | "notice"): void;
  /** Mute the computer's output while dictating, and restore exactly what was there after. */
  muteOutput(on: boolean): void;
}

/** How a microphone is connected, as the OS reports it (never guessed from its name). */
export type MicKind = "built-in" | "bluetooth" | "iphone" | "wired" | "virtual" | "other";

export interface MicDevice {
  /** Stable across restarts and replugs (CoreAudio's UID on the Mac). */
  id: string;
  name: string;
  kind: MicKind;
  /** The OS's current default input. */
  isDefault: boolean;
}

/** Records 16 kHz mono PCM only between start() and stop(). */
export interface Microphone {
  start(onChunk: (samples: Int16Array) => void): Promise<void>;
  stop(): Promise<AudioClip>;
  /** The inputs the user can choose from. */
  devices?(): Promise<MicDevice[]>;
  /** Record from this device from the next dictation on; "" follows the OS default. */
  use?(id: string): void;
  /** Loudness 0–1 about 20 times a second while on, for a picker's meter; no audio is kept. */
  meter?(on: boolean, onLevel: (level: number) => void): void;
  /**
   * The OS's own voice processing on the signal, as calls use it (noise, echo, other voices), from
   * the next dictation on. Without it, a TV or people nearby reach the speech service and are
   * written down.
   */
  cleanup?(on: boolean): void;
}

/** Puts text at the user's cursor in whatever app is focused. */
export interface TextInserter {
  /**
   * "nowhere" when nothing that takes text had the focus: nothing is typed and the clipboard is
   * left alone, and the app offers to copy the words. Nothing (or "pasted") otherwise.
   */
  insert(text: string): Promise<void | "pasted" | "nowhere">;
  /** Called at key-down, so the check made at key-up is ready (Chromium builds its tree on request). */
  prepare?(): void;
  /**
   * Takes back the paste just made (Ctrl+Z / ⌘Z in the app it went to) and puts `text` in its
   * place: a snippet the person chose after the words went in as said. Only where the cursor can be
   * read and the undo moved it back by exactly what was pasted; otherwise false, nothing changed.
   */
  replaceLast?(text: string): Promise<boolean>;
}

export type PermissionKind = "microphone" | "accessibility" | "input_monitoring" | "screen_recording";
export type PermissionState = "granted" | "denied" | "not_asked" | "unknown";

export interface Permissions {
  /** The permissions this OS needs, in the order onboarding asks for them. */
  required(): PermissionKind[];
  status(kind: PermissionKind): Promise<PermissionState>;
  request(kind: PermissionKind): Promise<void>;
  openSettings(kind: PermissionKind): Promise<void>;
}

export interface ContextReader {
  current(): Promise<AppContext>;
  /**
   * The name people know an app by, from its `appId` ("Visual Studio Code" for Code.exe), for the
   * screens only; null when the app is gone or names nothing. Optional: without it the stored name.
   */
  displayName?(appId: string): Promise<string | null>;
}

/**
 * Reads back the text field a dictation was pasted into, so the user's own fixes to it can be
 * learned. The text stays on the device; only a learned word is ever stored.
 */
export interface FieldReader {
  /**
   * Reports the focused field's text now and again each time it changes, until `stop()` or `ms`
   * has passed; `onEnd` fires once either way, and also when the field cannot be read at all
   * (no access, a password field, an app that exposes no text).
   */
  watch(onText: (text: string) => void, onEnd: (reason?: string) => void, ms: number): { stop(): void };
}

/**
 * Catches mouse presses in one screen area before any app sees them: the floating pill, so that
 * clicking or dragging it never activates the app (which brought its window forward and took the
 * cursor from the app being typed in).
 */
export interface ClickCatcher {
  /** The area in global screen points, or null when nothing should be caught. Resolves false
   * when this Mac cannot catch clicks (no permission), and the pill takes them itself. */
  setArea(area: { x: number; y: number; width: number; height: number } | null): Promise<boolean>;
  /** The mouse button went down on the area, or came up after such a press. */
  onButton(listener: (down: boolean) => void): () => void;
  /** Where the pointer is while such a press is held, from the OS itself. */
  onMove(listener: (point: { x: number; y: number }) => void): () => void;
}

/** OS actions that voice commands can trigger. Exposed to the LLM as tools. */
export interface DesktopActions {
  openApp(name: string): Promise<void>;
  openUrl(url: string): Promise<void>;
}

/**
 * What the app needs from the OS. `platform-win` (here) and `platform-mac` (the friend's Mac repo)
 * return one of these; tests use `fakePlatform()`.
 */
export interface Platform {
  os: "win" | "mac" | "fake";
  hotkey: Hotkey;
  /**
   * Native microphone. Optional: without it the desktop app records through Chromium's Web Audio,
   * which opens the mic more slowly (~300 ms).
   */
  microphone?: Microphone;
  inserter: TextInserter;
  permissions: Permissions;
  context: ContextReader;
  desktop: DesktopActions;
  feedback?: AudioFeedback;
  /** Optional: without it nothing is learned from the user's edits. */
  field?: FieldReader;
  /** Optional: without it the pill's window takes its own clicks. */
  clickCatcher?: ClickCatcher;
}
