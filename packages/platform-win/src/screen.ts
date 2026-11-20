import type {
  OcrLine,
  Rect,
  ScreenAction,
  ScreenDriver,
  ScreenElement,
  ScreenLook,
  ScreenSnapshot,
  Shot,
  TextInserter,
} from "@subx/core";
import type { WindowInfo } from "./commands";
import { asOwnInput } from "./own-input";
import type { PowerShellWorker } from "./powershell";
import { sendChord, VK, waitForModifiersUp } from "./win32";

/**
 * The screen through UI Automation (CmdUia in interop.ts), on the same PowerShell worker as the
 * rest of command mode. Works on any screen: elements carry their own coordinates, and both of the
 * dev machine's monitors were read the same way.
 */

/** A page that has just been clicked into is still loading; the next step reads it after this. */
const SETTLE_MS = 900;

/**
 * Chromium turns its page's accessibility on only once something asks: the first read of a Chrome
 * window returned its tab strip and toolbar alone (39 elements), the second the whole YouTube page.
 */
export const BROWSERS = new Set(["chrome", "msedge", "brave", "opera", "vivaldi"]);
const BARE_BROWSER = 60;

/** Words in a window's title that say nothing about which window a step means. */
/**
 * Words that say nothing about which window a step means — including the step's own verbs and
 * nouns: "Type Aarnav into WhatsApp's search box" once matched a Chrome window titled "weather
 * report - Google Search" on "search", tied with WhatsApp, and the topmost (Chrome) won.
 */
const GENERIC = new Set([
  "google",
  "the",
  "and",
  "app",
  "window",
  "new",
  "tab",
  "microsoft",
  "windows",
  "search",
  "box",
  "type",
  "into",
  "click",
  "open",
  "result",
  "results",
  "message",
  "chat",
  "button",
  "video",
  "page",
  "play",
  "with",
  "from",
  "this",
  "that",
]);

/** An app just launched for a step gets this long to show a window with something in it. */
const LAUNCH_MS = 8000;

export interface ScreenDeps {
  windows(): Promise<WindowInfo[]>;
  inserter: TextInserter;
  /**
   * Starts the installed app a step names, when no window of it is open. True when one was started.
   * "Aryan ko hi bhejo" with WhatsApp closed used to stop at a search box that was not there.
   */
  launchNamed(hint: string): Promise<boolean>;
  /** Pictures for `ScreenSnapshot.look`; without it a snapshot has none. Its own instance, so the assistant's frame is untouched. */
  capture?: { ofWindow(handle: number): Promise<Shot> };
  /** A real click at a physical point; without it, text read off the pixels is not offered as a target. */
  clickAt?(x: number, y: number): Promise<void>;
  /** Ctrl+A and the wait for the user's modifiers; tests replace the real keyboard. */
  keys?: { selectAll(): void; modifiersUp(): Promise<unknown> };
}

const REAL_KEYS = {
  selectAll: () => void sendChord([VK.control], 0x41),
  modifiersUp: () => waitForModifiersUp(),
};

/** How long typed text is given to show in the box's value; WebView2 apps report it late. */
const READ_BACK_MS = 2500;
const READ_STEP_MS = 250;
/** A window just brought to the front takes the click into its box only after it has settled. */
const FRONT_SETTLE_MS = 200;

/** Fewer named elements than this, and the tree is not the whole window: its text is read off the pixels. */
const THIN_TREE = 10;

export class WinScreenDriver implements ScreenDriver {
  private window: WindowInfo | null = null;
  private elements: ScreenElement[] = [];

  /** Present only when the deps can click a point (ScreenDriver.clickAt). */
  readonly clickAt?: (x: number, y: number) => Promise<void>;

  constructor(
    private readonly worker: PowerShellWorker,
    private readonly deps: ScreenDeps,
  ) {
    const click = deps.clickAt;
    if (click)
      this.clickAt = async (x, y) => {
        if (this.window) await this.worker.run(`[CmdWindows]::Focus(${this.window.handle})`);
        await asOwnInput(() => click(x, y));
        await sleep(SETTLE_MS);
      };
  }

  async read(hint: string): Promise<ScreenSnapshot> {
    let { window: target, named } = chooseWindow(hint, await this.deps.windows());
    if (!named && (await this.deps.launchNamed(hint))) {
      // Launched for this step: wait for its window, then give it a moment to fill in.
      const deadline = Date.now() + LAUNCH_MS;
      while (Date.now() < deadline) {
        await sleep(400);
        ({ window: target, named } = chooseWindow(hint, await this.deps.windows()));
        if (named) break;
      }
      await sleep(1500);
    }
    if (!target) throw new Error("There is no window to look at");
    // A step that names its place acts there or nowhere. "Click the 1st result in YouTube" with no
    // YouTube open once fell back to the Chrome tab in front and picked an ad on another page.
    const place = namedPlace(hint);
    if (!named && place) throw new Error(`${place} isn't open`);
    // A minimized window has nothing on screen to read; one behind others is brought forward so
    // the user sees what is being done in it.
    if (!target.foreground) {
      await this.worker.run(`[CmdWindows]::Focus(${target.handle})`);
      await sleep(target.state === "minimized" ? 500 : 150);
    }
    let elements = await this.readTree(target);
    // A browser page still loading — results just searched for — shows only the toolbar for a
    // moment; "click the 1st result" right after a search must wait for the results to arrive.
    for (
      let tries = 0;
      BROWSERS.has(target.program.toLowerCase()) && elements.length < BARE_BROWSER && tries < 5;
      tries++
    ) {
      await sleep(700);
      elements = await this.readTree(target);
    }
    this.window = target;
    this.elements = elements;
    const { capture } = this.deps;
    const window = target;
    return {
      window: target.title,
      elements,
      ...(capture ? { look: () => this.look(capture, window, elements) } : {}),
    };
  }

  /**
   * The picture, and OCR over the unnamed elements' area only — one call for all of them, and
   * none when the tree named everything. OCR is a help, not a need: a failed read gives no text.
   */
  private async look(
    capture: NonNullable<ScreenDeps["capture"]>,
    window: WindowInfo,
    elements: ScreenElement[],
  ): Promise<ScreenLook> {
    const shot = await capture.ofWindow(window.handle);
    const ocr = (x: number, y: number, width: number, height: number) =>
      this.worker.json<OcrLine[]>(`Invoke-SubxOcr ${x} ${y} ${width} ${height}`).catch(() => []);
    // A thin tree (BlueStacks' instance list is four elements) leaves the window's real content
    // to the pixels: read the whole window, so its rows can be offered and clicked (S-024).
    const named = elements.filter((element) => element.name.trim()).length;
    if (named < THIN_TREE && this.clickAt) {
      const area = await this.worker
        .json<Rect>(`[CmdCapture]::WindowRect(${window.handle})`)
        .catch(() => null);
      if (area) return { shot, text: await ocr(area.x, area.y, area.width, area.height) };
    }
    const unnamed = elements.flatMap((element) =>
      !element.name.trim() && element.bounds ? [element.bounds] : [],
    );
    if (!unnamed.length) return { shot, text: [] };
    const left = Math.min(...unnamed.map((b) => b[0]));
    const top = Math.min(...unnamed.map((b) => b[1]));
    const right = Math.max(...unnamed.map((b) => b[2]));
    const bottom = Math.max(...unnamed.map((b) => b[3]));
    return { shot, text: await ocr(left, top, right - left, bottom - top) };
  }

  // CmdUia clicks with the real mouse from PowerShell: that is the app's input, not the user's.
  async click(id: number): Promise<void> {
    await asOwnInput(() => this.worker.run(`${this.front()}[CmdUia]::Click(${id})`));
    await sleep(SETTLE_MS);
  }

  /** Through a UIA pattern (CmdUia.Act); the window still comes forward, so the user sees it. */
  async act(id: number, action: ScreenAction): Promise<void> {
    await asOwnInput(() => this.worker.run(`${this.front()}[CmdUia]::Act(${id}, '${action}')`));
    await sleep(SETTLE_MS);
  }

  /**
   * Replaces what the box holds rather than adding to it: a search box still holding the last
   * search, or a message box holding an unsent draft, got the new words stuck onto the old
   * ("hiHigh CourtHi, message" in real use). Then reads the box back: typing that did not land is
   * said so, not reported as done.
   */
  async typeInto(id: number, text: string): Promise<void> {
    const keys = this.deps.keys ?? REAL_KEYS;
    /** One go: click into the box, replace what it holds, paste, read back. */
    const attempt = async (): Promise<"landed" | "missing" | "unreadable"> => {
      // The window first, on its own, given a moment: clicked in the same breath as it came
      // forward, the new WhatsApp (a WebView2 app) often kept the caret out of its box, and the
      // paste went nowhere (laptop demo, 2026-11-19 — one search in two failed).
      if (this.window) {
        await this.worker.run(`[void][CmdWindows]::Focus(${this.window.handle})`);
        await sleep(FRONT_SETTLE_MS);
      }
      await this.worker.run(`[CmdUia]::Focus(${id})`);
      await sleep(150);
      await keys.modifiersUp();
      keys.selectAll(); // Ctrl+A, within the focused box
      await sleep(60);
      // Pasted, like dictation: Devanagari and emoji arrive intact, and no Enter is ever pressed.
      await this.deps.inserter.insert(text);
      // WebView2 boxes report their new value late, later still on a slow laptop: read for a while,
      // stopping as soon as it shows.
      let readable = false;
      for (let waited = 0; waited < READ_BACK_MS; waited += READ_STEP_MS) {
        await sleep(READ_STEP_MS);
        const now = await this.worker.run(`[CmdUia]::CurrentValue(${id})`).catch(() => null);
        readable ||= typeof now === "string";
        if (typeof now === "string" && squash(now).includes(squash(text))) return "landed";
      }
      return readable ? "missing" : "unreadable";
    };
    await asOwnInput(async () => {
      // Once more when it did not show: click in again and replace — Ctrl+A first, so text that
      // did land after all is replaced, never doubled.
      let result = await attempt();
      if (result === "missing") result = await attempt();
      if (result === "missing") {
        const name = this.elements.find((element) => element.id === id)?.name ?? "the box";
        throw new Error(`Typed "${text}", but "${name}" doesn't show it`);
      }
    });
    await sleep(400);
  }

  private async readTree(window: WindowInfo): Promise<ScreenElement[]> {
    const read = await this.worker.json<{ elements: ScreenElement[] }>(`[CmdUia]::Read(${window.handle})`);
    return read.elements ?? [];
  }

  /** The window acted on comes to the front first, so the user sees what is being done. */
  private front(): string {
    return this.window ? `[void][CmdWindows]::Focus(${this.window.handle}); ` : "";
  }
}

/**
 * The window a step names — "WhatsApp's search box", "the second video on YouTube" — scored by the
 * words of its title and program that the step contains; ties go to the topmost, which is the list's
 * order. A step that names none means the window in front. `named` says whether the step's words
 * found it, as opposed to falling back.
 */
export function chooseWindow(
  hint: string,
  windows: WindowInfo[],
): { window: WindowInfo | null; named: boolean } {
  const own = new Set(["subxvoice", "electron"]);
  const candidates = windows.filter((window) => !own.has(window.program.toLowerCase()));
  // The place the step names, when it names one, is the only thing that chooses the window.
  const place = namedPlace(hint);
  const said = new Set(words(place ?? hint));
  let best: WindowInfo | null = null;
  let bestScore = 0;
  for (const window of candidates) {
    const score = new Set(words(`${window.title} ${window.program}`).filter((word) => said.has(word))).size;
    if (score > bestScore) {
      best = window;
      bestScore = score;
    }
  }
  if (best) return { window: best, named: true };
  return { window: candidates.find((window) => window.foreground) ?? candidates[0] ?? null, named: false };
}

/**
 * "in YouTube", "on WhatsApp", "into WhatsApp's search box" → the capitalised name of the place. Not
 * a bare possessive: in "Open Aryan's chat" the capital is a person, not a window.
 */
export function namedPlace(hint: string): string | null {
  const place = /\b(?:in|on|inside|into)\s+(?:the\s+)?([A-Z][\w.]*(?:\s+[A-Z][\w.]*)*)/.exec(hint)?.[1];
  return place && words(place).length ? place : null;
}

export const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !GENERIC.has(word));

/** Whitespace-blind and case-blind, as a box may wrap or trim what was pasted. */
const squash = (text: string) => text.replace(/\s+/g, "").toLowerCase();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
