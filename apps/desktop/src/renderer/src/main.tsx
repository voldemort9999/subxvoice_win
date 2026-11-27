import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Bundled rather than linked: the window works offline and its CSP allows only 'self'.
import "@fontsource-variable/funnel-display";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
// The other font pairs in Settings → Appearance. Each face downloads nothing: it is bundled, and
// the browser reads its file only when the chosen pair actually uses it.
import "@fontsource-variable/hanken-grotesk";
import "@fontsource/instrument-serif";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/syne";
import "@fontsource-variable/unbounded";
import "@fontsource-variable/manrope";
import "@fontsource-variable/noto-sans-devanagari";
import { TitleStrip } from "@platform/Chrome";
import { App } from "./App";
import { DraftsWindow } from "./pages/DraftsWindow";
import { PrompterPanel } from "./prompter/Panel";
import { ScriptWindow } from "./prompter/ScriptWindow";
import { applyStoredTheme } from "./shared/themes";
import "./styles.css";

applyStoredTheme();

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

// One bundle, four windows: the dashboard, the drafts window, a script's window and the
// teleprompter's panel (`?window=drafts|script|prompter`).
const which = new URLSearchParams(location.search).get("window");

createRoot(root).render(
  <StrictMode>
    {which === "drafts" ? (
      <DraftsWindow />
    ) : which === "script" ? (
      <ScriptWindow />
    ) : which === "prompter" ? (
      <PrompterPanel />
    ) : (
      <App />
    )}
    {/* Over every screen (launch, sign-in, setup, the app): what the window is dragged by. */}
    {which !== "prompter" && <TitleStrip />}
  </StrictMode>,
);
