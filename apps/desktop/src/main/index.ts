import { randomUUID } from "node:crypto";
import { existsSync, renameSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentMemory,
  type DictionaryEntry,
  type HotkeyBinding,
  type PermissionKind,
  Pipeline,
  runCommand,
  SubxError,
  screenSource,
  type WritingTone,
} from "@subx/core";
import { app, BrowserWindow, ipcMain, Menu, shell, type Tray } from "electron";
import {
  type AppInfo,
  type AppSettings,
  IPC,
  type MicrophoneOption,
  type PermissionStatus,
} from "../shared/ipc";
import { Account } from "./auth";
import { appIcon } from "./brand";
import { DictationController } from "./dictation";
import { PillMic } from "./mic";
import { PillWindow } from "./pill";
import { createPlatform } from "./platform";
import { createEngines, loadDevEnv } from "./providers";
import { deleteRecording, recordingsDir, saveRecording, setRecordingsDir } from "./recordings";
import { loadPage, PRELOAD_PATH } from "./renderer";
import { JsonDictionaryStore, JsonHistoryStore, JsonSettingsStore } from "./stores";
import { createTray } from "./tray";
import { checkForUpdate, installUpdate, startUpdater, updateState } from "./updater";
import { createWorkflow } from "./workflow";

const HOTKEY_RETRY_MS = 3000;
/** A renderer killed for memory dies again if reloaded straight away. */
const RENDERER_RELOAD_MS = 500;

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
 * package.json had no productName until 0.1.1, so both Windows-facing names fell back to the
 * package name: the app installed into `Programs\@subxdesktop` and kept everything under
 * `AppData\Roaming\@subx\desktop`. Naming the product moved userData, which would otherwise
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
// Built in start(), because the account they depend on needs the app to be ready first.
let account: Account;
let engines: ReturnType<typeof createEngines> = { problems: [] };
/** Reported by the renderer, which is the only side with MediaDevices. */
let microphones: MicrophoneOption[] = [];
let mainWindow: BrowserWindow | null = null;
/** Held at module scope so opening the app can revive it; built in start(). */
let pillWindow: PillWindow | null = null;
let tray: Tray | null = null; // kept in a variable so it isn't garbage-collected

/** True when Windows launched us at login (see the login item's args). */
const startedHidden = () => process.argv.includes("--hidden") || app.getLoginItemSettings().wasOpenedAtLogin;

function openMainWindow(): void {
  // Opening the app is what someone does when the pill has vanished, so it is the natural place
  // to put it back — it used to touch only the main window, which is why force-quitting was the
  // only thing that worked.
  pillWindow?.revive();
  if (mainWindow) {
    // A dead renderer leaves the window as a blank white rectangle, and showing it again shows
    // the same blank rectangle. Reload first, so opening the app is a real recovery.
    if (mainWindow.webContents.isCrashed()) mainWindow.webContents.reload();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 680,
    // Without this the taskbar and Alt-Tab show Electron's own icon.
    icon: appIcon(),
    minWidth: 760,
    minHeight: 520,
    show: false,
    webPreferences: { preload: PRELOAD_PATH, sandbox: true, contextIsolation: true },
  });
  mainWindow.on("ready-to-show", () => mainWindow?.show());
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
  loadPage(mainWindow, "index.html");
}

function notifyHistoryChanged(): void {
  mainWindow?.webContents.send(IPC.historyChanged);
}

/** Credentials arrive from the renderer, so they are checked before they reach the network. */
function asText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 320) {
    throw new Error(`Enter a valid ${field}.`);
  }
  return value.trim();
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
  const misheardAs = Array.isArray(entry?.misheardAs) ? entry.misheardAs : [];
  return {
    word: assertString(entry?.word, "word"),
    misheardAs: misheardAs.filter((item): item is string => typeof item === "string" && !!item.trim()),
  };
}

/** The command key's default. See the comment where settings are created. */
const COMMAND_KEYS = "ctrl+alt";

/** "alt+ctrl" and "ctrl+alt" are the same chord. */
const sameChord = (a: string, b: string) =>
  a.toLowerCase().split("+").sort().join("+") === b.toLowerCase().split("+").sort().join("+");

const isTone = (value: unknown): value is WritingTone =>
  value === "professional" || value === "formal" || value === "casual";

/** Settings arrive from the renderer, so every field is checked before it is stored. */
function assertSettings(value: unknown, accepts: (keys: string) => boolean): Partial<AppSettings> {
  const input = (value ?? {}) as Partial<AppSettings>;
  const patch: Partial<AppSettings> = {};
  if (typeof input.hotkey === "string") {
    if (!accepts(input.hotkey)) throw new Error(`Unsupported hotkey: ${input.hotkey}`);
    patch.hotkey = input.hotkey;
  }
  if (typeof input.commandHotkey === "string") {
    if (!accepts(input.commandHotkey)) throw new Error(`Unsupported hotkey: ${input.commandHotkey}`);
    patch.commandHotkey = input.commandHotkey;
  }
  if (input.script === "native" || input.script === "roman") patch.script = input.script;
  if (typeof input.launchAtLogin === "boolean") patch.launchAtLogin = input.launchAtLogin;
  if (isTone(input.emailTone)) patch.emailTone = input.emailTone;
  if (isTone(input.messageTone)) patch.messageTone = input.messageTone;
  if (typeof input.microphoneId === "string" && input.microphoneId.length <= 200) {
    patch.microphoneId = input.microphoneId;
  }
  return patch;
}

async function start(): Promise<void> {
  const dataDir = app.getPath("userData");
  await mkdir(dataDir, { recursive: true });

  account = new Account();
  // Signing in once should last; a session that no longer refreshes just asks again.
  await account.restore();
  engines = createEngines(account);
  // Transcripts, dictionary and audio belong to the person signed in, not to the machine. They
  // live in a folder named after the account so the next person to sign in starts empty.
  let accountDir = join(dataDir, "accounts", "signed-out");
  const history = new JsonHistoryStore(() => join(accountDir, "history.json"));
  const dictionary = new JsonDictionaryStore(() => join(accountDir, "dictionary.json"));

  const switchAccountData = async (userId: string | null) => {
    accountDir = join(dataDir, "accounts", userId ?? "signed-out");
    await mkdir(accountDir, { recursive: true });
    setRecordingsDir(join(accountDir, "recordings"));
    history.forget();
    dictionary.forget();
  };

  // Point at the restored account's folder before anything reads from it.
  await switchAccountData((await account.state()).id);

  // Settings stay with the machine: the hotkey, microphone and startup choice describe this
  // computer, not the person.
  const settings = new JsonSettingsStore<AppSettings>(() => join(dataDir, "settings.json"), {
    hotkey: platform.hotkey.defaultBindings()[0]?.keys ?? "",
    // Ctrl+Alt, not Fn+Alt: Fn is handled inside the keyboard and never reaches Windows, so no
    // application can watch it. Not Win+Alt either — releasing a chord with Win in it can open
    // the Start menu.
    commandHotkey: COMMAND_KEYS,
    script: "roman",
    microphoneId: "",
    launchAtLogin: false,
    emailTone: "professional",
    messageTone: "casual",
  });

  /**
   * Mirrored to the OS rather than stored only by us: the user can also turn it off in Windows
   * Settings, and whatever they did there last is the truth.
   */
  const applyLaunchAtLogin = (openAtLogin: boolean) => {
    if (!app.isPackaged) return; // dev runs from electron.exe, which is not what would autostart
    app.setLoginItemSettings({
      openAtLogin,
      // Started this way the app belongs in the tray, not in front of whatever the user opened.
      args: ["--hidden"],
    });
  };
  applyLaunchAtLogin((await settings.all()).launchAtLogin);

  const bindings = async (): Promise<HotkeyBinding[]> => {
    const { hotkey, commandHotkey } = await settings.all();
    // settings.json is a file the user can edit, so a stored hotkey is re-checked every time.
    const dictate: HotkeyBinding[] =
      !hotkey || !platform.hotkey.accepts(hotkey)
        ? platform.hotkey.defaultBindings()
        : [{ keys: hotkey, mode: "exact" }];
    // Watched only where command mode can actually run, and never when it is the dictation chord:
    // one key cannot mean both, and dictating is what the user set up first.
    const keys = commandHotkey || COMMAND_KEYS;
    if (!platform.commands || !engines.decider || !engines.writer) return dictate;
    if (!platform.hotkey.accepts(keys) || dictate.some((binding) => sameChord(binding.keys, keys)))
      return dictate;
    return [...dictate, { keys, mode: "command" }];
  };

  ipcMain.handle(IPC.authState, () => account.state());
  ipcMain.handle(IPC.authSignIn, (_event, email: unknown, password: unknown) =>
    account.signIn(asText(email, "email"), asText(password, "password")),
  );
  ipcMain.handle(IPC.authSignUp, (_event, email: unknown, password: unknown) =>
    account.signUp(asText(email, "email"), asText(password, "password")),
  );
  ipcMain.handle(IPC.authSignOut, () => account.signOut());
  ipcMain.handle(IPC.authUsage, () => account.usage());
  ipcMain.handle(IPC.authSetProfile, (_event, name: unknown) => account.setProfile(asText(name, "name")));
  account.onChanged((state) => {
    // Switching accounts switches the data with it, and signing out puts it out of reach.
    void switchAccountData(state.id).then(() => notifyHistoryChanged());
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.authChanged, state);
    }
  });

  ipcMain.handle(
    IPC.appInfo,
    async (): Promise<AppInfo> => ({
      version: app.getVersion(),
      hotkeys: await bindings(),
      supportedKeys: platform.hotkey.supportedKeys(),
      providers: { stt: !!engines.stt, llm: !!engines.llm },
    }),
  );
  ipcMain.handle(IPC.openRecordingsFolder, async () => {
    await mkdir(recordingsDir(), { recursive: true });
    await shell.openPath(recordingsDir());
  });

  ipcMain.handle(IPC.permissionList, async (): Promise<PermissionStatus[]> => {
    const kinds = platform.permissions.required();
    return Promise.all(kinds.map(async (kind) => ({ kind, state: await platform.permissions.status(kind) })));
  });
  ipcMain.handle(IPC.permissionRequest, (_event, kind: unknown) =>
    platform.permissions.request(assertPermissionKind(kind)),
  );
  ipcMain.handle(IPC.permissionOpenSettings, (_event, kind: unknown) =>
    platform.permissions.openSettings(assertPermissionKind(kind)),
  );

  ipcMain.handle(IPC.historyList, () => history.recent(Number.MAX_SAFE_INTEGER));
  ipcMain.handle(IPC.historyAudio, async (_event, id: unknown) => {
    const record = await history.find(assertString(id, "id"));
    if (!record?.audioPath) throw new Error("This recording has no audio");
    return readFile(record.audioPath);
  });
  ipcMain.handle(IPC.historyRemove, async (_event, id: unknown) => {
    const record = await history.find(assertString(id, "id"));
    if (!record) return;
    if (record.audioPath) await deleteRecording(record.audioPath);
    await history.remove(record.id);
    notifyHistoryChanged();
  });

  ipcMain.handle(IPC.dictionaryList, () => dictionary.all());
  ipcMain.handle(IPC.dictionaryUpsert, (_event, entry: unknown) =>
    dictionary.upsert(assertDictionaryEntry(entry)),
  );
  ipcMain.handle(IPC.dictionaryRemove, (_event, word: unknown) =>
    dictionary.remove(assertString(word, "word")),
  );

  const pill = new PillWindow();
  pillWindow = pill;
  // The mic runs as Web Audio inside the pill window.
  const pillMic = new PillMic(pill);
  const pipeline = engines.stt
    ? new Pipeline({
        stt: engines.stt,
        llm: engines.llm,
        decider: engines.decider,
        inserter: platform.inserter,
        history,
        dictionary,
      })
    : null;

  // What was said and done in the last few minutes, so "now type this in it" knows what "it" is.
  const memory = new AgentMemory();
  const commands = platform.commands;
  const command =
    commands && engines.decider && engines.writer
      ? {
          // The OS's own actions first; the screen only for what they cannot do (docs/command-mode.md).
          sources: [
            commands,
            ...(platform.screen
              ? [screenSource(platform.screen, engines.decider, engines.writer, (line) => console.log(line))]
              : []),
          ],
          decider: engines.decider,
          writer: engines.writer,
        }
      : null;

  const dictation = new DictationController(
    pill,
    pillMic,
    createWorkflow({
      pipeline,
      problems: engines.problems,
      settings,
      context: platform.context,
      history,
      saveRecording,
      newId: randomUUID,
      // Show the words as heard while the model is still cleaning them up.
      onHeard: (text) => pill.setState({ kind: "processing", message: text }),
      signedIn: async () => (await account.state()).signedIn,
      userName: async () => (await account.state()).name || undefined,
      // "Writing an email…" is a very different wait from "formatting what you said".
      onIntent: (intent) => {
        if (intent !== "dictation") {
          pill.setState({ kind: "processing", message: `Writing your ${intent}…` });
        }
      },
      remainingSeconds: async () => (await account.usage())?.remaining ?? null,
      warmCommands: () => commands?.warm?.(),
      command: command
        ? (said) =>
            runCommand(said, {
              decider: command.decider,
              writer: command.writer,
              sources: command.sources,
              memory,
              // The pill says what is about to happen before it happens.
              onEvent: (event) => {
                if (event.kind !== "thinking") pill.setState({ kind: "processing", message: event.what });
              },
              log: (line) => console.log(line),
            })
        : undefined,
      onHistoryChanged: notifyHistoryChanged,
      log: (line) => console.log(line),
    }),
  );

  ipcMain.handle(IPC.settingsGet, () => settings.all());
  ipcMain.handle(IPC.settingsSet, async (_event, patch: unknown) => {
    const next = await settings.update(assertSettings(patch, (keys) => platform.hotkey.accepts(keys)));
    applyLaunchAtLogin(next.launchAtLogin);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.settingsChanged, next);
    }
    await registerHotkey();
    return next;
  });
  ipcMain.handle(IPC.updateState, () => updateState());
  ipcMain.handle(IPC.updateCheck, () => checkForUpdate());
  ipcMain.on(IPC.updateInstall, () => installUpdate());
  startUpdater((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.updateChanged, state);
    }
  }, app.isPackaged);

  ipcMain.handle(IPC.microphoneList, () => microphones);
  ipcMain.on(IPC.microphonePublish, (_event, options: unknown) => {
    microphones = Array.isArray(options)
      ? options
          .filter((item): item is MicrophoneOption => !!item && typeof item.id === "string")
          .map((item) => ({ id: String(item.id), label: String(item.label ?? "Microphone") }))
          .slice(0, 50)
      : [];
  });

  ipcMain.on(IPC.pillHover, (event, inside: unknown) => {
    if (pill.owns(event.sender)) pill.setHover(inside === true);
  });
  ipcMain.on(IPC.pillClick, (event) => {
    if (pill.owns(event.sender)) openMainWindow();
  });
  ipcMain.on(IPC.micChunk, (event, samples: Int16Array) => {
    if (pill.owns(event.sender)) pillMic.receive(samples);
  });
  ipcMain.on(IPC.micStopped, (event) => {
    if (pill.owns(event.sender)) pillMic.stopped();
  });
  ipcMain.on(IPC.micError, (event, message: string) => {
    if (pill.owns(event.sender)) pillMic.failed(String(message));
  });

  let hotkeyRetry: NodeJS.Timeout | undefined;
  const registerHotkey = async (): Promise<void> => {
    // One retry loop at most, even when a settings change re-registers while a retry is pending.
    clearTimeout(hotkeyRetry);
    await platform.hotkey
      .register(await bindings(), (event) => dictation.handleHotkey(event))
      .catch((error: unknown) => {
        // Missing permission: keep trying, so the hotkey starts working as soon as it is granted.
        if (error instanceof SubxError && error.code === "permission_denied") {
          hotkeyRetry = setTimeout(registerHotkey, HOTKEY_RETRY_MS);
        } else {
          console.error("Hotkey unavailable:", error);
        }
      });
  };
  void registerHotkey();

  tray = createTray(openMainWindow);
  // Started by Windows at login, the app belongs in the tray with the pill on screen — not in
  // front of whatever the user was actually opening.
  if (!startedHidden()) openMainWindow();
}

app.whenReady().then(() => {
  // Windows draws the menu inside our own window, where File/Edit/View belongs to no feature this
  // app has.
  Menu.setApplicationMenu(null);
  // A swallowed startup failure looks exactly like a window that never opens, which is not a
  // thing anyone can debug from the outside.
  start().catch((error) => console.error("SUBXVoice failed to start:", error));
});

// Someone tried to open a second copy — almost always a double-click on the shortcut while the
// app sat in the tray. Show them the window they were asking for.
app.on("second-instance", () => openMainWindow());

app.on("will-quit", () => {
  tray?.destroy();
  // Its PowerShell would otherwise outlive the app.
  platform.commands?.dispose?.();
  void platform.hotkey.unregisterAll();
});
