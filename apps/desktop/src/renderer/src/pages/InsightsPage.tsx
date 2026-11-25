import { useEffect, useState } from "react";
import { formatCount, formatSpan, formatWords } from "../shared/format";
import { useDayTotals, useHistory } from "../shared/hooks";
import {
  bestsOfTotals,
  byApp,
  byDay,
  byHour,
  cleanup,
  longest,
  personalBests,
  rangeStart,
  rhythm,
  savedMsOf,
  scripts,
  sumTotals,
  WORDS_PER_PAGE,
  wordCount,
  wordsOn,
} from "../shared/stats";
import { CopyButton, Empty, Figure, Figures, Section, Segmented } from "../shared/ui";

type Range = "7" | "30" | "90";

const RANGES: { value: Range; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

/**
 * What the user's voice has done for them, in their terms: words, time, what SUBXVoice fixed
 * along the way, how they talk. Nothing about the machinery (stage timings, models) — that is
 * ours to watch, not theirs.
 */
export function InsightsPage({ hotkey }: { hotkey: string }) {
  const records = useHistory();
  const totals = useDayTotals();
  const [range, setRange] = useState<Range>("30");
  const [learned, setLearned] = useState<number | null>(null);
  useEffect(() => void window.subx.dictionary.list().then((entries) => setLearned(entries.length)), []);
  if (!records || !totals) return null;

  // Empty only when nothing was ever said: the totals outlive deleted dictations.
  if (records.length === 0 && sumTotals(totals).dictations === 0) {
    return <Empty>Nothing to show yet. Hold {hotkey} in any app, and what you say turns up here.</Empty>;
  }

  const days = Number(range);
  // Words and time from the daily totals; what needs the text (apps, scripts, the longest
  // dictation) from the dictations still kept.
  const buckets = byDay(records, days).map((bucket) => ({ ...bucket, words: wordsOn(totals, bucket.start) }));
  const inRange = buckets.flatMap((bucket) => bucket.records);
  const period = sumTotals(totals, rangeStart(days));
  const words = period.words;
  const saved = savedMsOf(period);
  const done = cleanup(inRange);
  const mix = scripts(inRange);
  const apps = byApp(inRange);
  const hours = byHour(inRange);
  const habit = rhythm(hours);
  const bests = { ...personalBests(records), ...bestsOfTotals(totals) };
  const best = longest(inRange);
  const pages = words / WORDS_PER_PAGE;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="max-w-2xl text-[19px] leading-snug">
          {inRange.length === 0 ? (
            "Nothing said in this period."
          ) : (
            <>
              You said <strong className="font-semibold">{formatWords(words)}</strong>
              {pages >= 0.5 && (
                <> (about {pages < 1.5 ? "a page" : `${Math.round(pages)} pages`} of a book)</>
              )}{" "}
              and skipped <strong className="font-semibold">{formatSpan(saved)}</strong> of typing.
            </>
          )}
        </p>
        <Segmented options={RANGES} value={range} onChange={setRange} label="Time range" />
      </div>

      <Figures>
        <Figure label="Words" value={formatCount(words)} note={`In ${days} days`} />
        <Figure label="Time saved" value={formatSpan(saved)} note="Against typing at 40 wpm" mark />
        <Figure
          label="Tidied for you"
          value={formatCount(done.rewritten)}
          note={
            done.spoken ? `${Math.round((done.rewritten / done.spoken) * 100)}% of dictations` : undefined
          }
        />
        <Figure
          label="Your words"
          value={learned === null ? "-" : formatCount(learned)}
          note="In your dictionary"
        />
      </Figures>

      <Section title="What SUBXVoice handled">
        {done.spoken === 0 ? (
          <Empty>Nothing said in this period.</Empty>
        ) : (
          <ul className="grid gap-x-10 gap-y-6 md:grid-cols-3">
            <Handled
              value={done.rewritten}
              label="times rewritten"
              body="Corrected, punctuated and laid out after you spoke, before it was typed."
            />
            <Handled
              value={done.trimmed}
              label="words taken out"
              body="Filler words, repeats and the words you took back, removed before anything was typed."
            />
            <Handled
              value={mix.mixed}
              label="language mixes"
              body="Dictations with two languages in one breath, each kept in its own words."
            />
          </ul>
        )}
      </Section>

      <Section title="Words per day">
        <DailyBars buckets={buckets} />
      </Section>

      <div className="grid gap-10 md:grid-cols-2">
        <Section title="Where your words went">
          {apps.length === 0 ? (
            <Empty>No app recorded yet for these dictations.</Empty>
          ) : (
            <ul className="space-y-3">
              {apps.map((app) => (
                <li key={app.name}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="truncate font-semibold">{app.name}</span>
                    <span className="figure-num shrink-0 text-xs text-ink-soft">
                      {formatWords(app.words)}
                    </span>
                  </div>
                  <Track
                    percent={Math.max(3, (app.count / (apps[0]?.count || 1)) * 100)}
                    tone="bg-ink-soft"
                  />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Your rhythm">
          {habit && (
            <p className="mb-3">
              <span className="font-semibold">{habit.label}</span>
              <span className="text-ink-soft"> · you talk most around {hourName(habit.peak)}</span>
            </p>
          )}
          <HourStrip hours={hours} />
          {mix.used.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-ink-soft">Scripts you wrote in</p>
              <ul className="flex flex-wrap gap-2">
                {mix.used.map((script) => (
                  <li
                    key={script.name}
                    title={`${script.name}: ${script.count} ${script.count === 1 ? "dictation" : "dictations"}`}
                    className="pressed-in rounded-full px-3 py-1 text-[13px]"
                  >
                    <span className="mr-1.5">{script.sample}</span>
                    <span className="text-ink-faint">{script.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      </div>

      <Section title="Personal bests">
        <Figures>
          <Figure
            label="Fastest"
            value={bests.fastest ? String(bests.fastest) : "-"}
            unit={bests.fastest ? "wpm" : undefined}
            note="One dictation"
          />
          <Figure
            label="Longest"
            value={formatCount(wordCount(longest(records)?.finalText ?? ""))}
            unit="words"
            note="In one go"
          />
          <Figure
            label="Best day"
            value={bests.bestDay ? formatCount(bests.bestDay.words) : "-"}
            unit={bests.bestDay ? (bests.bestDay.words === 1 ? "word" : "words") : undefined}
            note={
              bests.bestDay
                ? new Date(bests.bestDay.start).toLocaleDateString([], { day: "numeric", month: "short" })
                : undefined
            }
          />
          <Figure
            label="Longest streak"
            value={String(bests.longestStreak)}
            unit={bests.longestStreak === 1 ? "day" : "days"}
            note="In a row"
            mark
          />
        </Figures>
      </Section>

      {best?.finalText && (
        <Section
          title="Your longest in this period"
          action={
            <div className="flex items-center gap-3">
              <span className="figure-num text-xs text-ink-soft">
                {formatWords(wordCount(best.finalText))}
              </span>
              <CopyButton text={best.finalText} />
            </div>
          }
        >
          <p className="voice-text max-h-40 max-w-[68ch] overflow-y-auto text-[14px]">{best.finalText}</p>
        </Section>
      )}
    </div>
  );
}

function Handled({ value, label, body }: { value: number; label: string; body: string }) {
  return (
    <li>
      <p className="figure text-[34px]">
        {formatCount(value)}
        <span className="ml-1.5 font-sans text-[14px] font-medium tracking-normal text-ink-soft">
          {label}
        </span>
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">{body}</p>
    </li>
  );
}

const hourName = (hour: number) =>
  new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" }).replace(":00", "");

function Track({ percent, tone }: { percent: number; tone: string }) {
  return (
    <div className="h-1.5 overflow-hidden bg-well">
      <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

function DailyBars({ buckets }: { buckets: ReturnType<typeof byDay> }) {
  const max = Math.max(...buckets.map((bucket) => bucket.words), 1);
  const dense = buckets.length > 30;
  const last = buckets.length - 1;

  return (
    <figure className="m-0">
      <div
        className="flex h-32 items-end gap-[3px]"
        role="img"
        aria-label={`Words dictated per day over the last ${buckets.length} days`}
      >
        {buckets.map((bucket, index) => (
          <div
            key={bucket.start}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${new Date(bucket.start).toLocaleDateString()}: ${formatWords(bucket.words)}`}
          >
            <div
              // Today is the one bar still growing, so it carries the accent.
              className={`w-full rounded-t-[2px] ${
                bucket.words ? (index === last ? "bg-accent" : "bg-ink-soft") : "bg-rule-strong"
              }`}
              style={{ height: bucket.words ? `${Math.max(4, (bucket.words / max) * 100)}%` : 2 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between border-t border-rule pt-2 text-xs text-ink-faint">
        <span>
          {new Date(buckets[0]?.start ?? Date.now()).toLocaleDateString([], {
            day: "numeric",
            month: "short",
          })}
        </span>
        {!dense && <span className="figure-num">{max} words at most</span>}
        <span>Today</span>
      </div>
    </figure>
  );
}

/** Fixed positions, so the key is the hour itself rather than a list index. */
const HOURS_OF_DAY = Array.from({ length: 24 }, (_, hour) => hour);

/** 24 cells, so the hours you never dictate in are as visible as the ones you do. */
function HourStrip({ hours }: { hours: number[] }) {
  const max = Math.max(...hours, 1);
  return (
    <figure className="m-0">
      <div className="flex gap-[3px]" role="img" aria-label="Dictations by hour of day">
        {HOURS_OF_DAY.map((hour) => {
          const count = hours[hour] ?? 0;
          return (
            <div
              key={hour}
              className="h-9 flex-1 rounded-[2px]"
              style={{
                background: count
                  ? `color-mix(in oklab, var(--ink) ${Math.round((count / max) * 85 + 15)}%, var(--page))`
                  : "var(--well)",
              }}
              title={`${hourName(hour)} - ${count} ${count === 1 ? "dictation" : "dictations"}`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-ink-faint">
        <span>midnight</span>
        <span>noon</span>
        <span>midnight</span>
      </div>
    </figure>
  );
}
