import type { Platform } from "@subx/core";
import { describe, expect, it, vi } from "vitest";

const opened: string[] = [];
vi.mock("electron", () => ({ shell: { openExternal: async (url: string) => void opened.push(url) } }));

const { createWinPlatform } = await import("./index");

describe("createWinPlatform meets the shared Platform contract (Mac UI port, 2026-11-19)", () => {
  it("is a Windows platform with the Mac app's desktop actions and the assistant's screen parts", async () => {
    const platform: Platform = createWinPlatform();
    expect(platform.os).toBe("win");
    expect(platform.screenControl).toBeDefined();
    expect(platform.commands).toBeDefined();
    await platform.desktop.openUrl("https://example.com/");
    expect(opened).toEqual(["https://example.com/"]);
    expect(platform.desktop.openApp).toBeTypeOf("function");
  });
});
