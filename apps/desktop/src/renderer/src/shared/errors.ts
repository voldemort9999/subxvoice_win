import { plainWords } from "../../../shared/plain-words";

/**
 * An error as a person should read it. The main process already words its errors for people;
 * Electron wraps each one that crosses IPC in "Error invoking remote method '…': Error: ", which is
 * removed here so it never reaches the screen.
 */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const clean = message.replace(/^Error invoking remote method '[^']+': /, "").replace(/^(\w*Error):\s*/, "");
  // Anything not written for people (a code, an internal name, a system error) never reaches the
  // screen: shared/plain-words.ts.
  return plainWords(clean, "Something went wrong. Try again.");
}
