import { useEffect, useState } from "react";
import type { Note } from "../../../shared/ipc";
import { lengthOf, newScript } from "../prompter/scripts";
import { dayLabel, formatCount } from "../shared/format";
import { SearchIcon, TrashIcon } from "../shared/icons";
import { matchingNotes, titleOf, useNotes } from "../shared/notes";
import { Button, Empty, FIELD, IconButton } from "../shared/ui";

/** The script the teleprompter is running now, if any, kept current from the main process. */
export function useRunning(): string | null {
  const [running, setRunning] = useState<string | null>(null);
  useEffect(() => {
    void window.subx.prompter.running().then(setRunning);
    return window.subx.prompter.onState(setRunning);
  }, []);
  return running;
}

/**
 * The teleprompter's page, shaped like a history: a search bar, then every script, newest first.
 * Pointing at a script shows Delete and Start; Start, or a click anywhere on it, opens the script in
 * its own window (the whole script, how it works, its settings, Start). The Mac's TeleprompterPage
 * (c7daaab, d782a4a: the user's own layout).
 */
export function TeleprompterPage() {
  const scripts = useNotes("script");
  const running = useRunning();
  const [query, setQuery] = useState("");
  const list = [...(scripts ?? [])].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const found = matchingNotes(query, list);
  if (!scripts) return null;

  return (
    <div className="space-y-5">
      {list.length > 0 && (
        <label className="relative block max-w-[420px]">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${formatCount(list.length)} ${list.length === 1 ? "script" : "scripts"}`}
            aria-label="Search scripts"
            className={`${FIELD} rounded-full pl-9`}
          />
        </label>
      )}

      {list.length === 0 ? (
        <div className="space-y-3">
          <p className="text-[15px] text-ink-soft">
            Your scripts show here. Write one, then start it, and it appears at the top of your screen, under
            the camera.
          </p>
          <Button variant="primary" onClick={() => void newScript()}>
            Write a script
          </Button>
        </div>
      ) : (
        <>
          {found.length === 0 && <Empty>No script has "{query}" in it.</Empty>}
          <ul className="m-0 list-none p-0">
            {found.map((script) => (
              <ScriptRow key={script.id} script={script} running={running === script.id} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** Its window closed or the page: a script is deleted with its own settings, after asking. */
export function deleteScript(script: Note): void {
  if (!window.confirm("Delete this script? It cannot be brought back.")) return;
  void window.subx.prompter.running().then((running) => {
    if (running === script.id) window.subx.prompter.stop();
    void window.subx.notes.remove("script", script.id);
  });
}

/**
 * One script in the list: its first line, a glimpse of the rest, its length and day. Pointed at:
 * Delete and Start. Start, or a click, opens it in its own window, where it is started, so the whole
 * script and how it works are seen before it runs (the user, 2026-11-26).
 */
function ScriptRow({ script, running }: { script: Note; running: boolean }) {
  const rest = script.text
    .split("\n")
    .filter((line) => line.trim())
    .slice(1)
    .join(" ");
  const open = () => window.subx.prompter.openScript(script.id);
  return (
    <li className="group border-b border-rule">
      <div className="flex items-center gap-3 rounded-[10px] px-3.5 py-3.5 transition-colors hover:bg-well">
        <button type="button" onClick={open} className="min-w-0 flex-1 space-y-1 text-left">
          <span className="block truncate text-[15px] font-semibold">
            {titleOf(script.text, "New script")}
          </span>
          {rest && <span className="block truncate text-[14px] text-ink-soft">{rest}</span>}
          <span className="block text-xs text-ink-faint">
            {lengthOf(script.text)}
            {script.updatedAt ? `, ${dayLabel(script.updatedAt)}` : ""}
          </span>
        </button>
        <div
          className={`flex shrink-0 items-center gap-2 ${running ? "" : "hidden group-hover:flex group-focus-within:flex"}`}
        >
          <IconButton icon={TrashIcon} label="Delete" onClick={() => deleteScript(script)} />
          {running ? (
            <Button onClick={() => window.subx.prompter.stop()}>Stop</Button>
          ) : (
            <Button variant="primary" onClick={open}>
              Start
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

/** The page's action in the header's corner (the Mac's Shell). */
export function TeleprompterActions() {
  return (
    <div className="[-webkit-app-region:no-drag]">
      <Button variant="primary" onClick={() => void newScript()} className="py-1.5">
        New script
      </Button>
    </div>
  );
}
