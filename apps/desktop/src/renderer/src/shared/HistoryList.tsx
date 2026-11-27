import type { SessionRecord } from "@subx/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { dayLabel, formatCount, formatWords, startOfDay } from "./format";
import { HistoryRow } from "./HistoryRow";
import { SearchIcon } from "./icons";
import { totalWords } from "./stats";
import { Empty, FIELD, MoreMenu } from "./ui";

/**
 * Everything said, by day, searchable — on Home, rather than on a page of its
 * own that repeated what Home already showed.
 */
export function HistoryList({
  records,
  hotkey,
  thisDeviceOnly = false,
}: {
  records: SessionRecord[];
  hotkey: string;
  /** Other devices dictated on the account too: the heading says this list is this PC's. */
  thisDeviceOnly?: boolean;
}) {
  const [query, setQuery] = useState("");
  // Older dictations join 30 at a time as the list's end comes into view; a search shows every match
  // at once (the Mac app, cfec732, fadb9bf).
  const [limit, setLimit] = useState(40);
  const end = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    if (!records) return [];
    const needle = query.trim().toLowerCase();
    return records.filter((record) => {
      if (!needle) return true;
      return (
        record.finalText.toLowerCase().includes(needle) ||
        (record.context.appName ?? "").toLowerCase().includes(needle)
      );
    });
  }, [records, query]);

  const shown = query.trim() ? matches : matches.slice(0, limit);
  const more = shown.length < matches.length;
  useEffect(() => {
    const sentinel = end.current;
    if (!sentinel || !more) return;
    const watch = new IntersectionObserver((seen) => {
      if (seen.some((item) => item.isIntersecting)) setLimit((now) => now + 30);
    });
    watch.observe(sentinel);
    return () => watch.disconnect();
  }, [more]);

  const groups = new Map<number, SessionRecord[]>();
  for (const record of shown) {
    const day = startOfDay(record.createdAt);
    groups.set(day, [...(groups.get(day) ?? []), record]);
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <h2 className="mr-auto text-[18px]">{thisDeviceOnly ? "History on this PC" : "History"}</h2>
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
              <ul className="rounded-[16px] border border-rule bg-paper px-4">
                {dayRecords.map((record, index) => (
                  <HistoryRow key={record.id} record={record} first={index === 0} />
                ))}
              </ul>
            </section>
          ))}
          {more && <div ref={end} className="h-px" />}
        </div>
      )}

      <p className="mt-4 flex justify-between text-xs text-ink-faint">
        <span>Recordings and transcripts are stored only on this PC.</span>
        <span className="figure-num">
          {query ? `${matches.length} of ${records.length} · ` : ""}
          {/* This device's: the total above is the account's, from every device (Mac c6ed4fe). */}
          {formatWords(totalWords(matches))} on this device
        </span>
      </p>
    </section>
  );
}
