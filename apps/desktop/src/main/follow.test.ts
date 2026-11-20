import type { Assistant, AssistantEvent, AssistantRun, UserReply } from "@subx/core";
import { describe, expect, it } from "vitest";
import { createFollow } from "./follow";

/** An assistant whose runs the test finishes by hand. */
function fakeAssistant() {
  const started: string[] = [];
  const replies: UserReply[] = [];
  const finishers: Array<(text: string) => void> = [];
  let emit: (event: AssistantEvent) => void = () => {};
  const assistant: Assistant = {
    start(said, onEvent): AssistantRun {
      started.push(said);
      emit = onEvent;
      let finish!: (r: { ok: boolean; text: string }) => void;
      const finished = new Promise<{ ok: boolean; text: string }>((resolve) => {
        finish = resolve;
      });
      finishers.push((text) => {
        onEvent({ kind: "done", ok: true, text });
        finish({ ok: true, text });
      });
      return {
        id: `run-${started.length}`,
        reply: (r) => replies.push(r),
        stop: () => {},
        hold: () => {},
        finished,
      };
    },
  };
  return {
    assistant,
    started,
    replies,
    finish: (text: string) => finishers.at(-1)?.(text),
    emit: (e: AssistantEvent) => emit(e),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Follow My Words routing (plan T15)", () => {
  it("starts a run on the first command, and sends speech during it to the run, not a new run", () => {
    const a = fakeAssistant();
    const follow = createFollow({ assistant: () => a.assistant, onEvent: () => {} });
    follow.said("WhatsApp pe Aryan ko hi likho");
    follow.said("ruko, Priya ko bhi");
    expect(a.started).toEqual(["WhatsApp pe Aryan ko hi likho"]);
    expect(a.replies).toEqual([{ kind: "speech", text: "ruko, Priya ko bhi" }]);
    expect(follow.busy()).toBe(true);
  });

  it("starts a new run once the last one is done", async () => {
    const a = fakeAssistant();
    const follow = createFollow({ assistant: () => a.assistant, onEvent: () => {} });
    follow.said("volume 30");
    a.finish("Volume 30 kar diya.");
    await tick();
    expect(follow.busy()).toBe(false);
    follow.said("brightness 50");
    expect(a.started).toEqual(["volume 30", "brightness 50"]);
  });

  it("passes the run's events on, and a capsule button press back to the run", () => {
    const a = fakeAssistant();
    const seen: AssistantEvent[] = [];
    const follow = createFollow({ assistant: () => a.assistant, onEvent: (e) => seen.push(e) });
    follow.reply({ kind: "approval", id: "x", allowed: true }); // nothing running: ignored
    follow.said("Aryan ko bhej do");
    a.emit({ kind: "approve", id: "run-1-approve-1", what: "Send", why: "it sends" });
    follow.reply({ kind: "approval", id: "run-1-approve-1", allowed: true });
    // The capsule says something the moment the run starts, before the model's first answer.
    expect(seen).toEqual([
      { kind: "working", text: "Samajh raha hoon…", lang: "hi" },
      { kind: "approve", id: "run-1-approve-1", what: "Send", why: "it sends" },
    ]);
    expect(a.replies).toEqual([{ kind: "approval", id: "run-1-approve-1", allowed: true }]);
  });
});

describe("parseReply — a capsule press arrives from the renderer (trust boundary)", () => {
  it("accepts the four reply shapes", async () => {
    const { parseReply } = await import("./follow");
    expect(parseReply({ kind: "approval", id: "a", allowed: true })).toEqual({
      kind: "approval",
      id: "a",
      allowed: true,
    });
    expect(parseReply({ kind: "choice", id: "a", value: "Pie64" })).toEqual({
      kind: "choice",
      id: "a",
      value: "Pie64",
    });
    expect(parseReply({ kind: "insert", id: "a", inserted: false })).toEqual({
      kind: "insert",
      id: "a",
      inserted: false,
    });
    expect(parseReply({ kind: "speech", text: "continue" })).toEqual({ kind: "speech", text: "continue" });
  });

  it("refuses anything else, and an Allow that is not literally true", async () => {
    const { parseReply } = await import("./follow");
    expect(parseReply({ kind: "approval", id: "a", allowed: "yes" })).toBeNull();
    expect(parseReply({ kind: "approval", allowed: true })).toBeNull();
    expect(parseReply({ kind: "choice", id: "a", value: "x".repeat(2001) })).toBeNull();
    expect(parseReply("approve")).toBeNull();
    expect(parseReply(null)).toBeNull();
  });
});

describe("the capsule's own lines follow the user's language", () => {
  it("answers an English request in English, and tells the capsule which language", () => {
    const a = fakeAssistant();
    const seen: AssistantEvent[] = [];
    const follow = createFollow({ assistant: () => a.assistant, onEvent: (e) => seen.push(e) });
    expect(follow.said("open notepad and type hello")).toBe("On it…");
    expect(seen[0]).toEqual({ kind: "working", text: "Working on it…", lang: "en" });
    expect(follow.said("also type bye")).toBe("Got it");
  });

  it("answers a Hindi or Hinglish request in Hinglish", () => {
    const a = fakeAssistant();
    const seen: AssistantEvent[] = [];
    const follow = createFollow({ assistant: () => a.assistant, onEvent: (e) => seen.push(e) });
    expect(follow.said("Notepad खोलो")).toBe("Kar raha hoon…");
    expect(seen[0]).toEqual({ kind: "working", text: "Samajh raha hoon…", lang: "hi" });
    expect(follow.said("hello bhi likho")).toBe("Sun liya");
  });
});
