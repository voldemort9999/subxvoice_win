import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, SearchIcon } from "./icons";
import { flag, languageName, nativeName } from "./languages";

/**
 * One language out of sixty, or none. The system's own menu was a column of sixty flags running off
 * the bottom of the window with no way to type; this one opens under the button, searches by
 * English or native name, and stays inside the window.
 */
export function LanguageSelect({
  codes,
  value,
  onChange,
  label,
  noneLabel = "Off",
}: {
  codes: string[];
  value: string | null;
  onChange: (code: string | null) => void;
  label: string;
  noneLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const options = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = codes
      .map((code) => ({ code: code as string | null, name: languageName(code), native: nativeName(code) }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter(
        (item) =>
          !needle || item.name.toLowerCase().includes(needle) || item.native.toLowerCase().includes(needle),
      );
    return needle ? all : [{ code: null, name: noneLabel, native: "" }, ...all];
  }, [codes, query, noneLabel]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // Opening puts the cursor on the current choice and scrolls it into view.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    // The list starts with "Off", then the languages by name, as `options` lays them out.
    const sorted = [...codes].sort((a, b) => languageName(a).localeCompare(languageName(b)));
    setCursor(value ? sorted.indexOf(value) + 1 : 0);
  }, [open, codes, value]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const pick = (code: string | null) => {
    onChange(code);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative max-w-sm">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(!open)}
        className="pressed-in flex w-full items-center gap-2.5 rounded-[10px] px-3.5 py-2.5 text-left"
      >
        {value && <span aria-hidden="true">{flag(value)}</span>}
        <span className="min-w-0 flex-1 truncate">{value ? languageName(value) : noneLabel}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4 text-ink-faint"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-30 mt-1.5 w-full overflow-hidden rounded-[14px] border border-rule bg-paper shadow-[0_18px_40px_-12px_rgb(0_0_0/45%)]">
          <label className="relative block border-b border-rule">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              // biome-ignore lint/a11y/noAutofocus: the list opens to be typed into
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") setCursor((at) => Math.min(options.length - 1, at + 1));
                else if (event.key === "ArrowUp") setCursor((at) => Math.max(0, at - 1));
                else if (event.key === "Enter" && options[cursor]) pick(options[cursor].code);
                else if (event.key === "Escape") setOpen(false);
                else return;
                event.preventDefault();
              }}
              placeholder="Search"
              aria-label="Search languages"
              className="w-full bg-transparent py-2.5 pr-3 pl-10 outline-none"
            />
          </label>
          <ul ref={list} className="scroll-area max-h-72 list-none overflow-y-auto p-1">
            {options.length === 0 && <li className="px-3 py-2.5 text-ink-soft">No language matches that.</li>}
            {options.map((item, index) => (
              <li key={item.code ?? "none"} data-index={index}>
                <button
                  type="button"
                  aria-pressed={item.code === value}
                  onClick={() => pick(item.code)}
                  onMouseEnter={() => setCursor(index)}
                  className={`flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2 text-left ${
                    index === cursor ? "bg-well" : ""
                  }`}
                >
                  <span aria-hidden="true" className="w-5 text-center">
                    {item.code ? flag(item.code) : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  {item.native && item.native !== item.name && (
                    <span className="truncate text-[13px] text-ink-faint">{item.native}</span>
                  )}
                  {item.code === value && <CheckIcon className="h-4 w-4 shrink-0 text-accent" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
