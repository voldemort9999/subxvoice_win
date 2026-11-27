import { HEX, MOTION, motionWavePath } from "../../../shared/mark";

const WAVE = motionWavePath(1);

/**
 * The mark's motion: a wave breathing over a blinking underscore, the moment between speaking
 * and the words landing. Shown wherever SUBXVoice is working (the pill while it writes, the launch
 * screen). Geometry from `shared/mark.ts`, like the logo.
 */
export function MotionMark({
  className = "h-5 w-5",
  wave = HEX.blue,
  cursor = HEX.cream,
}: {
  className?: string;
  /** The wave's colour: blue, except on a blue button where it would vanish. */
  wave?: string;
  /** The underscore's colour: cream on soft black, ink on cream. */
  cursor?: string;
}) {
  const { from, to, y } = MOTION.underscore;
  return (
    <svg viewBox="0 0 1 1" className={className} aria-hidden="true">
      <path
        d={WAVE}
        fill="none"
        stroke={wave}
        strokeWidth={MOTION.stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transformBox: "view-box", transformOrigin: `50% ${MOTION.wave.y * 100}%` }}
        className="motion-mark-wave"
      />
      <line
        x1={from}
        y1={y}
        x2={to}
        y2={y}
        stroke={cursor}
        strokeWidth={MOTION.stroke}
        strokeLinecap="round"
        className="motion-mark-cursor"
      />
    </svg>
  );
}
