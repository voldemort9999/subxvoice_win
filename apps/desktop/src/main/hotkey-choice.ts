import { hotkeyLabel } from "../shared/hotkey-label";

/**
 * Why a recorded chord cannot be the dictation hotkey, in words for Settings, or null when it can.
 * `accepts` is the platform's own check (the one that guards registration).
 */
export function hotkeyRefusal(
  keys: string,
  accepts: (keys: string) => boolean,
  commandKeys: string,
): string | null {
  if (keys === commandKeys) return `${hotkeyLabel(keys)} is Follow My Words. Pick other keys for dictation.`;
  if (accepts(keys)) return null;
  return `${hotkeyLabel(keys)} alone would start dictating while you type. Add Ctrl, Alt, Shift or Win, or use F1–F24, Pause, Scroll Lock, Right Ctrl or Right Alt on its own.`;
}
