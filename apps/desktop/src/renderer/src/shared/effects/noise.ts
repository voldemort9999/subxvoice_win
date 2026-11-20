// Deterministic noise for the window's generated textures. Small on purpose: a value-noise field
// is all the contours and the character stage need, and a library would be more code than this.

/** A repeatable pseudo-random value in [0, 1) for an integer lattice point. */
export function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => t * t * (3 - 2 * t);

/** Smooth 3-D value noise in [0, 1). The third axis is time, so the field drifts without jumping. */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = ease(x - xi);
  const v = ease(y - yi);
  const w = ease(z - zi);
  const layer = (zz: number) =>
    mix(
      mix(hash3(xi, yi, zz), hash3(xi + 1, yi, zz), u),
      mix(hash3(xi, yi + 1, zz), hash3(xi + 1, yi + 1, zz), u),
      v,
    );
  return mix(layer(zi), layer(zi + 1), w);
}

/** A theme colour as "r g b", for canvas strokes: tokens are hex or already an "r g b" triplet. */
export function themeRgb(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).join(" ");
  return /^\d+ \d+ \d+$/.test(value) ? value : fallback;
}

export const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Sizes a canvas's backing store to its box at the screen's density; returns the scale. */
export function fitCanvas(canvas: HTMLCanvasElement): number {
  const box = canvas.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(box.width * scale));
  const height = Math.max(1, Math.round(box.height * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return scale;
}
