import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DictionaryEntry, FieldReader } from "@subx/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditLearner, QUIET_MS } from "./learner";

/** A field the test types into: `type` is a reading, `close` is the watch ending. */
function fakeField() {
  let onText: ((text: string) => void) | null = null;
  let onEnd: ((reason?: string) => void) | null = null;
  const reader: FieldReader = {
    watch(text, end) {
      onText = text;
      onEnd = end;
      return { stop: () => {} };
    },
  };
  return { reader, type: (text: string) => onText?.(text), close: () => onEnd?.() };
}

describe("learning words from the user's edits", () => {
  let entries: DictionaryEntry[];
  let learned: string[][];
  let field: ReturnType<typeof fakeField>;
  let learner: EditLearner;
  let enabled: boolean;
  let logs: string[];

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), "subx-learner-"));
    entries = [];
    learned = [];
    logs = [];
    enabled = true;
    field = fakeField();
    learner = new EditLearner({
      field: field.reader,
      dictionary: {
        all: async () => entries,
        upsert: async (entry) => {
          // Like the real store: the same word is replaced, a new one appended.
          const at = entries.findIndex((existing) => existing.word === entry.word);
          if (at >= 0) entries[at] = entry;
          else entries.push(entry);
        },
        remove: async (word) => {
          entries = entries.filter((entry) => entry.word !== word);
        },
      },
      memoryPath: () => join(dir, "learned.json"),
      enabled: async () => enabled,
      onLearned: (words) => learned.push(words),
      log: (line) => logs.push(line),
    });
  });

  // Windows hand test, 2026-11-20: "Maujooma" was fixed and nothing was learned, and nothing in the
  // log said the fix had even been seen. Now it says so, without the words (the field is private).
  it("logs an edit it saw but would not learn from, without the words", async () => {
    await learner.pasted("Send it to Arnav today");
    field.type("Send it to Arnav today");
    field.type("Send it to Priya today");
    await learner.settle("the edit is done");
    expect(entries).toEqual([]);
    expect(logs).toEqual(["learn: the box was changed, but not as a one-word respelling (the edit is done)"]);
    expect(logs.join(" ")).not.toContain("Priya");
  });

  it("learns a name from the last reading, not from the keystrokes before it", async () => {
    await learner.pasted("Send it to Arnav today", "Notes");
    field.type("Send it to Aar today");
    field.type("Send it to Aarnav today");
    await learner.settle();
    expect(entries).toMatchObject([
      { word: "Aarnav", misheardAs: [], source: "learned", writtenAs: ["Arnav"], learnedIn: "Notes" },
    ]);
    expect(learned).toEqual([["Aarnav"]]);
  });

  it("keeps the fix when the message is sent and the field empties", async () => {
    await learner.pasted("Send it to Arnav today");
    field.type("Send it to Aarnav today");
    field.type("");
    await learner.settle();
    expect(entries.map((entry) => entry.word)).toEqual(["Aarnav"]);
  });

  it("learns nothing when the user put the word back", async () => {
    await learner.pasted("Send it to Arnav today");
    field.type("Send it to Aarnav today");
    field.type("Send it to Arnav today");
    field.close();
    await learner.settle();
    expect(entries).toEqual([]);
  });

  it("learns an ordinary word only once the same fix is made a second time", async () => {
    await learner.pasted("kal parson office aaunga");
    field.type("kal parso office aaunga");
    await learner.settle();
    expect(entries).toEqual([]);

    await learner.pasted("parson milte hain");
    field.type("parso milte hain");
    await learner.settle();
    expect(entries.map((entry) => entry.word)).toEqual(["parso"]);
  });

  it("never learns again a word the user removed", async () => {
    await learner.removed("Aarnav");
    await learner.pasted("Send it to Arnav today");
    field.type("Send it to Aarnav today");
    await learner.settle();
    expect(entries).toEqual([]);
  });

  it("does nothing when learning is turned off", async () => {
    enabled = false;
    await learner.pasted("Send it to Arnav today");
    field.type("Send it to Aarnav today");
    await learner.settle();
    expect(entries).toEqual([]);
  });

  it("keeps watching when the first reading comes before the paste has landed", async () => {
    await learner.pasted("Send it to Arnav today");
    field.type("Hi team,"); // ⌘V not processed yet: our words are not in the field
    field.type("Hi team, Send it to Arnav today");
    field.type("Hi team, Send it to Aarnav today");
    await learner.settle();
    expect(entries.map((entry) => entry.word)).toEqual(["Aarnav"]);
  });

  describe("after a quiet pause", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("learns the fix without waiting for the next dictation", async () => {
      await learner.pasted("Send it to Arnav today");
      field.type("Send it to Aarnav today");
      await vi.advanceTimersByTimeAsync(QUIET_MS + 10);
      // Had the pause not settled it, this reading (the old spelling back) would cancel the fix.
      field.type("Send it to Arnav today");
      // Waits for the learning's file write; there is nothing left for it to settle by now.
      await learner.settle();
      expect(learned).toEqual([["Aarnav"]]);
    });
  });

  it("keeps a fix seen once in a waiting list, which the user can accept or drop", async () => {
    await learner.pasted("kal parson office aaunga", "WhatsApp");
    field.type("kal parso office aaunga");
    await learner.settle();
    const [waiting] = await learner.pending();
    expect(waiting).toMatchObject({ word: "parso", heardAs: "parson", app: "WhatsApp", count: 1 });
    await learner.acceptPending(waiting?.key ?? "");
    expect(entries).toMatchObject([{ word: "parso", source: "learned", writtenAs: ["parson"] }]);
    expect(await learner.pending()).toEqual([]);
  });

  it("remembers a new wrong spelling of a word already in the dictionary, quietly", async () => {
    entries.push({ word: "Aarnav", misheardAs: [], source: "learned", writtenAs: ["Arnav"] });
    await learner.pasted("Send it to Aarnaw today");
    field.type("Send it to Aarnav today");
    await learner.settle();
    expect(entries[0]?.writtenAs).toEqual(["Arnav", "Aarnaw"]);
    expect(learned).toEqual([]);
  });

  it("lets a removed word be learned again", async () => {
    await learner.removed("Aarnav");
    expect(await learner.removedWords()).toEqual(["Aarnav"]);
    await learner.allowAgain("aarnav");
    expect(await learner.removedWords()).toEqual([]);
  });

  it("settles the previous paste when the next one arrives", async () => {
    await learner.pasted("Send it to Arnav today");
    field.type("Send it to Aarnav today");
    await learner.pasted("Something new");
    expect(entries.map((entry) => entry.word)).toEqual(["Aarnav"]);
  });
});
