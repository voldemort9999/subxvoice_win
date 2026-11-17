import { useState } from "react";
import { DashboardPage } from "./pages/DashboardPage";
import { DictionaryPage } from "./pages/DictionaryPage";
import { HistoryPage } from "./pages/HistoryPage";
import { InsightsPage } from "./pages/InsightsPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignInPage } from "./pages/SignInPage";
import { TITLE_BAR_DRAG } from "./shared/Chrome";
import { followKey } from "./shared/follow";
import { hotkeyLabel } from "./shared/format";
import { useAccount, useAppInfo, useTheme, useUsage } from "./shared/hooks";
import { MoonIcon, SunIcon } from "./shared/icons";
import { ProfileMenu } from "./shared/ProfileMenu";
import { type PageId, Sidebar } from "./shared/Sidebar";
import { IconButton } from "./shared/ui";

const TITLES: Record<PageId, string> = {
  dashboard: "Dashboard",
  insights: "Insights",
  history: "History",
  dictionary: "Dictionary",
  settings: "Settings",
};

export function App() {
  const [page, setPage] = useState<PageId>("dashboard");
  const [theme, setTheme] = useTheme();
  const account = useAccount();
  const info = useAppInfo();
  const usage = useUsage();
  const hotkey = hotkeyLabel(info?.hotkeys[0]?.keys);
  // Absent when Follow My Words cannot run (its engines are missing), and the UI then speaks of
  // dictation alone.
  const follow = followKey(info);
  const followLabel = follow ? hotkeyLabel(follow) : undefined;
  // Dictation runs on the account's session, so without one there is nothing the app can do.
  const ready = Boolean(info?.providers.stt && account?.signedIn);

  // Nothing is drawn until the saved session has been checked, so the window never flashes the
  // sign-in form at someone who is already signed in.
  if (!account) return <div className="h-full bg-page" />;
  if (!account.signedIn) return <SignInPage />;
  // Asked once: a name, and the key they will hold every time.
  if (!account.onboarded) return <OnboardingPage info={info} email={account.email} />;

  return (
    <div className="flex h-full bg-page">
      <Sidebar
        page={page}
        onNavigate={setPage}
        hotkey={hotkey}
        followKey={followLabel}
        ready={ready}
        usage={usage}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`flex h-16 shrink-0 items-end justify-between gap-4 px-8 pb-3 ${TITLE_BAR_DRAG}`}>
          <h1 className="text-[26px] leading-none">{TITLES[page]}</h1>
          <div className="flex items-center gap-1.5">
            <IconButton
              icon={theme === "dark" ? SunIcon : MoonIcon}
              label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            />
            <ProfileMenu account={account} />
          </div>
        </header>

        <main className="scroll-area flex-1 overflow-y-auto">
          {/* Keyed by page so each one arrives with a short rise, answering the click that chose it. */}
          <div key={page} className="animate-arrive mx-auto max-w-5xl px-8 pt-4 pb-10">
            {page === "dashboard" && (
              <DashboardPage hotkey={hotkey} followKey={followLabel} onNavigate={setPage} />
            )}
            {page === "insights" && <InsightsPage hotkey={hotkey} />}
            {page === "history" && <HistoryPage hotkey={hotkey} />}
            {page === "dictionary" && <DictionaryPage />}
            {page === "settings" && <SettingsPage info={info} />}
          </div>
        </main>
      </div>
    </div>
  );
}
