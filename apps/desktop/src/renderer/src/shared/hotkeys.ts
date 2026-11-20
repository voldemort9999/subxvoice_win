/**
 * The key to show as chosen: the saved one when this PC can watch it, otherwise the one in use.
 * From the Mac app (2026-11-20), where a key dropped from the list falls back; on Windows any
 * combination the watcher accepts is kept (`customHotkeys`). Recording lives in the main process
 * (HotkeyRecorder, platform-win `Hotkey.record`), not here.
 */
export function shownHotkey(
  saved: string | undefined,
  info: { supportedKeys: string[]; customHotkeys?: boolean; hotkeys: { keys: string }[] } | null,
): string | undefined {
  if (saved && (info?.customHotkeys || info?.supportedKeys.includes(saved))) return saved;
  return info?.hotkeys[0]?.keys;
}
