import type { PillState, PillStyle } from "../../../shared/ipc";
import { CheckIcon, MicIcon } from "../shared/icons";
import { MotionMark } from "../shared/MotionMark";

/**
 * How the pill looks in each state. Pure: the live pill (Pill.tsx) feeds it from the main process,
 * and Settings feeds it made-up states for its previews, so both always show the same thing.
 *
 * The pill floats over every app, light or dark, so its colours are fixed rather than themed:
 * the soft-black plate of the app mark with cream type, or the reverse for "Cream", and the bright
 * ultramarine for the one thing happening now. Literal colours, so the previews in the main window,
 * which has its own theme tokens, draw it identically.
 */
interface Palette {
  plate: string;
  ink: string;
  soft: string;
  line: string;
  idleLine: string;
  chip: string;
  bar: string;
  accentBg: string;
  accentText: string;
  accentBorder: string;
  onAccent: string;
  shimmer: string;
  /** For SVG strokes and fills. */
  inkHex: string;
  accentHex: string;
}

const DARK: Palette = {
  plate: "bg-[#161412]/95",
  ink: "text-[#f2e8c8]",
  soft: "text-[#f2e8c8]/60",
  line: "border-[#f2e8c8]/12",
  idleLine: "border-[#f2e8c8]/30",
  chip: "bg-[#f2e8c8]/12",
  bar: "bg-[#f2e8c8]/85",
  accentBg: "bg-[#7c8bff]",
  accentText: "text-[#7c8bff]",
  accentBorder: "border-[#7c8bff]/70",
  onAccent: "text-[#161412]",
  shimmer:
    "bg-[linear-gradient(90deg,rgb(242_232_200/45%)_0%,rgb(242_232_200/100%)_50%,rgb(242_232_200/45%)_100%)]",
  inkHex: "#f2e8c8",
  accentHex: "#7c8bff",
};

export const BAR_COUNT = 14;

export const PILL_STYLES: { id: PillStyle; name: string; about: string }[] = [
  { id: "classic", name: "Classic", about: "Bars that move with your voice" },
  { id: "line", name: "Line", about: "One calm line that waves as you talk" },
];

export interface PillLook {
  state: PillState;
  levels: number[];
  hover: boolean;
  /** "fn", "⌥ Space"… */
  hotkey: string;
  /** Since listening began, for the hands-free timer. */
  elapsedMs: number;
  look?: PillStyle;
}

export function PillView({ state, levels, hover, hotkey, elapsedMs, look = "classic" }: PillLook) {
  const c = DARK;
  const locked = state.kind === "listening" && state.locked;
  const idle = state.kind === "idle";
  // Messages to read and act on (typed, an error, a learned word, nowhere to type) get a larger
  // pill than the listening one: at 12 px they were too small to take in at a glance.
  const message = ["done", "error", "learned", "unplaced"].includes(state.kind);

  return (
    <div
      className={`flex items-center justify-center rounded-full border backdrop-blur-xl transition-all duration-300 ease-out ${c.plate} ${c.ink} ${
        locked ? c.accentBorder : idle && !hover ? c.idleLine : c.line
      } ${
        idle
          ? hover
            ? "h-8 gap-2 px-3.5 shadow-[0_8px_24px_rgb(0_0_0/30%)]"
            : "h-[9px] w-12 shadow-[0_4px_12px_rgb(0_0_0/25%)]"
          : message
            ? "h-11 gap-3 px-5 shadow-[0_12px_34px_rgb(0_0_0/40%)]"
            : "h-9 gap-2.5 px-3.5 shadow-[0_10px_30px_rgb(0_0_0/35%)]"
      }`}
    >
      {idle && hover && (
        <span
          className={`flex items-center gap-1.5 text-xs whitespace-nowrap ${c.soft} animate-[pill-in_200ms_ease-out]`}
        >
          <MicIcon className="h-3.5 w-3.5" />
          {/* Short on purpose: the double press for hands-free is in the tooltip. */}
          Hold <Key c={c}>{hotkey}</Key>
        </span>
      )}

      {state.kind === "listening" && (
        <>
          {look === "line" ? (
            <VoiceLine levels={levels} color={c.accentHex} />
          ) : (
            <>
              {/* Recording, like the dot on a camera: the one constant sign the mic is open. */}
              <span className={`h-2 w-2 shrink-0 rounded-full ${c.accentBg} animate-pulse`} />
              <Bars levels={levels} c={c} />
            </>
          )}
          {locked && (
            <span className={`font-mono text-[11px] tabular-nums ${c.soft}`}>{clock(elapsedMs)}</span>
          )}
        </>
      )}

      {state.kind === "processing" && (
        <>
          {/* The mark's motion: the voice still moving, the cursor waiting for the words. */}
          <MotionMark className="h-6 w-6 shrink-0" />
          {state.message && (
            // The words as heard, with light running across them while they are finished.
            <span
              className={`max-w-[240px] truncate ${c.shimmer} bg-[length:200%_100%] bg-clip-text text-xs text-transparent animate-[pill-shimmer_1.6s_linear_infinite]`}
            >
              {state.message}
            </span>
          )}
        </>
      )}

      {state.kind === "done" && (
        <span className="flex min-w-0 items-center gap-2.5 animate-[pill-in_200ms_ease-out]">
          <span
            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${c.accentBg} ${c.onAccent}`}
          >
            <CheckIcon className="h-3 w-3" />
          </span>
          <span className="max-w-[260px] truncate text-[14px]">{state.message}</span>
        </span>
      )}

      {state.kind === "error" && (
        <span className="flex min-w-0 items-center gap-2.5 animate-[pill-in_200ms_ease-out]">
          <span
            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${c.accentBorder} text-[11px] font-bold ${c.accentText}`}
          >
            !
          </span>
          <span className="max-w-[300px] truncate text-[14px]">{state.message}</span>
        </span>
      )}

      {state.kind === "unplaced" && (
        <span className="flex min-w-0 items-center gap-3 text-[14px] whitespace-nowrap animate-[pill-in_200ms_ease-out]">
          <span className={c.soft}>No text box</span>
          <span
            className={`flex shrink-0 items-center gap-1.5 rounded-full ${c.chip} px-3 py-1 font-medium ${c.accentText}`}
          >
            <ClipboardGlyph />
            Copy
          </span>
        </span>
      )}

      {state.kind === "learned" && (
        <span className="flex min-w-0 items-center gap-3 text-[14px] animate-[pill-in_200ms_ease-out]">
          <span className={`min-w-0 truncate ${c.soft}`}>
            Learned <span className={`font-medium ${c.ink}`}>{state.words.join(", ")}</span>
          </span>
          <span className={`shrink-0 rounded-full ${c.chip} px-3 py-1 font-medium ${c.accentText}`}>
            Undo
          </span>
        </span>
      )}

      {/* How to end it, on hover: hands-free has no key held to let go of. */}
      {locked && hover && (
        <span className={`text-[11px] whitespace-nowrap ${c.soft}`}>
          <Key c={c}>{hotkey}</Key> done · <Key c={c}>esc</Key> cancel
        </span>
      )}
    </div>
  );
}

function Key({ children, c }: { children: string; c: Palette }) {
  return <span className={`rounded-[4px] ${c.chip} px-1 py-px font-mono text-[10px]`}>{children}</span>;
}

/** Speech sits around 0.01–0.1 RMS; a square-root curve spreads that over 0–1. */
const loud = (level: number) => Math.min(1, Math.sqrt(level * 14));

/** Bars grow out from the middle line, so silence is a quiet line rather than a row of stubs. */
function Bars({ levels, c }: { levels: number[]; c: Palette }) {
  return (
    <span className="flex h-5 items-center gap-[2.5px]" aria-hidden="true">
      {levels.map((level, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: bars are positional
          key={index}
          className={`w-[2.5px] rounded-full transition-[height] duration-75 ${
            index === levels.length - 1 ? c.accentBg : c.bar
          }`}
          style={{ height: 3 + loud(level) * 17 }}
        />
      ))}
    </span>
  );
}

/**
 * One smooth line through the recent loudness, swinging above and below the middle in turn, so it
 * reads as a sound wave: flat in silence, tall when you speak.
 */
function VoiceLine({ levels, color }: { levels: number[]; color: string }) {
  const width = 96;
  const mid = 10;
  const step = width / (levels.length - 1 || 1);
  const points = levels.map((level, index) => ({
    x: index * step,
    y: mid + (index % 2 === 0 ? -1 : 1) * loud(level) * 8.5,
  }));
  // A curve through every point: each segment's control points sit halfway along it.
  let path = `M0 ${mid}`;
  points.forEach((point, index) => {
    const previous = points[index - 1] ?? { x: 0, y: mid };
    const cx = (previous.x + point.x) / 2;
    path += ` C${cx} ${previous.y} ${cx} ${point.y} ${point.x} ${point.y}`;
  });
  return (
    <svg
      width={width}
      height={20}
      viewBox={`0 0 ${width} 20`}
      aria-hidden="true"
      className="shrink-0 overflow-visible"
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        opacity={0.35}
        transform="translate(0 1.5)"
      />
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function ClipboardGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
    </svg>
  );
}

const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
