import type { SessionRecord } from "@subx/core";
import { AudioButton } from "../shared/AudioButton";
import { FOLLOW_EXAMPLES } from "../shared/follow";
import { DAY_MS, formatCount, formatDuration, formatSpan, formatTime, streakDays } from "../shared/format";
import { HistoryRow } from "../shared/HistoryRow";
import { useHistory, usePermissions } from "../shared/hooks";
import type { PageId } from "../shared/Sidebar";
import {
  hasDevanagari,
  speakingMs,
  timeSavedMs,
  totalWords,
  wordCount,
  wordsPerMinute,
} from "../shared/stats";
import { Button, CopyButton, Empty, Figure, Figures, Notice, Section, TextAction } from "../shared/ui";
import { VoiceStrip } from "../shared/VoiceStrip";

const RECENT_COUNT = 6;

/** A streak of one is today — saying "start one" under it reads as a bug. */
function streakNote(streak: number): string {
  if (streak === 0) return "Dictate today to start one";
  if (streak === 1) return "Come back tomorrow to build it";
  return "Keep it going";
}

export function DashboardPage({
  hotkey,
  followKey,
  onNavigate,
}: {
  hotkey: string;
  /** The Follow My Words key; absent where it cannot run, and the page is then dictation only. */
  followKey?: string;
  onNavigate: (page: PageId) => void;
}) {
  const records = useHistory();
  const permissions = usePermissions();
  if (!records) return null;

  // "unknown" (a state Windows could not read) is not treated as missing.
  const missingPermission = permissions?.some(
    (permission) => permission.state === "denied" || permission.state === "not_asked",
  );
  const week = records.filter((record) => record.createdAt >= Date.now() - 7 * DAY_MS);
  const streak = streakDays(records);
  const latest = records[0];

  return (
    <div className="space-y-10">
      {missingPermission && (
        <Notice role="alert">
          <div className="flex items-center justify-between gap-4">
            <p>SUBXVoice needs microphone access before it can type for you.</p>
            <Button variant="primary" onClick={() => onNavigate("settings")}>
              Review permissions
            </Button>
          </div>
        </Notice>
      )}

      {followKey && <FollowPanel keys={followKey} />}

      {latest ? <LastDictation record={latest} /> : <FirstRun hotkey={hotkey} />}

      <Figures>
        <Figure
          label="Words this week"
          value={formatCount(totalWords(week))}
          note={`${week.length} ${week.length === 1 ? "dictation" : "dictations"}`}
        />
        <Figure
          label="Time saved"
          value={formatSpan(timeSavedMs(records))}
          note="Against typing at 40 wpm"
          mark
        />
        <Figure
          label="Speaking rate"
          value={wordsPerMinute(records) ? String(wordsPerMinute(records)) : "—"}
          unit={wordsPerMinute(records) ? "wpm" : undefined}
          note={`${formatDuration(speakingMs(records))} of speech in total`}
        />
        <Figure
          label="Streak"
          value={streak ? String(streak) : "—"}
          unit={streak ? (streak === 1 ? "day" : "days") : undefined}
          note={streakNote(streak)}
        />
      </Figures>

      <Section
        title="Speaking time, last two weeks"
        action={<TextAction onClick={() => onNavigate("insights")}>More insights</TextAction>}
      >
        <VoiceStrip records={records} />
      </Section>

      <Section
        title="Recent"
        action={
          records.length > RECENT_COUNT ? (
            <TextAction onClick={() => onNavigate("history")}>See all {records.length}</TextAction>
          ) : undefined
        }
      >
        {records.length === 0 ? (
          <Empty>Hold {hotkey} in any app and start talking.</Empty>
        ) : (
          <ul className="divide-y divide-rule">
            {records.slice(0, RECENT_COUNT).map((record) => (
              <HistoryRow key={record.id} record={record} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/**
 * The hero, and the only place the whole pipeline is visible: what the microphone heard, and what
 * was actually typed. The two differ on almost every Hindi dictation, and that difference is the
 * product — so it gets the space rather than another counter. Same shape as the website's hero:
 * the heard line in DM Mono, the typed one on a Marigold edge.
 */
function LastDictation({ record }: { record: SessionRecord }) {
  const changed = Boolean(record.rawText) && record.rawText !== record.finalText;

  return (
    <section>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AudioButton id={record.id} />
          <div>
            <p className="font-semibold">Last dictation</p>
            <p className="figure-num text-xs text-ink-soft">
              {formatTime(record.createdAt)}
              {record.context.appName ? ` into ${record.context.appName}` : ""}
              {`, ${formatDuration(record.audioMs ?? 0)}, ${wordCount(record.finalText)} words`}
            </p>
          </div>
        </div>
        <CopyButton text={record.finalText} />
      </div>

      <div className={changed ? "grid gap-6 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]" : ""}>
        {changed && (
          <div className="md:pt-1">
            <p className="mb-2 text-xs text-ink-faint">
              {hasDevanagari(record.rawText) ? "Heard in Devanagari" : "Heard as"}
            </p>
            <p className="spoken max-h-48 overflow-y-auto">{record.rawText}</p>
          </div>
        )}
        <div className="border-l-[3px] border-marigold bg-paper px-5 py-4">
          {changed && <p className="mb-2 text-xs text-ink-faint">Typed</p>}
          {record.finalText ? (
            <p className="voice-text max-h-56 max-w-[60ch] overflow-y-auto text-[20px] leading-[1.45] text-ink">
              {record.finalText}
            </p>
          ) : (
            <p className="text-ink-soft">
              No text came back. Check that speech-to-text is ready in Settings.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function FirstRun({ hotkey }: { hotkey: string }) {
  return (
    <section className="border-l-[3px] border-marigold bg-paper px-6 py-7">
      <h2 className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[24px]">
        To type instead, hold <kbd className="kbd text-[15px]">{hotkey}</kbd>
      </h2>
      <p className="mt-3 max-w-[52ch] text-[14px] leading-relaxed text-ink-soft">
        Speak Hindi, English, or both in one sentence. The text lands wherever your cursor is, and every
        recording stays on this computer.
      </p>
    </section>
  );
}

/**
 * Follow My Words leads the dashboard, on the one dark panel in the content area — the same
 * Aubergine as the sidebar and as the website's Follow My Words section. Requests are not kept in
 * history, so this shows what to say rather than what was said.
 */
function FollowPanel({ keys }: { keys: string }) {
  return (
    <section className="bg-side px-7 py-7 text-side-ink">
      <h2 className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[28px]">
        Follow My Words
        <kbd className="kbd border-side-rule bg-side-rule text-[15px] text-side-ink">{keys}</kbd>
      </h2>
      <p className="mt-3 max-w-[60ch] text-[14px] leading-relaxed text-side-soft">
        Hold {keys} while you work and say what you need done, in Hindi, English or both. It does it in front
        of you, and the pill says what it did. Messages are typed into the chat and left for you to send.
      </p>
      <p className="mt-6 text-xs text-side-soft">Try saying</p>
      <ul className="mt-2 grid gap-px bg-side-rule sm:grid-cols-2">
        {FOLLOW_EXAMPLES.map((example) => (
          <li key={example.say} className="bg-side py-3 pr-4">
            <span className="block text-xs text-marigold">{example.kind}</span>
            <span className="spoken mt-1 block text-[15px] text-side-ink">“{example.say}”</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
