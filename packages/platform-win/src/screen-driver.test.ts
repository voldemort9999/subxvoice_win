import { describe, expect, it } from "vitest";
import { WinScreenCapture } from "./capture";
import type { PowerShellWorker } from "./powershell";
import { WinScreenDriver } from "./screen";

describe("WinScreenDriver.read → look", () => {
  const window = {
    handle: 77,
    title: "YouTube",
    program: "chrome",
    pid: 1,
    state: "normal",
    foreground: true,
  };
  function setup(elements: unknown[]) {
    const calls: string[] = [];
    const worker = {
      run: async (code: string) => void calls.push(code),
      json: async (code: string) => {
        calls.push(code);
        if (code.startsWith("[CmdUia]::Read")) return { elements };
        if (code.startsWith("[CmdCapture]::Display")) return { x: 0, y: 0, width: 2000, height: 1000 };
        if (code.startsWith("[CmdCapture]::WindowRect")) return { x: 100, y: 50, width: 1600, height: 900 };
        if (code.startsWith("[CmdCapture]::Grab"))
          return { data: "AAAA", mimeType: "image/png", redacted: 0 };
        if (code.startsWith("Invoke-SubxOcr"))
          return [{ text: "Subscribe", box: { x: 1810, y: 110, width: 80, height: 30 } }];
        throw new Error(code);
      },
    } as unknown as PowerShellWorker;
    const windows = async () => [window];
    const driver = new WinScreenDriver(worker, {
      windows,
      inserter: { insert: async () => {} },
      launchNamed: async () => false,
      capture: new WinScreenCapture(worker, { windows }),
      clickAt: async () => {},
    });
    return { driver, calls };
  }

  it("takes nothing until asked: a decider that cannot look pays no time", async () => {
    const { driver, calls } = setup([{ id: 0, role: "Link", name: "a", editable: false }]);
    const snapshot = await driver.read("in YouTube");
    expect(calls.filter((call) => !call.startsWith("[CmdUia]"))).toEqual([]);
    expect(snapshot.look).toBeTypeOf("function");
  });

  /** A full tree, as a web page gives: named links enough that the pixels add only the icons. */
  const links = Array.from({ length: 12 }, (_, i) => ({
    id: 10 + i,
    role: "Link",
    name: `Video ${i}`,
    editable: false,
    bounds: [100, 200 + i * 40, 900, 230 + i * 40],
  }));

  it("reads text off the whole window where the tree is thin, and clicks a point through it", async () => {
    const { driver, calls } = setup([
      { id: 0, role: "Button", name: "Instance", editable: false, bounds: [700, 800, 840, 840] },
    ]);
    const look = await (await driver.read("in YouTube")).look?.();
    expect(calls).toContain("[CmdCapture]::WindowRect(77)");
    expect(calls.filter((call) => call.startsWith("Invoke-SubxOcr"))).toEqual([
      "Invoke-SubxOcr 100 50 1600 900",
    ]);
    expect(look?.text[0]?.text).toBe("Subscribe");
    expect(driver.clickAt).toBeTypeOf("function");
  });

  it("pictures the window's display, and OCRs only the area of elements with no name", async () => {
    const { driver, calls } = setup([
      ...links,
      { id: 0, role: "Edit", name: "Search", editable: true, bounds: [200, 100, 600, 140] },
      { id: 1, role: "Button", name: "", editable: false, bounds: [1800, 100, 1900, 160] },
      { id: 2, role: "Button", name: " ", editable: false, bounds: [1700, 120, 1750, 150] },
    ]);
    const look = await (await driver.read("in YouTube")).look?.();
    expect(calls).toContain("[CmdCapture]::Display(77)");
    expect(look?.shot.data).toBe("AAAA");
    expect(look?.shot.display).toEqual({ x: 0, y: 0, width: 2000, height: 1000 });
    // One OCR call over the union of the two unnamed buttons, not one per element.
    expect(calls.filter((call) => call.startsWith("Invoke-SubxOcr"))).toEqual([
      "Invoke-SubxOcr 1700 100 200 60",
    ]);
    expect(look?.text[0]?.text).toBe("Subscribe");
  });

  it("skips OCR when every element has a name", async () => {
    const { driver, calls } = setup([
      ...links,
      { id: 0, role: "Edit", name: "Search", editable: true, bounds: [1, 1, 9, 9] },
    ]);
    const look = await (await driver.read("in YouTube")).look?.();
    expect(calls.some((call) => call.startsWith("Invoke-SubxOcr"))).toBe(false);
    expect(look?.text).toEqual([]);
  });
});

describe("WinScreenDriver.act", () => {
  it("acts through the named UIA pattern", async () => {
    const calls: string[] = [];
    const worker = { run: async (code: string) => void calls.push(code) } as unknown as PowerShellWorker;
    const driver = new WinScreenDriver(worker, {
      windows: async () => [],
      inserter: { insert: async () => {} },
      launchNamed: async () => false,
    });
    await driver.act(3, "expand");
    expect(calls).toEqual(["[CmdUia]::Act(3, 'expand')"]);
  });
});

describe("WinScreenDriver.typeInto (laptop demo, 2026-11-19: WhatsApp's search took the paste one time in two)", () => {
  function setup(values: (string | null)[]) {
    const calls: string[] = [];
    const typed: string[] = [];
    let reads = 0;
    const worker = {
      run: async (code: string) => {
        calls.push(code);
        if (code.startsWith("[CmdUia]::CurrentValue")) return values[Math.min(reads++, values.length - 1)];
        return undefined;
      },
      json: async () => ({ elements: [{ id: 5, role: "Edit", name: "Search", editable: true }] }),
    } as unknown as PowerShellWorker;
    const driver = new WinScreenDriver(worker, {
      windows: async () => [
        { handle: 9, title: "WhatsApp", program: "WhatsApp.Root", pid: 1, state: "normal", foreground: true },
      ],
      inserter: { insert: async (text: string) => void typed.push(text) },
      launchNamed: async () => false,
      keys: { selectAll: () => void calls.push("ctrl+a"), modifiersUp: async () => true },
    });
    return { driver, calls, typed };
  }
  const focuses = (calls: string[]) => calls.filter((c) => c.startsWith("[CmdUia]::Focus"));

  it("brings the window forward on its own before clicking into the box", async () => {
    const { driver, calls } = setup(["Priya"]);
    await driver.read("in WhatsApp");
    calls.length = 0;
    await driver.typeInto(5, "Priya");
    expect(calls[0]).toBe("[void][CmdWindows]::Focus(9)");
    expect(calls[1]).toBe("[CmdUia]::Focus(5)");
  });

  it("clicks in and pastes once more when the first paste did not show, replacing rather than doubling", async () => {
    // Ten reads of the first go see nothing; the second go lands.
    const { driver, calls, typed } = setup([...Array(10).fill(""), "Priya"]);
    await driver.read("in WhatsApp");
    await driver.typeInto(5, "Priya");
    expect(typed).toEqual(["Priya", "Priya"]);
    expect(focuses(calls)).toHaveLength(2);
    expect(calls.filter((c) => c === "ctrl+a")).toHaveLength(2);
  }, 15_000);

  it("says so when the text never shows, after the second go", async () => {
    const { driver } = setup([""]);
    await driver.read("in WhatsApp");
    await expect(driver.typeInto(5, "Priya")).rejects.toThrow(/doesn't show it/);
  }, 15_000);

  it("trusts a box that cannot say what it holds, and types once", async () => {
    const { driver, typed } = setup([null]);
    await driver.read("in WhatsApp");
    await driver.typeInto(5, "Hi");
    expect(typed).toEqual(["Hi"]);
  }, 15_000);
});
