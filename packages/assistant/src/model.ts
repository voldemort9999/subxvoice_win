import { type Api, createModels, createProvider, envApiKeyAuth, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { registerLazyBedrockProvider } from "@earendil-works/pi-ai/lazy-bedrock-provider";
import { amazonBedrockProvider } from "@earendil-works/pi-ai/providers/amazon-bedrock";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

// pi-ai loads its Bedrock code through a variable path that bundlers cannot follow; inside the
// app's bundle that path does not exist ("Cannot find module …\out\main\bedrock-converse-stream.js",
// first dev-app run, T15). This literal import() lets electron-vite keep it as a lazy chunk.
registerLazyBedrockProvider();

/**
 * Which model runs the assistant is one string, `provider:model`, so switching between Kimi (used
 * for every development run, on the user's Bedrock credits) and Haiku (production, via OpenRouter)
 * is a one-line change. The harness must behave the same whichever runs — see
 * docs/superpowers/specs/2026-11-18-assistant-harness-design.md §1.
 */
export type ModelProvider = "bedrock" | "openrouter" | "celeris";
const PROVIDERS: readonly string[] = ["bedrock", "openrouter", "celeris"];

export function parseModelSpec(spec: string): { provider: ModelProvider; id: string } {
  const colon = spec.indexOf(":");
  const provider = spec.slice(0, colon);
  const id = spec.slice(colon + 1);
  if (colon < 1 || !id || !PROVIDERS.includes(provider)) {
    throw new Error(`Unknown model spec: ${spec}`);
  }
  return { provider: provider as ModelProvider, id };
}

/**
 * Celeris (docs.celeris.ai, read 2026-11-18): OpenAI chat-completions shape, tools and image input
 * on both chat models, 131,072 tokens shared by prompt and output; each model has its own base URL.
 * Chosen by the user for speed (S-023). Key: CELERIS_API_KEY. Prices from docs.celeris.ai/pricing
 * (both chat models alike), so the per-command spend cap holds on Celeris too.
 */
const celerisModel = (id: string, name: string, maxTokens: number): Model<"openai-completions"> => ({
  id,
  name,
  api: "openai-completions",
  provider: "celeris",
  baseUrl: `https://inference.celeris.ai/${id}/v1`,
  reasoning: false,
  input: ["text", "image"],
  cost: { input: 0.2, output: 0.7, cacheRead: 0.02, cacheWrite: 0 },
  contextWindow: 131_072,
  maxTokens,
});

function celerisProvider() {
  return createProvider({
    id: "celeris",
    name: "Celeris",
    baseUrl: "https://inference.celeris.ai/celeris-1/v1",
    auth: { apiKey: envApiKeyAuth("Celeris API key", ["CELERIS_API_KEY"]) },
    models: [
      celerisModel("celeris-1", "Celeris 1", 131_072),
      celerisModel("celeris-1-magnus", "Celeris 1 Magnus", 16_384),
    ],
    api: openAICompletionsApi(),
  });
}

/**
 * The grid a model points on when it is not the screenshot's pixels: celeris-1 answers clicks on
 * 0–1000 (three calibration dots, S-024 — see `onScale` in tools/screen.ts). Claude and Kimi point
 * in pixels (Anthropic's toolset; Kimi passed the pixel vision bench), so they need nothing.
 */
export function pointScale(spec: string): number | undefined {
  return parseModelSpec(spec).provider === "celeris" ? 1000 : undefined;
}

/** Where the app's backend proxy forwards model calls. Absent in tests and direct runs. */
export interface ModelRoute {
  /** Base for Anthropic Messages calls; the SDK appends `/v1/messages`. */
  messagesBase?: string;
  /** Full URL of the OpenAI-style chat path, for non-Claude OpenRouter models. */
  chatUrl?: string;
  /** The signed-in session, read per request (it expires while the app is open). */
  token?: () => string;
}

export interface ResolvedModel {
  model: Model<Api>;
  /** Pass as the agent's `streamFn`: it dispatches on `model.api`. */
  stream: ReturnType<typeof createModels>["streamSimple"];
}

/**
 * Output budget per reply. Pi sends the catalogue's maxTokens with every request, and the catalogue
 * can exceed what the provider takes (Qwen3-235B: 131,072 asked, Bedrock refuses above 65,536 — the
 * friend's bench lost every Qwen run to it). A tool call or a short spoken reply plus "low" thinking
 * fits well inside 8,000. docs/superpowers/plans/2026-11-18-assistant-harness.md T14 (g).
 */
const MAX_OUTPUT_TOKENS = 8000;

export function resolveModel(spec: string, route: ModelRoute = {}): ResolvedModel {
  const { model, stream } = resolveUncapped(spec, route);
  return { model: { ...model, maxTokens: Math.min(model.maxTokens, MAX_OUTPUT_TOKENS) }, stream };
}

function resolveUncapped(spec: string, route: ModelRoute): ResolvedModel {
  const { provider, id } = parseModelSpec(spec);
  const models = createModels();
  const stream = models.streamSimple.bind(models);

  if (provider === "bedrock") {
    models.setProvider(amazonBedrockProvider());
    const model = models.getModel("amazon-bedrock", id);
    if (!model) throw new Error(`Model not in catalogue: ${spec}`);
    return { model, stream };
  }

  if (provider === "celeris") {
    models.setProvider(celerisProvider());
    const model = models.getModel("celeris", id);
    if (!model) throw new Error(`Model not in catalogue: ${spec}`);
    // celeris-1 reads every image at max_soft_tokens, 280 unless asked (docs.celeris.ai/images):
    // too coarse for a screenshot's small text and for where to click — clicks missed in the
    // user's S-024 hand test. 1120 is the top value; magnus ignores it.
    const sharp: ResolvedModel["stream"] = (m, context, options) =>
      stream(m, context, {
        ...options,
        onPayload: async (payload, at) => {
          const own = (await options?.onPayload?.(payload, at)) ?? payload;
          return { ...(own as object), mm_processor_kwargs: { max_soft_tokens: 1120 } };
        },
      });
    return { model, stream: sharp };
  }

  models.setProvider(openrouterProvider());
  const found = models.getModel("openrouter", id);
  if (!found) throw new Error(`Model not in catalogue: ${spec}`);
  // Claude goes through the proxy in Anthropic's own format so its tool and image handling stay
  // native; everything else uses the chat path the proxy already forwards.
  if (id.startsWith("anthropic/") && route.messagesBase) {
    const { token } = route;
    // The proxy's JWT check reads Authorization: Bearer <session>; the Anthropic client would put
    // a key in x-api-key, which the S-019 attempt answered with 401 "Missing authorization header".
    // pi-ai refuses to start without some key, and the SDK sends it as x-api-key — so a fixed,
    // non-secret placeholder goes there; the proxy neither reads nor forwards it.
    const viaProxy: ResolvedModel["stream"] = (model, context, options) =>
      stream(model, context, {
        ...options,
        apiKey: "subx-proxy",
        headers: { ...options?.headers, ...(token ? { authorization: `Bearer ${token()}` } : {}) },
      });
    return { model: { ...found, api: "anthropic-messages", baseUrl: route.messagesBase }, stream: viaProxy };
  }
  if (route.chatUrl)
    return { model: { ...found, api: "openai-completions", baseUrl: route.chatUrl }, stream };
  return { model: found, stream };
}
