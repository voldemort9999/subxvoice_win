import { BAR_PX, HotkeyNote, MicrophoneNote, PermissionsIntro } from "@platform/Chrome";
import type { MicDevice } from "@subx/core";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
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
import {
  CardIcon,
  CloseIcon,
  FolderIcon,
  GlobeIcon,
  InfoIcon,
  LockIcon,
  PaletteIcon,
  PencilIcon,
  PeopleIcon,
  PersonIcon,
  ShieldIcon,
  SlidersIcon,
  SpeakerIcon,
} from "../shared/icons";
import { LanguagePicker } from "../shared/LanguagePicker";
import { LanguageSelect } from "../shared/LanguageSelect";
import { flag, languageName } from "../shared/languages";
import { MicPicker, micSummary } from "../shared/MicPicker";
import { PermissionList } from "../shared/PermissionList";
import { FONTS, setFont, setTheme, THEMES, useFont, useThemeChoice } from "../shared/themes";
import { DEFAULT_STYLES, STYLE_CATEGORIES, STYLE_OPTIONS } from "../shared/tones";
import { Button, Field, Notice, Select, Toggle } from "../shared/ui";
import { Working } from "../shared/Working";
import { PlanTab } from "./PlanTab";
import { TeamTab } from "./TeamTab";

/**
 * Settings in sections, each named for what is inside so nobody has to open one to find out. The
 * order follows how often a section is needed.
 */
const TABS = [
  {
    id: "general",
    icon: SlidersIcon,
    label: "General",
    about: "Your hotkey, your microphone, and how SUBXVoice starts.",
  },
  {
    id: "dictation",
    icon: GlobeIcon,
    label: "Languages",
    about: "Which languages you speak, and how your words are written down.",
  },
  {
    id: "style",
    icon: PencilIcon,
    label: "Writing style",
    about: "How your words read in each kind of app.",
  },
  {
    id: "sound",
    icon: SpeakerIcon,
    label: "Sound and pill",
    about: "What you hear and see while you speak.",
  },
  {
    id: "appearance",
    icon: PaletteIcon,
    label: "Appearance",
    about: "Colours and fonts for this window. Applied at once.",
  },
  {
    id: "permissions",
    icon: ShieldIcon,
    label: "Permissions",
    about: "What Windows lets SUBXVoice do: hear you, see the key, type.",
  },
  {
    id: "privacy",
    icon: LockIcon,
    label: "Privacy and data",
    about: "Where your recordings and transcripts are kept.",
  },
  { id: "plan", icon: CardIcon, label: "Plan", about: "Your plan, the words you have left, and billing." },
  {
    id: "team",
    icon: PeopleIcon,
    label: "Team",
    about: "Your team: the people in it, the seats, and the words you share.",
  },
  { id: "account", icon: PersonIcon, label: "Account", about: "Who is signed in on this PC." },
  {
    id: "about",
    icon: InfoIcon,
    label: "About and updates",
    about: "The version you have and the newest one.",
  },
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

export function SettingsPage({ info, onClose }: { info: AppInfo | null; onClose: () => void }) {
  const [tab, choose] = useTab();
  const current = TABS.find((item) => item.id === tab) ?? TABS[0];
  const [settings, update] = useSettings();
  const microphones = useMicrophones();
  const account = useAccount();
  const update$ = useUpdate();
  const hotkey = shownHotkey(settings?.hotkey, info) ?? "";
  // A section starts at its top (the Mac panel's scrollTo on a change of section).
  const scroller = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the tab changes.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [tab]);

  return (
    // The Mac app's Settings (SettingsPage.swift): the sections on the left, the app's own first and
    // the account's after a line; the section's name and Close in a bar that stays put while the
    // section scrolls under it (it once sat on the theme cards).
    <div className="flex h-full min-h-0">
      <nav
        aria-label="Settings sections"
        className="scroll-area flex w-[232px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-rule bg-well px-3 py-5"
      >
        <p className="px-2.5 pb-2 text-[13px] font-semibold text-ink-faint">Settings</p>
        {TABS.map((item) => {
          const chosen = item.id === tab;
          const Glyph = item.icon;
          return (
            <Fragment key={item.id}>
              {item.id === "plan" && <div className="mx-2.5 my-2 h-px shrink-0 bg-rule" />}
              <button
                type="button"
                onClick={() => choose(item.id)}
                data-settings-tab
                aria-current={chosen ? "page" : undefined}
                className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-[7px] text-left text-[14px] transition-colors ${
                  chosen
                    ? "bg-paper font-medium text-ink shadow-[0_1px_1px_rgb(0_0_0/6%)]"
                    : "text-ink-soft hover:bg-paper/60 hover:text-ink"
                }`}
              >
                <Glyph className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            </Fragment>
          );
        })}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-4 pt-4 pr-4 pb-1 pl-9">
          <h2 className="min-w-0 flex-1 truncate text-[22px]">{current.label}</h2>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close settings"
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-well text-ink-soft transition-colors hover:text-ink active:scale-95"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        <div ref={scroller} className="scroll-area min-h-0 flex-1 overflow-y-auto">
          <div key={tab} className="animate-arrive min-w-0 px-9 pt-2 pb-10">
            <p className="mb-6 max-w-[576px] text-ink-soft">{current.about}</p>

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
                <PillPreview hotkey={hotkeyLabel(hotkey)} look={settings?.pillStyle ?? "classic"} />
                <Field
                  label="Sounds"
                  hint="A soft tick when the microphone opens, and another when it closes."
                >
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
                  label="Show the pill when idle"
                  hint="Off, the pill appears only while you dictate and hides again afterwards."
                >
                  <Toggle
                    label="Show the pill between dictations"
                    checked={settings?.pillWhenIdle ?? true}
                    onChange={(checked) => update({ pillWhenIdle: checked })}
                  />
                  {/* A hidden pill has no menu of its own to undo the hide from (the Mac app, 7e4b183). */}
                  {(settings?.pillHiddenUntil ?? 0) > Date.now() && (
                    <p className="mt-3 flex flex-wrap items-center gap-3 text-ink-soft">
                      Hidden from its menu until{" "}
                      {new Date(settings?.pillHiddenUntil ?? 0).toLocaleString([], {
                        weekday: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      .
                      <Button onClick={() => update({ pillHiddenUntil: 0 })} className="py-1">
                        Show it now
                      </Button>
                    </p>
                  )}
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

            {tab === "plan" && <PlanTab />}

            {tab === "team" && <TeamTab onOpenPlan={() => choose("plan")} />}

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
  const dark = THEMES.find((option) => option.id === "dark")?.swatch;
  return (
    // One row of three: Match Windows, Light, Dark (the Mac's AppearanceTab).
    <div className="grid grid-cols-3 gap-3">
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
            style={{ background: `linear-gradient(90deg, ${dark?.page} 70%, ${dark?.side})` }}
          />
        </span>
        <span className="mt-3 flex items-center justify-between font-semibold">
          Match Windows
          {choice === "system" && <span className="text-xs font-medium text-accent-ink">In use</span>}
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-ink-soft">
          Light when Windows is light, Dark when it is dark. Changes with it.
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
        <Working label="Loading your language settings..." />
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
  if (!state || state.kind === "checking") return <Working label="Checking for updates..." />;
  switch (state.kind) {
    case "current":
      return <>Up to date, checked {timeAgo(state.checkedAt)}.</>;
    case "downloading":
      return (
        <>
          Downloading {state.version} - {state.percent}%
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
        <Working label={state?.kind === "downloading" ? "Downloading..." : "Checking..."} />
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
  { label: "Listening", state: { kind: "listening" } },
  { label: "Hands-free", state: { kind: "listening", locked: true }, hover: true },
  { label: "Writing", state: { kind: "processing" } },
  { label: "Copied", state: { kind: "done", message: "Copied · paste with Ctrl+V" } },
  { label: "Learned a word", state: { kind: "learned", words: ["SUBXVoice"] } },
  { label: "No text box", state: { kind: "unplaced", text: "Let's meet tomorrow at 10." } },
];

/**
 * The pill in each of its states, on the dark it usually floats over. The listening bars move,
 * from a made-up voice, so the preview reads as the real thing rather than a diagram.
 */
function PillPreview({ hotkey, look }: { hotkey: string; look: PillStyle }) {
  const { levels, elapsedMs: elapsed } = useFakeVoice();

  return (
    <div className="mb-6 overflow-hidden rounded-[16px] bg-[radial-gradient(120%_140%_at_50%_0%,#3a3530,#0f0e0d)] px-6 py-4">
      <ul className="m-0 list-none divide-y divide-[#f2e8c8]/8 p-0">
        {PREVIEW.map((item) => (
          // Narrower than lg, the pill gets a line of its own under its name: squeezed between the
          // name and the button it was cut off mid-word.
          <li
            key={item.label}
            className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 py-2.5 lg:flex-nowrap"
          >
            <span className="w-28 shrink-0 text-xs text-[#f2e8c8]/55">{item.label}</span>
            <div className="order-last flex h-10 min-w-0 basis-full items-center justify-center overflow-hidden lg:order-none lg:basis-0 lg:flex-1">
              <PillView
                state={item.state}
                levels={levels}
                hover={item.hover ?? false}
                hotkey={hotkey}
                elapsedMs={elapsed}
                look={look}
              />
            </div>
            {/* The real pill, wherever it sits, shows this for a few seconds. */}
            <button
              type="button"
              onClick={() => window.subx.pill.demo(item.state)}
              className="ml-auto shrink-0 rounded-full px-2.5 py-1 text-xs text-[#f2e8c8]/55 transition-colors hover:bg-[#f2e8c8]/10 hover:text-[#f2e8c8] lg:ml-0"
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
                state={{ kind: "listening" }}
                levels={levels}
                hover={false}
                hotkey={hotkey}
                elapsedMs={elapsedMs}
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
        <p className="text-ink-soft">Loading...</p>
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
          {busy ? <Working label="Deleting..." /> : "Delete my account"}
        </Button>
        {problem && <Notice role="alert">{problem}</Notice>}
      </div>
    </Field>
  );
}

/**
 * Settings over the page, on a dimmed window, as large as the window allows up to 1000 x 720 (the Mac
 * app's SettingsPanel). Esc or a click outside closes it; Esc is left to a recorder or a pop-up that
 * is open inside it, which closes first.
 */
export function SettingsPanel({ info, onClose }: { info: AppInfo | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[data-settings-panel] [aria-expanded="true"], [data-recording="true"]'))
        return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    // The dimming covers the whole window, Windows' title bar too (its colour follows, useWindowChrome);
    // the panel sits in the room below that bar.
    <div
      data-settings-panel
      style={{ paddingTop: BAR_PX, ["--bar" as string]: `${BAR_PX}px` }}
      className="fixed inset-0 z-40 grid place-items-center"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close settings"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/35 animate-[fade_180ms_ease-out]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="animate-arrive relative h-[min(720px,calc(100vh-48px-var(--bar)))] w-[min(1000px,calc(100vw-64px))] overflow-hidden rounded-[16px] border border-rule bg-page shadow-[0_16px_60px_rgb(0_0_0/25%)]"
      >
        <SettingsPage info={info} onClose={onClose} />
      </div>
    </div>
  );
}
