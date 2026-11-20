import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { AssistantEvent } from "@subx/core";
import { describe, expect, it } from "vitest";
import { decide } from "./guard";
import { createAssistant } from "./run";
import type { AssistantTool } from "./tool";

const tool = (over: Partial<AssistantTool> = {}): AssistantTool => ({
  name: "t",
  description: "",
  parameters: { type: "object", properties: {} },
  risk: "safe",
  run: async () => ({ text: "ok" }),
  ...over,
});

describe("decide", () => {
  it("never stops a process Windows cannot live without, whatever the tool says", async () => {
    const kill = tool({ name: "processes", touches: "process", risk: "confirm" });
    expect((await decide(kill, { action: "kill", name: "lsass.exe" })).kind).toBe("never");
    expect((await decide(kill, { action: "kill", name: "Explorer" })).kind).toBe("never");
    expect((await decide(kill, { action: "kill", name: "SUBXVoice.exe" })).kind).toBe("never");
    expect((await decide(kill, { action: "kill", name: "notepad.exe" })).kind).toBe("ask");
  });

  it("never writes a boot or security registry path", async () => {
    const reg = tool({ name: "registry", touches: "registry", risk: "confirm" });
    const path = String.raw`HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\BootExecute`;
    expect((await decide(reg, { path })).kind).toBe("never");
    expect((await decide(reg, { path: String.raw`HKCU\Software\Example\Theme` })).kind).toBe("ask");
  });

  it("asks before a confirm tool and lets a safe one run", async () => {
    expect((await decide(tool({ risk: "confirm" }), {})).kind).toBe("ask");
    expect((await decide(tool({ risk: "safe" }), {})).kind).toBe("allow");
  });

  it("lets a tool's own classifier decide per input", async () => {
    const ps = tool({
      risk: "confirm",
      classify: (input) =>
        (input as { code: string }).code.startsWith("Get-")
          ? { kind: "allow" }
          : { kind: "ask", what: "Run a command", why: "it changes the PC" },
    });
    expect((await decide(ps, { code: "Get-Process" })).kind).toBe("allow");
    expect((await decide(ps, { code: "Remove-Item x" })).kind).toBe("ask");
  });

  it("waits for a classifier that has to look first (what is under a click)", async () => {
    const click = tool({
      classify: async () => ({ kind: "ask", what: "Click Send", why: "it sends" }),
    });
    expect((await decide(click, { coordinate: [1, 1] })).kind).toBe("ask");
    // A classifier with nothing to say leaves the decision to `risk`.
    expect((await decide(tool({ classify: async () => undefined }), {})).kind).toBe("allow");
  });

  it("does not read process names out of tools that do not touch processes", async () => {
    expect((await decide(tool({ name: "type_text" }), { text: "lsass.exe" })).kind).toBe("allow");
  });
});

function fakeModel() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, model: faux.getModel(), stream: models.streamSimple.bind(models) };
}

function sendTool(calls: unknown[]): AssistantTool {
  return tool({
    name: "whatsapp_send",
    description: "Send the typed WhatsApp message",
    risk: "confirm",
    run: async (input) => {
      calls.push(input);
      return { text: "Sent." };
    },
  });
}

/** The tool result text the model was shown, last first. */
const lastToolResult = (context: TranscriptContext) =>
  context.messages
    .filter((m) => m.role === "toolResult")
    .flatMap((m) => m.content.flatMap((c) => (c.type === "text" ? [c.text] : [])))
    .at(-1);

describe("the guard inside a run", () => {
  it("asks before a confirm tool, and a No means the tool never runs", async () => {
    const { faux, model, stream } = fakeModel();
    let shown: string | undefined;
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("whatsapp_send", { to: "Aryan" }), { stopReason: "toolUse" }),
      (context: TranscriptContext) => {
        shown = lastToolResult(context);
        return fauxAssistantMessage("Nahi bheja.");
      },
    ]);
    const calls: unknown[] = [];
    const run = createAssistant({ model, stream, systemPrompt: "t", tools: [sendTool(calls)] }).start(
      "Aryan ko bhej do",
      (e: AssistantEvent) => {
        if (e.kind === "approve") run.reply({ kind: "approval", id: e.id, allowed: false });
      },
    );
    await run.finished;
    expect(calls).toEqual([]);
    expect(shown).toContain("Not done");
  });

  it("does not ask again for what the user already refused in this run", async () => {
    // T11 full bench: after a No on "Place order" Kimi tried it again and the user was asked twice.
    const { faux, model, stream } = fakeModel();
    let shown: string | undefined;
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("whatsapp_send", { to: "Aryan" }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("whatsapp_send", { to: "Aryan", retry: true }), {
        stopReason: "toolUse",
      }),
      (context: TranscriptContext) => {
        shown = lastToolResult(context);
        return fauxAssistantMessage("Nahi bheja.");
      },
    ]);
    const calls: unknown[] = [];
    let approvals = 0;
    const run = createAssistant({ model, stream, systemPrompt: "t", tools: [sendTool(calls)] }).start(
      "Aryan ko bhej do",
      (e: AssistantEvent) => {
        if (e.kind === "approve") {
          approvals++;
          run.reply({ kind: "approval", id: e.id, allowed: false });
        }
      },
    );
    await run.finished;
    expect(approvals).toBe(1);
    expect(calls).toEqual([]);
    expect(shown).toMatch(/already said no/);
  });

  it("runs the tool once after a Yes", async () => {
    const { faux, model, stream } = fakeModel();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("whatsapp_send", { to: "Aryan" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("Bhej diya."),
    ]);
    const calls: unknown[] = [];
    const approvals: string[] = [];
    const run = createAssistant({ model, stream, systemPrompt: "t", tools: [sendTool(calls)] }).start(
      "Aryan ko bhej do",
      (e: AssistantEvent) => {
        if (e.kind === "approve") {
          approvals.push(e.what);
          run.reply({ kind: "approval", id: e.id, allowed: true });
        }
      },
    );
    await run.finished;
    expect(approvals).toHaveLength(1);
    expect(calls).toEqual([{ to: "Aryan" }]);
  });

  it("checks each call in a batch on its own", async () => {
    const { faux, model, stream } = fakeModel();
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("whatsapp_send", { to: "Aryan" }), fauxToolCall("whatsapp_send", { to: "Priya" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Ek bheja."),
    ]);
    const calls: unknown[] = [];
    let n = 0;
    const run = createAssistant({ model, stream, systemPrompt: "t", tools: [sendTool(calls)] }).start(
      "dono ko bhej do",
      (e: AssistantEvent) => {
        if (e.kind === "approve") run.reply({ kind: "approval", id: e.id, allowed: n++ === 0 });
      },
    );
    await run.finished;
    expect(n).toBe(2);
    expect(calls).toEqual([{ to: "Aryan" }]);
  });
});
