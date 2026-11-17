import type { ComponentType } from "react";
import type { Usage } from "../../../shared/ipc";
import { SidebarTop } from "./Chrome";
import { formatSpan } from "./format";
import { BookIcon, ChartIcon, HistoryIcon, HomeIcon, SettingsIcon } from "./icons";
import { Mark } from "./Mark";

export type PageId = "dashboard" | "insights" | "history" | "dictionary" | "settings";

interface NavItem {
  id: PageId;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

/**
 * Grouped by what the user is trying to do, not by how the app is built: look at what happened,
 * then change how it behaves.
 */
const GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Your voice",
    items: [
      { id: "dashboard", label: "Dashboard", icon: HomeIcon },
      { id: "insights", label: "Insights", icon: ChartIcon },
      { id: "history", label: "History", icon: HistoryIcon },
    ],
  },
  {
    heading: "Tuning",
    items: [
      { id: "dictionary", label: "Dictionary", icon: BookIcon },
      { id: "settings", label: "Settings", icon: SettingsIcon },
    ],
  },
];

export function Sidebar({
  page,
  onNavigate,
  hotkey,
  followKey,
  ready,
  usage,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  hotkey: string;
  /** The Follow My Words key; absent where it cannot run. */
  followKey?: string;
  ready: boolean;
  usage: Usage | null;
}) {
  const exhausted = usage ? usage.remaining <= 0 : false;
  return (
    // The one surface that inverts. On Aubergine, Marigold is legible as type, so the current page
    // can be marked in the accent itself — nowhere in the content area can.
    <nav className="flex w-[216px] shrink-0 flex-col bg-side text-side-ink">
      <SidebarTop />

      <div className="flex items-center gap-2.5 px-5 pt-1 pb-7">
        <Mark className="h-8 w-8" />
        <span className="font-display text-[17px] font-extrabold tracking-tight">SUBXVoice</span>
      </div>

      <div className="flex-1 space-y-6 px-3">
        {GROUPS.map((group) => (
          <div key={group.heading}>
            <p className="px-3 pb-2 text-xs text-side-soft">{group.heading}</p>
            <ul className="space-y-px">
              {group.items.map(({ id, label, icon: PageIcon }) => {
                const active = id === page;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => onNavigate(id)}
                      aria-current={active ? "page" : undefined}
                      className={`relative flex w-full items-center gap-3 rounded-[3px] px-3 py-[7px] text-left transition-colors ${
                        active
                          ? "bg-side-rule font-semibold text-marigold"
                          : "text-side-soft hover:bg-side-rule/60 hover:text-side-ink"
                      }`}
                    >
                      {active && (
                        <span
                          className="absolute inset-y-1.5 left-0 w-[3px] bg-marigold"
                          aria-hidden="true"
                        />
                      )}
                      <PageIcon className="h-4 w-4" />
                      {label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* The one thing a new user needs to know, kept in view on every screen. */}
      <div className="mx-5 mb-5 border-t border-side-rule pt-4">
        <p className="flex items-center gap-2 font-semibold">
          <span
            className={`h-2 w-2 rounded-full ${ready && !exhausted ? "bg-marigold" : "border border-side-soft"}`}
            aria-hidden="true"
          />
          {exhausted ? "Daily limit reached" : ready ? "Ready" : "Setup needed"}
        </p>
        {exhausted ? (
          <p className="mt-2 text-side-soft">Back tomorrow.</p>
        ) : ready ? (
          <>
            {followKey && (
              <p className="mt-2.5 flex items-center gap-2 text-side-soft">
                <kbd className="kbd border-side-rule bg-side-rule text-side-ink">{followKey}</kbd>
                to ask
              </p>
            )}
            <p className="mt-2 flex items-center gap-2 text-side-soft">
              <kbd className="kbd border-side-rule bg-side-rule text-side-ink">{hotkey}</kbd>
              to type
            </p>
            {usage && (
              <p className="mt-2 text-xs text-side-soft">{formatSpan(usage.remaining * 1000)} left today</p>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() => onNavigate("settings")}
            className="mt-2 font-semibold text-marigold underline underline-offset-[3px]"
          >
            Finish setup
          </button>
        )}
      </div>
    </nav>
  );
}
