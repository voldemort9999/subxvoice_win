/**
 * The app mark: five waveform bars, the same glyph the sidebar draws (`renderer/src/shared/Mark.tsx`).
 *
 * Geometry and rasterising live here, with no Electron import, so the icon the installer ships
 * and the icon the running app draws come from one definition. `main/brand.ts` wraps this for
 * `nativeImage`; `scripts/build-icon.mjs` writes it out as the PNG electron-builder turns into
 * the .ico.
 */

/** Bar heights as a fraction of the box, measured from the centre out. */
export const BARS = [0.18, 0.46, 0.76, 0.38, 0.18];
export const BAR_WIDTH = 0.085;
export const BAR_GAP = 0.055;
const SUPERSAMPLE = 3;

/** Deep Aubergine — the plate. */
const PLATE = { r: 0x3a, g: 0x0f, b: 0x34 };
/** Ice Silver — the bars. */
const BAR = { r: 0xdd, g: 0xe3, b: 0xe8 };
/** Marigold — the tallest bar only, so the mark carries all three colours at 16px. */
const PEAK = { r: 0xea, g: 0xaa, b: 0x00 };
/** The tallest bar's index, which is the one that gets the accent. */
export const PEAK_BAR = BARS.indexOf(Math.max(...BARS));

/** Inside a bar, or inside the rounded square behind them. */
function shape(x: number, y: number): { bar: boolean; peak: boolean; plate: boolean } {
  const span = BARS.length * BAR_WIDTH + (BARS.length - 1) * BAR_GAP;
  let left = 0.5 - span / 2;
  let bar = false;
  let peak = false;
  for (const [index, height] of BARS.entries()) {
    if (x >= left && x <= left + BAR_WIDTH) {
      const half = height / 2;
      // Rounded caps: the bar is a stadium, so the ends are circles of the bar's own radius.
      const radius = BAR_WIDTH / 2;
      const cx = left + radius;
      const top = 0.5 - half + radius;
      const bottom = 0.5 + half - radius;
      bar =
        (y >= top && y <= bottom) ||
        Math.hypot(x - cx, y - top) <= radius ||
        Math.hypot(x - cx, y - bottom) <= radius;
      if (bar) {
        peak = index === PEAK_BAR;
        break;
      }
    }
    left += BAR_WIDTH + BAR_GAP;
  }

  // Squircle-ish plate: a square with corners rounded at a quarter of its side.
  const inset = 0.06;
  const radius = 0.22;
  const min = inset;
  const max = 1 - inset;
  const dx = Math.max(min + radius - x, 0, x - (max - radius));
  const dy = Math.max(min + radius - y, 0, y - (max - radius));
  const plate = x >= min && x <= max && y >= min && y <= max && Math.hypot(dx, dy) <= radius;

  return { bar, peak, plate };
}

/**
 * Straight RGBA, premultiplied alpha, row-major — what PNG wants. Electron's `createFromBitmap`
 * wants the same bytes in BGRA order, which is one swap away.
 *
 * Uint8Array rather than Buffer: this file is typechecked against the renderer too, which has no
 * Node globals.
 */
export function rasterizeMark(size: number): Uint8Array {
  const buffer = new Uint8Array(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let barHits = 0;
      let peakHits = 0;
      let plateHits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          const hit = shape(x, y);
          if (hit.bar) {
            barHits++;
            if (hit.peak) peakHits++;
          } else if (hit.plate) plateHits++;
        }
      }
      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const bar = barHits / samples;
      const peak = peakHits / samples;
      const quiet = bar - peak;
      const plate = plateHits / samples;
      const offset = (py * size + px) * 4;

      // Bars sit on top of the plate, and the tallest of them carries the accent.
      buffer[offset] = quiet * BAR.r + peak * PEAK.r + plate * PLATE.r;
      buffer[offset + 1] = quiet * BAR.g + peak * PEAK.g + plate * PLATE.g;
      buffer[offset + 2] = quiet * BAR.b + peak * PEAK.b + plate * PLATE.b;
      buffer[offset + 3] = 255 * Math.min(1, bar + plate);
    }
  }
  return buffer;
}
