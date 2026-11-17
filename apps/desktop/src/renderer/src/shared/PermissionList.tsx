import type { PermissionKind } from "@subx/core";
import { usePermissions } from "./hooks";

const LABELS: Record<PermissionKind, { title: string; why: string }> = {
  microphone: { title: "Microphone", why: "To hear what you say." },
};

/** The permissions the app needs, updating live as the user grants them. */
export function PermissionList() {
  const statuses = usePermissions() ?? [];

  return (
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
              className="shrink-0 rounded-[3px] bg-marigold px-3.5 py-1.5 font-semibold text-on-marigold transition-colors hover:bg-ink hover:text-page"
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
  );
}
