// The account's settings on our backend (subxvoice-api `/v1/settings`), for the screens that edit
// them. The renderer never touches the network, so it asks here; this is the only place that
// knows the address and the token.
import type { VoiceSettings } from "../shared/ipc";

export interface Backend {
  settings(): Promise<VoiceSettings>;
  /** A partial change, merged into what the server keeps; it checks every field. */
  update(patch: Record<string, unknown>): Promise<VoiceSettings>;
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
): Backend {
  const root = baseUrl.replace(/\/+$/, "");
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
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
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
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
    return (await response.json()) as T;
  }
  return {
    settings: () => call<VoiceSettings>("/v1/settings"),
    update: (patch) => call<VoiceSettings>("/v1/settings", { method: "PUT", body: JSON.stringify(patch) }),
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
