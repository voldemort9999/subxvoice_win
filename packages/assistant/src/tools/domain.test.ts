import type { AgentAction } from "@subx/core";
import { describe, expect, it } from "vitest";
import { decide } from "../guard";
import { argsSchema, domainTools } from "./domain";

describe("argsSchema", () => {
  it("turns an action's prose args into a JSON schema with its exact names (S-024: 'windows' sent for 'close')", () => {
    expect(argsSchema('{"close": string[]} — window titles copied exactly')).toEqual({
      type: "object",
      description: '{"close": string[]} — window titles copied exactly',
      properties: { close: { type: "array", items: { type: "string" } } },
      required: ["close"],
      additionalProperties: false,
    });
    expect(argsSchema('{"url": string, "here"?: boolean}')).toMatchObject({
      properties: { url: { type: "string" }, here: { type: "boolean" } },
      required: ["url"],
    });
    expect(argsSchema('{"do": "lock" | "sleep", "level": number 0-100 | null}').properties).toEqual({
      do: { enum: ["lock", "sleep"] },
      level: { type: ["number", "null"] },
    });
  });

  it("stays open where the prose has no {…} to read", () => {
    expect(argsSchema(undefined)).toEqual({ type: "object", additionalProperties: false, properties: {} });
    expect(argsSchema("whatever")).toMatchObject({ type: "object", additionalProperties: true });
  });
});

const ran: string[] = [];
const action = (id: string, extra: Partial<AgentAction> = {}): AgentAction => ({
  id,
  describe: `Do ${id}`,
  run: async (args) => {
    ran.push(`${id} ${JSON.stringify(args)}`);
    return { did: `Did ${id}` };
  },
  ...extra,
});

const ACTIONS: AgentAction[] = [
  action("open_app", {
    args: '{"name": string}',
    facts: async () => ["Installed apps: Notepad; Claude; Chrome"],
  }),
  action("open_web", { args: '{"url": string, "here"?: boolean}' }),
  action("whatsapp_message", { args: '{"to": string, "text": string}' }),
  action("set_volume"),
  action("close_windows", { risky: true }),
  action("kill_process", { risky: true }),
  action("system_status", { run: async () => ({ did: "Read the status", answer: "Battery 80%" }) }),
  action("type_text"),
  action("press_keys"),
  action("focus_mode", { available: false, unavailable: "Focus mode isn't switched on yet" }),
];

const tool = (name: string) => {
  const found = domainTools(ACTIONS).find((candidate) => candidate.name === name);
  if (!found) throw new Error(name);
  return found;
};
const signal = new AbortController().signal;

describe("domainTools", () => {
  it("makes one tool per direct action, its input described as the action describes it", () => {
    expect(domainTools(ACTIONS).map((t) => t.name)).toEqual([
      "open_app",
      "open_web",
      "whatsapp_message",
      "set_volume",
      "close_windows",
      "kill_process",
      "system_status",
    ]);
    expect(tool("open_app").description).toBe('Do open_app. Input: {"name": string}');
  });

  it("never shadows a screen tool: the saving screenshot is save_screenshot (S-024: the model asked to see and got a file)", () => {
    const tools = domainTools([action("screenshot"), action("set_volume")]);
    expect(tools.map((t) => t.name)).toEqual(["set_volume", "save_screenshot"]);
    const screenNames = ["screenshot", "zoom", "left_click", "type", "key", "scroll", "wait", "ui"];
    for (const t of domainTools(ACTIONS)) expect(screenNames).not.toContain(t.name);
  });

  it("leaves out typing, keys and what is not available — the screen tools type, behind the Enter guard", () => {
    const names = domainTools(ACTIONS).map((t) => t.name);
    for (const id of ["type_text", "press_keys", "focus_mode"]) expect(names).not.toContain(id);
  });

  it("runs the action with the model's input, in one call", async () => {
    ran.length = 0;
    const out = await tool("open_app").run({ name: "Notepad" }, signal);
    expect(ran).toEqual(['open_app {"name":"Notepad"}']);
    expect(out.text).toBe("Did open_app");
  });

  it("hands back an answer an action read", async () => {
    expect((await tool("system_status").run({}, signal)).text).toBe("Read the status: Battery 80%");
  });

  it("on a failure, says what is really there so the next try can use an exact name", async () => {
    const [failing] = domainTools([
      action("open_app", {
        facts: async () => ["Installed apps: Notepad; Claude; Chrome"],
        run: async () => {
          throw new Error('No app called "cloud" on this computer');
        },
      }),
    ]);
    await expect(failing?.run({ name: "cloud" }, signal)).rejects.toThrow(
      /No app called "cloud".*\n.*Installed apps: Notepad; Claude; Chrome/s,
    );
  });

  it("closes an app's windows without asking (user, S-024), asks before other risky actions, never stops a protected process", async () => {
    expect(await decide(tool("close_windows"), { close: ["Chrome"] })).toEqual({ kind: "allow" });
    expect(await decide(tool("kill_process"), { name: "chrome" })).toMatchObject({ kind: "ask" });
    expect(await decide(tool("set_volume"), { level: 30 })).toEqual({ kind: "allow" });
    expect(await decide(tool("kill_process"), { name: "lsass.exe" })).toMatchObject({ kind: "never" });
  });

  it("sends a WhatsApp message only when asked to, and only after the user's yes (S-024: 'bhejo' was typed, never sent)", async () => {
    ran.length = 0;
    const sent: string[] = [];
    const whatsapp = domainTools(ACTIONS, undefined, { send: async () => void sent.push("enter") }).find(
      (t) => t.name === "whatsapp_message",
    );
    if (!whatsapp) throw new Error("whatsapp_message");
    expect((whatsapp.parameters.properties as Record<string, unknown>).send).toBeDefined();
    // Writing is not sending: no question, no Enter.
    expect(await decide(whatsapp, { to: "Dragon", text: "hi" })).toEqual({ kind: "allow" });
    await whatsapp.run({ to: "Dragon", text: "hi" }, signal);
    expect(sent).toEqual([]);
    // Sending asks first, then types and presses Enter; the action itself never sees `send`.
    expect(await decide(whatsapp, { to: "Dragon", text: "hi", send: true })).toMatchObject({
      kind: "ask",
      what: 'WhatsApp pe Dragon ko "hi" bhejna',
    });
    const out = await whatsapp.run({ to: "Dragon", text: "hi", send: true }, signal);
    expect(ran.at(-1)).toBe('whatsapp_message {"to":"Dragon","text":"hi"}');
    expect(sent).toEqual(["enter"]);
    expect(out.text).toMatch(/sent/);
  });

  it("names a risky action plainly in its approval — the run adds the input once", async () => {
    const decision = await decide(tool("kill_process"), { name: "chrome" });
    expect(decision).toMatchObject({ kind: "ask", what: "Do kill_process" });
  });

  it("marks only the actions that press keys as using the user's input", () => {
    const uses = (name: string, input: unknown) => {
      const u = tool(name).usesInput;
      return typeof u === "function" ? u(input) : !!u;
    };
    expect(uses("whatsapp_message", {})).toBe(true);
    expect(uses("open_web", { url: "https://x.com", here: true })).toBe(true);
    expect(uses("open_web", { url: "https://x.com" })).toBe(false);
    expect(uses("open_app", { name: "Notepad" })).toBe(false);
  });
});
