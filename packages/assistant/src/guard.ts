import type { GuardDecision } from "@subx/core";
import { say } from "./lang";
import { neverProcess, neverRegistry } from "./risk-catalogue";
import type { AssistantTool } from "./tool";

/** Every string anywhere in a tool's input — names and paths can sit in any field. */
export function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/**
 * The code guard (design §3): safety lives here, not in the prompt, because a model told "never
 * press Send" pressed it anyway in the S-019 bench. Order: the never-catalogue (for tools that act
 * on processes or the registry) → the tool's own per-input classifier → `risk: "confirm"` asks →
 * everything else runs.
 */
export async function decide(tool: AssistantTool, input: unknown): Promise<GuardDecision> {
  if (tool.touches) {
    const check = tool.touches === "process" ? neverProcess : neverRegistry;
    for (const value of strings(input)) {
      const why = check(value);
      if (why) return { kind: "never", why: `Ye kabhi nahi karunga: ${why}.` };
    }
  }
  const own = await tool.classify?.(input);
  if (own) return own;
  if (tool.risk === "confirm") return { kind: "ask", what: tool.description, why: say().risky };
  return { kind: "allow" };
}
