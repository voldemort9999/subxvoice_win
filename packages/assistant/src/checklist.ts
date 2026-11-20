import type { AssistantTool } from "./tool";

type Status = "pending" | "done" | "impossible";
interface Item {
  task: string;
  status: Status;
  note?: string;
}

/**
 * Claude Code's todo list cut down for a voice request, taken from the friend's bench
 * (subxvoice-harness-bench-2026-11-18.zip, src/plugins/checklist.ts): every part is written down
 * before acting and ticked off only after a tool shows it done, and the run cannot end while one
 * is pending. Off by default — S-019 measured it as cost without gain on strong models; it stays
 * only if the mid-model A/B (plan T19b) shows it lifting multi-part tasks.
 */
export const CHECKLIST_INSTRUCTIONS =
  "When the request has more than one part (several actions, or several people), call update_checklist before your first action with every separate thing asked for (one item each, in the user's words); a single simple action needs no checklist. Mark an item done only after a tool result shows it is done. If something cannot be done (a contact, app or file does not exist), mark it impossible with the reason instead of doing something else. When the user changes the request, update the checklist first.";

export function createChecklist(): { tool: AssistantTool; pending(): string | undefined } {
  let items: Item[] = [];
  return {
    tool: {
      name: "update_checklist",
      description: "Write or rewrite the full checklist for this request. Always send every item.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                task: { type: "string" },
                status: { type: "string", enum: ["pending", "done", "impossible"] },
                note: { type: "string" },
              },
              required: ["task", "status"],
            },
          },
        },
        required: ["items"],
      },
      risk: "safe",
      readOnly: true,
      run: async (input) => {
        items = ((input as { items?: Item[] })?.items ?? []).filter((i) => i && typeof i.task === "string");
        const open = items.filter((i) => i.status === "pending").length;
        return {
          text: open === 0 ? "Checklist saved. Nothing is pending." : `Checklist saved. ${open} pending.`,
        };
      },
    },
    pending() {
      const open = items.filter((i) => i.status === "pending");
      if (open.length === 0) return undefined;
      return `These parts of the request are still pending: ${open.map((i) => `"${i.task}"`).join(", ")}. Do them now, or mark them impossible with the reason. Do not ask the user to do them.`;
    },
  };
}
