import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inspect } from "node:util";
import { app } from "electron";

/**
 * The demo build (plan D1, `pnpm dist:demo`): electron.vite.config.ts bakes the developer's Celeris
 * and Bedrock keys in, so Follow My Words and rewriting run without the backend, whose OpenRouter
 * credits are gone. This breaks AGENTS.md rule 3 on purpose and only here — the user allowed it for
 * an installer handed out by hand for a demo, never released (2026-11-19). The demo is its own app
 * (electron-builder.demo.yml) with the updater off, so it never touches the released 0.4.3.
 * Every other build, tests included, sees null.
 */
declare const __SUBX_DEMO_KEYS__: { celeris: string; bedrock: string } | null | undefined;
export const DEMO_KEYS = typeof __SUBX_DEMO_KEYS__ === "undefined" ? null : __SUBX_DEMO_KEYS__;

/** The released app: no keys inside, models through the backend, updates from the releases repo. */
export const viaBackend = (): boolean => app.isPackaged && !DEMO_KEYS;

/**
 * Follow My Words' model keys (dictation needs none: the server holds its own). Development: the
 * developer's own, from the gitignored reference/secrets/ (context/WORKING.md); the demo build:
 * baked in; the released app: none — there the backend does.
 */
export function loadAssistantKeys(): void {
  if (app.isPackaged) {
    if (DEMO_KEYS) {
      process.env.CELERIS_API_KEY = DEMO_KEYS.celeris;
      process.env.AWS_BEARER_TOKEN_BEDROCK = DEMO_KEYS.bedrock;
      process.env.AWS_REGION ??= "us-east-1";
    }
    return;
  }
  const dir = join(app.getAppPath(), "../../reference/secrets");
  for (const [file, name] of [
    ["bedrock.key", "AWS_BEARER_TOKEN_BEDROCK"],
    ["celeris.key", "CELERIS_API_KEY"],
  ] as const) {
    if (process.env[name]) continue;
    try {
      const value = readFileSync(join(dir, file), "utf8").trim();
      if (value) process.env[name] = value;
    } catch {
      console.warn(`[dev] reference/secrets/${file} not found`);
    }
  }
  process.env.AWS_REGION ??= "us-east-1";
}

/**
 * The demo's console goes to `<userData>/main.log` as well: an installed app's stdout goes nowhere,
 * so the first demo hand test left no tool trace to find its failures in (2026-11-19).
 */
export function logDemoToFile(): void {
  if (!DEMO_KEYS || !app.isPackaged) return;
  const file = join(app.getPath("userData"), "main.log");
  const write = (level: string, parts: unknown[]) => {
    const line = parts.map((p) => (typeof p === "string" ? p : inspect(p))).join(" ");
    try {
      appendFileSync(file, `${new Date().toISOString()} ${level}${line}\n`);
    } catch {
      // A full disk must not take the app down with it.
    }
  };
  for (const [name, level] of [
    ["log", ""],
    ["warn", "WARN "],
    ["error", "ERROR "],
  ] as const) {
    const original = console[name].bind(console);
    console[name] = (...parts: unknown[]) => {
      original(...parts);
      write(level, parts);
    };
  }
}
