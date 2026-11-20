import type { AgentAction } from "@subx/core";
import { say } from "../lang";
import type { AssistantTool } from "../tool";

/**
 * Today's Follow My Words actions (`WinCommandSource`, the ones the classic pipeline picks from) as
 * the assistant's direct tools (design §2, plan T16): "Notepad kholo" is one `open_app` call
 * instead of Win+R, a screenshot and typing (the user's top complaint, S-023). The actions keep
 * their own code, checks and fuzzy name matching; the model fills the args the classic writer
 * used to fill, from the same prose.
 *
 * One tool per action, not one `{action, args}` tool per group: on Qwen3-235B (S-024, 22 text
 * tasks) flat passed 19/22 against grouped's 16/22, with 2 leaked self-checks against 6 and 5.1 s
 * a task against 6.8 s; grouped put open_app beside open_url and Qwen opened web.whatsapp.com for
 * WhatsApp. docs/decisions.md 2026-11-18.
 *
 * `type_text` and `press_keys` are not offered: the screen tools' `type` and `key` do the same and
 * the guard judges every Enter there.
 */
export const DIRECT_ACTIONS = [
  "open_app",
  "open_web",
  "write_email",
  "whatsapp_message",
  "set_volume",
  "app_volume",
  "arrange_windows",
  "close_windows",
  "kill_process",
  "find_files",
  "open_folder",
  "make_folder",
  "copy_files",
  "brightness",
  "wifi",
  "bluetooth",
  "bluetooth_device",
  "power",
  "system_status",
  "screenshot",
];

/** How much of an action's facts a failure carries back: the app list is ~255 names. */
const FACTS_CHARS = 4000;

export interface DomainDeps {
  /**
   * Presses Enter in the box an action just typed into — how a WhatsApp message is sent once the
   * user has said yes. The classic action never sends (it has no approval); only this path does.
   */
  send?: () => Promise<void>;
}

/** `ids`: which actions, in this order; the bench passes its fake world's own. */
export function domainTools(
  actions: AgentAction[],
  ids: string[] = DIRECT_ACTIONS,
  deps: DomainDeps = {},
): AssistantTool[] {
  const byId = new Map(actions.filter((a) => a.available !== false).map((a) => [a.id, a]));
  return ids.flatMap((id) => {
    const action = byId.get(id);
    if (!action) return [];
    return [id === "whatsapp_message" && deps.send ? sending(direct(action), deps.send) : direct(action)];
  });
}

/**
 * WhatsApp with `send`: type as always, then — the user having approved — press Enter. S-024:
 * "Dragon ko hi bhejo" was typed and reported done, unsent, because the tool could only type.
 */
function sending(tool: AssistantTool, send: () => Promise<void>): AssistantTool {
  const params = tool.parameters as { properties: Record<string, unknown> };
  const wants = (raw: unknown) => (raw as { send?: unknown } | undefined)?.send === true;
  const without = (raw: unknown) => {
    const { send: _send, ...rest } = (raw ?? {}) as Record<string, unknown>;
    return rest;
  };
  return {
    ...tool,
    description: `${tool.description} Set "send": true only when the user said to send it (bhejo, send) — they are asked first.`,
    parameters: {
      ...params,
      properties: { ...params.properties, send: { type: "boolean" } },
    },
    classify: (raw) => {
      if (!wants(raw)) return { kind: "allow" };
      const { to = "", text = "" } = raw as { to?: string; text?: string };
      return { kind: "ask", what: say().sendTo(to, text), why: say().risky };
    },
    run: async (raw, signal) => {
      const out = await tool.run(without(raw), signal);
      if (!wants(raw)) return out;
      await send();
      return { text: `${out.text.replace(/ — not sent$/, "")} — sent` };
    },
  };
}

/**
 * The JSON schema an action's prose args describe — `{"close": string[]}`, `{"url": string,
 * "here"?: boolean}`, `{"do": "lock" | "sleep"}` — so the model gets exact names and Pi rejects a
 * wrong one back to it: with prose alone Celeris sent close_windows `{"windows": "Notepad"}`, the
 * close failed, and it closed the window in front by keys instead (S-024).
 */
export function argsSchema(prose: string | undefined): Record<string, unknown> {
  if (!prose) return { type: "object", additionalProperties: false, properties: {} };
  const body = /\{([^{}]*)\}/.exec(prose)?.[1];
  if (!body) return { type: "object", description: prose, additionalProperties: true };
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of body.matchAll(/"(\w+)"(\?)?:\s*([^,]+)/g)) {
    const [, name = "", optional, kind = ""] = field;
    properties[name] = typeOf(kind.trim());
    if (!optional) required.push(name);
  }
  return { type: "object", description: prose, properties, required, additionalProperties: false };
}

function typeOf(kind: string): Record<string, unknown> {
  const literals = [...kind.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (literals.length) return { enum: literals };
  if (kind.startsWith("string[]")) return { type: "array", items: { type: "string" } };
  const base = /^(string|number|boolean)/.exec(kind)?.[1];
  if (!base) return {};
  return /\|\s*null/.test(kind) ? { type: [base, "null"] } : { type: base };
}

/**
 * Tool names that would shadow a screen tool. The classic `screenshot` saves a PNG for the user;
 * named the same as the screen tool that shows the model the screen, it won — the model asked to
 * look, got a file in Pictures, and clicked blind (S-024).
 */
const RENAMED: Record<string, string> = { screenshot: "save_screenshot" };

/**
 * Risky for the classic decider (it must be surer before guessing them) but not something the
 * assistant asks about: closing an app's windows by name — "har chhoti app band karne pe poochta
 * hai, aisa nahi hona chahiye" (user, S-024). Stopping a program by force still asks.
 */
const NO_ASK = new Set(["close_windows"]);

function direct(action: AgentAction): AssistantTool {
  const args = (raw: unknown) => (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {});
  const asks = !!action.risky && !NO_ASK.has(action.id);
  return {
    name: RENAMED[action.id] ?? action.id,
    description: `${action.describe}.${action.args ? ` Input: ${action.args}` : ""}`,
    parameters: argsSchema(action.args),
    risk: asks ? "confirm" : "safe",
    ...(action.id === "kill_process" ? { touches: "process" as const } : {}),
    // WhatsApp focuses and pastes; open_web "here" presses Ctrl+L and Enter. The rest call Windows directly.
    usesInput: (raw) =>
      action.id === "whatsapp_message" || (action.id === "open_web" && args(raw).here === true),
    classify: () =>
      // The run appends the input to `what` itself (run.ts describeCall).
      // ponytail: the approval names the action in English; give each risky action a say() line when users read them.
      asks ? { kind: "ask", what: action.describe, why: say().risky } : { kind: "allow" },
    run: async (raw) => {
      try {
        const result = await action.run(args(raw));
        return { text: result.answer ? `${result.did}: ${result.answer}` : result.did };
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        // The classic writer read these before filling the args (installed apps, open windows,
        // devices); the model reads them after a miss, so the retry uses a name that exists.
        const facts = await action.facts?.().catch(() => []);
        const seen = facts?.length ? `\nWhat is there: ${facts.join("\n").slice(0, FACTS_CHARS)}` : "";
        throw new Error(`${why}${seen}`);
      }
    },
  };
}
