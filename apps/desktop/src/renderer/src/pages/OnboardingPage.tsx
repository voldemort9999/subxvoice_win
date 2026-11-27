import { type FormEvent, useEffect, useRef, useState } from "react";
import { hotkeyLabel } from "../../../shared/hotkey-label";
import type { AppInfo, WritingStyle } from "../../../shared/ipc";
import { AuthShell } from "../shared/AuthShell";
import { errorText } from "../shared/errors";
import { HotkeyRecorder } from "../shared/HotkeyRecorder";
import { usePermissions, useSettings, useVoiceSettings } from "../shared/hooks";
import { shownHotkey } from "../shared/hotkeys";
import { PermissionList } from "../shared/PermissionList";
import { DEFAULT_STYLES, STYLE_OPTIONS } from "../shared/tones";
import { Button, FIELD, Notice, Select } from "../shared/ui";
import { Working } from "../shared/Working";

type Step = "name" | "access" | "hotkey" | "tone";

/** Numbered because it is a sequence: each step is done before the next one is shown. */
const STEPS: { id: Step; title: string }[] = [
  { id: "name", title: "Your name" },
  { id: "access", title: "Allow access" },
  { id: "hotkey", title: "Your keys" },
  { id: "tone", title: "How it writes" },
];

/**
 * Run once, after the first sign-in: a name to greet them by, the key they will hold every time,
 * and how anything written for them should read. All three have working defaults, so this is
 * three confirmations rather than a form to fill in.
 */
export function OnboardingPage({
  info,
  email,
  suggestedName,
}: {
  info: AppInfo | null;
  email: string | null;
  /** Google's first name for the user, so they only have to confirm it. */
  suggestedName: string;
}) {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState(suggestedName);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [settings, update] = useSettings();
  const voice = useVoiceSettings();
  const styles = voice.settings?.styles ?? DEFAULT_STYLES;
  const nameField = useRef<HTMLInputElement>(null);

  // The name field is the only thing on this step, so it takes focus.
  useEffect(() => {
    if (step === "name") nameField.current?.focus();
  }, [step]);

  const hotkey = shownHotkey(settings?.hotkey, info) ?? "ctrl+win";
  const current = STEPS.findIndex((item) => item.id === step);

  function next(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setProblem("Tell us what to call you.");
      return;
    }
    setProblem(null);
    setStep("access");
  }

  async function finish() {
    setBusy(true);
    try {
      await window.subx.auth.setProfile(name.trim());
      // The window swaps itself out once the account reports itself set up.
    } catch (error) {
      setProblem(errorText(error));
      setBusy(false);
    }
  }

  return (
    <AuthShell
      aside={
        <ol className="m-0 list-none space-y-5 p-0">
          {STEPS.map((item, index) => (
            <li
              key={item.id}
              aria-current={index === current ? "step" : undefined}
              className="flex items-baseline gap-4"
            >
              <span
                className={`figure w-6 text-[30px] ${
                  index === current
                    ? "text-stage-accent"
                    : index < current
                      ? "text-stage-ink"
                      : "text-stage-ink/60"
                }`}
              >
                {index + 1}
              </span>
              <span className={index === current ? "font-semibold" : "text-stage-ink/60"}>{item.title}</span>
            </li>
          ))}
        </ol>
      }
    >
      {/* Keyed by step so each one arrives, rather than the form silently changing under the cursor. */}
      <div key={step} className="animate-arrive">
        {step === "name" ? (
          <form onSubmit={next}>
            <h1 className="text-[28px]">What should we call you?</h1>
            <p className="mt-2 mb-7 text-ink-soft">
              Signed in as <span className="font-medium text-ink">{email}</span>.{" "}
              {/* The way back out of setup, for the wrong account or a sign-in that needs redoing. */}
              <button
                type="button"
                onClick={() => void window.subx.auth.signOut()}
                className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-[3px]"
              >
                Use another account
              </button>
            </p>

            <label className="block space-y-1.5">
              <span className="font-semibold">Name</span>
              <input
                className={FIELD}
                value={name}
                onChange={(event) => setName(event.target.value)}
                ref={nameField}
                placeholder="Your name"
                maxLength={60}
              />
            </label>

            {problem && (
              <div className="mt-3">
                <Notice role="alert">{problem}</Notice>
              </div>
            )}

            <Button type="submit" variant="primary" className="mt-6 w-full py-2.5">
              Continue
            </Button>
          </form>
        ) : step === "hotkey" ? (
          <div>
            <h1 className="text-[28px]">Pick your dictation key</h1>
            <p className="mt-2 mb-7 text-ink-soft">
              Hold it anywhere to talk, let go to stop. You can change it later in Settings.
            </p>
            {info?.customHotkeys ? (
              <HotkeyRecorder
                value={hotkey}
                presets={info.supportedKeys}
                onChange={(keys) => update({ hotkey: keys })}
              />
            ) : (
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

            {problem && (
              <div className="mt-3">
                <Notice role="alert">{problem}</Notice>
              </div>
            )}

            <Button variant="primary" onClick={() => setStep("tone")} className="mt-7 w-full py-2.5">
              Continue
            </Button>
            <BackButton onClick={() => setStep("access")} />
          </div>
        ) : step === "access" ? (
          <AccessStep onDone={() => setStep("hotkey")} onBack={() => setStep("name")} />
        ) : (
          <div>
            <h1 className="text-[28px]">How should we write for you?</h1>
            <p className="mt-2 mb-6 leading-relaxed text-ink-soft">
              SUBXVoice turns what you say into clean writing. Choose how it should sound in email and in
              messages. Each kind of app can be set on its own later, in Settings → Writing style.
            </p>

            <ToneChoice
              title="Email"
              value={styles.email}
              onChange={(email) => void voice.update({ styles: { ...styles, email } })}
            />
            <div className="mt-6">
              <ToneChoice
                title="Messages"
                value={styles.personal}
                // One choice for both kinds of chat here; Settings tells them apart.
                onChange={(chat) => void voice.update({ styles: { ...styles, personal: chat, work: chat } })}
              />
            </div>

            {problem && (
              <div className="mt-3">
                <Notice role="alert">{problem}</Notice>
              </div>
            )}

            <Button variant="primary" onClick={finish} busy={busy} className="mt-7 w-full py-2.5">
              {busy ? <Working label="Getting ready..." onAccent /> : `Start with ${hotkeyLabel(hotkey)}`}
            </Button>
            <BackButton onClick={() => setStep("hotkey")} />
          </div>
        )}
      </div>
    </AuthShell>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 w-full py-1 text-center text-ink-soft transition-colors hover:text-ink"
    >
      Back
    </button>
  );
}

/**
 * Three styles as a list rather than a dropdown: the example line is the whole point. The chosen
 * one sits on a blue edge — the same mark the typed text gets on the dashboard.
 */
function ToneChoice({
  title,
  value,
  onChange,
}: {
  title: string;
  value: WritingStyle;
  onChange: (style: WritingStyle) => void;
}) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-2 p-0 font-semibold">{title}</legend>
      <div className="divide-y divide-rule border-y border-rule">
        {STYLE_OPTIONS.map((tone) => {
          const chosen = value === tone.value;
          return (
            <button
              key={tone.value}
              type="button"
              aria-pressed={chosen}
              onClick={() => onChange(tone.value)}
              className={`block w-full border-l-[3px] px-3 py-2.5 text-left transition-colors ${
                chosen ? "border-l-accent bg-paper" : "border-l-transparent hover:bg-well"
              }`}
            >
              <span className="font-semibold">{tone.label}</span>
              <span className="mt-0.5 block text-xs text-ink-soft">{tone.hint}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * The three things macOS must allow, asked for together during setup. Asked one at a time, the
 * first time each was needed, a new Mac could finish setup with none of them: the key did nothing
 * and nothing said why (2026-11-20). "Allow all" asks for each one that has not been allowed;
 * macOS shows its own prompts, and the list updates as they are allowed.
 */
function AccessStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const statuses = usePermissions();
  const [asking, setAsking] = useState(false);
  // "unknown" is a state Electron cannot read (it is shown with a link to check), not a refusal.
  const missing = (statuses ?? []).filter((item) => item.state === "denied" || item.state === "not_asked");
  const allAllowed = statuses !== null && missing.length === 0;

  async function allowAll() {
    setAsking(true);
    try {
      for (const { kind, state } of missing) {
        // A refusal can only be undone in System Settings; open that for the first one, not for all.
        if (state === "denied" && kind !== "accessibility") {
          await window.subx.permissions.openSettings(kind);
          break;
        }
        await window.subx.permissions.request(kind);
      }
    } finally {
      setAsking(false);
    }
  }

  return (
    <div>
      <h1 className="text-[28px]">Allow SUBXVoice to work</h1>
      <p className="mt-2 mb-5 text-ink-soft">
        Windows asks once, for the microphone, so SUBXVoice can hear you. Allow it, then come back here.
      </p>
      <PermissionList />
      {allAllowed ? (
        <Button variant="primary" onClick={onDone} className="mt-7 w-full py-2.5">
          Continue
        </Button>
      ) : (
        <>
          <Button
            variant="primary"
            busy={asking}
            onClick={() => void allowAll()}
            className="mt-7 w-full py-2.5"
          >
            {asking ? <Working label="Opening Windows Settings..." onAccent /> : "Allow"}
          </Button>
          <button
            type="button"
            onClick={onDone}
            className="mt-4 block w-full text-center text-ink-soft underline decoration-rule-strong underline-offset-[3px] hover:text-ink"
          >
            Do this later
          </button>
        </>
      )}
      <BackButton onClick={onBack} />
    </div>
  );
}
