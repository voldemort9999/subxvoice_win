import type { Focus, OcrLine, ScreenCapture, ScreenInput, ScreenProbe, Shot, UiNode } from "@subx/core";
import { describe, expect, it } from "vitest";
import { decide } from "../guard";
import type { AssistantTool } from "../tool";
import { onScale, screenTools } from "./screen";

describe("onScale", () => {
  const seen: unknown[] = [];
  const fake = (name: string, props: string[]): AssistantTool => ({
    name,
    description: "Does it.",
    parameters: { type: "object", properties: Object.fromEntries(props.map((p) => [p, {}])) },
    risk: "safe",
    classify: (raw) => {
      seen.push(["classify", raw]);
      return undefined;
    },
    run: async (raw) => {
      seen.push(["run", raw]);
      return { text: "ok" };
    },
  });

  it("turns a 0–1000 model's points into screenshot pixels (S-024 calibration: Celeris answers on 0–1000)", async () => {
    // Celeris put a dot at pixel (1290, 160) of a 1430x804 shot at (903, 203): 1290/1430 → 902.
    seen.length = 0;
    const [drag] = onScale([fake("left_click_drag", ["coordinate", "start_coordinate"])], () => [1430, 804]);
    expect(drag?.description).toMatch(/0–1000/);
    await drag?.classify?.({ coordinate: [500, 500] });
    await drag?.run({ coordinate: [1000, 0], start_coordinate: [0, 1000] }, new AbortController().signal);
    const [zoom] = onScale([fake("zoom", ["region"])], () => [1430, 804]);
    await zoom?.run({ region: [0, 0, 500, 500] }, new AbortController().signal);
    // A grid point is a position, a screenshot coordinate a pixel whose middle is clicked, so a
    // point lands half a pixel earlier and unrounded: 500 → 714.5, whose middle is exactly 715.
    expect(seen).toEqual([
      ["classify", { coordinate: [714.5, 401.5] }],
      ["run", { coordinate: [1429.5, 0], start_coordinate: [0, 803.5] }],
      // Zoom corners are edges, not pixels: unchanged.
      ["run", { region: [0, 0, 715, 402] }],
    ]);
  });

  it("leaves tools that take no point alone", () => {
    const key = fake("key", ["text"]);
    expect(onScale([key], () => [1430, 804])[0]).toBe(key);
  });
});

const SHOT: Shot = {
  data: "AAAA",
  mimeType: "image/png",
  width: 1430,
  height: 804,
  scale: 0.5,
  display: { x: 0, y: 0, width: 2860, height: 1608 },
  redacted: 0,
};

function world(
  opts: {
    chain?: UiNode[];
    ocr?: OcrLine[];
    focus?: Focus | null;
    probeFails?: boolean;
    ocrFails?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const capture: ScreenCapture = {
    screenshot: async () => SHOT,
    zoom: async (region) => {
      calls.push(`zoom ${region.join(",")}`);
      return { ...SHOT, redacted: 1 };
    },
    // Physical = screenshot x 2.
    toPhysical: (x, y) => {
      if (x > 1430 || y > 804) throw new Error(`(${x}, ${y}) is outside the 1430x804 screenshot`);
      return [x * 2, y * 2];
    },
    toShot: (x, y) => [x / 2, y / 2],
    frameSize: () => [1430, 804],
  };
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push(`${name} ${JSON.stringify(args)}`);
    };
  const input = {
    click: record("click"),
    drag: record("drag"),
    move: record("move"),
    mouseDown: record("mouseDown"),
    mouseUp: record("mouseUp"),
    scroll: record("scroll"),
    type: record("type"),
    key: record("key"),
    holdKey: record("holdKey"),
    cursor: async () => [100, 100] as [number, number],
    releaseAll: record("releaseAll"),
    lastInjectedAt: () => 0,
  } as ScreenInput;
  const probe: ScreenProbe = {
    elementAt: async (x, y) => {
      calls.push(`elementAt ${x},${y}`);
      if (opts.probeFails) throw new Error("probe timed out");
      return opts.chain ?? [];
    },
    focused: async () => opts.focus ?? null,
    textNear: async () => {
      if (opts.ocrFails) throw new Error("OCR worker killed");
      return opts.ocr ?? [];
    },
  };
  const tools = new Map(screenTools({ capture, input, probe, settleMs: 0 }).map((t) => [t.name, t]));
  const tool = (name: string) => {
    const found = tools.get(name);
    if (!found) throw new Error(`no tool ${name}`);
    return found;
  };
  return { calls, tool, names: [...tools.keys()] };
}

const line = (text: string, x: number, y: number, width = 200, height = 40): OcrLine => ({
  text,
  box: { x, y, width, height },
});

describe("screen tools", () => {
  it("mirror the computer toolset's seventeen members by name", () => {
    expect(world().names.sort()).toEqual(
      [
        "screenshot",
        "zoom",
        "left_click",
        "right_click",
        "middle_click",
        "double_click",
        "triple_click",
        "left_click_drag",
        "mouse_move",
        "left_mouse_down",
        "left_mouse_up",
        "scroll",
        "type",
        "key",
        "hold_key",
        "wait",
        "cursor_position",
      ].sort(),
    );
  });

  it("take a screenshot as an image the model sees", async () => {
    const out = await world().tool("screenshot").run({}, new AbortController().signal);
    expect(out.image).toEqual({ data: "AAAA", mimeType: "image/png" });
    expect(out.text).toContain("1430x804");
  });

  it("say when password boxes were hidden", async () => {
    const out = await world()
      .tool("zoom")
      .run({ region: [0, 0, 100, 50] }, new AbortController().signal);
    expect(out.text).toMatch(/1 password box/);
  });

  it("click, then show the screen after", async () => {
    const w = world();
    const out = await w
      .tool("double_click")
      .run({ coordinate: [10, 20], text: "ctrl" }, new AbortController().signal);
    expect(w.calls).toContain('click [10,20,{"button":"left","count":2,"modifiers":["ctrl"]}]');
    expect(out.image?.data).toBe("AAAA");
  });

  it("says when a click hits the same point as the last one, which missed (demo: Start pressed 5x at one spot)", async () => {
    const { tool } = world();
    const run = (name: string, coordinate: [number, number]) =>
      tool(name).run({ coordinate }, new AbortController().signal);
    expect((await run("left_click", [970, 412])).text).not.toMatch(/same point/);
    expect((await run("left_click", [971, 413])).text).toMatch(/same point.*zoom/i);
    // A new point, or anything in between, starts afresh.
    expect((await run("left_click", [600, 300])).text).not.toMatch(/same point/);
    await tool("scroll").run(
      { coordinate: [600, 300], scroll_direction: "down", scroll_amount: 1 },
      new AbortController().signal,
    );
    expect((await run("left_click", [600, 300])).text).not.toMatch(/same point/);
  });

  it("reports a fractional click point rounded", async () => {
    const { tool } = world();
    const out = await tool("left_click").run({ coordinate: [714.5, 401.5] }, new AbortController().signal);
    expect(out.text).toMatch(/at \(715, 402\)/);
  });

  it("scroll and drag with the toolset's parameter names", async () => {
    const w = world();
    const signal = new AbortController().signal;
    await w.tool("scroll").run({ coordinate: [5, 6], scroll_direction: "down", scroll_amount: 3 }, signal);
    await w.tool("left_click_drag").run({ start_coordinate: [1, 2], coordinate: [3, 4] }, signal);
    expect(w.calls).toContain('scroll [[5,6],"down",3,[]]');
    expect(w.calls).toContain("drag [[1,2],[3,4]]");
  });
});

describe("the guard on pixel actions", () => {
  const ask = async (w: ReturnType<typeof world>, name: string, input: unknown) =>
    (await decide(w.tool(name), input)).kind;

  it("asks before clicking a Send button, judged by what is under the point", async () => {
    const w = world({
      chain: [
        { role: "Text", name: "Send" },
        { role: "Button", name: "" },
      ],
    });
    expect(await ask(w, "left_click", { coordinate: [10, 20] })).toBe("ask");
    expect(w.calls).toContain("elementAt 20,40");
  });

  it("lets ordinary buttons run, without matching inside longer words", async () => {
    expect(
      await ask(world({ chain: [{ role: "Button", name: "Search" }] }), "left_click", { coordinate: [1, 1] }),
    ).toBe("allow");
    expect(
      await ask(world({ chain: [{ role: "Button", name: "Display settings" }] }), "left_click", {
        coordinate: [1, 1],
      }),
    ).toBe("allow");
  });

  it("does not read a window's or page's title as the button clicked", async () => {
    const page = {
      chain: [
        { role: "Document", name: "Place your order - Amazon" },
        { role: "Window", name: "Send money - Chrome" },
      ],
      ocr: [line("Search", 120, 180)],
    };
    expect(await ask(world(page), "left_click", { coordinate: [100, 100] })).toBe("allow");
  });

  it("knows Hindi labels", async () => {
    expect(
      await ask(world({ chain: [{ role: "Button", name: "भेजें" }] }), "left_click", { coordinate: [1, 1] }),
    ).toBe("ask");
  });

  it("reads the pixels where there is no tree, and judges the line under the click", async () => {
    // Physical point (200, 200): "Add to cart" covers it; "Place order" sits 100 px lower.
    const ocr = [line("Add to cart", 120, 180), line("Place order", 120, 280)];
    const canvas = { chain: [{ role: "Pane", name: "BlueStacks App Player" }], ocr };
    expect(await ask(world(canvas), "left_click", { coordinate: [100, 100] })).toBe("allow");
    expect(await ask(world(canvas), "left_click", { coordinate: [100, 150] })).toBe("ask");
    expect(await ask(world({ ocr }), "double_click", { coordinate: [100, 150] })).toBe("ask");
  });

  it("lets a click run when nothing can be read there", async () => {
    expect(await ask(world(), "left_click", { coordinate: [1, 1] })).toBe("allow");
  });

  it("leaves an off-screen coordinate to the tool's own error", async () => {
    expect(await ask(world(), "left_click", { coordinate: [5000, 1] })).toBe("allow");
  });

  it("asks before Enter in a message box, and not in a search box", async () => {
    const chat: Focus = {
      role: "Edit",
      name: "",
      help: "Type a message",
      window: "WhatsApp",
      program: "WhatsApp",
    };
    const search: Focus = {
      role: "Edit",
      name: "Search",
      help: "",
      window: "Google - Chrome",
      program: "chrome",
    };
    expect(await ask(world({ focus: chat }), "key", { text: "Return" })).toBe("ask");
    expect(await ask(world({ focus: chat }), "key", { text: "ctrl+a" })).toBe("allow");
    expect(await ask(world({ focus: search }), "key", { text: "Return" })).toBe("allow");
  });

  it("asks before a key that closes whatever window is in front (S-024: it closed the wrong one)", async () => {
    // A close by name failed, so Celeris pressed a closing key — and the window in front was not Notepad.
    const code: Focus = {
      role: "Edit",
      name: "",
      help: "",
      window: "notes.md - Visual Studio Code",
      program: "Code",
    };
    for (const combo of ["alt+F4", "ctrl+w", "ctrl+shift+w", "ctrl+q", "ctrl+F4"])
      expect(await ask(world({ focus: code }), "key", { text: combo })).toBe("ask");
    expect(await ask(world({ focus: code }), "key", { text: "ctrl+s" })).toBe("allow");
  });

  it("asks before typing a line break into a chat app, which sends it", async () => {
    const chat: Focus = { role: "Document", name: "", help: "", window: "Telegram", program: "Telegram" };
    expect(await ask(world({ focus: chat }), "type", { text: "hi\nthere" })).toBe("ask");
    expect(await ask(world({ focus: chat }), "type", { text: "hi there" })).toBe("allow");
  });

  it("judges a drag at both ends: releasing on Place order is a click on it (review I1)", async () => {
    const ocr = [line("Place order", 120, 280)];
    const w = world({ ocr });
    expect(await ask(w, "left_click_drag", { start_coordinate: [100, 150], coordinate: [100, 150] })).toBe(
      "ask",
    );
    expect(await ask(w, "left_click_drag", { start_coordinate: [10, 10], coordinate: [100, 150] })).toBe(
      "ask",
    );
    expect(await ask(world(), "left_click_drag", { start_coordinate: [10, 10], coordinate: [20, 20] })).toBe(
      "allow",
    );
  });

  it("asks before holding Enter in a message box (review I1)", async () => {
    const chat: Focus = {
      role: "Edit",
      name: "",
      help: "Type a message",
      window: "WhatsApp",
      program: "WhatsApp",
    };
    expect(await ask(world({ focus: chat }), "hold_key", { text: "Return", duration: 0.1 })).toBe("ask");
    expect(await ask(world({ focus: chat }), "hold_key", { text: "shift", duration: 1 })).toBe("allow");
  });

  it("asks before Enter or Space on a focused Place order button (review I2)", async () => {
    const button: Focus = {
      role: "Button",
      name: "Place order",
      help: "",
      window: "Shop",
      program: "chrome",
    };
    expect(await ask(world({ focus: button }), "key", { text: "Return" })).toBe("ask");
    expect(await ask(world({ focus: button }), "key", { text: "space" })).toBe("ask");
    expect(await ask(world({ focus: button }), "type", { text: "\n" })).toBe("ask");
    const ok: Focus = { ...button, name: "Search" };
    expect(await ask(world({ focus: ok }), "key", { text: "space" })).toBe("allow");
  });

  it("asks when the screen under a tree-less click cannot be read at all (review I3)", async () => {
    expect(await ask(world({ ocrFails: true }), "left_click", { coordinate: [1, 1] })).toBe("ask");
    expect(await ask(world({ probeFails: true, ocrFails: true }), "left_click", { coordinate: [1, 1] })).toBe(
      "ask",
    );
    // A real control under the point still speaks for itself; OCR is not needed.
    expect(
      await ask(world({ chain: [{ role: "Button", name: "Search" }], ocrFails: true }), "left_click", {
        coordinate: [1, 1],
      }),
    ).toBe("allow");
  });

  it("knows shop labels: Place your order, Checkout (review I4)", async () => {
    for (const name of ["Place your order", "Checkout", "Proceed to checkout"])
      expect(
        await ask(world({ chain: [{ role: "Button", name }] }), "left_click", { coordinate: [1, 1] }),
      ).toBe("ask");
  });

  it("asks at the far end of a wide bar whose label sits in the middle of the row (review I4)", async () => {
    // Physical click (1400, 300); "Place order" is drawn at x 1100–1300 on the same row, 100 px away.
    const ocr = [line("Place order", 1100, 290, 200, 30)];
    expect(await ask(world({ ocr }), "left_click", { coordinate: [700, 150] })).toBe("ask");
    // Side by side on one row, a click on Add to cart is just that.
    const shop = [line("Add to cart", 120, 290, 200, 30), line("Place order", 440, 290, 200, 30)];
    expect(await ask(world({ ocr: shop }), "left_click", { coordinate: [100, 150] })).toBe("allow");
  });

  it("checks a press-and-release click where the cursor is", async () => {
    const w = world({ chain: [{ role: "Button", name: "Pay now" }] });
    expect(await ask(w, "left_mouse_down", {})).toBe("ask");
    expect(w.calls).toContain("elementAt 200,200");
  });
});
