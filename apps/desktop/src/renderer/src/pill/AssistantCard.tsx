import type { AssistantEvent, UserReply } from "@subx/core";
import { useEffect, useRef, useState } from "react";

/** A question or approval stays open this long, then folds to a dot and waits (design §4). */
const EXPANDED_MS = 18_000;
/** The last line of a finished run stays readable this long. */
const DONE_MS = 8_000;
/** Hovering this long shows the run's history (design §4). */
const HISTORY_HOVER_MS = 500;

type Pending = Extract<AssistantEvent, { kind: "ask" | "approve" }>;
type Lang = "hi" | "en";

/** The card's own words, in the language of the request — the run's first event says which. */
const LABELS = {
  hi: {
    allow: "Allow",
    deny: "Mat karo",
    needYes: "Aapki haan chahiye",
    question: "Ek sawaal hai",
    speak: "Jawab bolne ke liye Ctrl + Alt dabaiye",
    paused: "Ruk gaya",
    userBusy: "Aap PC use kar rahe hain — ruka hua",
  },
  en: {
    allow: "Allow",
    deny: "Don't",
    needYes: "Needs your OK",
    question: "A question for you",
    speak: "Hold Ctrl + Alt to answer",
    paused: "Paused",
    userBusy: "You're using the PC — paused",
  },
} as const;
type Labels = (typeof LABELS)[Lang];

/**
 * The assistant's minimal capsule (plan T15): what it is doing, its questions with their choices,
 * and Allow / Mat karo for anything that sends, pays, orders or deletes. A click and a spoken
 * answer settle it the same way. The full visual design is a later project.
 */
export function AssistantCard({
  onHover,
  listening = false,
}: {
  onHover(inside: boolean): void;
  /** The user is speaking on a hotkey: the card gets out of the way at once (S-024). */
  listening?: boolean;
}) {
  const [line, setLine] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("hi");
  // The listener is set once; it reads the run's language from here, not from a stale render.
  const langRef = useRef<Lang>("hi");
  const t = LABELS[lang];
  const [pending, setPending] = useState<Pending | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const fold = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () =>
      window.subx.pill.onAssistant((event) => {
        if (event.kind === "working" && event.lang) {
          langRef.current = event.lang;
          setLang(event.lang);
        }
        const text = describe(event, LABELS[langRef.current]);
        if (text) setHistory((h) => [...h.slice(-30), text]);
        clearTimeout(fold.current);
        if (event.kind === "ask" || event.kind === "approve") {
          setPending(event);
          setExpanded(true);
          fold.current = setTimeout(() => setExpanded(false), EXPANDED_MS);
          return;
        }
        // Anything after a question means it was answered (by voice, or a press).
        if (event.kind !== "paused") setPending(null);
        setLine(text ?? null);
        setExpanded(true);
        if (event.kind === "done" || event.kind === "parked")
          fold.current = setTimeout(() => {
            setLine(null);
            setExpanded(false);
            setHistory([]);
          }, DONE_MS);
      }),
    [],
  );

  // Speaking or clicking is the user taking over: a line stays up for its seconds only while they
  // leave it alone — "interaction ki to apne aap hat jana chahiye" (user, S-024). A question
  // still waits, folded, for its answer.
  const dismiss = () => {
    clearTimeout(fold.current);
    setExpanded(false);
    setShowHistory(false);
    setLine(null);
  };
  useEffect(() => {
    if (!listening) return;
    clearTimeout(fold.current);
    setExpanded(false);
    setShowHistory(false);
    setLine(null);
  }, [listening]);

  const reply = (r: UserReply) => {
    window.subx.pill.reply(r);
    setPending(null);
    clearTimeout(fold.current);
  };

  const hover = (inside: boolean) => {
    onHover(inside);
    clearTimeout(hoverTimer.current);
    if (inside) hoverTimer.current = setTimeout(() => setShowHistory(true), HISTORY_HOVER_MS);
    else setShowHistory(false);
  };

  if (!line && !pending) return null;
  const open = expanded || showHistory;

  return (
    <div
      role="dialog"
      aria-live="polite"
      onMouseEnter={() => hover(true)}
      onMouseLeave={() => hover(false)}
      onClick={(e) => {
        // A press on one of its buttons is an answer, handled there; anywhere else closes it.
        if (!(e.target as HTMLElement).closest("button")) dismiss();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") dismiss();
      }}
      className="mb-2 flex max-w-[364px] flex-col gap-2 rounded-2xl border border-silver/15 bg-plate px-3.5 py-2.5 text-silver shadow-[0_4px_14px_rgb(20_4_18/45%)]"
    >
      {showHistory && history.length > 1 && (
        <ol className="max-h-28 overflow-y-auto font-mono text-[11px] text-silver/60">
          {history.slice(0, -1).map((h, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: history lines are positional
            <li key={i} className="truncate">
              {h}
            </li>
          ))}
        </ol>
      )}
      {pending && !open && (
        // Folded: the question is still waiting; hover opens it again.
        <span className="flex items-center gap-2 text-xs">
          <span className="block h-2 w-2 rounded-full bg-marigold" />
          {pending.kind === "approve" ? t.needYes : t.question}
        </span>
      )}
      {pending && open && <Question pending={pending} reply={reply} t={t} />}
      {!pending && line && <span className="text-xs leading-snug">{line}</span>}
    </div>
  );
}

function Question({ pending, reply, t }: { pending: Pending; reply(r: UserReply): void; t: Labels }) {
  if (pending.kind === "approve")
    return (
      <>
        <span className="text-xs leading-snug">
          <span className="font-medium">{pending.what}</span>
          <span className="block text-silver/60">{pending.why}</span>
        </span>
        <span className="flex gap-2">
          <Button primary onClick={() => reply({ kind: "approval", id: pending.id, allowed: true })}>
            {t.allow}
          </Button>
          <Button onClick={() => reply({ kind: "approval", id: pending.id, allowed: false })}>
            {t.deny}
          </Button>
        </span>
      </>
    );
  return (
    <>
      <span className="text-xs leading-snug font-medium">{pending.question}</span>
      {pending.choices?.length ? (
        <span className="flex flex-wrap gap-1.5">
          {pending.choices.map((choice) => (
            <Button key={choice} onClick={() => reply({ kind: "choice", id: pending.id, value: choice })}>
              {choice}
            </Button>
          ))}
        </span>
      ) : (
        <span className="text-[11px] text-silver/60">{t.speak}</span>
      )}
    </>
  );
}

function Button({ primary, onClick, children }: { primary?: boolean; onClick(): void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        primary ? "bg-marigold text-plate" : "border border-silver/25 text-silver"
      }`}
    >
      {children}
    </button>
  );
}

/** One line per event, for the card and its history. */
function describe(event: AssistantEvent, t: Labels): string | undefined {
  switch (event.kind) {
    case "working":
      return `… ${event.text}`;
    case "inform":
    case "parked":
    case "done":
      return event.text;
    case "ask":
      return `? ${event.question}`;
    case "approve":
      return `! ${event.what}`;
    case "draft":
      return event.text;
    case "paused":
      return event.reason === "stop-request" ? t.paused : t.userBusy;
  }
}
