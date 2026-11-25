import { useEffect, useState } from "react";
import { dayKey } from "../../../shared/day-key";
import { formatCount, formatSpan, formatWords } from "../shared/format";
import { useDayTotals, useHistory } from "../shared/hooks";
import {
  bestsOfTotals,
  byApp,
  byDay,
  byHour,
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
  const [dictionary, setDictionary] = useState<{ all: number; learned: number } | null>(null);
  useEffect(
    () =>
      void window.subx.dictionary.list().then((entries) =>
        setDictionary({
          all: entries.length,
          learned: entries.filter((entry) => entry.source === "learned").length,
        }),
      ),
    [],
  );
  if (!records || !totals) return null;

  // Empty only when nothing was ever said: the totals outlive deleted dictations.
  if (records.length === 0 && sumTotals(totals).dictations === 0) {
    return <Empty>Nothing to show yet. Hold {hotkey} in any app, and what you say turns up here.</Empty>;
  }

  const days = Number(range);
  // Words and time from the daily totals; what needs the text (apps, scripts, the longest
  // dictation) from the dictations still kept.
  const buckets = byDay(records, days).map((bucket) => {
    const day = totals[dayKey(bucket.start)];
    return {
      ...bucket,
      words: wordsOn(totals, bucket.start),
      dictations: day?.dictations ?? bucket.records.length,
      ms: day?.speakingMs ?? 0,
    };
  });
  const inRange = buckets.flatMap((bucket) => bucket.records);
  const period = sumTotals(totals, rangeStart(days));
  const words = period.words;
  const saved = savedMsOf(period);
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
        {/* How often they spoke, and how much each time (the Mac app's Dictations). */}
        <Figure
          label="Dictations"
          value={formatCount(period.dictations)}
          note={
            period.dictations > 0
              ? `About ${formatCount(Math.round(words / period.dictations))} words each`
              : undefined
          }
        />
        <Figure
          label="Your words"
          value={dictionary === null ? "-" : formatCount(dictionary.all)}
          note={
            dictionary && dictionary.learned > 0
              ? `${formatCount(dictionary.learned)} learned from your fixes`
              : "In your dictionary"
          }
        />
      </Figures>

      <Section title="Words per day">
        <DailyBars buckets={buckets} />
      </Section>

      <div className="grid gap-10 md:grid-cols-2">
        <Section
          title="Where your words went"
          action={
            apps.length > 1 ? (
              <span className="text-[13px] text-ink-soft">{apps.length} apps</span>
            ) : undefined
          }
        >
          {apps.length === 0 ? (
            <Empty>No app recorded yet for these dictations.</Empty>
          ) : (
            <AppsList apps={apps} />
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

const hourName = (hour: number) =>
  new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" }).replace(":00", "");

function Track({ percent, tone }: { percent: number; tone: string }) {
  return (
    <div className="h-1.5 overflow-hidden bg-well">
      <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

type DayBar = ReturnType<typeof byDay>[number] & { dictations: number; ms: number };

function DailyBars({ buckets }: { buckets: DayBar[] }) {
  const max = Math.max(...buckets.map((bucket) => bucket.words), 1);
  const dense = buckets.length > 30;
  const last = buckets.length - 1;
  const [pointed, setPointed] = useState<number | null>(null);
  const day = pointed === null ? undefined : buckets[pointed];

  return (
    <figure className="m-0">
      <div className="relative">
        {day && pointed !== null && (
          // Above the chart, over the day pointed at, kept inside the chart's width.
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-2 w-max min-w-[150px] -translate-x-1/2 rounded-[10px] border border-rule bg-paper px-3 py-2 text-xs shadow-[0_6px_18px_rgb(0_0_0/12%)]"
            style={{ left: `clamp(80px, ${((pointed + 0.5) / buckets.length) * 100}%, calc(100% - 80px))` }}
          >
            <p className="font-semibold text-ink">
              {new Date(day.start).toLocaleDateString([], {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </p>
            {day.words > 0 || day.dictations > 0 ? (
              <>
                <p className="figure-num mt-0.5 text-ink">{formatWords(day.words)}</p>
                <p className="figure-num text-ink-soft">
                  {formatCount(day.dictations)} {day.dictations === 1 ? "dictation" : "dictations"}
                  {day.ms > 0 && <> · {formatSpan(day.ms)} speaking</>}
                </p>
              </>
            ) : (
              <p className="mt-0.5 text-ink-soft">Nothing dictated</p>
            )}
          </div>
        )}
        <div
          className="flex h-32 items-end gap-[3px]"
          role="img"
          aria-label={`Words dictated per day over the last ${buckets.length} days`}
          onMouseLeave={() => setPointed(null)}
        >
          {buckets.map((bucket, index) => (
            // The whole column answers, not only a bar a few pixels wide. Pointer detail only: the
            // chart reads as one labelled image to a screen reader, as it did before.
            // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only detail over a labelled chart
            <div
              key={bucket.start}
              className="flex h-full flex-1 flex-col justify-end"
              onMouseEnter={() => setPointed(index)}
            >
              <div
                // Today is the one bar still growing, so it carries the accent; the one pointed at stands out.
                className={`w-full rounded-t-[2px] transition-colors ${
                  pointed === index
                    ? "bg-ink"
                    : bucket.words
                      ? index === last
                        ? "bg-accent"
                        : "bg-ink-soft"
                      : "bg-rule-strong"
                }`}
                style={{ height: bucket.words ? `${Math.max(4, (bucket.words / max) * 100)}%` : 2 }}
              />
            </div>
          ))}
        </div>
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

/**
 * Every app the words went into, one line each (name, bar, words), ranked by words: six in sight and
 * the rest scrolling inside the list, so the page keeps its size (the Mac app, 92bf3ca, 23bbb63).
 * While more is below, the last line fades and the scroll bar stays.
 */
function AppsList({ apps }: { apps: { name: string; words: number }[] }) {
  const [more, setMore] = useState(apps.length > 6);
  const top = apps[0]?.words || 1;
  return (
    <ul
      onScroll={(event) => {
        const list = event.currentTarget;
        setMore(list.scrollTop + list.clientHeight < list.scrollHeight - 2);
      }}
      className={`m-0 max-h-[204px] list-none space-y-0 overflow-y-auto p-0 pr-2 ${
        more ? "[mask-image:linear-gradient(to_bottom,black_80%,transparent)]" : ""
      } ${apps.length > 6 ? "[scrollbar-gutter:stable]" : ""}`}
    >
      {apps.map((app) => (
        <li key={app.name} className="grid h-[34px] grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3">
          <span className="truncate font-semibold">{app.name}</span>
          <Track percent={Math.max(3, (app.words / top) * 100)} tone="bg-ink-soft" />
          <span className="figure-num min-w-[4.5rem] text-right text-xs text-ink-soft">
            {formatWords(app.words)}
          </span>
        </li>
      ))}
    </ul>
  );
}
