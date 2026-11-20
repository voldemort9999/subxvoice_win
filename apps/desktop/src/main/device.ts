// Which computer this is, for the server's devices table (the user's call, 2026-11-20: see how many
// computers each account uses, and which). Sent as `x-subx-device` on the requests the app already
// makes; the server writes it at most once a day. The id is random and made once per Mac, shared by
// every account on it: never the computer's name, a serial or anything else that says whose it is.

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** This Mac's id, made on first use and kept in `dataDir/device-id`. A broken file gets a new one. */
export function deviceId(dataDir: string): string {
  const file = join(dataDir, "device-id");
  try {
    const saved = readFileSync(file, "utf8").trim();
    if (ID.test(saved)) return saved;
  } catch {
    // None yet.
  }
  const id = randomUUID();
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, id);
  } catch {
    // Unwritable: this run still has an id; the next makes another, which is only a second row.
  }
  return id;
}

/** Only characters the server accepts, so a chip name it would drop is cleaned rather than lost. */
const plain = (text: string, max: number) =>
  text
    .replace(/[^\w .,()@+-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** The header's value: `id=<uuid>; chip=Apple M2; os=26.1`. */
export function deviceHeader(id: string, chip: string, os: string): string {
  const parts = [`id=${id}`];
  const cleanChip = plain(chip, 60);
  const cleanOs = plain(os, 20);
  if (cleanChip) parts.push(`chip=${cleanChip}`);
  if (cleanOs) parts.push(`os=${cleanOs}`);
  return parts.join("; ");
}

let cached: string | null = null;

/** This Mac's header, built once (the dictation path must not pay for it). */
export function thisDevice(dataDir: string, systemVersion: string): string {
  cached ??= deviceHeader(deviceId(dataDir), cpus()[0]?.model ?? "", systemVersion);
  return cached;
}
