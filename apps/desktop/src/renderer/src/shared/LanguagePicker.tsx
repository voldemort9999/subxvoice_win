import { useEffect, useMemo, useState } from "react";
import type { VoiceLanguages } from "../../../shared/ipc";
import { CloseIcon, SearchIcon } from "./icons";
import { flag, languageName, nativeName } from "./languages";
import { FIELD } from "./ui";

/**
 * The languages you speak: auto-detect at the top, every language
 * the recogniser knows in a grid, and what you picked on the right.
 *
 * What a pick means (user, 2026-11-19): the recogniser hears and writes only in the picked languages,
 * as Soniox's own app does, so with only Hindi picked English words come out in Devanagari. Nothing
 * is translated. Hinglish is a language card of its own, pinned first in the grid (user, 2026-11-19:
 * not a separate switch). "Always write in" is not here: it translates, which takes you out of the
 * languages you speak, so it is its own setting (user, 2026-11-19).
 */
export function LanguagePicker({
  value,
  onSave,
  onClose,
}: {
  value: VoiceLanguages;
  onSave: (next: VoiceLanguages) => void;
  onClose: () => void;
}) {
  const [codes, setCodes] = useState<string[]>([]);
  const [auto, setAuto] = useState(value.spoken === "auto");
  const [picked, setPicked] = useState<string[]>(value.spoken === "auto" ? [] : value.spoken);
  const [query, setQuery] = useState("");
  const [hinglish, setHinglish] = useState(value.hinglish);

  useEffect(() => void window.subx.voice.languages().then(setCodes), []);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onClose]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return codes
      .map((code) => ({ code, name: languageName(code), native: nativeName(code) }))
      .filter(
        (item) =>
          !needle ||
          item.name.toLowerCase().includes(needle) ||
          item.native.toLowerCase().includes(needle) ||
          item.code === needle,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [codes, query]);

  // Picking a language is choosing your languages, so it turns auto-detect off by itself.
  const toggle = (code: string) => {
    setAuto(false);
    setPicked((list) => (list.includes(code) ? list.filter((item) => item !== code) : [...list, code]));
  };
  // Auto-detect off with nothing picked would mean nothing can be heard; that is saved as auto.
  const save = () =>
    onSave({ spoken: auto || picked.length === 0 ? "auto" : picked, hinglish, writeIn: value.writeIn });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Languages you speak"
      className="fixed inset-0 z-40 grid place-items-center bg-black/35 p-6"
    >
      <div className="relative flex h-[min(640px,90vh)] w-[min(920px,100%)] overflow-hidden rounded-[20px] bg-page text-ink shadow-[0_30px_80px_-20px_rgb(0_0_0/50%)]">
        <div className="flex min-w-0 flex-1 flex-col p-7">
          <h2 className="text-[22px]">Languages you speak</h2>
          {/* The whole row is the switch: the words next to a small toggle are what people click. */}
          <button
            type="button"
            role="switch"
            aria-checked={auto}
            onClick={() => setAuto(!auto)}
            className={`mt-4 flex w-full items-center gap-3 rounded-[12px] border px-4 py-3 text-left transition-colors ${
              auto ? "border-accent bg-paper" : "border-transparent bg-well hover:bg-sunk"
            }`}
          >
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Auto-detect</span>
              <span className="block text-[13px] text-ink-soft">
                Any language, written as you said it. Picking yours below is more accurate.
              </span>
            </span>
            <SwitchLook on={auto} />
          </button>
          <label className="relative mt-5 block">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search any language"
              aria-label="Search languages"
              className={`${FIELD} rounded-full pl-10`}
            />
          </label>

          <ul className="scroll-area mt-4 grid flex-1 list-none grid-cols-2 content-start gap-2 overflow-y-auto p-0 pr-1 lg:grid-cols-3">
            {/* Pinned first, and usable with auto-detect on: it is how most of our users write. */}
            {(!query.trim() || "hinglish".includes(query.trim().toLowerCase())) && (
              <li>
                <button
                  type="button"
                  aria-pressed={hinglish}
                  onClick={() => setHinglish(!hinglish)}
                  className={`flex w-full items-center gap-2.5 rounded-[12px] border px-3.5 py-2 text-left transition-colors ${
                    hinglish ? "border-accent bg-paper" : "border-transparent bg-well hover:bg-sunk"
                  }`}
                >
                  <span aria-hidden="true">{flag("hi")}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">Hinglish</span>
                    <span className="block truncate text-[12px] text-ink-faint">
                      Hindi in English letters
                    </span>
                  </span>
                </button>
              </li>
            )}
            {shown.map((item) => {
              const chosen = picked.includes(item.code);
              return (
                <li key={item.code}>
                  <button
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => toggle(item.code)}
                    className={`flex h-full w-full items-center gap-2.5 rounded-[12px] border px-3.5 py-2.5 text-left transition-colors ${
                      chosen && !auto ? "border-accent bg-paper" : "border-transparent bg-well hover:bg-sunk"
                    } ${auto ? "opacity-60" : ""}`}
                  >
                    <span aria-hidden="true">{flag(item.code)}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                    {item.native && item.native !== item.name && (
                      <span className="truncate text-[13px] text-ink-faint">{item.native}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <aside className="scroll-area flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-rule bg-paper p-6">
          <div className="flex items-center justify-between">
            <p className="font-medium text-ink-soft">Selected</p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-8 w-8 place-items-center rounded-full bg-well text-ink-soft hover:text-ink"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          {hinglish && (
            <div className="mt-4 flex items-center gap-2 rounded-[12px] bg-well px-3 py-2.5">
              <span aria-hidden="true">{flag("hi")}</span>
              <span className="min-w-0 flex-1 truncate font-medium">Hinglish</span>
              <button
                type="button"
                onClick={() => setHinglish(false)}
                aria-label="Remove Hinglish"
                className="grid h-6 w-6 place-items-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {auto || picked.length === 0 ? (
            <p className="mt-4 text-ink-soft">
              {auto ? "Auto-detect is on." : hinglish ? "" : "Pick at least one language."}
            </p>
          ) : (
            <ol className="mt-2 list-none space-y-2 p-0">
              {picked.map((code) => (
                <li key={code} className="flex items-center gap-2 rounded-[12px] bg-well px-3 py-2.5">
                  <span aria-hidden="true">{flag(code)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{languageName(code)}</span>
                  <button
                    type="button"
                    onClick={() => toggle(code)}
                    aria-label={`Remove ${languageName(code)}`}
                    className="grid h-6 w-6 place-items-center rounded-full text-ink-faint hover:bg-sunk hover:text-ink"
                  >
                    <CloseIcon className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ol>
          )}
          {(hinglish || (!auto && picked.length > 0)) && (
            <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
              {hinglish
                ? "Hindi comes out in English letters, English stays English, and any other language as you said it. Nothing is translated."
                : picked.length === 1
                  ? `Every word comes out in ${languageName(picked[0] ?? "")} letters, English too, as it sounds. Nothing is translated.`
                  : "SUBXVoice listens for these and writes each as you said it. Nothing is translated."}
            </p>
          )}

          <button
            type="button"
            onClick={save}
            className="raised-accent mt-auto rounded-[12px] py-2.5 font-semibold text-on-accent"
          >
            Save
          </button>
        </aside>
      </div>
    </div>
  );
}

/** Drawn like the Toggle, inside a row that is itself the switch (a button cannot hold a button). */
function SwitchLook({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        on ? "bg-accent shadow-[inset_0_2px_4px_rgb(0_0_0/30%)]" : "pressed-in"
      }`}
    >
      <span
        className={`raised absolute top-[3px] left-0 h-[18px] w-[18px] rounded-full transition-transform ${
          on ? "translate-x-[23px]" : "translate-x-[3px]"
        }`}
      />
    </span>
  );
}
