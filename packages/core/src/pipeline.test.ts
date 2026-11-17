import { describe, expect, it } from "vitest";
import type { DeciderProvider } from "./contracts/decider";
import { FakeInserter, FakeLlm, FakeStt, MemoryDictionary, MemoryHistory } from "./fakes";
import { Pipeline } from "./pipeline";
import { Router } from "./router";

const audio = { samples: new Int16Array(16000), sampleRate: 16000 };

function setup(spoken: string, llm?: FakeLlm) {
  const inserter = new FakeInserter();
  const history = new MemoryHistory();
  const pipeline = new Pipeline({
    stt: new FakeStt(spoken),
    llm,
    inserter,
    history,
    dictionary: new MemoryDictionary([{ word: "SUBXVoice", misheardAs: ["sub x voice"] }]),
  });
  return { pipeline, inserter, history };
}

describe("Pipeline", () => {
  it("exact mode: applies the dictionary, inserts, and saves history", async () => {
    const { pipeline, inserter, history } = setup("testing sub x voice today");

    const outcome = await pipeline.process(audio, "exact", { appName: "Notes" });

    expect(inserter.inserted).toEqual(["testing SUBXVoice today"]);
    expect(outcome.kind).toBe("inserted");
    expect(history.records[0]?.rawText).toBe("testing sub x voice today");
    expect(history.records[0]?.context.appName).toBe("Notes");
  });

  it("style mode: sends the cleaned text to the LLM and inserts its reply", async () => {
    const llm = new FakeLlm("I won't be able to come today.");
    const { pipeline, inserter } = setup("umm i wont be able to come today", llm);

    await pipeline.process(audio, "style", { appName: "Slack" });

    expect(inserter.inserted).toEqual(["I won't be able to come today."]);
    expect(llm.requests[0]?.system).toContain("Slack");
  });

  it("style mode without an LLM fails instead of guessing", async () => {
    const { pipeline } = setup("hello");
    await expect(pipeline.process(audio, "style", {})).rejects.toThrow("LLM");
  });

  it("says why the words went in as heard when rewriting fails", async () => {
    // A dictation that lands in Devanagari after the user asked for Roman looks like a broken
    // feature unless the reason travels with it.
    const llm = new FakeLlm("");
    llm.complete = async () => {
      throw new Error("401 Unauthorized");
    };
    const { pipeline, inserter, history } = setup("मेरा नाम भावेश है", llm);

    const outcome = await pipeline.process(audio, "exact", {}, { script: "roman" });

    expect(outcome.kind).toBe("inserted");
    // The words are never lost.
    expect(inserter.inserted).toEqual(["मेरा नाम भावेश है"]);
    expect(history.records[0]?.rewriteError).toMatch(/401/);
  });

  it("says so when rewriting comes back with nothing", async () => {
    const { pipeline, inserter, history } = setup("मेरा नाम भावेश है", new FakeLlm("   "));

    await pipeline.process(audio, "exact", {}, { script: "roman" });

    expect(inserter.inserted).toEqual(["मेरा नाम भावेश है"]);
    expect(history.records[0]?.rewriteError).toMatch(/empty/i);
  });

  it("records nothing when there was nothing to rewrite", async () => {
    // Pure Latin with a Roman preference never reaches the model, so it is not a failure.
    const { pipeline, history } = setup("already in latin", new FakeLlm("unused"));

    await pipeline.process(audio, "exact", {}, { script: "roman" });

    expect(history.records[0]?.rewriteError).toBeUndefined();
  });

  it("says so when there is no model to rewrite with", async () => {
    const { pipeline, history } = setup("मेरा नाम भावेश है");

    await pipeline.process(audio, "exact", {}, { script: "roman" });

    expect(history.records[0]?.rewriteError).toMatch(/unavailable/i);
  });

  it("says so when the model answers but leaves the script alone", async () => {
    // The call succeeds and returns text, so nothing throws — but it did not do the one thing it
    // was for, and silence here reads as "the setting does nothing".
    const { pipeline, history } = setup("मेरा नाम भावेश है", new FakeLlm("मेरा नाम भावेश है"));

    await pipeline.process(audio, "exact", {}, { script: "roman" });

    expect(history.records[0]?.rewriteError).toMatch(/original script/i);
  });

  it("asks once more, firmly, when the first answer stayed in Devanagari", async () => {
    const replies = ["मेरा नाम भावेश है", "Mera naam Bhavesh hai"];
    const llm = new FakeLlm("");
    llm.complete = async (request) => {
      llm.requests.push(request);
      return { text: replies.shift() ?? "", toolCalls: [] };
    };
    const { pipeline, history } = setup("मेरा नाम भावेश है", llm);

    await pipeline.process(audio, "exact", {}, { script: "roman" });

    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[1]?.system).toMatch(/Latin \(Roman\) letters/);
    expect(history.records[0]?.finalText).toBe("Mera naam Bhavesh hai");
    expect(history.records[0]?.rewriteError).toBeUndefined();
  });

  it("a command with no intent of its own is handed back, not typed", async () => {
    const inserter = new FakeInserter();
    const pipeline = new Pipeline({
      stt: new FakeStt("open spotify and play something"),
      inserter,
      history: new MemoryHistory(),
      dictionary: new MemoryDictionary([]),
      router: new Router([{ command: "open_app", phrases: ["open spotify"] }]),
    });

    const outcome = await pipeline.process(audio, "exact", {});

    expect(outcome).toMatchObject({ kind: "command", command: "open_app" });
    expect(inserter.inserted).toEqual([]);
  });

  it("keeps the dictation in history when pasting fails", async () => {
    const { pipeline, inserter, history } = setup("testing sub x voice today");
    inserter.insert = async () => {
      throw new Error("no paste permission");
    };

    const outcome = await pipeline.process(audio, "exact", {});

    expect(outcome).toMatchObject({ kind: "inserted", pasteError: "no paste permission" });
    expect(history.records[0]?.finalText).toBe("testing SUBXVoice today");
  });

  it("silence produces nothing", async () => {
    const { pipeline, inserter } = setup("   ");
    expect(await pipeline.process(audio, "exact", {})).toEqual({ kind: "empty" });
    expect(inserter.inserted).toEqual([]);
  });

  it("reports the raw transcript before the model has rewritten it", async () => {
    const llm = new FakeLlm("main theek hoon");
    const { pipeline } = setup("मैं ठीक हूँ", llm);
    const seen: string[] = [];

    await pipeline.process(audio, "exact", {}, { script: "roman", onTranscript: (t) => seen.push(t) });

    expect(seen).toEqual(["मैं ठीक हूँ"]);
  });

  describe("Roman script preference", () => {
    it("transliterates non-Latin speech in exact mode", async () => {
      const llm = new FakeLlm("main theek hoon");
      const { pipeline, inserter } = setup("मैं ठीक हूँ", llm);

      await pipeline.process(audio, "exact", {}, { script: "roman" });

      expect(inserter.inserted).toEqual(["main theek hoon"]);
      expect(llm.requests[0]?.system).toMatch(/Latin letters/);
    });

    it("transliterates by default (Roman is the out-of-the-box behaviour)", async () => {
      const llm = new FakeLlm("main theek hoon");
      const { pipeline, inserter } = setup("मैं ठीक हूँ", llm);

      await pipeline.process(audio, "exact", {}); // no script option

      expect(inserter.inserted).toEqual(["main theek hoon"]);
    });

    it("keeps the native script when explicitly asked", async () => {
      const llm = new FakeLlm("main theek hoon");
      const { pipeline, inserter } = setup("मैं ठीक हूँ", llm);

      await pipeline.process(audio, "exact", {}, { script: "native" });

      expect(inserter.inserted).toEqual(["मैं ठीक हूँ"]);
      expect(llm.requests).toEqual([]);
    });

    // English goes through the model too: that is where misheard words are repaired and the
    // chat style applied. Whatever the model returns is tidied: no full stops.
    it("sends English through the model as well, and tidies the reply", async () => {
      const llm = new FakeLlm("hello there. see you at 2.30.");
      const { pipeline, inserter } = setup("Hello there. See you at 2.30.", llm);

      await pipeline.process(audio, "exact", {}, { script: "roman" });

      expect(llm.requests).toHaveLength(1);
      expect(inserter.inserted).toEqual(["hello there see you at 2.30"]);
    });

    it("types English as heard, with nothing to report, when there is no model", async () => {
      const { pipeline, inserter, history } = setup("hello there");

      await pipeline.process(audio, "exact", {}, { script: "roman" });

      expect(inserter.inserted).toEqual(["hello there"]);
      expect(history.records[0]?.rewriteError).toBeUndefined();
    });

    it("gives the model the user's dictionary words", async () => {
      const llm = new FakeLlm("SUBXVoice khol do");
      const { pipeline } = setup("सब एक्स वॉइस खोल दो", llm);

      await pipeline.process(audio, "exact", {}, { script: "roman" });

      expect(llm.requests[0]?.system).toContain("SUBXVoice");
    });

    // The user's words are the one thing we must never lose.
    it("inserts the original when the model fails", async () => {
      const llm = new FakeLlm("");
      llm.complete = async () => {
        throw new Error("provider down");
      };
      const { pipeline, inserter } = setup("मैं ठीक हूँ", llm);

      await pipeline.process(audio, "exact", {}, { script: "roman" });

      expect(inserter.inserted).toEqual(["मैं ठीक हूँ"]);
    });

    it("style mode folds the script into its single call", async () => {
      const llm = new FakeLlm("Main theek hoon.");
      const { pipeline, inserter } = setup("मैं ठीक हूँ", llm);

      await pipeline.process(audio, "style", {}, { script: "roman" });

      expect(inserter.inserted).toEqual(["Main theek hoon."]);
      expect(llm.requests).toHaveLength(1);
      expect(llm.requests[0]?.system).toMatch(/Latin letters/);
    });
  });

  describe("streaming session", () => {
    // FakeStt has no startStream, so open() must buffer and fall back to transcribe().
    it("buffers pushes and finalises on a batch-only plug", async () => {
      const { pipeline, inserter } = setup("testing sub x voice today");

      const session = await pipeline.open("exact", { appName: "Notes" });
      session.push(audio.samples.subarray(0, 8000));
      session.push(audio.samples.subarray(8000));
      const outcome = await session.finish();

      expect(outcome.kind).toBe("inserted");
      expect(inserter.inserted).toEqual(["testing SUBXVoice today"]);
    });

    it("uses the plug's live stream when it has one", async () => {
      const pushed: Int16Array[] = [];
      let batchUsed = false;
      const stt = {
        id: "streamy",
        capabilities: { streaming: true, codeSwitching: true, vocabularyHints: true },
        transcribe: async () => {
          batchUsed = true;
          return { text: "should not be used", languages: [] };
        },
        startStream: async () => ({
          push: (s: Int16Array) => pushed.push(s),
          partial: () => "partial so far",
          finish: async () => ({ text: "streamed words", languages: [] }),
        }),
      };
      const inserter = new FakeInserter();
      const pipeline = new Pipeline({
        stt,
        inserter,
        history: new MemoryHistory(),
        dictionary: new MemoryDictionary([]),
      });

      const session = await pipeline.open("exact", {});
      session.push(audio.samples);
      expect(session.partial()).toBe("partial so far");
      await session.finish();

      expect(pushed).toHaveLength(1); // went to the stream, not the buffer
      expect(inserter.inserted).toEqual(["streamed words"]);
      expect(batchUsed).toBe(false); // transcribe() was never touched
    });
  });
});

/**
 * Composing is the one path that throws the user's own words away and pastes something invented
 * in their place. Every test here is about when that is allowed to happen.
 */
describe("Pipeline intent", () => {
  const decider = (choice: string, confidence: number): DeciderProvider => ({
    id: "fake",
    decide: async () => ({ choice, confidence }),
  });

  function composing(spoken: string, written: string, intent: DeciderProvider | undefined) {
    const inserter = new FakeInserter();
    const history = new MemoryHistory();
    const llm = new FakeLlm(written);
    const pipeline = new Pipeline({
      stt: new FakeStt(spoken),
      llm,
      decider: intent,
      inserter,
      history,
      dictionary: new MemoryDictionary([]),
    });
    return { pipeline, inserter, history, llm };
  }

  /** Asks for an email without any trigger phrase, so only the classifier can notice. */
  const ASK = "mujhe apne manager ko kal ki chhutti ke baare mein likhna hai";
  /**
   * Dictation also goes through the model now (to repair mishearings and apply the chat style), so
   * "the user's words win" means: it was asked to clean up dictation, never to write an email.
   */
  const asDictation = (llm: FakeLlm) =>
    expect(llm.requests.every((r) => /clean up dictation/.test(r.system))).toBe(true);

  it("composes when the classifier is confident", async () => {
    const { pipeline, inserter, history } = composing(ASK, "Subject: Leave\n\nHi,", decider("email", 0.95));
    await pipeline.process(audio, "exact", {});
    expect(inserter.inserted).toEqual(["Subject: Leave\n\nHi,"]);
    expect(history.records[0]?.intent).toBe("email");
  });

  it("types what was said when the classifier is unsure", async () => {
    // Below the threshold the user's words win, because composing by mistake destroys them.
    const { pipeline, history, llm } = composing(ASK, "an invented email", decider("email", 0.4));
    await pipeline.process(audio, "exact", {});
    asDictation(llm);
    expect(history.records[0]?.intent).toBe("dictation");
  });

  it("types what was said when the classifier fails", async () => {
    const broken: DeciderProvider = {
      id: "broken",
      decide: async () => {
        throw new Error("decisions endpoint down");
      },
    };
    const { pipeline, history, llm } = composing(ASK, "an invented email", broken);
    await pipeline.process(audio, "exact", {});
    asDictation(llm);
    expect(history.records[0]?.intent).toBe("dictation");
  });

  it("types what was said when there is no classifier at all", async () => {
    const { pipeline, history, llm } = composing(ASK, "an invented email", undefined);
    await pipeline.process(audio, "exact", {});
    asDictation(llm);
    expect(history.records[0]?.intent).toBe("dictation");
  });

  it("keeps the spoken words when composing comes back empty, and says why", async () => {
    const { pipeline, inserter, history } = composing(ASK, "   ", decider("email", 1));
    await pipeline.process(audio, "exact", {});
    expect(inserter.inserted).toEqual([ASK]);
    expect(history.records[0]?.rewriteError).toMatch(/went in as heard/);
  });
});
