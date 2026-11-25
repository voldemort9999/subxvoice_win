import type { DictionaryEntry, SessionRecord } from "@subx/core";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { PendingFix, TeamInfo } from "../../../shared/ipc";
import { useHistory, useSettings } from "../shared/hooks";
import { PencilIcon, SearchIcon, TrashIcon } from "../shared/icons";
import { Button, Empty, FIELD, Field, IconButton, Notice, Section, Segmented, Toggle } from "../shared/ui";

type Filter = "all" | "learned" | "you";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "learned", label: "Learned" },
  { value: "you", label: "Added by you" },
];

const split = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const day = (ms: number | undefined) =>
  ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null;

/** How often a word appears in what was typed: whole words, any case, any script. */
function usage(records: SessionRecord[] | null, word: string): number {
  if (!records) return 0;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
  return records.reduce((total, record) => total + (record.finalText.match(pattern)?.length ?? 0), 0);
}

/**
 * The words SUBXVoice should spell the user's way. Every word says where it came from (added by
 * the user, or learned from a fix and in which app), what it used to come out as, and how often
 * it has been typed since, so the list explains itself. Fixes seen once wait below for a second,
 * and removed words are listed so they can be let back in.
 */
export function DictionaryPage() {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [learning, setLearning] = useState<{ pending: PendingFix[]; removed: string[] }>({
    pending: [],
    removed: [],
  });
  const [word, setWord] = useState("");
  const [heardAs, setHeardAs] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [settings, update] = useSettings();
  const records = useHistory();
  // In a team: a new word can be the person's own or the whole team's (the user's call, 2026-11-22).
  const [team, setTeam] = useState<TeamInfo["team"]>(null);
  const [forWhom, setForWhom] = useState<"me" | "team">("me");
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void window.subx.team.get().then(
      (info) => setTeam(info?.team ?? null),
      () => setTeam(null),
    );
  }, []);

  const load = useCallback(() => {
    void window.subx.dictionary.list().then(setEntries);
    void window.subx.dictionary.learning().then(setLearning);
  }, []);
  // Load now, and again on focus: words are also learned while the window is in the background.
  useEffect(() => {
    load();
    window.addEventListener("focus", load);
    // Words added or deleted on another device of this account arrive while the page is open.
    const offElsewhere = window.subx.dictionary.onChanged(load);
    return () => {
      window.removeEventListener("focus", load);
      offElsewhere();
    };
  }, [load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!word.trim()) return;
    setNote(null);
    if (team && forWhom === "team") {
      try {
        await window.subx.team.words({ upsert: [{ word: word.trim(), misheardAs: split(heardAs) }] });
        setNote(`Added for everyone in ${team.name}. It's in Settings, Team.`);
      } catch (error) {
        setNote(error instanceof Error ? error.message : "Couldn't add it for the team. Try again.");
        return;
      }
    } else {
      await window.subx.dictionary.upsert({
        word: word.trim(),
        misheardAs: split(heardAs),
        source: "you",
        addedAt: Date.now(),
      });
    }
    setWord("");
    setHeardAs("");
    load();
  }

  async function remove(entryWord: string) {
    await window.subx.dictionary.remove(entryWord);
    load();
  }

  async function save(before: DictionaryEntry, next: { word: string; misheardAs: string[] }) {
    if (next.word !== before.word) await window.subx.dictionary.remove(before.word);
    await window.subx.dictionary.upsert({ ...before, ...next });
    setEditing(null);
    load();
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...entries]
      .filter(
        (entry) =>
          filter === "all" ||
          (filter === "learned" ? entry.source === "learned" : entry.source !== "learned"),
      )
      .filter(
        (entry) =>
          !needle ||
          entry.word.toLowerCase().includes(needle) ||
          [...entry.misheardAs, ...(entry.writtenAs ?? [])].some((item) =>
            item.toLowerCase().includes(needle),
          ),
      )
      .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
  }, [entries, query, filter]);

  const learnedCount = entries.filter((entry) => entry.source === "learned").length;
  // Counted once per change of words or history, not on every render: typing in the search box
  // would otherwise rescan the whole history for every word (≈150 ms at 300 words × 2,000 dictations).
  const used = useMemo(
    () => new Map(entries.map((entry) => [entry.word, usage(records, entry.word)])),
    [entries, records],
  );

  return (
    <div className="space-y-10">
      <Section title="How your dictionary works">
        <ul className="m-0 grid list-none gap-3 p-0 text-[14px] lg:grid-cols-3">
          <Explainer title="Heard right">
            Every word here is sent along with your voice, so names, brands and terms are recognised the first
            time.
          </Explainer>
          <Explainer title="Spelled your way">
            When a word comes out wrong, the spellings it came out as are listed under it, and SUBXVoice
            writes the word instead.
          </Explainer>
          <Explainer title="Learned from your fixes">
            Fix a word after it is typed and it is added here. Names after one fix, other words after the same
            fix twice.
          </Explainer>
        </ul>
      </Section>

      <Section title="Add a word">
        {team && (
          <div className="mb-4">
            <Segmented
              label="Who the word is for"
              value={forWhom}
              onChange={setForWhom}
              options={[
                { value: "me", label: "Just me" },
                { value: "team", label: `Everyone in ${team.name}` },
              ]}
            />
          </div>
        )}
        <form onSubmit={add} className="grid items-end gap-3 sm:grid-cols-[1fr_1.4fr_auto]">
          <label className="space-y-1.5">
            <span className="font-semibold">Word</span>
            <input
              id="dictionary-word"
              className={FIELD}
              value={word}
              onChange={(event) => setWord(event.target.value)}
              placeholder="SUBXVoice"
            />
          </label>
          <label className="space-y-1.5">
            <span className="font-semibold">Often comes out as</span>
            <input
              id="dictionary-heard"
              className={`${FIELD} font-mono`}
              value={heardAs}
              onChange={(event) => setHeardAs(event.target.value)}
              placeholder="sub x voice, subex voice"
            />
          </label>
          <Button type="submit" variant="primary" disabled={!word.trim()} className="py-2">
            Add word
          </Button>
        </form>
        <p className="mt-2 text-xs text-ink-faint">
          Optional. Separate spellings with commas; each one is replaced with your word wherever it appears.
          {team ? ` Words for everyone in ${team.name} are shared with the team; your own stay yours.` : ""}
        </p>
        {note && (
          <div className="mt-3">
            <Notice>{note}</Notice>
          </div>
        )}
      </Section>

      <Field label="Learn from my edits" hint="Off, nothing new is learned; the words already here stay.">
        <Toggle
          label="Learn words from my edits"
          checked={settings?.learnWords ?? true}
          onChange={(checked) => update({ learnWords: checked })}
        />
      </Field>

      {learning.pending.length > 0 && (
        <Section title="Waiting for one more fix">
          <p className="-mt-2 mb-3 text-[14px] text-ink-soft">
            You fixed these once. The next time you make the same fix they are added, or decide now.
          </p>
          <ul className="m-0 list-none divide-y divide-rule p-0">
            {learning.pending.map((fix) => (
              <li key={fix.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Change from={[fix.heardAs]} to={fix.word} />
                  <p className="mt-0.5 text-xs text-ink-faint">
                    Fixed once{fix.app ? ` in ${fix.app}` : ""}
                    {day(fix.at) ? ` · ${day(fix.at)}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={async () => {
                      await window.subx.dictionary.acceptPending(fix.key);
                      load();
                    }}
                  >
                    Add now
                  </Button>
                  <Button
                    onClick={async () => {
                      await window.subx.dictionary.dropPending(fix.key);
                      load();
                    }}
                  >
                    Ignore
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title={
          entries.length
            ? `${entries.length} ${entries.length === 1 ? "word" : "words"}${learnedCount ? ` · ${learnedCount} learned` : ""}`
            : "Your words"
        }
      >
        {entries.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-4">
            <Segmented options={FILTERS} value={filter} onChange={setFilter} label="Show words" />
            <label className="relative ml-auto w-64 max-w-full">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input
                id="dictionary-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search words and spellings"
                aria-label="Search the dictionary"
                className={`${FIELD} rounded-full pl-9`}
              />
            </label>
          </div>
        )}

        {entries.length === 0 ? (
          <Empty>
            No words yet. Start with the names you say most often, or just fix one after it is typed.
          </Empty>
        ) : shown.length === 0 ? (
          <Empty>No word matches that.</Empty>
        ) : (
          <ul className="m-0 list-none divide-y divide-rule p-0">
            {shown.map((entry) =>
              editing === entry.word ? (
                <EditRow
                  key={entry.word}
                  entry={entry}
                  onCancel={() => setEditing(null)}
                  onSave={(next) => save(entry, next)}
                />
              ) : (
                <WordRow
                  key={entry.word}
                  entry={entry}
                  used={used.get(entry.word) ?? 0}
                  onEdit={() => setEditing(entry.word)}
                  onRemove={() => remove(entry.word)}
                />
              ),
            )}
          </ul>
        )}
      </Section>

      {learning.removed.length > 0 && (
        <details className="group border-t border-rule pt-4">
          <summary className="cursor-pointer list-none font-semibold">
            Not learned again <span className="font-normal text-ink-faint">({learning.removed.length})</span>
          </summary>
          <p className="mt-2 mb-3 text-[14px] text-ink-soft">
            You removed these, so fixing them again does not add them back. Let one back in if you changed
            your mind.
          </p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {learning.removed.map((removed) => (
              <li key={removed} className="flex items-center gap-2 rounded-full border border-rule px-3 py-1">
                <span className="voice-text">{removed}</span>
                <button
                  type="button"
                  className="text-xs font-medium text-accent-ink hover:underline"
                  onClick={async () => {
                    await window.subx.dictionary.allowAgain(removed);
                    load();
                  }}
                >
                  Allow again
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Explainer({ title, children }: { title: string; children: string }) {
  return (
    <li className="rounded-[14px] bg-well px-4 py-3">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{children}</p>
    </li>
  );
}

/** "parson, persn → parso": the wrong spellings struck through, then the word. */
function Change({ from, to }: { from: string[]; to: string }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {from.map((item) => (
        <span key={item} className="spoken text-ink-faint line-through decoration-1">
          {item}
        </span>
      ))}
      {from.length > 0 && (
        <span aria-hidden="true" className="text-ink-faint">
          →
        </span>
      )}
      <span className="voice-text text-[15px] font-semibold">{to}</span>
    </p>
  );
}

function WordRow({
  entry,
  used,
  onEdit,
  onRemove,
}: {
  entry: DictionaryEntry;
  used: number;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const learned = entry.source === "learned";
  // Words from before sources were kept: whether the user typed them in or a fix taught them is
  // not known, so neither is claimed.
  const unknown = entry.source === undefined;
  const fixes = [...(entry.writtenAs ?? []), ...entry.misheardAs];
  const when = day(entry.addedAt);
  return (
    <li className="group flex items-start justify-between gap-4 py-3.5">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Change from={fixes} to={entry.word} />
          {!unknown && (
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${
                learned ? "bg-accent/15 text-accent-ink" : "bg-well text-ink-soft"
              }`}
            >
              {learned ? "Learned" : "Yours"}
            </span>
          )}
        </div>
        <p className="text-xs text-ink-faint">
          {learned
            ? `Learned from your fix${entry.learnedIn ? ` in ${entry.learnedIn}` : ""}`
            : unknown
              ? "Added before this was tracked"
              : "Added by you"}
          {when ? ` · ${when}` : ""}
          {` · ${used === 0 ? "not typed yet" : `typed ${used} ${used === 1 ? "time" : "times"}`}`}
        </p>
        {entry.misheardAs.length > 0 && (
          <p className="text-xs text-ink-faint">
            Replaced wherever they appear: <span className="spoken">{entry.misheardAs.join(", ")}</span>
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <IconButton icon={PencilIcon} label={`Edit ${entry.word}`} onClick={onEdit} />
        <IconButton
          icon={TrashIcon}
          label={learned ? `Remove ${entry.word}; it will not be learned again` : `Remove ${entry.word}`}
          onClick={onRemove}
        />
      </div>
    </li>
  );
}

function EditRow({
  entry,
  onCancel,
  onSave,
}: {
  entry: DictionaryEntry;
  onCancel: () => void;
  onSave: (next: { word: string; misheardAs: string[] }) => void;
}) {
  const [word, setWord] = useState(entry.word);
  const [heard, setHeard] = useState(entry.misheardAs.join(", "));
  return (
    <li className="py-3.5">
      <form
        className="grid items-end gap-3 sm:grid-cols-[1fr_1.4fr_auto_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          if (word.trim()) onSave({ word: word.trim(), misheardAs: split(heard) });
        }}
      >
        <label className="space-y-1.5">
          <span className="text-xs font-semibold">Word</span>
          <input
            id={`edit-word-${entry.word}`}
            className={FIELD}
            value={word}
            onChange={(event) => setWord(event.target.value)}
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-semibold">Often comes out as</span>
          <input
            id={`edit-heard-${entry.word}`}
            className={`${FIELD} font-mono`}
            value={heard}
            onChange={(event) => setHeard(event.target.value)}
            placeholder="spellings to replace, separated by commas"
          />
        </label>
        <Button type="submit" variant="primary" disabled={!word.trim()} className="py-2">
          Save
        </Button>
        <Button onClick={onCancel} className="py-2">
          Cancel
        </Button>
      </form>
    </li>
  );
}
