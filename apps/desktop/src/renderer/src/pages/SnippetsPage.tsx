import { plain, snippetInside, wholeSnippet } from "@subx/core";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { SnippetItem } from "../../../shared/ipc";
import { formatCount } from "../shared/format";
import { useHistory, useSnippets } from "../shared/hooks";
import { PencilIcon, SearchIcon, TrashIcon } from "../shared/icons";
import { Button, Empty, FIELD, IconButton, Notice } from "../shared/ui";

/**
 * Snippets: a short thing to say and the text that goes in for it ("my email" and the address).
 * Said on its own, the text goes in straight away; said inside a sentence, the words go in as said
 * and the pill offers the snippet, since "check my email" is not a request for an address. All of
 * it on this PC: the text of a snippet is never sent anywhere (the Mac's SnippetsPage, e6315c8).
 */
export function SnippetsPage() {
  const items = useSnippets();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<SnippetItem | "new" | null>(null);
  const list = useMemo(
    () => [...(items ?? [])].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [items],
  );
  const needle = query.trim().toLocaleLowerCase();
  const found = needle
    ? list.filter(
        (item) =>
          item.text.toLocaleLowerCase().includes(needle) ||
          item.triggers.some((said) => said.toLocaleLowerCase().includes(needle)),
      )
    : list;
  if (!items) return null;

  return (
    <div className="space-y-5">
      <p className="max-w-[640px] text-[15px] leading-relaxed text-ink-soft">
        Say a few words and get the whole text: your email, an address, a reply you send often. Said on its
        own, the text goes in at once. Said inside a sentence, your words go in as said and the pill offers
        the snippet.
      </p>

      {list.length === 0 ? (
        <Button variant="primary" onClick={() => setEditing("new")}>
          Add your first snippet
        </Button>
      ) : (
        <>
          <label className="relative block max-w-[420px]">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${formatCount(list.length)} ${list.length === 1 ? "snippet" : "snippets"}`}
              aria-label="Search snippets"
              className={`${FIELD} rounded-full pl-9`}
            />
          </label>
          {found.length === 0 && <Empty>No snippet has "{query}" in it.</Empty>}
          <ul className="m-0 list-none p-0">
            {found.map((item) => (
              <SnippetRow key={item.id} item={item} onEdit={() => setEditing(item)} />
            ))}
          </ul>
        </>
      )}

      {editing && <SnippetSheet item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** One snippet: what is said, what goes in, how often it was used. Edit and Delete faint until pointed at. */
function SnippetRow({ item, onEdit }: { item: SnippetItem; onEdit: () => void }) {
  const uses = item.uses ?? 0;
  return (
    <li className="group border-b border-rule">
      <div className="flex items-center gap-4 rounded-[10px] px-3.5 py-3.5 transition-colors hover:bg-well">
        <button type="button" onClick={onEdit} className="min-w-0 flex-1 space-y-[5px] text-left">
          <span className="block truncate text-[15px] font-semibold">
            {item.triggers.map((said) => `"${said}"`).join(", ")}
          </span>
          <span className="voice-text block truncate text-[14px] text-ink-soft">
            {item.text.split("\n").filter(Boolean).join("  ")}
          </span>
          <span className="block text-xs text-ink-faint">
            {uses === 0 ? "Not used yet" : `Used ${uses} ${uses === 1 ? "time" : "times"}`}
          </span>
        </button>
        <div className="flex shrink-0 gap-1 opacity-35 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <IconButton icon={PencilIcon} label="Edit" onClick={onEdit} />
          <IconButton
            icon={TrashIcon}
            label="Delete"
            onClick={() => {
              if (window.confirm("Delete this snippet?")) void window.subx.snippets.remove(item.id);
            }}
          />
        </div>
      </div>
    </li>
  );
}

const split = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => plain(item) !== "");

/**
 * Adding or changing a snippet: what you say (more than one way, separated by commas, since the
 * clean-up may write Hindi in Devanagari or in Latin letters), and the text that goes in.
 */
export function SnippetSheet({ item, onClose }: { item: SnippetItem | null; onClose: () => void }) {
  const [said, setSaid] = useState(item?.triggers.join(", ") ?? "");
  const [text, setText] = useState(item?.text ?? "");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const records = useHistory();
  const first = useRef<HTMLInputElement>(null);
  const triggers = split(said);
  const ready = triggers.length > 0 && text.trim() !== "" && !busy;

  useEffect(() => {
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // How many past dictations had this said among other words: each such time, the pill will offer
  // the snippet. From the person's own history; no list of common words.
  const saidBefore = useMemo(() => {
    const probe = [{ id: "", triggers: split(said), text: "x" }];
    if (!probe[0]?.triggers.length || !records) return 0;
    return records.filter(
      (record) => snippetInside(record.finalText, probe) && !wholeSnippet(record.finalText, probe),
    ).length;
  }, [said, records]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setNote(null);
    // A dictionary word is put in before snippets are looked for: it would change the words.
    const mine = new Set(triggers.map(plain));
    const words = await window.subx.dictionary.list();
    const clash = words.find((entry) =>
      [entry.word, ...entry.misheardAs].some((one) => mine.has(plain(one))),
    );
    if (clash)
      return setNote(`Your dictionary already changes "${clash.word}". Pick other words for this snippet.`);
    setBusy(true);
    try {
      await window.subx.snippets.save({ ...(item ? { id: item.id } : {}), triggers, text });
      onClose();
    } catch (error) {
      setNote(
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
          : String(error),
      );
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/35 animate-[fade_180ms_ease-out]"
      />
      <form
        onSubmit={save}
        role="dialog"
        aria-modal="true"
        aria-label={item ? "Edit snippet" : "Add a snippet"}
        className="animate-arrive relative w-[min(500px,calc(100vw-48px))] rounded-[16px] border border-rule bg-page p-7 text-ink shadow-[0_14px_48px_rgb(0_0_0/35%)]"
      >
        <h2 className="text-[20px]">{item ? "Edit snippet" : "Add a snippet"}</h2>
        <label className="mt-5 block space-y-1.5">
          <span className="font-semibold">When I say</span>
          <input
            ref={first}
            className={FIELD}
            value={said}
            onChange={(event) => setSaid(event.target.value)}
            placeholder="my email, mera email"
          />
          <span className="block text-[13px] text-ink-faint">
            A few words. More than one way? Separate them with commas.
          </span>
          {saidBefore >= 3 && (
            <span className="block text-[13px] text-accent-ink">
              You have said this in {saidBefore} dictations along with other words. Each time, the pill will
              offer the snippet. Something you say less often avoids that.
            </span>
          )}
        </label>
        <label className="mt-4 block space-y-1.5">
          <span className="font-semibold">Type this</span>
          <textarea
            className={`${FIELD} h-[140px] resize-none`}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        {note && (
          <div className="mt-4">
            <Notice>{note}</Notice>
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!ready}>
            {item ? "Save" : "Add snippet"}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** The page's action in the header's corner, once there is a list (the Mac's Shell). */
export function SnippetsActions() {
  const items = useSnippets();
  const [adding, setAdding] = useState(false);
  if (!items?.length) return null;
  return (
    <div className="[-webkit-app-region:no-drag]">
      <Button variant="primary" onClick={() => setAdding(true)} className="py-1.5">
        Add snippet
      </Button>
      {adding && <SnippetSheet item={null} onClose={() => setAdding(false)} />}
    </div>
  );
}
