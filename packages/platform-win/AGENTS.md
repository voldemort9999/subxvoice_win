# packages/platform-win — Windows plug

Implements the `Platform` interface from `@subx/core` for Windows. Load `user32.dll` and other DLLs
on first use, never at import time.

| File | How |
|---|---|
| `permissions.ts` | Microphone only |
| `hotkey.ts` | Polls real key state every 15 ms (`GetAsyncKeyState` via koffi), default Ctrl + Win; any other key cancels |
| `inserter.ts` | Clipboard snapshot → Ctrl+V via `SendInput` → user's clipboard restored |
| `clipboard.ts` | The clipboard snapshot and restore |
| `win32.ts` | The few Win32 calls, through koffi. `user32.dll` is loaded on first use |
| `context.ts` | The foreground window: app name and window title |
| `commands.ts`, `interop.ts`, `powershell.ts` | Follow My Words actions, run in one PowerShell with C# interop (see `docs/command-mode.md`) |
| `screen.ts` | Screen control through UI Automation (UIA3) |

The microphone is not part of this package: the desktop app records through Web Audio in the pill.

- Only this package may contain Windows API code.
- If "Let desktop apps access your microphone" is off, recording silently returns empty audio — always
  check `permissions.status("microphone")`.
- Windows running as administrator cannot receive our key presses (UIPI). Tell the user; do not retry.
- koffi is a native module: it is in `dependencies` of this package **and** `apps/desktop`, `external` in
  `electron.vite.config.ts`, unpacked in `electron-builder.yml`, and allowed under `allowBuilds`.
