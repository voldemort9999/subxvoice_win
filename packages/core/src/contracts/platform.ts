import type { CommandSource, ScreenDriver } from "../agent/types";
import type { AppContext, Mode } from "../types";

export type HotkeyEvent =
  | { type: "pressed"; mode: Mode }
  | { type: "released"; mode: Mode }
  | { type: "cancel" };

export interface HotkeyBinding {
  /** e.g. "ctrl+win", "ctrl+alt". */
  keys: string;
  mode: Mode;
}

export interface Hotkey {
  /** The default hold-to-talk keys, used until the user picks their own. */
  defaultBindings(): HotkeyBinding[];
  /** A shortlist of good keys to suggest in Settings. Any combination `accepts` allows works. */
  supportedKeys(): string[];
  /**
   * Whether this OS can watch `keys`. Settings is not the only way in — settings.json is a file
   * the user can edit — so this is the check that actually guards registration.
   */
  accepts(keys: string): boolean;
  register(bindings: HotkeyBinding[], onEvent: (event: HotkeyEvent) => void): Promise<void>;
  unregisterAll(): Promise<void>;
}

/** Puts text at the user's cursor in whatever app is focused. */
export interface TextInserter {
  insert(text: string): Promise<void>;
}

export type PermissionKind = "microphone";
export type PermissionState = "granted" | "denied" | "not_asked" | "unknown";

export interface Permissions {
  /** The permissions the app needs, in the order onboarding asks for them. */
  required(): PermissionKind[];
  status(kind: PermissionKind): Promise<PermissionState>;
  request(kind: PermissionKind): Promise<void>;
  openSettings(kind: PermissionKind): Promise<void>;
}

export interface ContextReader {
  current(): Promise<AppContext>;
}

/** Everything the app needs from the operating system. `platform-win` returns one of these. */
export interface Platform {
  os: "win" | "fake";
  hotkey: Hotkey;
  inserter: TextInserter;
  permissions: Permissions;
  context: ContextReader;
  /** What command mode can do on this OS. Absent where command mode is not built yet. */
  commands?: CommandSource;
  /** The screen, through the accessibility tree, for what command mode cannot do directly. */
  screen?: ScreenDriver;
}
