// The account's settings on our backend (subxvoice-api `/v1/settings`), for the screens that edit
// them. The renderer never touches the network, so it asks here; this is the only place that
// knows the address and the token.
import type { AccountDevice, Usage, VoiceSettings } from "../shared/ipc";

/** A value with the settings version it was read or written at (null from an older server). */
export interface Versioned<T> {
  value: T;
  version: string | null;
}

/** One day of the account, every device together (India time, like the allowance). */
export interface ServerDay {
  day: string;
  seconds: number;
  /** Null for days before the server counted words (2026-11-21): this Mac's own count is used. */
  words: number | null;
  dictations: number | null;
}

export interface Stats {
  usage: Usage;
  days: ServerDay[];
  settingsVersion: string | null;
}

/** Words added or edited, and words deleted, since this Mac last had the server's list. */
export interface DictionaryChange {
  upsert: { word: string; misheardAs: string[] }[];
  remove: string[];
}

export interface Backend {
  settings(): Promise<Versioned<VoiceSettings>>;
  /** A partial change, merged into what the server keeps; it checks every field. */
  update(patch: Record<string, unknown>): Promise<Versioned<VoiceSettings>>;
  /** Changes word by word; the server's whole list comes back. */
  changeDictionary(change: DictionaryChange): Promise<Versioned<{ word: string; misheardAs: string[] }[]>>;
  /** The account's day-by-day totals and today's allowance, every device together. */
  stats(): Promise<Stats>;
  devices(): Promise<AccountDevice[]>;
  languages(): Promise<string[]>;
  /** Removes everything the server keeps for the signed-in account (settings, dictionary, usage). */
  deleteAccount(): Promise<void>;
}

/** The server could not be reached: what was being saved is kept on the Mac and sent later. */
export class OfflineError extends Error {}

/** Long enough for a slow network, short enough that a Settings screen never hangs on it. */
const TIMEOUT_MS = 8000;

export function createBackend(
  baseUrl: string,
  token: () => string | Promise<string>,
  /** `x-subx-client`, e.g. "win/0.4.3": the server's logs tell the two apps apart by it. */
  client: string,
  /** `x-subx-device`: which computer this is (device.ts). */
  device?: string,
): Backend {
  const root = baseUrl.replace(/\/+$/, "");
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    return (await versioned<T>(path, init)).value;
  }
  async function versioned<T>(path: string, init: RequestInit = {}): Promise<Versioned<T>> {
    const bearer = await token();
    // Signed out: say so here rather than send a request the server can only refuse.
    if (!bearer) throw new Error("Sign in to change these settings.");
    let response: Response;
    try {
      response = await fetch(`${root}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
          "x-subx-client": client,
          ...(device ? { "x-subx-device": device } : {}),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // fetch throws for a bad header or a timeout as much as for no network; the user's sentence is
      // the same, but without the real reason in the log "can't reach" could not be told apart.
      console.error(`backend: ${path} failed — ${reason(error)}`);
      throw new OfflineError("Can't reach the SUBXVoice server. Check your connection.");
    }
    if (response.status === 401) throw new Error("Sign in again to change these settings.");
    if (!response.ok) {
      // The server says what was wrong with a setting; anything else is reported plainly.
      const body = (await response.json().catch(() => null)) as {
        message?: string;
        problems?: string[];
      } | null;
      throw new Error(
        settingProblem(body?.problems) ?? "Something went wrong on our side. Try again in a moment.",
      );
    }
    return {
      value: (await response.json()) as T,
      version: response.headers.get("x-subx-settings-version"),
    };
  }
  return {
    settings: () => versioned<VoiceSettings>("/v1/settings"),
    update: (patch) =>
      versioned<VoiceSettings>("/v1/settings", { method: "PUT", body: JSON.stringify(patch) }),
    changeDictionary: async (change) => {
      const answer = await versioned<{ dictionary: { word: string; misheardAs: string[] }[] }>(
        "/v1/dictionary",
        {
          method: "POST",
          body: JSON.stringify(change),
        },
      );
      return { value: answer.value.dictionary, version: answer.version };
    },
    stats: () => call<Stats>("/v1/stats"),
    devices: async () => (await call<{ devices: AccountDevice[] }>("/v1/devices")).devices,
    languages: async () => (await call<{ languages: string[] }>("/v1/languages")).languages,
    deleteAccount: async () => {
      await call<unknown>("/v1/account", { method: "DELETE" });
    },
  };
}

/**
 * A refused setting, in words for people. The server's own reasons are written for developers
 * ("languages.hinglish must be true or false") and never shown; the two limits a person can reach
 * are said plainly, anything else means a fault on our side.
 */
function settingProblem(problems: string[] | undefined): string | null {
  if (!problems?.length) return null;
  const all = problems.join(" ");
  if (/instructions/.test(all)) return "Your instructions can be up to 500 characters.";
  if (/dictionary/.test(all)) return "Your dictionary can hold up to 1,000 words.";
  return "That setting couldn't be saved. Try again, or restart SUBXVoice.";
}

/** fetch's error and the one under it (undici puts the socket or DNS failure in `cause`). */
function reason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause =
    error.cause instanceof Error
      ? `: ${(error.cause as Error & { code?: string }).code ?? ""} ${error.cause.message}`
      : "";
  return `${error.name} ${error.message}${cause}`;
}
