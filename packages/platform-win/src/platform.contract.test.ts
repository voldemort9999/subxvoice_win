import type { Platform } from "@subx/core";
import { describe, expect, it, vi } from "vitest";

const opened: string[] = [];
vi.mock("electron", () => ({ shell: { openExternal: async (url: string) => void opened.push(url) } }));

const { createWinPlatform } = await import("./index");

describe("createWinPlatform meets the shared Platform contract (the Mac app's)", () => {
  it("is a Windows platform with the dictation parts and the desktop actions", async () => {
    const platform: Platform = createWinPlatform();
    expect(platform.os).toBe("win");
    expect(platform.field).toBeDefined();
    expect(platform.feedback).toBeDefined();
    await platform.desktop.openUrl("https://example.com/");
    expect(opened).toEqual(["https://example.com/"]);
    expect(platform.desktop.openApp).toBeTypeOf("function");
  });
});
