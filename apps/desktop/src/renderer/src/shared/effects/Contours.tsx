import { useEffect, useRef } from "react";
import { clamp01, fitCanvas, noise3, prefersReducedMotion, themeRgb } from "./noise";

/**
 * Topographic contour lines over a drifting noise field (marching squares), drawn in soft black
 * at a few percent, so the cream reads as a surveyed paper rather than a flat fill. Every fifth
 * line is heavier, as index contours are on survey maps.
 *
 * `animate` is for screens that are open briefly (sign-in); the dashboard draws once per resize,
 * because a window that sits open all day must not spend a frame loop on its background.
 */
export function Contours({
  animate = false,
  opacity = 0.06,
  peakX,
  peakY,
  className = "",
}: {
  animate?: boolean;
  opacity?: number;
  /** A summit, as fractions of the box, so the lines ring around somewhere deliberate. */
  peakX?: number;
  peakY?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const moving = animate && !prefersReducedMotion();
    // The page's own ink; a theme change remounts this (keyed by theme in the app shell).
    const ink = themeRgb("--ink", "22 20 18");
    const cell = 13;
    const scale = 1 / 280;
    let field = new Float32Array(0);
    let clock = 3.7;
    let last = 0;
    let frame = 0;

    const draw = () => {
      const k = fitCanvas(canvas);
      const width = canvas.width / k;
      const height = canvas.height / k;
      const cols = Math.ceil(width / cell) + 1;
      const rows = Math.ceil(height / cell) + 1;
      if (field.length !== cols * rows) field = new Float32Array(cols * rows);
      const summit =
        peakX !== undefined && peakY !== undefined
          ? { x: peakX * width, y: peakY * height, r: Math.min(width, height) * 0.28 }
          : undefined;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = i * cell;
          const y = j * cell;
          let value =
            noise3(x * scale, y * scale, clock) * 0.62 +
            noise3(x * scale * 2.3 + 31, y * scale * 2.3 + 17, clock * 1.4) * 0.3;
          if (summit) {
            const dx = x - summit.x;
            const dy = y - summit.y;
            value += 0.55 * Math.exp(-(dx * dx + dy * dy) / (2 * summit.r * summit.r));
          }
          field[j * cols + i] = value;
        }
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const minor = new Path2D();
      const index = new Path2D();
      const c = cell * k;
      const at = (i: number, j: number) => field[j * cols + i] ?? 0;
      for (let n = 0, level = 0.2; level < 1.15; level += 0.05, n++) {
        const path = n % 5 === 0 ? index : minor;
        for (let j = 0; j < rows - 1; j++) {
          for (let i = 0; i < cols - 1; i++) {
            const a = at(i, j);
            const b = at(i + 1, j);
            const cc = at(i + 1, j + 1);
            const d = at(i, j + 1);
            const id = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (cc > level ? 2 : 0) | (d > level ? 1 : 0);
            if (id === 0 || id === 15) continue;
            const x = i * c;
            const y = j * c;
            const top = (): [number, number] => [x + (c * (level - a)) / (b - a), y];
            const right = (): [number, number] => [x + c, y + (c * (level - b)) / (cc - b)];
            const bottom = (): [number, number] => [x + (c * (level - d)) / (cc - d), y + c];
            const left = (): [number, number] => [x, y + (c * (level - a)) / (d - a)];
            const seg = (p: [number, number], q: [number, number]) => {
              path.moveTo(p[0], p[1]);
              path.lineTo(q[0], q[1]);
            };
            if (id === 1 || id === 14) seg(left(), bottom());
            else if (id === 2 || id === 13) seg(bottom(), right());
            else if (id === 3 || id === 12) seg(left(), right());
            else if (id === 4 || id === 11) seg(top(), right());
            else if (id === 6 || id === 9) seg(top(), bottom());
            else if (id === 7 || id === 8) seg(top(), left());
            else if (id === 5) {
              seg(top(), left());
              seg(bottom(), right());
            } else {
              seg(top(), right());
              seg(left(), bottom());
            }
          }
        }
      }
      ctx.lineWidth = k;
      ctx.strokeStyle = `rgb(${ink} / ${opacity})`;
      ctx.stroke(minor);
      ctx.lineWidth = 1.6 * k;
      ctx.strokeStyle = `rgb(${ink} / ${clamp01(opacity * 2)})`;
      ctx.stroke(index);
    };

    const tick = (now: number) => {
      // ~20 fps is plenty for lines that move this slowly.
      if (now - last > 50) {
        clock += Math.min(now - last, 100) * 0.00004;
        last = now;
        draw();
      }
      frame = requestAnimationFrame(tick);
    };

    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    if (moving) frame = requestAnimationFrame(tick);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [animate, opacity, peakX, peakY]);

  return (
    <div className="h-full w-full" aria-hidden="true">
      <canvas ref={ref} className={`pointer-events-none block h-full w-full ${className}`} />
    </div>
  );
}
