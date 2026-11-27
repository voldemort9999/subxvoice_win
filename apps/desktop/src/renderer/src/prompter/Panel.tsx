import { useEffect, useRef, useState } from "react";
import type { PrompterScript } from "../../../shared/ipc";
import { micConstraints } from "../pill/mic-constraints";
import workletUrl from "../pill/pcm-worklet?worker&url";
import { useSettings } from "../shared/hooks";
import { CloseIcon, PauseIcon, PlayIcon } from "../shared/icons";
import { Glide, languageOf, Pace, VoiceActivity } from "./follow";

/** Points a second the text rises while Hold to move is held (the Mac's default speed). */
const HOLD_SPEED = 32;
/** The text area under the button band (the Mac's PrompterPanel.textHeight). */
const TEXT_HEIGHT = 132;
const BAND = 28;
const CREAM = "#f2e8c8";
const now = () => performance.now() / 1000;

/**
 * The teleprompter's panel: black like a camera's bezel, the script rising in cream and fading at
 * its edges so the line being read stands clear; pause (or Hold to move) and close in its top corners
 * (the Mac's PrompterPanel). With the voice it listens on this PC only, to know whether the person is
 * speaking (VoiceActivity) and how much of the script is said (Pace); no words are recognised and
 * nothing is sent anywhere.
 */
export function PrompterPanel() {
  const [script, setScript] = useState<PrompterScript | null>(null);
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [rise, setRise] = useState(0);
  const [appSettings] = useSettings();
  const glide = useRef(new Glide(HOLD_SPEED));
  const detector = useRef(new VoiceActivity());
  const pace = useRef<Pace | null>(null);
  const counted = useRef({ before: 0, seconds: 0, from: 0 });
  const textBox = useRef<HTMLDivElement>(null);
  const textHeight = useRef(0);
  const frame = useRef(0);
  // Read by the microphone's handler, which outlives a render.
  const current = useRef(script);
  current.current = script;

  // The panel shows through: only the black shape is drawn.
  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  useEffect(() => {
    const take = (next: PrompterScript) => {
      setScript((before) => {
        // A new script, or new words: back to the top, still, counting from there.
        if (!before || before.id !== next.id || before.text !== next.text) {
          glide.current.reset(now());
          pace.current = new Pace(next.text, languageOf(next.text));
          counted.current = { before: 0, seconds: 0, from: 0 };
          setPaused(false);
          setRise(0);
        }
        detector.current.sensitivity = next.settings.sensitivity;
        return next;
      });
    };
    const off = window.subx.prompter.onScript(take);
    void window.subx.prompter.current().then((now) => now && take(now));
    return off;
  }, []);

  const withVoice = script?.settings.withVoice === true;

  // Drawn only while it moves or comes to rest.
  const draw = () => {
    cancelAnimationFrame(frame.current);
    const step = () => {
      const t = now();
      setRise(glide.current.position(t));
      if (!glide.current.resting(t)) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };

  // Without the voice it moves only while Hold to move is held, and stops the moment it is let go.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `draw` reads refs; these are what move it.
  useEffect(() => {
    if (withVoice) return;
    glide.current.setSpeed(HOLD_SPEED, now());
    glide.current.go(holding && !paused, now());
    draw();
  }, [holding, paused, withVoice]);

  // With the voice: the microphone on while it runs unpaused, its sound read for a voice.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the microphone turns with these alone; the rest is read through refs.
  useEffect(() => {
    if (!withVoice || paused || !script) {
      glide.current.go(false, now());
      draw();
      return;
    }
    let stop = () => {};
    let gone = false;
    counted.current.before += detector.current.syllables;
    detector.current = new VoiceActivity(script.settings.sensitivity);
    setProblem(null);
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(
          micConstraints(appSettings?.microphoneId ?? "", appSettings?.voiceCleanup ?? true),
        );
        const context = new AudioContext();
        await context.audioWorklet.addModule(workletUrl);
        const node = new AudioWorkletNode(context, "pcm-capture");
        const source = context.createMediaStreamSource(stream);
        source.connect(node);
        stop = () => {
          source.disconnect();
          node.port.onmessage = null;
          for (const track of stream.getTracks()) track.stop();
          void context.close();
        };
        if (gone) return stop();
        setListening(true);
        node.port.onmessage = ({ data }: MessageEvent<{ type: string; samples?: Int16Array }>) => {
          if (data.type !== "chunk" || !data.samples) return;
          const voice = detector.current;
          const changed = voice.hear(data.samples);
          if (voice.speaking) counted.current.seconds += data.samples.length / VoiceActivity.sampleRate;
          if (changed) setHearing(voice.speaking);
          follow();
        };
      } catch {
        setProblem("Can't hear the microphone. Allow it in Windows' settings, or move it while holding.");
        setPaused(true);
      }
    })();
    return () => {
      gone = true;
      stop();
      setListening(false);
      setHearing(false);
    };
  }, [withVoice, paused, script?.id, appSettings?.microphoneId]);

  /** The text goes to how much is read, smoothly: it catches up over about 0.4 s, never jumping. */
  function follow() {
    const reading = pace.current;
    const shown = current.current;
    if (!reading || !shown || textHeight.current <= 0) return;
    const read = reading.read(counted.current.before + detector.current.syllables, counted.current.seconds);
    const target = counted.current.from + read * textHeight.current * shown.settings.keepUp;
    const t = now();
    const gap = target - glide.current.position(t);
    glide.current.setSpeed(Math.min(Math.max(gap / 0.4, 0), 600), t);
    glide.current.go(gap > 0.5, t);
    draw();
  }

  useEffect(() => {
    if (textBox.current) textHeight.current = textBox.current.offsetHeight;
  });

  if (!script) return null;
  const size = script.settings.size;
  const height = textHeight.current;

  return (
    <div className="h-full w-full select-none" style={{ color: CREAM }}>
      <div className="flex h-full flex-col rounded-b-[22px] bg-black">
        <div className="flex shrink-0 items-center px-3.5" style={{ height: BAND }}>
          {withVoice ? (
            <Corner label={paused ? "Go on" : "Pause"} onClick={() => setPaused(!paused)}>
              {paused ? (
                <PlayIcon className="h-[11px] w-[11px]" />
              ) : (
                <PauseIcon className="h-[11px] w-[11px]" />
              )}
            </Corner>
          ) : (
            // Held down, the text moves; let go, it stops.
            <button
              type="button"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setHolding(true);
              }}
              onPointerUp={() => setHolding(false)}
              onPointerCancel={() => setHolding(false)}
              className="h-[22px] rounded-full px-2.5 text-[11px] font-semibold"
              style={{
                background: `rgb(255 255 255 / ${holding ? 0.28 : 0.12})`,
                color: `color-mix(in srgb, ${CREAM} ${holding ? 100 : 80}%, transparent)`,
              }}
            >
              Hold to move
            </button>
          )}
          {/* Listening, and lit while it hears a voice: so a pause is the person's, not a microphone that hears nothing. */}
          {withVoice && listening && (
            <span
              aria-hidden="true"
              className="ml-1 h-[7px] w-[7px] rounded-full transition-opacity duration-150"
              style={{ background: CREAM, opacity: hearing ? 0.9 : 0.22 }}
            />
          )}
          {problem && <span className="ml-2 truncate text-[11px] opacity-80">{problem}</span>}
          <span className="flex-1" />
          <Corner label="Close" onClick={() => window.subx.prompter.stop()}>
            <CloseIcon className="h-[11px] w-[11px]" />
          </Corner>
        </div>
        <div
          className="relative overflow-hidden px-6"
          style={{
            height: TEXT_HEIGHT,
            maskImage: "linear-gradient(to bottom, transparent 0%, black 18%, black 70%, transparent 100%)",
          }}
        >
          <div
            ref={textBox}
            className="text-center font-medium whitespace-pre-wrap"
            style={{
              fontSize: size,
              lineHeight: 1.25 + 0.25,
              // Starts with its first line a little below the top, and stops at its end.
              transform: `translateY(${24 - Math.min(rise, Math.max(0, height - 24))}px)`,
            }}
          >
            {script.text}
          </div>
        </div>
      </div>
    </div>
  );
}

function Corner({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid h-[22px] w-[22px] place-items-center rounded-full"
      style={{ background: "rgb(255 255 255 / 0.1)", color: `color-mix(in srgb, ${CREAM} 75%, transparent)` }}
    >
      {children}
    </button>
  );
}
