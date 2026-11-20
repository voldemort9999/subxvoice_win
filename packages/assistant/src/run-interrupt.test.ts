import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { AssistantEvent, Touch, UserInputWatch } from "@subx/core";
import { describe, expect, it } from "vitest";
import { say } from "./lang";
import { createAssistant } from "./run";
import type { AssistantTool } from "./tool";

function fakeModel() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, model: faux.getModel(), stream: models.streamSimple.bind(models) };
}

/** A watch whose user has been holding the mouse for 3 s, or is dictating. */
function busyWatch(opts: { dictating?: boolean } = {}): UserInputWatch {
  let dictating = opts.dictating ?? false;
  return {
    onTouch: (cb: (t: Touch) => void) => {
      if (!opts.dictating) cb({ startedAt: Date.now(), heldMs: 3000 });
      return () => {};
    },
    idleMs: () => 10_000,
    dictationActive: () => {
      const was = dictating;
      dictating = false; // the paste lands on the next poll
      return was;
    },
  };
}

const tool = (name: string, ran: string[], usesInput: boolean): AssistantTool => ({
  name,
  description: name,
  parameters: { type: "object", properties: {} },
  risk: "safe",
  usesInput,
  run: async () => {
    ran.push(name);
    return { text: `${name} done` };
  },
});

describe("the run and the user's own mouse and keyboard", () => {
  it("asks before a mouse action when the user has the mouse, and parks on 'baad mein'", async () => {
    const { faux, model, stream } = fakeModel();
    faux.setResponses([fauxAssistantMessage(fauxToolCall("left_click", {}), { stopReason: "toolUse" })]);
    const ran: string[] = [];
    const events: AssistantEvent[] = [];
    const run = createAssistant({
      model,
      stream,
      systemPrompt: "test",
      tools: [tool("left_click", ran, true)],
      watch: busyWatch(),
    }).start("Zomato pe burger dhoondo", (e) => {
      events.push(e);
      if (e.kind === "ask") run.reply({ kind: "choice", id: e.id, value: "Baad mein" });
    });
    const result = await run.finished;
    expect(events).toContainEqual({ kind: "paused", reason: "user-input" });
    expect(events.some((e) => e.kind === "ask" && e.question === say().touchQuestion)).toBe(true);
    expect(ran).toEqual([]);
    expect(result.ok).toBe(false);
    expect(events.some((e) => e.kind === "parked")).toBe(true);
  });

  it("lets a tree or domain action run while the user has the mouse", async () => {
    const { faux, model, stream } = fakeModel();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("set_volume", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("Ho gaya."),
      fauxAssistantMessage("Ho gaya."),
    ]);
    const ran: string[] = [];
    const events: AssistantEvent[] = [];
    await createAssistant({
      model,
      stream,
      systemPrompt: "test",
      tools: [tool("set_volume", ran, false)],
      watch: busyWatch(),
    }).start("volume 30", (e) => events.push(e)).finished;
    expect(ran).toEqual(["set_volume"]);
    expect(events.some((e) => e.kind === "ask")).toBe(false);
  });

  it("has the screen read again after a dictation landed before a mouse action", async () => {
    const { faux, model, stream } = fakeModel();
    let told = "";
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("left_click", {}), { stopReason: "toolUse" }),
      (context: TranscriptContext) => {
        const last = context.messages.at(-1);
        if (last?.role === "toolResult")
          told = last.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
        return fauxAssistantMessage("Theek hai.");
      },
    ]);
    const ran: string[] = [];
    await createAssistant({
      model,
      stream,
      systemPrompt: "test",
      tools: [tool("left_click", ran, true)],
      watch: busyWatch({ dictating: true }),
    }).start("click karo", () => {}).finished;
    expect(ran).toEqual([]);
    expect(told).toMatch(/dictat/i);
  });
});
