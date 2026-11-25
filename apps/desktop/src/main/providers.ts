// Where dictation goes: our server (subxvoice-api), which hears, rewrites and holds every vendor
// key. The app holds none (AGENTS.md rule 3); what proves the user is their Cognito access token.

import { join } from "node:path";
import { SubxDictateStt, timeZoneHeader } from "@subx/providers";
import { app } from "electron";
import { thisDevice } from "./device";

/** The live server, in Mumbai. (Its old name, 3-109-44-84.sslip.io, still answers for older builds.) */
const LIVE_API_URL = "https://api.subxvoice.app";

/**
 * Reads the repo-root .env in development, where SUBX_API_URL and SUBX_DEV_TOKEN point the app at
 * a server on this machine. The packaged app reads nothing from it.
 */
export function loadDevEnv(): void {
  if (app.isPackaged) return;
  for (const path of [join(app.getAppPath(), "../../.env"), join(process.cwd(), ".env")]) {
    try {
      process.loadEnvFile(path);
      return;
    } catch {
      // Missing or unreadable: try the next location, then fall back to the real environment.
    }
  }
}

/** A development setting, or undefined when it is blank or the app is packaged. */
const devSetting = (name: string): string | undefined =>
  app.isPackaged ? undefined : process.env[name]?.trim() || undefined;

/** The server's address: the live one, or SUBX_API_URL in development. No trailing slash. */
export const apiUrl = (): string => (devSetting("SUBX_API_URL") ?? LIVE_API_URL).replace(/\/+$/, "");

/** A "dev:<name>" token a local server accepts in place of a sign-in. Development only. */
export const devToken = (): string | undefined => devSetting("SUBX_DEV_TOKEN");

export function createStt(
  token: () => string | Promise<string>,
  /** The Mac's copy of the user's dictation settings, sent with each dictation. */
  settings: () => Promise<Record<string, unknown> | null>,
  /** The account's totals the server sends after each dictation's text (account-totals.ts). */
  onUsage?: (totals: unknown) => void,
): SubxDictateStt {
  return new SubxDictateStt({
    baseUrl: apiUrl(),
    token,
    client: `win/${app.getVersion()}`,
    device: clientHeaders()["x-subx-device"],
    settings,
    ...(onUsage ? { onUsage } : {}),
  });
}

/** What every request to our server says about the app and the computer (`device.ts`). */
export function clientHeaders(): { "x-subx-client": string; "x-subx-device": string; "x-subx-tz"?: string } {
  return {
    "x-subx-client": `win/${app.getVersion()}`,
    "x-subx-device": thisDevice(app.getPath("userData"), process.getSystemVersion()),
    ...timeZoneHeader(),
  };
}
