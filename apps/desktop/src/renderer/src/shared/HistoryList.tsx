import type { SessionRecord } from "@subx/core";
import { useMemo, useState } from "react";
import { dayLabel, formatCount, formatWords, startOfDay } from "./format";
import { HistoryRow } from "./HistoryRow";
import { SearchIcon } from "./icons";
import { totalWords } from "./stats";
import { Empty, FIELD, MoreMenu } from "./ui";

/**
 * Everything said, by day, searchable — on Home, rather than on a page of its
 * own that repeated what Home already showed.
 */
export function HistoryList({ records, hotkey }: { records: SessionRecord[]; hotkey: string }) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    if (!records) return [];
    const needle = query.trim().toLowerCase();
    return records.filter((record) => {
      if (!needle) return true;
      return (
        record.finalText.toLowerCase().includes(needle) ||
        record.rawText.toLowerCase().includes(needle) ||
        (record.context.appName ?? "").toLowerCase().includes(needle)
      );
    });
  }, [records, query]);

  const groups = new Map<number, SessionRecord[]>();
  for (const record of matches) {
    const day = startOfDay(record.createdAt);
    groups.set(day, [...(groups.get(day) ?? []), record]);
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <h2 className="mr-auto text-[18px]">History</h2>
        <label className="relative w-64 max-w-full">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${formatCount(records.length)} dictations`}
            aria-label="Search dictations"
            className={`${FIELD} rounded-full pl-9`}
          />
        </label>
        <MoreMenu
          label="More for all dictations"
          items={[
            {
              label: "Delete all dictations",
              onClick: async () => {
                if (
                  records.length > 0 &&
                  window.confirm(
                    `Delete all ${records.length} dictations and their recordings from this PC? This cannot be undone.`,
                  )
                )
                  await window.subx.history.clear();
              },
            },
          ]}
        />
      </div>

      {records.length === 0 ? (
        <Empty>Nothing here yet. Hold {hotkey} in any app and start talking.</Empty>
      ) : matches.length === 0 ? (
        <Empty>No dictation matches that. Try a different word.</Empty>
      ) : (
        <div className="space-y-6">
          {[...groups].map(([day, dayRecords]) => (
            <section key={day}>
              <h3 className="mb-2 text-[14px] font-medium text-ink-faint">{dayLabel(day)}</h3>
              <ul className="divide-y divide-rule rounded-[16px] border border-rule bg-paper px-4">
                {dayRecords.map((record) => (
                  <HistoryRow key={record.id} record={record} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="mt-4 flex justify-between text-xs text-ink-faint">
        <span>Recordings and transcripts are stored only on this PC.</span>
        <span className="figure-num">
          {query ? `${matches.length} of ${records.length} · ` : ""}
          {formatWords(totalWords(matches))}
        </span>
      </p>
    </section>
  );
}
