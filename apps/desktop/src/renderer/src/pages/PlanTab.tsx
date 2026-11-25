import { useState } from "react";
import type { Billing, BillingInterval, BillingPlan } from "../../../shared/ipc";
import { errorText } from "../shared/errors";
import { useBilling, useUsage } from "../shared/hooks";
import { Button, Field, Notice } from "../shared/ui";

/**
 * The plan: what this account has, its words, and how to change it. Names, limits and prices all
 * come from the server, so they can change without a new release. Paying happens in the browser,
 * on the payment company's page; nothing about a card passes through the app.
 */
export function PlanTab() {
  const usage = useUsage();
  const { billing, reload } = useBilling(usage?.plan);
  if (billing === undefined) return <p className="text-ink-soft">Loading...</p>;
  if (billing === null)
    return (
      <div className="space-y-3">
        <Notice>Can't reach the SUBXVoice server to show your plan. Check your connection.</Notice>
        <Button onClick={reload}>Try again</Button>
      </div>
    );

  const plan = billing.plans.find((item) => item.id === billing.plan);
  const words = usage?.words;
  // A team member's plan is paid by the team's owner: nothing here for them to manage or buy.
  const covered = billing.provider === "team";
  const paying =
    !!billing.provider && !covered && billing.provider !== "trial" && billing.provider !== "manual";
  const failed = billing.status === "past_due" || billing.status === "on_hold";
  return (
    <div>
      <Field label="Your plan" hint={statusLine(billing)}>
        <p className="font-display text-[22px] [font-weight:var(--display-weight)]">{plan?.name ?? "Free"}</p>
        {failed && (
          <div className="mt-3">
            <Notice role="alert">{failedLine(billing)}</Notice>
          </div>
        )}
        {paying && <ManageBilling />}
      </Field>
      <Field
        label="Words"
        hint={
          words?.resetsAt
            ? `They come back ${words.per === "week" ? "every Monday" : "every night"}.`
            : undefined
        }
      >
        {!words ? (
          <p className="text-ink-soft">Shown after your next dictation.</p>
        ) : words.unlimited ? (
          <p>
            Unlimited.{" "}
            <span className="text-ink-soft">
              You've typed {words.used.toLocaleString("en-US")} words this {words.per}.
            </span>
          </p>
        ) : words.out ? (
          <p>You've used this {words.per}'s free words.</p>
        ) : (
          // A share, never a count: how many free words there are is not shown.
          <div>
            <p>
              <span className="figure-num font-semibold">{100 - (words.percentUsed ?? 0)}%</span> of this{" "}
              {words.per}'s free words left.
            </p>
            <span
              className="mt-2 block h-1.5 max-w-[320px] overflow-hidden rounded-full bg-rule"
              aria-hidden="true"
            >
              <span
                className="block h-full rounded-full bg-accent"
                style={{ width: `${100 - (words.percentUsed ?? 0)}%` }}
              />
            </span>
          </div>
        )}
      </Field>
      {!paying && !covered && <Upgrade billing={billing} />}
      {paying && billing.once && <Upgrade billing={billing} addTime />}
    </div>
  );
}

const longDate = (at: string | number) =>
  new Date(at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

/** The server keeps a plan this long past its renewal while a payment is retried (billing.ts). */
const RETRY_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

function failedLine(billing: Billing): string {
  const end = billing.periodEnd ? longDate(new Date(billing.periodEnd).getTime() + RETRY_GRACE_MS) : null;
  return end
    ? `Your last payment didn't go through. Update your card in Manage billing before ${end}, or your plan moves to Free.`
    : "Your last payment didn't go through. Update your card in Manage billing, or your plan moves to Free.";
}

function statusLine(billing: Billing): string {
  const date = billing.periodEnd ? longDate(billing.periodEnd) : null;
  if (billing.provider === "team") return "Your team pays for it.";
  if (billing.status === "trialing")
    return date ? `Free trial until ${date}. No card needed.` : "Free trial.";
  if (billing.provider === "manual")
    return date ? `Given to you until ${date}.` : "Given to you by SUBXVoice.";
  if (billing.plan === "free") return "Free, for as long as you like.";
  if (!date) return "Active.";
  if (billing.once) return `Paid until ${date}. No autopay: pay again below to add more time.`;
  return billing.cancelAtPeriodEnd ? `Ends on ${date}. You won't be charged again.` : `Renews on ${date}.`;
}

function ManageBilling() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <div className="mt-3 space-y-2">
      <Button
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setProblem(null);
          try {
            await window.subx.billing.portal();
          } catch (error) {
            setProblem(errorText(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        Manage billing
      </Button>
      <p className="text-xs text-ink-soft">
        Change your card, see invoices, switch plans or cancel, in your browser.
      </p>
      {problem && <Notice role="alert">{problem}</Notice>}
    </div>
  );
}

/** In the currency the server chose for this person (where they are); there is no switch. */
const money = (amount: number, currency: Billing["currency"]) =>
  currency === "INR" ? `₹${amount.toLocaleString("en-IN")}` : `$${amount.toLocaleString("en-US")}`;

/**
 * `addTime`: the plan was paid once and is still on; paying once again adds to its end (the server
 * refuses autopay on top of days already paid for, so only "Pay once" is offered).
 */
function Upgrade({ billing, addTime = false }: { billing: Billing; addTime?: boolean }) {
  const [interval, setInterval] = useState<BillingInterval>("year");
  const canPayOnce = billing.plans.some((plan) => plan.buyableOnce?.month || plan.buyableOnce?.year);
  const [mode, setMode] = useState<"auto" | "once">(addTime ? "once" : "auto");
  const [seats, setSeats] = useState(2);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "error" } | null>(null);
  const once = mode === "once";
  const forSale = billing.plans.filter(
    (plan): plan is BillingPlan & { price: NonNullable<BillingPlan["price"]> } =>
      Boolean(plan.price) && (!addTime || plan.id === billing.plan),
  );
  const teams = billing.plans.find((plan) => plan.id === "team");
  if (addTime && !canPayOnce) return null;

  // On autopay, Team is bought for the owner alone and each person added is billed from when they
  // join. Paid once, there is nothing to bill later, so the seats are chosen and paid up front.
  const buy = async (plan: "pro" | "power") => {
    setBusy(plan);
    setMessage(null);
    try {
      await window.subx.billing.checkout(
        once ? { plan, interval, once: true, ...(plan === "power" ? { seats } : {}) } : { plan, interval },
      );
      setMessage({
        text: "Finish paying in your browser. Your plan changes here as soon as you're done.",
        kind: "ok",
      });
    } catch (error) {
      setMessage({ text: errorText(error), kind: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Field
      label={addTime ? "Add time" : "Upgrade"}
      hint={
        once
          ? "Paid once, no autopay. Your plan ends when the time you paid for runs out; pay again any time to add more."
          : "Cancel any time. You keep your plan until the end of what you paid for."
      }
    >
      <div className="flex flex-wrap gap-2">
        {canPayOnce && !addTime && (
          <Toggle
            options={[
              ["auto", "Autopay"],
              ["once", "Pay once"],
            ]}
            value={mode}
            onChange={setMode}
          />
        )}
        <Toggle
          options={[
            ["month", once ? "1 month" : "Monthly"],
            ["year", once ? "1 year" : "Yearly"],
          ]}
          value={interval}
          onChange={setInterval}
        />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {forSale.map((plan) => {
          const price = plan.price;
          const open = billing.canBuy && !!(once ? plan.buyableOnce : plan.buyable)?.[interval];
          const perPerson = plan.id === "power" ? ", per person" : "";
          const months = interval === "year" ? 12 : 1;
          const people = plan.id === "power" && once ? seats : 1;
          return (
            <div
              key={plan.id}
              className={`rounded-[14px] border p-4 ${plan.id === billing.popular ? "border-accent" : "border-rule"} bg-paper`}
            >
              <p className="font-semibold">{plan.name}</p>
              <p className="mt-1">
                <span className="figure-num font-display text-[24px]">
                  {money(price[interval], billing.currency)}
                </span>
                <span className="text-xs text-ink-soft">
                  {" "}
                  a month{perPerson}
                  {once
                    ? `, ${money(price[interval] * months * people, billing.currency)} paid now`
                    : interval === "year"
                      ? `, ${money(price.year * 12, billing.currency)} billed yearly`
                      : ""}
                </span>
              </p>
              <p className="mt-1 text-xs text-ink-soft">
                {plan.unlimited ? "Unlimited words" : `Free words every ${plan.per}`}
                {plan.id !== "power"
                  ? "."
                  : once
                    ? " for each person, a shared dictionary and one bill. Choose how many people it is for, you included; you can buy more seats later for the time left."
                    : " for each person, a shared dictionary and one bill. Start with yourself; each person you add is billed from when they join."}
              </p>
              {plan.id === "power" && once && open && (
                <label className="mt-3 flex items-center gap-2 text-[13px]">
                  People
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={seats}
                    onChange={(event) =>
                      setSeats(Math.min(500, Math.max(1, Math.floor(Number(event.target.value) || 1))))
                    }
                    className="w-20 rounded-[8px] border border-rule bg-page px-2 py-1"
                  />
                </label>
              )}
              <div className="mt-3">
                {open ? (
                  <Button
                    variant={plan.id === billing.popular ? "primary" : "quiet"}
                    busy={busy === plan.id}
                    disabled={busy !== null && busy !== plan.id}
                    onClick={() => void buy(plan.id as "pro" | "power")}
                  >
                    {addTime
                      ? `Pay for more ${plan.name}`
                      : once
                        ? `Pay for ${plan.name}`
                        : `Upgrade to ${plan.name}`}
                  </Button>
                ) : (
                  <p className="text-xs text-ink-soft">Coming soon.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {teams && (
        <p className="mt-3 text-xs text-ink-soft">
          {teams.name}, for companies: write to{" "}
          <a
            className="underline"
            href="mailto:support@subxvoice.app?subject=SUBXVoice%20for%20our%20company"
          >
            support@subxvoice.app
          </a>
          .
        </p>
      )}
      {message && (
        <div className="mt-3">
          <Notice role={message.kind === "error" ? "alert" : "status"}>{message.text}</Notice>
        </div>
      )}
    </Field>
  );
}

function Toggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: [T, string][];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="m-0 inline-flex min-w-0 rounded-full border border-rule bg-paper p-0.5">
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`rounded-full px-3 py-1 text-[13px] ${value === id ? "bg-ink text-page" : "text-ink-soft hover:text-ink"}`}
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}
