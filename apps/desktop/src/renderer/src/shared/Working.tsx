import { MotionMark } from "./MotionMark";

/**
 * "Working on it", the same way everywhere: the mark's motion (the wave over a blinking underscore,
 * as in the pill and the launch) beside a few words. `onAccent` is for the ultramarine button,
 * where a blue wave would disappear.
 */
export function Working({ label, onAccent = false }: { label: string; onAccent?: boolean }) {
  return (
    <span className="inline-flex items-center justify-center gap-2" role="status">
      <MotionMark
        className="h-5 w-5 shrink-0"
        wave={onAccent ? "currentColor" : undefined}
        cursor="currentColor"
      />
      {label}
    </span>
  );
}
