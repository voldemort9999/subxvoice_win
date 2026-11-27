import { SidebarTop } from "@platform/Chrome";
import type { ComponentType } from "react";
import type { AccountState, Billing, Usage } from "../../../shared/ipc";
import { formatSpan } from "./format";
import { BookIcon, ChartIcon, GearIcon, HomeIcon, PencilIcon, SnippetIcon } from "./icons";
import { Mark } from "./Mark";
import { ProfileMenu } from "./ProfileMenu";

export type PageId = "dashboard" | "insights" | "dictionary" | "snippets" | "drafts" | "settings";

interface NavItem {
  id: PageId;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

/**
 * The pages, straight under the name with no group headings: a few short names read at a glance,
 * and headings over two items each only added words. Settings is not here; it is the gear beside
 * the account at the bottom, where most Mac apps keep it.
 */
const PAGES: NavItem[] = [
  { id: "dashboard", label: "Home", icon: HomeIcon },
  { id: "dictionary", label: "Dictionary", icon: BookIcon },
  { id: "snippets", label: "Snippets", icon: SnippetIcon },
  { id: "insights", label: "Insights", icon: ChartIcon },
  { id: "drafts", label: "Drafts", icon: PencilIcon },
];

export function Sidebar({
  page,
  onNavigate,
  account,
  usage,
  billing,
  onOpenPlan,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  account: AccountState;
  usage: Usage | null;
  billing: Billing | null | undefined;
  onOpenPlan: () => void;
}) {
  return (
    <nav className="relative flex w-[232px] shrink-0 flex-col bg-side text-side-ink">
      <SidebarTop />

      <div className="flex items-center gap-2.5 px-5 pt-0.5 pb-5">
        <Mark className="h-7 w-7" />
        <span className="font-display text-[18px] [font-weight:var(--display-weight)] tracking-tight">
          SUBXVoice
        </span>
      </div>

      <ul className="m-0 flex-1 list-none space-y-1 px-3">
        {PAGES.map(({ id, label, icon: PageIcon }) => {
          const active = id === page;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onNavigate(id)}
                aria-current={active ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[15px] transition-colors ${
                  // Where you are, in the brand blue at a whisper: the one place colour sits at rest (Mac).
                  active
                    ? "bg-side-active font-medium text-side-accent"
                    : "text-side-soft hover:bg-side-rule/60 hover:text-side-ink"
                }`}
              >
                <PageIcon className="h-[17px] w-[17px]" />
                {label}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="space-y-3 px-3 pb-3">
        <PlanCard usage={usage} billing={billing} onOpenPlan={onOpenPlan} />
        <div className="flex items-center gap-1 border-t border-side-rule pt-3">
          <ProfileMenu account={account} />
          <button
            type="button"
            onClick={() => onNavigate("settings")}
            aria-label="Settings"
            aria-current={page === "settings" ? "page" : undefined}
            title="Settings"
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors ${
              page === "settings"
                ? "bg-side-rule text-side-ink"
                : "text-side-soft hover:bg-side-rule/60 hover:text-side-ink"
            }`}
          >
            <GearIcon className="h-[19px] w-[19px]" />
          </button>
        </div>
      </div>
    </nav>
  );
}

/**
 * The plan and the share of its words left, as a meter (never a count). On an unlimited plan there
 * is nothing to count down, so it says so; on Free and during the trial there is a way to upgrade.
 */
function PlanCard({
  usage,
  billing,
  onOpenPlan,
}: {
  usage: Usage | null;
  billing: Billing | null | undefined;
  onOpenPlan: () => void;
}) {
  const words = usage?.words;
  if (!usage || !words) return <TimeCard usage={usage} />;
  const planId = billing?.plan ?? usage.plan ?? "free";
  const name = billing?.plans.find((plan) => plan.id === planId)?.name ?? "";
  const trialDays =
    billing?.status === "trialing" && billing.periodEnd
      ? Math.max(1, Math.ceil((Date.parse(billing.periodEnd) - Date.now()) / 86_400_000))
      : null;
  const canUpgrade = planId === "free" || trialDays !== null;
  // A share, never a count: how many free words there are is not shown (the user's call).
  const limited = !words.unlimited && words.percentUsed !== null;
  const left = limited ? Math.max(0, 100 - (words.percentUsed ?? 0)) : 100;
  return (
    <div className="px-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="truncate text-side-soft">{name}</span>
        <span className="figure-num shrink-0 font-medium">
          {!limited
            ? "Unlimited"
            : words.out
              ? words.per === "week"
                ? "Back Monday"
                : "Back tomorrow"
              : `${left}% left`}
        </span>
      </div>
      {/* On a line of its own: beside the plan's name it was cut off in the sidebar's width (Mac). */}
      {trialDays !== null && (
        <p className="mt-0.5 text-xs text-side-soft">
          {trialDays} day{trialDays === 1 ? "" : "s"} left in your trial
        </p>
      )}
      {limited && (
        <span className="mt-2 block h-1 overflow-hidden rounded-full bg-side-rule" aria-hidden="true">
          <span className="block h-full rounded-full bg-side-accent" style={{ width: `${left}%` }} />
        </span>
      )}
      {canUpgrade && billing?.canBuy && (
        <button
          type="button"
          onClick={onOpenPlan}
          className="mt-2 text-[13px] font-medium text-side-accent hover:underline"
        >
          Upgrade
        </button>
      )}
    </div>
  );
}

/** An older server that counts time, not words: today's speaking time left, as before. */
function TimeCard({ usage }: { usage: Usage | null }) {
  if (!usage || usage.limit <= 0) return null;
  const left = Math.max(0, Math.min(1, usage.remaining / usage.limit));
  return (
    <div className="px-1.5">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-side-soft">Today</span>
        <span className="figure-num font-medium">
          {usage.remaining > 0 ? `${formatSpan(usage.remaining * 1000)} left` : "Back tomorrow"}
        </span>
      </div>
      <span className="mt-2 block h-1 overflow-hidden rounded-full bg-side-rule" aria-hidden="true">
        <span className="block h-full rounded-full bg-side-accent" style={{ width: `${left * 100}%` }} />
      </span>
    </div>
  );
}
