import { useEffect, useState } from "react";
import type { Note, NoteKind } from "../../../shared/ipc";
import { dayLabel, formatTime } from "./format";

/** Drafts or scripts, read again whenever any window changes one. `null` while loading. */
export function useNotes(kind: NoteKind): Note[] | null {
  const [notes, setNotes] = useState<Note[] | null>(null);
  useEffect(() => {
    const load = () => void window.subx.notes.list(kind).then(setNotes, () => setNotes([]));
    load();
    return window.subx.notes.onChanged((changed) => changed === kind && load());
  }, [kind]);
  return notes;
}

/** Pinned first, then the most recently changed (the Mac's DraftsModel.sorted). */
export function sortedNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) =>
    !!a.pinned !== !!b.pinned ? (a.pinned ? -1 : 1) : (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
  );
}

export function matchingNotes(query: string, notes: Note[]): Note[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle ? notes.filter((note) => note.text.toLocaleLowerCase().includes(needle)) : notes;
}

/** Its first line, or a word for an empty one. */
export function titleOf(text: string, empty = "Empty draft"): string {
  const first =
    text
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? "";
  return first || empty;
}

/** "Today, 4:12 PM": when a note last changed. */
export function changedAt(ms: number | undefined): string {
  return ms ? `${dayLabel(ms)}, ${formatTime(ms)}` : "";
}
