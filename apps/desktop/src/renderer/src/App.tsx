import { TITLE_BAR_DRAG, TitleSpace, useWindowChrome } from "@platform/Chrome";
import { useEffect, useState } from "react";
import { hotkeyLabel } from "../../shared/hotkey-label";
import { DashboardPage, openSettings } from "./pages/DashboardPage";
import { DictionaryActions, DictionaryPage } from "./pages/DictionaryPage";
import { InsightsPage } from "./pages/InsightsPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { SettingsPanel } from "./pages/SettingsPage";
import { SignInPage } from "./pages/SignInPage";
import { Contours } from "./shared/effects/Contours";
import { useAccount, useAppInfo, useBilling, useUsage } from "./shared/hooks";
import { Launch, useLaunchScene } from "./shared/Launch";
import { type PageId, Sidebar } from "./shared/Sidebar";
import { useTheme } from "./shared/themes";

const TITLES: Record<PageId, string> = {
  dashboard: "Home",
  insights: "Insights",
  dictionary: "Dictionary",
  settings: "Settings",
};

export function App() {
  const [page, setPage] = useState<PageId>("dashboard");
  // Bumped to open Settings afresh on the section asked for, even when Settings is already open.
  const [settingsVisit, setSettingsVisit] = useState(0);
  const account = useAccount();
  const info = useAppInfo();
  const launch = useLaunchScene(info);
  const theme = useTheme();
  const usage = useUsage();
  const { billing } = useBilling(usage?.plan);
  const hotkey = hotkeyLabel(info?.hotkeys[0]?.keys);
  // Ctrl+, opens Settings, as ⌘, does in the Mac app (fbeacae), on the section last open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "," || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      setPage("settings");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useWindowChrome();
  // "Change Languages…" and the like in the menu bar.
  useEffect(
    () =>
      window.subx.app.onNavigate((to) => {
        if (to.page === "settings" && to.tab) {
          openSettings(to.tab, setPage);
          setSettingsVisit((visit) => visit + 1);
        } else setPage(to.page);
      }),
    [],
  );

  // Nothing is drawn until the run and the saved session are known, so the window never flashes
  // the sign-in form at someone who is already signed in, nor the app before its launch scene.
  if (!info) return <div className="h-full bg-stage" />;
  // Settings is a panel over Home, never a page of its own (the Mac app's Shell.swift).
  const shown: PageId = page === "settings" ? "dashboard" : page;
  if (launch.show) return <Launch onDone={launch.done} />;
  if (!account) return <div className="h-full bg-stage" />;
  if (!account.signedIn) return <SignInPage lastGoogle={account.lastGoogle} />;
  // Asked once: a name, and the key they will hold every time.
  if (!account.onboarded)
    return <OnboardingPage info={info} email={account.email} suggestedName={account.suggestedName} />;

  return (
    // The sidebar runs flush to the window's edge, under the traffic lights, and the
    // page is a card set into it. The lights then sit on the sidebar, never on the card's corner.
    <div className="flex h-full flex-col bg-side">
      <TitleSpace />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          page={page}
          onNavigate={setPage}
          account={account}
          usage={usage}
          billing={billing}
          onOpenPlan={() => {
            openSettings("plan", setPage);
            setSettingsVisit((visit) => visit + 1);
          }}
        />

        <div className="relative my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-rule bg-page">
          {/* Surveyed paper: drawn once per resize, never animated, since this window sits open all day. */}
          <div className="absolute inset-0">
            <Contours key={theme} opacity={0.045} />
          </div>
          <header
            className={`relative flex h-[76px] shrink-0 items-end justify-between gap-4 px-9 pb-3 ${TITLE_BAR_DRAG}`}
          >
            {shown === "dashboard" ? (
              <>
                <h1 className="text-[24px] leading-none">{greeting(account.name)}</h1>
                {/* The shortcut is the user's choice, so it is shown as one: press it to change it. */}
                <p className="flex items-center gap-2 text-[13px] text-ink-soft">
                  Talk anywhere with
                  <button
                    type="button"
                    onClick={() => openSettings("general", setPage)}
                    title="Change your shortcut"
                    // The header is the window's drag strip; on a Mac a click there moves the window
                    // instead of reaching a button, unless the button opts out.
                    className="kbd text-[13px] transition-transform [-webkit-app-region:no-drag] hover:-translate-y-px"
                  >
                    {hotkey}
                  </button>
                </p>
              </>
            ) : (
              <>
                <h1 className="text-[24px] leading-none">{TITLES[shown]}</h1>
                {shown === "dictionary" && <DictionaryActions />}
              </>
            )}
          </header>

          <main className="scroll-area relative flex-1 overflow-y-auto">
            {/* Keyed by page so each one arrives with a short rise, answering the click that chose it. */}
            <div key={shown} className="animate-arrive mx-auto max-w-5xl px-8 pt-4 pb-10">
              {shown === "dashboard" && <DashboardPage hotkey={hotkey} onNavigate={setPage} />}
              {page === "insights" && <InsightsPage hotkey={hotkey} />}
              {page === "dictionary" && <DictionaryPage />}
            </div>
          </main>
        </div>
        {page === "settings" && (
          <SettingsPanel key={settingsVisit} info={info} onClose={() => setPage("dashboard")} />
        )}
      </div>
    </div>
  );
}

/** Said the way a person would, by the clock and by name. */
function greeting(name: string): string {
  const hour = new Date().getHours();
  const part =
    hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first ? `${part}, ${first.charAt(0).toUpperCase()}${first.slice(1)}` : part;
}
