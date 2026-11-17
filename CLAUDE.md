# SUBXVoice — orientation

Voice-typing desktop app for **macOS and Windows**: hold a hotkey, speak (any language, switching
mid-sentence is fine), and clean text is pasted at the cursor in whatever app has focus.

**Pushes go to `origin` = `voldemort9999/subxvoice_win`, the main repo since 2026-11-17.**
`app` = `voldemort9999/subxvoice-app` is the secondary copy; push there only when the user asks.

**Read [`AGENTS.md`](AGENTS.md) for the repo map and the rules.** It is the authority on what goes
where. This file is orientation plus the context system; it does not repeat AGENTS.md.

## Start of every session

Run `/context-read` before doing anything else. It reads `context/INDEX.md` and tells you where
things stand, how the last session ended, and what to do next. Do not start work until the user
confirms — they may have changed their mind since the journal was written.

## Commands

```bash
pnpm install          # once
pnpm check            # biome + typecheck + tests — must pass before you call a task done
pnpm fix              # auto-fix lint/format
pnpm dev:desktop      # run the Electron app
pnpm build            # what CI runs after check
```

Run a single package's tests with `pnpm --filter @subx/core test` (same for `@subx/desktop`,
`@subx/platform-win`, `@subx/providers`).

## The shape of the thing

Core is a switchboard with sockets; vendors, operating systems and storage are plugs.
`packages/core` only ever talks to the interfaces in `packages/core/src/contracts/`.

One dictation, end to end:

```
hotkey down ─► DictationController.start ─► workflow.open ─► Pipeline.open (STT socket opens now)
                                                          └─► mic.start, chunks pushed live
hotkey up   ─► mic.stop ─► session.finish ─► Gnani commit ─► dictionary rules ─► router
                        ─► LLM (script / style) ─► inserter (clipboard + Ctrl/⌘V) ─► history
                                                                      audio saved after the paste
```

The STT socket opens on key-**down** and audio streams while the user talks, so key-up only pays for
the tail. Keep it that way — buffering the clip and sending it at release made release→paste scale
with how long they spoke (~5.6 s for a 6.5 s clip, vs ~50 ms now).

`apps/desktop/src/main/workflow.ts` owns the whole app-specific side of that flow (settings, pill
messages, history, audio, failure text). It is injected into `DictationController`, so it is
unit-tested without a microphone.

## Conventions that are easy to get wrong

- **Core imports no vendor SDK, no OS API, no Electron, no database.** New capability = new
  interface in `contracts/` + a plug elsewhere.
- **`platform-mac` and `platform-win` mirror each other's file names.** Same for
  `renderer/src/platform/mac|win`.
- **Desktop dependencies go in `devDependencies`** so electron-vite bundles them. Native modules
  (`koffi`) are the exception: `dependencies`, `external` in `electron.vite.config.ts`, and
  `asarUnpack` in `electron-builder.yml`.
- **The renderer never touches Node, the OS or the network.** It calls `window.subx`, typed in
  `apps/desktop/src/shared/ipc.ts`. Adding a call = channel + type there → handler in `main/index.ts`
  → expose in `preload/index.ts`.
- **Never translate the user's speech.** Roman-script output is transliteration, a different thing.
- **Comments say _why_, not _what_.** The codebase is written that way; match it.
- Pick an option over another → add a paragraph to `docs/decisions.md`.

## Gotchas this project has already been bitten by

- `ELECTRON_RUN_AS_NODE=1` leaks in from VS Code terminals and makes Electron run as plain Node
  (`electron.app` is undefined). `unset ELECTRON_RUN_AS_NODE` before `pnpm dev:desktop`. It also
  breaks the **installed** `SUBXVoice.exe` when launched from such a shell — it exits at once, or
  prints `bad option: …` (a Node error). Launch it with `explorer.exe <path>` instead.
- **Gnani configures the session in the websocket upgrade headers**, not in a message after
  connecting. Node's and Electron's `WebSocket` (undici) takes a `{ headers }` option; the DOM type
  does not describe it. A header value above U+00FF throws, so Devanagari dictionary terms cannot
  be sent as `keyterms` and are dropped.
- **Gnani answers a `commit` with nothing to flush with silence** — no ack, no empty transcript. So
  `finish()` waits only when an utterance is actually open, tracked by `utterance_id`. Waiting
  unconditionally stalls every dictation that ended in a pause.
- Electron 44's clipboard API is **promise-based**; `clipboard.readText()` returns a Promise.
- `pnpm-workspace.yaml` → `allowBuilds` gates install scripts. `koffi: true` is required or the
  native binding never unpacks and the app dies at import.
- Live provider tests skip themselves without keys, which is how CI stays green. Absence of
  failures there does not mean the vendors were exercised.
- **`platform-win` is imported on macOS too.** Never call a Windows API at import time — load
  `user32.dll` on first use. A top-level `koffi.load` crashed the Mac app on startup.
- `clipboard.ts` exists in both platform packages and the two must stay identical.
- Electron creates `userData` **before the main script runs**, so "does the folder exist" says
  nothing about whether the app has ever stored anything there. See `migrateUserData`.
- electron-builder publishes drafts by default, and uploads artifacts concurrently with each
  uploader creating the release if it finds none — so a first publish races itself into two
  half-filled releases. `scripts/release.mjs` creates the release first; `releaseType: release`
  stops it being a draft.
- **`pnpm dev:desktop` and the installed app are the same app to Windows.** They share
  `userData`, so both write the same `history.json`, and they now compete for the single-instance
  lock — whichever starts second exits. Two pills on screen at once means two copies are running,
  and the dev one is `electron.exe`, so looking for `SUBXVoice.exe` will not find it.
- Faking key presses from a script is unreliable — test hotkeys by hand. To inspect the pill,
  start with `pnpm --filter @subx/desktop exec electron-vite dev --remoteDebuggingPort 9333` and
  open `http://127.0.0.1:9333/json`. The dashboard's DevTools are `Ctrl+Shift+I`.

## Secrets

**The app holds no vendor keys.** Speech-to-text and rewriting go through Supabase Edge Functions
(`supabase/functions/stt`, `supabase/functions/llm`) that the signed-in account unlocks; the Gnani
and OpenRouter keys live there as function secrets. `.env` at the repo root is now only developer
tuning — `GNANI_MODEL`, `GNANI_LANGUAGE`, `GNANI_FORMAT`, `OPENROUTER_MODEL` — and is read in
development only. The Supabase URL and anon key are compiled into `main/auth.ts`; neither is a
secret, which is the point of the anon key. `.env.example` documents them. This is a development bridge only — AGENTS.md
rule 3 still stands, and the backend will hand out short-lived tokens later.

## Context system

Where the pieces are. The journal lives in this repo so it travels with the code; the two slash
commands live one level up at the **workspace root** (`pillow/.claude/commands/`), because that is
where Claude Code is rooted and it is not a git repository.

```
subxvoice/CLAUDE.md             ← this file          ─┐ tier 1, always read (~215 lines total)
subxvoice/context/INDEX.md      ← state + topic map  ─┘
subxvoice/context/001-*.md      ← journal, tier 2, on demand only
pillow/.claude/commands/        ← /context-read, /context-write
pillow/CLAUDE.md                ← workspace root: which project is active
```

Both commands work whether the session is rooted at `pillow/` or at `subxvoice/` — they locate the
journal themselves.

Two tiers, so the per-session cost stays flat as history grows.

**Tier 1 — always read.** `CLAUDE.md` + `context/INDEX.md`. Together ~250 lines, and that number
does not grow when the journal does.

**Tier 2 — on demand only.** `context/NNN-*.md`. Read one *only* when INDEX's topic→file table
points at it, or the user asks for full history. **Never read all of them at once** — by file 8 they
cost more than they save, which is the whole reason INDEX exists.

Rules for the numbered files:

- `context/NNN-topic-slug.md`, zero-padded. The filename is an index: `ls context/` should tell you
  what is in each.
- **Append-only.** Never rewritten, summarised or deleted.
- ~1000 lines each. A session entry is never split across two files — if it does not fit, start the
  next file and put the whole entry there.
- `context/INDEX.md` is the one mutable file. `/context-write` rewrites it completely every time.

### docs/ vs context/

| | holds | shape |
|---|---|---|
| `docs/` | durable product knowledge — how it works, why it is that way | timeless, rewritten |
| `context/` | journal — what happened that day, what broke | date-bound, append-only |

A finding that outlives the session (why a capability was dropped, the root cause of a defect) goes
in `docs/`; context gets one line pointing at it. **Writing the same thing in both is the failure
mode.** `docs/` already exists here — add to it rather than restating it in the journal.
