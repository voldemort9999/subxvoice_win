import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { AssistantEvent, AssistantRun } from "@subx/core";
import { describe, expect, it } from "vitest";
import { type AssistantConfig, createAssistant } from "./run";
import type { AssistantTool } from "./tool";

function fakeModel() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, model: faux.getModel(), stream: models.streamSimple.bind(models) };
}

/** The tool results the model was shown, in order. */
const toolResults = (context: TranscriptContext) =>
  context.messages
    .filter((m) => m.role === "toolResult")
    .flatMap((m) => m.content.flatMap((c) => (c.type === "text" ? [c.text] : [])));

const askCall = (question: string, choices?: string[]) =>
  fauxAssistantMessage(fauxToolCall("ask_user", choices ? { question, choices } : { question }), {
    stopReason: "toolUse",
  });

function start(
  config: Omit<AssistantConfig, "systemPrompt" | "tools"> & Partial<AssistantConfig>,
  onEvent: (e: AssistantEvent, run: AssistantRun) => void,
) {
  const events: AssistantEvent[] = [];
  const run: AssistantRun = createAssistant({ systemPrompt: "t", tools: [], ...config }).start(
    "kaam karo",
    (e) => {
      events.push(e);
      onEvent(e, run);
    },
  );
  return { run, events };
}

describe("ask_user", () => {
  it("shows the question with its choices and gives the model the user's pick", async () => {
    const { faux, model, stream } = fakeModel();
    let shown: string[] = [];
    faux.setResponses([
      askCall("Kaunsa folder?", ["Spider-Man 2", "Spider-Man Remastered"]),
      (context: TranscriptContext) => {
        shown = toolResults(context);
        return fauxAssistantMessage("Khol diya.");
      },
    ]);
    const { run, events } = start({ model, stream }, (e, r) => {
      if (e.kind === "ask") r.reply({ kind: "choice", id: e.id, value: "Spider-Man Remastered" });
    });
    await run.finished;
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "ask",
        question: "Kaunsa folder?",
        choices: ["Spider-Man 2", "Spider-Man Remastered"],
      }),
    );
    expect(shown.at(-1)).toContain("Spider-Man Remastered");
  });

  it("takes a spoken answer while a question is pending", async () => {
    const { faux, model, stream } = fakeModel();
    let shown: string[] = [];
    faux.setResponses([
      askCall("Kaunsa instance?"),
      (context: TranscriptContext) => {
        shown = toolResults(context);
        return fauxAssistantMessage("Theek hai.");
      },
    ]);
    const { run } = start({ model, stream }, (e, r) => {
      if (e.kind === "ask") r.reply({ kind: "speech", text: "Pie64 wala" });
    });
    await run.finished;
    expect(shown.at(-1)).toContain("Pie64 wala");
  });

  it("refuses a third question in one command without bothering the user", async () => {
    const { faux, model, stream } = fakeModel();
    let shown: string[] = [];
    faux.setResponses([
      askCall("Ek?"),
      askCall("Do?"),
      askCall("Teen?"),
      (context: TranscriptContext) => {
        shown = toolResults(context);
        return fauxAssistantMessage("Khud tay kiya.");
      },
    ]);
    let asks = 0;
    const { run } = start({ model, stream }, (e, r) => {
      if (e.kind === "ask") {
        asks++;
        r.reply({ kind: "choice", id: e.id, value: "haan" });
      }
    });
    await run.finished;
    expect(asks).toBe(2);
    expect(shown.at(-1)).toMatch(/^No questions left/);
    // Spending the budget must never push toward guessing who or which (friend bench, situation 11).
    expect(shown.at(-1)).toMatch(/do not guess/);
    expect(shown.at(-1)).not.toMatch(/decide and finish/);
  });

  it("does not count the guard's approvals against the question budget", async () => {
    const { faux, model, stream } = fakeModel();
    const send: AssistantTool = {
      name: "send",
      description: "Send it",
      parameters: { type: "object", properties: {} },
      risk: "confirm",
      run: async () => ({ text: "Sent." }),
    };
    const sendCall = fauxAssistantMessage(fauxToolCall("send", {}), { stopReason: "toolUse" });
    faux.setResponses([sendCall, sendCall, askCall("Ek?"), askCall("Do?"), fauxAssistantMessage("Ho gaya.")]);
    let asks = 0;
    const { run } = start({ model, stream, tools: [send] }, (e, r) => {
      if (e.kind === "approve") r.reply({ kind: "approval", id: e.id, allowed: true });
      if (e.kind === "ask") {
        asks++;
        r.reply({ kind: "choice", id: e.id, value: "haan" });
      }
    });
    await run.finished;
    expect(asks).toBe(2);
  });

  it("parks the work when a question goes unanswered", async () => {
    const { faux, model, stream } = fakeModel();
    faux.setResponses([askCall("Kaunsa resume?"), fauxAssistantMessage("never reached")]);
    const { run, events } = start({ model, stream, waitForUserMs: 30 }, () => {});
    const result = await run.finished;
    expect(events).toContainEqual(expect.objectContaining({ kind: "parked" }));
    expect(result.ok).toBe(false);
    expect(result.text).toContain("Ruka hua kaam");
    expect(faux.state.callCount).toBe(1);
  });

  it("answers an approval by voice: haan allows, nahi refuses", async () => {
    const { faux, model, stream } = fakeModel();
    const calls: string[] = [];
    const send: AssistantTool = {
      name: "send",
      description: "Send it",
      parameters: { type: "object", properties: {} },
      risk: "confirm",
      run: async () => {
        calls.push("sent");
        return { text: "Sent." };
      },
    };
    const sendCall = fauxAssistantMessage(fauxToolCall("send", {}), { stopReason: "toolUse" });
    faux.setResponses([sendCall, sendCall, fauxAssistantMessage("Ek bheja.")]);
    const spoken = ["haan bhej do", "nahi rehne do"];
    const { run } = start({ model, stream, tools: [send] }, (e, r) => {
      if (e.kind === "approve") r.reply({ kind: "speech", text: spoken.shift() ?? "" });
    });
    await run.finished;
    expect(calls).toEqual(["sent"]);
  });
});

describe("an approval the user does not answer (demo hand test, 2026-11-19)", () => {
  const sender = (calls: string[]): AssistantTool => ({
    name: "send",
    description: "Send it",
    parameters: { type: "object", properties: { to: { type: "string" } } },
    risk: "confirm",
    run: async (input) => {
      calls.push(String((input as { to: string }).to));
      return { text: "Sent." };
    },
  });
  const sendTo = (to: string) =>
    fauxAssistantMessage(fauxToolCall("send", { to }), { stopReason: "toolUse" });
  const userText = (context: TranscriptContext) =>
    context.messages
      .filter((m) => m.role === "user")
      .map((m) =>
        typeof m.content === "string"
          ? m.content
          : m.content.map((c) => (c.type === "text" ? c.text : "")).join(""),
      )
      .join("\n");

  it("a new instruction instead of yes/no reaches the model at once, and the send is asked again later", async () => {
    const { faux, model, stream } = fakeModel();
    const calls: string[] = [];
    let seen = "";
    let result = "";
    faux.setResponses([
      sendTo("RN"),
      (context: TranscriptContext) => {
        seen = userText(context);
        result = toolResults(context).at(-1) ?? "";
        return sendTo("Priya");
      },
      sendTo("RN"),
      fauxAssistantMessage("Dono ho gaye."),
    ]);
    const approvals: string[] = [];
    const { run } = start({ model, stream, tools: [sender(calls)] }, (e, r) => {
      if (e.kind !== "approve") return;
      approvals.push(e.what);
      // First approval: the user speaks a new task instead of answering; then says yes to both.
      if (approvals.length === 1) r.reply({ kind: "speech", text: "Priya ko Hi message karo" });
      else r.reply({ kind: "approval", id: e.id, allowed: true });
    });
    await run.finished;
    expect(seen).toContain("Priya ko Hi message karo");
    expect(result).toMatch(/new instruction/i);
    // Not taken as a No: RN's message is asked about again, and sent on the yes.
    expect(approvals).toHaveLength(3);
    expect(calls).toEqual(["Priya", "RN"]);
  });

  it("goes on without the action after the wait instead of hanging on the question", async () => {
    const { faux, model, stream } = fakeModel();
    const calls: string[] = [];
    let result = "";
    faux.setResponses([
      sendTo("RN"),
      (context: TranscriptContext) => {
        result = toolResults(context).at(-1) ?? "";
        return fauxAssistantMessage("Message likh diya, bheja nahi.");
      },
    ]);
    const { run, events } = start({ model, stream, tools: [sender(calls)], waitForUserMs: 30 }, () => {});
    const done = await run.finished;
    expect(calls).toEqual([]);
    expect(result).toMatch(/no answer/i);
    expect(events).not.toContainEqual(expect.objectContaining({ kind: "parked" }));
    expect(done.ok).toBe(true);
  });

  it("waits a minute, not five", async () => {
    const { WAIT_FOR_USER_MS } = await import("./ask");
    expect(WAIT_FOR_USER_MS).toBe(60_000);
  });
});

describe("a Roman-script user (demo hand test: 'Hi' typed as हाय, 'Priya' as पriya)", () => {
  const typer = (typed: string[]): AssistantTool => ({
    name: "whatsapp_message",
    description: "Write a message",
    parameters: { type: "object", properties: { to: { type: "string" }, message: { type: "string" } } },
    risk: "safe",
    run: async (input) => {
      const { to, message } = input as { to: string; message: string };
      typed.push(`${to}: ${message}`);
      return { text: "Typed." };
    },
  });
  const write = (to: string, message: string) =>
    fauxAssistantMessage(fauxToolCall("whatsapp_message", { to, message }), { stopReason: "toolUse" });

  it("never lets Devanagari reach a tool: the model is told to write it in Roman and does", async () => {
    const { faux, model, stream } = fakeModel();
    const typed: string[] = [];
    let result = "";
    faux.setResponses([
      write("पriya", "हाय"),
      (context: TranscriptContext) => {
        result = toolResults(context).at(-1) ?? "";
        return write("Priya", "Hi");
      },
      fauxAssistantMessage("Likh diya."),
    ]);
    const { run } = start({ model, stream, tools: [typer(typed)], romanOnly: true }, () => {});
    await run.finished;
    expect(typed).toEqual(["Priya: Hi"]);
    expect(result).toMatch(/Roman/);
  });

  it("leaves Devanagari alone for a user who writes in Devanagari", async () => {
    const { faux, model, stream } = fakeModel();
    const typed: string[] = [];
    faux.setResponses([write("प्रिया", "नमस्ते"), fauxAssistantMessage("Likh diya.")]);
    const { run } = start({ model, stream, tools: [typer(typed)] }, () => {});
    await run.finished;
    expect(typed).toEqual(["प्रिया: नमस्ते"]);
  });
});

describe("notify_user", () => {
  it("tells the user without waiting for anything", async () => {
    const { faux, model, stream } = fakeModel();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("notify_user", { text: "1 minute mouse mat chhuna" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Ho gaya."),
    ]);
    const { run, events } = start({ model, stream }, () => {});
    await run.finished;
    expect(events).toContainEqual({ kind: "inform", text: "1 minute mouse mat chhuna" });
  });
});
