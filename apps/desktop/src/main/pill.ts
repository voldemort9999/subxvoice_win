import { BrowserWindow, screen, type WebContents } from "electron";
import { IPC, type MicCommand, type PillState } from "../shared/ipc";
import { loadPage, PRELOAD_PATH } from "./renderer";

const WIDTH = 240;
const HEIGHT = 64;
const BOTTOM_GAP = 8;
/** How long to wait for a first paint before showing the pill regardless. */
const SHOW_FALLBACK_MS = 4000;
/** Grows with each attempt: a renderer killed for memory dies again if reloaded straight away. */
const RELOAD_BACKOFF_MS = 500;
/** Past this the renderer is not coming back, and retrying forever only burns the battery. */
const MAX_RELOADS = 5;

/**
 * The small indicator that is always on screen. It never takes focus, so the user's app keeps the
 * cursor and the paste lands in the right place. The window ignores the mouse except while the
 * pointer is over the pill itself, so the transparent area around it never blocks clicks.
 */
export class PillWindow {
  private readonly window: BrowserWindow;
  /** Reload attempts since the last success, so a renderer that cannot load is not retried forever. */
  private reloads = 0;

  constructor() {
    this.window = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      fullscreenable: false,
      webPreferences: {
        preload: PRELOAD_PATH,
        sandbox: true,
        contextIsolation: true,
        // Keep audio and timers running while the window is not focused.
        backgroundThrottling: false,
      },
    });
    this.window.setAlwaysOnTop(true, "screen-saver");
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.setHover(false);
    // The pill is the only thing on screen while dictating, and on Windows it is also where the
    // microphone lives. A dead renderer leaves the window in place, still reporting isVisible(),
    // drawing nothing — an app that looks shut down but is not, and that reopening cannot fix
    // because opening the app only touches the main window. So these are recovered, not just
    // reported.
    this.window.webContents.on("render-process-gone", (_event, details) => {
      console.error("pill renderer gone:", details.reason, "— reloading");
      this.recover();
    });
    this.window.webContents.on("did-fail-load", (_event, code, description, url) => {
      console.error(`pill failed to load (${code} ${description}): ${url} — reloading`);
      this.recover();
    });

    // A display being added, removed or resized moves where "bottom-centre" is. Without this the
    // pill keeps the coordinates it was given at startup, which after a monitor sleeps or is
    // unplugged can be on no screen at all.
    screen.on("display-added", this.reposition);
    screen.on("display-removed", this.reposition);
    screen.on("display-metrics-changed", this.reposition);
    this.window.webContents.on("console-message", (_event, level, message, line, source) => {
      if (level >= 2) console.error(`pill console: ${message} (${source}:${line})`);
    });

    this.window.once("ready-to-show", () => this.reveal());
    // ready-to-show waits for a first paint, which never comes if the page throws before it
    // renders. Showing anyway is better than an app with no visible state at all.
    setTimeout(() => this.reveal(), SHOW_FALLBACK_MS);

    loadPage(this.window, "pill.html");
  }

  /**
   * Brings the renderer back after it has died or failed to load. Reload keeps the window, its
   * position and its always-on-top status, so the pill reappears where it was.
   */
  private recover(): void {
    if (this.window.isDestroyed()) return;
    if (this.reloads >= MAX_RELOADS) {
      console.error(`pill renderer failed ${this.reloads} times; leaving it alone`);
      return;
    }
    this.reloads++;
    // Backing off: a renderer killed for memory will be killed again if reloaded immediately.
    setTimeout(() => {
      if (this.window.isDestroyed()) return;
      this.window.webContents.reload();
    }, RELOAD_BACKOFF_MS * this.reloads);
  }

  /**
   * Makes the pill present again, whatever went wrong. Called when the user opens the app,
   * because "the indicator is gone so I reopened it" is the obvious fix to try and used to do
   * nothing at all.
   *
   * Everything here is idempotent, so calling it on every open is free.
   */
  revive(): void {
    if (this.window.isDestroyed()) return;
    // Topmost is not a promise Windows keeps: a fullscreen app or a foreground steal can drop it,
    // and then the pill is behind the window the user is typing into.
    this.window.setAlwaysOnTop(true, "screen-saver");
    this.reposition();
    if (this.window.webContents.isCrashed()) {
      this.reloads = 0;
      this.recover();
    }
    if (!this.window.isVisible()) this.window.showInactive();
  }

  private reveal(): void {
    if (this.window.isDestroyed() || this.window.isVisible()) return;
    this.reposition();
    this.window.showInactive();
  }

  /** Bottom-centre of whichever screen the mouse is on. Bound, because `screen` events call it. */
  readonly reposition = (): void => {
    if (this.window.isDestroyed()) return;
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    this.window.setPosition(
      Math.round(workArea.x + (workArea.width - WIDTH) / 2),
      Math.round(workArea.y + workArea.height - HEIGHT - BOTTOM_GAP),
    );
  };

  /** While the pointer is over the pill, accept clicks; otherwise let them pass through. */
  setHover(inside: boolean): void {
    this.window.setIgnoreMouseEvents(!inside, { forward: true });
  }

  setState(state: PillState): void {
    this.window.webContents.send(IPC.pillState, state);
  }

  /** Loudness (0–1) of the latest chunk, for the waveform. */
  level(value: number): void {
    this.window.webContents.send(IPC.pillLevel, value);
  }

  mic(command: MicCommand): void {
    this.window.webContents.send(IPC.micCommand, command);
  }

  owns(sender: WebContents): boolean {
    return sender === this.window.webContents;
  }
}
