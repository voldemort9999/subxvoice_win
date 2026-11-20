import { HEX, lineEnds, ON_PLATE, PLATE_BOX, wavePoints } from "../../../shared/mark";

const [[X1, Y1], [X2, Y2]] = lineEnds(ON_PLATE);
const WAVE = wavePoints(ON_PLATE)
  .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(4)} ${y.toFixed(4)}`)
  .join(" ");

/**
 * The app mark, drawn from the same numbers as the Dock, menu-bar and installer icons
 * (`shared/mark.ts`), so the one in the sidebar cannot drift from the one in the Dock: the X of
 * SUBX as a cream line crossed by an ultramarine wave, on the soft-black plate. Fixed colours,
 * because it is a logo and not part of the theme.
 */
export function Mark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 1 1" className={className} aria-hidden="true">
      <rect
        x={PLATE_BOX.inset}
        y={PLATE_BOX.inset}
        width={1 - 2 * PLATE_BOX.inset}
        height={1 - 2 * PLATE_BOX.inset}
        rx={PLATE_BOX.radius}
        fill={HEX.plate}
      />
      <line
        x1={X1}
        y1={Y1}
        x2={X2}
        y2={Y2}
        stroke={HEX.cream}
        strokeWidth={ON_PLATE.stroke}
        strokeLinecap="round"
      />
      <path
        d={WAVE}
        fill="none"
        stroke={HEX.blue}
        strokeWidth={ON_PLATE.stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
