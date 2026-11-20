import { SidebarTop } from "@platform/Chrome";
import type { ComponentType } from "react";
import type { AccountState, Usage } from "../../../shared/ipc";
import { formatSpan } from "./format";
import { BookIcon, ChartIcon, GearIcon, HomeIcon } from "./icons";
import { Mark } from "./Mark";
import { ProfileMenu } from "./ProfileMenu";

export type PageId = "dashboard" | "insights" | "dictionary" | "settings";

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
  { id: "insights", label: "Insights", icon: ChartIcon },
];

export function Sidebar({
  page,
  onNavigate,
  account,
  usage,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  account: AccountState;
  usage: Usage | null;
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
                  active
                    ? "bg-side-rule font-medium text-side-ink shadow-[var(--side-inset)]"
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
        <PlanCard usage={usage} />
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
 * Today's speaking time and what is left of it, as a meter. No plan name and no upgrade button
 * until there is billing behind them: a button that does nothing is worse than none.
 */
function PlanCard({ usage }: { usage: Usage | null }) {
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
