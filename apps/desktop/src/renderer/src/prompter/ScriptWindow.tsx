import { useWindowChrome } from "@platform/Chrome";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ScriptSettings } from "../../../shared/ipc";
import { useRunning } from "../pages/TeleprompterPage";
import { useNotes } from "../shared/notes";
import { useTheme } from "../shared/themes";
import { Button, Segmented, Toggle } from "../shared/ui";
import { lengthOf, rememberSettings, settingsOf, wordsIn } from "./scripts";

/** Saved a moment after typing (or dictating) stops, not on every key (the Mac's 0.6 s). */
const SAVE_MS = 600;

/**
 * One teleprompter script in a window of its own, as a draft has (the Mac's ScriptWindow, c7daaab,
 * d782a4a): the words to write in on the left, and on the right how it works and that script's own
 * settings, with Start under them. A script left empty is removed when the window closes.
 */
export function ScriptWindow() {
  useTheme();
  useWindowChrome();
  const scripts = useNotes("script");
  const running = useRunning();
  const [id, setId] = useState(() => new URLSearchParams(location.search).get("id") ?? "");
  const script = scripts?.find((note) => note.id === id);
  const [text, setText] = useState<string | null>(null);
  const textRef = useRef("");
  const saving = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const settings = settingsOf(script);

  // The script's words come up when it is loaded or another is shown.
  useEffect(() => {
    if (script && text === null) {
      setText(script.text);
      textRef.current = script.text;
      editor.current?.focus();
    }
  }, [script, text]);

  const flush = useCallback(() => {
    if (saving.current) clearTimeout(saving.current);
    saving.current = null;
    if (script && textRef.current !== script.text)
      void window.subx.notes.save("script", { id: script.id, text: textRef.current });
  }, [script]);

  // Another script asked for: what was typed in this one is saved first.
  useEffect(
    () =>
      window.subx.prompter.onShow((next) => {
        if (next === id) return;
        flush();
        setId(next);
        setText(null);
      }),
    [id, flush],
  );

  // Deleted from the page while open: the window goes with it.
  useEffect(() => {
    if (scripts && id && !script) window.close();
  }, [scripts, id, script]);

  // Its window closed: what was typed is saved, and a script left empty is removed.
  useEffect(() => {
    const leaving = () => {
      flush();
      if (script && !textRef.current.trim()) {
        if (running === script.id) window.subx.prompter.stop();
        void window.subx.notes.remove("script", script.id);
      }
    };
    window.addEventListener("beforeunload", leaving);
    return () => window.removeEventListener("beforeunload", leaving);
  }, [flush, script, running]);

  function typed(now: string) {
    setText(now);
    textRef.current = now;
    if (!script) return;
    if (saving.current) clearTimeout(saving.current);
    const at = script.id;
    saving.current = setTimeout(() => void window.subx.notes.save("script", { id: at, text: now }), SAVE_MS);
  }

  /** A setting of this script's: kept for it, and as the start for new ones. */
  function change(patch: Partial<ScriptSettings>) {
    if (!script) return;
    const next = { ...settings, ...patch };
    rememberSettings(next);
    void window.subx.notes.save("script", { id: script.id, settings: next });
  }

  const words = wordsIn(text ?? "");
  const isRunning = running === id;

  return (
    <div className="flex h-full bg-side text-ink">
      {/* The window is dragged by the strip along its top; Windows' own buttons sit at its right. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-30 h-10 [-webkit-app-region:drag]" />
      <section className="mt-10 mb-2.5 ml-2.5 flex min-w-0 flex-1 flex-col rounded-[12px] border border-rule bg-page">
        <textarea
          ref={editor}
          value={text ?? ""}
          onChange={(event) => typed(event.target.value)}
          aria-label="Script"
          placeholder="Write or paste your script, or hold your hotkey and say it."
          className="voice-text min-h-0 flex-1 resize-none bg-transparent px-[30px] pt-6 text-[19px] leading-[1.7] outline-none placeholder:text-ink-faint"
        />
        <p className="px-[34px] py-3.5 text-xs text-ink-faint">
          {words === 0 ? "" : `${lengthOf(text ?? "")} at an easy pace`}
        </p>
      </section>

      <aside className="flex w-[300px] shrink-0 flex-col px-[18px] pt-12 pb-[18px]">
        <div className="scroll-area min-h-0 flex-1 space-y-[22px] overflow-y-auto pb-3 [scrollbar-width:none]">
          <HowItWorks withVoice={settings.withVoice} />
          <div className="h-px bg-rule" />
          <Settings settings={settings} change={change} />
        </div>
        {isRunning ? (
          <Button onClick={() => window.subx.prompter.stop()} className="w-full">
            Stop
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={words === 0}
            className="w-full"
            onClick={() => {
              flush();
              void window.subx.prompter.start(id);
            }}
          >
            Start
          </Button>
        )}
      </aside>
    </div>
  );
}

/** What will happen when it starts, in the words of what the person will see (the Mac's HowItWorks). */
function HowItWorks({ withVoice }: { withVoice: boolean }) {
  const lines = withVoice
    ? ["It moves as you speak and waits when you stop.", "Pause it or close it with the buttons on it."]
    : ["Press and hold Hold to move on it. Let go and it stops.", "Close it with the button on it."];
  return (
    <div className="space-y-1.5">
      <h2 className="pb-0.5 text-[14px] font-semibold">How it works</h2>
      <p className="text-[13px] text-ink-soft">
        Your script appears at the top of your screen, under the camera.
      </p>
      {lines.map((line) => (
        <p key={line} className="text-[13px] text-ink-soft">
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * One script's settings: how it moves as two plain choices, whether it hides, its text size, then
 * what fine-tunes following the voice (the Mac's ScriptSettings).
 */
function Settings({
  settings,
  change,
}: {
  settings: ScriptSettings;
  change: (patch: Partial<ScriptSettings>) => void;
}) {
  return (
    <div className="space-y-[18px]">
      <div className="space-y-2">
        <h3 className="text-[14px] font-semibold">How it moves</h3>
        <MoveChoice
          chosen={settings.withVoice}
          title="When I speak"
          text="Follows your voice, in any language, and waits when you stop. It listens on this PC only."
          onChoose={() => change({ withVoice: true })}
        />
        <MoveChoice
          chosen={!settings.withVoice}
          title="While I hold the button"
          text="Press and hold Hold to move on the teleprompter. Let go and it stops."
          onChoose={() => change({ withVoice: false })}
        />
      </div>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-[3px]">
          <h3 className="text-[14px] font-semibold">Hide</h3>
          <p className="text-xs text-ink-faint">Not seen on a call, a recording or a screenshot.</p>
        </div>
        <Toggle
          label="Hide the teleprompter from calls, recordings and screenshots"
          checked={settings.hidden}
          onChange={(hidden) => change({ hidden })}
        />
      </div>
      <div className="space-y-2">
        <h3 className="text-[14px] font-semibold">Text size</h3>
        <Segmented
          label="Text size"
          value={String(settings.size) as "16" | "20" | "26"}
          onChange={(size) => change({ size: Number(size) })}
          options={[
            { value: "16", label: "Small" },
            { value: "20", label: "Medium" },
            { value: "26", label: "Large" },
          ]}
        />
      </div>
      {settings.withVoice && (
        <>
          <Slider
            title="Its pace"
            hint="If it stays behind you, move it right. If it runs ahead, move it left."
            low="Slower"
            high="Faster"
            min={0.7}
            max={1.4}
            value={settings.keepUp}
            onChange={(keepUp) => change({ keepUp })}
          />
          <Slider
            title="Quiet voices"
            hint="Move it right if it does not move when you speak softly."
            low="Clear speech"
            high="Soft voices"
            min={0}
            max={1}
            value={settings.sensitivity}
            onChange={(sensitivity) => change({ sensitivity })}
          />
        </>
      )}
    </div>
  );
}

function MoveChoice({
  chosen,
  title,
  text,
  onChoose,
}: {
  chosen: boolean;
  title: string;
  text: string;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      onClick={onChoose}
      className={`flex w-full items-start gap-2.5 rounded-[10px] p-3 text-left ${chosen ? "bg-well" : "hover:bg-well/50"}`}
    >
      <span
        className={`mt-0.5 h-4 w-4 shrink-0 rounded-full ${chosen ? "border-[5px] border-accent" : "border-[1.5px] border-rule-strong"}`}
      />
      <span className="min-w-0 space-y-[3px]">
        <span className="block text-[14px] font-semibold">{title}</span>
        <span className="block text-xs text-ink-soft">{text}</span>
      </span>
    </button>
  );
}

function Slider(props: {
  title: string;
  hint: string;
  low: string;
  high: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-[14px] font-semibold">{props.title}</h3>
      <div className="flex items-center gap-2.5 text-xs text-ink-soft">
        <span>{props.low}</span>
        <input
          type="range"
          aria-label={props.title}
          min={props.min}
          max={props.max}
          step={0.01}
          value={props.value}
          onChange={(event) => props.onChange(Number(event.target.value))}
          className="min-w-0 flex-1 accent-[var(--accent)]"
        />
        <span>{props.high}</span>
      </div>
      <p className="text-xs text-ink-faint">{props.hint}</p>
    </div>
  );
}
