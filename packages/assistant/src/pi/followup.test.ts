import {
  type AssistantMessage,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { Agent, type AgentMessage } from "./index";

/** A fake model wired the way production wires a real one: through createModels. */
function fakeModel() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, model: faux.getModel(), streamFn: models.streamSimple.bind(models) };
}

const userText = (text: string): AgentMessage => ({
  role: "user",
  content: [{ type: "text", text }],
  timestamp: 0,
});

/** Every text a request carried, in order — what the model was shown. */
function textsIn(context: TranscriptContext): string[] {
  return context.messages.flatMap((m) =>
    typeof m.content === "string"
      ? [m.content]
      : m.content.flatMap((c) => (c.type === "text" ? [c.text] : [])),
  );
}

describe("Agent follow-up messages (vendored fix)", () => {
  it("asks getFollowUpMessages when the model stops, and runs one more turn with what it returns", async () => {
    const { faux, model, streamFn } = fakeModel();
    const seen: string[][] = [];
    const reply =
      (text: string) =>
      (context: TranscriptContext): AssistantMessage => {
        seen.push(textsIn(context));
        return fauxAssistantMessage(text);
      };
    faux.setResponses([reply("done"), reply("checked")]);

    let asked = 0;
    const agent = new Agent({
      initialState: { systemPrompt: "test", model, tools: [] },
      streamFn,
      getFollowUpMessages: async () => (asked++ === 0 ? [userText("verify every part")] : []),
    });

    await agent.prompt("do it");

    expect(asked).toBe(2);
    expect(faux.state.callCount).toBe(2);
    expect(seen[1]).toContain("verify every part");
  });

  it("drains its own queue before asking the option", async () => {
    const { faux, model, streamFn } = fakeModel();
    faux.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
    let asked = 0;
    const agent = new Agent({
      initialState: { systemPrompt: "test", model, tools: [] },
      streamFn,
      getFollowUpMessages: async () => {
        asked++;
        return [];
      },
    });
    agent.followUp(userText("queued"));

    await agent.prompt("go");

    expect(faux.state.callCount).toBe(2);
    expect(asked).toBe(1);
  });
});
