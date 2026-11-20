import { useEffect, useMemo, useRef, useState } from "react";
import { hotkeyLabel } from "../../../shared/hotkey-label";
import type { PillState } from "../../../shared/ipc";
import { alignment } from "../../../shared/pill-place";
import { useAppInfo, useSettings } from "../shared/hooks";
import { AssistantCard } from "./AssistantCard";
import { BAR_COUNT, PillView } from "./PillView";
import { MicRecorder } from "./recorder";

const silence = () => Array<number>(BAR_COUNT).fill(0);

const JUSTIFY = { start: "justify-start pl-2", center: "justify-center", end: "justify-end pr-2" };
const ALIGN = { start: "items-start pt-2", center: "items-center", end: "items-end pb-2" };

/** The live pill: state and loudness from the main process, drawn by PillView. */
export function Pill() {
  const [state, setState] = useState<PillState>({ kind: "idle" });
  const [hover, setHover] = useState(false);
  const [levels, setLevels] = useState(silence);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const info = useAppInfo();
  const [settings] = useSettings();
  // Only used when the OS has no native microphone plug (the main process sends mic commands).
  const recorder = useMemo(() => new MicRecorder(), []);
  const kind = useRef<PillState["kind"]>("idle");
  /** Between mouse down and up: the pointer may slip off the pill while it is being dragged. */
  const pressing = useRef(false);
  const button = useRef<HTMLButtonElement>(null);

  // The pill's size, for the helper that catches its clicks: it grows on hover and while speaking.
  // Where it sits inside the window follows from its corner, which the main process knows.
  useEffect(() => {
    const element = button.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      window.subx.pill.area({ width: element.offsetWidth, height: element.offsetHeight }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () =>
      window.subx.pill.onState((next) => {
        if (next.kind === "listening" && kind.current !== "listening") {
          setLevels(silence());
          setStartedAt(Date.now());
        }
        kind.current = next.kind;
        setState(next);
      }),
    [],
  );
  useEffect(
    () => window.subx.pill.onLevel((level) => setLevels((previous) => [...previous.slice(1), level])),
    [],
  );
  useEffect(
    () =>
      window.subx.pill.onMicCommand((command) => {
        if (command === "start") void recorder.start();
        else recorder.stop();
      }),
    [recorder],
  );
  // The hands-free timer ticks only while it is shown.
  const ticking = state.kind === "listening" && state.locked === true;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [ticking]);

  // The main process moved the pill out from under the pointer (a drop): not hovered any more.
  useEffect(() => window.subx.pill.onHoverReset(() => setHover(false)), []);

  function hoverChanged(inside: boolean) {
    // Mid-drag the pointer can slip off the pill for a frame; letting go of the mouse then would
    // make the window click-through under the user's hand.
    if (!inside && pressing.current) return;
    setHover(inside);
    window.subx.pill.hover(inside);
  }

  // Down and up only: whether it was a click or a drag is the main process's call, from where the
  // mouse really went.
  function pointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    pressing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    window.subx.pill.press();
  }

  function pointerUp() {
    if (!pressing.current) return;
    pressing.current = false;
    window.subx.pill.release();
  }

  const place = alignment(settings?.pillPosition ?? "bottom");

  return (
    <div className={`flex h-screen ${JUSTIFY[place.horizontal]} ${ALIGN[place.vertical]}`}>
      {/* Follow My Words' capsule card sits on the screen side of the pill: above it, or below
          it when the pill is at the top. */}
      <div
        className={`flex ${place.vertical === "start" ? "flex-col" : "flex-col-reverse"} items-center gap-2`}
      >
        <button
          ref={button}
          type="button"
          onMouseEnter={() => hoverChanged(true)}
          onMouseLeave={() => hoverChanged(false)}
          // While a learned word is announced the whole pill is its Undo: a button inside a button is
          // not allowed, and the pill is too small to aim at a smaller target.
          onPointerDown={pointerDown}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          title={`Hold ${hotkeyLabel(info?.hotkeys[0]?.keys)} to talk · press twice for hands-free · drag to move`}
          aria-label={
            state.kind === "learned"
              ? "Undo: remove from dictionary"
              : state.kind === "unplaced"
                ? "Copy what you said"
                : "Open SUBXVoice"
          }
          // Room around the idle bar, so the pointer finds it without pixel-hunting.
          className="flex min-h-6 items-center justify-center px-2 py-1"
        >
          <PillView
            state={state}
            levels={levels}
            hover={hover}
            hotkey={hotkeyLabel(info?.hotkeys[0]?.keys)}
            elapsedMs={Math.max(0, now - startedAt)}
            liveText={settings?.pillLiveText ?? true}
            look={settings?.pillStyle ?? "classic"}
          />
        </button>
        <AssistantCard
          onHover={(inside) => window.subx.pill.hover(inside)}
          listening={state.kind === "listening"}
        />
      </div>
    </div>
  );
}
