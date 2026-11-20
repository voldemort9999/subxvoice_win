import type { ScreenAction, ScreenDriver, ScreenElement } from "@subx/core";
import { say } from "../lang";
import type { AssistantTool } from "../tool";
import { trimTree } from "../trim";
import { RISKY } from "./screen";

/**
 * The `ui` tool (design §2): a window's UI Automation tree as numbered elements, and acting on one
 * by id — through UIA patterns where the app offers them (no mouse, works behind other windows),
 * else a real click. Reuses the old pipeline's walker (`WinScreenDriver`: depth-first, off-screen
 * subtrees pruned, Chromium re-read, typing by select-all + paste + read-back).
 *
 * Bounds come in the latest screenshot's pixels, so the model can line a tree element up with what
 * it sees and click it by pixel when the tree's own action does nothing.
 */

export interface UiToolDeps {
  driver: ScreenDriver;
  /** Physical → latest screenshot pixels; throws before the first screenshot. */
  toShot?: (x: number, y: number) => [number, number];
}

type Action = "read" | "click" | "type" | ScreenAction;
interface Input {
  action: Action;
  window?: string;
  id?: number;
  text?: string;
  filter?: string;
}

const PATTERN_ACTIONS = new Set<Action>(["invoke", "select", "expand", "scroll_into_view"]);

export function uiTool(deps: UiToolDeps): AssistantTool {
  /** The last read's elements by id: what the guard checks a press against. */
  let last = new Map<number, ScreenElement>();

  const box = (element: ScreenElement): string => {
    if (!element.bounds || !deps.toShot) return "";
    try {
      const [x0, y0] = deps.toShot(element.bounds[0], element.bounds[1]);
      const [x1, y1] = deps.toShot(element.bounds[2], element.bounds[3]);
      return ` [${[x0, y0, x1, y1].map(Math.round).join(",")}]`;
    } catch {
      return ""; // no screenshot yet: pixel positions would mean nothing to the model
    }
  };
  const line = (e: ScreenElement) =>
    `e${e.id} ${e.role} "${e.name}"` +
    (e.value ? ` = "${e.value}"` : "") +
    (e.editable ? " editable" : "") +
    (e.where && !e.name ? ` at the ${e.where}` : "") +
    (e.focused ? " (focused)" : "") +
    box(e);
  const named = (id?: number) => {
    const element = id === undefined ? undefined : last.get(id);
    return element ? `e${element.id} ${element.role} "${element.name}"` : `e${id}`;
  };

  return {
    name: "ui",
    description:
      'An app\'s UI tree. action "read" lists the window\'s elements as e<id> lines (role, name, value, [x0,y0,x1,y1] in the coordinates the screen tools take); window names the app ("WhatsApp"), else the window in front; filter keeps matching lines. Then act by id: "invoke" (press a button or link without the mouse), "click" (a real click in its middle), "type" (replaces the box\'s text with text; never presses Enter), "select", "expand", "scroll_into_view". Ids are valid until the next read.',
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["read", "invoke", "click", "type", "select", "expand", "scroll_into_view"],
        },
        window: { type: "string" },
        id: { type: "number" },
        text: { type: "string" },
        filter: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    risk: "safe",
    // A real click and typing (focus, select-all, paste) use the mouse and keys; patterns do not.
    usesInput: (raw) => ["click", "type"].includes((raw as Input).action),
    classify: (raw) => {
      const { action, id } = raw as Input;
      if (action === "read" || action === "type" || action === "scroll_into_view" || id === undefined)
        return undefined;
      const element = last.get(id);
      if (element && RISKY.test(element.name))
        return {
          kind: "ask",
          what: say().press(element.name),
          why: say().risky,
        };
      return undefined;
    },
    run: async (raw) => {
      const { action, window = "", id, text = "", filter } = raw as Input;
      if (action === "read") {
        const snapshot = await deps.driver.read(window);
        last = new Map(snapshot.elements.map((e) => [e.id, e]));
        const wanted = filter?.toLowerCase();
        const lines = snapshot.elements
          .filter((e) => !wanted || `${e.role} ${e.name} ${e.value ?? ""}`.toLowerCase().includes(wanted))
          .map(line);
        return { text: trimTree(`Window "${snapshot.window}":\n${lines.join("\n")}\n`) };
      }
      if (id === undefined) throw new Error(`"${action}" needs the id of an element from the last read`);
      if (action === "click") await deps.driver.click(id);
      else if (action === "type") await deps.driver.typeInto(id, text);
      else if (PATTERN_ACTIONS.has(action)) {
        if (!deps.driver.act) throw new Error(`"${action}" is not available on this screen`);
        await deps.driver.act(id, action as ScreenAction);
      } else throw new Error(`Unknown ui action "${action}"`);
      return {
        text: `Done: ${action} on ${named(id)}${action === "type" ? ` — it now shows "${text}"` : ""}.`,
      };
    },
  };
}
