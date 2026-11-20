import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { createAssistant } from "./run";

function fake(responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0]) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(responses);
  return { faux, model: faux.getModel(), stream: models.streamSimple.bind(models) };
}

const failed = (errorMessage: string) => fauxAssistantMessage("", { stopReason: "error", errorMessage });
const TRANSIENT = "An unexpected error occurred during processing. Try your request again.";

const start = (primary: ReturnType<typeof fake>, fallback?: ReturnType<typeof fake>) =>
  createAssistant({
    model: primary.model,
    stream: primary.stream,
    systemPrompt: "t",
    tools: [],
    retryDelayMs: 1,
    ...(fallback ? { fallback: { model: fallback.model, stream: fallback.stream } } : {}),
  }).start("hello", () => {}).finished;

describe("provider errors (plan T14 h, fallback model)", () => {
  it("retries Bedrock's transient error, up to three tries in all", async () => {
    const p = fake([failed(TRANSIENT), failed(TRANSIENT), fauxAssistantMessage("Namaste.")]);
    expect(await start(p)).toEqual({ ok: true, text: "Namaste." });
    expect(p.faux.state.callCount).toBe(3);
  });

  it("continues the same run on the fallback when the error survives its retries", async () => {
    const p = fake([failed(TRANSIENT), failed(TRANSIENT), failed(TRANSIENT), fauxAssistantMessage("never")]);
    const f = fake([fauxAssistantMessage("Namaste from the fallback.")]);
    expect(await start(p, f)).toEqual({ ok: true, text: "Namaste from the fallback." });
    expect(p.faux.state.callCount).toBe(3);
  });

  it("gives any other error one retry before the fallback", async () => {
    const p = fake([failed("401 bad key"), failed("401 bad key"), fauxAssistantMessage("never")]);
    const f = fake([fauxAssistantMessage("ok")]);
    expect((await start(p, f)).text).toBe("ok");
    expect(p.faux.state.callCount).toBe(2);
  });

  it("without a fallback, ends as today: the model could not be reached", async () => {
    const p = fake([failed("401 bad key"), failed("401 bad key")]);
    const result = await start(p);
    expect(result.ok).toBe(false);
    expect(result.text).toContain("401 bad key");
  });
});
