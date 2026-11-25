import { useCallback, useEffect, useState } from "react";
import type { TeamInfo } from "../../../shared/ipc";
import { errorText } from "../shared/errors";
import { Button, Field, Notice } from "../shared/ui";

/**
 * The team (Team and Enterprise plans): who is in it, how many seats are used, and the words the
 * whole team shares. Owners and admins add and remove people and see how much each one dictates
 * (counts only). Everyone adds team words; each changes only their own, owners and admins any.
 * A member can leave on their own. Someone added joins the first time they use SUBXVoice with that
 * email.
 */
export function TeamTab({ onOpenPlan }: { onOpenPlan: () => void }) {
  const [info, setInfo] = useState<TeamInfo | null | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => void window.subx.team.get().then(setInfo, () => setInfo(null)), []);
  useEffect(load, [load]);

  const act = async (work: () => Promise<void>, done?: string) => {
    setProblem(null);
    setNote(null);
    try {
      await work();
      if (done) setNote(done);
      load();
    } catch (error) {
      setProblem(errorText(error));
    }
  };

  if (info === undefined) return <p className="text-ink-soft">Loading...</p>;
  if (info === null)
    return (
      <div className="space-y-3">
        <Notice>Can't reach the SUBXVoice server to show your team. Check your connection.</Notice>
        <Button onClick={load}>Try again</Button>
      </div>
    );

  if (!info.team) {
    return info.canStart ? (
      <StartTeam
        onStart={(name) => act(() => window.subx.team.save(name), "Your team is ready. Add people below.")}
      />
    ) : (
      <div className="space-y-3">
        <p>
          With the Team plan, one bill covers everyone, the team shares a dictionary of names and terms, and
          you add or remove people here.
        </p>
        <Button onClick={onOpenPlan}>See the Team plan</Button>
        <p className="text-xs text-ink-soft">
          Already in someone's team? Sign in with the email they added, and it shows up here.
        </p>
      </div>
    );
  }

  const team = info.team;
  const manage = team.role === "owner" || team.role === "admin";
  const prepaidUntil = team.billing?.prepaidUntil;
  return (
    <div>
      {team.seated === false && (
        <div className="mb-4">
          <Notice role="alert">
            Your seat in this team isn't paid for yet, so you're on your own plan for now. Ask the team's
            owner to check their payment.
          </Notice>
        </div>
      )}
      {team.paysOwnPlan && (
        <div className="mb-4">
          <Notice>
            The team covers your plan, and you're also paying for one yourself. You can cancel yours in Plan,
            Manage billing.{" "}
            <button type="button" className="underline" onClick={onOpenPlan}>
              Open Plan
            </button>
          </Notice>
        </div>
      )}
      <Field label="Team" hint={manage ? "Everyone here has the team's plan." : "You have this team's plan."}>
        <TeamName
          name={team.name}
          editable={manage}
          onSave={(name) => act(() => window.subx.team.save(name))}
        />
        <p className="mt-1 text-xs text-ink-soft">
          {team.billing?.perPerson
            ? billedLine(team.billing.billedPeople, team.billing.pricePerPerson)
            : `${team.members.length} of ${team.seats} seats used${prepaidUntil ? `, paid until ${shortDate(prepaidUntil)}` : ""}`}
        </p>
      </Field>
      <Field
        label="People"
        hint={manage ? "Someone you add joins the first time they use SUBXVoice with that email." : undefined}
      >
        <ul className="divide-y divide-rule border-y border-rule">
          {team.members.map((member) => (
            <li key={member.email} className="flex items-center justify-between gap-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  {member.name || member.email}
                  {member.you ? <span className="font-normal text-ink-soft"> (you)</span> : null}
                </p>
                <p className="truncate text-xs text-ink-soft">
                  {member.name ? `${member.email}, ` : ""}
                  {member.role === "owner" ? "owner" : member.role === "admin" ? "admin" : "member"}
                  {member.joinedAt ? "" : ", hasn't signed in yet"}
                </p>
                {manage && member.joinedAt && member.weekWords !== undefined && (
                  <p className="text-xs text-ink-soft">
                    {usageLine(member.weekWords, member.lastDay ?? null)}
                  </p>
                )}
              </div>
              {manage && member.role !== "owner" && !member.you && (
                <Button
                  onClick={() => {
                    if (
                      confirm(
                        team.billing?.perPerson
                          ? `Remove ${member.email} from the team? They go back to their own plan, and their seat stops being billed now (nothing is refunded for the days left).`
                          : `Remove ${member.email} from the team? They go back to their own plan.`,
                      )
                    )
                      void act(() => window.subx.team.remove(member.email));
                  }}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
        {manage && (team.billing?.perPerson || team.members.length < team.seats) && (
          <AddPerson
            cost={team.billing?.perPerson ? costLine(team.billing.pricePerPerson) : null}
            owner={team.role === "owner"}
            onAdd={(email, admin) =>
              act(
                () => window.subx.team.invite(email, admin),
                `Added. Ask them to sign in to SUBXVoice with ${email}.`,
              )
            }
          />
        )}
        {manage && prepaidUntil && team.role === "owner" && (
          <AddSeats full={team.members.length >= team.seats} until={prepaidUntil} />
        )}
        {manage && !team.billing?.perPerson && team.members.length >= team.seats && !prepaidUntil && (
          <p className="mt-3 text-xs text-ink-soft">
            All seats are used. Add seats from Settings, Plan, Manage billing.
          </p>
        )}
        {manage && prepaidUntil && team.role !== "owner" && team.members.length >= team.seats && (
          <p className="mt-3 text-xs text-ink-soft">
            All seats are used. The team's owner can buy more here.
          </p>
        )}
      </Field>
      <Field
        label="Team words"
        hint="Names and terms the whole team uses. Everyone's dictations know them. Anyone in the team can add one; you can remove your own."
      >
        <TeamWords
          words={team.words}
          onAdd={(word) => act(() => window.subx.team.words({ upsert: [{ word, misheardAs: [] }] }))}
          onRemove={(word) => act(() => window.subx.team.words({ remove: [word] }))}
        />
      </Field>
      {team.role !== "owner" && (
        <Field label="Leave the team" hint="You go back to your own plan at once. Your own words stay yours.">
          <Button
            onClick={() => {
              if (confirm(`Leave ${team.name}? You go back to your own plan.`))
                void act(() => window.subx.team.leave(), "You left the team.");
            }}
          >
            Leave team
          </Button>
        </Field>
      )}
      {problem && <Notice role="alert">{problem}</Notice>}
      {note && <Notice>{note}</Notice>}
    </div>
  );
}

type Price = { amount: number; currency: string; per: "month" | "year" };
const money = (price: Price, times = 1) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: price.currency,
    maximumFractionDigits: 0,
  }).format(price.amount * times);

/** "Billed for 7 people, ₹3,143 a month": the bill is the people who have joined. */
function billedLine(people: number, price: Price | undefined): string {
  const who = `Billed for ${people} ${people === 1 ? "person" : "people"}`;
  return price
    ? `${who}, ${money(price, people)} a month${price.per === "year" ? ", billed yearly" : ""}`
    : who;
}

/** What adding someone costs, said before they are added. */
function costLine(price: Price | undefined): string {
  return price
    ? `Each person adds ${money(price)} a month from when they join (this ${price.per}: only the days left). Nothing is charged for an invitation, and someone removed stops at once.`
    : "Each person is billed from when they join. Nothing is charged for an invitation.";
}

/** "420 words this week, last used today": counts only, never what anyone said. */
function usageLine(words: number, lastDay: string | null): string {
  const count = `${new Intl.NumberFormat("en").format(words)} ${words === 1 ? "word" : "words"} this week`;
  if (!lastDay) return `${count}, not used yet`;
  const today = new Date();
  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(today.getTime() - 86_400_000);
  const when =
    lastDay === key(today)
      ? "today"
      : lastDay === key(yesterday)
        ? "yesterday"
        : new Date(`${lastDay}T12:00:00`).toLocaleDateString("en", { day: "numeric", month: "short" });
  return `${count}, last used ${when}`;
}

function StartTeam({ onStart }: { onStart: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <Field label="Start your team" hint="You're on the Team plan. Name the team, then add people.">
      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-[220px] rounded-[10px] border border-rule bg-paper px-3 py-1.5"
          placeholder="Team name"
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
        />
        <Button variant="primary" onClick={() => onStart(name.trim() || "My team")}>
          Start team
        </Button>
      </div>
    </Field>
  );
}

function TeamName({
  name,
  editable,
  onSave,
}: {
  name: string;
  editable: boolean;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  if (!editable) return <p className="font-display text-[20px]">{name}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      <input
        className="min-w-[220px] rounded-[10px] border border-rule bg-paper px-3 py-1.5"
        value={value}
        maxLength={60}
        onChange={(event) => setValue(event.target.value)}
      />
      {value.trim() && value.trim() !== name && (
        <Button onClick={() => onSave(value.trim())}>Save name</Button>
      )}
    </div>
  );
}

function AddPerson({
  owner,
  cost,
  onAdd,
}: {
  owner: boolean;
  cost: string | null;
  onAdd: (email: string, admin: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [admin, setAdmin] = useState(false);
  return (
    <div className="mt-3">
      {cost && <p className="mb-2 text-xs text-ink-soft">{cost}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          className="min-w-[240px] rounded-[10px] border border-rule bg-paper px-3 py-1.5"
          placeholder="Their email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        {owner && (
          <label className="flex items-center gap-1.5 text-xs text-ink-soft">
            <input type="checkbox" checked={admin} onChange={(event) => setAdmin(event.target.checked)} />
            Can manage the team
          </label>
        )}
        <Button
          disabled={!email.trim()}
          onClick={() => {
            onAdd(email.trim(), admin);
            setEmail("");
            setAdmin(false);
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function TeamWords({
  words,
  onAdd,
  onRemove,
}: {
  words: { word: string; addedBy?: string | null; canChange?: boolean }[];
  onAdd: (word: string) => void;
  onRemove: (word: string) => void;
}) {
  const [word, setWord] = useState("");
  return (
    <div>
      {words.length === 0 ? (
        <p className="text-ink-soft">No team words yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {words.map((entry) => (
            <span
              key={entry.word}
              title={entry.addedBy ? `Added by ${entry.addedBy}` : undefined}
              className="inline-flex items-center gap-1 rounded-[8px] border border-rule bg-paper px-2.5 py-1 text-[13px]"
            >
              {entry.word}
              {entry.canChange && (
                <button
                  type="button"
                  aria-label={`Remove ${entry.word}`}
                  className="px-1 text-ink-soft hover:text-ink"
                  onClick={() => onRemove(entry.word)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          className="min-w-[220px] rounded-[10px] border border-rule bg-paper px-3 py-1.5"
          placeholder="A name or term"
          value={word}
          maxLength={60}
          onChange={(event) => setWord(event.target.value)}
        />
        <Button
          disabled={!word.trim()}
          onClick={() => {
            onAdd(word.trim());
            setWord("");
          }}
        >
          Add word
        </Button>
      </div>
    </div>
  );
}

const shortDate = (at: string) =>
  new Date(at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

/**
 * More seats for a team paid once: the price is asked first (for the months left, at the rate the
 * team was bought at) and said before the payment page opens, so nobody pays a surprise.
 */
function AddSeats({ full, until }: { full: boolean; until: string }) {
  const [add, setAdd] = useState(1);
  const [quote, setQuote] = useState<{ add: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "error" } | null>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      setMessage({ text: errorText(error), kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-2">
      <p className="text-xs text-ink-soft">
        {full ? "All seats are used. " : ""}More seats are paid for the time left, until {shortDate(until)}.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[13px]">
          Seats to add
          <input
            type="number"
            min={1}
            max={500}
            value={add}
            onChange={(event) => {
              setAdd(Math.min(500, Math.max(1, Math.floor(Number(event.target.value) || 1))));
              setQuote(null);
            }}
            className="w-20 rounded-[8px] border border-rule bg-page px-2 py-1"
          />
        </label>
        {quote?.add === add ? (
          <Button
            variant="primary"
            busy={busy}
            onClick={() =>
              void run(async () => {
                await window.subx.billing.addSeats(add);
                setMessage({
                  text: "Finish paying in your browser. The seats show up here as soon as you're done.",
                  kind: "ok",
                });
              })
            }
          >
            Pay {quote.text}
          </Button>
        ) : (
          <Button
            busy={busy}
            onClick={() =>
              void run(async () => {
                const q = await window.subx.billing.seatsQuote(add);
                const months = `${q.months} month${q.months === 1 ? "" : "s"}`;
                setQuote({ add, text: money({ amount: q.amount, currency: q.currency, per: "month" }) });
                setMessage({
                  text: `${q.add} seat${q.add === 1 ? "" : "s"} for ${months}: ${money({ amount: q.amount, currency: q.currency, per: "month" })}, paid once.`,
                  kind: "ok",
                });
              })
            }
          >
            See the price
          </Button>
        )}
      </div>
      {message && <Notice role={message.kind === "error" ? "alert" : "status"}>{message.text}</Notice>}
    </div>
  );
}
