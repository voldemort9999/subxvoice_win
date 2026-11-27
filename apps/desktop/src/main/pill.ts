import type { ClickCatcher } from "@subx/core";
import { BrowserWindow, type Menu, type Rectangle, screen, type WebContents } from "electron";
import { IPC, type MicCommand, type PillState } from "../shared/ipc";
import { alignment, nearestPlace, PILL_PLACES, type PillPlace, pillZoom } from "../shared/pill-place";
import { DropTargets, type Spot } from "./drop-targets";
import { loadPage, PRELOAD_PATH } from "./renderer";

/** Wide enough for the hands-free timer, the wave and the newest words side by side. */
const WIDTH = 400;
/** Room for the larger message pill (44 px) and its shadow. */
const HEIGHT = 72;
const BOTTOM_GAP = 8;
/** Below the menu bar, and clear of the notch's height on the Macs that have one. */
const TOP_GAP = 4;
const SIDE_GAP = 8;
/** How often the window follows the pointer while dragged: once a frame. */
const DRAG_FRAME_MS = 16;
/** A drag whose mouse-up never arrives (the pointer left every window) ends on its own. */
const DRAG_LIMIT_MS = 15_000;
/** Less movement than this is a click, not a drag. */
const DRAG_THRESHOLD_PX = 4;
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
  private idleVisible = true;
  private screenLocked = false;
  private position: PillPlace = "bottom";
  private press: {
    timer: NodeJS.Timeout;
    started: number;
    from: { x: number; y: number };
    dx: number;
    dy: number;
    dragging: boolean;
  } | null = null;
  private readonly targets = new DropTargets();
  /** Catches the pill's clicks before any app sees them, when this Mac allows it. */
  private catcher: ClickCatcher | null = null;
  private catching = false;
  /** The pointer as the click catcher last reported it during a press; trusted over a poll. */
  private reported: { x: number; y: number } | null = null;
  /** The pill's drawn size, from the page. */
  private size: { width: number; height: number } | null = null;
  private kind: PillState["kind"] = "idle";
  /** The pill says the microphone gave only silence: a click opens its check. */
  private micCheck = false;
  /** The words that had nowhere to go, for the pill's Copy; never from a demo. */
  private unplaced = "";
  /** The words the pill is announcing, so Undo takes out exactly those. */
  private learned: string[] = [];

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
      acceptFirstMouse: true,
      // A non-activating panel on macOS: showing it never steals focus.
      type: "panel",
      // Out of the way in Mission Control, as other apps' pills are: it floats over every desktop,
      // and at its level macOS would otherwise draw it on top of the desktops overview (user,
      // 2026-11-19). The level stays, because a lower one fell behind full-screen apps.
      hiddenInMissionControl: true,
      webPreferences: {
        preload: PRELOAD_PATH,
        sandbox: true,
        contextIsolation: true,
        // Keep audio and timers running while the window is not focused.
        backgroundThrottling: false,
      },
    });
    this.window.setAlwaysOnTop(true, "screen-saver");
    // skipTransformProcessType: without it Electron turns the whole app into a background helper
    // (no Dock icon, not in ⌘-Tab) to get the pill over full-screen apps, and the main window then
    // stayed in front of every other app's windows when they were clicked (user, 2026-11-19). The
    // pill is an NSPanel at screen-saver level, which floats over full-screen apps without that.
    this.window.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    this.setHover(false);
    // The pill is the only thing on screen while dictating. A dead renderer leaves the window in place, still reporting isVisible(),
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
    // A reload starts at zoom 1 again.
    this.window.webContents.on("did-finish-load", () => this.window.webContents.setZoomFactor(this.zoom));
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
    // Topmost can be lost: a fullscreen app or a foreground steal can drop it, and then the pill is
    // behind the window the user is typing into.
    this.window.setAlwaysOnTop(true, "screen-saver");
    this.reposition();
    if (this.window.webContents.isCrashed()) {
      this.reloads = 0;
      this.recover();
    }
    if (!this.window.isVisible() && this.shouldShow()) this.window.showInactive();
  }

  /** A corner or the middle of an edge (Settings → Sound and pill, or dragged there). */
  setPosition(position: PillPlace): void {
    if (position === this.position) return;
    this.position = position;
    this.reposition();
  }

  /** Whether the pill stays on screen between dictations (Settings → System). */
  setIdleVisible(visible: boolean): void {
    this.idleVisible = visible;
    if (this.window.isDestroyed()) return;
    if (this.shouldShow()) this.reveal();
    else this.window.hide();
    this.updateArea();
  }

  private shouldShow(): boolean {
    if (this.screenLocked) return false;
    return this.idleVisible || this.kind !== "idle";
  }

  /** Off the lock screen entirely: nothing of the user's floats over it. */
  setScreenLocked(locked: boolean): void {
    this.screenLocked = locked;
    if (this.window.isDestroyed()) return;
    if (this.shouldShow()) this.reveal();
    else this.window.hide();
    this.updateArea();
  }

  private reveal(): void {
    if (this.window.isDestroyed() || this.window.isVisible() || !this.shouldShow()) return;
    this.reposition();
    this.window.showInactive();
  }

  /** At its place on whichever screen the mouse is on. Bound: `screen` events call it. */
  readonly reposition = (): void => {
    if (this.window.isDestroyed() || this.press?.dragging) return;
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const rect = placeRect(this.position, workArea);
    this.window.setPosition(rect.x, rect.y);
    this.scaleFor(workArea.width);
    this.updateArea();
  };

  /** How much the pill is drawn down on this screen (`pillZoom`); kept for the click area. */
  private zoom = 1;

  private scaleFor(workAreaWidth: number): void {
    const zoom = pillZoom(workAreaWidth);
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    this.window.webContents.setZoomFactor(zoom);
  }

  /**
   * The mouse went down on the pill. Whether this is a click or a drag is decided here, from where
   * the mouse really is, not by the page: a drag that the page mistook for a click opened the main
   * window every time the user tried to move the pill (user, 2026-11-19). Polled once a frame,
   * because the window is small and a quick drag leaves it before the page hears another move.
   */
  pressed(): void {
    if (this.window.isDestroyed() || this.press) return;
    this.reported = null;
    const pointer = screen.getCursorScreenPoint();
    const [x = 0, y = 0] = this.window.getPosition();
    const press = {
      timer: setInterval(() => this.follow(), DRAG_FRAME_MS),
      started: Date.now(),
      from: pointer,
      dx: pointer.x - x,
      dy: pointer.y - y,
      dragging: false,
    };
    this.press = press;
  }

  /**
   * The mouse came up. A press that never moved is a click (the caller acts on it); a drag
   * settles on the nearest corner or edge and returns that place.
   */
  released(): { click: true } | { click: false; place: PillPlace } | null {
    const press = this.press;
    if (!press || this.window.isDestroyed()) return null;
    clearInterval(press.timer);
    this.press = null;
    const reported = this.reported;
    this.reported = null;
    // The pill is no longer under a hand that let go somewhere else: stop catching clicks.
    this.setHover(false);
    this.window.webContents.send(IPC.pillHoverReset);
    if (!press.dragging) return { click: true };
    this.targets.hide();
    // Where the hand let go, not the window's middle: the window is wider than the pill, and near a
    // second screen its middle can be on the other one.
    this.position = this.placeUnder(reported ?? screen.getCursorScreenPoint());
    this.reposition();
    return { click: false, place: this.position };
  }

  /** Never lets a drag problem become an error dialog: the pill just stays where it was. */
  private follow(): void {
    try {
      this.followPointer();
    } catch (error) {
      console.error("pill drag:", error);
    }
  }

  private followPointer(): void {
    const press = this.press;
    if (!press || this.window.isDestroyed()) return;
    // A mouse-up that never arrived (the pointer left every window of ours) ends it on its own.
    if (Date.now() - press.started > DRAG_LIMIT_MS) {
      this.released();
      return;
    }
    const now = this.reported ?? screen.getCursorScreenPoint();
    if (!press.dragging) {
      if (Math.hypot(now.x - press.from.x, now.y - press.from.y) < DRAG_THRESHOLD_PX) return;
      press.dragging = true;
    }
    this.window.setPosition(Math.round(now.x - press.dx), Math.round(now.y - press.dy));
    // The places it can land, on the screen the pointer is on, the nearest lit.
    const display = screen.getDisplayNearestPoint(now);
    const area = display.workArea;
    const spots: Spot[] = PILL_PLACES.map((place) => {
      const anchor = pillAnchor(place, area);
      return { place, x: anchor.x - area.x, y: anchor.y - area.y };
    });
    this.targets.show(area, spots, this.placeUnder(now)).catch(() => {});
  }

  private placeUnder(pointer: { x: number; y: number }): PillPlace {
    const { workArea } = screen.getDisplayNearestPoint(pointer);
    return nearestPlace(
      (pointer.x - workArea.x) / workArea.width,
      (pointer.y - workArea.y) / workArea.height,
    );
  }

  /**
   * While the pointer is over the pill, accept clicks; otherwise let them pass through. With a
   * click catcher the window never takes clicks at all (they would activate the app); the catcher
   * reports them instead, and the page still hears the pointer move for hover.
   */
  setHover(inside: boolean): void {
    if (this.window.isDestroyed()) return;
    this.window.setIgnoreMouseEvents(this.catching || !inside, { forward: true });
  }

  attachClickCatcher(catcher: ClickCatcher): void {
    this.catcher = catcher;
    catcher.onMove((point) => {
      if (!this.press) return;
      // Electron's screen calls throw on fractional points, and trackpads report fractions: the
      // "JavaScript error" popup mid-drag (user, 2026-11-19).
      this.reported = { x: Math.round(point.x), y: Math.round(point.y) };
      this.follow();
    });
    this.updateArea();
  }

  /** The page says how big it drew the pill (it grows on hover and while speaking). */
  setSize(size: { width: number; height: number }): void {
    this.size = size;
    this.updateArea();
  }

  /** Tells the catcher where the pill is on screen now, or that it is hidden. */
  private updateArea(): void {
    const catcher = this.catcher;
    if (!catcher || this.window.isDestroyed() || this.press) return;
    const [x = 0, y = 0] = this.window.getPosition();
    // The page measures in its own (zoomed) pixels; the window and screen are in unzoomed ones.
    const z = this.zoom;
    const size = this.size && { width: this.size.width * z, height: this.size.height * z };
    let area: { x: number; y: number; width: number; height: number } | null = null;
    if (size && this.window.isVisible()) {
      // Where the page lays the pill out in its window: against the edge of its corner, 8 px in.
      const { horizontal, vertical } = alignment(this.position);
      const inset = 8 * z;
      const left =
        horizontal === "start"
          ? inset
          : horizontal === "end"
            ? WIDTH - inset - size.width
            : (WIDTH - size.width) / 2;
      const top =
        vertical === "start"
          ? inset
          : vertical === "end"
            ? HEIGHT - inset - size.height
            : (HEIGHT - size.height) / 2;
      area = { x: x + left, y: y + top, width: size.width, height: size.height };
    }
    void catcher.setArea(area).then((caught) => {
      if (this.window.isDestroyed() || (area === null && !caught)) return;
      this.catching = caught;
      if (caught) this.window.setIgnoreMouseEvents(true, { forward: true });
    });
  }

  /** `demo`: a made-up state from Settings, whose Undo must not touch the real dictionary. */
  setState(state: PillState, demo = false): void {
    this.kind = state.kind;
    this.learned = state.kind === "learned" && !demo ? state.words : [];
    this.unplaced = state.kind === "unplaced" && !demo ? state.text : "";
    this.micCheck = state.kind === "error" && state.micCheck === true;
    if (this.window.isDestroyed()) return;
    // A demo says so, so the pill moves its bars on a made-up voice (no microphone is on).
    this.window.webContents.send(IPC.pillState, demo ? { ...state, demo: true } : state);
    if (this.shouldShow()) this.reveal();
    else this.window.hide();
    this.updateArea();
  }

  /** Loudness (0–1) of the latest chunk, for the waveform. */
  level(value: number): void {
    this.window.webContents.send(IPC.pillLevel, value);
  }

  mic(command: MicCommand): void {
    this.window.webContents.send(IPC.micCommand, command);
  }

  currentKind(): PillState["kind"] {
    return this.kind;
  }

  /** The pill's own menu, opened at the pointer over it. */
  popup(menu: Menu): void {
    if (!this.window.isDestroyed()) menu.popup({ window: this.window });
  }

  showsMicCheck(): boolean {
    return this.micCheck;
  }

  unplacedText(): string {
    return this.unplaced;
  }

  learnedWords(): string[] {
    return this.learned;
  }

  owns(sender: WebContents): boolean {
    return sender === this.window.webContents;
  }
}

/** The pill window's rectangle at a place on a screen. */
function placeRect(place: PillPlace, area: Rectangle): { x: number; y: number } {
  const { horizontal, vertical } = alignment(place);
  const x =
    horizontal === "start"
      ? area.x + SIDE_GAP
      : horizontal === "end"
        ? area.x + area.width - WIDTH - SIDE_GAP
        : area.x + (area.width - WIDTH) / 2;
  const y =
    vertical === "start"
      ? area.y + TOP_GAP
      : vertical === "end"
        ? area.y + area.height - HEIGHT - BOTTOM_GAP
        : area.y + (area.height - HEIGHT) / 2;
  return { x: Math.round(x), y: Math.round(y) };
}

/** Where the pill itself (not its wider window) sits at a place: it hugs the window's edge there. */
function pillAnchor(place: PillPlace, area: Rectangle): { x: number; y: number } {
  const rect = placeRect(place, area);
  const { horizontal, vertical } = alignment(place);
  // The page's padding (8 px) plus half the idle pill (48 × 9 px), around the 6 px hit margin.
  const inset = { x: 8 + 8 + 24, y: 8 + 4 + 5 };
  return {
    x:
      horizontal === "start"
        ? rect.x + inset.x
        : horizontal === "end"
          ? rect.x + WIDTH - inset.x
          : rect.x + WIDTH / 2,
    y:
      vertical === "start"
        ? rect.y + inset.y
        : vertical === "end"
          ? rect.y + HEIGHT - inset.y
          : rect.y + HEIGHT / 2,
  };
}
