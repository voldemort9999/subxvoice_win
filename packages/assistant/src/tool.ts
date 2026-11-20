import type { GuardDecision } from "@subx/core";
import type { AgentTool } from "./pi";

/** What a tool hands back to the model: one line of text, and a screenshot when it took one. */
export interface ToolOutput {
  text: string;
  image?: { data: string; mimeType: "image/png" | "image/jpeg" };
}

/**
 * Everything the assistant can do is one of these, whether it is a Windows action, the UIA tree,
 * the screen, or asking the user. `risk` follows AGENTS.md rule 6 — "confirm" means the guard asks
 * the user first; `classify` decides per input where the tool alone cannot (a PowerShell command,
 * a click on whatever is under the pointer).
 */
export interface AssistantTool {
  name: string;
  description: string;
  /** JSON Schema of the input. */
  parameters: Record<string, unknown>;
  risk: "safe" | "confirm";
  /** Only looks or talks (screenshot, reading the tree, asking): no state appended, no self-check. */
  readOnly?: boolean;
  /**
   * Moves the mouse or presses keys (design §5): held while the user is using their own, and
   * while a dictation is landing. Tree and domain actions leave it unset and run on.
   */
  usesInput?: boolean | ((input: unknown) => boolean);
  /** Set on tools that stop processes or write the registry, so the never-catalogue applies. */
  touches?: "process" | "registry";
  /** May look first (the element under a click, the focused box); undefined = no opinion. */
  classify?(input: unknown): GuardDecision | undefined | Promise<GuardDecision | undefined>;
  run(input: unknown, signal: AbortSignal): Promise<ToolOutput>;
}

/** The same tool in the shape Pi's loop runs. */
export function toAgentTool(tool: AssistantTool): AgentTool {
  return {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (_id, params, signal) => {
      const out = await tool.run(params, signal ?? new AbortController().signal);
      const content: Awaited<ReturnType<AgentTool["execute"]>>["content"] = [
        { type: "text", text: out.text },
      ];
      if (out.image) content.push({ type: "image", data: out.image.data, mimeType: out.image.mimeType });
      return { content, details: undefined };
    },
  };
}
