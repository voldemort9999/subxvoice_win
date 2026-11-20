/**
 * Which model runs the assistant, as one `provider:model` string (packages/assistant/src/model.ts),
 * so switching is a one-line change and the harness behaves the same whichever runs.
 *
 * Installed app: Claude Haiku 5.5 through the backend proxy, Sonnet 5.5 when Haiku fails or is
 * stuck (plan T14 fallback). Development: Celeris (celeris-1) with Kimi K3.1 on Bedrock as fallback;
 * run (context/WORKING.md), overridable from .env. .env is never read for the installed app.
 */
export interface AssistantModels {
  model: string;
  fallback: string;
}

const KIMI = "bedrock:us.moonshotai.kimi-k3.1";

/**
 * The user's script setting as a note in the assistant's memory section: dictation honours it, and
 * the assistant typed "मैं एक अच्छा इंसान हूँ" into Notepad for a Roman-script user (S-024).
 */
export function scriptNote(script: "native" | "roman"): string {
  return script === "roman"
    ? "- Writes in Roman (Latin) letters: anything typed or messaged for them goes in Roman letters, transliterated from Devanagari (मैं → main), never translate it."
    : "";
}

/**
 * The classic Follow My Words pipeline's two models, also as `provider:model`: the decider picks
 * an action or an on-screen element, the writer fills in its details. Development with a Celeris
 * key runs both on Celeris (user, S-023: faster, and the decider can look at images); the
 * installed app holds no key, so it keeps Jev + Gemini through the backend until that carries
 * Celeris. Either can be switched from .env.
 */
export interface ClassicModels {
  decider: string;
  writer: string;
}

export function classicModels(packaged: boolean, env: Record<string, string | undefined>): ClassicModels {
  const backend = { decider: "jev:typesafe/jev-1.14", writer: "openrouter:google/gemini-2.5-flash" };
  if (packaged) return backend;
  const set = (name: string) => env[name]?.trim() || undefined;
  const base = set("CELERIS_API_KEY")
    ? { decider: "celeris:celeris-1.1-decision", writer: "celeris:celeris-1" }
    : backend;
  return { decider: set("DECIDER_MODEL") ?? base.decider, writer: set("COMMAND_MODEL") ?? base.writer };
}

export function assistantModels(packaged: boolean, env: Record<string, string | undefined>): AssistantModels {
  if (packaged)
    return {
      model: "openrouter:anthropic/claude-haiku-5.5",
      fallback: "openrouter:anthropic/claude-sonnet-5.5",
    };
  // Blank means unset, as everywhere in .env.example.
  const set = (name: string) => env[name]?.trim() || undefined;
  // Celeris for speed (user, S-023); Kimi on Bedrock catches what Celeris cannot.
  return {
    model: set("ASSISTANT_MODEL") ?? "celeris:celeris-1",
    fallback: set("ASSISTANT_FALLBACK_MODEL") ?? KIMI,
  };
}
