// The contract between the UI (renderer) and the main process. Main, preload and renderer
// all import from here, so channel names and types can't drift apart.
import type {
  DictionaryEntry,
  HotkeyBinding,
  PermissionKind,
  PermissionState,
  ScriptPreference,
  SessionRecord,
  WritingTone,
} from "@subx/core";

export const IPC = {
  appInfo: "app:info",
  authState: "auth:state",
  authSignIn: "auth:sign-in",
  authSignUp: "auth:sign-up",
  authSignOut: "auth:sign-out",
  authSetProfile: "auth:set-profile",
  authUsage: "auth:usage",
  authChanged: "auth:changed",
  openRecordingsFolder: "app:open-recordings-folder",
  permissionList: "permissions:list",
  permissionRequest: "permissions:request",
  permissionOpenSettings: "permissions:open-settings",
  historyList: "history:list",
  historyAudio: "history:audio",
  historyRemove: "history:remove",
  historyChanged: "history:changed",
  dictionaryList: "dictionary:list",
  dictionaryUpsert: "dictionary:upsert",
  dictionaryRemove: "dictionary:remove",
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  settingsChanged: "settings:changed",
  microphoneList: "settings:microphones",
  microphonePublish: "settings:microphones-publish",
  updateState: "update:state",
  updateCheck: "update:check",
  updateInstall: "update:install",
  updateChanged: "update:changed",
  // main → pill
  pillState: "pill:state",
  pillLevel: "pill:level",
  micCommand: "mic:command",
  // pill → main
  pillHover: "pill:hover",
  pillClick: "pill:click",
  micChunk: "mic:chunk",
  micStopped: "mic:stopped",
  micError: "mic:error",
} as const;

export interface AppInfo {
  version: string;
  hotkeys: HotkeyBinding[];
  /** Hotkeys worth suggesting; any combination of two or more keys can be recorded. */
  supportedKeys: string[];
  /** Which engines are configured. Settings shows a warning when one is missing. */
  providers: { stt: boolean; llm: boolean };
}

/** User settings. */
export interface AppSettings {
  /** One of `AppInfo.supportedKeys`. */
  hotkey: string;
  /** Held to give a command instead of dictating. Ignored when it is the same as `hotkey`. */
  commandHotkey: string;
  script: ScriptPreference;
  /** MediaDevices id, or "" for the system default. */
  microphoneId: string;
  /** Start SUBXVoice when the user signs in to the computer. */
  launchAtLogin: boolean;
  /** How a composed email reads. Chosen during setup, changeable in Settings. */
  emailTone: WritingTone;
  /** How a composed chat message reads. Separate from email: most people write formal mail and
   * casual chat. */
  messageTone: WritingTone;
}

/** Dictation time used today, and what is left of the daily allowance. */
export interface Usage {
  used: number;
  limit: number;
  remaining: number;
}

/** Who is signed in. The app needs an account before it can dictate. */
export interface AccountState {
  /** The Supabase user id, used to keep each account's data apart on disk. */
  id: string | null;
  email: string | null;
  signedIn: boolean;
  /** What the user asked to be called. Empty until they finish setting up. */
  name: string;
  /** False until the name and hotkey have been chosen once. */
  onboarded: boolean;
}

export interface MicrophoneOption {
  id: string;
  label: string;
}

export interface PermissionStatus {
  kind: PermissionKind;
  state: PermissionState;
}

export type PillState =
  | { kind: "idle" }
  | { kind: "listening" }
  /** `message` carries the raw transcript while the LLM is still cleaning it up. */
  | { kind: "processing"; message?: string }
  /** `warning` says the words went in, but not in the script that was asked for. */
  | { kind: "done"; message: string; warning?: string }
  | { kind: "error"; message: string };

export type MicCommand = "start" | "stop";

/**
 * Where the app is in the update cycle. `unsupported` covers development, where there is no
 * installer to replace; it is a state rather than a silence so the UI can say why.
 */
export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current"; checkedAt: number }
  | { kind: "downloading"; version: string; percent: number }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string }
  | { kind: "unsupported"; reason: string };

/** Exposed to the UI as `window.subx` by the preload script. */
export interface SubxApi {
  auth: {
    state(): Promise<AccountState>;
    signIn(email: string, password: string): Promise<void>;
    signUp(email: string, password: string): Promise<void>;
    signOut(): Promise<void>;
    setProfile(name: string): Promise<void>;
    usage(): Promise<Usage | null>;
    onChanged(listener: (state: AccountState) => void): () => void;
  };
  app: {
    info(): Promise<AppInfo>;
    openRecordingsFolder(): Promise<void>;
  };
  update: {
    state(): Promise<UpdateState>;
    /** Checks now. Resolves with the state once the check has settled. */
    check(): Promise<UpdateState>;
    /** Quits and installs. Only does anything once the state is `ready`. */
    install(): void;
    onChanged(listener: (state: UpdateState) => void): () => void;
  };
  permissions: {
    list(): Promise<PermissionStatus[]>;
    request(kind: PermissionKind): Promise<void>;
    openSettings(kind: PermissionKind): Promise<void>;
  };
  history: {
    list(): Promise<SessionRecord[]>;
    /** WAV bytes of a recording. */
    audio(id: string): Promise<Uint8Array>;
    remove(id: string): Promise<void>;
    onChanged(listener: () => void): () => void;
  };
  dictionary: {
    list(): Promise<DictionaryEntry[]>;
    upsert(entry: DictionaryEntry): Promise<void>;
    remove(word: string): Promise<void>;
  };
  settings: {
    get(): Promise<AppSettings>;
    set(settings: Partial<AppSettings>): Promise<AppSettings>;
    onChanged(listener: (settings: AppSettings) => void): () => void;
    /** Microphones the user can pick from; read in the renderer, where MediaDevices lives. */
    publishMicrophones(options: MicrophoneOption[]): void;
    microphones(): Promise<MicrophoneOption[]>;
  };
  /** Used only by the recording pill window. The mic commands are for the Web Audio fallback. */
  pill: {
    onState(listener: (state: PillState) => void): () => void;
    /** Loudness 0–1 while listening, for the waveform. */
    onLevel(listener: (level: number) => void): () => void;
    onMicCommand(listener: (command: MicCommand) => void): () => void;
    hover(inside: boolean): void;
    click(): void;
    /** 16 kHz mono PCM. */
    sendChunk(samples: Int16Array): void;
    /** All audio has been sent after a "stop". */
    micStopped(): void;
    micError(message: string): void;
  };
}
