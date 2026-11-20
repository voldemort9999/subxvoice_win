import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { AssistantEvent, AssistantRun } from "@subx/core";
import { describe, expect, it } from "vitest";
import { spokenApproval } from "./ask";
import { createAssistant, stopChoice } from "./run";
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

/** A tool that waits until the test lets it finish, so things can be said while it runs. */
function gatedTool(name: string, ran: string[]) {
  let open!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((r) => {
    markStarted = r;
  });
  const gate = new Promise<void>((r) => {
    open = r;
  });
  const tool: AssistantTool = {
    name,
    description: name,
    parameters: { type: "object", properties: {} },
    risk: "safe",
    run: async () => {
      ran.push(name);
      markStarted();
      await gate;
      return { text: `${name} done` };
    },
  };
  return { tool, started, finish: () => open() };
}

const call = (name: string) => fauxAssistantMessage(fauxToolCall(name, {}), { stopReason: "toolUse" });

function begin(
  tools: AssistantTool[],
  faux: ReturnType<typeof fakeModel>,
  onEvent: (e: AssistantEvent) => void = () => {},
) {
  const events: AssistantEvent[] = [];
  const run: AssistantRun = createAssistant({
    model: faux.model,
    stream: faux.stream,
    systemPrompt: "t",
    tools,
  }).start("kaam karo", (e) => {
    events.push(e);
    onEvent(e);
  });
  return { run, events };
}

describe("talking to the assistant while it works", () => {
  it("passes something said mid-run to the model's next turn", async () => {
    const m = fakeModel();
    const ran: string[] = [];
    const a = gatedTool("first", ran);
    let seen: string[] = [];
    m.faux.setResponses([
      call("first"),
      (context: TranscriptContext) => {
        seen = texts(context);
        return fauxAssistantMessage("Abhi aadha hua hai.");
      },
    ]);
    const { run } = begin([a.tool], m);
    await a.started;
    run.reply({ kind: "speech", text: "kahan tak pahuncha?" });
    a.finish();
    await run.finished;
    expect(seen).toContain(
      "[User said while you were working — this overrides anything earlier it contradicts] kahan tak pahuncha?",
    );
  });

  it("holds the next step from the moment the command key goes down, and lets the user's words decide (S-024)", async () => {
    // The user pressed the key to say "ruko / ab ye karo" and the run kept clicking for seconds
    // while their speech was still being transcribed.
    const m = fakeModel();
    const ran: string[] = [];
    const a = gatedTool("first", ran);
    const b = gatedTool("second", ran);
    let seen: string[] = [];
    m.faux.setResponses([
      call("first"),
      call("second"),
      (context: TranscriptContext) => {
        seen = texts(context);
        return fauxAssistantMessage("Theek hai, WhatsApp pe message karta hoon.");
      },
      fauxAssistantMessage("Theek hai."),
    ]);
    const { run } = begin([a.tool, b.tool], m);
    await a.started;
    run.hold();
    a.finish();
    await new Promise((r) => setTimeout(r, 30));
    expect(ran).toEqual(["first"]); // "second" was chosen, but waits for the user
    run.reply({ kind: "speech", text: "chhodo ye, Dragon ko message karo" });
    b.finish();
    await run.finished;
    expect(ran).toEqual(["first"]); // the step chosen before they spoke never ran
    expect(seen.join("\n")).toContain("chhodo ye, Dragon ko message karo");
  });

  it("a hold with no words after it lets the work carry on", async () => {
    const m = fakeModel();
    const ran: string[] = [];
    const a = gatedTool("first", ran);
    m.faux.setResponses([call("first"), fauxAssistantMessage("Ho gaya."), fauxAssistantMessage("Ho gaya.")]);
    const run = createAssistant({
      model: m.model,
      stream: m.stream,
      systemPrompt: "t",
      tools: [a.tool],
      holdMs: 20,
    }).start("kaam karo", () => {});
    run.hold();
    a.finish();
    await run.finished;
    expect(ran).toEqual(["first"]);
  });

  it("stop pauses and asks; Continue carries on to the next action", async () => {
    const m = fakeModel();
    const ran: string[] = [];
    const a = gatedTool("first", ran);
    const b = gatedTool("second", ran);
    m.faux.setResponses([
      call("first"),
      call("second"),
      fauxAssistantMessage("Dono ho gaye."),
      fauxAssistantMessage("Check kiya, dono ho gaye."),
    ]);
    const { run, events } = begin([a.tool, b.tool], m, (e) => {
      if (e.kind === "ask" && e.choices?.includes("Continue"))
        run.reply({ kind: "choice", id: e.id, value: "Continue" });
    });
    await a.started;
    run.stop();
    a.finish();
    await b.started;
    b.finish();
    const result = await run.finished;
    expect(events).toContainEqual({ kind: "paused", reason: "stop-request" });
    expect(ran).toEqual(["first", "second"]);
    expect(result.ok).toBe(true);
  });

  it("stop then Band kar do: nothing more runs, and it says what was done", async () => {
    const m = fakeModel();
    const ran: string[] = [];
    const a = gatedTool("first", ran);
    const b = gatedTool("second", ran);
    m.faux.setResponses([call("first"), call("second"), fauxAssistantMessage("never")]);
    const { run } = begin([a.tool, b.tool], m, (e) => {
      if (e.kind === "ask" && e.choices?.includes("Band kar do"))
        run.reply({ kind: "choice", id: e.id, value: "Band kar do" });
    });
    await a.started;
    run.stop();
    a.finish();
    const result = await run.finished;
    expect(ran).toEqual(["first"]);
    expect(result.ok).toBe(false);
    expect(result.text).toContain("Band kar diya");
    expect(result.text).toContain("first");
  });

  it("hears 'ruk jao' as stop even while a question is pending, not as the answer", async () => {
    const m = fakeModel();
    let shown: string[] = [];
    m.faux.setResponses([
      fauxAssistantMessage(fauxToolCall("ask_user", { question: "Kaunsa instance?" }), {
        stopReason: "toolUse",
      }),
      (context: TranscriptContext) => {
        shown = texts(context);
        return fauxAssistantMessage("Theek hai.");
      },
    ]);
    const asks: string[] = [];
    const { run, events } = begin([], m, (e) => {
      if (e.kind !== "ask") return;
      asks.push(e.question);
      if (e.question === "Kaunsa instance?")
        queueMicrotask(() => run.reply({ kind: "speech", text: "ruk jao" }));
      else
        queueMicrotask(() => {
          run.reply({ kind: "speech", text: "continue" });
          run.reply({ kind: "speech", text: "Pie64" });
        });
    });
    await run.finished;
    expect(events).toContainEqual({ kind: "paused", reason: "stop-request" });
    expect(shown.some((t) => t.includes("ruk jao"))).toBe(false);
    expect(shown.some((t) => t.includes("Pie64"))).toBe(true);
  });

  const sendTool = (ran: string[]): AssistantTool => ({
    name: "send_message",
    description: "send",
    parameters: { type: "object", properties: {} },
    risk: "confirm",
    run: async () => {
      ran.push("send_message");
      return { text: "sent" };
    },
  });

  it("'ruk jao' then 'band kar do' while an approval waits: ends at once as stopped (review I6)", async () => {
    const m = fakeModel();
    const ran: string[] = [];
    m.faux.setResponses([call("send_message"), fauxAssistantMessage("never")]);
    const { run } = begin([sendTool(ran)], m, (e) => {
      if (e.kind === "approve") queueMicrotask(() => run.reply({ kind: "speech", text: "ruk jao" }));
      if (e.kind === "ask" && e.choices?.includes("Band kar do"))
        queueMicrotask(() => run.reply({ kind: "choice", id: e.id, value: "Band kar do" }));
    });
    const result = await run.finished;
    expect(ran).toEqual([]);
    expect(result.text).toContain("Band kar diya");
  });

  it("an Allow clicked while the stop question is open does not run once the user stops (review I6)", async () => {
    const m = fakeModel();
    const ran: string[] = [];
    m.faux.setResponses([call("send_message"), fauxAssistantMessage("never")]);
    let approvalId = "";
    const { run } = begin([sendTool(ran)], m, (e) => {
      if (e.kind === "approve") {
        approvalId = e.id;
        queueMicrotask(() => run.reply({ kind: "speech", text: "ruk jao" }));
      }
      if (e.kind === "ask" && e.choices?.includes("Band kar do"))
        queueMicrotask(() => {
          run.reply({ kind: "approval", id: approvalId, allowed: true });
          queueMicrotask(() => run.reply({ kind: "choice", id: e.id, value: "Band kar do" }));
        });
    });
    const result = await run.finished;
    expect(ran).toEqual([]);
    expect(result.text).toContain("Band kar diya");
  });
});

describe("the answer to 'band kar doon, ya continue?'", () => {
  it("hears stop words again as stop, not as a new instruction (review I7)", () => {
    expect(stopChoice("ruk jao")).toBe("stop");
    expect(stopChoice("haan band kar do")).toBe("stop");
    // Hinglish "na" softens a request; "nahi," before an order is not a no to the order.
    expect(stopChoice("band kar do na")).toBe("stop");
    expect(stopChoice("nahi, band kar do")).toBe("stop");
  });

  it("hears the same words in Devanagari, as speech recognition writes them (S-024: 'रुक जाओ' did not stop)", () => {
    expect(stopChoice("रुक जाओ।")).toBe("stop");
    expect(stopChoice("जाओ, कुछ मत करो।")).toBe("stop");
    expect(stopChoice("बंद मत करो")).toBe("continue");
    expect(stopChoice("हाँ, continue करो")).toBe("continue");
    expect(spokenApproval("हाँ भेज दो")).toBe(true);
    expect(spokenApproval("नहीं, मत भेजो")).toBe(false);
  });

  it("hears a negated stop as continue (review minor)", () => {
    expect(stopChoice("band mat karo")).toBe("continue");
    expect(stopChoice("nahi nahi, rukna mat, karte raho")).toBe("continue");
  });

  it("takes anything else as what to do instead", () => {
    expect(stopChoice("Mummy ko bhi likho")).toBe("redirect");
  });

  // Demo hand test, 2026-11-19 17:18: this, said while "Enter dabana" waited, pressed Enter in
  // WhatsApp's search box — the "ओके" at its start was heard as a yes — and the email was lost.
  it("never hears a yes or no in a whole new instruction that happens to contain one", () => {
    expect(
      spokenApproval("ओके, तो बेसिकली एक काम करो, अभी तुम, उम्, एक ईमेल का। यूज़ करो जिसमें बैच मैनेजर को"),
    ).toBeUndefined();
    expect(spokenApproval("no wait, write an email to my batch manager instead")).toBeUndefined();
    expect(spokenApproval("ok")).toBe(true);
    expect(spokenApproval("haan haan bhej do yaar")).toBe(true);
    expect(spokenApproval("theek hai, mat bhejo")).toBe(false);
  });
});
