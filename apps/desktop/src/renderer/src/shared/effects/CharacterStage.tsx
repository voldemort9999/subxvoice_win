import { useEffect, useRef } from "react";
import { clamp01, prefersReducedMotion, themeRgb } from "./noise";

/**
 * The launch and sign-in stage: a field of characters on soft black, out of which a person in
 * profile resolves and speaks: ultramarine rings leave the mouth. In "launch" the name then forms
 * beside them, in characters too; in "ambient" (behind sign-in) the person stays, dimmer, and
 * speaks every few seconds, with the name formed under them when `named` (nothing else is there).
 *
 * Canvas, not DOM: a window of ~10 000 characters changing at 30 fps is one fillText each, which a
 * canvas does in a few milliseconds and the DOM cannot do at all.
 */
export type StageMode = "launch" | "ambient";

/** When the launch sequence's parts happen, in ms from the start. */
export const LAUNCH = { personFrom: 400, rings: 1500, nameFrom: 2300, nameOut: 3900, end: 4300 };

const SET = '!"#$%&()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_abcdefghijklmnopqrstuvwxyz{|}~';
const MONO = '"JetBrains Mono Variable", ui-monospace, monospace';
/** The chosen pair's display face, so the name on the launch stage matches the app. */
const display = () =>
  `${getComputedStyle(document.documentElement).getPropertyValue("--face-display").trim() || '"Funnel Display Variable"'}, system-ui, sans-serif`;

/** A head and shoulders in profile, facing right, in a unit box. The mouth is at (0.765, 0.575). */
const BUST =
  "M0.02 1 C0.04 0.86 0.14 0.8 0.26 0.77 C0.28 0.7 0.27 0.64 0.24 0.58 C0.12 0.5 0.1 0.3 0.2 0.17 " +
  "C0.3 0.04 0.52 0 0.64 0.08 C0.72 0.13 0.74 0.22 0.73 0.28 L0.74 0.31 C0.75 0.34 0.76 0.37 0.79 0.42 " +
  "L0.82 0.46 C0.8 0.48 0.77 0.49 0.75 0.49 C0.76 0.51 0.77 0.53 0.76 0.55 C0.74 0.56 0.74 0.57 0.75 0.58 " +
  "C0.76 0.6 0.75 0.62 0.73 0.63 C0.73 0.66 0.72 0.69 0.68 0.71 C0.62 0.73 0.56 0.72 0.52 0.72 " +
  "C0.52 0.76 0.53 0.79 0.56 0.81 C0.7 0.85 0.8 0.9 0.84 1 Z";

interface Layout {
  width: number;
  height: number;
  cw: number;
  ch: number;
  cols: number;
  rows: number;
  glyph: Uint8Array;
  next: Float64Array;
  order: Float32Array;
  person: Float32Array;
  name: Float32Array;
  mouth: { x: number; y: number };
  reach: number;
}

/** `named`: the name sits under the person, so the person is drawn smaller to leave it room. */
function layout(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, named: boolean): Layout {
  const box = canvas.getBoundingClientRect();
  const width = Math.max(1, box.width);
  const height = Math.max(1, box.height);
  const k = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * k);
  canvas.height = Math.round(height * k);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const size = width < 600 ? 11 : 13;
  ctx.font = `${size}px ${MONO}`;
  const cw = ctx.measureText("M").width || size * 0.6;
  const ch = Math.round(size * 1.28);
  const cols = Math.ceil(width / cw);
  const rows = Math.ceil(height / ch);
  const count = cols * rows;

  const mask = document.createElement("canvas");
  mask.width = Math.ceil(width);
  mask.height = Math.ceil(height);
  const m = mask.getContext("2d", { willReadFrequently: true });
  const sample = () => {
    const out = new Float32Array(count);
    if (!m) return out;
    const data = m.getImageData(0, 0, mask.width, mask.height).data;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = Math.min(mask.width - 1, Math.floor((c + 0.5) * cw));
        const y = Math.min(mask.height - 1, Math.floor((r + 0.5) * ch));
        out[r * cols + c] = (data[(y * mask.width + x) * 4 + 3] ?? 0) / 255;
      }
    }
    return out;
  };

  const wide = width / height > 1.05;
  const s = wide
    ? Math.min(height * 0.76, width * 0.42)
    : Math.min(width * 0.72, height * (named ? 0.34 : 0.42));
  const x0 = width * (wide ? 0.29 : 0.4) - 0.45 * s;
  const y0 = wide ? height * 0.53 - 0.5 * s : height * (named ? 0.08 : 0.09);
  let person = new Float32Array(count);
  let name = new Float32Array(count);
  if (m) {
    m.fillStyle = "#fff";
    m.save();
    m.translate(x0, y0);
    m.scale(s, s);
    m.fill(new Path2D(BUST));
    m.restore();
    person = sample();
    m.clearRect(0, 0, mask.width, mask.height);
    m.textBaseline = "middle";
    if (wide) {
      const w = width * 0.42;
      m.font = `700 100px ${display()}`;
      const fitted = Math.min((100 * w) / m.measureText("SUBXVoice").width, s * 0.34);
      m.font = `700 ${fitted}px ${display()}`;
      m.fillText("SUBXVoice", width * 0.53, height * 0.53);
    } else {
      // Under the person there is only a column's width: the name on one line would be a few rows
      // of characters high and unreadable, so it is stacked, SUBX over Voice, each as big as fits.
      const w = width * 0.84;
      m.font = `700 100px ${display()}`;
      const widest = Math.max(m.measureText("SUBX").width, m.measureText("Voice").width);
      const room = height - (y0 + s) - height * 0.06;
      const fitted = Math.min((100 * w) / widest, room * 0.44);
      m.font = `800 ${fitted}px ${display()}`;
      // Fattened with an outline: a stroke one character thick vanishes into the field around it.
      m.strokeStyle = "#fff";
      m.lineWidth = fitted * 0.07;
      m.lineJoin = "round";
      const top = y0 + s + height * 0.04 + fitted * 0.55;
      for (const [word, y] of [
        ["SUBX", top],
        ["Voice", top + fitted * 0.95],
      ] as const) {
        m.fillText(word, width * 0.08, y);
        m.strokeText(word, width * 0.08, y);
      }
    }
    name = sample();
  }

  return {
    width,
    height,
    cw,
    ch,
    cols,
    rows,
    glyph: Uint8Array.from({ length: count }, () => Math.floor(Math.random() * SET.length)),
    next: new Float64Array(count),
    order: Float32Array.from({ length: count }, Math.random),
    person,
    name,
    mouth: { x: x0 + 0.765 * s, y: y0 + 0.575 * s },
    reach: wide ? width * 0.3 : width * 0.5,
  };
}

export function CharacterStage({
  mode,
  named = false,
  className = "",
}: {
  mode: StageMode;
  /** Ambient only: the name in characters under the person. */
  named?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = prefersReducedMotion();
    // The theme's stage colours, read once: the stage is up for seconds, not across a theme change.
    const CREAM = themeRgb("--stage-ink", "242 232 200");
    const ULTRA = themeRgb("--stage-accent", "107 124 255");
    let grid = layout(canvas, ctx, named);
    const start = performance.now();
    let last = 0;
    let frame = 0;
    const buckets: number[][] = Array.from({ length: 8 }, () => []);
    const fills = [0.1, 0.34, 0.55, 0.78, 0.98]
      .map((a) => `rgb(${CREAM} / ${a})`)
      .concat([0.5, 0.75, 1].map((a) => `rgb(${ULTRA} / ${a})`));

    const draw = (now: number) => {
      const g = grid;
      const t = still ? 1e6 : now - start;
      const launch = mode === "launch";
      const fieldIn = clamp01(t / 500);
      const personGain = launch ? 1 : 0.6 + 0.4 * clamp01(1 - t / 700);
      const nameGain = launch ? clamp01(1 - (t - LAUNCH.nameOut) / 400) : named ? 0.9 : 0;
      // Launch spells the name after the rings; ambient spells it as the stage appears.
      const nameFrom = launch ? LAUNCH.nameFrom : 300;
      // Three rings leave the mouth: once during launch, then every 3.2 s on the ambient stage.
      const ages = [0, 1, 2].map((j) => {
        if (launch) return t - LAUNCH.rings - j * 380;
        const since = t - 900 - j * 380;
        return since < 0 ? -1 : since % 3200;
      });
      for (const bucket of buckets) bucket.length = 0;

      for (let r = 0; r < g.rows; r++) {
        for (let c = 0; c < g.cols; c++) {
          const i = r * g.cols + c;
          const order = g.order[i] ?? 0;
          let lit = 0;
          let ring = 0;
          const p = g.person[i] ?? 0;
          if (p > 0)
            lit = p * personGain * (launch ? clamp01((t - LAUNCH.personFrom - order * 1300) / 260) : 1);
          const n = g.name[i] ?? 0;
          if (nameGain > 0 && n > 0)
            lit = Math.max(lit, n * nameGain * clamp01((t - nameFrom - order * 900) / 220));
          const dx = (c + 0.5) * g.cw - g.mouth.x;
          if (dx > 0) {
            const dy = (r + 0.5) * g.ch - g.mouth.y;
            const angle = Math.abs(Math.atan2(dy, dx));
            if (angle < 0.85) {
              const distance = Math.hypot(dx, dy);
              for (const age of ages) {
                if (age < 0) continue;
                const radius = age * 0.42;
                const fade = clamp01(1 - radius / g.reach);
                if (fade <= 0) continue;
                const e = (distance - radius) / (g.ch * 0.9);
                ring = Math.max(ring, Math.exp(-e * e) * fade * (1 - angle / 0.85));
              }
            }
          }
          const bright = ring > 0.22 || lit > 0.08;
          if (now > (g.next[i] ?? 0)) {
            g.glyph[i] = Math.floor(Math.random() * SET.length);
            g.next[i] = now + (bright ? 250 + Math.random() * 900 : 80 + Math.random() * 2200);
          }
          if (ring > 0.22) buckets[5 + (ring > 0.65 ? 2 : ring > 0.42 ? 1 : 0)]?.push(i);
          else if (lit > 0.08) buckets[1 + Math.min(3, Math.floor(lit * 4))]?.push(i);
          else if (fieldIn > 0) buckets[0]?.push(i);
        }
      }

      ctx.clearRect(0, 0, g.width, g.height);
      buckets.forEach((list, b) => {
        ctx.fillStyle = b === 0 ? `rgb(${CREAM} / ${0.1 * fieldIn})` : (fills[b] ?? "");
        for (const i of list) {
          ctx.fillText(
            SET[g.glyph[i] ?? 0] ?? "",
            (i % g.cols) * g.cw,
            Math.floor(i / g.cols) * g.ch + g.ch * 0.8,
          );
        }
      });
    };

    const tick = (now: number) => {
      if (now - last >= 33) {
        last = now;
        draw(now);
      }
      frame = requestAnimationFrame(tick);
    };
    let alive = true;
    const relayout = () => {
      if (!alive) return;
      grid = layout(canvas, ctx, named);
      draw(performance.now());
    };
    const observer = new ResizeObserver(relayout);
    observer.observe(canvas);
    // Canvas text does not wait for fonts, and bundled faces load only when first asked for: ask,
    // then lay the grid out again in them.
    void Promise.all([
      document.fonts.load(`13px ${MONO}`),
      document.fonts.load(`700 100px ${display()}`),
    ]).then(relayout, () => {});
    if (still) draw(performance.now());
    else frame = requestAnimationFrame(tick);
    return () => {
      alive = false;
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [mode, named]);

  return (
    <div className="h-full w-full" aria-hidden="true">
      <canvas ref={ref} className={`block h-full w-full ${className}`} />
    </div>
  );
}
