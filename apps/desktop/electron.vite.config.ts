import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
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
});
