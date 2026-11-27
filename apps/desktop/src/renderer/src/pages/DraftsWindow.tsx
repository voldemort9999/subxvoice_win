import { useWindowChrome } from "@platform/Chrome";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hotkeyLabel } from "../../../shared/hotkey-label";
import type { Note } from "../../../shared/ipc";
import { useAppInfo } from "../shared/hooks";
import { CloseIcon, PinIcon, PlusIcon, SearchIcon } from "../shared/icons";
import { changedAt, matchingNotes, sortedNotes, titleOf, useNotes } from "../shared/notes";
import { useTheme } from "../shared/themes";
import { Button, FIELD, IconButton } from "../shared/ui";
import { DraftActions } from "./DraftsPage";

/**
 * Which drafts are open as tabs and which is in front, remembered when the window closes and across
 * launches (ids only; a draft gone since is dropped), and whether the list is showing (the Mac's
 * DraftsModel). Kept per PC in localStorage.
 */
const TABS = "subx.draftTabs";
const OPEN = "subx.draftOpen";
const LIST = "subx.draftList";
function stored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : (JSON.parse(value) as T);
  } catch {
    return fallback;
  }
}
function keep(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered; the window opens as it was this time.
  }
}

/** Saved a moment after typing (or dictating) stops, not on every key (the Mac's 0.6 s). */
const SAVE_MS = 600;

/**
 * Drafts are written in a window of their own, beside whatever app the person is in (the Mac's
 * DraftWindow, c7ec191, d782a4a): several open as tabs; the list of all of them folds away to leave
 * only the writing. Hold the hotkey in it and the words go in, as into any text box. A new tab is
 * kept only once something is written in it.
 */
export function DraftsWindow() {
  const drafts = useNotes("draft");
  const info = useAppInfo();
  useTheme();
  // Windows draws its own buttons over the tab bar, on the colour behind them.
  useWindowChrome();
  const [tabs, setTabs] = useState<string[]>(() => stored(TABS, []));
  const [openId, setOpenId] = useState<string | null>(() => stored(OPEN, null));
  const [sidebar, setSidebar] = useState<boolean>(() => stored(LIST, true));
  // New tabs not written in yet: not saved, so not in the account's list.
  const [unsaved, setUnsaved] = useState<Set<string>>(() => new Set());
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const saving = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => keep(TABS, tabs), [tabs]);
  useEffect(() => keep(OPEN, openId), [openId]);
  useEffect(() => keep(LIST, sidebar), [sidebar]);

  const all = useMemo(() => sortedNotes(drafts ?? []), [drafts]);
  const found = matchingNotes(query, all);
  const open: Note | null = useMemo(() => {
    if (!openId) return null;
    return (
      all.find((draft) => draft.id === openId) ?? (unsaved.has(openId) ? { id: openId, text: "" } : null)
    );
  }, [all, openId, unsaved]);

  const save = useCallback((id: string, now: string) => {
    void window.subx.notes
      .save("draft", { id, text: now })
      .catch((error: unknown) => window.alert(error instanceof Error ? error.message : String(error)));
  }, []);

  /** What is typed in the open tab is saved now (a tab is left, the window closes). */
  const flush = useCallback(() => {
    if (saving.current) clearTimeout(saving.current);
    saving.current = null;
    if (!open || textRef.current === open.text) return;
    if (unsaved.has(open.id) && !textRef.current.trim()) return;
    save(open.id, textRef.current);
  }, [open, unsaved, save]);

  // The tab shown changes: its words come up, the caret goes in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change of tab brings its saved words up.
  useEffect(() => {
    setText(open?.text ?? "");
    editor.current?.focus();
  }, [openId]);

  // Signed out, or a draft deleted somewhere else: its tab goes. A new tab's first save makes it a
  // draft like the others.
  const unsavedNow = useRef(unsaved);
  unsavedNow.current = unsaved;
  useEffect(() => {
    if (!drafts) return;
    const ids = new Set(drafts.map((draft) => draft.id));
    const fresh = unsavedNow.current;
    setUnsaved((now) => new Set([...now].filter((id) => !ids.has(id))));
    setTabs((now) => {
      const kept = now.filter((id) => ids.has(id) || fresh.has(id));
      return kept.length === now.length ? now : kept;
    });
  }, [drafts]);
  useEffect(() => {
    if (openId && !tabs.includes(openId)) setOpenId(tabs.at(-1) ?? null);
  }, [tabs, openId]);

  const choose = useCallback(
    (id: string) => {
      if (id === openId) return;
      flush();
      setTabs((now) => (now.includes(id) ? now : [...now, id]));
      setOpenId(id);
    },
    [openId, flush],
  );

  const newTab = useCallback(() => {
    flush();
    const id = crypto.randomUUID();
    setUnsaved((now) => new Set(now).add(id));
    setTabs((now) => [...now, id]);
    setOpenId(id);
  }, [flush]);

  // Main asks for a tab: a draft opened from the Drafts page, or a new one.
  useEffect(() => window.subx.drafts.onTab((id) => (id === "new" ? newTab() : choose(id))), [newTab, choose]);

  // What was typed is saved before the window goes; empty drafts are not kept.
  useEffect(() => {
    const leaving = () => {
      flush();
      for (const id of tabs) {
        const draft = all.find((item) => item.id === id);
        const words = id === openId ? textRef.current : (draft?.text ?? "");
        if (draft && !words.trim()) void window.subx.notes.remove("draft", id);
      }
      const kept = tabs.filter((id) => {
        const words = id === openId ? textRef.current : (all.find((item) => item.id === id)?.text ?? "");
        return words.trim() !== "";
      });
      keep(TABS, kept);
      keep(OPEN, kept.includes(openId ?? "") ? openId : (kept.at(-1) ?? null));
    };
    window.addEventListener("beforeunload", leaving);
    return () => window.removeEventListener("beforeunload", leaving);
  }, [flush, tabs, all, openId]);

  /** The tab goes (an empty draft with it); the one beside it opens. The last tab closes the window. */
  function closeTab(id: string) {
    if (id === openId) flush();
    const index = tabs.indexOf(id);
    if (index < 0) return;
    const words = id === openId ? text : (all.find((item) => item.id === id)?.text ?? "");
    if (!words.trim() && all.some((item) => item.id === id)) void window.subx.notes.remove("draft", id);
    const rest = tabs.filter((item) => item !== id);
    setTabs(rest);
    setUnsaved((now) => {
      const next = new Set(now);
      next.delete(id);
      return next;
    });
    if (rest.length === 0) {
      setOpenId(null);
      keep(TABS, []);
      keep(OPEN, null);
      window.close();
    } else if (openId === id) setOpenId(rest[Math.min(index, rest.length - 1)] ?? null);
  }

  function typed(now: string) {
    setText(now);
    if (!open || now === open.text) return;
    if (unsaved.has(open.id) && !now.trim()) return;
    if (saving.current) clearTimeout(saving.current);
    const id = open.id;
    saving.current = setTimeout(() => save(id, now), SAVE_MS);
  }

  const title = (id: string) =>
    titleOf(id === openId ? text : (all.find((item) => item.id === id)?.text ?? ""), "New draft");
  const hotkey = hotkeyLabel(info?.hotkeys[0]?.keys);
  const empty = !text.trim();

  return (
    <div className="flex h-full flex-col bg-side text-ink">
      {/* The tab bar is the window's drag strip; Windows' own buttons sit at its right end. */}
      <div className="flex h-11 shrink-0 items-center gap-1.5 pr-[150px] pl-3 [-webkit-app-region:drag]">
        <div className="flex min-w-0 items-center gap-1.5 [-webkit-app-region:no-drag]">
          <IconButton
            icon={SidebarIcon}
            label={sidebar ? "Hide the list" : "Show the list"}
            onClick={() => setSidebar(!sidebar)}
          />
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
            {tabs.map((id) => (
              <div
                key={id}
                className={`group/tab flex shrink-0 items-center gap-1.5 rounded-[8px] py-1.5 pr-1.5 pl-3 transition-colors ${
                  id === openId ? "bg-page" : "hover:bg-well"
                }`}
              >
                <button
                  type="button"
                  onClick={() => choose(id)}
                  className={`max-w-[150px] truncate text-[13px] ${id === openId ? "font-semibold text-ink" : "text-ink-soft"}`}
                >
                  {title(id)}
                </button>
                <button
                  type="button"
                  onClick={() => closeTab(id)}
                  title="Close tab"
                  aria-label={`Close ${title(id)}`}
                  className={`grid h-4 w-4 place-items-center text-ink-faint hover:text-ink ${
                    id === openId ? "" : "opacity-0 group-hover/tab:opacity-100 focus:opacity-100"
                  }`}
                >
                  <CloseIcon className="h-[11px] w-[11px]" />
                </button>
              </div>
            ))}
            <IconButton icon={PlusIcon} label="New draft" onClick={newTab} />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {sidebar && (
          <aside className="flex w-[230px] shrink-0 flex-col gap-2.5 px-3 pt-1 pb-3">
            <label className="relative block">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search drafts"
                aria-label="Search drafts"
                className={`${FIELD} rounded-full pl-9`}
              />
            </label>
            <ul className="scroll-area m-0 min-h-0 flex-1 list-none space-y-0.5 overflow-y-auto p-0">
              {found.length === 0 && (
                <li className="px-2.5 py-2 text-[13px] text-ink-faint">
                  {query ? `No draft has "${query}" in it.` : "Drafts you write are kept here."}
                </li>
              )}
              {found.map((draft) => (
                <li
                  key={draft.id}
                  className={`group/row flex items-center gap-1 rounded-[8px] px-2.5 py-2 ${
                    draft.id === openId ? "bg-well" : "hover:bg-well/50"
                  }`}
                >
                  <button type="button" onClick={() => choose(draft.id)} className="min-w-0 flex-1 text-left">
                    <span className={`block truncate ${draft.id === openId ? "font-semibold" : ""}`}>
                      {title(draft.id)}
                    </span>
                    <span className="block truncate text-xs text-ink-faint">
                      {changedAt(draft.updatedAt)}
                    </span>
                  </button>
                  {/* On hover: the list is narrow, and three faint icons on every row would crowd the titles. */}
                  <DraftActions
                    draft={draft}
                    {...(draft.id === openId ? { text } : {})}
                    className="hidden group-hover/row:flex group-focus-within/row:flex [&_button]:h-6 [&_button]:w-6"
                    onDeleted={() => {
                      if (saving.current && draft.id === openId) clearTimeout(saving.current);
                    }}
                  />
                  {draft.pinned && (
                    <PinIcon className="h-[11px] w-[11px] shrink-0 text-ink-faint group-hover/row:hidden" />
                  )}
                </li>
              ))}
            </ul>
          </aside>
        )}

        <main
          className={`mr-2.5 mb-2.5 flex min-w-0 flex-1 flex-col rounded-[12px] border border-rule bg-page ${
            sidebar ? "" : "ml-2.5"
          }`}
        >
          {open ? (
            <>
              <textarea
                ref={editor}
                value={text}
                onChange={(event) => typed(event.target.value)}
                placeholder={`Type, or hold ${hotkey} and talk`}
                aria-label="Draft"
                className="voice-text min-h-0 flex-1 resize-none bg-transparent px-[22px] pt-[18px] text-[16px] leading-[1.6] outline-none placeholder:text-ink-faint"
              />
              {/* Under the page only what is about the words being written; what is done to a draft is on its row. */}
              <div className="flex items-center gap-2 px-4 py-3">
                <span className="text-xs text-ink-faint">
                  {open.updatedAt
                    ? `Saved ${new Date(open.updatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                    : ""}
                </span>
                <span className="flex-1" />
                <Button
                  variant="primary"
                  disabled={empty}
                  onClick={async () => {
                    await navigator.clipboard.writeText(text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3.5">
              <p className="text-ink-soft">Open a draft from the list, or start a new one.</p>
              <Button variant="primary" onClick={newTab}>
                New draft
              </Button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/** A window with its list folded to the left: the list's own switch. */
function SidebarIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      <path d="M9 5v14" />
    </svg>
  );
}
