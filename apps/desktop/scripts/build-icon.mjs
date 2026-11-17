// Writes build/icon.png from the same mark the running app draws. electron-builder turns that
// PNG into the .ico Windows needs, so there is no binary icon checked into the repo and nothing to redraw by hand when the logo changes.
//
// PNG is written with zlib alone — an icon is not worth a dependency.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { rasterizeMark } from "../src/shared/mark.ts";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** electron-builder wants at least 512x512 to generate every size an installer asks for. */
const SIZE = 512;

function chunk(type, body) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length, 0);
  header.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), body])), 0);
  return Buffer.concat([header, body, crc]);
}

function png(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // Each scanline is prefixed with its filter byte; 0 means "store as-is".
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const out = join(root, "build", "icon.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png(Buffer.from(rasterizeMark(SIZE).buffer), SIZE));
console.log(`icon → ${out} (${SIZE}x${SIZE})`);
