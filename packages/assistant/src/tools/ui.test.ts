import type { ScreenDriver, ScreenElement } from "@subx/core";
import { describe, expect, it } from "vitest";
import { decide } from "../guard";
import { uiTool } from "./ui";

const ELEMENTS: ScreenElement[] = [
  {
    id: 0,
    role: "Edit",
    name: "Search or start a new chat",
    editable: true,
    bounds: [100, 80, 500, 120],
    focused: true,
  },
  { id: 1, role: "ListItem", name: "Aryan", editable: false, bounds: [100, 200, 500, 260] },
  { id: 2, role: "Button", name: "Send", editable: false, bounds: [900, 700, 960, 740] },
  { id: 3, role: "Edit", name: "", value: "hello", editable: true, where: "bottom" },
];

function world(opts: { typeFails?: boolean; frame?: boolean } = {}) {
  const calls: string[] = [];
  const driver: ScreenDriver = {
    read: async (hint) => {
      calls.push(`read ${hint}`);
      return { window: "WhatsApp", elements: ELEMENTS };
    },
    click: async (id) => void calls.push(`click ${id}`),
    typeInto: async (id, text) => {
      calls.push(`type ${id} ${text}`);
      if (opts.typeFails) throw new Error(`Typed "${text}", but "the box" doesn't show it`);
    },
    act: async (id, action) => void calls.push(`${action} ${id}`),
  };
  // Physical → screenshot: half size, when a screenshot has been taken.
  const toShot = (x: number, y: number): [number, number] => {
    if (!opts.frame) throw new Error("Take a screenshot first");
    return [x / 2, y / 2];
  };
  return { calls, tool: uiTool({ driver, toShot }) };
}

const run = (tool: ReturnType<typeof world>["tool"], input: unknown) =>
  tool.run(input, new AbortController().signal);

describe("ui tool", () => {
  it("reads a window as numbered lines with role, name, value and bounds in screenshot pixels", async () => {
    const { tool, calls } = world({ frame: true });
    const out = await run(tool, { action: "read", window: "WhatsApp" });
    expect(calls).toEqual(["read WhatsApp"]);
    expect(out.text).toContain('e0 Edit "Search or start a new chat" editable (focused) [50,40,250,60]');
    expect(out.text).toContain('e2 Button "Send" [450,350,480,370]');
    expect(out.text).toContain('e3 Edit "" = "hello" editable at the bottom');
  });

  it("leaves bounds out until a screenshot gives them a frame", async () => {
    const out = await run(world().tool, { action: "read" });
    expect(out.text).toContain('e2 Button "Send"\n');
    expect(out.text).not.toContain("[");
  });

  it("filters a read", async () => {
    const out = await run(world().tool, { action: "read", filter: "aryan" });
    expect(out.text).toContain('e1 ListItem "Aryan"');
    expect(out.text).not.toContain("Send");
  });

  it("acts on an element by id", async () => {
    const { tool, calls } = world();
    await run(tool, { action: "read" });
    await run(tool, { action: "invoke", id: 1 });
    await run(tool, { action: "expand", id: 1 });
    await run(tool, { action: "click", id: 1 });
    const out = await run(tool, { action: "type", id: 0, text: "Aryan" });
    expect(calls.slice(1)).toEqual(["invoke 1", "expand 1", "click 1", "type 0 Aryan"]);
    expect(out.text).toContain('e0 Edit "Search or start a new chat"');
  });

  it("says so when typing did not land", async () => {
    const { tool } = world({ typeFails: true });
    await expect(run(tool, { action: "type", id: 3, text: "hi" })).rejects.toThrow(/doesn't show it/);
  });

  it("asks before pressing a Send button, and not before opening a chat", async () => {
    const { tool } = world();
    await run(tool, { action: "read" });
    expect((await decide(tool, { action: "invoke", id: 2 })).kind).toBe("ask");
    expect((await decide(tool, { action: "click", id: 2 })).kind).toBe("ask");
    expect((await decide(tool, { action: "click", id: 1 })).kind).toBe("allow");
    expect((await decide(tool, { action: "read" })).kind).toBe("allow");
  });
});
