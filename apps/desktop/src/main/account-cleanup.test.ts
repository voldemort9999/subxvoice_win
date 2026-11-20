import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { markSignedIn, removeUnusedAccounts, UNUSED_ACCOUNT_MS } from "./account-cleanup";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 20);

let accounts: string;

/** An account folder with a dictation and a recording, last signed in `daysAgo` (none: no date). */
async function account(name: string, daysAgo?: number): Promise<string> {
  const dir = join(accounts, name);
  await mkdir(join(dir, "recordings"), { recursive: true });
  await writeFile(join(dir, "history.json"), "[]");
  await writeFile(join(dir, "recordings", "clip.wav"), "audio");
  if (daysAgo !== undefined) await markSignedIn(dir, NOW - daysAgo * DAY);
  return dir;
}

beforeEach(async () => {
  accounts = await mkdtemp(join(tmpdir(), "subx-accounts-"));
});
afterEach(async () => {
  await rm(accounts, { recursive: true, force: true });
});

describe("removeUnusedAccounts", () => {
  it("removes an account not signed in here for 30 days, recordings and all", async () => {
    const current = await account("me", 0);
    const old = await account("old", 31);

    const removed = await removeUnusedAccounts({ accountsDir: accounts, current: () => current, now: NOW });

    expect(removed).toEqual(["old"]);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(current)).toBe(true);
  });

  it("never removes the signed-in account, however long it has been idle", async () => {
    const current = await account("me", 400);

    expect(await removeUnusedAccounts({ accountsDir: accounts, current: () => current, now: NOW })).toEqual(
      [],
    );
    expect(existsSync(join(current, "history.json"))).toBe(true);
  });

  it("keeps an account signed in here within the 30 days", async () => {
    const current = await account("me", 0);
    const recent = await account("recent", 29);

    expect(await removeUnusedAccounts({ accountsDir: accounts, current: () => current, now: NOW })).toEqual(
      [],
    );
    expect(existsSync(recent)).toBe(true);
  });

  it("gives a folder with no date today's date instead of deleting it (an update deletes nothing at once)", async () => {
    const current = await account("me", 0);
    const undated = await account("undated");

    expect(await removeUnusedAccounts({ accountsDir: accounts, current: () => current, now: NOW })).toEqual(
      [],
    );
    expect(existsSync(undated)).toBe(true);
    expect(JSON.parse(await readFile(join(undated, "last-signed-in.json"), "utf8"))).toEqual({ at: NOW });

    // 30 days on, still not signed in: now it goes.
    const later = NOW + UNUSED_ACCOUNT_MS;
    expect(await removeUnusedAccounts({ accountsDir: accounts, current: () => current, now: later })).toEqual(
      ["undated"],
    );
  });

  it("treats an unreadable date as no date", async () => {
    const current = await account("me", 0);
    const broken = await account("broken");
    await writeFile(join(broken, "last-signed-in.json"), "{not json");

    expect(await removeUnusedAccounts({ accountsDir: accounts, current: () => current, now: NOW })).toEqual(
      [],
    );
    expect(existsSync(broken)).toBe(true);
  });

  it("keeps an account that signs in while the check runs", async () => {
    await account("first", 40);
    const second = await account("second", 40);
    let current = join(accounts, "first");
    const removed = await removeUnusedAccounts({
      accountsDir: accounts,
      current: () => {
        const now = current;
        current = second; // "second" signs in during the check
        return now;
      },
      now: NOW,
    });

    expect(existsSync(second)).toBe(true);
    expect(removed).not.toContain("second");
  });

  it("an account signed out by itself after 30 days away keeps its history if it signs in again", async () => {
    // The app was not opened for 40 days, so the sign-in ran out and the date is 40 days old.
    const away = await account("away", 40);
    // At start the app finds it signed out: that account was in use here until now (index.ts).
    await markSignedIn(away, NOW);
    const signedOut = await account("signed-out", 0);

    expect(await removeUnusedAccounts({ accountsDir: accounts, current: () => signedOut, now: NOW })).toEqual(
      [],
    );
    expect(existsSync(join(away, "history.json"))).toBe(true);
    // Never signed in again: it goes 30 days later.
    expect(
      await removeUnusedAccounts({ accountsDir: accounts, current: () => signedOut, now: NOW + 30 * DAY }),
    ).toEqual(["away"]);
  });

  it("leaves files in the accounts folder alone, and copes with no accounts folder", async () => {
    const current = await account("me", 0);
    await writeFile(join(accounts, "note.txt"), "x");

    expect(await removeUnusedAccounts({ accountsDir: accounts, current: () => current, now: NOW })).toEqual(
      [],
    );
    expect(existsSync(join(accounts, "note.txt"))).toBe(true);
    expect(
      await removeUnusedAccounts({
        accountsDir: join(accounts, "missing"),
        current: () => current,
        now: NOW,
      }),
    ).toEqual([]);
  });

  it("an account switched away from today counts its 30 days from today", async () => {
    const first = await account("first", 100);
    const second = await account("second", 0);
    // Switching to "second" marks "first" as signed in until now.
    await markSignedIn(first, NOW);

    expect(
      await removeUnusedAccounts({ accountsDir: accounts, current: () => second, now: NOW + 29 * DAY }),
    ).toEqual([]);
    expect(
      await removeUnusedAccounts({ accountsDir: accounts, current: () => second, now: NOW + 30 * DAY }),
    ).toEqual(["first"]);
  });
});
