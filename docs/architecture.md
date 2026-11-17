# Architecture

## The one idea

**Core is a switchboard with sockets. Everything else is a plug.**

`packages/core` defines interfaces (the sockets) and the pipeline that uses them. Vendors, operating
systems, databases and MCP servers are plugs that implement those interfaces. Swapping Gnani for our
own model never changes core.

## Dictation pipeline

```
Hotkey ──► Mic ──► STT ──► Rules ──► Router ──┬─► exact ──────────────────► Inserter ──► cursor
                                              ├─► style ──► LLM ──────────► Inserter
                                              └─► command ──► Tools (built-in / OS / MCP)

Every dictation is saved to local history: audio, text, app and per-stage timings.
```

| Stage | Where | Notes |
|---|---|---|
| Hotkey | `Platform.hotkey` | Hold = talk. Ctrl + Win dictates, Ctrl + Alt is Follow My Words; any combination of two or more keys can be set. |
| Mic | Web Audio in the pill | Kept warm for a minute after each dictation, because it takes ~300 ms to open. |
| STT | `SttProvider` plug | Dictionary words go in as hints. Never force one language. |
| Rules | `core/rules.ts` | Dictionary corrections + spacing. Deterministic, ~1 ms, no AI. |
| Router | `core/router.ts` | Trigger phrase at the start → command. Otherwise dictation. |
| Style rewrite | `LlmProvider` plug | Only in style mode. Prompt in `core/prompts.ts`. |
| Insert | `Platform.inserter` | Full clipboard snapshot → Ctrl+V → user's clipboard restored. If pasting fails the dictation is still saved to history and the pill says why. |
| History | `HistoryStore` plug | Local JSON file + WAV recordings today (`apps/desktop/src/main/stores.ts`); SQLite later. Timings per stage are recorded. |

**Roman output is checked, and asked for twice if need be** (`Pipeline.finalise`). A reply still in
Devanagari after Roman was asked for is retried once with a firm line added to the system prompt;
only if that also fails does the text go in as it came, with the reason in history. On 2026-11-14
a ~900-character dictation came back cleaned up but in Devanagari, while the same text sent again
through Groq came back Roman twice (~1 s): the first answer had come from a fallback upstream.

**One press at a time, by number** (`DictationController`, `apps/desktop/src/main/dictation.ts`).
Each press takes a number; the stream it opens and the cancel it may run check that number before
touching the controller. Without it the pill stuck on "•••" for good (found live, 2026-11-12): a
tap under 250 ms cancels, and its cancel awaits its own stream's opening; by then the next press
had started, so the old cancel cleared the new press's `run`, the audio piled up in `pending`, and
the release found no run and returned with the state still "processing" — which ignores every
later press — after clearing the 60 s watchdog. A release that finds no run now ends the run with
"Couldn't start listening", and the watchdog (`STUCK_MS`) frees anything still "processing" after
60 s and logs the stage it was at. `dictation.test.ts` replays the race and fails without the fix.

## Plug points

| Interface | File | Plugs today | Later |
|---|---|---|---|
| `SttProvider` | `contracts/stt.ts` | `gnani` (streaming), fake | Others via benchmark, local whisper.cpp, our own model |
| `LlmProvider` | `contracts/llm.ts` | `openrouter`, fake | Our own model |
| `Platform` (hotkey, inserter, permissions, context, commands, screen) | `contracts/platform.ts` | `platform-win`: hotkey + paste via koffi, permissions, context, Follow My Words actions, screen control | Active-app context, focused text; C# helper on Windows if needed |
| `Tool` + `ToolRegistry` | `contracts/tool.ts`, `tools.ts` | — | built-in commands, OS actions, MCP tools |
| `HistoryStore`, `DictionaryStore` | `contracts/store.ts` | JSON files (`apps/desktop/src/main/stores.ts`), in-memory fakes for tests | SQLite (local), synced dictionary |

## Actions and MCP

Everything SUBXVoice can *do* is a `Tool` in one `ToolRegistry`:

```
ToolRegistry
├── built-in   draft_email, rewrite, translate…
├── platform   open_app, open_url           (from Platform.desktop)
└── mcp        every tool of every MCP server the user connects
```

For a command, the LLM receives `registry.list()` and picks a tool. Tools marked `risk: "confirm"`
(send, delete, post, buy) always ask the user first. Connecting an MCP server only adds tools to the
registry — core does not change.

SUBXVoice will also run its own MCP **server**, so other assistants can read (with permission) the
user's history and dictionary.

## Desktop app processes

| Process | Folder | Can do |
|---|---|---|
| Main (Node) | `apps/desktop/src/main` | Everything: platform plug, pipeline, files, network, MCP |
| Preload | `apps/desktop/src/preload` | Exposes `window.subx` (typed in `src/shared/ipc.ts`) |
| Renderer (React) | `apps/desktop/src/renderer` | UI only; talks to main through `window.subx` |

Windows (app windows, not the OS):

| Window | Status |
|---|---|
| Main window — dashboard with Home, History, Dictionary, Settings | Built. Created on open, destroyed on close to keep background RAM low |
| Recording pill — bottom centre of the screen, live waveform, click opens the dashboard | Built. **Never takes focus** (or the paste would land in the wrong app); ignores the mouse except over the pill |
| Tray icon — Open, Quit | Built. The app keeps running after the dashboard closes; quit from here |
| Command popup ("What should the email be about?") | Planned, also non-focusing |

## Where data lives

| Data | Location |
|---|---|
| Audio, transcripts, history | Device only |
| Dictionary, shortcuts, settings | Device; synced to the backend once it exists |
| Stats (numbers only) | Computed on the device today; backend later |
| Vendor API keys | Backend only; the app gets short-lived tokens |

## Releases

`electron-builder` produces `SUBXVoice-windows-setup.exe` and publishes it to GitHub Releases. The website links to `releases/latest/download/<file>`, so a new
release needs no website change. Builds should be signed to avoid SmartScreen warnings.
