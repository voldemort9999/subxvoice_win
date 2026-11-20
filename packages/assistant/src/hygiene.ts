import type { AgentMessage, StreamFn } from "./pi";

/**
 * Message hygiene for any model (plan T14 a–e). In the friend's 5,440-run bench every crash came
 * from one of these, not from reasoning: empty or repeated tool-call ids, Bedrock refusing an empty
 * content block ("validation error … messages..member"), and harmony-format leakage into a tool
 * name (gpt-oss: "read_screen<|channel|>commentary"). A model switch must not bring them back.
 * Ported in idea from that bench's runtime (subxvoice-harness-bench-2026-11-18.zip); written anew
 * for Pi's message shapes.
 */

type Block = { type: string; [key: string]: unknown };
type Loose = { role: string; content?: unknown; toolName?: string; toolCallId?: string };

/** What Anthropic, Bedrock and OpenAI all accept as a tool name. */
const VALID_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
export const INVALID_TOOL_NAME = "invalid_tool_name";

let fresh = 0;

/**
 * Fixes a model reply in place, before Pi runs its tool calls: names cut at harmony leakage, and
 * every id non-empty and unused in this run — Pi keys each result by the call's id, so the results
 * match without further work. `seen` is the run's ids so far; this adds to it.
 */
export function repairReply(message: AgentMessage, seen: Set<string>): void {
  const content = (message as Loose).content;
  if ((message as Loose).role !== "assistant" || !Array.isArray(content)) return;
  for (const block of content as Block[]) {
    if (block.type !== "toolCall") continue;
    const name = String(block.name ?? "");
    const cut = name.indexOf("<|");
    if (cut >= 0) block.name = name.slice(0, cut).trim();
    let id = String(block.id ?? "");
    while (!id || seen.has(id)) id = `call_subx_${++fresh}`;
    block.id = id;
    seen.add(id);
  }
}

/**
 * The model stream with every final reply repaired (repairReply) before Pi reads its tool calls —
 * Pi takes the finished message from `result()` (src/pi/agent-loop.ts), so that is where it is
 * fixed, once. One per run: the ids seen are the run's.
 */
export function hygienicStream(inner: StreamFn): StreamFn {
  const seen = new Set<string>();
  return async (model, context, options) => {
    const response = await inner(model, context, options);
    const original = response.result.bind(response);
    let repaired: ReturnType<typeof original> | undefined;
    response.result = () => {
      repaired ??= original().then((message) => {
        repairReply(message as AgentMessage, seen);
        return message;
      });
      return repaired;
    };
    return response;
  };
}

/**
 * The history as it is sent, cleaned (the stored history is left as it is): no empty text block
 * or empty message, and a tool name no provider accepts renamed in the call and in its result —
 * retrying does not help while the bad name stays in the history (friend's bench, eval/layered.ts).
 */
export function cleanHistory(messages: AgentMessage[]): AgentMessage[] {
  const renamed = new Set<string>();
  return messages.map((message) => {
    const m = message as Loose;
    if (m.role === "toolResult") {
      const content = (m.content as Block[] | undefined) ?? [];
      const toolName = renamed.has(String(m.toolCallId)) ? INVALID_TOOL_NAME : m.toolName;
      const kept = content.filter((b) => b.type !== "text" || String(b.text ?? "").trim());
      if (toolName === m.toolName && kept.length === content.length && kept.length) return message;
      return {
        ...m,
        toolName,
        content: kept.length ? kept : [{ type: "text", text: "(no output)" }],
      } as unknown as AgentMessage;
    }
    if ((m.role !== "assistant" && m.role !== "user") || !Array.isArray(m.content)) return message;
    let changed = false;
    const content = (m.content as Block[]).flatMap((b) => {
      if (b.type === "text" && !String(b.text ?? "").trim()) {
        changed = true;
        return [];
      }
      if (b.type === "toolCall" && !VALID_NAME.test(String(b.name ?? ""))) {
        changed = true;
        renamed.add(String(b.id));
        return [{ ...b, name: INVALID_TOOL_NAME }];
      }
      return [b];
    });
    if (!changed) return message;
    const empty = m.role === "assistant" ? "(no reply)" : "(no message)";
    return {
      ...m,
      content: content.length ? content : [{ type: "text", text: empty }],
    } as unknown as AgentMessage;
  });
}
