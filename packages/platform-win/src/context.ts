import type { AppContext, ContextReader } from "@subx/core";
import { foregroundWindow } from "./win32";

/**
 * What the user was looking at when they pressed the hotkey. Read from the foreground window, so
 * it costs nothing and needs no extra permission.
 *
 * `url` and `selectedText` stay empty: the browser URL needs a browser extension and the selection
 * needs UI Automation, neither of which exists yet. Every field of AppContext is optional for
 * exactly this reason.
 */
export class WinContextReader implements ContextReader {
  constructor(private readonly describe?: (exePath: string) => Promise<string | null>) {}

  /** The executable's own description, as Windows names the app; the stored name when it has none. */
  async displayName(appId: string): Promise<string | null> {
    if (!this.describe || !/\.exe$/i.test(appId)) return null;
    return this.describe(appId).catch(() => null);
  }

  async current(): Promise<AppContext> {
    const window = foregroundWindow();
    if (!window) return {};

    const context: AppContext = {};
    // Only set what we actually read: an empty string would show up in the UI as a blank app name.
    if (window.exePath) {
      context.appId = window.exePath;
      context.appName = appNameFromPath(window.exePath);
    }
    if (window.title) context.windowTitle = window.title;
    return context;
  }
}

/**
 * "C:\...\Microsoft VS Code\Code.exe" → "Code". The executable name is what the user recognises,
 * and it is the same string every time, which is what makes it groupable in the dashboard.
 */
export function appNameFromPath(exePath: string): string {
  const file = exePath.split(/[\\/]/).pop() ?? "";
  return file.replace(/\.exe$/i, "");
}
