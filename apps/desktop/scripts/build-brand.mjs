// Writes every logo file in `brand/` (repo root) from the same definition the app draws
// (`src/shared/mark.ts`): SVGs, PNGs at the usual sizes, the macOS .icns and a favicon.ico.
// Run it again whenever the mark changes; nothing in `brand/` is edited by hand.
//
//   node apps/desktop/scripts/build-brand.mjs
//
// PNGs are rendered by headless Chrome (with a throwaway profile), because the wordmark has
// type in it and a browser is the one renderer that draws SVG, fonts and all, exactly.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ALONE, HEX, lineEnds, markSvg, motionSvg, wavePoints } from "../src/shared/mark.ts";

const desktop = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(desktop, "..", "..", "brand");
// Chrome on a Mac, or Chrome / Edge on Windows (both are Chromium and take the same flags).
const CHROME =
  [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].find((path) => existsSync(path)) ?? "";

const dirs = { svg: join(out, "svg"), png: join(out, "png"), app: join(out, "app-icon") };
for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });

// ---- SVG ------------------------------------------------------------------------------------

const svgs = {
  "subx-icon": markSvg({ plate: true }),
  "subx-mark": markSvg({ plate: false }),
  "subx-motion": motionSvg({ plate: true, animated: true }),
  "subx-motion-static": motionSvg({ plate: true, animated: false }),
  "subx-motion-transparent": motionSvg({ plate: false, animated: true }),
};

// The wordmark: SUB, the mark as the X, Voice. The type is embedded, so the file looks the same on
// any machine. Dark grounds only: the logo is always the black-theme one.
const require = createRequire(import.meta.url);
const fontFile = require.resolve(
  "@fontsource-variable/funnel-display/files/funnel-display-latin-wght-normal.woff2",
  {
    paths: [desktop],
  },
);
const font = readFileSync(fontFile).toString("base64");
function wordmark(ink, line) {
  const W = 2000;
  const H = 400;
  const size = 300; // the X is drawn this big, sitting where a capital X would
  const xLeft = 690;
  const top = (H - size) / 2;
  const [[x1, y1], [x2, y2]] = lineEnds(ALONE);
  const p = (x, y) => `${(xLeft + x * size).toFixed(1)} ${(top + y * size).toFixed(1)}`;
  const d = wavePoints(ALONE)
    .map(([x, y], i) => `${i ? "L" : "M"}${p(x, y)}`)
    .join(" ");
  const stroke = (ALONE.stroke * size).toFixed(1);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="SUBXVoice">
<title>SUBXVoice</title>
<defs><style>@font-face{font-family:"Funnel Display";src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:300 800}</style></defs>
<text x="${xLeft - 18}" y="${H / 2 + 104}" text-anchor="end" font-family="Funnel Display" font-weight="800" font-size="300" fill="${ink}">SUB</text>
<line x1="${p(x1, y1).split(" ")[0]}" y1="${p(x1, y1).split(" ")[1]}" x2="${p(x2, y2).split(" ")[0]}" y2="${p(x2, y2).split(" ")[1]}" stroke="${line}" stroke-width="${stroke}" stroke-linecap="round"/>
<path d="${d}" fill="none" stroke="${HEX.blue}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
<text x="${xLeft + size + 34}" y="${H / 2 + 104}" font-family="Funnel Display" font-weight="400" font-size="300" fill="${ink}">Voice</text>
</svg>`;
}
svgs["subx-wordmark-on-dark"] = wordmark(HEX.cream, HEX.cream);

for (const [name, svg] of Object.entries(svgs)) writeFileSync(join(dirs.svg, `${name}.svg`), `${svg}\n`);

// ---- PNG ------------------------------------------------------------------------------------

if (!existsSync(CHROME)) {
  console.log(`SVGs written to ${dirs.svg}. Neither Chrome nor Edge found, so no PNGs this time.`);
  process.exit(0);
}
const profile = mkdtempSync(join(tmpdir(), "subx-brand-"));

/** One PNG of an SVG at width × height, on a transparent ground. */
function png(svgName, file, width, height = width) {
  const html = join(profile, "page.html");
  writeFileSync(
    html,
    `<html><body style="margin:0;background:transparent"><img src="${pathToFileURL(join(dirs.svg, `${svgName}.svg`))}" width="${width}" height="${height}" style="display:block"></body></html>`,
  );
  execFileSync(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--default-background-color=00000000",
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      `--screenshot=${file}`,
      pathToFileURL(html).href,
    ],
    { stdio: "ignore" },
  );
}

const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
for (const size of sizes) png("subx-icon", join(dirs.png, `subx-icon-${size}.png`), size);
for (const size of [64, 128, 256, 512, 1024]) png("subx-mark", join(dirs.png, `subx-mark-${size}.png`), size);
for (const size of [256, 512, 1024])
  png("subx-motion-static", join(dirs.png, `subx-motion-${size}.png`), size);
for (const height of [100, 200, 400]) {
  const width = Math.round((height * 2000) / 400);
  png("subx-wordmark-on-dark", join(dirs.png, `subx-wordmark-on-dark-${height}.png`), width, height);
}

// ---- macOS .icns and favicon.ico ------------------------------------------------------------

const iconset = join(profile, "SUBXVoice.iconset");
mkdirSync(iconset);
for (const [name, size] of [
  ["16x16", 16],
  ["16x16@2x", 32],
  ["32x32", 32],
  ["32x32@2x", 64],
  ["128x128", 128],
  ["128x128@2x", 256],
  ["256x256", 256],
  ["256x256@2x", 512],
  ["512x512", 512],
  ["512x512@2x", 1024],
]) {
  writeFileSync(join(iconset, `icon_${name}.png`), readFileSync(join(dirs.png, `subx-icon-${size}.png`)));
}
// iconutil is macOS's own; elsewhere the .icns is left as it was.
if (process.platform === "darwin")
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(dirs.app, "SUBXVoice.icns")]);

// An .ico is a small header and a directory pointing at whole PNG files, which every browser reads.
const icoSizes = [16, 32, 48];
const images = icoSizes.map((size) => readFileSync(join(dirs.png, `subx-icon-${size}.png`)));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((image, i) => {
  const at = 6 + 16 * i;
  header.writeUInt8(icoSizes[i], at);
  header.writeUInt8(icoSizes[i], at + 1);
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(image.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += image.length;
});
writeFileSync(join(dirs.app, "favicon.ico"), Buffer.concat([header, ...images]));
writeFileSync(join(dirs.app, "icon-1024.png"), readFileSync(join(dirs.png, "subx-icon-1024.png")));

rmSync(profile, { recursive: true, force: true });
const count = (dir) => readdirSync(dir).length;
console.log(
  `brand → ${out}: ${count(dirs.svg)} SVG, ${count(dirs.png)} PNG, ${count(dirs.app)} app-icon files`,
);
