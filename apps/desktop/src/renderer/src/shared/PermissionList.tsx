import type { PermissionKind } from "@subx/core";
import { usePermissions } from "./hooks";

const LABELS: Record<PermissionKind, { title: string; why: string }> = {
  microphone: { title: "Microphone", why: "To hear what you say." },
  accessibility: { title: "Accessibility", why: "To type the text into the app you are using." },
  input_monitoring: { title: "Input Monitoring", why: "To notice when you hold the hotkey." },
  screen_recording: { title: "Screen Recording", why: "To understand what is on your screen." },
};

/** The permissions this OS needs, updating live as the user grants them. */
export function PermissionList() {
  const statuses = usePermissions() ?? [];
  // The Mac app adds a hint here for permissions macOS keeps for an older, unsigned version; Windows
  // grants the microphone to the app, not to a version, so it has no such case (2026-11-21).

  return (
    <>
      <ul className="divide-y divide-rule border-y border-rule">
        {statuses.map(({ kind, state }) => (
          <li key={kind} className="flex items-center justify-between gap-4 py-3">
            <div>
              <p className="font-semibold">{LABELS[kind].title}</p>
              <p className="text-ink-soft">{LABELS[kind].why}</p>
            </div>
            {state === "granted" && <span className="text-ink-soft">Allowed</span>}
            {state === "unknown" && (
              <button
                type="button"
                className="shrink-0 font-medium text-ink-soft underline decoration-rule-strong underline-offset-[3px] hover:text-ink"
                onClick={() => window.subx.permissions.openSettings(kind)}
              >
                Check in Settings
              </button>
            )}
            {(state === "denied" || state === "not_asked") && (
              <button
                type="button"
                className="shrink-0 rounded-[3px] bg-accent px-3.5 py-1.5 font-semibold text-on-accent transition-colors hover:bg-ink hover:text-page"
                onClick={() =>
                  state === "not_asked"
                    ? window.subx.permissions.request(kind)
                    : window.subx.permissions.openSettings(kind)
                }
              >
                {state === "not_asked" ? "Allow" : "Open Settings"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
