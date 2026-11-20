import type { ScreenCapture, ScreenDriver, ScreenInput, ScreenProbe } from "@subx/core";
import { describe, expect, it } from "vitest";
import { screenTools } from "./screen";
import { uiTool } from "./ui";

/** Design §5: only what moves the mouse or presses keys waits for the user's own hands. */
describe("which tools wait for the user's hands", () => {
  it("marks the screen tools that inject input, and not the ones that only look", () => {
    const tools = screenTools({
      capture: {} as ScreenCapture,
      input: {} as ScreenInput,
      probe: {} as ScreenProbe,
    });
    const waits = tools.filter((t) => t.usesInput === true).map((t) => t.name);
    expect(waits).toContain("left_click");
    expect(waits).toContain("type");
    expect(waits).toContain("scroll");
    expect(waits).not.toContain("screenshot");
    expect(waits).not.toContain("zoom");
    expect(waits).not.toContain("wait");
    expect(waits).not.toContain("cursor_position");
  });

  it("holds the ui tool's real click and typing, not its patterns or reads", () => {
    const ui = uiTool({ driver: {} as ScreenDriver });
    const uses = ui.usesInput as (input: unknown) => boolean;
    expect(uses({ action: "click", id: 1 })).toBe(true);
    expect(uses({ action: "type", id: 1, text: "x" })).toBe(true);
    expect(uses({ action: "invoke", id: 1 })).toBe(false);
    expect(uses({ action: "read" })).toBe(false);
  });
});
