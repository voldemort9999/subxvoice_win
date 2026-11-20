import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { AssistantEvent } from "@subx/core";
import { describe, expect, it } from "vitest";
import { createAssistant } from "./run";
import type { AssistantTool } from "./tool";

function fakeModel() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, model: faux.getModel(), stream: models.streamSimple.bind(models) };
}

const volumeTool = (calls: unknown[]): AssistantTool => ({
  name: "set_volume",
  description: "Set the volume",
  parameters: { type: "object", properties: { level: { type: "number" } }, required: ["level"] },
  risk: "safe",
  run: async (input) => {
    calls.push(input);
    return { text: "Volume is 30%." };
  },
});

describe("createAssistant", () => {
  it("runs a tool, says what it is doing, and ends with the model's last line", async () => {
    const { faux, model, stream } = fakeModel();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("set_volume", { level: 30 }), { stopReason: "toolUse" }),
      fauxAssistantMessage("Volume 30 kar diya."),
      // the self-check turn after an action
      fauxAssistantMessage("Volume 30 kar diya."),
    ]);
    const calls: unknown[] = [];
    const events: AssistantEvent[] = [];
    const assistant = createAssistant({ model, stream, systemPrompt: "test", tools: [volumeTool(calls)] });

    const run = assistant.start("volume 30 kar do", (e) => events.push(e));
    const result = await run.finished;

    expect(calls).toEqual([{ level: 30 }]);
    expect(events[0]).toEqual({ kind: "working", text: "set_volume" });
    expect(events.at(-1)).toEqual({ kind: "done", ok: true, text: "Volume 30 kar diya." });
    expect(result).toEqual({ ok: true, text: "Volume 30 kar diya." });
  });

  it("traces every tool call with its input and result, errors included (S-024: logs said only the name)", async () => {
    const { faux, model, stream } = fakeModel();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("set_volume", { level: 30 }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("broken", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("Ho gaya."),
      fauxAssistantMessage("Ho gaya."),
    ]);
    const broken: AssistantTool = {
      name: "broken",
      description: "fails",
      parameters: { type: "object" },
      risk: "safe",
      run: async () => {
        throw new Error("Which windows?");
      },
    };
    const lines: string[] = [];
    const assistant = createAssistant({
      model,
      stream,
      systemPrompt: "test",
      tools: [volumeTool([]), broken],
      trace: (line) => lines.push(line),
    });
    await assistant.start("volume 30 kar do", () => {}).finished;
    // Each line carries seconds since the run began, so a slow step shows where the time went (S-024).
    expect(lines.some((line) => /^\+\d+\.\d s set_volume \{"level":30\}$/.test(line))).toBe(true);
    expect(lines.some((line) => /^\+\d+\.\d s set_volume → Volume is 30%\. \(\d+ ms\)$/.test(line))).toBe(
      true,
    );
    expect(lines.some((line) => /^\+\d+\.\d s broken → ERROR Which windows\?/.test(line))).toBe(true);
  });

  it("tells the model what is open before its first step (S-024: BlueStacks was open, it opened another)", async () => {
    const { faux, model, stream } = fakeModel();
    let first = "";
    faux.setResponses([
      (context: TranscriptContext) => {
        // The faux transcript's message 0 is the system prompt; the user's words follow it.
        first = JSON.stringify(context.messages.filter((m) => m.role === "user"));
        return fauxAssistantMessage("Theek hai.");
      },
    ]);
    const assistant = createAssistant({
      model,
      stream,
      systemPrompt: "test",
      tools: [],
      observeState: async () => "Open windows: BlueStacks App Player; Chrome",
    });
    await assistant.start("BlueStacks mein Zomato install karo", () => {}).finished;
    expect(first).toContain("BlueStacks mein Zomato install karo");
    expect(first).toContain("Open windows: BlueStacks App Player; Chrome");
  });

  it("hands a tool's screenshot to the model as an image", async () => {
    const { faux, model, stream } = fakeModel();
    let sawImage = false;
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("screenshot", {}), { stopReason: "toolUse" }),
      (context: TranscriptContext) => {
        sawImage = context.messages.some(
          (m) => m.role === "toolResult" && m.content.some((c) => c.type === "image"),
        );
        return fauxAssistantMessage("Dekh liya.");
      },
    ]);
    const shot: AssistantTool = {
      name: "screenshot",
      description: "Take a screenshot",
      parameters: { type: "object", properties: {} },
      risk: "safe",
      run: async () => ({ text: "Screenshot:", image: { data: "iVBORw0KGgo=", mimeType: "image/png" } }),
    };

    await createAssistant({ model, stream, systemPrompt: "test", tools: [shot] }).start("dekho", () => {})
      .finished;

    expect(sawImage).toBe(true);
  });

  it("ends not-ok with the model's error when the model call keeps failing", async () => {
    const { faux, model, stream } = fakeModel();
    // Throttling is retried (src/retry.ts): three tries in all, no fallback configured.
    const throttled = () => fauxAssistantMessage("", { stopReason: "error", errorMessage: "throttled" });
    faux.setResponses([throttled(), throttled(), throttled()]);
    const result = await createAssistant({
      model,
      stream,
      systemPrompt: "test",
      tools: [],
      retryDelayMs: 1,
    }).start("kuch karo", () => {}).finished;
    expect(result.ok).toBe(false);
    expect(result.text).toContain("throttled");
  });
});
