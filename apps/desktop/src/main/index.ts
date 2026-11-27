import { existsSync, renameSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type DictionaryEntry,
  type HotkeyBinding,
  type PermissionKind,
  Pipeline,
  type SessionRecord,
  SubxError,
} from "@subx/core";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  powerMonitor,
  screen,
  session,
  shell,
  type Tray,
  type WebContents,
} from "electron";
import { dayKey } from "../shared/day-key";
import {
  type AppInfo,
  type AppSettings,
  type DayTotal,
  HISTORY_KEEP_MS,
  IPC,
  type LastScreen,
  type MicrophoneOption,
  type Navigation,
  type PermissionStatus,
  type PillState,
  type VoiceSettings,
} from "../shared/ipc";
import { isPillPlace, pillShownNow } from "../shared/pill-place";
import { markSignedIn, removeUnusedAccounts } from "./account-cleanup";
import { AccountTotals } from "./account-totals";
import { Account } from "./auth";
import { createBackend } from "./backend";
import { appIcon } from "./brand";
import { guardAgainstCrashDialogs } from "./crash-guard";
import { CountedHistoryStore, DailyTotals } from "./daily-totals";
import { DictationController } from "./dictation";
import { hotkeyRefusal } from "./hotkey-choice";
import { EditLearner } from "./learner";
import { nativeMic, PillMic } from "./mic";
import { PillWindow } from "./pill";
import { createPlatform } from "./platform";
import { apiUrl, clientHeaders, createStt, devToken, loadDevEnv } from "./providers";
import { deleteRecording, recordingsDir, saveRecording, setRecordingsDir } from "./recordings";
import { loadPage, PRELOAD_PATH } from "./renderer";
import { SnippetStore } from "./snippets";
import { addStarterWords, fixCapitalNames } from "./starter-words";
import { JsonDictionaryStore, JsonFile, JsonSettingsStore } from "./stores";
import { createTray } from "./tray";
import { checkForUpdate, installUpdate, startUpdater, updateState } from "./updater";
import { VoiceSettingsCopy } from "./voice";
import { allowanceProblem, createWorkflow } from "./workflow";

// First, so nothing that goes wrong from here on can show a stack trace on screen.
guardAgainstCrashDialogs();

const HOTKEY_RETRY_MS = 3000;
/** A renderer killed for memory dies again if reloaded straight away. */
const RENDERER_RELOAD_MS = 500;

/**
 * The installed app holds the microphone and drives the keyboard and screen, so nothing else on
 * the PC may drive it from outside: a remote-debugging port would let any local program run script
 * in its windows (the Mac's shipped build accepted one, 2026-11-19). Development keeps it, to
 * inspect the pill. ELECTRON_RUN_AS_NODE, NODE_OPTIONS and --inspect are refused by Electron's
 * fuses (electron-builder.yml).
 */
if (
  app.isPackaged &&
  (app.commandLine.hasSwitch("remote-debugging-port") || app.commandLine.hasSwitch("remote-debugging-pipe"))
) {
  app.exit(1);
}

/**
 * One instance, always.
 *
 * Without this, opening the app while it is already in the tray starts a whole second copy: two
 * pills on screen, two tray icons, two registrations of the same hotkey — so one press dictates
 * twice and pastes twice — and two processes writing the same history.json. It is easy to reach
 * by accident, because the window closing to the tray looks exactly like the app having exited.
 *
 * Taken before anything else, so a loser never reaches migrateUserData() and races the winner
 * over the data folder.
 */
if (!app.requestSingleInstanceLock()) {
  // Said out loud: in development this is reached by running `pnpm dev:desktop` while the
  // installed app sits in the tray, and a window that opens and vanishes explains nothing.
  console.log("SUBXVoice is already running; raising that window instead.");
  app.exit(0);
}

/** Everything this app writes under userData. Chromium's own files are not ours to move. */
const APP_DATA = [
  "accounts",
  "recordings",
  "settings.json",
  "history.json",
  "dictionary.json",
  "session.bin",
];

/**
 * Carries a 0.1.0 install's data to the renamed userData folder.
 *
 * package.json had no productName until 0.1.1, so userData fell back to the package name
 * (`Application Support/@subx/desktop`). Naming the product moved userData, which would otherwise
 * leave an upgrading install empty and signed out.
 *
 * Electron creates userData before this file runs, so the folder already existing says nothing —
 * each entry is moved only when it is genuinely missing at the new location.
 */
function migrateUserData(): void {
  const previous = join(app.getPath("appData"), "@subx", "desktop");
  if (!existsSync(previous)) return;
  const current = app.getPath("userData");
  for (const name of APP_DATA) {
    const from = join(previous, name);
    const to = join(current, name);
    if (!existsSync(from) || existsSync(to)) continue;
    try {
      renameSync(from, to);
    } catch (error) {
      // Not fatal: the app still opens, just without that piece. Refusing to start would be
      // worse, and nothing has been deleted — the old folder is still there to recover from.
      console.error(`Could not move ${name} from the old data folder:`, error);
    }
  }
}
migrateUserData();

loadDevEnv();
const platform = createPlatform();

/**
 * Our own pages: the bundled renderer files in a build, the Vite server in development. Only they
 * may load in our windows or call the main process; anything else that ever got into a window (a
 * dropped file, a stray link) would otherwise reach the preload bridge: history, recordings, account
 * deletion. Compared by path, not origin: every file:// URL has the same origin, "null".
 */
const RENDERER_FILES = `${pathToFileURL(join(__dirname, "../renderer")).href}/`;
function ownPage(url: string): boolean {
  if (url.startsWith(RENDERER_FILES)) return true;
  const dev = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
  return !!dev && url.startsWith(`${dev}/`);
}
const fromOwnPage = (event: IpcMainEvent | IpcMainInvokeEvent): boolean =>
  ownPage(event.senderFrame?.url ?? "");

/** ipcMain.handle, for our own pages only. */
// biome-ignore lint/suspicious/noExplicitAny: mirrors the argument type of Electron's own listeners.
function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromOwnPage(event)) throw new Error("Refused: only SUBXVoice's own windows may ask for this.");
    return listener(event, ...args);
  });
}
let pillHideTimer: NodeJS.Timeout | undefined;
/** Applies the pill's visibility, and brings it back on its own when a hide runs out. */
function showPillAsSet(
  pill: { setIdleVisible(on: boolean): void },
  s: { pillWhenIdle: boolean; pillHiddenUntil: number },
): void {
  pill.setIdleVisible(pillShownNow(s));
  clearTimeout(pillHideTimer);
  const left = s.pillHiddenUntil - Date.now();
  if (left > 0)
    pillHideTimer = setTimeout(() => pill.setIdleVisible(s.pillWhenIdle), Math.min(left, 2 ** 31 - 1));
}

/** Icons by exe path, read once each: the pill shows one at the start of every dictation. */
const appIcons = new Map<string, string>();

/**
 * The icon of the app in front, as a data: URL, for the pill while listening (the Mac app shows the
 * app the words go into). Windows only: its context gives the exe; our own windows get none.
 */
async function frontAppIcon(): Promise<string> {
  if (platform.os === "mac") return "";
  return iconOfExe((await platform.context?.current().catch(() => null))?.appId ?? "");
}

async function iconOfExe(exe: string): Promise<string> {
  if (!exe) return "";
  if (!/\.exe$/i.test(exe) || /(SUBXVoice|electron)\.exe$/i.test(exe)) return "";
  const known = appIcons.get(exe);
  if (known !== undefined) return known;
  const icon = await app
    .getFileIcon(exe, { size: "normal" })
    .then((image) => (image.isEmpty() ? "" : image.toDataURL()))
    .catch(() => "");
  appIcons.set(exe, icon);
  return icon;
}

const looks = new Map<string, Promise<{ name: string; icon: string }>>();

/**
 * An app as History and Insights show where words went: the name Windows gives it and its icon
 * (the Mac's AppLook). Read once per app; what was stored with the dictation is the fallback.
 */
function lookOf(appId: string, stored: string): Promise<{ name: string; icon: string }> {
  if (!appId) return Promise.resolve({ name: stored, icon: "" });
  let look = looks.get(appId);
  if (!look) {
    look = Promise.all([
      platform.context.displayName?.(appId).catch(() => null) ?? Promise.resolve(null),
      iconOfExe(appId),
    ]).then(([name, icon]) => ({ name: name ?? "", icon }));
    looks.set(appId, look);
  }
  return look.then((found) => ({ name: found.name || stored, icon: found.icon }));
}

/** Windows' caption buttons' height; the page's drag strip is the same (platform/win/Chrome.tsx). */
const TITLE_BAR_HEIGHT = 36;

const isChrome = (value: unknown): value is { color: string; symbol: string } =>
  typeof value === "object" &&
  value !== null &&
  /^#[0-9a-f]{6}$/i.test(String((value as { color?: unknown }).color)) &&
  /^#[0-9a-f]{6}$/i.test(String((value as { symbol?: unknown }).symbol));

/** ipcMain.on, for our own pages only; anything else is dropped. */
// biome-ignore lint/suspicious/noExplicitAny: mirrors the argument type of Electron's own listeners.
function listen(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): void {
  ipcMain.on(channel, (event, ...args) => {
    if (fromOwnPage(event)) listener(event, ...args);
  });
}
/** The main window is destroyed on close and made again; this tells its renderer it is the same run. */
const STARTED_AT = Date.now();
// Built in start(), because the account they depend on needs the app to be ready first.
let account: Account;
/** Reported by the renderer, which is the only side with MediaDevices. */
let microphones: MicrophoneOption[] = [];
let mainWindow: BrowserWindow | null = null;
/** Hotkey registrations refused in a row (Input Monitoring); a successful one resets it. */
let hotkeyRefusals = 0;
/** Set once the account's numbers exist: the window coming to the front may refresh them. */
let onMainWindowFocus: () => void = () => {};
/** Held at module scope so opening the app can revive it; built in start(). */
let pillWindow: PillWindow | null = null;
let tray: Tray | null = null; // kept in a variable so it isn't garbage-collected

/** True when macOS launched us at login (see the login item's args). */
const startedHidden = () => process.argv.includes("--hidden") || app.getLoginItemSettings().wasOpenedAtLogin;

/**
 * Where the dashboard should go once it is up, for a menu bar item such as "Change Languages…".
 * Sent after the page has loaded when the window is new, because a message to a page still loading
 * is lost.
 */
/**
 * Shows a window where the user is looking. A window lives on one desktop (Space), so with a
 * full-screen app in front, opening SUBXVoice from the menu bar switched to another desktop instead
 * of appearing (2026-11-20). Joining every desktop for the moment it is shown brings it to this one,
 * over a full-screen app too; leaving them again right after keeps it a normal window.
 */
function showOnThisSpace(window: BrowserWindow): void {
  if (process.platform === "darwin") {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  window.show();
  window.focus();
  if (process.platform === "darwin") {
    setTimeout(() => {
      if (!window.isDestroyed()) window.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: true });
    }, 200);
  }
}

function openingSize(): { width: number; height: number } {
  const { width, height } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workAreaSize;
  return { width: Math.min(1200, width - 40), height: Math.min(780, height - 40) };
}

function openMainWindow(to?: Navigation): void {
  const go = () => {
    if (to) mainWindow?.webContents.send(IPC.navigate, to);
  };
  // Opening the app is what someone does when the pill has vanished, so it is the natural place
  // to put it back — it used to touch only the main window, which is why force-quitting was the
  // only thing that worked.
  pillWindow?.revive();
  app.focus({ steal: true });
  if (mainWindow) {
    // A dead renderer leaves the window as a blank white rectangle, and showing it again shows
    // the same blank rectangle. Reload first, so opening the app is a real recovery.
    if (mainWindow.webContents.isCrashed()) mainWindow.webContents.reload();
    showOnThisSpace(mainWindow);
    go();
    return;
  }
  mainWindow = new BrowserWindow({
    // Wide enough for Home's four setup boxes side by side (at 1000 px they were squeezed), and
    // never larger than the screen it opens on.
    ...openingSize(),
    minWidth: 760,
    minHeight: 520,
    show: false,
    // Windows: its own minimise / maximise / close, drawn over the app on the colour behind them
    // (the page reports it, IPC.windowChrome), so the title bar is part of the app, not a white or
    // black band from Windows' theme (user, 2026-11-25). The page leaves the strip free and drags by it.
    ...(platform.os === "mac"
      ? { titleBarStyle: "hiddenInset" as const }
      : {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: { color: "#0f0e0d", symbolColor: "#f2e8c8", height: TITLE_BAR_HEIGHT },
        }),
    webPreferences: { preload: PRELOAD_PATH, sandbox: true, contextIsolation: true },
  });
  // Windows draws Electron's File / Edit / View menu under the title; this app has none.
  if (platform.os !== "mac") mainWindow.removeMenu();
  mainWindow.on("ready-to-show", () => {
    if (mainWindow) showOnThisSpace(mainWindow);
  });
  // Another device may have dictated or changed words: one request at most every 30 s.
  mainWindow.on("focus", () => onMainWindowFocus());
  // Same failure the pill has: the window survives its renderer and draws nothing. Here it is a
  // blank white page rather than an invisible one, which looks broken rather than absent.
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("main window renderer gone:", details.reason, "— reloading");
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
    }, RENDERER_RELOAD_MS);
  });
  // Destroyed on close (not hidden) so the app stays light while it runs in the background.
  // The pill and the tray icon keep the app running; quit from the tray menu.
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.once("did-finish-load", go);
  loadPage(mainWindow, "index.html");
}

function notifyHistoryChanged(): void {
  mainWindow?.webContents.send(IPC.historyChanged);
}

function notifySnippetsChanged(): void {
  mainWindow?.webContents.send(IPC.snippetsChanged);
}

/** What the last dictation read from the screen, kept until the app quits and nowhere else. */
let lastScreen: LastScreen | null = null;

/** How long the pill's offer of a snippet stands (the Mac's 15 s). */
const SNIPPET_OFFER_MS = 15_000;
/** The snippet offered on the pill now, if any. */
let snippetOffer: {
  snippetId: string;
  trigger: string;
  replaced: string;
  recordId: string;
  at: number;
  stop: () => void;
} | null = null;

/** A snippet from the renderer, checked before it is stored. */
function assertSnippet(value: unknown): { id?: string; triggers: string[]; text: string } {
  const item = value as { id?: unknown; triggers?: unknown; text?: unknown };
  if (!item || typeof item !== "object" || typeof item.text !== "string" || !Array.isArray(item.triggers))
    throw new Error("That snippet could not be read.");
  const triggers = item.triggers.filter((said): said is string => typeof said === "string").slice(0, 20);
  return { ...(typeof item.id === "string" ? { id: item.id } : {}), triggers, text: item.text };
}

/** Credentials arrive from the renderer, so they are checked before they reach the network. */
function asText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 320) {
    throw new Error(`Enter a valid ${field}.`);
  }
  return value.trim();
}

/** A seat count from the renderer: a whole number the server would accept (it checks again). */
function seatCount(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > 500) throw new Error("Enter between 1 and 500 seats.");
  return n;
}

function assertPermissionKind(kind: unknown): PermissionKind {
  if (!platform.permissions.required().includes(kind as PermissionKind)) {
    throw new Error(`Unknown permission: ${String(kind)}`);
  }
  return kind as PermissionKind;
}

function assertString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error(`Invalid ${name}`);
  return value.trim();
}

function assertDictionaryEntry(value: unknown): DictionaryEntry {
  const entry = value as Partial<DictionaryEntry> | null;
  const strings = (list: unknown) =>
    Array.isArray(list)
      ? list.filter((item): item is string => typeof item === "string" && !!item.trim())
      : [];
  const writtenAs = strings(entry?.writtenAs);
  return {
    word: assertString(entry?.word, "word"),
    misheardAs: strings(entry?.misheardAs),
    ...(entry?.source === "learned" || entry?.source === "you" ? { source: entry.source } : {}),
    ...(typeof entry?.addedAt === "number" ? { addedAt: entry.addedAt } : {}),
    ...(writtenAs.length > 0 ? { writtenAs } : {}),
    ...(typeof entry?.learnedIn === "string" ? { learnedIn: entry.learnedIn.slice(0, 100) } : {}),
  };
}

/** Settings arrive from the renderer, so every field is checked before it is stored. */
function assertSettings(value: unknown, accepts: (keys: string) => boolean): Partial<AppSettings> {
  const input = (value ?? {}) as Partial<AppSettings>;
  const patch: Partial<AppSettings> = {};
  if (typeof input.hotkey === "string") {
    if (!accepts(input.hotkey)) throw new Error(`Unsupported hotkey: ${input.hotkey}`);
    patch.hotkey = input.hotkey;
  }
  if (typeof input.launchAtLogin === "boolean") patch.launchAtLogin = input.launchAtLogin;
  if (typeof input.sounds === "boolean") patch.sounds = input.sounds;
  if (typeof input.muteAudio === "boolean") patch.muteAudio = input.muteAudio;
  if (typeof input.voiceCleanup === "boolean") patch.voiceCleanup = input.voiceCleanup;
  if (typeof input.pillWhenIdle === "boolean") patch.pillWhenIdle = input.pillWhenIdle;
  if (
    typeof input.pillHiddenUntil === "number" &&
    Number.isFinite(input.pillHiddenUntil) &&
    input.pillHiddenUntil >= 0
  )
    patch.pillHiddenUntil = input.pillHiddenUntil;
  if (typeof input.learnWords === "boolean") patch.learnWords = input.learnWords;
  if (typeof input.screenContext === "boolean") patch.screenContext = input.screenContext;
  if (Array.isArray(input.screenContextOff))
    patch.screenContextOff = input.screenContextOff
      .filter((item): item is string => typeof item === "string" && item.length < 1024)
      .slice(0, 100);
  if (input.pillStyle === "classic" || input.pillStyle === "line")
    patch.pillStyle = input.pillStyle as AppSettings["pillStyle"];
  if (
    input.keepHistory === "forever" ||
    (typeof input.keepHistory === "string" && Object.hasOwn(HISTORY_KEEP_MS, input.keepHistory))
  )
    patch.keepHistory = input.keepHistory;
  if (isPillPlace(input.pillPosition)) patch.pillPosition = input.pillPosition;
  if (typeof input.microphoneId === "string" && input.microphoneId.length <= 200) {
    patch.microphoneId = input.microphoneId;
  }
  return patch;
}

async function start(): Promise<void> {
  // The packaged app's Dock icon comes from its bundle; this makes the development build (which
  // runs inside Electron.app) show the SUBXVoice mark in the Dock and ⌘-Tab too.
  app.dock?.setIcon(appIcon());
  const dataDir = app.getPath("userData");
  await mkdir(dataDir, { recursive: true });

  account = new Account(apiUrl(), devToken());
  // Signing in once should last; a session that no longer refreshes just asks again.
  await account.restore();
  // Bound once the account's folder is known (below); until then a dictation sends no settings and
  // the server reads its own copy.
  let voiceForDictation: () => Promise<Record<string, unknown> | null> = async () => null;
  // Bound below too, once the account's totals exist: what each dictation sends back after its text.
  let totalsFromDictation: (totals: unknown) => void = () => {};
  const stt = createStt(
    () => account.token(),
    () => voiceForDictation(),
    (totals) => totalsFromDictation(totals),
  );
  // Transcripts, dictionary and audio belong to the person signed in, not to the machine. They
  // live in a folder named after the account so the next person to sign in starts empty.
  let accountDir = join(dataDir, "accounts", "signed-out");
  // The daily totals read the history once, to build themselves; after that the history tells them.
  const totals: DailyTotals = new DailyTotals(
    () => join(accountDir, "daily-totals.json"),
    (): Promise<SessionRecord[]> => history.recent(Number.MAX_SAFE_INTEGER),
  );
  const history: CountedHistoryStore = new CountedHistoryStore(
    () => join(accountDir, "history.json"),
    totals,
  );
  const dictionary = new JsonDictionaryStore(() => join(accountDir, "dictionary.json"));
  const snippets = new SnippetStore(() => join(accountDir, "snippets.json"));

  const switchAccountData = async (userId: string | null) => {
    // The account being left was signed in here until now: its 30 days start today. (Not the
    // signed-out folder: it is no account, and marking it would make one at every start.)
    if (basename(accountDir) !== "signed-out") await markSignedIn(accountDir).catch(() => {});
    accountDir = join(dataDir, "accounts", userId ?? "signed-out");
    await mkdir(accountDir, { recursive: true });
    accountTotals.forget();
    mainWindow?.webContents.send(IPC.statsChanged);
    void cleanUpAccounts();
    setRecordingsDir(join(accountDir, "recordings"));
    history.forget();
    dictionary.forget();
    snippets.forget();
    snippetOffer = null;
    voice.forget();
    learner.forget();
    // Built now, in the background, so the first dictation does not wait for it.
    void totals.load().catch(() => {});
    // A different person's settings: theirs from the server (another device may have changed them).
    void voice.sync();
  };

  const backend = createBackend(
    apiUrl(),
    () => account.token(),
    `win/${app.getVersion()}`,
    clientHeaders()["x-subx-device"],
  );
  const voice = new VoiceSettingsCopy(
    () => join(accountDir, "voice-settings.json"),
    backend,
    dictionary,
    // Words arrived from another device: the dictionary page (if open) reads its list again.
    () => mainWindow?.webContents.send(IPC.dictionaryChanged),
  );
  voiceForDictation = () => voice.forDictation();
  // The account's numbers, every device together (account-totals.ts): kept live from each
  // dictation's own answer and asked for only when the window opens, at most every 30 s.
  const accountTotals = new AccountTotals({
    backend,
    local: () => totals.days(),
    path: () => join(accountDir, "account-totals.json"),
    onChange: () => mainWindow?.webContents.send(IPC.statsChanged),
    onSettingsVersion: (version) => void voice.versionSeen(version),
  });
  totalsFromDictation = (totals) => void accountTotals.live(totals);
  onMainWindowFocus = () => void accountTotals.refresh();
  const learner = new EditLearner({
    field: platform.field,
    dictionary,
    memoryPath: () => join(accountDir, "learned.json"),
    enabled: async () => (await settings.all()).learnWords,
    onLearned: (words) => {
      void voice.pushDictionary();
      dictation.notice({ kind: "learned", words });
    },
    log: (line) => console.log(line),
  });

  // Point at the restored account's folder before anything reads from it.
  // The product's name and the person's own name in the dictionary, once per account
  // (starter-words.ts). Once: a word they delete later stays deleted.
  const starterWords = new JsonFile<{ added: boolean }>(() => join(accountDir, "starter-words.json"), {
    added: false,
  });
  let givingStarterWords: Promise<void> = Promise.resolve();
  const giveStarterWords = (state: { signedIn: boolean; onboarded: boolean; name: string }) => {
    if (!state.signedIn || !state.onboarded) return;
    givingStarterWords = givingStarterWords
      .then(async () => {
        if ((await starterWords.read()).added) {
          if ((await fixCapitalNames(dictionary, state.name)) > 0) void voice.pushDictionary();
          return;
        }
        if ((await addStarterWords(dictionary, state.name)) > 0) void voice.pushDictionary();
        await starterWords.write({ added: true });
      })
      .catch((error: unknown) =>
        console.warn("starter words:", error instanceof Error ? error.message : error),
      );
  };

  /**
   * Notes that the signed-in account is still in use here, then deletes the folders of accounts not
   * signed in on this Mac for 30 days (account-cleanup.ts). Run at start, on every switch and hourly.
   */
  const cleanUpAccounts = async () => {
    try {
      await markSignedIn(accountDir);
      const removed = await removeUnusedAccounts({
        accountsDir: join(dataDir, "accounts"),
        current: () => accountDir,
      });
      if (removed.length > 0) console.log(`accounts: removed ${removed.length} not used here for 30 days`);
    } catch (error) {
      console.warn("accounts: cleanup skipped:", error instanceof Error ? error.message : error);
    }
  };
  setInterval(() => void cleanUpAccounts(), 60 * 60 * 1000);

  // Signed out at start because the sign-in ran out: that account was in use here until now, so
  // its 30 days start today and signing in again finds its history.
  const lost = account.signedOutAtStart();
  if (lost) await markSignedIn(join(dataDir, "accounts", lost)).catch(() => {});

  await switchAccountData((await account.state()).id);
  giveStarterWords(await account.state());

  // Settings stay with the machine: the hotkey, microphone and startup choice describe this
  // computer, not the person.
  const settings = new JsonSettingsStore<AppSettings>(() => join(dataDir, "settings.json"), {
    hotkey: platform.hotkey.defaultBindings()[0]?.keys ?? "",
    microphoneId: "",
    // On unless the user turns it off: raw input wrote down whoever else was talking in the room.
    voiceCleanup: true,
    launchAtLogin: false,
    sounds: true,
    muteAudio: false,
    pillWhenIdle: true,
    pillHiddenUntil: 0,
    learnWords: true,
    screenContext: true,
    screenContextOff: [],
    pillPosition: "bottom",
    keepHistory: "forever",
    pillStyle: "classic",
  });

  /**
   * Mirrored to the OS rather than stored only by us: the user can also turn it off in System
   * Settings → Login Items, and whatever they did there last is the truth.
   */
  const applyLaunchAtLogin = (openAtLogin: boolean) => {
    if (!app.isPackaged) return; // a dev run is not the app that would start at login
    app.setLoginItemSettings({
      openAtLogin,
      // Started this way the app belongs in the tray, not in front of whatever the user opened.
      args: ["--hidden"],
    });
  };
  applyLaunchAtLogin((await settings.all()).launchAtLogin);

  const bindings = async (): Promise<HotkeyBinding[]> => {
    const { hotkey } = await settings.all();
    // settings.json is a file the user can edit, so a stored hotkey is re-checked every time.
    return !hotkey || !platform.hotkey.accepts(hotkey)
      ? platform.hotkey.defaultBindings()
      : [{ keys: hotkey, mode: "exact" }];
  };

  handle(IPC.authState, () => account.state());
  handle(IPC.authGoogle, async (_event, options: unknown) => {
    const chooseAccount = typeof options === "object" && options !== null && "chooseAccount" in options;
    await account.signInWithGoogle({ chooseAccount: chooseAccount && options.chooseAccount === true });
    // The browser has the focus now; the app was what the user was signing in to.
    openMainWindow();
  });
  handle(IPC.authStartEmail, (_event, email: unknown) => account.startEmail(asText(email, "email")));
  handle(IPC.authVerifyCode, (_event, code: unknown) => account.verifyEmailCode(asText(code, "code")));
  handle(IPC.authResendEmailCode, () => account.resendEmailCode());
  handle(IPC.authDeleteAccount, async () => {
    const { id } = await account.state();
    // The server first: it deletes the sign-in account and its own copy (it needs the session to
    // know whose); then this PC's sign-in and copy. A failure part way leaves nothing behind that
    // the next try can't finish.
    await backend.deleteAccount();
    await account.deleteAccount();
    if (id) await rm(join(dataDir, "accounts", id), { recursive: true, force: true });
  });
  handle(IPC.authSignOut, () => account.signOut());
  handle(IPC.authUsage, () => accountTotals.usage());
  handle(IPC.accountDevices, () => backend.devices());
  handle(IPC.billingGet, () => backend.billing().catch(() => null));
  // The payment pages open in the browser: payment details never pass through this app.
  const openPaymentPage = async (url: string) => {
    if (!/^https:\/\//.test(url)) throw new Error("The payment page didn't open. Try again in a moment.");
    await shell.openExternal(url);
  };
  handle(IPC.billingCheckout, async (_event, choice: unknown) => {
    const c = (choice ?? {}) as Record<string, unknown>;
    const { url } = await backend.checkout({
      plan: c.plan === "power" ? "power" : "pro",
      interval: c.interval === "year" ? "year" : "month",
      ...(c.once === true ? { once: true } : {}),
      ...(typeof c.seats === "number" ? { seats: seatCount(c.seats) } : {}),
    });
    await openPaymentPage(url);
  });
  handle(IPC.billingSeatsQuote, (_event, add: unknown) => backend.seatsQuote(seatCount(add)));
  handle(IPC.billingSeatsBuy, async (_event, add: unknown) =>
    openPaymentPage((await backend.addSeats(seatCount(add))).url),
  );
  handle(IPC.teamGet, () => backend.team().catch(() => null));
  handle(IPC.teamSave, (_event, name: unknown) => backend.saveTeam(asText(name, "team name")));
  handle(IPC.teamInvite, (_event, email: unknown, admin: unknown) =>
    backend.invite(asText(email, "email"), admin === true),
  );
  handle(IPC.teamRemove, (_event, email: unknown) => backend.removeMember(asText(email, "email")));
  handle(IPC.teamWords, (_event, change: unknown) => {
    const c = (change ?? {}) as { upsert?: unknown; remove?: unknown };
    const upsert = Array.isArray(c.upsert)
      ? c.upsert
          .filter(
            (w): w is { word: string; misheardAs?: unknown } =>
              typeof (w as { word?: unknown })?.word === "string",
          )
          .map((w) => ({
            word: w.word,
            misheardAs: Array.isArray(w.misheardAs)
              ? w.misheardAs.filter((m): m is string => typeof m === "string")
              : [],
          }))
      : [];
    const remove = Array.isArray(c.remove) ? c.remove.filter((w): w is string => typeof w === "string") : [];
    return backend.changeTeamWords({ upsert, remove });
  });
  handle(IPC.teamLeave, () => backend.leaveTeam());
  handle(IPC.billingPortal, async () => openPaymentPage((await backend.portal()).url));
  handle(IPC.authSetProfile, (_event, name: unknown) => account.setProfile(asText(name, "name")));
  account.onChanged((state) => {
    // Switching accounts switches the data with it, and signing out puts it out of reach.
    void switchAccountData(state.id).then(() => {
      notifyHistoryChanged();
      // Setup just finished (the first name was saved), or someone else signed in.
      giveStarterWords(state);
    });
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.authChanged, state);
    }
  });

  handle(
    IPC.appInfo,
    async (): Promise<AppInfo> => ({
      version: app.getVersion(),
      hotkeys: await bindings(),
      supportedKeys: platform.hotkey.supportedKeys(),
      // macOS watches only the fixed set the Swift helper knows, so Settings offers a list.
      customHotkeys: platform.hotkey.accepts("ctrl+shift+f9"),
      nativeMicrophone: !!platform.microphone,
      // Without a native microphone the pill records, and its `micConstraints` honour the setting.
      voiceCleanup: platform.microphone ? !!platform.microphone.cleanup : true,
      startedAt: STARTED_AT,
    }),
  );
  handle(IPC.openRecordingsFolder, async () => {
    await mkdir(recordingsDir(), { recursive: true });
    await shell.openPath(recordingsDir());
  });

  handle(IPC.permissionList, async (): Promise<PermissionStatus[]> => {
    const kinds = platform.permissions.required();
    return Promise.all(
      kinds.map(async (kind) => {
        const state = await platform.permissions.status(kind);
        // Allowed in System Settings, yet the hotkey is still refused (twice, even from a fresh
        // helper): this run needs a restart before macOS lets it listen.
        const stuck = kind === "input_monitoring" && state === "granted" && hotkeyRefusals >= 2;
        return stuck ? { kind, state, restartNeeded: true as const } : { kind, state };
      }),
    );
  });
  handle(IPC.appRestart, () => {
    app.relaunch();
    app.exit(0);
  });
  handle(IPC.permissionRequest, (_event, kind: unknown) =>
    platform.permissions.request(assertPermissionKind(kind)),
  );
  handle(IPC.permissionOpenSettings, (_event, kind: unknown) =>
    platform.permissions.openSettings(assertPermissionKind(kind)),
  );

  handle(IPC.historyList, () => history.recent(Number.MAX_SAFE_INTEGER));
  handle(IPC.statsDays, () => accountTotals.days());
  handle(IPC.appLook, (_event, appId: unknown, stored: unknown) =>
    lookOf(typeof appId === "string" ? appId : "", typeof stored === "string" ? stored : ""),
  );
  handle(IPC.statsThisDevice, () => totals.days());
  handle(IPC.historyAudio, async (_event, id: unknown) => {
    const record = await history.find(assertString(id, "id"));
    if (!record?.audioPath) throw new Error("This recording has no audio");
    return readFile(record.audioPath);
  });
  handle(IPC.historyRemove, async (_event, id: unknown) => {
    const record = await history.find(assertString(id, "id"));
    if (!record) return;
    if (record.audioPath) await deleteRecording(record.audioPath);
    await history.remove(record.id);
    notifyHistoryChanged();
  });
  handle(IPC.historyClear, async () => {
    await dropRecords(await history.removeWhere(() => true));
  });

  /** Deletes the recordings of records already taken out of history. */
  async function dropRecords(records: SessionRecord[]): Promise<void> {
    for (const record of records)
      if (record.audioPath) await deleteRecording(record.audioPath).catch(() => {});
    if (records.length > 0) notifyHistoryChanged();
  }

  /**
   * Deletes what is older than the user keeps (Settings → Privacy and data). Run at start, when the
   * setting changes and every hour, so "24 hours" means about that rather than "until next launch".
   */
  const pruneHistory = async () => {
    const keep = (await settings.all()).keepHistory;
    if (keep === "forever") return;
    const cutoff = Date.now() - HISTORY_KEEP_MS[keep];
    await dropRecords(await history.removeWhere((record) => record.createdAt < cutoff));
  };
  void pruneHistory();
  setInterval(() => void pruneHistory(), 60 * 60 * 1000);

  handle(IPC.screenLast, () => lastScreen);
  handle(IPC.screenPickApp, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Never read the screen in",
      defaultPath: process.env.ProgramFiles ?? "C:\\Program Files",
      filters: [{ name: "Apps", extensions: ["exe"] }],
      properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[],
    };
    const picked = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    return picked.canceled ? [] : picked.filePaths;
  });
  handle(IPC.snippetsList, () => snippets.list());
  handle(IPC.snippetsSave, async (_event, item: unknown) => {
    const saved = await snippets.save(assertSnippet(item));
    notifySnippetsChanged();
    return saved;
  });
  handle(IPC.snippetsRemove, async (_event, id: unknown) => {
    if (typeof id === "string") await snippets.remove(id);
    notifySnippetsChanged();
  });
  handle(IPC.dictionaryList, () => dictionary.all());
  handle(IPC.dictionaryUpsert, async (_event, entry: unknown) => {
    await dictionary.upsert(assertDictionaryEntry(entry));
    void voice.pushDictionary();
  });
  handle(IPC.dictionaryLearning, async () => ({
    pending: await learner.pending(),
    removed: await learner.removedWords(),
  }));
  handle(IPC.dictionaryAcceptPending, async (_event, key: unknown) => {
    await learner.acceptPending(assertString(key, "key"));
    void voice.pushDictionary();
  });
  handle(IPC.dictionaryDropPending, (_event, key: unknown) => learner.dropPending(assertString(key, "key")));
  handle(IPC.dictionaryAllowAgain, (_event, word: unknown) => learner.allowAgain(assertString(word, "word")));
  handle(IPC.dictionaryRemove, async (_event, word: unknown, renamed: unknown) => {
    await dictionary.remove(assertString(word, "word"));
    // A rename is not the user taking the word out: the old name may still be learned (Mac 7210c8c).
    if (renamed !== true) await learner.removed(assertString(word, "word"));
    void voice.pushDictionary();
  });

  const pill = new PillWindow();
  // Browser permissions: copying to the clipboard for our own pages, and the microphone only for
  // the pill, only where there is no native microphone (on Windows there is none). Nothing else.
  const mayUseMedia = (contents: WebContents | null) =>
    !platform.microphone && !!contents && pill.owns(contents);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    if (permission === "media") return callback(mayUseMedia(contents));
    callback(permission === "clipboard-sanitized-write" && ownPage(contents.getURL()));
  });
  // A check is not an opening: on Windows the main window lists the microphones (useMicrophones),
  // and Chromium names them only for a page whose media check passes — refused, the picker said
  // "Microphone 1, 2…". The pill alone may still open one (the request handler above).
  session.defaultSession.setPermissionCheckHandler((contents, permission) => {
    if (permission === "media") return !platform.microphone && !!contents && ownPage(contents.getURL());
    return !!contents && ownPage(contents.getURL());
  });
  showPillAsSet(pill, await settings.all());
  pill.setPosition((await settings.all()).pillPosition);
  pillWindow = pill;
  // Native mic when the OS plug has one (Mac: Swift helper); otherwise Web Audio in the pill.
  const pillMic = new PillMic(pill);
  const mic = platform.microphone ? nativeMic(platform.microphone) : pillMic;
  const pipeline = new Pipeline({ stt, inserter: platform.inserter, history, dictionary });

  let muteTimer: NodeJS.Timeout | undefined;
  let live = false;
  const dictation = new DictationController(
    pill,
    mic,
    createWorkflow({
      pipeline,
      context: platform.context,
      history,
      saveRecording,
      onHeard: (text) => pill.setState({ kind: "processing", message: text }),
      signedIn: async () => (await account.state()).signedIn,
      account: () => accountDir,
      // Only when a dictation could not start: asked fresh, since it decides what the pill says.
      allowanceProblem: async () => {
        await accountTotals.refresh(true);
        return allowanceProblem(await accountTotals.usage());
      },
      onHistoryChanged: notifyHistoryChanged,
      onPasted: (text, app) => void learner.pasted(text, app),
      snippets: () => snippets.usable(),
      screen: async (context) => {
        const { screenContext, screenContextOff } = await settings.all();
        const app = context.appId ?? "";
        const off = (screenContextOff ?? []).some((item) => item.toLowerCase() === app.toLowerCase());
        // Unless turned off, or off for this app; never SUBXVoice's own windows.
        const ours = app.toLowerCase() === process.execPath.toLowerCase();
        const text =
          screenContext !== false && !off && !ours && platform.screen
            ? await platform.screen.read(context).catch(() => null)
            : null;
        lastScreen = { app: context.appName ?? "", text, at: Date.now() };
        return text;
      },
      onSnippetUsed: (id) => void snippets.used(id).then(notifySnippetsChanged),
      onSnippetOffer: (offer) => offerSnippet(offer),
      log: (line) => console.log(line),
    }),
    {
      // Read per dictation, so a change in Settings applies to the next one. The muting waits for
      // the start sound, which would otherwise be muted with everything else.
      alert: () => {
        void settings.all().then(({ sounds }) => {
          if (sounds) platform.feedback?.cue("notice");
        });
      },
      listening: (on) => {
        live = on;
        // A new dictation is the user moving on: what they fixed in the last paste is final.
        if (on) {
          void learner.settle();
          platform.inserter.prepare?.();
          void frontAppIcon().then((icon) => {
            if (icon && live) dictation.appIcon(icon);
          });
        }
        platform.hotkey.watchEscape?.(on);
        clearTimeout(muteTimer);
        void settings.all().then(({ sounds, muteAudio }) => {
          const feedback = platform.feedback;
          // A quick tap can end before its settings arrive; then this one is stale.
          if (!feedback || on !== live) return;
          if (on) {
            if (sounds) feedback.cue("start");
            if (muteAudio)
              muteTimer = setTimeout(
                () => {
                  if (live) feedback.muteOutput(true);
                },
                sounds ? 180 : 0,
              );
          } else {
            feedback.muteOutput(false);
            if (sounds) feedback.cue("stop");
          }
        });
      },
    },
  );

  // Locked: no dictation and no pill until the user is back (see DictationController.setLocked).
  const setLocked = (locked: boolean) => {
    dictation.setLocked(locked);
    pill.setScreenLocked(locked);
  };
  powerMonitor.on("lock-screen", () => setLocked(true));
  powerMonitor.on("unlock-screen", () => setLocked(false));

  handle(IPC.voiceSettingsGet, () => voice.current());
  handle(IPC.voiceSettingsSet, (_event, patch: unknown) => {
    // Shape-checked by the server, which owns the rules; only an object is let through here.
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) throw new Error("Bad settings.");
    return voice.update(patch as Partial<VoiceSettings>);
  });
  handle(IPC.voiceLanguages, () => backend.languages().catch(() => []));
  handle(IPC.settingsGet, () => settings.all());
  handle(IPC.settingsSet, (_event, patch: unknown) =>
    changeSettings(assertSettings(patch, (keys) => platform.hotkey.accepts(keys))),
  );
  /** A change from Settings or from the menu bar: stored, applied, and told to every window. */
  const changeSettings = async (patch: Partial<AppSettings>): Promise<AppSettings> => {
    const next = await settings.update(patch);
    applyLaunchAtLogin(next.launchAtLogin);
    platform.microphone?.use?.(next.microphoneId);
    platform.microphone?.cleanup?.(next.voiceCleanup);
    showPillAsSet(pill, next);
    pill.setPosition(next.pillPosition);
    void pruneHistory();
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.settingsChanged, next);
    }
    await registerHotkey();
    return next;
  };
  handle(IPC.updateState, () => updateState());
  handle(IPC.updateCheck, () => checkForUpdate());
  listen(IPC.updateInstall, () => installUpdate());
  startUpdater((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.updateChanged, state);
    }
  }, app.isPackaged);

  // The native microphone records from the device the user picked ("" follows the system default).
  const { microphoneId, voiceCleanup } = await settings.all();
  platform.microphone?.use?.(microphoneId);
  platform.microphone?.cleanup?.(voiceCleanup);
  handle(IPC.micDevices, () => platform.microphone?.devices?.() ?? []);
  listen(IPC.windowChrome, (event, colors: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed() || platform.os === "mac" || !isChrome(colors)) return;
    window.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbol, height: TITLE_BAR_HEIGHT });
  });
  listen(IPC.micMeter, (event, on: unknown) => {
    const sender = event.sender;
    const meter = platform.microphone?.meter;
    if (!meter) return;
    meter.call(platform.microphone, on === true, (level) => {
      if (!sender.isDestroyed()) sender.send(IPC.micMeterLevel, level);
    });
    // A window closed with the picker open must not leave the microphone on.
    if (on === true) sender.once("destroyed", () => meter.call(platform.microphone, false, () => {}));
  });
  handle(IPC.microphoneList, () => microphones);
  listen(IPC.microphonePublish, (_event, options: unknown) => {
    microphones = Array.isArray(options)
      ? options
          .filter((item): item is MicrophoneOption => !!item && typeof item.id === "string")
          .map((item) => ({ id: String(item.id), label: String(item.label ?? "Microphone") }))
          .slice(0, 50)
      : [];
  });

  listen(IPC.pillHover, (event, inside: unknown) => {
    if (pill.owns(event.sender)) pill.setHover(inside === true);
  });
  listen(IPC.pillPress, (event) => {
    if (pill.owns(event.sender)) pill.pressed();
  });
  listen(IPC.pillRelease, (event) => {
    if (pill.owns(event.sender)) void pillReleased();
  });
  listen(IPC.pillArea, (event, size: unknown) => {
    if (!pill.owns(event.sender) || !isSize(size)) return;
    pill.setSize(size);
  });
  // The helper catches the pill's presses so they never activate the app; same handling after.
  if (platform.clickCatcher) {
    pill.attachClickCatcher(platform.clickCatcher);
    platform.clickCatcher.onButton((down) => {
      if (down) pill.pressed();
      else void pillReleased();
    });
  }

  async function pillReleased(): Promise<void> {
    const result = pill.released();
    if (!result) return;
    if (!result.click) {
      // Saved like any other setting, so Settings and the pill's own alignment hear of it.
      const next = await settings.update({ pillPosition: result.place });
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC.settingsChanged, next);
      return;
    }
    // A click means what the pill is showing: Undo for a learned word, Copy for words with
    // nowhere to go, and otherwise "open the app".
    const kind = pill.currentKind();
    if (kind === "learned") await undoLearned();
    else if (kind === "unplaced") await copyUnplaced();
    else if (kind === "snippet") {
      dictation.dismiss();
      await takeOfferedSnippet();
    }
    // "No sound from your microphone": the microphone and its live level are in Settings, General.
    else if (pill.showsMicCheck()) openMainWindow({ page: "settings", tab: "general" });
    else openMainWindow();
  }
  listen(IPC.pillMenu, (event) => {
    if (!pill.owns(event.sender)) return;
    void history.recent(1).then(([record]) => {
      const last = record?.finalText ?? "";
      const hide = (until: number) => void changeSettings({ pillHiddenUntil: until });
      const tomorrow = new Date();
      tomorrow.setHours(24, 0, 0, 0);
      pill.popup(
        Menu.buildFromTemplate([
          {
            label: "Paste last dictation",
            enabled: !!last,
            // The pill never takes the focus, so the app the user was in still has it.
            click: () => setTimeout(() => void platform.inserter.insert(last), 120),
          },
          { label: "Copy last dictation", enabled: !!last, click: () => clipboard.writeText(last) },
          { type: "separator" },
          { label: "Hide for 1 hour", click: () => hide(Date.now() + 60 * 60 * 1000) },
          { label: "Hide until tomorrow", click: () => hide(tomorrow.getTime()) },
          { type: "separator" },
          { label: "Pill settings...", click: () => openMainWindow({ page: "settings", tab: "sound" }) },
        ]),
      );
    });
  });
  listen(IPC.pillDemo, (event, state: unknown) => {
    // From the main window only, and only the states Settings previews.
    if (pill.owns(event.sender) || !isDemoState(state)) return;
    dictation.demo(state);
  });

  /**
   * A trigger said inside a sentence: the words went in as said, and the pill offers the snippet
   * for 15 s (Mac e6315c8). Typing meanwhile withdraws it, since Ctrl+Z would then take back the
   * person's typing, not our words; our own Ctrl+V can still be heard for the first half second.
   */
  function offerSnippet(offer: {
    snippetId: string;
    trigger: string;
    replaced: string;
    recordId: string;
  }): void {
    withdrawSnippet();
    const at = Date.now();
    const stopWatching = platform.hotkey.onTyped?.(() => {
      if (Date.now() - at < 500 || snippetOffer?.at !== at) return;
      withdrawSnippet();
      if (pill.currentKind() === "snippet") dictation.dismiss();
    });
    const expiry = setTimeout(withdrawSnippet, SNIPPET_OFFER_MS);
    snippetOffer = { ...offer, at, stop: () => (clearTimeout(expiry), stopWatching?.()) };
    dictation.notice({ kind: "snippet", trigger: offer.trigger });
  }

  function withdrawSnippet(): void {
    snippetOffer?.stop();
    snippetOffer = null;
  }

  /** The pill's Use: the words that went in are taken back and the snippet's version goes in. */
  async function takeOfferedSnippet(): Promise<void> {
    const offer = snippetOffer;
    withdrawSnippet();
    if (!offer || Date.now() - offer.at > SNIPPET_OFFER_MS) return;
    // What the box says now is about to change on purpose: not a fix to learn from.
    learner.forget();
    try {
      // Where the words could not be swapped safely, the snippet's own text is copied instead.
      if (!(await platform.inserter.replaceLast?.(offer.replaced))) {
        const text = await snippets.text(offer.snippetId);
        if (text) await clipboard.writeText(text);
        dictation.confirm(`Snippet copied · paste with ${process.platform === "darwin" ? "⌘V" : "Ctrl+V"}`);
        console.log("snippet: could not swap safely here; its text was copied");
        return;
      }
      await snippets.used(offer.snippetId);
      notifySnippetsChanged();
      const marked = await history.update(offer.recordId, (record) => {
        record.saidText = record.finalText;
        record.finalText = offer.replaced;
        record.snippet = offer.snippetId;
      });
      if (marked) notifyHistoryChanged();
      console.log("snippet: swapped in after the paste");
    } catch (error) {
      dictation.confirm(error instanceof Error ? error.message : String(error));
    }
  }

  async function copyUnplaced(): Promise<void> {
    const text = pill.unplacedText();
    // A demo from Settings has no words of the user's: the clipboard is left as it is.
    if (text) await clipboard.writeText(text);
    // The Mac app's wording said ⌘V, which Windows users saw on the pill (user, 2026-11-23).
    dictation.confirm(`Copied · paste with ${process.platform === "darwin" ? "⌘V" : "Ctrl+V"}`);
    console.log(
      `pill: copied the words that had nowhere to go (${text ? "to the clipboard" : "demo, nothing"})`,
    );
  }

  async function undoLearned(): Promise<void> {
    const words = pill.learnedWords();
    dictation.dismiss();
    for (const word of words) {
      await dictionary.remove(word);
      await learner.removed(word);
    }
    if (words.length > 0) void voice.pushDictionary();
  }
  listen(IPC.micChunk, (event, samples: Int16Array) => {
    if (pill.owns(event.sender)) pillMic.receive(samples);
  });
  listen(IPC.micStopped, (event) => {
    if (pill.owns(event.sender)) pillMic.stopped();
  });
  listen(IPC.micError, (event, message: string) => {
    if (pill.owns(event.sender)) pillMic.failed(String(message));
  });

  let hotkeyRetry: NodeJS.Timeout | undefined;
  const registerHotkey = async (): Promise<void> => {
    // One retry loop at most, even when a settings change re-registers while a retry is pending.
    clearTimeout(hotkeyRetry);
    await platform.hotkey
      .register(await bindings(), (event) => dictation.handleHotkey(event))
      .then(() => {
        hotkeyRefusals = 0;
      })
      .catch((error: unknown) => {
        // Missing permission: keep trying, so the hotkey starts working as soon as it is granted.
        if (error instanceof SubxError && error.code === "permission_denied") {
          hotkeyRefusals++;
          hotkeyRetry = setTimeout(registerHotkey, HOTKEY_RETRY_MS);
        } else {
          console.error("Hotkey unavailable:", error);
        }
      });
  };
  void registerHotkey();

  // Settings records the dictation hotkey here, with the platform's own poll (see Hotkey.record).
  // The watch stops meanwhile: holding today's hotkey to record it again started a dictation.
  let recording: { cancel(): void } | null = null;
  handle(IPC.hotkeyRecord, async (event) => {
    const record = platform.hotkey.record?.bind(platform.hotkey);
    if (!record) return null;
    recording?.cancel();
    await platform.hotkey.unregisterAll().catch(() => {});
    const sender = event.sender;
    const session = record((keys) => {
      if (!sender.isDestroyed()) sender.send(IPC.hotkeyHeld, keys);
    });
    recording = session;
    // A window closed mid-recording must not leave the hotkey off.
    sender.once("destroyed", () => session.cancel());
    try {
      const keys = await session.done;
      if (!keys) return null;
      const refused = hotkeyRefusal(keys, (k) => platform.hotkey.accepts(k));
      return refused ? { refused } : { keys };
    } finally {
      if (recording === session) recording = null;
      await registerHotkey();
    }
  });
  listen(IPC.hotkeyRecordCancel, () => recording?.cancel());

  tray = createTray(
    async () => {
      const [state, records, chosen, hotkey] = await Promise.all([
        account.state(),
        history.recent(Number.MAX_SAFE_INTEGER),
        settings.all(),
        bindings(),
      ]);
      // The same daily totals as Home, so the menu and the window never disagree (this line used to
      // count the history's words its own way, splitting on spaces: a "—" was a word, a Japanese
      // sentence was one, and deleted dictations dropped out).
      const days: Record<string, DayTotal> = await accountTotals.days().catch(() => ({}));
      const today = days[dayKey(Date.now())];
      return {
        signedIn: state.signedIn,
        name: state.name,
        today: { dictations: today?.dictations ?? 0, words: today?.words ?? 0 },
        hotkey: hotkey[0]?.keys ?? "",
        // Asked of the helper each time: AirPods and iPhones come and go.
        microphones: platform.microphone?.devices
          ? await platform.microphone.devices().catch(() => [])
          : null,
        microphoneId: chosen.microphoneId,
        languages: (await voice.current().catch(() => null))?.languages ?? null,
        pillShown: pillShownNow(await settings.all()),
        last: records.find((record) => record.finalText)?.finalText ?? null,
      };
    },
    {
      open: () => openMainWindow(),
      openSettings: (tab) => openMainWindow({ page: "settings", tab }),
      useMicrophone: (id) => void changeSettings({ microphoneId: id }),
      setHinglish: (on) => {
        void voice.current().then((current) => {
          if (current) return voice.update({ languages: { ...current.languages, hinglish: on } });
        });
      },
      // On also undoes a hide from the pill's own menu (the Mac app's "Show the pill").
      setPillShown: (on) => void changeSettings({ pillWhenIdle: on, pillHiddenUntil: 0 }),
      addWord: () => openMainWindow({ page: "dictionary" }),
      copyLast: () => {
        void history.recent(1).then(([record]) => {
          if (record?.finalText) clipboard.writeText(record.finalText);
        });
      },
      checkForUpdates: () => {
        openMainWindow({ page: "settings", tab: "about" });
        void checkForUpdate();
      },
    },
  );
  // Started at login, the app belongs in the menu bar with the pill on screen — not in front of
  // whatever the user was actually opening.
  if (!startedHidden()) openMainWindow();
}

/**
 * Our windows show only our own pages (ownPage). A link, a script or a dropped file that tried to
 * load anything else would hand it the preload bridge, so such a navigation is stopped and, if it
 * is a web page, opened in the browser instead.
 */
app.on("web-contents-created", (_event, contents) => {
  const toBrowser = (url: string) => {
    // Mail to support opens the mail app; nothing else but web pages leaves the window.
    if (/^https:\/\//.test(url) || /^mailto:support@subxvoice\.app(\?|$)/.test(url))
      void shell.openExternal(url);
  };
  contents.setWindowOpenHandler(({ url }) => {
    toBrowser(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (ownPage(url)) return;
    event.preventDefault();
    toBrowser(url);
  });
});

app.whenReady().then(() => {
  // A swallowed startup failure looks exactly like a window that never opens, which is not a
  // thing anyone can debug from the outside.
  start().catch((error) => console.error("SUBXVoice failed to start:", error));
  app.on("activate", () => openMainWindow());
});

// Someone tried to open a second copy — almost always a double-click on the shortcut while the
// app sat in the tray. Show them the window they were asking for.
app.on("second-instance", () => openMainWindow());

app.on("will-quit", () => {
  tray?.destroy();
  void platform.hotkey.unregisterAll();
});

function isDemoState(value: unknown): value is PillState {
  const state = value as Partial<PillState> | null;
  if (!state || typeof state.kind !== "string") return false;
  const texts = Object.values(state).every((field) => typeof field !== "string" || field.length <= 200);
  return (
    texts && ["idle", "listening", "processing", "done", "error", "learned", "unplaced"].includes(state.kind)
  );
}

function isSize(value: unknown): value is { width: number; height: number } {
  const size = value as Record<string, unknown> | null;
  return !!size && Number.isFinite(size.width) && Number.isFinite(size.height);
}
