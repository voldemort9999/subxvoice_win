// The contract between the UI (renderer) and the main process. Main, preload and renderer
// all import from here, so channel names and types can't drift apart.
import type {
  DictionaryEntry,
  HotkeyBinding,
  MicDevice,
  PermissionKind,
  PermissionState,
  SessionRecord,
} from "@subx/core";
import type { PillPlace } from "./pill-place";

export const IPC = {
  appInfo: "app:info",
  windowChrome: "window:chrome",
  authState: "auth:state",
  authStartEmail: "auth:start-email",
  authVerifyCode: "auth:verify-code",
  authResendEmailCode: "auth:resend-email-code",
  authDeleteAccount: "auth:delete-account",
  authGoogle: "auth:google",
  authSignOut: "auth:sign-out",
  authSetProfile: "auth:set-profile",
  authUsage: "auth:usage",
  billingGet: "billing:get",
  billingCheckout: "billing:checkout",
  billingPortal: "billing:portal",
  billingSeatsQuote: "billing:seats-quote",
  billingSeatsBuy: "billing:seats-buy",
  teamGet: "team:get",
  teamSave: "team:save",
  teamInvite: "team:invite",
  teamRemove: "team:remove",
  teamWords: "team:words",
  teamLeave: "team:leave",
  authChanged: "auth:changed",
  openRecordingsFolder: "app:open-recordings-folder",
  permissionList: "permissions:list",
  permissionRequest: "permissions:request",
  permissionOpenSettings: "permissions:open-settings",
  appRestart: "app:restart",
  historyList: "history:list",
  statsDays: "stats:days",
  /** An app's name and icon as Windows shows them, from the `appId` kept with a dictation. */
  appLook: "apps:look",
  /** This PC's own day totals, for "on this PC" when the account is used on other devices too. */
  statsThisDevice: "stats:this-device",
  /** The account's totals or allowance changed (a dictation, or another device): read them again. */
  statsChanged: "stats:changed",
  /** Words arrived from another device: the dictionary page reads its list again. */
  dictionaryChanged: "dictionary:changed",
  /** What the last dictation read from the screen (memory only). */
  screenLast: "screen:last",
  /** Choose an app (an .exe) the screen is never read in. */
  screenPickApp: "screen:pick-app",
  snippetsList: "snippets:list",
  snippetsSave: "snippets:save",
  snippetsRemove: "snippets:remove",
  /** A snippet was added, changed, removed or used: its page reads them again. */
  snippetsChanged: "snippets:changed",
  accountDevices: "account:devices",
  historyAudio: "history:audio",
  historyRemove: "history:remove",
  historyClear: "history:clear",
  dictionaryLearning: "dictionary:learning",
  dictionaryAcceptPending: "dictionary:accept-pending",
  dictionaryDropPending: "dictionary:drop-pending",
  dictionaryAllowAgain: "dictionary:allow-again",
  historyChanged: "history:changed",
  dictionaryList: "dictionary:list",
  dictionaryUpsert: "dictionary:upsert",
  dictionaryRemove: "dictionary:remove",
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  settingsChanged: "settings:changed",
  hotkeyRecord: "hotkey:record",
  hotkeyRecordCancel: "hotkey:record-cancel",
  hotkeyHeld: "hotkey:held",
  navigate: "app:navigate",
  microphoneList: "settings:microphones",
  microphonePublish: "settings:microphones-publish",
  micDevices: "mic:devices",
  micMeter: "mic:meter",
  micMeterLevel: "mic:meter-level",
  voiceSettingsGet: "voice-settings:get",
  voiceSettingsSet: "voice-settings:set",
  voiceLanguages: "voice-settings:languages",
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
  pillPress: "pill:press",
  pillRelease: "pill:release",
  pillHoverReset: "pill:hover-reset",
  pillMenu: "pill:menu",
  pillArea: "pill:area",
  pillDemo: "pill:demo",
  micChunk: "mic:chunk",
  micStopped: "mic:stopped",
  micError: "mic:error",
} as const;

export interface AppInfo {
  version: string;
  hotkeys: HotkeyBinding[];
  /** Hotkeys worth suggesting. On macOS this is also the limit; see `customHotkeys`. */
  supportedKeys: string[];
  /** True when any key combination can be recorded, rather than only `supportedKeys`. */
  customHotkeys: boolean;
  /**
   * True when the OS plug records natively (Mac). That path uses the system input device, so the
   * in-app microphone picker only applies when this is false.
   */
  nativeMicrophone: boolean;
  /** The microphone can be cleaned by the OS's voice processing (the setting is shown only then). */
  voiceCleanup: boolean;
  /** When this run of the app started (ms). The launch scene plays once per run, not per window. */
  startedAt: number;
}

/** The pill's look (Settings → Appearance). Classic is the default. */
export type PillStyle = "classic" | "line";

/** A fix seen once, waiting for the same fix again before its word is learned. */
export interface PendingFix {
  key: string;
  word: string;
  heardAs: string;
  app?: string;
  at: number;
  count: number;
}

/** One day's dictation, by the Mac's calendar ("2026-11-20"): counts only, never text. */
/** An app as people know it: "Visual Studio Code" and its icon, not "Code". */
export interface AppLook {
  name: string;
  /** A data: URL of the app's icon, "" when it has none. */
  icon: string;
}

/** A snippet as kept (snippets.json): what is said, what goes in, how often it went in. */
export interface SnippetItem {
  id: string;
  triggers: string[];
  text: string;
  uses?: number;
  lastUsedAt?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface DayTotal {
  words: number;
  speakingMs: number;
  dictations: number;
}

export type HistoryKeep = "forever" | "1d" | "7d" | "30d";

/** How long each choice keeps a dictation, in ms. */
export const HISTORY_KEEP_MS: Record<Exclude<HistoryKeep, "forever">, number> = {
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** User settings. Identical on both OSes; only the allowed hotkey values differ. */
export interface AppSettings {
  /** One of `AppInfo.supportedKeys`. */
  hotkey: string;
  /** MediaDevices id, or "" for the system default. */
  microphoneId: string;
  /** Clean the microphone the way calls do, so background noise and voices are left out. */
  voiceCleanup: boolean;
  /** Start SUBXVoice when the user signs in to the computer. */
  launchAtLogin: boolean;
  /** A short sound when the microphone opens and when it closes. */
  sounds: boolean;
  /** Mute the Mac's output (music, videos) while dictating. */
  muteAudio: boolean;
  /** Keep the small pill on screen between dictations; off, it appears only while dictating. */
  pillWhenIdle: boolean;
  /** Hidden from its own menu until this time (ms); 0 when not. It still shows while dictating. */
  pillHiddenUntil: number;
  /** How long dictations and their recordings are kept on this Mac; older ones are deleted. */
  keepHistory: HistoryKeep;
  pillStyle: PillStyle;
  /** Where on the screen the pill sits: a corner or the middle of an edge. */
  pillPosition: PillPlace;
  /** Add a word to the dictionary when the user corrects it after a paste. */
  learnWords: boolean;
  /** Read the screen around the cursor at key-down, for the recogniser only (Mac 08c582a). */
  screenContext: boolean;
  /** Apps (their executables) the screen is never read in. */
  screenContextOff: string[];
}

/** The screen text the last dictation read, as it was sent; kept in memory until the app quits. */
export interface LastScreen {
  app: string;
  text: string | null;
  at: number;
}

/**
 * How the account's dictation is heard and written, kept by the backend (`/v1/settings`) so it is
 * the same on every device. Only the part this app edits is typed; the rest passes through.
 */
export interface VoiceLanguages {
  /** "auto", or the languages to write as spoken, first one primary: any other is written in it. */
  spoken: "auto" | string[];
  /** Hindi written in English letters. */
  hinglish: boolean;
  /** Everything written in this language, whatever was spoken; null = as above. */
  writeIn: string | null;
}

/** How the words read (the server's styles), chosen per kind of app. */
export type WritingStyle = "formal" | "casual" | "very_casual";
export type StyleCategory = "personal" | "work" | "email" | "other";

export interface VoiceSettings {
  languages: VoiceLanguages;
  styles?: Record<StyleCategory, WritingStyle>;
}

/**
 * Dictation time used today and the day's time guard (seconds), and words: how many this account
 * typed this week (or day), the share of its allowance used, and when they come back. The allowance
 * itself is never sent: how many free words there are is not shown to anyone.
 */
export interface Usage {
  used: number;
  limit: number;
  remaining: number;
  plan?: string;
  words?: {
    used: number;
    unlimited: boolean;
    /** 0 to 100; null when unlimited. */
    percentUsed: number | null;
    out: boolean;
    per: "day" | "week";
    resetsAt: string;
  };
}

export type Region = "in" | "intl";
export type BillingInterval = "month" | "year";

/** One plan as the server describes it: names and prices can change without a new release. */
export interface BillingPlan {
  id: "free" | "pro" | "power" | "team";
  name: string;
  unlimited: boolean;
  per: "day" | "week";
  /** In the account's currency; null for Free and Enterprise. */
  price: Record<BillingInterval, number> | null;
  buyable: Record<BillingInterval, boolean> | null;
  /** Can be paid once, with no autopay (a month, or a year at the yearly rate). */
  buyableOnce?: Record<BillingInterval, boolean> | null;
}

/** What more seats for a team paid once cost: for the months left, until the team's end. */
export interface SeatsQuote {
  add: number;
  months: number;
  until: string;
  amount: number;
  currency: "INR" | "USD";
}

/** The account's team (Team and Enterprise plans), or null (GET /v1/team). */
export interface TeamInfo {
  team: {
    name: string;
    seats: number;
    role: "owner" | "admin" | "member";
    members: {
      email: string;
      role: "owner" | "admin" | "member";
      name: string | null;
      invitedAt: string;
      joinedAt: string | null;
      you: boolean;
      /** Owner and admins only: words since Monday and the last day used (counts, never words). */
      weekWords?: number;
      lastDay?: string | null;
    }[];
    /** `canChange`: this person may change or remove it (their own; any for owner and admins). */
    words: {
      word: string;
      misheardAs: string[];
      addedBy?: string | null;
      mine?: boolean;
      canChange?: boolean;
    }[];
    /** A member who also pays for a plan of their own: the team covers them. */
    paysOwnPlan?: boolean;
    /** False when this person's seat isn't paid for (the payment for it failed): their own plan. */
    seated?: boolean;
    /**
     * Owner and admins: billed per person who has joined (no cap), how many are billed now, and
     * what one more costs (`amount` per month, `per` the billing period).
     */
    billing?: {
      perPerson: boolean;
      billedPeople: number;
      pricePerPerson?: { amount: number; currency: string; per: "month" | "year" };
      /** A team paid once: when its months end. */
      prepaidUntil?: string;
    };
  } | null;
  /** The account pays for Team (or has Enterprise) and has no team yet. */
  canStart: boolean;
}

/** The account's plan and every plan on offer (GET /v1/billing). */
export interface Billing {
  plan: BillingPlan["id"];
  /** "trialing": the free start every new account gets. */
  status: string | null;
  /** Renews on this date, or ends on it when `cancelAtPeriodEnd`. */
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** "trial", "manual" (given by us), or the payment company. */
  provider: string | null;
  /** Paid once, no autopay: it ends on `periodEnd`; paying again adds more time. */
  once?: boolean;
  /** Rupees in India, dollars everywhere else: decided by the server from where the person is. */
  region: Region;
  currency: "INR" | "USD";
  plans: BillingPlan[];
  trial: { plan: string; days: number } | null;
  popular: string;
  canBuy: boolean;
}

/** A computer the account uses SUBXVoice on (the server's devices table). */
export interface AccountDevice {
  id: string;
  platform: string | null;
  appVersion: string | null;
  chip: string | null;
  os: string | null;
  firstSeen: string;
  lastSeen: string;
  /** This Mac. */
  current: boolean;
}

/** Who is signed in. The app needs an account before it can dictate. */
export interface AccountState {
  /** The account's id, used to keep each account's data apart on disk. */
  id: string | null;
  email: string | null;
  signedIn: boolean;
  /** What the user asked to be called. Empty until they finish setting up. */
  name: string;
  /** False until the name has been chosen once. */
  onboarded: boolean;
  /** A name to offer in setup (the first name Google gave), or "". */
  suggestedName: string;
  /** The Google profile photo as a data: URL, or "" (the round initial is shown). */
  photo: string;
  /** Signed out: the Google account last used here, or null. Kept on sign-out, gone on delete. */
  lastGoogle: LastGoogleAccount | null;
}

/** The Google account last signed in on this Mac, offered as "Continue as …" after a sign-out. */
export interface LastGoogleAccount {
  email: string;
  name: string;
  /** A data: URL, or "" (the round initial is shown). */
  photo: string;
}

export interface MicrophoneOption {
  id: string;
  label: string;
}

export interface PermissionStatus {
  kind: PermissionKind;
  state: PermissionState;
  /**
   * Allowed, but this run of the app is still refused (macOS applies Input Monitoring only after
   * the app restarts): the list offers to restart it.
   */
  restartNeeded?: true;
}

export type PillState =
  | { kind: "idle" }
  /** `text` is what has been heard so far; `locked` is hands-free (the key is no longer held). */
  /** `icon`: the app the words will go into, as a data: URL (Windows: its exe's icon). */
  | { kind: "listening"; locked?: boolean; icon?: string }
  /** `message` carries the finished words while they are pasted. */
  | { kind: "processing"; message?: string }
  /** `warning` says the words went in, but not in the script that was asked for. */
  | { kind: "done"; message: string }
  /** `micCheck`: the microphone gave only silence, and a click opens its check in Settings. */
  | { kind: "error"; message: string; micCheck?: boolean }
  /** Words just learned from the user's own fixes; clicking the pill takes them back out. */
  | { kind: "learned"; words: string[] }
  /** No text box had the focus, so nothing was typed; clicking the pill copies `text`. */
  | { kind: "unplaced"; text: string }
  /**
   * A snippet's trigger was said inside a sentence and the words went in as said; clicking the pill
   * puts the snippet's text in their place instead. `trigger` as said (Mac e6315c8).
   */
  | { kind: "snippet"; trigger: string };

export type MicCommand = "start" | "stop";

/** The main process sending the dashboard somewhere: a page, and for Settings a section of it. */
export interface Navigation {
  page: "dashboard" | "insights" | "dictionary" | "settings";
  tab?: string;
}

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
  /** A newer version exists, and this copy cannot install it itself (no Developer ID yet): download it. */
  | { kind: "available"; version: string; url: string }
  | { kind: "error"; message: string }
  | { kind: "unsupported"; reason: string };

/** After a sign-in code is emailed: when the next may be asked for. */
export interface CodeSent {
  /** Seconds until another code may be sent; 0 means now. */
  resendIn: number;
  /** Codes still allowed in the current 10 minutes. */
  left: number;
}

/** Exposed to the UI as `window.subx` by the preload script. */
export interface SubxApi {
  os: "mac";
  auth: {
    state(): Promise<AccountState>;
    /**
     * Opens the browser on Google; resolves once the user is back and signed in. `chooseAccount`
     * makes Google show its account list instead of going on with the account it already has.
     */
    signInWithGoogle(options?: { chooseAccount?: boolean }): Promise<void>;
    /** Emails a code: it creates the account for a new address and signs in to an existing one. */
    startEmail(email: string): Promise<CodeSent>;
    /** The emailed code; resolves signed in. */
    verifyCode(code: string): Promise<void>;
    resendEmailCode(): Promise<CodeSent>;
    /** Deletes the account everywhere: on the server, at sign-in and on this Mac. */
    deleteAccount(): Promise<void>;
    signOut(): Promise<void>;
    setProfile(name: string): Promise<void>;
    usage(): Promise<Usage | null>;
    /** The computers this account uses SUBXVoice on; asked only when the account page opens. */
    devices(): Promise<AccountDevice[]>;
    onChanged(listener: (state: AccountState) => void): () => void;
  };
  team: {
    /** Null when the server can't be reached. */
    get(): Promise<TeamInfo | null>;
    /** Starts the team, or renames it. */
    save(name: string): Promise<void>;
    /** Adds someone by email; they join when they sign in with it. Rejects with a message to show. */
    invite(email: string, admin?: boolean): Promise<void>;
    remove(email: string): Promise<void>;
    words(change: { upsert?: { word: string; misheardAs: string[] }[]; remove?: string[] }): Promise<void>;
    /** A member or admin leaves the team; their own plan applies at once. */
    leave(): Promise<void>;
  };
  billing: {
    /** Null when the server can't be reached. */
    get(): Promise<Billing | null>;
    /** Opens the payment page in the browser; rejects with a message to show. */
    /** The currency is the server's choice (where the person is), never the app's. */
    /**
     * Autopay: Team is bought for the owner alone, people added later billed from when they join.
     * `once`: paid in one go with no autopay, for a month or a year (a team for `seats` people).
     */
    checkout(choice: {
      plan: "pro" | "power";
      interval: BillingInterval;
      once?: boolean;
      seats?: number;
    }): Promise<void>;
    /** Opens the payment company's page to change card, see invoices or cancel. */
    portal(): Promise<void>;
    /** A team paid once: what `add` more seats cost, and paying for them (in the browser). */
    seatsQuote(add: number): Promise<SeatsQuote>;
    addSeats(add: number): Promise<void>;
  };
  app: {
    info(): Promise<AppInfo>;
    openRecordingsFolder(): Promise<void>;
    /** The menu bar asking the dashboard to show a page. */
    onNavigate(listener: (to: Navigation) => void): () => void;
    /** Windows: the colour behind the window's own buttons, so the title bar is the app's. */
    chrome(colors: { color: string; symbol: string }): void;
  };
  hotkey: {
    /**
     * Records the dictation hotkey from the keys held (main process, the same poll that watches
     * them). `keys`: recorded and accepted, not yet saved; `refused`: why it cannot be the hotkey;
     * null: cancelled, or this OS records in the page.
     */
    record(): Promise<{ keys: string } | { refused: string } | null>;
    cancelRecord(): void;
    /** The keys held so far, while recording. */
    onHeld(listener: (keys: string) => void): () => void;
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
    /** Quits and reopens the app, so a permission allowed meanwhile takes effect. */
    restartApp(): Promise<void>;
  };
  history: {
    list(): Promise<SessionRecord[]>;
    /** WAV bytes of a recording. */
    audio(id: string): Promise<Uint8Array>;
    remove(id: string): Promise<void>;
    /** Every dictation and its recording, gone from this Mac. */
    clear(): Promise<void>;
    onChanged(listener: () => void): () => void;
  };
  /**
   * Words, speaking time and dictations per day: the account's, every device together, where the
   * server counted them; this Mac's own before that. Kept when history is deleted.
   */
  apps: {
    /** The name people know the app by and its icon (a data: URL, "" when none); `stored` if it is gone. */
    look(appId: string, stored: string): Promise<AppLook>;
  };
  stats: {
    days(): Promise<Record<string, DayTotal>>;
    /** This PC's own counts by day (the Mac's stats:thisMac). */
    thisDevice(): Promise<Record<string, DayTotal>>;
    /** The totals or the allowance changed; read them again (no network: they are kept here). */
    onChanged(listener: () => void): () => void;
  };
  screen: {
    last(): Promise<LastScreen | null>;
    /** The executables picked in a file dialog, [] when cancelled. */
    pickApps(): Promise<string[]>;
  };
  snippets: {
    list(): Promise<SnippetItem[]>;
    /** Refused with a sentence to show: too long, or words another snippet uses. */
    save(item: { id?: string; triggers: string[]; text: string }): Promise<SnippetItem>;
    remove(id: string): Promise<void>;
    onChanged(listener: () => void): () => void;
  };
  dictionary: {
    list(): Promise<DictionaryEntry[]>;
    /** Words were added, edited or deleted on another device. */
    onChanged(listener: () => void): () => void;
    upsert(entry: DictionaryEntry): Promise<void>;
    /** `renamed`: the word got a new name, so the old one is not marked as removed. */
    remove(word: string, renamed?: boolean): Promise<void>;
    /** Fixes seen once and waiting for a second, and the words that are not learned again. */
    learning(): Promise<{ pending: PendingFix[]; removed: string[] }>;
    acceptPending(key: string): Promise<void>;
    dropPending(key: string): Promise<void>;
    allowAgain(word: string): Promise<void>;
  };
  /** The account's dictation settings, on the backend. Null when no backend is configured. */
  voice: {
    settings(): Promise<VoiceSettings | null>;
    update(patch: Partial<VoiceSettings>): Promise<VoiceSettings>;
    /** ISO codes the recogniser can hear and translate between. */
    languages(): Promise<string[]>;
  };
  settings: {
    get(): Promise<AppSettings>;
    set(settings: Partial<AppSettings>): Promise<AppSettings>;
    onChanged(listener: (settings: AppSettings) => void): () => void;
    /** Microphones the user can pick from; read in the renderer, where MediaDevices lives. */
    publishMicrophones(options: MicrophoneOption[]): void;
    microphones(): Promise<MicrophoneOption[]>;
  };
  /** The Mac's own microphones (native capture), for the picker. */
  mic: {
    devices(): Promise<MicDevice[]>;
    /** A live level for the picker; the microphone is on only while this is. */
    meter(on: boolean): void;
    onLevel(listener: (level: number) => void): () => void;
  };
  /** Used only by the recording pill window. The mic commands are for the Web Audio fallback. */
  pill: {
    onState(listener: (state: PillState) => void): () => void;
    /** Loudness 0–1 while listening, for the waveform. */
    onLevel(listener: (level: number) => void): () => void;
    onMicCommand(listener: (command: MicCommand) => void): () => void;
    hover(inside: boolean): void;
    /**
     * Mouse down and up on the pill. The main process tells a click from a drag by where the mouse
     * really went: a click opens the app (or is the pill's Undo or Copy), a drag moves the pill.
     */
    press(): void;
    release(): void;
    /** A right-click: the pill's own menu (paste or copy the last dictation, hide, settings). */
    menu(): void;
    /** The pill's drawn size, so its clicks can be caught exactly there. */
    area(size: { width: number; height: number }): void;
    /** The pill moved out from under the pointer, so it is no longer hovered. */
    onHoverReset(listener: () => void): () => void;
    /** Shows a made-up state on the real pill for a few seconds (Settings' "show on screen"). */
    demo(state: PillState): void;
    /** 16 kHz mono PCM. */
    sendChunk(samples: Int16Array): void;
    /** All audio has been sent after a "stop". */
    micStopped(): void;
    micError(message: string): void;
  };
}
