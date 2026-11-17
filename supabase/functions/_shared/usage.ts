// How much dictation an account has left today.
//
// The number is kept server-side and written with the service role, because a limit the client
// can edit is not a limit. The relay counts the audio it actually forwards, so nothing depends on
// the app reporting honestly.

/** Two hours of speech a day. Generous for dictation; the point is a ceiling, not a budget. */
const DAILY_LIMIT_SECONDS = 2 * 60 * 60;

/** 16 kHz, 16-bit mono: the only format the relay carries. */
const BYTES_PER_SECOND = 16000 * 2;

export const secondsOf = (bytes: number) => bytes / BYTES_PER_SECOND;

const PROJECT_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/**
 * The account the gateway already verified. The signature was checked before this code ran, so
 * reading the payload is enough — this never decides whether the token is valid.
 */
export function userIdFrom(authorization: string | null): string | null {
  const token = authorization?.replace(/^Bearer\s+/i, "");
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const sub = JSON.parse(json).sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

async function rest(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${PROJECT_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/** The user's own day, not UTC's — see usage_day() in the database. */
async function today(): Promise<string> {
  const response = await rest("rpc/usage_day", { method: "POST", body: "{}" });
  const day = await response.json().catch(() => null);
  // Falling back to UTC is better than refusing to dictate because a date lookup failed.
  return typeof day === "string" ? day : new Date().toISOString().slice(0, 10);
}

export interface Usage {
  used: number;
  limit: number;
  remaining: number;
}

export async function usageFor(userId: string): Promise<Usage> {
  const day = await today();
  const response = await rest(`daily_usage?user_id=eq.${userId}&day=eq.${day}&select=seconds`, {
    method: "GET",
  });
  const rows = (await response.json().catch(() => [])) as { seconds?: number }[];
  const used = Math.max(0, Math.round(rows[0]?.seconds ?? 0));
  return { used, limit: DAILY_LIMIT_SECONDS, remaining: Math.max(0, DAILY_LIMIT_SECONDS - used) };
}

/**
 * Adds to today's total. Best effort on purpose: a dictation that already happened should not be
 * undone because the counter could not be written.
 */
export async function addUsage(userId: string, seconds: number): Promise<void> {
  if (seconds <= 0) return;
  const day = await today();
  try {
    await rest("rpc/add_usage", {
      method: "POST",
      body: JSON.stringify({ p_user: userId, p_day: day, p_seconds: Math.round(seconds) }),
    });
  } catch {
    // The dictation still happened; losing a few seconds of accounting is the lesser harm.
  }
}
