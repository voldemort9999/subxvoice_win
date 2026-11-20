import type { MicDevice, MicKind } from "@subx/core";
import { useEffect, useState } from "react";
import { CheckIcon, CloseIcon } from "./icons";

/**
 * What each kind of microphone is like to dictate with. From how the Mac says it is connected, so
 * an iPhone renamed to anything is still known to be an iPhone. Bluetooth is marked down because a
 * headset that records switches to its call profile: the voice is muffled and the user's music
 * drops to phone quality until the dictation ends.
 */
const ABOUT: Record<MicKind, { note: string; tone?: "good" | "warn" }> = {
  "built-in": { note: "Best choice · built into your PC", tone: "good" },
  wired: { note: "Wired microphone · clear and steady", tone: "good" },
  bluetooth: { note: "Not ideal · Bluetooth muffles your voice while recording", tone: "warn" },
  iphone: { note: "Your iPhone as a microphone · can lag or drop out", tone: "warn" },
  virtual: { note: "Virtual device · carries app audio, not your voice", tone: "warn" },
  other: { note: "Microphone" },
};

/** Built-in and wired first, then the rest; the OS's order means nothing to the user. */
const RANK: Record<MicKind, number> = {
  "built-in": 0,
  wired: 1,
  other: 2,
  bluetooth: 3,
  iphone: 4,
  virtual: 5,
};

export function micSummary(devices: MicDevice[], chosen: string): string {
  const pick = devices.find((device) => device.id === chosen);
  if (pick) return pick.name;
  const fallback = devices.find((device) => device.isDefault);
  return fallback ? `Auto-detect (${fallback.name})` : "Auto-detect";
}

/**
 * Choosing the microphone, with a live level on the one in use so the user can see it hears them.
 * The microphone is on only while this is open.
 */
export function MicPicker({
  devices,
  chosen,
  onChoose,
  onClose,
}: {
  devices: MicDevice[];
  chosen: string;
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    const off = window.subx.mic.onLevel((value) => setLevel((previous) => Math.max(value, previous * 0.8)));
    window.subx.mic.meter(true);
    const onEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onEscape);
    return () => {
      off();
      window.subx.mic.meter(false);
      window.removeEventListener("keydown", onEscape);
    };
  }, [onClose]);

  // A device that was picked and then unplugged: recording follows the default until it is back.
  const active = devices.some((device) => device.id === chosen) ? chosen : "";
  const fallback = devices.find((device) => device.isDefault);
  const sorted = [...devices].sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.name.localeCompare(b.name));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Microphone"
      className="fixed inset-0 z-40 grid place-items-center bg-black/35 p-6"
    >
      <div className="relative w-[min(560px,100%)] rounded-[20px] bg-page p-7 text-ink shadow-[0_30px_80px_-20px_rgb(0_0_0/50%)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[22px]">Microphone</h2>
            <p className="mt-1.5 text-ink-soft">
              Talk, and the bars should move. If they don't, try another.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-well text-ink-soft hover:text-ink"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <ul className="mt-5 list-none divide-y divide-rule rounded-[14px] border border-rule bg-paper p-0">
          <Row
            title={`Auto-detect${fallback ? ` (${fallback.name})` : ""}`}
            note="Follows Windows' input, and switches when you plug something in"
            selected={active === ""}
            level={level}
            onClick={() => onChoose("")}
          />
          {sorted.map((device) => (
            <Row
              key={device.id}
              title={device.name}
              note={ABOUT[device.kind].note}
              tone={ABOUT[device.kind].tone}
              selected={active === device.id}
              level={level}
              onClick={() => onChoose(device.id)}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function Row({
  title,
  note,
  tone,
  selected,
  level,
  onClick,
}: {
  title: string;
  note: string;
  tone?: "good" | "warn";
  selected: boolean;
  level: number;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-well"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          <span
            className={`block text-[13px] ${tone === "good" ? "text-accent-ink" : tone === "warn" ? "text-ink-faint" : "text-ink-soft"}`}
          >
            {note}
          </span>
        </span>
        {selected && (
          <>
            <Meter level={level} />
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-on-accent">
              <CheckIcon className="h-3.5 w-3.5" />
            </span>
          </>
        )}
      </button>
    </li>
  );
}

const BARS = 10;

/** Speech sits around 0.01–0.1 RMS; a square-root curve spreads that over the bars. */
function Meter({ level }: { level: number }) {
  const lit = Math.round(Math.min(1, Math.sqrt(level * 12)) * BARS);
  return (
    <span className="flex h-5 items-end gap-[3px]" role="img" aria-label="Input level">
      {Array.from({ length: BARS }, (_, index) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: bars are positional
          key={index}
          className={`w-[4px] rounded-full transition-colors duration-75 ${index < lit ? "bg-accent" : "bg-rule-strong"}`}
          style={{ height: `${8 + index * 1.2}px` }}
        />
      ))}
    </span>
  );
}
