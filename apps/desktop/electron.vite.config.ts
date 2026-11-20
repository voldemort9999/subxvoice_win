import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

/**
 * `--mode demo` (pnpm dist:demo, plan D1) bakes the developer's keys into the main bundle — see
 * src/main/demo.ts. Any other build gets null, and release.mjs always builds without the mode.
 */
function demoKeys(mode: string): { celeris: string; bedrock: string } | null {
  if (mode !== "demo") return null;
  const read = (file: string) => {
    const value = readFileSync(resolve(__dirname, "../../reference/secrets", file), "utf8").trim();
    if (!value) throw new Error(`reference/secrets/${file} is empty`);
    return value;
  };
  // Follow My Words' models only; dictation's keys live on the server (Mac UI port, 2026-11-19).
  return { celeris: read("celeris.key"), bedrock: read("bedrock.key") };
}

export default defineConfig(({ mode }) => ({
  main: {
    define: { __SUBX_DEMO_KEYS__: JSON.stringify(demoKeys(mode)) },
    build: {
      rollupOptions: {
        // koffi is a native module: it has to stay a real require() at runtime.
        external: ["koffi"],
      },
    },
  },
  preload: {},
  renderer: {
    plugins: [react(), tailwindcss()],
    // The Mac UI's platform-specific pieces (window chrome, key and permission notes): ours are
    // Windows' (Mac UI port, 2026-11-19).
    resolve: {
      alias: {
        "@platform": resolve(__dirname, "src/renderer/src/platform/win"),
      },
    },
    build: {
      rollupOptions: {
        // Main window and the always-on-screen recording pill.
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
          pill: resolve(__dirname, "src/renderer/pill.html"),
        },
      },
    },
  },
}));
