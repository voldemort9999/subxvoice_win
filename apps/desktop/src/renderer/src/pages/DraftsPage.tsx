import { useState } from "react";
import type { Note } from "../../../shared/ipc";
import { formatCount } from "../shared/format";
import { PinIcon, ScriptIcon, SearchIcon, TrashIcon } from "../shared/icons";
import { changedAt, matchingNotes, sortedNotes, titleOf, useNotes } from "../shared/notes";
import { Button, Empty, FIELD, IconButton } from "../shared/ui";

/**
 * Drafts: notes to think out loud in. The page shows the recent ones as cards to come back to
 * (pinned first, searchable); one is written in its own window, beside any app. Kept on this PC, in
 * the account's folder (the Mac's DraftsPage, c7ec191, ed8a1ea).
 */
export function DraftsPage({ hotkey }: { hotkey: string }) {
  const drafts = useNotes("draft");
  const [query, setQuery] = useState("");
  const list = sortedNotes(drafts ?? []);
  const found = matchingNotes(query, list);

  return (
    <div className="space-y-7">
      <section className="space-y-3.5 rounded-[14px] bg-well p-6">
        <h2 className="text-[22px]">Say it first, shape it later</h2>
        <p className="max-w-[560px] text-ink-soft">
          A message before you send it, a list, an idea. Drafts open in their own window, so you can write
          beside any app, and stay here until you need them.
        </p>
        <p className="flex items-center gap-2 pt-1 text-[13px] text-ink-soft">
          <span className="kbd text-[12px]">{hotkey}</span>
          hold in a draft and talk
        </p>
      </section>

      {list.length > 0 && (
        <section className="space-y-3.5">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-[15px] font-semibold">Recent</h3>
            <label className="relative w-[260px] max-w-full">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${formatCount(list.length)} drafts`}
                aria-label="Search drafts"
                className={`${FIELD} rounded-full pl-9`}
              />
            </label>
          </div>
          {found.length === 0 && <Empty>No draft has "{query}" in it.</Empty>}
          <ul className="m-0 list-none space-y-2.5 p-0">
            {found.map((draft) => (
              <DraftCard key={draft.id} draft={draft} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * A recent draft: its first line, a glimpse of the rest, and when it was last changed. Send to the
 * teleprompter, pin and delete sit on the card, faint until pointed at, as on Dictionary.
 */
function DraftCard({ draft }: { draft: Note }) {
  const rest = draft.text
    .split("\n")
    .filter((line) => line.trim())
    .slice(1)
    .join(" ");
  return (
    <li className="group">
      <div className="flex gap-2 rounded-[12px] bg-well px-[18px] py-3.5 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_9%,transparent)]">
        <button
          type="button"
          onClick={() => window.subx.drafts.open(draft.id)}
          className="min-w-0 flex-1 space-y-1.5 text-left"
        >
          <span className="flex items-center gap-2">
            {draft.pinned && <PinIcon className="h-3 w-3 shrink-0 text-accent-ink" />}
            <span className="truncate text-[16px] font-semibold">{titleOf(draft.text)}</span>
          </span>
          {rest && <span className="line-clamp-2 block text-ink-soft">{rest}</span>}
          <span className="block text-xs text-ink-faint">{changedAt(draft.updatedAt)}</span>
        </button>
        <DraftActions draft={draft} className="opacity-35 group-hover:opacity-100 focus-within:opacity-100" />
      </div>
    </li>
  );
}

/** What can be done to a draft from its row, here and in the window's list (the Mac's DraftActions). */
export function DraftActions({
  draft,
  text,
  className = "",
  onDeleted,
}: {
  draft: Note;
  /** The open draft's words as typed now, so pinning never undoes unsaved typing. */
  text?: string;
  className?: string;
  onDeleted?: () => void;
}) {
  return (
    <div className={`flex shrink-0 items-start gap-1 transition-opacity ${className}`}>
      <IconButton
        icon={ScriptIcon}
        label="Send to teleprompter"
        onClick={() => void sendToTeleprompter(text ?? draft.text)}
      />
      <IconButton
        icon={PinIcon}
        label={draft.pinned ? "Unpin" : "Pin to the top"}
        onClick={() =>
          void window.subx.notes
            .save("draft", { id: draft.id, text: text ?? draft.text, pinned: !draft.pinned })
            .catch((error: unknown) => window.alert(error instanceof Error ? error.message : String(error)))
        }
      />
      <IconButton
        icon={TrashIcon}
        label="Delete"
        onClick={() => {
          if (!window.confirm("Delete this draft? It cannot be brought back.")) return;
          onDeleted?.();
          void window.subx.notes.remove("draft", draft.id);
        }}
      />
    </div>
  );
}

/**
 * A copy becomes a teleprompter script, at the top of its list and open to read or change. The draft
 * stays, as a note does when it is shared: drafts and scripts are two different things (Mac ed8a1ea).
 */
export async function sendToTeleprompter(text: string): Promise<void> {
  if (!text.trim()) return;
  const id = crypto.randomUUID();
  await window.subx.notes.save("script", { id, text });
  window.subx.app.openPage({ page: "teleprompter", script: id });
}

/** The page's action in the header's corner (the Mac's Shell). */
export function DraftsActions() {
  return (
    <div className="[-webkit-app-region:no-drag]">
      <Button variant="primary" onClick={() => window.subx.drafts.open("new")} className="py-1.5">
        New draft
      </Button>
    </div>
  );
}
