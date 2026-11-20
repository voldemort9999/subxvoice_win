import { useEffect, useState } from "react";
import { BAR_COUNT } from "./PillView";

/**
 * Loudness from a made-up voice, for the pill previews in Settings: two slow waves and a floor, so
 * the bars, line, orb and rings move like someone talking rather than like a test tone.
 */
export function useFakeVoice(): { levels: number[]; elapsedMs: number } {
  const [levels, setLevels] = useState(() => Array<number>(BAR_COUNT).fill(0));
  const [elapsedMs, setElapsed] = useState(4000);
  useEffect(() => {
    let t = 0;
    const timer = setInterval(() => {
      t += 1;
      const voice = Math.max(0, Math.sin(t / 3) * 0.05 + Math.sin(t / 1.3) * 0.025 + 0.02);
      setLevels((previous) => [...previous.slice(1), voice]);
      setElapsed((previous) => previous + 80);
    }, 80);
    return () => clearInterval(timer);
  }, []);
  return { levels, elapsedMs };
}
