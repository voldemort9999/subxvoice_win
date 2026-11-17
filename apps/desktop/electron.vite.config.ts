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
