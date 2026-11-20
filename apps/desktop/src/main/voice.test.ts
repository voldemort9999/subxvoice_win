import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryDictionary } from "@subx/core/fakes";
import { afterEach, describe, expect, it } from "vitest";
import { type Backend, OfflineError } from "./backend";
import { VoiceSettingsCopy } from "./voice";

const hindi = { spoken: ["hi"], hinglish: false, writeIn: null };

/** A server that keeps one user's settings and can be switched off. */
function fakeServer(start: Record<string, unknown>) {
  let stored: Record<string, unknown> = { ...start };
  const calls = { get: 0, put: 0 };
  let online = true;
  const backend: Backend = {
    settings: async () => {
      calls.get++;
      if (!online) throw new OfflineError("offline");
      return stored as never;
    },
    update: async (patch) => {
      calls.put++;
      if (!online) throw new OfflineError("offline");
      stored = { ...stored, ...patch };
      return stored as never;
    },
    languages: async () => [],
    deleteAccount: async () => {},
  };
  return { backend, calls, setOnline: (value: boolean) => (online = value), stored: () => stored };
}

describe("VoiceSettingsCopy", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("on a new Mac takes the server's settings and adds its dictionary words", async () => {
    dir = await mkdtemp(join(tmpdir(), "subx-voice-"));
    const server = fakeServer({ languages: hindi, dictionary: [{ word: "Aarnav", misheardAs: [] }] });
    const dictionary = new MemoryDictionary([]);
    const copy = new VoiceSettingsCopy(() => join(dir, "voice.json"), server.backend, dictionary);
    await copy.sync();
    expect((await copy.current())?.languages).toEqual(hindi);
    expect((await dictionary.all()).map((entry) => entry.word)).toEqual(["Aarnav"]);
    // What a dictation sends: the settings, without the dictionary (its words go as terms).
    expect(await copy.forDictation()).toEqual({ languages: hindi });
  });

  // Three words added together started three pushes at once; the first (one word) was the slowest,
  // landed last and the server kept one word of three (2026-11-20).
  it("pushes the dictionary one at a time, so the newest list is the one the server keeps", async () => {
    dir = await mkdtemp(join(tmpdir(), "subx-voice-"));
    let stored: Record<string, unknown> = { languages: hindi, dictionary: [] };
    let puts = 0;
    let inFlight = 0;
    let most = 0;
    const backend: Backend = {
      settings: async () => stored as never,
      update: async (patch) => {
        puts++;
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((done) => setTimeout(done, puts === 1 ? 40 : 5));
        stored = { ...stored, ...patch };
        inFlight--;
        return stored as never;
      },
      languages: async () => [],
      deleteAccount: async () => {},
    };
    const dictionary = new MemoryDictionary([]);
    const copy = new VoiceSettingsCopy(() => join(dir, "voice.json"), backend, dictionary);
    const pushes: Promise<void>[] = [];
    for (const word of ["Supabase", "SUBX", "SUBXVoice"]) {
      await dictionary.upsert({ word, misheardAs: [] });
      pushes.push(copy.pushDictionary());
    }
    await Promise.all(pushes);
    const words = (stored.dictionary as { word: string }[]).map((entry) => entry.word).sort();
    expect(words).toEqual(["SUBX", "SUBXVoice", "Supabase"]);
    expect(most).toBe(1);
  });

  it("sends words only this Mac has up to the server at sync", async () => {
    dir = await mkdtemp(join(tmpdir(), "subx-voice-"));
    const server = fakeServer({ languages: hindi, dictionary: [] });
    const dictionary = new MemoryDictionary([{ word: "Bhavesh", misheardAs: [] }]);
    await new VoiceSettingsCopy(() => join(dir, "voice.json"), server.backend, dictionary).sync();
    expect(server.stored().dictionary).toEqual([{ word: "Bhavesh", misheardAs: [] }]);
  });

  it("keeps a change made offline, uses it at once, and sends it at the next sync", async () => {
    dir = await mkdtemp(join(tmpdir(), "subx-voice-"));
    const server = fakeServer({ languages: { spoken: "auto", hinglish: false, writeIn: null } });
    const copy = new VoiceSettingsCopy(
      () => join(dir, "voice.json"),
      server.backend,
      new MemoryDictionary([]),
    );
    await copy.sync();
    server.setOnline(false);
    await copy.update({ languages: hindi });
    expect((await copy.forDictation())?.languages).toEqual(hindi);
    server.setOnline(true);
    await new VoiceSettingsCopy(
      () => join(dir, "voice.json"),
      server.backend,
      new MemoryDictionary([]),
    ).sync();
    expect(server.stored().languages).toEqual(hindi);
  });

  it("never reads the server on the way to a dictation", async () => {
    dir = await mkdtemp(join(tmpdir(), "subx-voice-"));
    const server = fakeServer({ languages: hindi });
    const copy = new VoiceSettingsCopy(
      () => join(dir, "voice.json"),
      server.backend,
      new MemoryDictionary([]),
    );
    await copy.sync();
    const before = server.calls.get;
    for (let i = 0; i < 5; i++) await copy.forDictation();
    expect(server.calls.get).toBe(before);
  });
});
