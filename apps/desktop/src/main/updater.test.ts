import { beforeEach, describe, expect, it, vi } from "vitest";

// electron-updater reaches for Electron's app object at import time, so the module under test
// only ever sees this stand-in.
const handlers = new Map<string, (payload: unknown) => void>();
const checkForUpdates = vi.fn(async () => undefined);
const quitAndInstall = vi.fn();

vi.mock("electron-updater", () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    logger: null,
    on: (event: string, handler: (payload: unknown) => void) => handlers.set(event, handler),
    checkForUpdates,
    quitAndInstall,
  },
}));

const { checkForUpdate, installUpdate, startUpdater, updateState } = await import("./updater");

/** Fire an electron-updater event the way the real autoUpdater would. */
const emit = (event: string, payload?: unknown) => handlers.get(event)?.(payload);

beforeEach(() => {
  checkForUpdates.mockClear();
  quitAndInstall.mockClear();
});

describe("updater", () => {
  it("does not check when there is no installer to replace", async () => {
    startUpdater(() => {}, false);
    expect(updateState().kind).toBe("unsupported");
    await checkForUpdate();
    expect(checkForUpdates).not.toHaveBeenCalled();
  });

  it("reports every state change to the renderer", () => {
    const seen: string[] = [];
    startUpdater((state) => seen.push(state.kind), true);
    emit("update-available", { version: "9.9.9" });
    emit("download-progress", { percent: 42.4 });
    emit("update-downloaded", { version: "9.9.9" });
    expect(seen).toContain("downloading");
    expect(seen).toContain("ready");
  });

  it("keeps the version across progress events, which do not carry one", () => {
    startUpdater(() => {}, true);
    emit("update-available", { version: "9.9.9" });
    emit("download-progress", { percent: 42.4 });
    expect(updateState()).toEqual({ kind: "downloading", version: "9.9.9", percent: 42 });
  });

  it("refuses a check mid-download, which would restart it", async () => {
    startUpdater(() => {}, true);
    checkForUpdates.mockClear();
    emit("update-available", { version: "9.9.9" });
    await checkForUpdate();
    expect(checkForUpdates).not.toHaveBeenCalled();
  });

  it("surfaces a failed check instead of staying silent", async () => {
    startUpdater(() => {}, true);
    emit("error", new Error("HttpError: 404 latest.yml"));
    expect(updateState()).toEqual({
      kind: "error",
      message: "Couldn't check for updates. Check your connection and try again.",
    });
  });

  it("installs only once a download has finished", () => {
    startUpdater(() => {}, true);
    emit("update-available", { version: "9.9.9" });
    installUpdate();
    expect(quitAndInstall).not.toHaveBeenCalled();

    emit("update-downloaded", { version: "9.9.9" });
    installUpdate();
    expect(quitAndInstall).toHaveBeenCalledOnce();
  });
});
