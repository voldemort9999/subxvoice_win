# apps/desktop — Electron app

| Folder | Runs in | Rule |
|---|---|---|
| `src/main` | Node (main process) | Owns the platform plug, pipeline, files, network |
| `src/preload` | Bridge | Only maps `window.subx` calls to IPC — no logic |
| `src/shared/ipc.ts` | Everywhere | Single source of truth for IPC channels and types |
| `src/renderer` | Browser (React) | UI only. Never import Node/Electron here |
| `src/renderer/src/shared` | UI shared by every page | Most components go here |

- Windows that must never take focus (recording pill, command popup): `focusable: false`.
- The main window is destroyed on close, not hidden, to keep background RAM low.
- If Electron starts as plain Node, `unset ELECTRON_RUN_AS_NODE`.

## Dictation flow (today)

Key down (`platform.hotkey`) → `DictationController` (`src/main/dictation.ts`) opens the mic
(`src/main/mic.ts`) **and** a pipeline session at the same time; audio streams to the STT plug while the
user speaks (chunks that arrive before the stream is open are buffered). Key up → the session finishes:
rules → (Roman-script / style LLM) → paste via `platform.inserter` → history. The WAV is attached to the
history record afterwards, off the critical path. Engines are built in `src/main/providers.ts`
and unlocked by the signed-in account; without them every dictation is still recorded and saved, with
no text.
The pill (`src/main/pill.ts` + `src/renderer/src/pill/`) shows state, the waveform, then the words as heard.
Settings (hotkey, script, microphone) live in `settings.json` (`JsonSettingsStore`, only explicit choices
are saved).

- Mic source: Web Audio in the pill (`MicRecorder`), which keeps the mic warm for `WARM_MS` with a
  300 ms pre-roll because Chromium takes ~300 ms to open it.
- The audio worklet (`pcm-worklet.ts`) runs on the audio thread and must not import anything.
- Accidental taps are detected by hold time (`MIN_HOLD_MS`), not clip length (pre-roll makes clips longer).
- Speed target: text pasted **200–500 ms after the key is released**. Measure before and after changes.
- Read the pill and dashboard state through `--remote-debugging-port` (DevTools protocol). Hotkeys must
  be tested by hand — synthetic key events are unreliable.
