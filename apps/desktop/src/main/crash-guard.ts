// Without a handler, an error nothing caught in the main process makes Electron show its own dialog:
// "A JavaScript error occurred in the main process" with the stack, file paths and all. That is
// internal text on screen (2026-11-20: a log line written after the terminal that started the app
// had closed, EPIPE). Here such an error is logged and the app goes on.

import type { Writable } from "node:stream";

/** Where the console writes can close under the app (a closed terminal or pipe); that is not an error. */
function ignoreClosedOutput(stream: Writable): void {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") logQuietly("output error", error);
  });
}

/** Logs without risking a second error when the log itself cannot be written. */
function logQuietly(label: string, error: unknown): void {
  try {
    console.error(`${label}:`, error);
  } catch {
    // The log is gone too; nothing more can be done, and nothing should reach the screen.
  }
}

export function guardAgainstCrashDialogs(): void {
  ignoreClosedOutput(process.stdout);
  ignoreClosedOutput(process.stderr);
  process.on("uncaughtException", (error) => {
    if ((error as NodeJS.ErrnoException).code === "EPIPE") return;
    logQuietly("uncaught error", error);
  });
  process.on("unhandledRejection", (reason) => logQuietly("unhandled rejection", reason));
}
