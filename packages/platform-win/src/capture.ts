import type { Rect, ScreenCapture, Shot } from "@subx/core";
import type { WindowInfo } from "./commands";
import type { PowerShellWorker } from "./powershell";
import { chooseWindow } from "./screen";

/**
 * Screenshots for the assistant's pixel tools (CmdCapture in interop.ts does the pixels). The
 * mapping follows Anthropic's computer-use demo (`computer_use_demo/tools/computer.py`): the model
 * works in the scaled image's coordinates, a point off the image is an error rather than a guess,
 * and zoom fits the region into the screenshot's frame. The down-only scaling with one recorded
 * frame follows CursorTouch Windows-MCP (`desktop/service.py`). What is ours: x and y map back
 * separately (one rounded scale factor put a 4K display's centre a pixel off), and the display is
 * the one the target window is on, captured per-monitor DPI aware in physical pixels.
 */

export interface Limits {
  maxLongEdge: number;
  maxPixels: number;
}

/**
 * 1568 px long edge and ~1.15 MP are where Anthropic's vision API starts shrinking images by
 * itself. Staying under both means no provider rescales the picture behind our back, which would
 * put every click off by that factor; small text is what `zoom` is for.
 */
export const DEFAULT_LIMITS: Limits = { maxLongEdge: 1568, maxPixels: 1_150_000 };

/** The image size for a capture: scaled down to fit both limits, never up. */
export function fitSize(width: number, height: number, limits: Limits = DEFAULT_LIMITS) {
  const scale = Math.min(
    1,
    limits.maxLongEdge / Math.max(width, height),
    Math.sqrt(limits.maxPixels / (width * height)),
  );
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** A zoom's image: the region blown up to fill the screenshot's frame, its aspect ratio kept. */
export function fitInto(width: number, height: number, frameWidth: number, frameHeight: number) {
  const scale = Math.min(frameWidth / width, frameHeight / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

interface Frame {
  display: Rect;
  width: number;
  height: number;
}

/**
 * A point in the frame's image → physical virtual-desktop pixels. A model's (x, y) names an image
 * pixel, and one image pixel covers several physical ones (~1.79 on a 2560-wide display shot at
 * 1430), so the click goes to the middle of what it covers: mapping the pixel's corner, then
 * rounding, put it up to a physical pixel up-left and sometimes onto the neighbour's (demo hand
 * test, 2026-11-19: Start missed by a pixel or two). Fractions are taken as they come — a 0–1000
 * grid's point arrives unrounded (screen.ts onScale) — so there is no second rounding.
 */
export function toPhysical(frame: Frame, x: number, y: number): [number, number] {
  if (
    !(
      Math.round(x) >= 0 &&
      Math.round(y) >= 0 &&
      Math.round(x) <= frame.width &&
      Math.round(y) <= frame.height
    )
  )
    throw new Error(`(${x}, ${y}) is outside the ${frame.width}x${frame.height} screenshot`);
  const px = frame.display.x + Math.floor(((Math.max(x, 0) + 0.5) * frame.display.width) / frame.width);
  const py = frame.display.y + Math.floor(((Math.max(y, 0) + 0.5) * frame.display.height) / frame.height);
  // A point on the image's far edge (x == width) is allowed — models round to it — but a click
  // must stay on this display: display.x + display.width is the next monitor's first pixel.
  return [
    Math.min(px, frame.display.x + frame.display.width - 1),
    Math.min(py, frame.display.y + frame.display.height - 1),
  ];
}

/** The plain mapping; a region's far corner is exclusive, so it may be the display's edge. */
function edgeToPhysical(frame: Frame, x: number, y: number): [number, number] {
  return [
    frame.display.x + Math.round((x * frame.display.width) / frame.width),
    frame.display.y + Math.round((y * frame.display.height) / frame.height),
  ];
}

/** Physical pixels → the frame's image; outside it when the point is on another display. */
export function toShot(frame: Frame, x: number, y: number): [number, number] {
  return [
    Math.round(((x - frame.display.x) * frame.width) / frame.display.width),
    Math.round(((y - frame.display.y) * frame.height) / frame.display.height),
  ];
}

/** [x0, y0, x1, y1] in the frame's image → the physical rectangle it covers. */
export function regionToPhysical(frame: Frame, region: [number, number, number, number]): Rect {
  const [x0, y0, x1, y1] = region;
  if (!(x1 > x0)) throw new Error(`zoom region ${JSON.stringify(region)} needs x0 < x1`);
  if (!(y1 > y0)) throw new Error(`zoom region ${JSON.stringify(region)} needs y0 < y1`);
  // Corners are edges, not pixels: toPhysical only checks bounds here, the edges map plainly.
  toPhysical(frame, x0, y0);
  toPhysical(frame, x1, y1); // the far corner itself is exclusive, so unclamped
  const [left, top] = edgeToPhysical(frame, Math.round(x0), Math.round(y0));
  const [right, bottom] = edgeToPhysical(frame, Math.round(x1), Math.round(y1));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

interface Grabbed {
  data: string;
  mimeType: Shot["mimeType"];
  redacted: number;
}

export class WinScreenCapture implements ScreenCapture {
  private frame: Frame | null = null;

  constructor(
    private readonly worker: PowerShellWorker,
    private readonly deps: { windows(): Promise<WindowInfo[]> },
    private readonly limits: Limits = DEFAULT_LIMITS,
  ) {}

  async screenshot(opts: { windowHint?: string } = {}): Promise<Shot> {
    let handle = 0; // 0 = the display under the foreground window
    if (opts.windowHint) {
      const { window, named } = chooseWindow(opts.windowHint, await this.deps.windows());
      if (named && window) handle = window.handle;
    }
    return this.ofWindow(handle);
  }

  /** The display a known window is on (0: the foreground's). The classic screen step's picture. */
  async ofWindow(handle: number): Promise<Shot> {
    const display = await this.worker.json<Rect>(`[CmdCapture]::Display(${handle})`);
    const size = fitSize(display.width, display.height, this.limits);
    const shot = await this.grab(display, size);
    this.frame = { display, width: shot.width, height: shot.height };
    return shot;
  }

  async zoom(region: [number, number, number, number]): Promise<Shot> {
    const frame = this.current();
    const area = regionToPhysical(frame, region);
    return this.grab(area, fitInto(area.width, area.height, frame.width, frame.height));
  }

  toPhysical(x: number, y: number): [number, number] {
    return toPhysical(this.current(), x, y);
  }

  toShot(x: number, y: number): [number, number] {
    return toShot(this.current(), x, y);
  }

  frameSize(): [number, number] {
    const { width, height } = this.current();
    return [width, height];
  }

  private current(): Frame {
    if (!this.frame) throw new Error("Take a screenshot first: coordinates are read in the last screenshot");
    return this.frame;
  }

  private async grab(area: Rect, size: { width: number; height: number }): Promise<Shot> {
    const grabbed = await this.worker.json<Grabbed>(
      `[CmdCapture]::Grab(${area.x}, ${area.y}, ${area.width}, ${area.height}, ${size.width}, ${size.height})`,
    );
    return { ...grabbed, ...size, scale: size.width / area.width, display: area };
  }
}
