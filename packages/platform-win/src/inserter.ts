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
  /** The cursor's place in the focused box, in characters; null when it cannot be read. */
  caret?(): Promise<number | null>;
  /** How long the app gets to take a paste back before the cursor is read again. */
  undoMs?: number;
}

/** Long enough for an app to take the paste back before it is checked (the Mac waits 150 ms). */
const UNDO_MS = 150;

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
  /** What the last paste put in, for a snippet's swap. */
  private lastPasted = "";

  constructor(private readonly deps: InserterDeps = {}) {}

  /**
   * Takes back the paste just made (Ctrl+Z in the app it went to) and puts `text` in its place: a
   * snippet the person chose after the words went in as said. Only where the cursor can be read and
   * Ctrl+Z moved it back by exactly what was pasted: in an app where Ctrl+Z does nothing (a terminal)
   * the snippet would go in beside the words, and where it took back more than the paste, the
   * person's own typing (then Ctrl+Y puts it back). Otherwise false, and nothing is changed.
   * Ported from the Mac's Inserter.replaceLast (c8eec41).
   */
  async replaceLast(text: string): Promise<boolean> {
    const pasted = this.lastPasted.length;
    const before = pasted > 0 ? await this.deps.caret?.().catch(() => null) : null;
    if (before === null || before === undefined) return false;
    await waitForModifiersUp();
    if (!sendChord([VK.control], VK.z)) return false;
    await new Promise((resolve) => setTimeout(resolve, this.deps.undoMs ?? UNDO_MS));
    const after = await this.deps.caret?.().catch(() => null);
    if (after === null || after === undefined || before - after !== pasted) {
      if (after !== null && after !== undefined && after !== before) sendChord([VK.control], VK.y);
      return false;
    }
    return (await this.insert(text)) === "pasted";
  }

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
    this.lastPasted = text;
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
