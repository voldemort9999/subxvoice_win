import { Pipeline } from "@subx/core";
import { FakeInserter, FakeStt, MemoryDictionary, MemoryHistory } from "@subx/core/fakes";
import { describe, expect, it } from "vitest";
import { createWorkflow, type WorkflowDeps } from "./workflow";

const clip = { samples: new Int16Array(16000), sampleRate: 16000 };

function build(opts: {
  spoken?: string;
  context?: { appName?: string; appId?: string };
  signedIn?: boolean;
}) {
  const inserter = new FakeInserter();
  const history = new MemoryHistory();
  const saved: string[] = [];
  const heard: string[] = [];

  const pipeline = new Pipeline({
    stt: new FakeStt(opts.spoken ?? "hello world"),
    inserter,
    history,
    dictionary: new MemoryDictionary([]),
  });

  const deps: WorkflowDeps = {
    pipeline,
    context: { current: async () => opts.context ?? { appName: "Notes" } },
    history: {
      save: (record) => history.save(record),
      attachAudio: async (id, path) => {
        saved.push(`${id}:${path}`);
      },
    },
    saveRecording: async () => "/tmp/rec.wav",
    onHeard: (text) => heard.push(text),
    onHistoryChanged: () => {},
    signedIn: async () => opts.signedIn ?? true,
  };

  const pasted: string[] = [];
  deps.onPasted = (text) => pasted.push(text);
  return { workflow: createWorkflow(deps), inserter, history, saved, heard, pasted };
}

describe("createWorkflow", () => {
  it("types the server's text and shows it in the pill", async () => {
    const { workflow, inserter, heard, pasted } = build({ spoken: "Hi there." });
    const run = await workflow.open("exact");
    run.push(clip.samples);
    const { text: message } = await run.finish(clip);

    expect(inserter.inserted).toEqual(["Hi there."]);
    expect(heard).toEqual(["Hi there."]);
    expect(pasted).toEqual(["Hi there."]);
    expect(message).toBe("Hi there.");
  });

  it("types nothing and learns nothing when no text box had the focus", async () => {
    const { workflow, inserter, history, pasted } = build({ spoken: "Hi there." });
    inserter.noTextBox = true;
    const run = await workflow.open("exact");
    run.push(clip.samples);
    const result = await run.finish(clip);

    expect(result).toEqual({ text: "Hi there.", nowhere: true });
    expect(pasted).toEqual([]);
    expect(history.records).toHaveLength(1);
  });

  it("refuses to record when signed out", async () => {
    const { workflow } = build({ signedIn: false });
    await expect(workflow.open("exact")).rejects.toThrow("Sign in");
  });

  it("refuses to record when the lock or login screen is in front", async () => {
    const { workflow, inserter } = build({
      spoken: "hello",
      context: { appName: "loginwindow", appId: "com.apple.loginwindow" },
    });
    await expect(workflow.open("exact")).rejects.toThrow("Unlock your PC");
    expect(inserter.inserted).toEqual([]);
  });

  it("saves audio to history after the text is typed", async () => {
    const { workflow, saved, history } = build({ spoken: "note this" });
    const run = await workflow.open("exact");
    await run.finish(clip);
    await Promise.resolve(); // let the fire-and-forget audio save settle

    expect(history.records).toHaveLength(1);
    expect(saved).toEqual([`${history.records[0]?.id}:/tmp/rec.wav`]);
  });

  it("reports silence without touching the cursor", async () => {
    const { workflow, inserter } = build({ spoken: "   " });
    const run = await workflow.open("exact");
    const { text: message } = await run.finish(clip);

    expect(message).toBe("Nothing heard");
    expect(inserter.inserted).toEqual([]);
  });

  it("drains the stream on cancel without typing", async () => {
    const { workflow, inserter } = build({ spoken: "discard me" });
    const run = await workflow.open("exact");
    run.push(clip.samples);
    run.cancel();
    await Promise.resolve();

    expect(inserter.inserted).toEqual([]);
  });
});

describe("the command key: Follow My Words (Mac UI port, 2026-11-19)", () => {
  function command(heard: { text: string; raw?: string }) {
    const built = build({});
    const said: string[] = [];
    const deps: WorkflowDeps = {
      pipeline: new Pipeline({
        stt: new FakeStt("unused"),
        inserter: built.inserter,
        history: built.history,
        dictionary: new MemoryDictionary([]),
      }),
      context: { current: async () => ({ appName: "Notes" }) },
      history: { save: async () => {}, attachAudio: async () => {} },
      saveRecording: async () => "/tmp/rec.wav",
      onHeard: () => {},
      onHistoryChanged: () => {},
      signedIn: async () => true,
      listen: async () => ({
        push: () => {},
        finish: async () => ({ ...heard, languages: [] }),
        cancel: () => {},
      }),
      follow: (text) => {
        said.push(text);
        return "Kar raha hoon…";
      },
    };
    return { workflow: createWorkflow(deps), said, inserter: built.inserter, history: built.history };
  }

  it("hands the words as heard — not the server's rewrite — to the assistant, and types nothing", async () => {
    const { workflow, said, inserter, history } = command({
      text: "Please message Priya: Hi.",
      raw: "WhatsApp par Priya ko hi bhejo",
    });
    const run = await workflow.open("command");
    run.push(clip.samples);
    const result = await run.finish(clip);
    expect(said).toEqual(["WhatsApp par Priya ko hi bhejo"]);
    expect(result.text).toBe("Kar raha hoon…");
    expect(inserter.inserted).toEqual([]);
    expect(history.records).toEqual([]);
  });

  it("says nothing was heard instead of starting an empty task", async () => {
    const { workflow, said } = command({ text: "", raw: "" });
    const run = await workflow.open("command");
    expect((await run.finish(clip)).text).toBe("Nothing heard");
    expect(said).toEqual([]);
  });
});
