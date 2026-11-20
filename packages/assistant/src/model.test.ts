import { describe, expect, it } from "vitest";
import { parseModelSpec, pointScale, resolveModel } from "./model";

describe("parseModelSpec", () => {
  it("reads a Bedrock spec", () => {
    expect(parseModelSpec("bedrock:us.moonshotai.kimi-k3.1")).toEqual({
      provider: "bedrock",
      id: "us.moonshotai.kimi-k3.1",
    });
  });

  it("reads an OpenRouter spec whose id has a slash", () => {
    expect(parseModelSpec("openrouter:anthropic/claude-haiku-5.5")).toEqual({
      provider: "openrouter",
      id: "anthropic/claude-haiku-5.5",
    });
  });

  it("refuses anything without a known provider", () => {
    expect(() => parseModelSpec("kimi")).toThrow("Unknown model spec: kimi");
    expect(() => parseModelSpec("groq:openai/gpt-oss-120b")).toThrow("Unknown model spec");
  });
});

describe("resolveModel", () => {
  it("finds Kimi K3.1 in the Bedrock catalogue", () => {
    const { model } = resolveModel("bedrock:us.moonshotai.kimi-k3.1");
    expect(model.provider).toBe("amazon-bedrock");
    expect(model.id).toBe("us.moonshotai.kimi-k3.1");
  });

  it("finds Celeris models, each on its own base URL, with images", () => {
    const one = resolveModel("celeris:celeris-1").model;
    expect(one.provider).toBe("celeris");
    expect(one.api).toBe("openai-completions");
    expect(one.baseUrl).toBe("https://inference.celeris.ai/celeris-1/v1");
    expect(one.input).toContain("image");
    // docs.celeris.ai/pricing, $ per million tokens — the $0.25 per-command cap reads these.
    expect(one.cost).toEqual({ input: 0.2, output: 0.7, cacheRead: 0.02, cacheWrite: 0 });
    expect(resolveModel("celeris:celeris-1-magnus").model.baseUrl).toBe(
      "https://inference.celeris.ai/celeris-1-magnus/v1",
    );
  });

  it("calls Celeris's chat path with the key as Bearer — no request leaves the test", async () => {
    let url = "";
    let auth: string | null = null;
    let body: { model?: string; mm_processor_kwargs?: unknown } = {};
    const capture = async (input: unknown, init?: RequestInit) => {
      url = String(input instanceof Request ? input.url : input);
      auth = new Headers(init?.headers).get("authorization");
      body = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({ error: { message: "captured" } }), { status: 400 });
    };
    const { model, stream } = resolveModel("celeris:celeris-1");
    const s = await stream(
      model,
      { messages: [{ role: "user", content: "hi", timestamp: 0 }] },
      { apiKey: "ck_test", fetch: capture as typeof fetch },
    );
    await s.result();
    expect(url).toBe("https://inference.celeris.ai/celeris-1/v1/chat/completions");
    expect(auth).toBe("Bearer ck_test");
    expect(body.model).toBe("celeris-1");
    // docs.celeris.ai/images: celeris-1 reads every image at max_soft_tokens, default 280 — too
    // coarse for a screenshot's small text and for where to click (S-024: clicks missed).
    expect(body.mm_processor_kwargs).toEqual({ max_soft_tokens: 1120 });
  });

  it("knows which models point on a 0–1000 grid instead of the screenshot's pixels (S-024 calibration)", () => {
    expect(pointScale("celeris:celeris-1")).toBe(1000);
    expect(pointScale("celeris:celeris-1-magnus")).toBe(1000);
    expect(pointScale("bedrock:us.moonshotai.kimi-k3.1")).toBeUndefined();
    expect(pointScale("openrouter:anthropic/claude-haiku-5.5")).toBeUndefined();
  });

  it("caps the output budget below what the provider accepts", () => {
    // Pi's catalogue asks Qwen3-235B for 131,072 output tokens; Bedrock refuses anything over 65,536.
    expect(resolveModel("bedrock:qwen.qwen3-235b-a22b-2507-v1:0").model.maxTokens).toBe(8000);
    expect(resolveModel("bedrock:us.moonshotai.kimi-k3.1").model.maxTokens).toBe(8000);
  });

  it("sends the session to the proxy as Authorization: Bearer, never as x-api-key (S-019 401)", async () => {
    let sent: Headers | undefined;
    const capture = async (_url: unknown, init?: RequestInit) => {
      sent = new Headers(init?.headers);
      return new Response(JSON.stringify({ error: { type: "stop", message: "captured" } }), { status: 400 });
    };
    const { model, stream } = resolveModel("openrouter:anthropic/claude-haiku-5.5", {
      messagesBase: "https://proxy.example/functions/v1/llm",
      token: () => "session-token",
    });
    const s = await stream(
      model,
      { messages: [{ role: "user", content: "hi", timestamp: 0 }] },
      { apiKey: "would-be-x-api-key", fetch: capture as typeof fetch },
    );
    await s.result();
    expect(sent?.get("authorization")).toBe("Bearer session-token");
    // pi-ai needs some key to start a request; the proxy neither reads nor forwards x-api-key, so
    // only a fixed placeholder goes there — never the session, never a real key.
    expect(sent?.get("x-api-key")).toBe("subx-proxy");
  });

  it("sends Claude through the proxy as Anthropic Messages", () => {
    const { model } = resolveModel("openrouter:anthropic/claude-haiku-5.5", {
      messagesBase: "https://proxy.example/functions/v1/llm",
    });
    expect(model.api).toBe("anthropic-messages");
    expect(model.baseUrl).toBe("https://proxy.example/functions/v1/llm");
  });

  it("sends other OpenRouter models through the proxy's chat path", () => {
    const { model } = resolveModel("openrouter:openai/gpt-oss-120b", {
      chatUrl: "https://proxy.example/functions/v1/llm",
    });
    expect(model.api).toBe("openai-completions");
    expect(model.baseUrl).toBe("https://proxy.example/functions/v1/llm");
  });

  it("says which model is missing from the catalogue", () => {
    expect(() => resolveModel("bedrock:no.such-model")).toThrow(
      "Model not in catalogue: bedrock:no.such-model",
    );
  });
});
