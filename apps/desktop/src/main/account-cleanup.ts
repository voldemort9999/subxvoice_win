// An account nobody signs in to on this Mac any more should not keep its dictations and recordings
// here for ever (the user's call, 2026-11-20). The signed-in account is never touched, however long
// it has been idle: only folders of accounts that have not been signed in on this Mac for
// UNUSED_ACCOUNT_MS go.
//
// Only this Mac knows when an account was last signed in here, so the date lives in the account's
// own folder (one tiny file, gone with the folder) — nothing on the server, no request.

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const UNUSED_ACCOUNT_MS = 30 * 24 * 60 * 60 * 1000;

/** In each account folder: when that account was last signed in on this Mac. */
const MARKER = "last-signed-in.json";

/** Notes that the account whose folder this is is (or was, until now) signed in on this Mac. */
export async function markSignedIn(accountDir: string, now = Date.now()): Promise<void> {
  await mkdir(accountDir, { recursive: true });
  await writeFile(join(accountDir, MARKER), JSON.stringify({ at: now }));
}

async function lastSignedIn(accountDir: string): Promise<number | null> {
  try {
    const { at } = JSON.parse(await readFile(join(accountDir, MARKER), "utf8")) as { at?: unknown };
    return typeof at === "number" && Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/**
 * Deletes the folders in `accountsDir` of accounts not signed in on this Mac for `maxAgeMs`.
 * `current()` is asked again right before each delete, so an account that signs in meanwhile is
 * kept. A folder without a date (made before this existed, or the date is unreadable) gets today's,
 * so an update never deletes anything at once. Returns the names of the folders removed.
 */
export async function removeUnusedAccounts(options: {
  accountsDir: string;
  /** The signed-in account's folder (or the signed-out one): never removed. */
  current: () => string;
  now?: number;
  maxAgeMs?: number;
}): Promise<string[]> {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? UNUSED_ACCOUNT_MS;
  const entries = await readdir(options.accountsDir, { withFileTypes: true }).catch(() => []);
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(options.accountsDir, entry.name);
    if (dir === options.current()) continue;
    const at = await lastSignedIn(dir);
    if (at === null) {
      await markSignedIn(dir, now);
      continue;
    }
    if (now - at < maxAgeMs) continue;
    if (dir === options.current()) continue;
    await rm(dir, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}
