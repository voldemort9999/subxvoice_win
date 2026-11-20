import { autoUpdater } from "electron-updater";
import type { UpdateState } from "../shared/ipc";

/**
 * Auto-update, read from the public releases repo (see electron-builder.yml → publish).
 *
 * The app downloads in the background and installs on quit, so a user who never opens Settings
 * still ends up on the current version. The UI exists to answer "am I up to date?" and to let
 * someone restart now rather than later.
 *
 * Nothing here runs unpackaged: there is no installer to replace in `electron-vite dev`, and
 * electron-updater throws rather than no-op when asked anyway.
 */

let state: UpdateState = { kind: "idle" };
let publish: (state: UpdateState) => void = () => {};

/** Every six hours. A dictation app stays open for days, so launch-only checking misses releases. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

function set(next: UpdateState): void {
  state = next;
  publish(next);
}

export function updateState(): UpdateState {
  return state;
}

export function startUpdater(onChange: (state: UpdateState) => void, isPackaged: boolean): void {
  publish = onChange;
  if (!isPackaged) {
    set({ kind: "unsupported", reason: "Updates are disabled in development." });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };

  autoUpdater.on("checking-for-update", () => set({ kind: "checking" }));
  autoUpdater.on("update-not-available", () => set({ kind: "current", checkedAt: Date.now() }));
  autoUpdater.on("update-available", (info) =>
    set({ kind: "downloading", version: info.version, percent: 0 }),
  );
  autoUpdater.on("download-progress", (progress) => {
    // Keep the version already reported by update-available; progress events do not carry it.
    if (state.kind === "downloading") set({ ...state, percent: Math.round(progress.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => set({ kind: "ready", version: info.version }));
  autoUpdater.on("error", (error) => failed(error));

  void checkForUpdate();
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS).unref();
}

export async function checkForUpdate(): Promise<UpdateState> {
  if (state.kind === "unsupported") return state;
  // A check during a download would restart it, and "ready" is already the end of the road.
  if (state.kind === "downloading" || state.kind === "ready") return state;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    failed(error);
  }
  return state;
}

/** Quits and runs the downloaded installer. Does nothing until a download has finished. */
export function installUpdate(): void {
  if (state.kind !== "ready") return;
  // isSilent=false so the user sees the installer; isForceRunAfter=true so the app comes back.
  autoUpdater.quitAndInstall(false, true);
}

function log(message?: unknown): void {
  console.log("[updater]", message);
}

/**
 * The updater's own errors are written for developers (HTTP codes, YAML paths), so they go to the
 * log and people get one plain sentence. (From the Mac app; its unsigned-copy download offer is
 * macOS-only and not taken.)
 */
function failed(error: unknown): void {
  console.error("update check failed:", error);
  set({ kind: "error", message: "Couldn't check for updates. Check your connection and try again." });
}
