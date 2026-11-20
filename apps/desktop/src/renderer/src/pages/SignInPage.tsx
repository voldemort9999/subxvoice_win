import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import type { CodeSent, LastGoogleAccount } from "../../../shared/ipc";
import { AuthShell } from "../shared/AuthShell";
import { errorText } from "../shared/errors";
import { Button, FIELD, Notice } from "../shared/ui";
import { Working } from "../shared/Working";

/**
 * The account flow: Google, or an email and the 6-digit code it receives. For a new address the
 * same code creates the account (setup then asks for the name); Google and the code reach the same
 * account for the same address. No links, no passwords. The window swaps itself out once signed in.
 */
export function SignInPage({ lastGoogle }: { lastGoogle: LastGoogleAccount | null }) {
  const [step, setStep] = useState<"start" | "code">("start");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Separate from `busy`: the browser may sit open for minutes, and the form stays usable meanwhile.
  const [googleOpen, setGoogle] = useState(false);
  const codeField = useRef<HTMLInputElement>(null);
  // When another code may be asked for (the main process keeps the real limit; this is the display).
  const [resendAt, setResendAt] = useState(0);
  const [codesLeft, setCodesLeft] = useState(3);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (step === "code") codeField.current?.focus();
  }, [step]);

  const waiting = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => {
    if (step !== "code" || resendAt <= Date.now()) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [step, resendAt]);

  const google = (chooseAccount: boolean) => {
    setGoogle(true);
    setProblem(null);
    void window.subx.auth
      .signInWithGoogle({ chooseAccount })
      .catch((error: unknown) => setProblem(errorText(error)))
      .finally(() => setGoogle(false));
  };

  const paced = (sent: CodeSent) => {
    setNow(Date.now());
    setResendAt(Date.now() + sent.resendIn * 1000);
    setCodesLeft(sent.left);
  };

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    setNote(null);
    try {
      await action();
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  const sendEmail = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      paced(await window.subx.auth.startEmail(email));
      setCode("");
      setStep("code");
    });
  };

  const verify = (value: string) =>
    run(async () => {
      try {
        await window.subx.auth.verifyCode(value);
      } catch (error) {
        // A wrong code is cleared, so the next try starts from an empty field.
        setCode("");
        codeField.current?.focus();
        throw error;
      }
    });

  const back = () => {
    setStep("start");
    setCode("");
    setProblem(null);
    setNote(null);
  };

  if (step === "code") {
    return (
      <AuthShell>
        <h1 className="text-[28px]">Check your email</h1>
        <p className="mt-2 text-ink-soft">Enter the 6-digit code we sent to</p>
        <p className="mt-1 mb-7 font-semibold break-all text-ink">{email}</p>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (code.length === 6) void verify(code);
          }}
        >
          <Labelled id="code" label="Code">
            <input
              id="code"
              ref={codeField}
              className={`${FIELD} figure-num text-center text-[22px] tracking-[0.5em]`}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              pattern="\d{6}"
              value={code}
              disabled={busy}
              onChange={(event) => {
                const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(digits);
                // Six digits is the whole code: no button to press.
                if (digits.length === 6) void verify(digits);
              }}
              placeholder="000000"
            />
          </Labelled>

          {problem && <Notice role="alert">{problem}</Notice>}
          {note && <p className="text-ink-soft">{note}</p>}

          <Button
            type="submit"
            variant="primary"
            disabled={code.length !== 6}
            busy={busy}
            className="w-full py-2.5"
          >
            {busy ? <Working label="Signing in…" onAccent /> : "Continue"}
          </Button>
        </form>

        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-ink-soft">
          {waiting > 0 ? (
            <span className="figure-num font-semibold text-ink-faint" aria-live="off">
              Resend code in {clock(waiting)}
            </span>
          ) : (
            <Switch
              lead=""
              label="Resend code"
              onClick={() =>
                void run(async () => {
                  paced(await window.subx.auth.resendEmailCode());
                  setCode("");
                  setNote("A new code is on its way. Use the newest one.");
                })
              }
            />
          )}
          <Switch lead="" label="Use a different email" onClick={back} />
        </div>
        {codesLeft === 0 && waiting > 0 && (
          <p className="mt-3 text-ink-soft">
            That's 3 codes in 10 minutes. You can ask again in {clock(waiting)}, or continue with Google.
          </p>
        )}
        <p className="mt-10 text-xs text-ink-faint">No email? Check your spam folder.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="text-[28px]">Welcome to SUBXVoice</h1>
      <p className="mt-2 mb-7 text-ink-soft">Sign in or create your account. It takes a minute.</p>

      {lastGoogle ? (
        // The account last used here, one press away; the list of accounts only when asked for.
        <div className="rounded-2xl border border-rule p-4">
          <div className="flex items-center gap-3">
            {lastGoogle.photo ? (
              <img src={lastGoogle.photo} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent font-display text-[16px] [font-weight:var(--display-weight)] text-on-accent">
                {(lastGoogle.name || lastGoogle.email).slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="min-w-0">
              {lastGoogle.name && <span className="block truncate font-semibold">{lastGoogle.name}</span>}
              <span className="block truncate text-ink-soft">{lastGoogle.email}</span>
            </span>
          </div>
          <Button className="mt-4 w-full py-2.5" busy={googleOpen} onClick={() => google(false)}>
            {googleOpen ? (
              <Working label="Finish in your browser…" />
            ) : (
              <span className="inline-flex items-center justify-center gap-2.5">
                <GoogleMark />
                Continue as {lastGoogle.name.split(" ")[0] || lastGoogle.email}
              </span>
            )}
          </Button>
          <p className="mt-3 text-center text-ink-soft">
            <Switch lead="" label="Switch account" onClick={() => google(true)} />
          </p>
        </div>
      ) : (
        <Button className="w-full py-2.5" busy={googleOpen} onClick={() => google(true)}>
          {googleOpen ? (
            <Working label="Finish in your browser…" />
          ) : (
            <span className="inline-flex items-center justify-center gap-2.5">
              <GoogleMark />
              Continue with Google
            </span>
          )}
        </Button>
      )}
      <div className="my-5 flex items-center gap-3 text-xs text-ink-faint" aria-hidden="true">
        <span className="h-px flex-1 bg-rule" />
        or
        <span className="h-px flex-1 bg-rule" />
      </div>

      <form onSubmit={sendEmail} className="space-y-4">
        <Labelled id="email" label="Email">
          <input
            id="email"
            className={FIELD}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />
        </Labelled>
        {problem && <Notice role="alert">{problem}</Notice>}
        <Button type="submit" variant="primary" busy={busy} className="w-full py-2.5">
          {busy ? <Working label="Sending your email…" onAccent /> : "Continue with email"}
        </Button>
      </form>

      <p className="mt-10 text-xs text-ink-faint">
        New here? The code creates your account. Recordings stay on this computer.
      </p>
    </AuthShell>
  );
}

/** 75 → "1:15". */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Google's "G", in its own colours: their guidelines ask for it unchanged on a sign-in button. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** A field: its label (pointing at the input by `id`), something beside it, then the input. */
function Labelled({
  id,
  label,
  extra,
  children,
}: {
  id: string;
  label: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="font-semibold">
          {label}
        </label>
        {extra}
      </div>
      {children}
    </div>
  );
}

function Switch({ lead, label, onClick }: { lead: string; label: string; onClick: () => void }) {
  return (
    <>
      {lead}
      <button
        type="button"
        onClick={onClick}
        className="font-semibold text-ink underline decoration-accent decoration-2 underline-offset-[3px]"
      >
        {label}
      </button>
    </>
  );
}
