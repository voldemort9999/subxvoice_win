import {
  createAssistantMessageEventStream,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { createFinisher, SELF_CHECK } from "./finish";
import type { StreamFn } from "./pi";

/** The fake provider counts tokens but never prices them; this sets each reply's cost. */
const priced =
  (inner: StreamFn, total: number): StreamFn =>
  (model, context, options) => {
    const out = createAssistantMessageEventStream();
    void (async () => {
      const source = await inner(model, context, options);
      for await (const event of source) {
        if ("message" in event && event.message?.usage) event.message.usage.cost.total = total;
        out.push(event);
      }
      const result = await source.result();
      result.usage.cost.total = total;
      out.end(result);
    })();
    return out;
  };

import { type AssistantConfig, createAssistant } from "./run";
import type { AssistantTool } from "./tool";

function fakeModel() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, model: faux.getModel(), stream: models.streamSimple.bind(models) };
}

const texts = (context: TranscriptContext) =>
  context.messages.flatMap((m) =>
    typeof m.content === "string"
      ? [m.content]
      : m.content.flatMap((c) => (c.type === "text" ? [c.text] : [])),
  );

const act: AssistantTool = {
  name: "set_volume",
  description: "Set the volume",
  parameters: { type: "object", properties: {} },
  risk: "safe",
  run: async () => ({ text: "Volume set." }),
};
const look: AssistantTool = {
  ...act,
  name: "read_state",
  readOnly: true,
  run: async () => ({ text: "state" }),
};
const toolCall = (name: string) => fauxAssistantMessage(fauxToolCall(name, {}), { stopReason: "toolUse" });

function run(m: Pick<AssistantConfig, "model" | "stream">, extra: Partial<AssistantConfig> = {}) {
  return createAssistant({
    model: m.model,
    stream: m.stream,
    systemPrompt: "t",
    tools: [act, look],
    ...extra,
  }).start("volume 30", () => {}).finished;
}

describe("finishing a run", () => {
  it("tells the model to answer in the request's language, not the check's", () => {
    // The check itself is English; Kimi answered two Hinglish requests in English because it
    // replied in the language of the last message it saw (T8 bench).
    expect(SELF_CHECK).toContain("same language as the user's original request");
  });

  it("checks nothing was left behind for a target the user replaced, and never guesses a choice", () => {
    expect(SELF_CHECK).toContain("left behind");
    expect(SELF_CHECK).toContain("never guessed");
  });

  it("asks the model to verify every part once before it stops", async () => {
    const m = fakeModel();
    const seen: string[][] = [];
    const reply = (text: string) => (context: TranscriptContext) => {
      seen.push(texts(context));
      return fauxAssistantMessage(text);
    };
    m.faux.setResponses([toolCall("set_volume"), reply("Ho gaya."), reply("Check kiya, volume 30 hai.")]);
    const result = await run(m);
    expect(m.faux.state.callCount).toBe(3);
    expect(seen[1]).toContain(SELF_CHECK);
    expect(result).toEqual({ ok: true, text: "Check kiya, volume 30 hai." });
  });

  it("with the checklist on, offers update_checklist and sends back a pending part before the check", async () => {
    const m = fakeModel();
    // The faux transcript carries the system prompt as a message and no tool list; the pending part
    // coming back proves update_checklist was registered and ran.
    const seen: string[][] = [];
    const reply = (msg: ReturnType<typeof fauxAssistantMessage>) => (context: TranscriptContext) => {
      seen.push(texts(context));
      return msg;
    };
    m.faux.setResponses([
      reply(
        fauxAssistantMessage(
          fauxToolCall("update_checklist", {
            items: [
              { task: "volume 30", status: "done" },
              { task: "brightness 60", status: "pending" },
            ],
          }),
          { stopReason: "toolUse" },
        ),
      ),
      reply(toolCall("set_volume")),
      reply(fauxAssistantMessage("Ho gaya.")),
      reply(fauxAssistantMessage("Brightness nahi mila.")),
      reply(fauxAssistantMessage("Abhi bhi nahi mila.")),
      reply(fauxAssistantMessage("Volume 30 kar diya, brightness nahi mila.")),
    ]);
    const result = await run(m, { checklist: true });
    expect(seen[0]?.[0]).toContain("call update_checklist");
    expect(seen[3]?.at(-1)).toContain('"brightness 60"');
    expect(seen[4]?.at(-1)).toContain('"brightness 60"');
    // Two pushbacks at most, then the one self-check, then the run ends.
    expect(seen[5]?.at(-1)).toBe(SELF_CHECK);
    expect(result.text).toBe("Volume 30 kar diya, brightness nahi mila.");
  });

  it("without the checklist, the model is not told about it", async () => {
    const m = fakeModel();
    const prompts: string[] = [];
    m.faux.setResponses([
      (context: TranscriptContext) => {
        prompts.push(texts(context)[0] ?? "");
        return fauxAssistantMessage("Theek hai.");
      },
    ]);
    await run(m);
    expect(prompts[0]).toBe("t");
  });

  it("does not ask for a check when the run only looked", async () => {
    const m = fakeModel();
    m.faux.setResponses([toolCall("read_state"), fauxAssistantMessage("Battery 80% hai.")]);
    const result = await run(m);
    expect(m.faux.state.callCount).toBe(2);
    expect(result).toEqual({ ok: true, text: "Battery 80% hai." });
  });

  it("gives a malformed tool call one retry, then gives up", async () => {
    const m = fakeModel();
    m.faux.setResponses([
      fauxAssistantMessage('<|tool_call|>set_volume {"level":30}'),
      fauxAssistantMessage("to=functions.set_volume"),
      fauxAssistantMessage("never"),
    ]);
    const result = await run(m);
    expect(m.faux.state.callCount).toBe(2);
    expect(result.ok).toBe(false);
  });

  it("treats a tool call written out as text as malformed (Qwen: 'set_volume(level=80)')", async () => {
    const m = fakeModel();
    m.faux.setResponses([
      fauxAssistantMessage("set_volume(level=80)\nset_volume(level=60)"),
      toolCall("set_volume"),
      fauxAssistantMessage("Volume 60 kar diya."),
      fauxAssistantMessage("Volume 60 kar diya."),
    ]);
    const result = await run(m);
    expect(result).toEqual({ ok: true, text: "Volume 60 kar diya." });
  });

  it("treats a bare tool name as the whole reply as malformed (Qwen: 'get_state')", async () => {
    const m = fakeModel();
    m.faux.setResponses([
      fauxAssistantMessage("read_state"),
      toolCall("read_state"),
      fauxAssistantMessage("Volume 40 hai."),
    ]);
    expect(await run(m)).toEqual({ ok: true, text: "Volume 40 hai." });
  });

  it("does not take ordinary prose with brackets for a tool call", async () => {
    const m = fakeModel();
    m.faux.setResponses([fauxAssistantMessage("Volume (abhi) 40 hai.")]);
    expect(await run(m)).toEqual({ ok: true, text: "Volume (abhi) 40 hai." });
  });

  it("lets go of every held key and button however the run ends (review C1)", async () => {
    for (const [responses, extra] of [
      [[fauxAssistantMessage("Ho gaya.")], {}],
      [Array.from({ length: 5 }, () => toolCall("set_volume")), { maxTurns: 2 }],
    ] as const) {
      const m = fakeModel();
      m.faux.setResponses([...responses]);
      let released = 0;
      const result = await run(m, {
        ...extra,
        releaseInput: async () => {
          released++;
          throw new Error("SendInput blocked");
        },
      });
      expect(released).toBe(1);
      expect(result.text).toBeTruthy();
    }
  });

  it("stops at the turn limit and says so", async () => {
    const m = fakeModel();
    m.faux.setResponses(Array.from({ length: 10 }, () => toolCall("set_volume")));
    const result = await run(m, { maxTurns: 3 });
    expect(m.faux.state.callCount).toBe(3);
    expect(result.ok).toBe(false);
    expect(result.text).toContain("limit");
  });

  it("stops at the spend limit for one command", async () => {
    const m = fakeModel();
    m.faux.setResponses(Array.from({ length: 10 }, () => toolCall("set_volume")));
    const result = await run({ ...m, stream: priced(m.stream, 0.1) }, { maxCostUsd: 0.25 });
    expect(m.faux.state.callCount).toBe(3);
    expect(result.ok).toBe(false);
    // "volume 30" has no Hindi word, so the harness answers in English (lang.ts).
    expect(result.text).toContain("cost limit");
  });

  it("shows the state after an action, not after a look", async () => {
    const m = fakeModel();
    const results: string[][] = [];
    const note = (context: TranscriptContext) => {
      results.push(
        context.messages
          .filter((x) => x.role === "toolResult")
          .flatMap((x) => x.content.flatMap((c) => (c.type === "text" ? [c.text] : []))),
      );
    };
    m.faux.setResponses([
      toolCall("set_volume"),
      (context: TranscriptContext) => {
        note(context);
        return toolCall("read_state");
      },
      (context: TranscriptContext) => {
        note(context);
        return fauxAssistantMessage("done");
      },
      fauxAssistantMessage("checked"),
    ]);
    await run(m, { observeState: async () => "volume=30" });
    expect(results[0]?.join(" ")).toContain("[state after this action] volume=30");
    expect(results[1]?.at(-1)).toBe("state");
  });
});

// Demo hand test, 2026-11-19: Enter in WhatsApp was never allowed (the user spoke a new task
// instead), and the run still ended "Dragon ko message bhej diya".
describe("the self-check is told what the user never allowed", () => {
  it("names each action left undone, so the reply cannot claim it", () => {
    const finisher = createFinisher({
      lastText: () => "Ho gaya",
      acted: () => true,
      undone: () => ["WhatsApp.Root mein Enter dabana (message chala jayega)"],
    });
    const text = JSON.stringify(finisher.followUps());
    expect(text).toContain("Not done, because the user did not allow it");
    expect(text).toContain("WhatsApp.Root mein Enter dabana");
  });

  it("adds nothing when every action was allowed", () => {
    const finisher = createFinisher({ lastText: () => "Ho gaya", acted: () => true, undone: () => [] });
    expect(JSON.stringify(finisher.followUps())).not.toContain("did not allow");
  });
});
