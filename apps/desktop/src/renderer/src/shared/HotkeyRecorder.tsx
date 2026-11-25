import { useEffect, useRef, useState } from "react";
import { hotkeyLabel } from "../../../shared/hotkey-label";
import { Button } from "./ui";

/**
 * Records the dictation hotkey. The keys are read in the main process by the same poll that
 * watches them (Hotkey.record), not from this page's key events: those named the Windows key "cmd",
 * had no name for most keys, and stopped when the Start menu took the focus (user, 2026-11-20).
 */
export function HotkeyRecorder({
  value,
  presets,
  onChange,
}: {
  value: string;
  presets: string[];
  onChange: (keys: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Held in a ref: the parent passes a new function on every render, which must not restart a
  // recording in progress.
  const save = useRef(onChange);
  save.current = onChange;

  useEffect(() => {
    if (!recording) return;
    // The keys are read in the main process; on this page they must do nothing. "Change" turns
    // into "Cancel" and keeps the focus, so Ctrl + Space pressed Cancel: the recording ended with
    // nothing and Ctrl + Win stayed (user, 2026-11-20). Space, Enter and Tab are kept from the page.
    (document.activeElement as HTMLElement | null)?.blur();
    const swallow = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", swallow, true);
    window.addEventListener("keyup", swallow, true);
    window.addEventListener("keypress", swallow, true);
    const stopListening = window.subx.hotkey.onHeld(setHeld);
    let live = true;
    void window.subx.hotkey
      .record()
      .then((result) => {
        if (!live) return;
        if (result && "keys" in result) save.current(result.keys);
        if (result && "refused" in result) setProblem(result.refused);
      })
      .catch((error: unknown) => live && setProblem(String(error instanceof Error ? error.message : error)))
      .finally(() => {
        if (live) setRecording(false);
      });
    return () => {
      live = false;
      window.removeEventListener("keydown", swallow, true);
      window.removeEventListener("keyup", swallow, true);
      window.removeEventListener("keypress", swallow, true);
      stopListening();
      window.subx.hotkey.cancelRecord();
    };
  }, [recording]);

  const start = () => {
    setHeld(null);
    setProblem(null);
    setRecording(true);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2.5">
        <kbd
          className={`kbd min-w-[140px] py-1.5 text-center text-[14px] transition-colors ${
            recording ? "border-accent bg-accent text-on-accent" : ""
          }`}
        >
          {recording ? (held ? hotkeyLabel(held) : "Press keys...") : hotkeyLabel(value)}
        </kbd>
        {recording ? (
          <Button onClick={() => setRecording(false)}>Cancel</Button>
        ) : (
          <Button variant="primary" onClick={start}>
            Change
          </Button>
        )}
      </div>

      <p className="mt-2 text-xs text-ink-faint">
        {recording
          ? "Hold the keys you want, then let go. Esc to cancel."
          : "Two or more keys together, or a single F1-F24, Pause, Scroll Lock, Right Ctrl or Right Alt. A single key also reaches the app you're in, so pick one it doesn't use. A laptop's Fn key works only if the laptop tells Windows about it; most don't."}
      </p>
      {problem && !recording && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-accent-ink">
          {problem}
        </p>
      )}

      {/* The common keys stay one click away. */}
      {!recording && presets.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {presets.map((keys) => (
            <button
              key={keys}
              type="button"
              onClick={() => {
                setProblem(null);
                onChange(keys);
              }}
              aria-pressed={keys === value}
              className={`rounded-[3px] border px-2 py-0.5 font-mono text-xs transition-colors ${
                keys === value
                  ? "border-ink bg-ink text-page"
                  : "border-rule-strong text-ink-soft hover:border-ink hover:text-ink"
              }`}
            >
              {hotkeyLabel(keys)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
