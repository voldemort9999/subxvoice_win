import { describe, expect, it } from "vitest";
import { cleanHistory, repairReply } from "./hygiene";
import type { AgentMessage } from "./pi";

const call = (id: string, name: string) => ({ type: "toolCall" as const, id, name, arguments: {} });
const reply = (...content: unknown[]) =>
  ({ role: "assistant", content, timestamp: 0 }) as unknown as AgentMessage;
const result = (toolCallId: string, toolName: string, text = "ok") =>
  ({
    role: "toolResult",
    toolCallId,
    toolName,
    content: text === "" ? [] : [{ type: "text", text }],
    isError: false,
    timestamp: 0,
  }) as unknown as AgentMessage;
const blocks = (m: AgentMessage) => (m as unknown as { content: Record<string, unknown>[] }).content;

describe("repairReply — before the tools run (plan T14 a, b, e)", () => {
  it("cuts harmony leakage off a tool name", () => {
    const m = reply(call("1", "read_screen<|channel|>commentary"));
    repairReply(m, new Set());
    expect(blocks(m)[0]?.name).toBe("read_screen");
  });

  it("gives an empty or already-used id a fresh one, so each result answers one call", () => {
    const seen = new Set(["call_a"]);
    const m = reply(call("", "set_volume"), call("call_a", "set_volume"), call("x", "a"), call("x", "b"));
    repairReply(m, seen);
    const ids = blocks(m).map((b) => b.id as string);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(4);
    expect(ids).not.toContain("call_a");
    expect(ids[2]).toBe("x");
  });

  it("leaves a clean reply alone", () => {
    const m = reply({ type: "text", text: "Ho gaya." }, call("a1", "set_volume"));
    const before = JSON.stringify(m);
    repairReply(m, new Set());
    expect(JSON.stringify(m)).toBe(before);
  });
});

describe("cleanHistory — before each request (plan T14 c, d)", () => {
  it("sends no empty text block and no empty message (Bedrock: 'validation error … messages..member')", () => {
    const out = cleanHistory([
      reply({ type: "text", text: "" }, call("a1", "set_volume")),
      result("a1", "set_volume", ""),
      reply({ type: "text", text: "  " }),
    ]);
    expect(blocks(out[0]!)).toEqual([call("a1", "set_volume")]);
    expect(blocks(out[1]!)).toEqual([{ type: "text", text: "(no output)" }]);
    expect(blocks(out[2]!)).toEqual([{ type: "text", text: "(no reply)" }]);
  });

  it("renames a tool name no provider accepts, in the call and its result", () => {
    const out = cleanHistory([
      reply(call("a1", "read screen!")),
      result("a1", "read screen!", "Tool not found"),
    ]);
    expect(blocks(out[0]!)[0]?.name).toBe("invalid_tool_name");
    expect((out[1] as unknown as { toolName: string }).toolName).toBe("invalid_tool_name");
  });

  it("does not change the messages it was given", () => {
    const original = [reply({ type: "text", text: "" }, call("a1", "bad name"))];
    const copy = JSON.stringify(original);
    cleanHistory(original);
    expect(JSON.stringify(original)).toBe(copy);
  });
});

describe("a run through dirty replies (plan T14, faux model)", () => {
  it("runs a leaked tool name and two calls sharing an id, and sends no empty block", async () => {
    const { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } = await import(
      "@earendil-works/pi-ai"
    );
    const { createAssistant } = await import("./run");
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const ran: string[] = [];
    const tool = (name: string) => ({
      name,
      description: name,
      parameters: { type: "object", properties: {} },
      risk: "safe" as const,
      readOnly: true,
      run: async () => {
        ran.push(name);
        return { text: `${name} done` };
      },
    });
    let next: unknown[] = [];
    faux.setResponses([
      fauxAssistantMessage(
        [
          { type: "text", text: "" },
          fauxToolCall("read_state<|channel|>commentary", {}, { id: "same" }),
          fauxToolCall("read_time", {}, { id: "same" }),
        ],
        { stopReason: "toolUse" },
      ),
      (context: { messages: unknown[] }) => {
        next = context.messages;
        return fauxAssistantMessage("Ho gaya.");
      },
    ]);
    const result = await createAssistant({
      model: faux.getModel(),
      stream: models.streamSimple.bind(models),
      systemPrompt: "t",
      tools: [tool("read_state"), tool("read_time")],
    }).start("dekho", () => {}).finished;
    expect(ran).toEqual(["read_state", "read_time"]);
    expect(result.text).toBe("Ho gaya.");
    const sent = JSON.stringify(next);
    expect(sent).not.toContain('"text":""');
    expect(sent).not.toContain("<|");
  });
});

describe("a tool input that does not fit (plan T14 f)", () => {
  it("comes back to the model as an error result; the run carries on", async () => {
    const { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } = await import(
      "@earendil-works/pi-ai"
    );
    const { createAssistant } = await import("./run");
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    let next = "";
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("set_volume", { level: "loud" }), { stopReason: "toolUse" }),
      (context: { messages: unknown[] }) => {
        next = JSON.stringify(context.messages);
        return fauxAssistantMessage("Volume number mein batao.");
      },
    ]);
    const result = await createAssistant({
      model: faux.getModel(),
      stream: models.streamSimple.bind(models),
      systemPrompt: "t",
      tools: [
        {
          name: "set_volume",
          description: "v",
          parameters: { type: "object", properties: { level: { type: "number" } }, required: ["level"] },
          risk: "safe",
          run: async () => ({ text: "set" }),
        },
      ],
    }).start("volume", () => {}).finished;
    expect(result.ok).toBe(true);
    expect(next).toContain('"isError":true');
  });
});
