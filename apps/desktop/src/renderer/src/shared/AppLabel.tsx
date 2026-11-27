import { useEffect, useState } from "react";
import type { AppLook } from "../../../shared/ipc";

/** One answer per app for the whole window: History asks for every row, and the rows share a few apps. */
const looks = new Map<string, Promise<AppLook>>();

function lookOf(appId: string, stored: string): Promise<AppLook> {
  const key = `${appId}\n${stored}`;
  let look = looks.get(key);
  if (!look) {
    look = window.subx.apps.look(appId, stored).catch(() => ({ name: stored, icon: "" }));
    looks.set(key, look);
  }
  return look;
}

/** An app as people know it, "Visual Studio Code" rather than "Code" (the Mac's AppLook). */
export function useAppLook(appId: string | undefined, stored: string | undefined): AppLook {
  const [look, setLook] = useState<AppLook>({ name: stored ?? "", icon: "" });
  useEffect(() => {
    let live = true;
    void lookOf(appId ?? "", stored ?? "").then((found) => live && setLook(found));
    return () => {
      live = false;
    };
  }, [appId, stored]);
  return look;
}

/** The app's icon and name, as History and Insights show where words went (the Mac's AppLabel). */
export function AppLabel({
  appId,
  stored,
  size = 14,
  className = "",
}: {
  appId?: string;
  stored?: string;
  size?: number;
  className?: string;
}) {
  const look = useAppLook(appId, stored);
  if (!look.name) return null;
  return (
    <span className={`inline-flex min-w-0 items-center gap-[5px] ${className}`}>
      {look.icon && (
        <img src={look.icon} alt="" width={size} height={size} className="shrink-0" draggable={false} />
      )}
      <span className="truncate">{look.name}</span>
    </span>
  );
}
