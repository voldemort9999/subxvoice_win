// Puts the app icon where electron-builder looks (build/icon.png), which it turns into the .ico
// Windows needs. The icon is the brand folder's (the friend's new logo, generated there from
// src/shared/mark.ts by scripts/build-brand.mjs — Mac UI port, 2026-11-19), so nothing is redrawn here.

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(desktop, "..", "..", "brand", "app-icon", "icon-1024.png");
mkdirSync(join(desktop, "build"), { recursive: true });
copyFileSync(source, join(desktop, "build", "icon.png"));
console.log("build/icon.png ← brand/app-icon/icon-1024.png");
