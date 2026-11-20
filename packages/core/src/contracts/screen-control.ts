/**
 * Pixel-level screen control for the assistant: what it sees and where it clicks. Coordinates the
 * model gives are always in the last screenshot's pixels — the frame Anthropic's computer toolset
 * uses, so a Claude model's training carries over and every other model gets the same rules.
 */

/** Physical pixels on the virtual desktop (a screen left of the primary one has negative x). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Shot {
  /** base64, ready for a model's image block; `mimeType` says which encoding. */
  data: string;
  mimeType: "image/png" | "image/jpeg";
  /** The image's size in pixels. */
  width: number;
  height: number;
  /** Image pixels per physical pixel; ≤ 1 for a screenshot. */
  scale: number;
  /** What was captured: the whole display for a screenshot, the region for a zoom. */
  display: Rect;
  /** Password boxes blacked out before the image left the capture (spec §9). */
  redacted: number;
}

export interface ScreenCapture {
  /**
   * The display the hinted window is on, else the one under the foreground window, scaled down to
   * fit the model's image limits. Becomes the frame later coordinates are read in.
   */
  screenshot(opts?: { windowHint?: string }): Promise<Shot>;
  /** [x0, y0, x1, y1] in the last screenshot's coordinates, seen closer. Does not change the frame. */
  zoom(region: [number, number, number, number]): Promise<Shot>;
  /** A point in the last screenshot → physical virtual-desktop pixels. Throws when off the image. */
  toPhysical(x: number, y: number): [number, number];
  /** Physical pixels → the last screenshot's coordinates; may fall outside it (another display). */
  toShot(x: number, y: number): [number, number];
  /** The last screenshot's [width, height]; throws before the first. */
  frameSize(): [number, number];
}

export type MouseButton = "left" | "right" | "middle";
export type ScrollDirection = "up" | "down" | "left" | "right";

/**
 * Mouse and keyboard, in screenshot coordinates. Key names follow the computer toolset (xdotool
 * style: "ctrl+s", "Return", "super", "Page_Down"); common Windows spellings ("enter", "win",
 * "esc", "pgdn") are accepted too.
 */
export interface ScreenInput {
  click(
    x: number,
    y: number,
    o?: { button?: MouseButton; count?: 1 | 2 | 3; modifiers?: string[] },
  ): Promise<void>;
  drag(from: [number, number], to: [number, number]): Promise<void>;
  move(x: number, y: number): Promise<void>;
  mouseDown(): Promise<void>;
  mouseUp(): Promise<void>;
  scroll(
    at: [number, number] | null,
    direction: ScrollDirection,
    amount: number,
    modifiers?: string[],
  ): Promise<void>;
  /** Unicode typing, no clipboard: Devanagari and emoji arrive as they are. */
  type(text: string): Promise<void>;
  key(combo: string, repeat?: number): Promise<void>;
  holdKey(combo: string, seconds: number, signal?: AbortSignal): Promise<void>;
  /** Where the cursor is, in screenshot coordinates. */
  cursor(): Promise<[number, number]>;
  /** Lets go of every key and button this executor pressed and has not released. */
  releaseAll(): Promise<void>;
  /** Date.now() of the last input this executor injected; 0 before any. */
  lastInjectedAt(): number;
}

export interface UiNode {
  role: string;
  name: string;
}

/** Where the focus is: the box keys and typing would land in, and its window. */
export interface Focus extends UiNode {
  /** A box's placeholder ("Type a message"), which WhatsApp keeps when the name goes. */
  help: string;
  window: string;
  program: string;
}

/** The user using their own mouse or keyboard: one stretch of input with no long gap in it. */
export interface Touch {
  /** Date.now() of the touch's first input. */
  startedAt: number;
  /** How long it has gone on so far. */
  heldMs: number;
}

/**
 * The user's own input while the assistant works (design §5): input the executor did not inject,
 * outside the app's own hotkeys. Polled, never a hook.
 */
export interface UserInputWatch {
  /** Called on every poll while a touch goes on. Returns the unsubscribe. */
  onTouch(cb: (touch: Touch) => void): () => void;
  /** Milliseconds since the user's last own input; Infinity before any. */
  idleMs(): number;
  /** From the dictation key going down until its paste lands. */
  dictationActive(): boolean;
}

/** One line of text OCR read on screen, its box in physical pixels. */
export interface OcrLine {
  text: string;
  box: Rect;
}

/**
 * What the guard looks at before a pixel action runs (design §3): a click is judged by what it
 * would hit, not by what the model says it is clicking. Points are physical pixels.
 */
export interface ScreenProbe {
  /** The element under the point, then up to two ancestors; [] where no app exposes a tree. */
  elementAt(x: number, y: number): Promise<UiNode[]>;
  focused(): Promise<Focus | null>;
  /** Text read off the pixels around the point, for apps with no tree (canvas, emulators). */
  textNear(x: number, y: number): Promise<OcrLine[]>;
}

/**
 * Everything the assistant's screen tools need from the OS, together (plan T15): what it sees, how
 * it moves, what the guard looks at, and the user's own hands.
 */
export interface ScreenControl {
  capture: ScreenCapture;
  input: ScreenInput;
  probe: ScreenProbe;
  /** A watch on the user's own mouse and keyboard; `dictationActive` comes from the app. */
  watch(dictationActive: () => boolean): UserInputWatch;
}
