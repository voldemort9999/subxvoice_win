/**
 * Command mode: say what you want done, and the computer does it.
 *
 * The loop never knows how an action is carried out. Each action describes its *outcome* —
 * "Set the volume to a level" — and that description is all the decider reads. Whether it runs
 * through a Win32 call or by clicking the screen travels with the action, invisible to the model.
 * That is what lets screen control be added later as one more source, with no change to the loop.
 * See docs/command-mode.md.
 */

import type { OcrLine, Shot } from "../contracts/screen-control";

export interface AgentAction {
  /** The option key the decider picks. Stable and snake_case: it is also what history records. */
  id: string;
  /** What doing this achieves, in the user's terms. The only text the decider ever sees. */
  describe: string;
  /**
   * The JSON shape a writer model fills in, as prompt text — e.g. `{"level": number 0-100}`.
   * Absent when the action needs no details, which saves a model call.
   */
  args?: string;
  /**
   * What the writer needs to fill the details in — the open windows, the apps playing sound — read
   * only once this action has been chosen. Kept off the decider's state on purpose: it is read on
   * every step for every action, and a window list there would slow every choice to help one.
   */
  facts?(): Promise<string[]>;
  /**
   * False for an action that exists but cannot run yet. It is still offered, so that "play the
   * second video" is recognised as screen control and refused honestly, rather than matched to the
   * nearest thing that *is* available and done wrongly.
   */
  available?: boolean;
  /**
   * True when doing this by mistake loses work — closing windows, stopping programs. The decider
   * must be surer before it is run.
   */
  risky?: boolean;
  /** What the user is told when an unavailable action is chosen. */
  unavailable?: string;
  /** `context` is always given by the loop; a direct call (a test) may leave it out. */
  run(args: Record<string, unknown>, context?: StepContext): Promise<StepResult>;
}

/** What the step being run is — for an action that still has a choice to make, like which element. */
export interface StepContext {
  said: string;
  step: string;
}

/** One thing on screen that can be acted on, from the OS's accessibility tree. */
export interface ScreenElement {
  /** Index into the snapshot it came from; valid until the next `read`. */
  id: number;
  /** Button, Link, Edit, ListItem… */
  role: string;
  name: string;
  /** A text box's contents. Never a password's. */
  value?: string;
  /** Can be typed into. */
  editable: boolean;
  /** For a box: where it sits in the window, which can be all that names it. */
  where?: "top" | "middle" | "bottom";
  /** [left, top, right, bottom] in physical screen pixels. */
  bounds?: [number, number, number, number];
  /** Has the keyboard focus. */
  focused?: boolean;
}

/** UIA patterns that act without moving the mouse — and so also on a window behind others. */
export type ScreenAction = "invoke" | "select" | "expand" | "scroll_into_view";

export interface ScreenSnapshot {
  /** The window read, by title. */
  window: string;
  elements: ScreenElement[];
  /**
   * The same moment as pixels: a picture of the window's display (password boxes blacked out) and
   * text OCR read inside the elements the tree left unnamed. Taken only when called — about a
   * second — so a decider that cannot look never pays for it.
   */
  look?: () => Promise<ScreenLook>;
}

export interface ScreenLook {
  shot: Shot;
  /** OCR lines in physical pixels, from the area of the unnamed elements only. */
  text: OcrLine[];
}

/**
 * The screen, as the OS's accessibility tree describes it — names and roles; pixels only through a
 * snapshot's `look`, for a decider that can read them. See docs/command-mode.md, "Screen control".
 */
export interface ScreenDriver {
  /** The window this step is about — the one `hint` names, else the one in front — read now. */
  read(hint: string): Promise<ScreenSnapshot>;
  click(id: number): Promise<void>;
  /** A real click at a point in physical pixels — text read off the latest `look`, which the tree lacks. */
  clickAt?(x: number, y: number): Promise<void>;
  /** Focuses the element and types into it. Never presses Enter: typing is not sending. */
  typeInto(id: number, text: string): Promise<void>;
  /** Acts through a UIA pattern; throws when the element does not offer it. The assistant's `ui` tool uses it. */
  act?(id: number, action: ScreenAction): Promise<void>;
}

export interface StepResult {
  /** What was done, past tense, one line. Shown on the pill and kept in memory for the next step. */
  did: string;
  /** Set when the action answered a question instead of changing anything. Ends the run. */
  answer?: string;
}

/** A place actions come from: the OS today, the screen's accessibility tree later. */
export interface ActionSource {
  /**
   * Facts about the machine right now, one per line — what is focused, what is playing. Kept
   * short: every line is read by the decider on every step.
   */
  observe(): Promise<string[]>;
  actions(): Promise<AgentAction[]>;
}

/** The OS's own actions. Kept warm between commands, and stopped when the app quits. */
export interface CommandSource extends ActionSource {
  /** Start anything slow now — called on key-down, so the first command does not wait for it. */
  warm?(): void;
  dispose?(): void;
}

/** What the pill is told while a command runs. */
export type AgentEvent =
  | { kind: "thinking" }
  | { kind: "doing"; what: string }
  | { kind: "did"; what: string };

export interface AgentOutcome {
  /** One line for the pill. */
  message: string;
  /** False when nothing was done, or the run stopped partway. */
  ok: boolean;
  /** Everything that was done, in order. */
  steps: string[];
}
