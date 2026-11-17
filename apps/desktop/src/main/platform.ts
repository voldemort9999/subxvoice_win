import type { Platform } from "@subx/core";
import { createWinPlatform } from "@subx/platform-win";

/** The Windows plug. Everything else in the app only sees the `Platform` interface. */
export function createPlatform(): Platform {
  return createWinPlatform();
}
