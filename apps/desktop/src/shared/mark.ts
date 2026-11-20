/**
 * The SUBXVoice mark: the X of SUBX, drawn as a straight line (the text, cream) crossed by a sound
 * wave (the voice, ultramarine). Voice becoming text, in one letter (user's pick, 2026-11-19).
 *
 * Geometry, the SVG and the rasteriser live here, with no Electron import, so every copy of the
 * mark comes from one definition: the sidebar (`renderer/src/shared/Mark.tsx`), the Dock and menu
 * bar icons (`main/brand.ts`), the installer icon (`scripts/build-icon.mjs`) and the files in
 * `brand/` (`scripts/build-brand.mjs`).
 *
 * All sizes are in a unit box (0–1). The line runs top-left → bottom-right, the wave
 * bottom-left → top-right; the wave is drawn over the line where they cross.
 */

/** Soft black: the plate. */
export const PLATE = { r: 0x16, g: 0x14, b: 0x12 };
/** Butter cream: the line. */
export const CREAM = { r: 0xf2, g: 0xe8, b: 0xc8 };
/** Ultramarine, lifted to read on soft black: the wave. */
export const BLUE = { r: 0x6b, g: 0x7c, b: 0xff };
export const HEX = { plate: "#161412", cream: "#f2e8c8", blue: "#6b7cff" } as const;

export interface Proportions {
  /** Half the length of each stroke, along its diagonal. */
  half: number;
  /** Stroke width. */
  stroke: number;
  /** Height of the wave either side of its centre line. */
  amp: number;
  /** Half-waves along the wave: 4 is two full cycles. */
  halves: number;
  /**
   * Fade the wave to nothing at both ends, so it starts and ends on its diagonal. Small and in one
   * colour, untapered ends curl off the diagonal and read as hooks.
   */
  taper?: boolean;
}

/** On the plate (app icon, sidebar): room around the X, the wave clearly a wave. */
export const ON_PLATE: Proportions = { half: 0.33, stroke: 0.075, amp: 0.075, halves: 4 };
/** Alone and small (favicon, the one-colour files): bolder strokes, one cycle fewer, filling the box. */
export const ALONE: Proportions = { half: 0.42, stroke: 0.13, amp: 0.085, halves: 3 };
/**
 * The menu bar, one colour at 18 pt beside the system's own icons: their thin strokes, and the
 * wave tapered, so it reads as one S across the line rather than a line with hooks.
 */
export const MENU_BAR: Proportions = { half: 0.4, stroke: 0.095, amp: 0.07, halves: 4, taper: true };

const C = Math.SQRT1_2; // cos 45° = sin 45°

/** The wave's offset from its centre line at position u along it, and its slope there. */
function wave(u: number, p: Proportions): { v: number; slope: number } {
  const k = (Math.PI * p.halves) / (2 * p.half);
  const phase = k * (u + p.half);
  if (!p.taper) return { v: -p.amp * Math.sin(phase), slope: -p.amp * k * Math.cos(phase) };
  const q = Math.PI / (2 * p.half);
  const envelope = Math.sin(q * (u + p.half));
  const rise = q * Math.cos(q * (u + p.half));
  return {
    v: -p.amp * envelope * Math.sin(phase),
    slope: -p.amp * (rise * Math.sin(phase) + envelope * k * Math.cos(phase)),
  };
}

/** Points along the wave in box coordinates, for the SVG path. */
export function wavePoints(p: Proportions, steps = 96): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const u = -p.half + (2 * p.half * i) / steps;
    const { v } = wave(u, p);
    // The wave's frame is the bottom-left → top-right diagonal.
    points.push([0.5 + (u + v) * C, 0.5 + (v - u) * C]);
  }
  return points;
}

/** The line's two ends in box coordinates. */
export function lineEnds(p: Proportions): [[number, number], [number, number]] {
  const d = p.half * C;
  return [
    [0.5 - d, 0.5 - d],
    [0.5 + d, 0.5 + d],
  ];
}

/** Squircle-ish plate: a square inset 6%, corners rounded at 22% (the macOS icon shape). */
export const PLATE_BOX = { inset: 0.06, radius: 0.22 };

function onPlate(x: number, y: number): boolean {
  const { inset, radius } = PLATE_BOX;
  const min = inset;
  const max = 1 - inset;
  const dx = Math.max(min + radius - x, 0, x - (max - radius));
  const dy = Math.max(min + radius - y, 0, y - (max - radius));
  return x >= min && x <= max && y >= min && y <= max && Math.hypot(dx, dy) <= radius;
}

/** Which stroke covers a point, the wave winning where they cross. */
function strokeAt(x: number, y: number, p: Proportions): "wave" | "line" | null {
  const dx = x - 0.5;
  const dy = y - 0.5;
  const r = p.stroke / 2;
  // Wave frame: u along bottom-left → top-right, v across it.
  const uw = (dx - dy) * C;
  const vw = (dx + dy) * C;
  let toWave: number;
  if (Math.abs(uw) <= p.half) {
    const { v, slope } = wave(uw, p);
    // Distance across a curve, from its vertical gap and slope: exact enough for a stroke this thin.
    toWave = Math.abs(vw - v) / Math.sqrt(1 + slope * slope);
  } else toWave = Math.hypot(Math.abs(uw) - p.half, vw); // round caps
  if (toWave <= r) return "wave";
  // Line frame: u along top-left → bottom-right.
  const ul = (dx + dy) * C;
  const vl = (dy - dx) * C;
  if (Math.abs(ul) <= p.half ? Math.abs(vl) <= r : Math.hypot(Math.abs(ul) - p.half, vl) <= r) return "line";
  return null;
}

export interface MarkOptions {
  /** The soft-black plate behind the X. The Mac menu bar wants the X alone. */
  plate: boolean;
  /** Without a plate: one flat grey for both strokes (0 black … 255 white), for the menu bar. */
  shade?: number;
  /** Other proportions than the plate's or ALONE (the menu bar's). */
  proportions?: Proportions;
}

const SUPERSAMPLE = 3;

/**
 * Straight RGBA, row-major: what PNG wants. Electron's `createFromBitmap` wants the same bytes in
 * BGRA order, which is one swap away.
 *
 * Uint8Array rather than Buffer: this file is typechecked against the renderer too, which has no
 * Node globals.
 */
export function rasterizeMark(size: number, options: MarkOptions): Uint8Array {
  const buffer = new Uint8Array(size * size * 4);
  const p = options.proportions ?? (options.plate ? ON_PLATE : ALONE);
  const shade = options.shade ?? 255;
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let waveHits = 0;
      let lineHits = 0;
      let plateHits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          const hit = strokeAt(x, y, p);
          if (hit === "wave") waveHits++;
          else if (hit === "line") lineHits++;
          else if (options.plate && onPlate(x, y)) plateHits++;
        }
      }
      const wave = waveHits / samples;
      const line = lineHits / samples;
      const plate = plateHits / samples;
      const offset = (py * size + px) * 4;
      if (options.plate) {
        buffer[offset] = wave * BLUE.r + line * CREAM.r + plate * PLATE.r;
        buffer[offset + 1] = wave * BLUE.g + line * CREAM.g + plate * PLATE.g;
        buffer[offset + 2] = wave * BLUE.b + line * CREAM.b + plate * PLATE.b;
        buffer[offset + 3] = 255 * Math.min(1, wave + line + plate);
      } else {
        // Menu bar: one flat colour, because the system tints a template image anyway.
        buffer[offset] = shade;
        buffer[offset + 1] = shade;
        buffer[offset + 2] = shade;
        buffer[offset + 3] = 255 * Math.min(1, wave + line);
      }
    }
  }
  return buffer;
}

const n = (value: number, unit: number) => +(value * unit).toFixed(2);

/**
 * The mark as an SVG document, `size` units square. `plate`: on the soft-black squircle. Without
 * it the strokes keep their colours, or take `mono` (any CSS colour) for single-colour use.
 */
export function markSvg(options: { plate: boolean; mono?: string; size?: number }): string {
  const unit = options.size ?? 1024;
  const p = options.plate ? ON_PLATE : ALONE;
  const cream = options.mono ?? HEX.cream;
  const blue = options.mono ?? HEX.blue;
  const [[x1, y1], [x2, y2]] = lineEnds(p);
  const d = wavePoints(p)
    .map(([x, y], i) => `${i ? "L" : "M"}${n(x, unit)} ${n(y, unit)}`)
    .join(" ");
  const { inset, radius } = PLATE_BOX;
  const plate = options.plate
    ? `<rect x="${n(inset, unit)}" y="${n(inset, unit)}" width="${n(1 - 2 * inset, unit)}" height="${n(1 - 2 * inset, unit)}" rx="${n(radius, unit)}" fill="${HEX.plate}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${unit} ${unit}" width="${unit}" height="${unit}" role="img" aria-label="SUBXVoice"><title>SUBXVoice</title>${plate}<line x1="${n(x1, unit)}" y1="${n(y1, unit)}" x2="${n(x2, unit)}" y2="${n(y2, unit)}" stroke="${cream}" stroke-width="${n(p.stroke, unit)}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${blue}" stroke-width="${n(p.stroke, unit)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/**
 * The mark's motion (option 8 of the logo study): a wave and, below it, a blinking underscore
 * where the words are about to land. Used where SUBXVoice is working (the pill while it writes,
 * the launch screen), so the logo and its movement read as one brand.
 */
export const MOTION = {
  wave: { from: 0.14, to: 0.86, y: 0.42, amp: 0.11, halves: 4 },
  underscore: { from: 0.56, to: 0.84, y: 0.72 },
  stroke: 0.08,
} as const;

/** The motion's wave as an SVG path in a `unit`-sized box. */
export function motionWavePath(unit: number): string {
  const { from, to, y, amp, halves } = MOTION.wave;
  const steps = 96;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const x = from + ((to - from) * i) / steps;
    const v = -amp * Math.sin((Math.PI * halves * (x - from)) / (to - from));
    d += `${i ? "L" : "M"}${n(x, unit)} ${n(y + v, unit)} `;
  }
  return d.trim();
}

/** The motion as an SVG document; `animated` adds SMIL so the file moves on its own. */
export function motionSvg(options: { plate: boolean; animated: boolean; size?: number }): string {
  const unit = options.size ?? 1024;
  const { inset, radius } = PLATE_BOX;
  const plate = options.plate
    ? `<rect x="${n(inset, unit)}" y="${n(inset, unit)}" width="${n(1 - 2 * inset, unit)}" height="${n(1 - 2 * inset, unit)}" rx="${n(radius, unit)}" fill="${HEX.plate}"/>`
    : "";
  const s = n(MOTION.stroke, unit);
  const { from, to, y } = MOTION.underscore;
  const breathe = options.animated
    ? `<animateTransform attributeName="transform" type="matrix" dur="1.3s" repeatCount="indefinite" values="1 0 0 1 0 0;1 0 0 0.5 0 ${n(MOTION.wave.y * 0.5, unit)};1 0 0 1 0 0"/>`
    : "";
  const blink = options.animated
    ? `<animate attributeName="opacity" values="1;0.12" dur="1.1s" calcMode="discrete" repeatCount="indefinite"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${unit} ${unit}" width="${unit}" height="${unit}" role="img" aria-label="SUBXVoice is working"><title>SUBXVoice is working</title>${plate}<g><path d="${motionWavePath(unit)}" fill="none" stroke="${HEX.blue}" stroke-width="${s}" stroke-linecap="round" stroke-linejoin="round"/>${breathe}</g><line x1="${n(from, unit)}" y1="${n(y, unit)}" x2="${n(to, unit)}" y2="${n(y, unit)}" stroke="${HEX.cream}" stroke-width="${s}" stroke-linecap="round">${blink}</line></svg>`;
}
