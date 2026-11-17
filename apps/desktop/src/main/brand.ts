import { nativeImage } from "electron";
import { rasterizeMark } from "../shared/mark";

/**
 * The app mark, as an Electron image. The geometry lives in `shared/mark.ts` so the installer's
 * icon is generated from the same definition — see `scripts/build-icon.mjs`.
 */
export function brandIcon(size: number) {
  // Wrapped, not copied, so the swizzle below can use Buffer's bounds-checked accessors.
  const rgba = Buffer.from(rasterizeMark(size).buffer);
  // createFromBitmap reads BGRA, so red and blue swap places.
  for (let i = 0; i < rgba.length; i += 4) {
    const red = rgba.readUInt8(i);
    rgba.writeUInt8(rgba.readUInt8(i + 2), i);
    rgba.writeUInt8(red, i + 2);
  }
  return nativeImage.createFromBitmap(rgba, { width: size, height: size, scaleFactor: 1 });
}

/** Taskbar, Alt-Tab and the window's own corner. */
export const appIcon = () => brandIcon(256);
