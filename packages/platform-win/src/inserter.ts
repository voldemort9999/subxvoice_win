import { SubxError, type TextInserter } from "@subx/core";
import { clipboard } from "electron";
import { restoreClipboardLater, snapshotClipboard } from "./clipboard";
import { sendChord, VK, waitForModifiersUp } from "./win32";

export interface InserterDeps {
  /**
   * Whether the focus takes typed text (system.ts, UI Automation): false only when it clearly does
   * not, null when that cannot be told.
   */
  focusTakesText?(): Promise<boolean | null>;
  /** Starts what the check needs, at key-down. */
  warm?(): void;
  /** How long the check may take before pasting as always. */
  checkMs?: number;
  /** The focused box's text, to see that the paste landed; null when it cannot be read. */
  readField?(): Promise<string | null>;
  /** How long to look for the words after pasting. */
  verifyMs?: number;
  /** Puts the text on the clipboard kept out of clipboard history (win32.ts); false: write it as usual. */
  writePrivate?(text: string): boolean;
}

/** A paste lands in tens of ms; a slow app gets this long before the words count as lost. */
const VERIFY_MS = 700;
const VERIFY_EVERY_MS = 100;
/** Whitespace as one space: a box can wrap lines or turn spaces into line breaks. */
const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLocaleLowerCase();

/** A warm check answers in tens of ms; past this, the paste goes ahead rather than keep the user waiting. */
const CHECK_MS = 300;

/**
 * Clipboard + Ctrl+V, with the user's clipboard put back afterwards.
 *
 * Cannot paste into windows running as administrator — Windows blocks synthetic input from a
 * lower-integrity process (UIPI), and there is no way around it short of elevating the whole app.
 */
export class WinInserter implements TextInserter {
  constructor(private readonly deps: InserterDeps = {}) {}

  prepare(): void {
    this.deps.warm?.();
  }

  async insert(text: string): Promise<"pasted" | "nowhere" | undefined> {
    if (!text) return;
    // Nothing that takes text has the focus (the desktop, a file list, a button): Ctrl+V would land
    // nowhere. The clipboard is the user's, so it is not touched; the pill offers Copy instead (the
    // Mac app's rule; user, 2026-11-21). Unsure, slow or failed: paste as always.
    if ((await this.focusTakesText()) === false) return "nowhere";

    // Electron's clipboard is promise-based since v44, so both of these must be awaited —
    // pasting before the write lands would paste whatever was there before. The snapshot keeps
    // every format, so an image the user had copied survives the paste.
    const previous = await snapshotClipboard();
    // Kept out of Windows' clipboard history and cloud clipboard (the Mac app's transient mark,
    // fbeacae); if the clipboard was busy, the usual write.
    if (!this.deps.writePrivate?.(text)) await clipboard.writeText(text);

    // The user is usually still letting go of the hotkey; pasting now would send Win+V.
    await waitForModifiersUp();
    if (!sendChord([VK.control], VK.v)) {
      throw new SubxError("provider", "Windows refused the paste (is the target app elevated?)");
    }

    restoreClipboardLater(previous, text);
    // Where the box can be read back, the words must be in it; if they never arrive (a box that
    // looked right but took nothing, a window that swallowed the keys), the pill offers Copy.
    return (await this.landed(text)) === false ? "nowhere" : "pasted";
  }

  /** True when the words are in the focused box, false when it can be read and they never came. */
  private async landed(text: string): Promise<boolean | null> {
    if (!this.deps.readField) return null;
    const wanted = squash(text).slice(0, 40);
    const deadline = Date.now() + (this.deps.verifyMs ?? VERIFY_MS);
    for (;;) {
      const field = await this.deps.readField().catch(() => null);
      if (field === null) return null;
      if (squash(field).includes(wanted)) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, VERIFY_EVERY_MS));
    }
  }

  private async focusTakesText(): Promise<boolean | null> {
    if (!this.deps.focusTakesText) return null;
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), this.deps.checkMs ?? CHECK_MS);
    });
    try {
      return await Promise.race([this.deps.focusTakesText().catch(() => null), late]);
    } finally {
      clearTimeout(timer);
    }
  }
}
