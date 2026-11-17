import type { WritingTone } from "@subx/core";
import type { AppInfo, UpdateState } from "../../../shared/ipc";
import { MicrophoneNote, PermissionsIntro } from "../shared/Chrome";
import { followKey } from "../shared/follow";
import { hotkeyLabel } from "../shared/format";
import { HotkeyRecorder } from "../shared/HotkeyRecorder";
import { useAccount, useMicrophones, useSettings, useUpdate } from "../shared/hooks";
import { FolderIcon } from "../shared/icons";
import { PermissionList } from "../shared/PermissionList";
import { TONE_OPTIONS } from "../shared/tones";
import { Button, Field, Notice, Section, Select, Toggle } from "../shared/ui";

const SCRIPTS = [
  {
    value: "native",
    label: "The language's own script",
    hint: "Hindi is written in Devanagari — मैं ठीक हूँ",
  },
  {
    value: "roman",
    label: "Roman letters",
    hint: "Hindi is spelled out in English letters — main theek hoon",
  },
];

export function SettingsPage({ info }: { info: AppInfo | null }) {
  const [settings, update] = useSettings();
  const microphones = useMicrophones();
  const account = useAccount();
  const update$ = useUpdate();
  const hotkey = settings?.hotkey ?? info?.hotkeys[0]?.keys ?? "";
  // Shown only where Follow My Words runs. A key equal to the dictation key is ignored by the app,
  // so the clash is said here rather than left to look like a dead key.
  const follows = Boolean(followKey(info)) || Boolean(settings?.commandHotkey);
  const askKey = settings?.commandHotkey || followKey(info) || "ctrl+alt";
  const sameKey = sameChord(askKey, hotkey);

  return (
    <div className="space-y-10">
      {info && follows && (
        <Section title="Follow My Words">
          <Field
            label="Key"
            hint="Hold, say what you need done, let go. Press any other key while holding to cancel."
          >
            <HotkeyRecorder
              value={askKey}
              presets={[
                ...new Set(["ctrl+alt", ...info.supportedKeys.filter((keys) => !sameChord(keys, hotkey))]),
              ]}
              onChange={(keys) => update({ commandHotkey: keys })}
            />
            {sameKey && (
              <div className="mt-3">
                <Notice role="alert">
                  This is also the dictation key, so it will dictate. Pick a different one.
                </Notice>
              </div>
            )}
          </Field>
        </Section>
      )}

      <Section title="Dictation">
        <Field
          label="Hotkey"
          hint="Hold to dictate, let go to stop. Press any other key while holding to cancel."
        >
          <HotkeyRecorder
            value={hotkey}
            presets={info?.supportedKeys ?? []}
            onChange={(keys) => update({ hotkey: keys })}
          />
        </Field>

        <Field
          label="Written as"
          hint="How languages that don't use Latin letters are written down. Your words are never translated."
        >
          <Select
            label="Written as"
            value={settings?.script ?? "native"}
            onChange={(value) => update({ script: value === "roman" ? "roman" : "native" })}
            options={SCRIPTS}
          />
          {info && !info.providers.llm && settings?.script === "roman" && (
            <div className="mt-3">
              <Notice>
                Roman letters need the rewriting engine, which is unavailable. See Account below.
              </Notice>
            </div>
          )}
        </Field>

        <Field
          label="Microphone"
          hint={
            follows
              ? `Used while you hold ${hotkeyLabel(askKey)} or ${hotkeyLabel(hotkey)}.`
              : `Used while you hold ${hotkeyLabel(hotkey)}.`
          }
        >
          {info && (
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
      </Section>

      <Section title="Startup">
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
      </Section>

      <Section title="Writing">
        <p className="mb-5 max-w-xl text-[14px] leading-relaxed text-ink-soft">
          Ask out loud for an email or a message — “write a mail to my manager about tomorrow's leave” — and
          SUBXVoice writes it instead of typing what you said. Everything else is dictated exactly as spoken.
        </p>
        <Field
          label="Email tone"
          hint="Used when you ask for an email. Emails are always written in English, whatever language you asked in."
        >
          <Select
            label="Email tone"
            value={settings?.emailTone ?? "professional"}
            onChange={(value) => update({ emailTone: value as WritingTone })}
            options={TONE_OPTIONS.map((tone) => ({ value: tone.value, label: tone.label }))}
          />
        </Field>
        <Field
          label="Message tone"
          hint="Used for WhatsApp, SMS and chat replies. Messages stay in the language you spoke."
        >
          <Select
            label="Message tone"
            value={settings?.messageTone ?? "casual"}
            onChange={(value) => update({ messageTone: value as WritingTone })}
            options={TONE_OPTIONS.map((tone) => ({ value: tone.value, label: tone.label }))}
          />
        </Field>
        {/* What the three tones actually sound like, since the names alone don't say. */}
        <dl className="mt-1 grid gap-x-8 gap-y-2 border-t border-rule pt-4 sm:grid-cols-3">
          {TONE_OPTIONS.map((tone) => (
            <div key={tone.value}>
              <dt className="text-xs font-semibold">{tone.label}</dt>
              <dd className="m-0 mt-0.5 text-xs leading-relaxed text-ink-soft">{tone.hint}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Permissions">
        <div className="mb-3">
          <PermissionsIntro />
        </div>
        <PermissionList />
      </Section>

      <Section title="Account">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">{account?.email ?? "Not signed in"}</p>
            <p className="mt-1 text-xs text-ink-soft">
              Speech-to-text and rewriting run on your account. No API keys are stored on this computer.
            </p>
          </div>
          <Button onClick={() => window.subx.auth.signOut()}>Sign out</Button>
        </div>
        <div className="mt-4 space-y-2.5 border-t border-rule pt-4">
          <EngineStatus ready={info?.providers.stt} name="Speech to text" />
          <EngineStatus ready={info?.providers.llm} name="Rewriting and Roman script" />
        </div>
      </Section>

      <Section title="Recordings">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-md text-ink-soft">
            Audio and transcripts are saved only on this computer. Delete any of them from History.
          </p>
          <Button onClick={() => window.subx.app.openRecordingsFolder()}>
            <span className="flex items-center gap-2">
              <FolderIcon className="h-4 w-4" />
              Open recordings folder
            </span>
          </Button>
        </div>
      </Section>

      <Section title="Updates">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="figure-num font-semibold">SUBXVoice {info?.version ?? ""}</p>
            <p className="mt-1 text-xs text-ink-soft">
              <UpdateLine state={update$} />
            </p>
          </div>
          <UpdateAction state={update$} />
        </div>
      </Section>
    </div>
  );
}

/** Says what the updater is doing, in the one line someone glances at to answer "am I current?". */
function UpdateLine({ state }: { state: UpdateState | null }) {
  if (!state) return <>Checking…</>;
  switch (state.kind) {
    case "checking":
      return <>Checking for updates…</>;
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
    case "error":
      // The reason is shown rather than swallowed: a silent updater is one nobody can debug.
      return (
        <span className="font-medium text-accent-ink">Could not check for updates: {state.message}</span>
      );
    case "unsupported":
      return <>{state.reason}</>;
    default:
      return <>Updates are installed automatically.</>;
  }
}

function UpdateAction({ state }: { state: UpdateState | null }) {
  if (state?.kind === "ready") {
    return (
      <Button variant="primary" onClick={() => window.subx.update.install()}>
        Restart and install
      </Button>
    );
  }
  const busy = state?.kind === "checking" || state?.kind === "downloading";
  if (state?.kind === "unsupported") return null;
  return (
    <Button disabled={busy} onClick={() => void window.subx.update.check()}>
      {busy ? "Checking…" : "Check for updates"}
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

function EngineStatus({ ready, name }: { ready: boolean | undefined; name: string }) {
  return (
    <p className="flex items-center gap-2">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${ready ? "bg-ink" : "border border-ink-soft"}`}
        aria-hidden="true"
      />
      <span className="font-semibold">{name}</span>
      <span className={ready ? "text-ink-soft" : "font-medium text-accent-ink"}>
        {ready ? "ready" : "unavailable"}
      </span>
    </p>
  );
}

/** "alt+ctrl" and "ctrl+alt" are the same chord — the main process compares them the same way. */
function sameChord(a: string, b: string): boolean {
  const norm = (keys: string) => keys.toLowerCase().split("+").sort().join("+");
  return norm(a) === norm(b);
}
