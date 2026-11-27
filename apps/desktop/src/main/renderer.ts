import { join } from "node:path";
import { app, type BrowserWindow } from "electron";

export const PRELOAD_PATH = join(__dirname, "../preload/index.js");

/**
 * Loads a renderer page from the Vite dev server in development, or from disk in a build. The
 * installed app never reads the address from the environment: it did once, so any program that
 * launched it could load its own page into our window, with the preload bridge (found unpacking
 * the published 0.0.1, 2026-11-19).
 */
export function loadPage(
  window: BrowserWindow,
  page: "index.html" | "pill.html",
  query: Record<string, string> = {},
): void {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const search = new URLSearchParams(query).toString();
    window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}${search ? `?${search}` : ""}`);
  } else {
    window.loadFile(join(__dirname, "../renderer", page), { query });
  }
}
