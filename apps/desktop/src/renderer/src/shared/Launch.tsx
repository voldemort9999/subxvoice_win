import { useCallback, useEffect, useState } from "react";
import type { AppInfo } from "../../../shared/ipc";
import { CharacterStage, LAUNCH } from "./effects/CharacterStage";
import { prefersReducedMotion } from "./effects/noise";
import { MotionMark } from "./MotionMark";

const SEEN_KEY = "subx.launch.seen";

/**
 * Whether to play the launch scene: once per run of the app. The main window is destroyed when it
 * closes and made again from the tray, so "once per window" would replay it every time someone
 * opens the dashboard; the run's start time, from the main process, tells the two apart.
 */
export function useLaunchScene(info: AppInfo | null): { show: boolean; done: () => void } {
  const [finished, setFinished] = useState(false);
  const run = info ? String(info.startedAt) : null;
  let seen = false;
  try {
    seen = run !== null && localStorage.getItem(SEEN_KEY) === run;
  } catch {
    // Storage refused: play it, which is the worst case.
  }
  // Stable, because the scene's timers are keyed on it and the app re-renders as data arrives.
  const done = useCallback(() => {
    setFinished(true);
    try {
      if (run) localStorage.setItem(SEEN_KEY, run);
    } catch {
      // Nothing to keep; it simply plays again next time.
    }
  }, [run]);
  return { show: run !== null && !seen && !finished && !prefersReducedMotion(), done };
}

/** The first thing a run of the app shows: the character stage, then it gets out of the way. */
export function Launch({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const out = setTimeout(() => setLeaving(true), LAUNCH.end - 300);
    const end = setTimeout(onDone, LAUNCH.end);
    const skip = () => onDone();
    window.addEventListener("keydown", skip);
    return () => {
      clearTimeout(out);
      clearTimeout(end);
      window.removeEventListener("keydown", skip);
    };
  }, [onDone]);

  return (
    <button
      type="button"
      onClick={onDone}
      aria-label="SUBXVoice is starting. Click to skip."
      // Not a drag region: on a Mac a click in one moves the window and never arrives, so
      // "click to skip" did nothing. The few seconds of launch do not need a draggable window.
      className={`fixed inset-0 block cursor-default bg-stage transition-opacity duration-300 ${leaving ? "opacity-0" : ""}`}
    >
      <CharacterStage mode="launch" />
      {/* The mark's motion while the app gets ready: the same wave and cursor the pill shows when
          it is writing, so the brand moves the same way everywhere. */}
      <span className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2">
        <MotionMark className="h-10 w-10" />
      </span>
    </button>
  );
}
