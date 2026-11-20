import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryDictionary } from "@subx/core/fakes";
import { afterEach, describe, expect, it } from "vitest";
import { type Backend, type DictionaryChange, OfflineError } from "./backend";
import { VoiceSettingsCopy } from "./voice";

const hindi = { spoken: ["hi"], hinglish: false, writeIn: null };
type Word = { word: string; misheardAs: string[] };

/**
 * One account on the server, the way subxvoice-api keeps it: settings merged on update, the
 * dictionary changed word by word, a version that moves on every write. Can be switched off.
 */
function fakeServer(start: Record<string, unknown>) {
  let stored: Record<string, unknown> = { dictionary: [], ...start };
  let version = 1;
  const calls = { get: 0, put: 0, words: 0 };
  let online = true;
  const at = () => `v${version}`;
  const check = () => {
    if (!online) throw new OfflineError("offline");
  };
  const backend: Backend = {
    settings: async () => {
      calls.get++;
      check();
      return { value: structuredClone(stored) as never, version: at() };
    },
    update: async (patch) => {
      calls.put++;
      check();
      stored = { ...stored, ...patch };
      version++;
      return { value: structuredClone(stored) as never, version: at() };
    },
    changeDictionary: async (change: DictionaryChange) => {
      calls.words++;
      check();
      const gone = new Set(change.remove.map((w) => w.toLowerCase()));
      const incoming = new Map(change.upsert.map((e) => [e.word.toLowerCase(), e]));
      const kept = (stored.dictionary as Word[]).filter(
        (e) => !gone.has(e.word.toLowerCase()) && !incoming.has(e.word.toLowerCase()),
      );
      stored = { ...stored, dictionary: [...kept, ...incoming.values()] };
      version++;
      return { value: structuredClone(stored.dictionary) as Word[], version: at() };
    },
    stats: async () => ({ usage: { used: 0, limit: 0, remaining: 0 }, days: [], settingsVersion: at() }),
    devices: async () => [],
    languages: async () => [],
    deleteAccount: async () => {},
  };
  return {
    backend,
    calls,
    version: at,
    setOnline: (value: boolean) => (online = value),
    words: () => (stored.dictionary as Word[]).map((e) => e.word).sort(),
    stored: () => stored,
  };
}

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** One computer signed in to the account. */
async function device(server: ReturnType<typeof fakeServer>, words: Word[] = []) {
  const dir = await mkdtemp(join(tmpdir(), "subx-voice-"));
  dirs.push(dir);
  const dictionary = new MemoryDictionary(words);
  const copy = new VoiceSettingsCopy(() => join(dir, "voice.json"), server.backend, dictionary);
  return {
    copy,
    dictionary,
    words: async () => (await dictionary.all()).map((e) => e.word).sort(),
    add: async (word: string, misheardAs: string[] = []) => {
      await dictionary.upsert({ word, misheardAs, source: "you" });
      await copy.pushDictionary();
    },
    remove: async (word: string) => {
      await dictionary.remove(word);
      await copy.pushDictionary();
    },
  };
}

describe("VoiceSettingsCopy", () => {
  it("on a new Mac takes the server's settings and adds its dictionary words", async () => {
    const server = fakeServer({ languages: hindi, dictionary: [{ word: "Aarnav", misheardAs: [] }] });
    const mac = await device(server);
    await mac.copy.sync();
    expect((await mac.copy.current())?.languages).toEqual(hindi);
    expect(await mac.words()).toEqual(["Aarnav"]);
    // What a dictation sends: the settings, without the dictionary (its words go as terms).
    expect(await mac.copy.forDictation()).toEqual({ languages: hindi });
  });

  it("sends words only this Mac has up to the server at sync", async () => {
    const server = fakeServer({ languages: hindi });
    const mac = await device(server, [{ word: "Bhavesh", misheardAs: [] }]);
    await mac.copy.sync();
    expect(server.words()).toEqual(["Bhavesh"]);
  });

  it("a word added on each device at the same time: both stay, on the server and on both devices", async () => {
    const server = fakeServer({ languages: hindi });
    const mac = await device(server);
    const pc = await device(server);
    await Promise.all([mac.copy.sync(), pc.copy.sync()]);

    await Promise.all([mac.add("SUBXVoice", ["sub x voice"]), pc.add("Aarnav")]);
    expect(server.words()).toEqual(["Aarnav", "SUBXVoice"]);

    // Each hears of the other's word through the version (after a dictation, or the stats).
    await mac.copy.versionSeen(server.version());
    await pc.copy.versionSeen(server.version());
    expect(await mac.words()).toEqual(["Aarnav", "SUBXVoice"]);
    expect(await pc.words()).toEqual(["Aarnav", "SUBXVoice"]);
  });

  it("a word deleted on one device is deleted on the other, and does not come back", async () => {
    const server = fakeServer({ languages: hindi, dictionary: [{ word: "Celeris", misheardAs: [] }] });
    const mac = await device(server);
    const pc = await device(server);
    await mac.copy.sync();
    await pc.copy.sync();

    await pc.remove("Celeris");
    expect(server.words()).toEqual([]);
    await mac.copy.versionSeen(server.version());
    expect(await mac.words()).toEqual([]);

    // The Mac's next change must not send the old word back.
    await mac.add("Aarnav");
    expect(server.words()).toEqual(["Aarnav"]);
  });

  it("an edit made on another device is taken here", async () => {
    const server = fakeServer({ languages: hindi, dictionary: [{ word: "Celeris", misheardAs: [] }] });
    const mac = await device(server);
    const pc = await device(server);
    await mac.copy.sync();
    await pc.copy.sync();

    await pc.add("Celeris", ["sellers"]);
    await mac.copy.versionSeen(server.version());
    expect((await mac.dictionary.all())[0]?.misheardAs).toEqual(["sellers"]);
  });

  it("a change of capitals made elsewhere replaces the word here instead of adding a second one", async () => {
    const server = fakeServer({ languages: hindi, dictionary: [{ word: "Celeris", misheardAs: [] }] });
    const mac = await device(server);
    const pc = await device(server);
    await mac.copy.sync();
    await pc.copy.sync();
    await pc.remove("Celeris");
    await pc.add("CELERIS");
    await mac.copy.versionSeen(server.version());
    expect(await mac.words()).toEqual(["CELERIS"]);
  });

  it("tells the window when words arrived from another device", async () => {
    const server = fakeServer({ languages: hindi });
    let told = 0;
    const dir = await mkdtemp(join(tmpdir(), "subx-voice-"));
    dirs.push(dir);
    const copy = new VoiceSettingsCopy(
      () => join(dir, "voice.json"),
      server.backend,
      new MemoryDictionary([]),
      () => told++,
    );
    await copy.sync();
    const pc = await device(server);
    await pc.copy.sync();
    await pc.add("Aarnav");
    await copy.versionSeen(server.version());
    expect(told).toBe(1);
  });

  it("asks nothing when nothing changed here and the version is the one it has", async () => {
    const server = fakeServer({ languages: hindi });
    const mac = await device(server);
    await mac.copy.sync();
    const before = { ...server.calls };
    await mac.copy.pushDictionary();
    await mac.copy.versionSeen(server.version());
    expect(server.calls).toEqual(before);
  });

  it("sends changes one round at a time, and every word added meanwhile arrives", async () => {
    const server = fakeServer({ languages: hindi });
    const mac = await device(server);
    await mac.copy.sync();
    let inFlight = 0;
    let most = 0;
    const change = server.backend.changeDictionary;
    server.backend.changeDictionary = async (c) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return change(c);
    };
    await Promise.all(["Supabase", "SUBX", "SUBXVoice"].map((word) => mac.add(word)));
    expect(server.words()).toEqual(["SUBX", "SUBXVoice", "Supabase"]);
    expect(most).toBe(1);
  });

  it("a word added offline works at once and goes up when the server is back", async () => {
    const server = fakeServer({ languages: hindi });
    const mac = await device(server);
    await mac.copy.sync();
    server.setOnline(false);
    await mac.add("Aarnav");
    expect(await mac.words()).toEqual(["Aarnav"]);
    expect(server.words()).toEqual([]);
    server.setOnline(true);
    await mac.copy.sync();
    expect(server.words()).toEqual(["Aarnav"]);
  });

  it("keeps a setting changed offline, uses it at once, and sends it (without the list) at the next sync", async () => {
    const server = fakeServer({ languages: { spoken: "auto", hinglish: true, writeIn: null } });
    const mac = await device(server, [{ word: "Aarnav", misheardAs: [] }]);
    await mac.copy.sync();
    server.setOnline(false);
    await mac.copy.update({ languages: hindi });
    expect((await mac.copy.forDictation())?.languages).toEqual(hindi);
    server.setOnline(true);
    await mac.copy.sync();
    expect(server.stored().languages).toEqual(hindi);
    expect(server.words()).toEqual(["Aarnav"]);
  });

  it("never reads the server on the way to a dictation", async () => {
    const server = fakeServer({ languages: hindi });
    const mac = await device(server);
    await mac.copy.sync();
    const before = server.calls.get;
    await mac.copy.forDictation();
    await mac.copy.forDictation();
    expect(server.calls.get).toBe(before);
  });
});
