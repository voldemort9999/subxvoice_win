// The small set of shapes every screen is built from. Deliberately not a component library:
// anything used once lives in the page that uses it.
//
// There are no cards. A section is a heading on a hairline, and space does the rest. A box appears
// only where the content really is an object: the typed text, a key, a menu. Things you press are
// raised out of the cream and things that hold a value are pressed into it (styles.css).
import { type ReactNode, useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, MoreIcon } from "./icons";

export function Section({
  title,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border-t border-rule pt-4 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-baseline justify-between gap-3">
          {title && <h2 className="text-[16px]">{title}</h2>}
          {action}
        </div>
      )}
      {/* Wrapped so the first row inside is :first-child and drops its own top rule. */}
      <div>{children}</div>
    </section>
  );
}

/**
 * One number with what it means, set as the headline of its column. `note` is for the caveat the
 * number needs — an assumption, or what it is measured against — so the figure is never read as
 * more certain than it is. `mark` gives it a ultramarine rule: only for the figure that is the result.
 */
export function Figure({
  label,
  value,
  unit,
  note,
  mark = false,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  mark?: boolean;
}) {
  return (
    <div className="min-w-0 px-5 py-4">
      <p className="text-ink-soft">{label}</p>
      {/* A worded value ("under a minute") is set smaller, or it breaks across two lines. */}
      <p
        className={`figure mt-2.5 text-ink ${value.length > 7 ? "text-[19px] leading-[34px] whitespace-nowrap" : "text-[34px]"}`}
      >
        {value}
        {unit && (
          <span className="ml-1 font-sans text-[14px] font-medium tracking-normal text-ink-soft">{unit}</span>
        )}
      </p>
      <span
        className={`mt-3 block h-[3px] w-8 ${mark ? "bg-accent" : "bg-rule-strong"}`}
        aria-hidden="true"
      />
      {note && <p className="mt-2 text-xs text-ink-faint">{note}</p>}
    </div>
  );
}

/** Figures side by side in one tray pressed into the page, like the readout of an instrument. */
export function Figures({ children }: { children: ReactNode }) {
  return (
    <div className="pressed-in grid grid-cols-2 divide-rule rounded-[16px] px-1 py-1 md:grid-cols-4 md:divide-x">
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "quiet",
  type = "button",
  disabled,
  busy = false,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "quiet";
  type?: "button" | "submit";
  disabled?: boolean;
  /** Working on it: takes no clicks, but stays at full colour so the motion inside reads. */
  busy?: boolean;
  className?: string;
}) {
  // Both are raised: a button is something you press. Primary is the one ultramarine thing on a
  // screen; quiet is cream standing up out of cream.
  const variants = {
    primary: "raised-accent text-on-accent",
    quiet: "raised text-ink",
  };
  return (
    <button
      type={type}
      onClick={busy ? undefined : onClick}
      disabled={disabled && !busy}
      aria-busy={busy || undefined}
      className={`rounded-[10px] px-4 py-2 font-semibold transition-[filter,transform] hover:brightness-[1.04] active:translate-y-px disabled:pointer-events-none disabled:opacity-40 ${busy ? "pointer-events-none" : ""} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function IconButton({
  icon: ButtonIcon,
  label,
  onClick,
  className = "",
}: {
  icon: (props: { className?: string }) => ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-[3px] text-ink-soft transition-colors hover:bg-well hover:text-ink ${className}`}
    >
      <ButtonIcon className="h-4 w-4" />
    </button>
  );
}

/** Copies text and says so in place, because a copy with no feedback feels broken. */
export function CopyButton({ text, label = "Copy text" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard access can be refused; leaving the button unchanged is the honest response.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      disabled={!text}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-[3px] transition-colors disabled:opacity-30 ${
        copied ? "bg-accent text-on-accent" : "text-ink-soft hover:bg-well hover:text-ink"
      }`}
    >
      {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
    </button>
  );
}

/** A row of choices; the chosen one sits on a ultramarine underline, which is what "current" means here. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <fieldset className="m-0 flex gap-4 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        const chosen = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={chosen}
            className={`border-b-2 pb-1 font-medium transition-colors ${
              chosen ? "border-accent text-ink" : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}

/** Text inputs and selects share one look: pressed into the cream, ringed in ultramarine on focus. */
export const FIELD =
  "pressed-in w-full rounded-[10px] px-3 py-2.5 text-ink outline-none placeholder:text-ink-faint focus:ring-2 focus:ring-accent/60";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

/** One choice from a list. The hint for the chosen option sits under the control, not in it. */
export function Select({
  value,
  options,
  onChange,
  label,
  empty,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  label: string;
  empty?: string;
}) {
  if (options.length === 0) return <p className="text-ink-soft">{empty ?? "Nothing to choose from."}</p>;
  const chosen = options.find((option) => option.value === value);

  return (
    <div>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${FIELD} max-w-sm`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {chosen?.hint && <p className="mt-1.5 text-xs text-ink-faint">{chosen.hint}</p>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? "bg-accent shadow-[inset_0_2px_4px_rgb(0_0_0/30%)]" : "pressed-in"
      }`}
    >
      <span
        /* left-0 is load-bearing: a button centres its content, so without it the knob's
           static position is mid-track and translate-x pushes it out the right-hand end. */
        className={`raised absolute top-[3px] left-0 h-[18px] w-[18px] rounded-full transition-transform ${
          checked ? "translate-x-[23px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

/** An empty screen is an invitation to act, so it always says what to do next. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-ink-soft">{children}</p>;
}

/**
 * Something that needs the user: a failure, a missing permission. There is no red in this
 * palette, so it is marked the way the accent is spent everywhere else — a ultramarine edge.
 */
export function Notice({ children, role = "status" }: { children: ReactNode; role?: "status" | "alert" }) {
  return (
    <div role={role} className="border-l-[3px] border-accent bg-paper px-3.5 py-2.5 text-ink">
      {children}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-t border-rule py-4 first:border-t-0 first:pt-0 sm:grid sm:grid-cols-[200px_1fr] sm:gap-8">
      <div>
        <p className="font-semibold text-ink">{label}</p>
        {hint && <p className="mt-1 text-xs leading-relaxed text-ink-soft">{hint}</p>}
      </div>
      <div className="mt-2 sm:mt-0">{children}</div>
    </div>
  );
}

export interface MoreItem {
  label: string;
  onClick: () => unknown;
  /** A line above it: set apart, as a delete is. */
  divided?: boolean;
}

/** The ⋮ button and its short menu. Closes on a pick, a click elsewhere, or Esc. */
export function MoreMenu({ items, label = "More" }: { items: MoreItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent ? event.key === "Escape" : !box.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <IconButton icon={MoreIcon} label={label} onClick={() => setOpen(!open)} />
      {open && (
        <div
          role="menu"
          className="absolute top-8 right-0 z-20 w-56 overflow-hidden rounded-[12px] border border-rule bg-paper py-1 shadow-[0_10px_30px_rgb(0_0_0/18%)]"
        >
          {items.map((item) => (
            <div key={item.label}>
              {item.divided && <div className="my-1 border-t border-rule" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  void item.onClick();
                }}
                className="block w-full px-3.5 py-2 text-left text-[13px] text-ink transition-colors hover:bg-well"
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
