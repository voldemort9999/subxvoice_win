import type { WritingTone } from "@subx/core";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { AppInfo } from "../../../shared/ipc";
import { AuthShell } from "../shared/AuthShell";
import { followKey } from "../shared/follow";
import { hotkeyLabel } from "../shared/format";
import { HotkeyRecorder } from "../shared/HotkeyRecorder";
import { useSettings } from "../shared/hooks";
import { TONE_OPTIONS } from "../shared/tones";
import { Button, FIELD, Notice } from "../shared/ui";

type Step = "name" | "hotkey" | "tone";

/** Numbered because it is a sequence: each step is done before the next one is shown. */
const STEPS: { id: Step; title: string }[] = [
  { id: "name", title: "Your name" },
  { id: "hotkey", title: "Your keys" },
  { id: "tone", title: "How it writes" },
];

/**
 * Run once, after the first sign-in: a name to greet them by, the key they will hold every time,
 * and how anything written for them should read. All three have working defaults, so this is
 * three confirmations rather than a form to fill in.
 */
export function OnboardingPage({ info, email }: { info: AppInfo | null; email: string | null }) {
  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [settings, update] = useSettings();
  const nameField = useRef<HTMLInputElement>(null);

  // The name field is the only thing on this step, so it takes focus.
  useEffect(() => {
    if (step === "name") nameField.current?.focus();
  }, [step]);

  const hotkey = settings?.hotkey ?? info?.hotkeys[0]?.keys ?? "ctrl+win";
  // Follow My Words comes first when it can run; without its engines this is the dictation key alone.
  const follows = Boolean(followKey(info) || settings?.commandHotkey);
  const askKey = settings?.commandHotkey || followKey(info) || "ctrl+alt";
  const current = STEPS.findIndex((item) => item.id === step);

  function next(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setProblem("Tell us what to call you.");
      return;
    }
    setProblem(null);
    setStep("hotkey");
  }

  async function finish() {
    setBusy(true);
    try {
      await window.subx.auth.setProfile(name.trim());
      // The window swaps itself out once the account reports itself set up.
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
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
                  index === current ? "text-marigold" : index < current ? "text-side-ink" : "text-side-soft"
                }`}
              >
                {index + 1}
              </span>
              <span className={index === current ? "font-semibold" : "text-side-soft"}>{item.title}</span>
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
              Signed in as <span className="font-medium text-ink">{email}</span>.
            </p>

            <label className="block space-y-1.5">
              <span className="font-semibold">Name</span>
              <input
                className={FIELD}
                value={name}
                onChange={(event) => setName(event.target.value)}
                ref={nameField}
                placeholder="Bhavesh"
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
            <h1 className="text-[28px]">{follows ? "Your two keys" : "Pick your dictation key"}</h1>
            <p className="mt-2 mb-7 text-ink-soft">
              {follows
                ? "Hold one to ask, the other to type. Let go to stop. Change either later in Settings."
                : "Hold it anywhere to talk, let go to stop. You can change it later in Settings."}
            </p>

            {follows && info && (
              <div className="mb-7">
                <p className="font-semibold">Follow My Words</p>
                <p className="mt-1 mb-3 text-ink-soft">
                  Hold it while you work and say what you need done — “Pictures wale folder mein mera resume
                  dhoondo”, “WhatsApp pe Aryan ko likho aaj main nahi aa paunga”.
                </p>
                <HotkeyRecorder
                  value={askKey}
                  presets={[...new Set(["ctrl+alt", ...info.supportedKeys])]}
                  onChange={(keys) => update({ commandHotkey: keys })}
                />
              </div>
            )}

            {follows && <p className="font-semibold">Dictation</p>}
            {follows && (
              <p className="mt-1 mb-3 text-ink-soft">Hold it to type by voice, wherever your cursor is.</p>
            )}
            <HotkeyRecorder
              value={hotkey}
              presets={info?.supportedKeys ?? []}
              onChange={(keys) => update({ hotkey: keys })}
            />

            {problem && (
              <div className="mt-3">
                <Notice role="alert">{problem}</Notice>
              </div>
            )}

            <Button variant="primary" onClick={() => setStep("tone")} className="mt-7 w-full py-2.5">
              Continue
            </Button>
            <BackButton onClick={() => setStep("name")} />
          </div>
        ) : (
          <div>
            <h1 className="text-[28px]">How should we write for you?</h1>
            <p className="mt-2 mb-6 leading-relaxed text-ink-soft">
              On the dictation key, ask for an email or a message out loud — “write a mail to my manager about
              tomorrow's leave” — and SUBXVoice writes it instead of typing what you said. This is the voice
              it uses. Change it any time in Settings.
            </p>

            <ToneChoice
              title="Email"
              value={settings?.emailTone ?? "professional"}
              onChange={(emailTone) => update({ emailTone })}
            />
            <div className="mt-6">
              <ToneChoice
                title="Messages"
                value={settings?.messageTone ?? "casual"}
                onChange={(messageTone) => update({ messageTone })}
              />
            </div>

            {problem && (
              <div className="mt-3">
                <Notice role="alert">{problem}</Notice>
              </div>
            )}

            <Button variant="primary" onClick={finish} disabled={busy} className="mt-7 w-full py-2.5">
              {busy ? "One moment…" : `Start with ${hotkeyLabel(follows ? askKey : hotkey)}`}
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
 * Three tones as a list rather than a dropdown: the example line is the whole point. The chosen
 * one sits on a Marigold edge — the same mark the typed text gets on the dashboard.
 */
function ToneChoice({
  title,
  value,
  onChange,
}: {
  title: string;
  value: WritingTone;
  onChange: (tone: WritingTone) => void;
}) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-2 p-0 font-semibold">{title}</legend>
      <div className="divide-y divide-rule border-y border-rule">
        {TONE_OPTIONS.map((tone) => {
          const chosen = value === tone.value;
          return (
            <button
              key={tone.value}
              type="button"
              aria-pressed={chosen}
              onClick={() => onChange(tone.value)}
              className={`block w-full border-l-[3px] px-3 py-2.5 text-left transition-colors ${
                chosen ? "border-l-marigold bg-paper" : "border-l-transparent hover:bg-well"
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
