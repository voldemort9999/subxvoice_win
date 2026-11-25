import type { SessionRecord } from "@subx/core";
import { useState } from "react";
import { AudioButton } from "./AudioButton";
import { formatDuration, formatTime } from "./format";
import { CopyButton, type MoreItem, MoreMenu } from "./ui";

export function HistoryRow({ record }: { record: SessionRecord }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="group py-3">
      <div className="flex items-center gap-3">
        <AudioButton id={record.id} />

        <div className="min-w-0 flex-1">
          {record.finalText ? (
            // Expands rather than linking away: the text is the thing, and it is already here.
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              className="block w-full text-left"
            >
              {/* Selectable once opened: selectable text on every row was the heaviest part of scrolling (Mac cfec732). */}
              <p className={`voice-text text-[14px] ${open ? "" : "truncate select-none"}`}>
                {record.finalText}
              </p>
            </button>
          ) : (
            <p className="truncate text-ink-soft">No text came back for this one.</p>
          )}

          <p className="figure-num mt-1 flex items-center gap-3 text-xs text-ink-faint">
            <span>{formatTime(record.createdAt)}</span>
            <span>{formatDuration(record.audioMs ?? 0)}</span>
            {record.context.appName && <span className="truncate">{record.context.appName}</span>}
            {/* The internal error stays in the log: what the person needs is that it was not tidied. */}
            {record.rewriteError && (
              <span className="truncate font-medium text-accent-ink">Not cleaned up</span>
            )}
          </p>
        </div>

        {/* Copy stays visible: it is the action people came to this list for. */}
        <CopyButton text={record.finalText} />
        <RowMenu record={record} />
      </div>
    </li>
  );
}

/** The rest of what can be done with one dictation: take it away as a file, or delete it. */
function RowMenu({ record }: { record: SessionRecord }) {
  const name = `subxvoice-${new Date(record.createdAt).toISOString().slice(0, 16).replace(/[T:]/g, "-")}`;
  const items: MoreItem[] = [];
  if (record.audioPath)
    items.push({
      label: "Download recording",
      onClick: async () => {
        const bytes = await window.subx.history.audio(record.id);
        save(new Blob([new Uint8Array(bytes)], { type: "audio/wav" }), `${name}.wav`);
      },
    });
  if (record.finalText)
    items.push({
      label: "Download text",
      onClick: () => save(new Blob([record.finalText], { type: "text/plain;charset=utf-8" }), `${name}.txt`),
    });
  items.push({
    label: "Delete",
    divided: true,
    onClick: async () => {
      if (window.confirm("Delete this dictation? Its recording is removed from this PC.")) {
        await window.subx.history.remove(record.id);
      }
    },
  });
  return <MoreMenu items={items} />;
}

/**
 * A download rather than a file dialog: the renderer has no filesystem access, and Chromium already
 * asks where to put it.
 */
function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
