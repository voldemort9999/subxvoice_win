import type { DictionaryEntry } from "@subx/core";
import { useEffect, useState } from "react";
import { dayKey } from "../../../shared/day-key";
import { formatCount, formatSpan } from "../shared/format";
import { HistoryList } from "../shared/HistoryList";
import { useDayTotals, useDeviceDays, useHistory, usePermissions } from "../shared/hooks";
import { BookIcon, CheckIcon, MicIcon, PaletteIcon, ShieldIcon } from "../shared/icons";
import type { PageId } from "../shared/Sidebar";
import { savedMsOf, speedOf, streakOfTotals, sumTotals } from "../shared/stats";
import { hasChosenLook } from "../shared/themes";
import { Button, Notice } from "../shared/ui";

/**
 * Home: what you have done in four numbers, the few things left to
 * set up, and then everything you have said. Each thing appears once — the charts live in
 * Insights, the history lives here.
 */
export function DashboardPage({
  hotkey,
  onNavigate,
}: {
  hotkey: string;
  onNavigate: (page: PageId) => void;
}) {
  const records = useHistory();
  const days = useDayTotals();
  const deviceDays = useDeviceDays();
  const permissions = usePermissions();
  const [words, setWords] = useState<DictionaryEntry[] | null>(null);
  useEffect(() => void window.subx.dictionary.list().then(setWords), []);
  if (!records || !days) return null;

  // "unknown" (e.g. Input Monitoring, which Electron can't read) is not treated as missing.
  const missing = permissions?.some((item) => item.state === "denied" || item.state === "not_asked") ?? false;
  // From the daily totals, which keep counting what was said after a dictation is deleted.
  const total = sumTotals(days);
  const streak = streakOfTotals(days);
  const speed = speedOf(total);
  // Today beside the total: the day's own progress is what moves while they work.
  const today = days[dayKey(Date.now())];
  // Other devices signed in to the account dictated too: only then is it said which figures are
  // everyone's and which this PC's (Mac 5628e76). With one device they are the same.
  const device = sumTotals(deviceDays ?? {});
  const shared = total.dictations > device.dictations;
  const deviceToday = deviceDays?.[dayKey(Date.now())];

  return (
    <div className="space-y-10">
      {missing && (
        <Notice role="alert">
          <div className="flex items-center justify-between gap-4">
            <p>SUBXVoice needs a permission before it can type for you.</p>
            <Button variant="primary" onClick={() => openSettings("permissions", onNavigate)}>
              Review permissions
            </Button>
          </div>
        </Notice>
      )}

      <div className="space-y-3">
        <section
          aria-label="Your numbers"
          className="grid grid-cols-2 gap-x-4 gap-y-5 rounded-[18px] border border-rule bg-paper px-7 py-6 md:grid-cols-5"
        >
          <Stat
            label="Dictated words"
            value={formatCount(total.words)}
            unit={total.words === 1 ? "word" : "words"}
            notes={shared ? [`${formatCount(device.words)} on this PC`] : []}
          />
          <Stat
            label="Today"
            value={formatCount(today?.words ?? 0)}
            unit={today?.words === 1 ? "word" : "words"}
            notes={[
              `${formatCount(today?.dictations ?? 0)} ${today?.dictations === 1 ? "dictation" : "dictations"}`,
              ...(shared ? [`${formatCount(deviceToday?.dictations ?? 0)} on this PC`] : []),
            ]}
          />
          <Stat label="Time saved" value={formatSpan(savedMsOf(total))} />
          <Stat label="Day streak" value={String(streak)} unit={streak === 1 ? "day" : "days"} />
          <Stat label="Average speed" value={speed ? String(speed) : "-"} unit={speed ? "wpm" : undefined} />
        </section>
        {shared && (
          <p className="px-1 text-[13px] text-ink-soft">
            Your account is signed in on more than one device, so these counts add up all of them. The history
            below is this PC's.
          </p>
        )}
      </div>

      <LearningCenter
        hotkey={hotkey}
        steps={{
          permissions: !missing && permissions !== null,
          dictation: records.length > 0,
          word: (words?.length ?? 0) > 0,
          look: hasChosenLook(),
        }}
        onNavigate={onNavigate}
      />

      <HistoryList records={records} hotkey={hotkey} thisDeviceOnly={shared} />
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  notes = [],
}: {
  label: string;
  value: string;
  unit?: string;
  /** A line each under the figure: what is everyone's, then this PC's when other devices count too. */
  notes?: string[];
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-ink-soft">{label}</p>
      {/* Five side by side in a narrow window: the figure gives a little rather than being cut off. */}
      <p className="figure mt-1.5 text-[clamp(20px,2.3vw,28px)] whitespace-nowrap">
        {value}
        {unit && <span className="ml-1.5 font-sans text-[14px] font-normal text-ink-soft">{unit}</span>}
      </p>
      {notes.map((note) => (
        <p key={note} className="mt-0.5 truncate text-[13px] text-ink-faint">
          {note}
        </p>
      ))}
    </div>
  );
}

/** Settings opens on the section that was last open; this points it at the one a task needs. */
export function openSettings(tab: string, onNavigate: (page: PageId) => void) {
  try {
    localStorage.setItem("subx.settings.tab", tab);
  } catch {
    // It opens on the last section instead.
  }
  onNavigate("settings");
}

/**
 * The first things worth doing. Each is checked off from
 * what the app can see (a dictation exists, a word was added), never from a click on the card, so
 * a tick means it really happened. Gone once all are done.
 */
function LearningCenter({
  hotkey,
  steps,
  onNavigate,
}: {
  hotkey: string;
  steps: { permissions: boolean; dictation: boolean; word: boolean; look: boolean };
  onNavigate: (page: PageId) => void;
}) {
  const tasks = [
    {
      done: steps.permissions,
      title: "Allow access",
      // Windows asks only for the microphone (platform-win permissions.ts).
      body: "Your microphone, so SUBXVoice can hear you.",
      go: () => openSettings("permissions", onNavigate),
      icon: ShieldIcon,
    },
    {
      done: steps.dictation,
      title: "Your first dictation",
      body: `Hold ${hotkey} in any app, talk, let go.`,
      icon: MicIcon,
    },
    {
      done: steps.word,
      title: "Add a personal word",
      body: "A name or term SUBXVoice should spell your way.",
      go: () => onNavigate("dictionary"),
      icon: BookIcon,
    },
    {
      done: steps.look,
      title: "Make it yours",
      body: "Pick a theme and a font.",
      go: () => openSettings("appearance", onNavigate),
      icon: PaletteIcon,
    },
  ];
  const left = tasks.filter((task) => !task.done).length;
  if (left === 0) return null;
  const first = tasks.find((task) => !task.done);

  return (
    // Four boxes in a row only where each has room: at 1000 px they were ~110 px wide and their
    // words broke a line at a time (2026-11-20). Narrower, two by two under the text; widest, the
    // text beside them.
    <section className="grid gap-3 rounded-[18px] bg-well p-3 sm:grid-cols-2 min-[1000px]:grid-cols-4 min-[1150px]:grid-cols-[220px_repeat(4,minmax(0,1fr))]">
      <div className="flex flex-col justify-between gap-4 p-3 sm:col-span-2 min-[1000px]:col-span-4 min-[1150px]:col-span-1">
        <div>
          <p className="text-ink-soft">
            {left} {left === 1 ? "thing" : "things"} left
          </p>
          <p className="mt-2 text-[16px] leading-snug">Set these up to get the most out of SUBXVoice.</p>
        </div>
        {first?.go && (
          <Button variant="primary" onClick={first.go} className="self-start">
            Get started
          </Button>
        )}
      </div>
      {tasks.map((task, index) => {
        const Icon = task.icon;
        const body = (
          <>
            <span className="flex items-center justify-between text-ink-faint">
              <span className="figure-num text-[13px]">{String(index + 1).padStart(2, "0")}</span>
              <span
                className={`grid h-5 w-5 place-items-center rounded-full ${
                  task.done ? "bg-accent text-on-accent" : "border border-rule-strong"
                }`}
              >
                {task.done && <CheckIcon className="h-3 w-3" />}
                <span className="sr-only">{task.done ? "Done" : "Not done yet"}</span>
              </span>
            </span>
            <Icon className="mt-5 h-5 w-5 text-ink-soft" />
            <span className={`mt-3 block font-medium ${task.done ? "text-ink-soft" : ""}`}>{task.title}</span>
            <span className="mt-1 block text-[13px] leading-snug text-ink-soft">{task.body}</span>
          </>
        );
        const card = "block rounded-[14px] bg-paper p-4 text-left";
        return task.go && !task.done ? (
          <button key={task.title} type="button" onClick={task.go} className={`${card} hover:shadow-sm`}>
            {body}
          </button>
        ) : (
          <div key={task.title} className={card}>
            {body}
          </div>
        );
      })}
    </section>
  );
}
