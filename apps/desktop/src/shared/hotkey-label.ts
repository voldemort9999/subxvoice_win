// How a hotkey is named to people: in the dashboard, the pill and the menu bar menu alike.

/** Keys whose own name is not what people call them. Everything else is title-cased. */
export const HOTKEY_LABELS: Record<string, string> = {
  fn: "fn 🌐",
  right_option: "right ⌥ Option",
  right_command: "right ⌘ Command",
  right_ctrl: "right Ctrl",
  left_option: "left ⌥ Option",
  left_ctrl: "left Ctrl",
};

const KEY_LABELS: Record<string, string> = {
  ctrl: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  cmd: "Cmd",
  esc: "Esc",
  pageup: "Page Up",
  pagedown: "Page Down",
  capslock: "Caps Lock",
  scrolllock: "Scroll Lock",
  numlock: "Num Lock",
  win: "Win",
  // One side of a modifier, as the Windows recorder names a modifier held alone.
  lctrl: "Left Ctrl",
  rctrl: "Right Ctrl",
  lalt: "Left Alt",
  ralt: "Right Alt",
  lshift: "Left Shift",
  rshift: "Right Shift",
  lwin: "Left Win",
  rwin: "Right Win",
  semicolon: ";",
  equal: "=",
  comma: ",",
  minus: "-",
  period: ".",
  slash: "/",
  backquote: "`",
  bracketleft: "[",
  backslash: "\\",
  bracketright: "]",
  quote: "'",
  numpadmultiply: "Numpad *",
  numpadadd: "Numpad +",
  numpadsubtract: "Numpad -",
  numpaddecimal: "Numpad .",
  numpaddivide: "Numpad /",
};

/**
 * "ctrl+shift+f9" → "Ctrl + Shift + F9": formats any combination rather than looking it up.
 */
export function hotkeyLabel(keys: string | undefined): string {
  if (!keys) return "the hotkey";
  if (HOTKEY_LABELS[keys]) return HOTKEY_LABELS[keys];
  return keys
    .split("+")
    .map((key) => KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : titleCase(key)))
    .join(" + ");
}

/** "f9" → "F9", "numpad7" → "Numpad 7", "home" → "Home". */
const titleCase = (key: string) => {
  if (/^f\d+$/.test(key)) return key.toUpperCase();
  const numpad = /^numpad(\d)$/.exec(key);
  if (numpad) return `Numpad ${numpad[1]}`;
  // A key Windows has no name for, recorded by its code (platform-win hotkey.ts).
  const code = /^vk(\d+)$/.exec(key);
  if (code) return `Key ${code[1]}`;
  return key.charAt(0).toUpperCase() + key.slice(1);
};
