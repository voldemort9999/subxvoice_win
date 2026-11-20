import { describe, expect, it } from "vitest";
import type { SttOptions, Transcript } from "./contracts/stt";
import { FakeInserter, FakeStt, MemoryDictionary, MemoryHistory } from "./fakes";
import { Pipeline } from "./pipeline";

const audio = { samples: new Int16Array(16000), sampleRate: 16000 };
const dictionary = () =>
  new MemoryDictionary([
    { word: "SUBXVoice", misheardAs: ["sub x voice"] },
    { word: "Aarnav", misheardAs: [], source: "learned", writtenAs: ["Arnav"] },
  ]);

function setup(spoken: string) {
  const inserter = new FakeInserter();
  const history = new MemoryHistory();
  const pipeline = new Pipeline({ stt: new FakeStt(spoken), inserter, history, dictionary: dictionary() });
  return { pipeline, inserter, history };
}

/** A streaming plug that returns what our server would: text that is already written. */
class ServerStt {
  readonly id = "server";
  readonly capabilities = { streaming: true, codeSwitching: true, vocabularyHints: true };
  readonly opened: SttOptions[] = [];
  readonly pushed: Int16Array[] = [];
  batchUsed = false;
  constructor(private readonly transcript: Transcript) {}
  async transcribe(): Promise<Transcript> {
    this.batchUsed = true;
    return this.transcript;
  }
  async startStream(options: SttOptions) {
    this.opened.push(options);
    return {
      push: (samples: Int16Array) => this.pushed.push(samples),
      partial: () => "partial so far",
      finish: async () => this.transcript,
    };
  }
}

async function fromServer(transcript: Transcript) {
  const stt = new ServerStt(transcript);
  const inserter = new FakeInserter();
  const history = new MemoryHistory();
  const pipeline = new Pipeline({ stt, inserter, history, dictionary: dictionary() });
  const session = await pipeline.open("exact", { appName: "WhatsApp" });
  session.push(audio.samples);
  const outcome = await session.finish();
  return { stt, inserter, history, outcome, session };
}

describe("Pipeline", () => {
  it("applies the user's replacement rules, pastes, and saves history", async () => {
    const { pipeline, inserter, history } = setup("testing sub x voice today");

    const outcome = await pipeline.process(audio, "exact", { appName: "Notes" });

    expect(outcome.kind).toBe("inserted");
    expect(inserter.inserted).toEqual(["testing SUBXVoice today"]);
    expect(history.records[0]).toMatchObject({
      rawText: "testing sub x voice today",
      finalText: "testing SUBXVoice today",
      context: { appName: "Notes" },
    });
  });

  it("pastes the server's text as it is, line breaks kept", async () => {
    const { inserter, history, outcome } = await fromServer({
      text: "Hi Rahul,\n\nsee you at 3",
      raw: "Hi Rahul comma new paragraph see you at 3.",
      languages: [],
    });
    expect(outcome.kind).toBe("inserted");
    expect(inserter.inserted).toEqual(["Hi Rahul,\n\nsee you at 3"]);
    expect(history.records[0]).toMatchObject({
      rawText: "Hi Rahul comma new paragraph see you at 3.",
      finalText: "Hi Rahul,\n\nsee you at 3",
    });
  });

  it("records why the server could not rewrite", async () => {
    const { history } = await fromServer({ text: "Hello.", languages: [], rewriteError: "rewrite 500" });
    expect(history.records[0]?.rewriteError).toBe("rewrite 500");
  });

  it("streams to the plug, and tells it the app and the dictionary with its known misspellings", async () => {
    const { stt, session } = await fromServer({ text: "ok", languages: [] });
    expect(stt.pushed).toHaveLength(1);
    expect(stt.batchUsed).toBe(false);
    expect(session.partial()).toBe("partial so far");
    expect(stt.opened[0]).toMatchObject({
      app: "WhatsApp",
      vocabulary: ["SUBXVoice", "Aarnav"],
      hints: [
        { word: "SUBXVoice", heard: ["sub x voice"] },
        { word: "Aarnav", heard: ["Arnav"] },
      ],
    });
  });

  it("never replaces a learned misspelling blindly: that is the server's call, in context", async () => {
    const { inserter } = await fromServer({ text: "Arnav said hi", languages: [] });
    expect(inserter.inserted).toEqual(["Arnav said hi"]);
  });

  it("says when nothing that takes text had the focus", async () => {
    const { pipeline, inserter } = setup("hello");
    inserter.noTextBox = true;
    expect(await pipeline.process(audio, "exact", {})).toMatchObject({ kind: "inserted", nowhere: true });
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

  it("a cancelled dictation is neither typed nor kept", async () => {
    const { pipeline, inserter, history } = setup("do not type this");
    const session = await pipeline.open("exact", { appName: "Notes" });
    session.push(audio.samples);
    session.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(inserter.inserted).toEqual([]);
    expect(history.records).toEqual([]);
  });

  it("types but does not record a dictation the caller no longer keeps", async () => {
    const { pipeline, inserter, history } = setup("hello");
    const outcome = await pipeline.process(audio, "exact", {}, { keep: () => false });
    expect(outcome).toMatchObject({ kind: "inserted" });
    expect(inserter.inserted).toEqual(["hello"]);
    expect(history.records).toEqual([]);
  });

  it("silence produces nothing", async () => {
    const { pipeline, inserter } = setup("   ");
    expect(await pipeline.process(audio, "exact", {})).toEqual({ kind: "empty" });
    expect(inserter.inserted).toEqual([]);
  });

  it("reports the words before pasting them", async () => {
    const { pipeline } = setup("testing sub x voice");
    const seen: string[] = [];
    await pipeline.process(audio, "exact", {}, { onTranscript: (text) => seen.push(text) });
    expect(seen).toEqual(["testing SUBXVoice"]);
  });

  it("buffers pushes and finishes on a batch-only plug", async () => {
    const { pipeline, inserter } = setup("testing sub x voice today");
    const session = await pipeline.open("exact", {});
    session.push(audio.samples.subarray(0, 8000));
    session.push(audio.samples.subarray(8000));
    expect((await session.finish()).kind).toBe("inserted");
    expect(inserter.inserted).toEqual(["testing SUBXVoice today"]);
  });
});
