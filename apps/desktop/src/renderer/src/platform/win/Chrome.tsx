import { useEffect } from "react";

// Window chrome for Windows: the title bar is hidden and Windows draws only its own minimise /
// maximise / close over the app (main index.ts, titleBarOverlay), on the colour this page reports.

/** The height of Windows' caption buttons (main index.ts TITLE_BAR_HEIGHT). */
const BAR = 36;

/** A little air above the sidebar's first item; the strip above it is the title bar's. */
export function SidebarTop() {
  return <div className="h-1 shrink-0" />;
}

/** The strip the window is dragged by, over every screen; transparent, so each screen shows through. */
export function TitleStrip() {
  return <div className="pointer-events-none fixed inset-x-0 top-0 z-30 h-9 [-webkit-app-region:drag]" />;
}

/** Room for that strip at the top of the main layout, so nothing sits under the buttons. */
export function TitleSpace() {
  return <div className="h-9 shrink-0" />;
}

/** The strip drags the window; the header does not need to. */
export const TITLE_BAR_DRAG = "";

/**
 * Tells the window the colour behind its buttons: whatever the app draws in the top-right corner,
 * dimmed with it when Settings' panel is open. Checked after every render (cheap: one hit test), sent
 * only when it changes.
 */
let sent = "";
export function useWindowChrome(): void {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const color = colourAt(window.innerWidth - 70, BAR / 2);
      const [r, g, b] = color;
      const hex = `#${color.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
      const symbol = 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? "#1a1714" : "#f2e8c8";
      const key = hex + symbol;
      if (key === sent) return;
      sent = key;
      window.subx.app.chrome({ color: hex, symbol });
    });
    return () => cancelAnimationFrame(frame);
  });
}

/** The colour seen at a point: the first opaque background under it, with see-through ones laid over. */
function colourAt(x: number, y: number): [number, number, number] {
  const layers: [number, number, number, number][] = [];
  for (let node = document.elementFromPoint(x, y); node; node = node.parentElement) {
    const m =
      getComputedStyle(node)
        .backgroundColor.match(/[\d.]+/g)
        ?.map(Number) ?? [];
    const [r = 0, g = 0, b = 0, a = m.length > 3 ? (m[3] ?? 1) : 1] = m;
    if (a > 0) layers.push([r, g, b, a]);
    if (a >= 1) break;
  }
  let out: [number, number, number] = [15, 14, 13];
  for (const [r, g, b, a] of layers.reverse())
    out = [out[0] + (r - out[0]) * a, out[1] + (g - out[1]) * a, out[2] + (b - out[2]) * a];
  return out;
}

export function PermissionsIntro() {
  return (
    <p className="text-ink-soft">
      Windows asks for one permission: the microphone. If dictation hears nothing, turn on "Let desktop apps
      access your microphone" in Settings → Privacy &amp; security → Microphone.
    </p>
  );
}

export function HotkeyNote() {
  return (
    <p className="text-ink-soft">
      Ctrl + Win is the default. Whatever key you set works in every app, so pick one that no app you use
      needs.
    </p>
  );
}

export function MicrophoneNote() {
  return <p>The microphone turns on only while you hold the hotkey, and turns off as soon as you let go.</p>;
}

/** The window's own title bar over the page, in px: Settings' panel sits below it. */
export const BAR_PX = BAR;
