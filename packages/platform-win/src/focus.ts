/**
 * What UI Automation says about the focused element (`CmdField.FocusInfo` in interop.ts), and the
 * decision made from it: paste, or offer Copy in the pill because the words have nowhere to go.
 */
export interface FocusInfo {
  controlType: number;
  className: string;
  /** "Win32", "WPF", "XAML", "DirectUI", "Chrome" (every Chromium and Electron app)… */
  framework: string;
  /** A Value pattern is there. */
  value: boolean;
  /** …and it is read-only. */
  readOnly: boolean;
  password: boolean;
}

const EDIT = 50004;
const PANE = 50033;
/** Button, CheckBox, Hyperlink, Image, ListItem, List, Menu, MenuBar, MenuItem, RadioButton, TabItem, ToolBar, Tree, TreeItem, TitleBar. */
const NOT_TEXT = new Set([
  50000, 50002, 50005, 50006, 50007, 50008, 50009, 50010, 50011, 50013, 50019, 50021, 50023, 50024, 50037,
]);
/** The desktop and the taskbar. */
const SHELL = new Set(["Progman", "WorkerW", "Shell_TrayWnd", "SHELLDLL_DefView"]);

/**
 * True: paste. False: the focus clearly takes no text, so nothing is pasted and the pill offers
 * Copy. Null: it cannot be told, so paste as always (a terminal or an editor may focus a Pane or a
 * Document and still take text; a wrong "no" would stop a paste that works today).
 */
export function takesText(focus: FocusInfo | null): boolean | null {
  if (!focus) return false;
  if (SHELL.has(focus.className)) return false;
  if (focus.password || focus.controlType === EDIT) return true;
  if (focus.value) return !focus.readOnly;
  if (NOT_TEXT.has(focus.controlType)) return false;
  // Chromium (Chrome, Edge, VS Code, every Electron and WebView2 app) reports every place that takes
  // text as an Edit or a writable value, so anything else there takes none: VS Code's chat history,
  // a page's body (user, 2026-11-21). Only its outer window pane is unsure: the tree under it may not
  // be built yet.
  if (focus.framework === "Chrome" && focus.controlType !== PANE) return false;
  return null;
}
