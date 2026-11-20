import { HotkeyNote, MicrophoneNote, PermissionsIntro } from "@platform/Chrome";
import type { MicDevice } from "@subx/core";
import { useCallback, useEffect, useState } from "react";
import { hotkeyLabel } from "../../../shared/hotkey-label";
import type { AppInfo, PillState, PillStyle, UpdateState, VoiceLanguages } from "../../../shared/ipc";
import { PILL_PLACES, type PillPlace } from "../../../shared/pill-place";
import { useFakeVoice } from "../pill/fakeVoice";
import { PILL_STYLES, PillView } from "../pill/PillView";
import { errorText } from "../shared/errors";
import { HotkeyRecorder } from "../shared/HotkeyRecorder";
import {
  useAccount,
  useDevices,
  useMicrophones,
  useSettings,
  useUpdate,
  useVoiceSettings,
} from "../shared/hooks";
import { shownHotkey } from "../shared/hotkeys";
import { FolderIcon } from "../shared/icons";
import { LanguagePicker } from "../shared/LanguagePicker";
import { LanguageSelect } from "../shared/LanguageSelect";
import { flag, languageName } from "../shared/languages";
import { MicPicker, micSummary } from "../shared/MicPicker";
import { PermissionList } from "../shared/PermissionList";
import { FONTS, setFont, setTheme, THEMES, useFont, useThemeChoice } from "../shared/themes";
import { DEFAULT_STYLES, STYLE_CATEGORIES, STYLE_OPTIONS } from "../shared/tones";
import { Button, Field, Notice, Select, Toggle } from "../shared/ui";
import { Working } from "../shared/Working";

/**
 * Settings in sections, each named for what is inside so nobody has to open one to find out. The
 * order follows how often a section is needed.
 */
const TABS = [
  { id: "general", label: "General", about: "Your hotkey, your microphone, and how SUBXVoice starts." },
  {
    id: "dictation",
    label: "Languages",
    about: "Which languages you speak, and how your words are written down.",
  },
  { id: "style", label: "Writing style", about: "How your words read in each kind of app." },
  { id: "sound", label: "Sound and pill", about: "What you hear and see while you speak." },
  { id: "appearance", label: "Appearance", about: "Colours and fonts for this window. Applied at once." },
  {
    id: "permissions",
    label: "Permissions",
    about: "What Windows lets SUBXVoice do: hear you, see the key, type.",
  },
  { id: "privacy", label: "Privacy and data", about: "Where your recordings and transcripts are kept." },
  { id: "account", label: "Account", about: "Who is signed in on this PC." },
  { id: "about", label: "About and updates", about: "The version you have and the newest one." },
] as const;

type TabId = (typeof TABS)[number]["id"];
const TAB_KEY = "subx.settings.tab";

/** The section last open, so coming back to Settings lands where the user left it. */
function useTab(): [TabId, (tab: TabId) => void] {
  const [tab, setTab] = useState<TabId>(() => {
    try {
      const stored = localStorage.getItem(TAB_KEY);
      return TABS.find((item) => item.id === stored)?.id ?? "general";
    } catch {
      return "general";
    }
  });
  const choose = (next: TabId) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // Not remembered; it opens on General next time.
    }
  };
  return [tab, choose];
}

export function SettingsPage({ info }: { info: AppInfo | null }) {
  const [tab, choose] = useTab();
  const current = TABS.find((item) => item.id === tab) ?? TABS[0];
  const [settings, update] = useSettings();
  const microphones = useMicrophones();
  const account = useAccount();
  const update$ = useUpdate();
  const hotkey = shownHotkey(settings?.hotkey, info) ?? "";

  return (
    <div className="grid gap-8 md:grid-cols-[210px_minmax(0,1fr)]">
      <nav aria-label="Settings sections" className="md:sticky md:top-0 md:self-start">
        <ul className="m-0 flex list-none gap-1 overflow-x-auto p-0 md:flex-col">
          {TABS.map((item) => {
            const chosen = item.id === tab;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => choose(item.id)}
                  aria-current={chosen ? "page" : undefined}
                  className={`w-full rounded-[10px] px-3 py-2 text-left whitespace-nowrap transition-colors md:whitespace-normal ${
                    chosen
                      ? "pressed-in font-semibold text-ink"
                      : "text-ink-soft hover:bg-well hover:text-ink"
                  }`}
                >
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div key={tab} className="animate-arrive min-w-0">
        <header className="mb-6">
          <h2 className="text-[22px]">{current.label}</h2>
          <p className="mt-1.5 max-w-xl text-ink-soft">{current.about}</p>
        </header>

        {tab === "general" && (
          <div>
            <Field
              label="Hotkey"
              hint="Hold to dictate, let go to stop. Tap it twice to talk hands-free, and press it once more to finish. Esc cancels."
            >
              {info?.customHotkeys ? (
                <HotkeyRecorder
                  value={hotkey}
                  presets={info.supportedKeys}
                  onChange={(keys) => update({ hotkey: keys })}
                />
              ) : (
                // macOS watches a fixed set of keys, so there is a list to pick from instead.
                <Select
                  label="Hotkey"
                  value={hotkey}
                  onChange={(value) => update({ hotkey: value })}
                  options={(info?.supportedKeys ?? []).map((keys) => ({
                    value: keys,
                    label: hotkeyLabel(keys),
                  }))}
                />
              )}
              <div className="mt-2 text-xs text-ink-soft">
                <HotkeyNote />
              </div>
            </Field>
            <Field label="Microphone" hint={`Used while you hold ${hotkeyLabel(hotkey)}.`}>
              {info?.nativeMicrophone && (
                <NativeMicrophone
                  chosen={settings?.microphoneId ?? ""}
                  onChoose={(id) => update({ microphoneId: id })}
                />
              )}
              {info && !info.nativeMicrophone && (
                <Select
                  label="Microphone"
                  value={settings?.microphoneId ?? ""}
                  onChange={(value) => update({ microphoneId: value })}
                  options={[
                    { value: "", label: "System default" },
                    ...microphones.map((option) => ({ value: option.id, label: option.label })),
                  ]}
                  empty="No microphone found. Allow microphone access, then reopen this page."
                />
              )}
              <div className="mt-2 text-xs leading-relaxed text-ink-soft">
                <MicrophoneNote />
              </div>
            </Field>
            {info?.voiceCleanup && (
              <Field
                label="Background voices"
                hint="The microphone is cleaned up the way calls do it, so noise and people talking nearby are left out. Turn it off if your own voice ever sounds cut off. On Windows 11, Settings → System → Sound → your microphone → Voice Clarity helps further."
              >
                <Toggle
                  label="Reduce background noise and voices"
                  checked={settings?.voiceCleanup ?? true}
                  onChange={(checked) => update({ voiceCleanup: checked })}
                />
              </Field>
            )}
            <Field
              label="Open at login"
              hint="SUBXVoice starts in the background when you sign in to Windows, ready for the hotkey."
            >
              <Toggle
                label="Open SUBXVoice at login"
                checked={settings?.launchAtLogin ?? false}
                onChange={(checked) => update({ launchAtLogin: checked })}
              />
            </Field>
          </div>
        )}

        {tab === "dictation" && <DictationLanguages />}

        {tab === "style" && <WritingStyles />}

        {tab === "sound" && (
          <div>
            <PillPreview
              hotkey={hotkeyLabel(hotkey)}
              liveText={settings?.pillLiveText ?? true}
              look={settings?.pillStyle ?? "classic"}
            />
            <Field label="Sounds" hint="A soft tick when the microphone opens, and another when it closes.">
              <Toggle
                label="Play start and stop sounds"
                checked={settings?.sounds ?? true}
                onChange={(checked) => update({ sounds: checked })}
              />
            </Field>
            <Field
              label="Mute other audio"
              hint="Music and videos go quiet while you speak, and come back exactly as they were."
            >
              <Toggle
                label="Mute other audio while dictating"
                checked={settings?.muteAudio ?? false}
                onChange={(checked) => update({ muteAudio: checked })}
              />
            </Field>
            <Field
              label="Position"
              hint="Drag the pill itself to any corner or edge of your screen and let go; it settles there. Or pick a spot here."
            >
              <PlaceMap
                value={settings?.pillPosition ?? "bottom"}
                onChange={(place) => update({ pillPosition: place })}
              />
            </Field>
            <Field
              label="Words as you speak"
              hint="Your words appear in the pill while you talk, so you can see it hears you."
            >
              <Toggle
                label="Show words in the pill while speaking"
                checked={settings?.pillLiveText ?? true}
                onChange={(checked) => update({ pillLiveText: checked })}
              />
            </Field>
            <Field
              label="Show the pill when idle"
              hint="Off, the pill appears only while you dictate and hides again afterwards."
            >
              <Toggle
                label="Show the pill between dictations"
                checked={settings?.pillWhenIdle ?? true}
                onChange={(checked) => update({ pillWhenIdle: checked })}
              />
            </Field>
          </div>
        )}

        {tab === "appearance" && (
          <div>
            <p className="mb-3 font-semibold">Theme</p>
            <ThemePicker />
            <p className="mt-8 mb-3 font-semibold">Font</p>
            <FontPicker />
            <p className="mt-8 mb-1 font-semibold">Pill</p>
            <p className="mb-3 text-ink-soft">
              How the pill looks while you talk. Shown here with a made-up voice.
            </p>
            <PillStylePicker
              value={settings?.pillStyle ?? "classic"}
              onChange={(pillStyle) => update({ pillStyle })}
              hotkey={hotkeyLabel(hotkey)}
            />
          </div>
        )}

        {tab === "permissions" && (
          <div>
            <div className="mb-3">
              <PermissionsIntro />
            </div>
            <PermissionList />
          </div>
        )}

        {tab === "privacy" && (
          <div>
            <Field
              label="Where it is kept"
              hint="Your recordings and what you said are saved only on this PC, never on our servers."
            >
              <Button onClick={() => window.subx.app.openRecordingsFolder()}>
                <span className="flex items-center gap-2">
                  <FolderIcon className="h-4 w-4" />
                  Open recordings folder
                </span>
              </Button>
            </Field>
            <Field
              label="Keep dictations"
              hint="Older dictations are deleted on their own, with their recordings. Checked every hour. Another account's dictations on this PC are deleted once it hasn't been signed in here for 30 days."
            >
              <Select
                label="Keep dictations"
                value={settings?.keepHistory ?? "forever"}
                onChange={(value) =>
                  update({
                    keepHistory: value === "1d" || value === "7d" || value === "30d" ? value : "forever",
                  })
                }
                options={[
                  { value: "forever", label: "Until I delete them" },
                  { value: "1d", label: "For 24 hours" },
                  { value: "7d", label: "For 7 days" },
                  { value: "30d", label: "For 30 days" },
                ]}
              />
            </Field>
            <Field
              label="Delete my data"
              hint="Every dictation and recording on this PC, now. This cannot be undone."
            >
              <Button
                onClick={async () => {
                  if (
                    window.confirm(
                      "Delete all your dictations and recordings from this PC? This cannot be undone.",
                    )
                  ) {
                    await window.subx.history.clear();
                  }
                }}
              >
                Delete all dictations
              </Button>
            </Field>
          </div>
        )}

        {tab === "account" && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{account?.email ?? "Not signed in"}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  Dictation runs on your SUBXVoice account. Nothing secret is stored on this PC.
                </p>
              </div>
              <Button onClick={() => window.subx.auth.signOut()}>Sign out</Button>
            </div>
            <YourDevices />
            <DeleteAccount />
          </div>
        )}

        {tab === "about" && (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="figure-num font-semibold">SUBXVoice {info?.version ?? ""}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  <UpdateLine state={update$} />
                </p>
              </div>
              <UpdateAction state={update$} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Each theme drawn as its own 60 / 30 / 10, so the choice is made by looking, not by reading names.
 * It applies the moment it is clicked; there is nothing to save.
 */
function ThemePicker() {
  const choice = useThemeChoice();
  const card = (chosen: boolean) =>
    `rounded-[14px] border p-3 text-left transition-colors ${
      chosen ? "border-accent bg-paper ring-2 ring-accent/40" : "border-rule hover:bg-well"
    }`;
  const light = THEMES.find((option) => option.id === "light")?.swatch;
  const night = THEMES.find((option) => option.id === "night")?.swatch;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {/* First, because it is the choice that needs no further thought. */}
      <button
        type="button"
        aria-pressed={choice === "system"}
        onClick={() => setTheme("system")}
        className={card(choice === "system")}
      >
        <span className="flex h-12 overflow-hidden rounded-[9px] border border-rule" aria-hidden="true">
          <span
            className="w-1/2"
            style={{ background: `linear-gradient(90deg, ${light?.page} 70%, ${light?.side})` }}
          />
          <span
            className="w-1/2"
            style={{ background: `linear-gradient(90deg, ${night?.page} 70%, ${night?.side})` }}
          />
        </span>
        <span className="mt-3 flex items-center justify-between font-semibold">
          Match Windows
          {choice === "system" && <span className="text-xs font-medium text-accent-ink">In use</span>}
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-ink-soft">
          Light when Windows is light, Night when it is dark. Changes with it.
        </span>
      </button>
      {THEMES.map((option) => {
        const chosen = option.id === choice;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={chosen}
            onClick={() => setTheme(option.id)}
            className={card(chosen)}
          >
            <span className="flex h-12 overflow-hidden rounded-[9px] border border-rule" aria-hidden="true">
              <span className="w-[60%]" style={{ background: option.swatch.page }} />
              <span className="w-[30%]" style={{ background: option.swatch.side }} />
              <span className="w-[10%]" style={{ background: option.swatch.accent }} />
            </span>
            <span className="mt-3 flex items-center justify-between font-semibold">
              {option.name}
              {chosen && <span className="text-xs font-medium text-accent-ink">In use</span>}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-ink-soft">{option.feel}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Languages, Hinglish and "write in": the account's settings on the server, so they follow the user
 * to every device.
 */
function DictationLanguages() {
  const voice = useVoiceSettings();
  const [picking, setPicking] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  useEffect(() => void window.subx.voice.languages().then(setCodes), []);

  const languages = voice.settings?.languages;
  if (!languages) {
    return voice.problem ? (
      <p className="text-ink-soft">{voice.problem}</p>
    ) : (
      <p className="text-ink-soft">
        <Working label="Loading your language settings…" />
      </p>
    );
  }
  const spoken = languages.spoken;

  return (
    <div>
      {voice.problem && (
        <div className="mb-4">
          <Notice role="alert">{voice.problem}</Notice>
        </div>
      )}
      <Field label="Languages" hint={describe(languages)}>
        <div className="flex flex-col items-start gap-3">
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {(spoken === "auto" ? ["auto"] : spoken).map((code) => (
              <li
                key={code}
                className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-paper px-3 py-1 whitespace-nowrap"
              >
                {code === "auto" ? (
                  "Auto-detect"
                ) : (
                  <>
                    <span aria-hidden="true">{flag(code)}</span>
                    {languageName(code)}
                  </>
                )}
              </li>
            ))}
            {languages.hinglish && (
              <li className="inline-flex items-center rounded-full border border-rule bg-paper px-3 py-1">
                Hinglish
              </li>
            )}
          </ul>
          <Button onClick={() => setPicking(true)}>Change languages</Button>
        </div>
      </Field>
      {/* Apart from the languages: it is the one setting that translates, whatever you speak. */}
      <Field
        label="Always write in"
        hint="Translate everything into one language, whatever you speak: say it in one language, send it in another. Off keeps your words as you said them."
      >
        <LanguageSelect
          label="Always write in"
          codes={codes}
          value={languages.writeIn}
          onChange={(code) => void voice.update({ languages: { ...languages, writeIn: code } })}
        />
      </Field>
      {picking && (
        <LanguagePicker
          value={languages}
          onClose={() => setPicking(false)}
          onSave={(next) => {
            setPicking(false);
            void voice.update({ languages: next });
          }}
        />
      )}
    </div>
  );
}

/** What the language settings add up to, in one sentence, under the row. */
function describe(languages: VoiceLanguages): string {
  const parts: string[] = [];
  if (languages.spoken === "auto") parts.push("Whatever you speak is written as you said it.");
  else parts.push("Written in the languages you picked, as you said it. Nothing is translated.");
  if (languages.hinglish) parts.push("Hindi in English letters (Hinglish).");
  return parts.join(" ");
}

/** Each pair shown in its own display face, so the choice is made by seeing it. */
function FontPicker() {
  const font = useFont();
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {FONTS.map((option) => {
        const chosen = option.id === font;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={chosen}
            onClick={() => setFont(option.id)}
            className={`rounded-[14px] border px-4 py-3.5 text-left transition-colors ${
              chosen ? "border-accent bg-paper ring-2 ring-accent/40" : "border-rule hover:bg-well"
            }`}
          >
            <span
              className="block text-[30px] leading-none tracking-[-0.02em]"
              style={{ fontFamily: option.display, fontWeight: option.weight }}
            >
              Aa
            </span>
            <span className="mt-3 flex items-center justify-between font-semibold">
              {option.name}
              {chosen && <span className="text-xs font-medium text-accent-ink">In use</span>}
            </span>
            <span className="mt-0.5 block text-xs text-ink-soft">{option.feel}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Says what the updater is doing, in the one line someone glances at to answer "am I current?". */
function UpdateLine({ state }: { state: UpdateState | null }) {
  if (!state || state.kind === "checking") return <Working label="Checking for updates…" />;
  switch (state.kind) {
    case "current":
      return <>Up to date, checked {timeAgo(state.checkedAt)}.</>;
    case "downloading":
      return (
        <>
          Downloading {state.version} — {state.percent}%
        </>
      );
    case "ready":
      return <>Version {state.version} is ready. It installs when you quit, or restart now.</>;
    case "available":
      return <>Version {state.version} is out. Download and run the installer.</>;
    case "error":
      return <span className="font-medium text-accent-ink">{state.message}</span>;
    case "unsupported":
      return <>{state.reason}</>;
    default:
      return <>Updates are installed automatically.</>;
  }
}

function UpdateAction({ state }: { state: UpdateState | null }) {
  if (state?.kind === "ready" || state?.kind === "available") {
    return (
      <Button variant="primary" onClick={() => window.subx.update.install()}>
        {state.kind === "ready" ? "Restart and install" : "Download"}
      </Button>
    );
  }
  const busy = state?.kind === "checking" || state?.kind === "downloading";
  if (state?.kind === "unsupported") return null;
  return (
    <Button busy={busy} onClick={() => void window.subx.update.check()}>
      {busy ? (
        <Working label={state?.kind === "downloading" ? "Downloading…" : "Checking…"} />
      ) : (
        "Check for updates"
      )}
    </Button>
  );
}

function timeAgo(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

/** The Mac's own microphones: what is in use now, and a picker with a live level. */
function NativeMicrophone({ chosen, onChoose }: { chosen: string; onChoose: (id: string) => void }) {
  const [devices, setDevices] = useState<MicDevice[]>([]);
  const [picking, setPicking] = useState(false);
  // Read again each time the picker opens: AirPods and iPhones come and go.
  const load = useCallback(() => void window.subx.mic.devices().then(setDevices), []);
  useEffect(load, [load]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="pressed-in rounded-[10px] px-3 py-2">{micSummary(devices, chosen)}</span>
      <Button
        onClick={() => {
          load();
          setPicking(true);
        }}
      >
        Change
      </Button>
      {picking && (
        <MicPicker devices={devices} chosen={chosen} onChoose={onChoose} onClose={() => setPicking(false)} />
      )}
    </div>
  );
}

/** Every state the pill can be in, made up but drawn by the same view as the real one. */
const PREVIEW: { label: string; state: PillState; hover?: boolean }[] = [
  { label: "Waiting", state: { kind: "idle" } },
  { label: "Pointed at", state: { kind: "idle" }, hover: true },
  { label: "Listening", state: { kind: "listening", text: "let's meet tomorrow at ten" } },
  { label: "Hands-free", state: { kind: "listening", locked: true, text: "and the report" }, hover: true },
  { label: "Writing", state: { kind: "processing", message: "let's meet tomorrow at ten" } },
  { label: "Typed", state: { kind: "done", message: "Let's meet tomorrow at 10." } },
  { label: "Learned a word", state: { kind: "learned", words: ["SUBXVoice"] } },
  { label: "No text box", state: { kind: "unplaced", text: "Let's meet tomorrow at 10." } },
];

/**
 * The pill in each of its states, on the dark it usually floats over. The listening bars move,
 * from a made-up voice, so the preview reads as the real thing rather than a diagram.
 */
function PillPreview({ hotkey, liveText, look }: { hotkey: string; liveText: boolean; look: PillStyle }) {
  const { levels, elapsedMs: elapsed } = useFakeVoice();

  return (
    <div className="mb-6 overflow-hidden rounded-[16px] bg-[radial-gradient(120%_140%_at_50%_0%,#3a3530,#0f0e0d)] px-6 py-4">
      <ul className="m-0 list-none divide-y divide-[#f2e8c8]/8 p-0">
        {PREVIEW.map((item) => (
          <li key={item.label} className="flex min-w-0 items-center gap-5 py-2.5">
            <span className="w-28 shrink-0 text-xs text-[#f2e8c8]/55">{item.label}</span>
            <div className="flex h-10 min-w-0 flex-1 items-center justify-center overflow-hidden">
              <PillView
                state={item.state}
                levels={levels}
                hover={item.hover ?? false}
                hotkey={hotkey}
                elapsedMs={elapsed}
                liveText={liveText}
                look={look}
              />
            </div>
            {/* The real pill, wherever it sits, shows this for a few seconds. */}
            <button
              type="button"
              onClick={() => window.subx.pill.demo(item.state)}
              className="shrink-0 rounded-full px-2.5 py-1 text-xs text-[#f2e8c8]/55 transition-colors hover:bg-[#f2e8c8]/10 hover:text-[#f2e8c8]"
            >
              Show on screen
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Where each place sits on the little screen, as grid cells. */
const CELL: Record<PillPlace, string> = {
  "top-left": "col-start-1 row-start-1 justify-self-start self-start",
  top: "col-start-2 row-start-1 justify-self-center self-start",
  "top-right": "col-start-3 row-start-1 justify-self-end self-start",
  left: "col-start-1 row-start-2 justify-self-start self-center",
  right: "col-start-3 row-start-2 justify-self-end self-center",
  "bottom-left": "col-start-1 row-start-3 justify-self-start self-end",
  bottom: "col-start-2 row-start-3 justify-self-center self-end",
  "bottom-right": "col-start-3 row-start-3 justify-self-end self-end",
};

const PLACE_NAME: Record<PillPlace, string> = {
  "top-left": "Top left",
  top: "Top",
  "top-right": "Top right",
  left: "Left",
  right: "Right",
  "bottom-left": "Bottom left",
  bottom: "Bottom",
  "bottom-right": "Bottom right",
};

/** A small screen with the eight places the pill can sit; the chosen one is lit. */
function PlaceMap({ value, onChange }: { value: PillPlace; onChange: (place: PillPlace) => void }) {
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="pressed-in grid aspect-[16/10] w-48 grid-cols-3 grid-rows-3 rounded-[10px] p-2">
        {PILL_PLACES.map((place) => {
          const chosen = place === value;
          return (
            <button
              key={place}
              type="button"
              onClick={() => onChange(place)}
              aria-pressed={chosen}
              aria-label={PLACE_NAME[place]}
              title={PLACE_NAME[place]}
              className={`${CELL[place]} h-2 w-6 rounded-full transition-colors ${
                chosen ? "bg-accent" : "bg-rule-strong hover:bg-ink-faint"
              }`}
            />
          );
        })}
      </div>
      <span className="text-xs text-ink-soft">{PLACE_NAME[value]}</span>
    </div>
  );
}

/** Each look on the dark it floats over, listening to a made-up voice, so the choice is made by seeing it. */
function PillStylePicker({
  value,
  onChange,
  hotkey,
}: {
  value: PillStyle;
  onChange: (style: PillStyle) => void;
  hotkey: string;
}) {
  const { levels, elapsedMs } = useFakeVoice();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {PILL_STYLES.map((style) => {
        const chosen = style.id === value;
        return (
          <button
            key={style.id}
            type="button"
            aria-pressed={chosen}
            onClick={() => onChange(style.id)}
            className={`overflow-hidden rounded-[14px] border text-left transition-colors ${
              chosen ? "border-accent ring-2 ring-accent/40" : "border-rule hover:border-rule-strong"
            }`}
          >
            <div className="grid h-20 place-items-center bg-[radial-gradient(120%_140%_at_50%_0%,#3a3530,#0f0e0d)]">
              <PillView
                state={{ kind: "listening", text: "see you tomorrow" }}
                levels={levels}
                hover={false}
                hotkey={hotkey}
                elapsedMs={elapsedMs}
                liveText={false}
                look={style.id}
              />
            </div>
            <div className="flex items-baseline justify-between gap-2 px-4 py-3">
              <span className="min-w-0">
                <span className="block font-semibold">{style.name}</span>
                <span className="block text-xs text-ink-soft">{style.about}</span>
              </span>
              {chosen && <span className="shrink-0 text-xs font-medium text-accent-ink">In use</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** One style per kind of app, as the server applies them; saved to the account, like the languages. */
function WritingStyles() {
  const voice = useVoiceSettings();
  const styles = voice.settings?.styles ?? DEFAULT_STYLES;
  return (
    <div>
      {voice.problem && (
        <div className="mb-4">
          <Notice role="alert">{voice.problem}</Notice>
        </div>
      )}
      {STYLE_CATEGORIES.map((category) => (
        <Field key={category.id} label={category.label} hint={category.apps}>
          <Select
            label={category.label}
            value={styles[category.id]}
            onChange={(value) => {
              const style = STYLE_OPTIONS.find((option) => option.value === value)?.value;
              if (style) void voice.update({ styles: { ...styles, [category.id]: style } });
            }}
            options={STYLE_OPTIONS}
          />
        </Field>
      ))}
    </div>
  );
}

/** Gone for good: the account, what the server keeps for it, and this Mac's history and recordings. */
/**
 * The computers this account uses SUBXVoice on (the server's devices table), this Mac first. Asked
 * once when the page opens; a computer shows up after its first use of the day.
 */
function YourDevices() {
  const devices = useDevices();
  const sorted = [...(devices ?? [])].sort((a, b) => Number(b.current) - Number(a.current));
  return (
    <Field label="Your devices" hint="The computers this account uses SUBXVoice on.">
      {devices === null ? (
        <p className="text-ink-soft">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="text-ink-soft">Shown after your next dictation.</p>
      ) : (
        <ul className="divide-y divide-rule border-y border-rule">
          {sorted.map((device) => (
            <li key={device.id} className="flex items-center justify-between gap-4 py-2.5">
              <div>
                <p className="font-semibold">
                  {deviceName(device.platform)}
                  {device.chip ? <span className="font-normal text-ink-soft"> · {device.chip}</span> : null}
                </p>
                <p className="text-xs text-ink-soft">
                  {[
                    systemName(device.platform, device.os),
                    device.appVersion ? `SUBXVoice ${device.appVersion}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <span className="shrink-0 text-xs text-ink-soft">
                {device.current ? "This PC" : `Last used ${lastUsed(device.lastSeen)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}

const deviceName = (platform: string | null) =>
  platform === "win" ? "Windows PC" : platform === "mac" ? "Mac" : "Computer";

function systemName(platform: string | null, os: string | null): string | null {
  if (!os) return null;
  return platform === "win" ? `Windows ${os}` : platform === "mac" ? `macOS ${os}` : os;
}

/** "today", "yesterday", "3 days ago", or the date for older ones. */
function lastUsed(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function DeleteAccount() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Field
      label="Delete account"
      hint="Deletes your account, your settings and dictionary on our server, and your history and recordings on this PC. This can't be undone."
    >
      <div className="flex flex-col items-start gap-2">
        <Button
          busy={busy}
          onClick={() => {
            if (!window.confirm("Delete your SUBXVoice account and everything in it? This can't be undone."))
              return;
            setBusy(true);
            setProblem(null);
            void window.subx.auth
              .deleteAccount()
              .catch((error: unknown) => setProblem(errorText(error)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? <Working label="Deleting…" /> : "Delete my account"}
        </Button>
        {problem && <Notice role="alert">{problem}</Notice>}
      </div>
    </Field>
  );
}
