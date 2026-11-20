import type {
  Focus,
  GuardDecision,
  MouseButton,
  OcrLine,
  ScreenCapture,
  ScreenInput,
  ScreenProbe,
  ScrollDirection,
  Shot,
  UiNode,
} from "@subx/core";
import { say } from "../lang";
import type { AssistantTool, ToolOutput } from "../tool";

/**
 * The pixel tools: names and parameters copied from Anthropic's `computer_toolset_20260801`, so
 * a Claude model's training carries over and every model sees the same seventeen tools (design
 * §2). As in Anthropic's computer-use demo (`tools/computer.py`), every action answers with a
 * fresh screenshot, so the model checks what happened instead of assuming it.
 *
 * The guard judges a click by what it would hit, never by what the model says it is clicking:
 * the UIA element under the point and two ancestors, and where no app exposes a tree (canvas
 * shops, BlueStacks) the text OCR reads on that spot. Enter in a message box — and a typed line
 * break, which is the same key — is judged by the focused box. This is the code half of "nothing
 * is sent, ordered or paid without a yes"; the prompt's half asked the model to police itself on
 * tree-less screens, which the S-019 bench showed it does not reliably do.
 */

export interface ScreenToolDeps {
  capture: ScreenCapture;
  input: ScreenInput;
  probe: ScreenProbe;
  /** How long an action is given to show on screen before the screenshot after it. */
  settleMs?: number;
}

/** Labels of actions that send, pay, order, book, submit, publish, delete or install. */
export const RISKY =
  /\b(send|send now|pay|pay now|place (your )?order|order now|confirm order|check ?out|proceed to (checkout|pay(ment)?)|submit|delete|buy|buy now|install|uninstall|book now|publish|post|transfer)\b|भेज|भुगतान|ऑर्डर|खरीद|हटा|डिलीट/i;

/** Where a typed Enter sends: a box named like a message, or any box of a chat app. */
const MESSAGE_BOX = /message|reply|comment|chat|compose|write|tweet|संदेश|सन्देश|मैसेज|जवाब/i;
const CHAT_APP =
  /whatsapp|telegram|discord|slack|teams|messenger|signal|instagram|skype|outlook|gmail|wechat|viber|\bline\b/i;
const EDITABLE = new Set(["Edit", "Document", "ComboBox", "Custom", "Group", "Pane", "Other"]);

/**
 * Roles that are a real control with its own label. Anything else under the point (a pane, a
 * canvas, a web document) says nothing about what the click hits, so the pixels are read too.
 */
const CONTROLS = new Set([
  "Button",
  "SplitButton",
  "Link",
  "MenuItem",
  "ListItem",
  "TabItem",
  "TreeItem",
  "CheckBox",
  "RadioButton",
  "Text",
  "Edit",
  "ComboBox",
  "DataItem",
  "HeaderItem",
]);

/** How far from the click an OCR line may sit and still be what the click hits. */
const OCR_REACH = 40;

/** The OCR line under the point, else the nearest within reach. */
export function lineAt(lines: OcrLine[], x: number, y: number): OcrLine | null {
  let best: OcrLine | null = null;
  let bestDistance = OCR_REACH;
  for (const line of lines) {
    const { x: bx, y: by, width, height } = line.box;
    const dx = Math.max(bx - x, 0, x - (bx + width));
    const dy = Math.max(by - y, 0, y - (by + height));
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return line;
    if (distance <= bestDistance) {
      best = line;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * A risky label on the click's own row, anywhere in the OCR band: a full-width bottom bar
 * (BlueStacks, mobile web) draws "Place order" in its middle, far from a click at its end. Asking
 * one time too many is the safe side (T9–T13 review, I4).
 */
const riskyOnRow = (lines: OcrLine[], y: number) =>
  lines.find((line) => y >= line.box.y && y <= line.box.y + line.box.height && RISKY.test(line.text));

async function judgeClick(deps: ScreenToolDeps, at: [number, number]): Promise<GuardDecision | undefined> {
  const chain: UiNode[] | null = await deps.probe.elementAt(...at).catch(() => null);
  // Only controls speak for the click: a window's or web page's name is its title, and a page
  // titled "Place your order" would otherwise make every click on it ask.
  const named = (chain ?? [])
    .filter((node) => CONTROLS.has(node.role) && node.name)
    .map((node) => node.name)
    .find((name) => RISKY.test(name));
  if (named) return { kind: "ask", what: say().press(named), why: say().risky };
  // A named control answers for itself; an icon button with no name does not, so it is read too.
  if (chain?.[0] && CONTROLS.has(chain[0].role) && chain[0].name) return undefined;
  const lines = await deps.probe.textNear(...at).catch(() => null);
  // Fail closed: with no control under the point and no reading of the pixels, the click could
  // be on anything — including a tree-less "Place order" (T9–T13 review, I3).
  if (lines === null) return { kind: "ask", what: say().unreadClick, why: say().risky };
  const line = lineAt(lines, ...at);
  if (line)
    return RISKY.test(line.text)
      ? { kind: "ask", what: say().press(line.text), why: say().risky }
      : undefined;
  // Only when nothing is near the click: "Add to cart" beside "Place order" is still just Add to cart.
  const row = riskyOnRow(lines, at[1]);
  if (row) return { kind: "ask", what: say().press(row.text), why: say().risky };
  return undefined;
}

const isMessageBox = (focus: Focus | null): focus is Focus =>
  !!focus &&
  EDITABLE.has(focus.role) &&
  (MESSAGE_BOX.test(`${focus.name} ${focus.help}`) || CHAT_APP.test(`${focus.program} ${focus.window}`));

/**
 * Enter in a message box sends; Enter or Space on a focused "Place order" button presses it
 * (Tab there, then a key — T9–T13 review, I2). `space` is only the button case: in a box it types.
 */
async function judgeEnter(deps: ScreenToolDeps, space = false): Promise<GuardDecision | undefined> {
  const focus = await deps.probe.focused().catch(() => null);
  if (focus && CONTROLS.has(focus.role) && !EDITABLE.has(focus.role) && RISKY.test(focus.name))
    return { kind: "ask", what: say().press(focus.name), why: say().risky };
  if (space || !isMessageBox(focus)) return undefined;
  return {
    kind: "ask",
    what: say().pressEnter(focus.program || focus.window),
    why: say().risky,
  };
}

/** "Return", "ctrl+enter" — but not shift+Enter, which is a new line in every chat box. */
const pressesEnter = (combo: string) => {
  const keys = combo
    .toLowerCase()
    .split("+")
    .map((key) => key.trim());
  return ["return", "enter", "kp_enter"].includes(keys.at(-1) ?? "") && !keys.includes("shift");
};
const pressesSpace = (combo: string) => combo.toLowerCase().split("+").at(-1)?.trim() === "space";

/**
 * Alt+F4, Ctrl+W, Ctrl+Q… close whatever window is in front, which is not always the one meant:
 * a close by name failed and Celeris pressed one on the wrong window (S-024). The user sees the
 * window's name and says yes first.
 */
const CLOSING = new Set(["alt+f4", "ctrl+w", "ctrl+shift+w", "ctrl+q", "ctrl+f4"]);
const closesWindow = (combo: string) =>
  CLOSING.has(
    combo
      .toLowerCase()
      .replace(/control/g, "ctrl")
      .replace(/\s+/g, ""),
  );

async function judgeClose(deps: ScreenToolDeps, combo: string): Promise<GuardDecision> {
  const focus = await deps.probe.focused().catch(() => null);
  return {
    kind: "ask",
    what: say().closeKey(focus?.window || focus?.program || "?", combo),
    why: say().risky,
  };
}

/** A key press or hold that could press a button, send, or close a window. */
const judgeKey = (deps: ScreenToolDeps, combo: string) =>
  closesWindow(combo)
    ? judgeClose(deps, combo)
    : pressesEnter(combo)
      ? judgeEnter(deps)
      : pressesSpace(combo)
        ? judgeEnter(deps, true)
        : undefined;

type Point = [number, number];
interface Input {
  coordinate?: Point;
  start_coordinate?: Point;
  region?: [number, number, number, number];
  text?: string;
  scroll_direction?: ScrollDirection;
  scroll_amount?: number;
  duration?: number;
  repeat?: number;
}

const POINT = {
  type: "array",
  items: { type: "number" },
  minItems: 2,
  maxItems: 2,
  description: "[x, y] in pixels of the latest screenshot",
};
const MODIFIERS = {
  type: "string",
  description: 'Keys to hold during the action, e.g. "ctrl" or "ctrl+shift"',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const describeShot = (shot: Shot) =>
  `Screenshot ${shot.width}x${shot.height}.` +
  (shot.redacted
    ? ` ${shot.redacted} password box${shot.redacted > 1 ? "es are" : " is"} blacked out on purpose.`
    : "");

const CLICKS = new Set(["left_click", "right_click", "middle_click", "double_click", "triple_click"]);
/** Screenshot pixels within which a second click counts as the same spot. */
const SAME_SPOT = 3;
const SAME_SPOT_HINT =
  "This is the same point as your last click. If the screen did not change after that one, the click is missing its target by a few pixels: zoom on the target, then click the exact middle of the button, not its edge.";

const INPUT_TOOLS = new Set([
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
]);

export function screenTools(deps: ScreenToolDeps): AssistantTool[] {
  const { capture, input } = deps;
  const settle = deps.settleMs ?? 500;
  const image = (shot: Shot): ToolOutput["image"] => ({ data: shot.data, mimeType: shot.mimeType });

  const after = async (did: string): Promise<ToolOutput> => {
    await sleep(settle);
    const shot = await capture.screenshot();
    return { text: `${did}. ${describeShot(shot)}`, image: image(shot) };
  };
  const mods = (text?: string) => (text ? text.split("+").map((key) => key.trim()) : []);
  /** The click's point, or the cursor's when none is given (the toolset allows both). */
  const pointOf = async (given?: Point): Promise<Point> => given ?? (await input.cursor());
  const physical = async (given?: Point): Promise<Point | null> => {
    try {
      return capture.toPhysical(...(await pointOf(given)));
    } catch {
      return null; // off the image: the action itself will say so
    }
  };
  const clickGuard = async (raw: unknown) => {
    const at = await physical((raw as Input).coordinate);
    return at ? judgeClick(deps, at) : undefined;
  };

  /**
   * The click before this one, if nothing else ran since. Celeris pressed BlueStacks' Start five
   * times at one point a pixel or two off the button, never looking closer (demo hand test,
   * 2026-11-19): a second click on the same spot is told it is probably missing.
   */
  let lastClick: { name: string; x: number; y: number } | null = null;
  const click = (name: string, what: string, button: MouseButton, count: 1 | 2 | 3): AssistantTool => ({
    name,
    description: `${what} at a point of the latest screenshot (or where the mouse is, without one).`,
    parameters: {
      type: "object",
      properties: { coordinate: POINT, text: MODIFIERS },
      additionalProperties: false,
    },
    risk: "safe",
    classify: button === "left" ? clickGuard : undefined,
    run: async (raw) => {
      const { coordinate, text } = raw as Input;
      const [x, y] = await pointOf(coordinate);
      const again =
        lastClick?.name === name &&
        Math.abs(lastClick.x - x) <= SAME_SPOT &&
        Math.abs(lastClick.y - y) <= SAME_SPOT;
      await input.click(x, y, { button, count, modifiers: mods(text) });
      const out = await after(`${what} at (${Math.round(x)}, ${Math.round(y)})`);
      lastClick = { name, x, y };
      return again ? { ...out, text: `${out.text} ${SAME_SPOT_HINT}` } : out;
    },
  });

  const tools: AssistantTool[] = [
    {
      name: "screenshot",
      description:
        "See the screen the task is on. Coordinates for every other screen tool are pixels of the latest screenshot.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      risk: "safe",
      readOnly: true,
      run: async () => {
        const shot = await capture.screenshot();
        return { text: describeShot(shot), image: image(shot) };
      },
    },
    {
      name: "zoom",
      description:
        "See part of the latest screenshot larger, to read small text. region is [x0, y0, x1, y1]; clicks still use the full screenshot's coordinates.",
      parameters: {
        type: "object",
        properties: { region: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 } },
        required: ["region"],
        additionalProperties: false,
      },
      risk: "safe",
      readOnly: true,
      run: async (raw) => {
        const shot = await capture.zoom((raw as Input).region as [number, number, number, number]);
        return { text: `Zoomed. ${describeShot(shot)}`, image: image(shot) };
      },
    },
    click("left_click", "Left-clicked", "left", 1),
    click("right_click", "Right-clicked", "right", 1),
    click("middle_click", "Middle-clicked", "middle", 1),
    click("double_click", "Double-clicked", "left", 2),
    click("triple_click", "Triple-clicked", "left", 3),
    {
      name: "left_click_drag",
      description: "Press the left button at start_coordinate, move to coordinate, release.",
      parameters: {
        type: "object",
        properties: { start_coordinate: POINT, coordinate: POINT },
        required: ["start_coordinate", "coordinate"],
        additionalProperties: false,
      },
      risk: "safe",
      // A drag is a press at the start and a release at the end; a release on a button is a click
      // on it, so both ends are judged (T9–T13 review, I1).
      classify: async (raw) => {
        const { start_coordinate, coordinate } = raw as Input;
        return (await clickGuard({ coordinate: start_coordinate })) ?? clickGuard({ coordinate });
      },
      run: async (raw) => {
        const { start_coordinate, coordinate } = raw as Required<
          Pick<Input, "start_coordinate" | "coordinate">
        >;
        await input.drag(start_coordinate, coordinate);
        return after(`Dragged from (${start_coordinate.join(", ")}) to (${coordinate.join(", ")})`);
      },
    },
    {
      name: "mouse_move",
      description: "Move the mouse to a point (hover) without clicking.",
      parameters: {
        type: "object",
        properties: { coordinate: POINT },
        required: ["coordinate"],
        additionalProperties: false,
      },
      risk: "safe",
      readOnly: true,
      run: async (raw) => {
        const [x, y] = (raw as Required<Pick<Input, "coordinate">>).coordinate;
        await input.move(x, y);
        return after(`Mouse moved to (${x}, ${y})`);
      },
    },
    {
      name: "left_mouse_down",
      description: "Press and keep holding the left button where the mouse is (for fine drags).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      risk: "safe",
      // Down then up is a click: judged like one, where the cursor is.
      classify: () => clickGuard({}),
      run: async () => {
        await input.mouseDown();
        return after("Left button down");
      },
    },
    {
      name: "left_mouse_up",
      description: "Release the left button.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      risk: "safe",
      run: async () => {
        await input.mouseUp();
        return after("Left button up");
      },
    },
    {
      name: "scroll",
      description:
        "Scroll at a point (or where the mouse is) by scroll_amount wheel notches. Scroll before deciding something is not there.",
      parameters: {
        type: "object",
        properties: {
          coordinate: POINT,
          scroll_direction: { type: "string", enum: ["up", "down", "left", "right"] },
          scroll_amount: { type: "number", minimum: 1 },
          text: MODIFIERS,
        },
        required: ["scroll_direction", "scroll_amount"],
        additionalProperties: false,
      },
      risk: "safe",
      run: async (raw) => {
        const { coordinate, scroll_direction, scroll_amount, text } = raw as Required<
          Pick<Input, "scroll_direction" | "scroll_amount">
        > &
          Input;
        await input.scroll(coordinate ?? null, scroll_direction, scroll_amount, mods(text));
        return after(`Scrolled ${scroll_direction} ${scroll_amount}`);
      },
    },
    {
      name: "type",
      description:
        "Type text where the keyboard focus is, in any language. A line break presses Enter, which sends in chat apps.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      risk: "safe",
      classify: (raw) => (/[\r\n]/.test((raw as Input).text ?? "") ? judgeEnter(deps) : undefined),
      run: async (raw) => {
        const { text = "" } = raw as Input;
        await input.type(text);
        return after(`Typed ${text.length} characters`);
      },
    },
    {
      name: "key",
      description:
        'Press a key or combination, e.g. "Return", "ctrl+s", "alt+Tab", "Page_Down", "super". repeat presses it that many times.',
      parameters: {
        type: "object",
        properties: { text: { type: "string" }, repeat: { type: "number", minimum: 1 } },
        required: ["text"],
        additionalProperties: false,
      },
      risk: "safe",
      classify: (raw) => judgeKey(deps, (raw as Input).text ?? ""),
      run: async (raw) => {
        const { text = "", repeat = 1 } = raw as Input;
        await input.key(text, repeat);
        return after(`Pressed ${text}${repeat > 1 ? ` x${repeat}` : ""}`);
      },
    },
    {
      name: "hold_key",
      description: "Hold a key or combination down for duration seconds, then release it.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" }, duration: { type: "number", minimum: 0, maximum: 30 } },
        required: ["text", "duration"],
        additionalProperties: false,
      },
      risk: "safe",
      classify: (raw) => judgeKey(deps, (raw as Input).text ?? ""),
      run: async (raw, signal) => {
        const { text = "", duration = 0 } = raw as Input;
        await input.holdKey(text, Math.min(duration, 30), signal);
        return after(`Held ${text} for ${duration} s`);
      },
    },
    {
      name: "wait",
      description: "Wait duration seconds for something to load, then see the screen.",
      parameters: {
        type: "object",
        properties: { duration: { type: "number", minimum: 0, maximum: 30 } },
        required: ["duration"],
        additionalProperties: false,
      },
      risk: "safe",
      readOnly: true,
      run: async (raw, signal) => {
        const ms = Math.min((raw as Input).duration ?? 1, 30) * 1000;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ms);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          });
        });
        return after(`Waited ${ms / 1000} s`);
      },
    },
    {
      name: "cursor_position",
      description: "Where the mouse is, in the latest screenshot's pixels.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      risk: "safe",
      readOnly: true,
      run: async () => {
        const [x, y] = await input.cursor();
        return { text: `The mouse is at (${x}, ${y}).` };
      },
    },
  ];
  // Everything that moves the mouse or presses keys waits for the user's own hands (design §5).
  // Any other tool in between (a scroll, a zoom, a key) makes the next click a fresh one.
  return tools.map((tool) => {
    const own = CLICKS.has(tool.name)
      ? tool
      : {
          ...tool,
          run: (raw: unknown, signal: AbortSignal) => {
            lastClick = null;
            return tool.run(raw, signal);
          },
        };
    return INPUT_TOOLS.has(tool.name) ? { ...own, usesInput: true } : own;
  });
}

/** Where a tool's input carries points: one point, a drag's start, a zoom's corners. */
const POINT_FIELDS = ["coordinate", "start_coordinate", "region"] as const;

/**
 * For a model that answers on a 0–`scale` grid instead of the screenshot's pixels: its points are
 * turned into pixels of the latest screenshot (`size`) before any tool, guard or executor sees
 * them, and the tools say which grid to use. Measured S-024 (three dots in a 1430x804 shot):
 * celeris-1 answered (87,137) for pixel (120,110), (903,203) for (1290,160), (493,863) for
 * (700,690) — 0–1000 on both axes, the Gemini / Qwen-VL convention — so every click landed scaled
 * ×0.7 on x and ×1.25 on y.
 */
export function onScale(tools: AssistantTool[], size: () => [number, number], scale = 1000): AssistantTool[] {
  const toPixels = (raw: unknown) => {
    const [width, height] = size();
    const input = { ...(raw as Record<string, unknown>) };
    for (const field of POINT_FIELDS) {
      const value = input[field];
      if (!Array.isArray(value)) continue;
      input[field] = value.map((n, i) => {
        if (typeof n !== "number") return n;
        const at = (n * (i % 2 === 0 ? width : height)) / scale;
        // A zoom's corners are edges. A point is a position, and the executor clicks the middle of
        // the pixel it is given, so it gets the pixel whose middle is that position — half a pixel
        // earlier, unrounded, so nothing is rounded twice on the way to the screen (capture.ts).
        return field === "region" ? Math.round(at) : Math.max(0, at - 0.5);
      });
    }
    return input;
  };
  return tools.map((tool) => {
    const props = (tool.parameters as { properties?: Record<string, unknown> }).properties ?? {};
    if (!POINT_FIELDS.some((field) => field in props)) return tool;
    return {
      ...tool,
      description: `${tool.description} Points are on a 0–${scale} grid over the screenshot: [0, 0] is its top-left corner, [${scale}, ${scale}] its bottom-right.`,
      ...(tool.classify ? { classify: (raw: unknown) => tool.classify?.(toPixels(raw)) } : {}),
      run: (raw, signal) => tool.run(toPixels(raw), signal),
    };
  });
}
