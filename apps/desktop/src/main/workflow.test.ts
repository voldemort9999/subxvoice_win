import { Pipeline } from "@subx/core";
import { FakeInserter, FakeStt, MemoryDictionary, MemoryHistory } from "@subx/core/fakes";
import { describe, expect, it } from "vitest";
import { createWorkflow, type WorkflowDeps } from "./workflow";

const clip = { samples: new Int16Array(16000), sampleRate: 16000 };

function build(opts: {
  spoken?: string;
  context?: { appName?: string; appId?: string };
  signedIn?: boolean;
  account?: () => string;
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
    ...(opts.account ? { account: opts.account } : {}),
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

  it("types but keeps nothing when another account signed in during the dictation", async () => {
    let account = "accounts/first";
    const { workflow, inserter, history, saved, pasted } = build({
      spoken: "Hi there.",
      account: () => account,
    });
    const run = await workflow.open("exact");
    run.push(clip.samples);
    account = "accounts/second";
    const result = await run.finish(clip);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result).toEqual({ text: "Hi there." });
    expect(inserter.inserted).toEqual(["Hi there."]);
    expect(history.records).toEqual([]);
    expect(saved).toEqual([]);
    expect(pasted).toEqual([]);
  });

  it("keeps the dictation when the account stayed the same", async () => {
    const { workflow, history, saved } = build({ spoken: "Hi there.", account: () => "accounts/first" });
    const run = await workflow.open("exact");
    run.push(clip.samples);
    await run.finish(clip);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(history.records).toHaveLength(1);
    expect(saved).toHaveLength(1);
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
