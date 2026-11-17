# SUBXVoice — Agent Guide

SUBXVoice is a voice desktop app for **Windows**. Hold Ctrl + Win and speak (any language, switching
mid-sentence is fine): clean text is pasted at the cursor in any app. Hold Ctrl + Alt (Follow My
Words) and say what you need done: it is done on the PC.

**Start here:** [`readme.md`](readme.md) shows what works today and how a release is cut.
Read `docs/architecture.md` before changing anything in `packages/core`.

This repo holds the desktop app and its Supabase functions. The website is a separate repo
(`voldemort9999/subxvoice`), and installers go to a public one (`voldemort9999/subxvoice-releases`)
— see `readme.md`.

## Repo map

| Path | What |
|---|---|
| `packages/core` | Plug-point interfaces, pipeline, dictionary rules, router, Follow My Words loop, fakes |
| `packages/providers` | STT / LLM / decider plugs — one file per vendor |
| `packages/platform-win` | The Windows plug: hotkey, paste, permissions, context, commands, screen control |
| `apps/desktop` | Electron app: `src/main` (Node side), `src/preload` (bridge), `src/renderer` (React UI) |
| `supabase/` | Edge Functions that hold the vendor keys behind the user's session |
| `docs/` | Features, tech stack, architecture, decisions |

## Commands (run from the repo root)

```bash
pnpm install          # once
pnpm check            # lint + format check + typecheck + tests — run after every change
pnpm fix              # auto-fix lint/format
pnpm dev:desktop      # run the Electron app
```

`pnpm check` must pass before you say a task is done.

## Rules

1. **Core never imports a vendor SDK, an OS API, Electron or a database.** It only uses the interfaces in
   `packages/core/src/contracts`. New capability = new interface in core + a plug somewhere else.
2. **Windows API code lives only in `platform-win`.** Core and the app reach it through the
   `Platform` interface.
3. **No API keys in the app.** Providers get short-lived tokens from our backend.
4. **Private content stays on the device.** Audio, transcripts and history are never sent to our server
   and never logged. Log timings and errors only.
5. **Never translate the user's speech** unless they asked for a translation.
6. **Actions that send, delete, buy or post** must be tools with `risk: "confirm"`.
7. The renderer never touches Node, the OS or the network directly — it calls `window.subx`
   (typed in `apps/desktop/src/shared/ipc.ts`).
8. Match the surrounding code; keep files small and single-purpose. Use `import type` for types.

## How to…

- **Add an STT/LLM vendor:** `packages/providers/src/stt/<vendor>.ts` implementing `SttProvider`
  (or `llm/<vendor>.ts` → `LlmProvider`), then one `case` in `packages/providers/src/index.ts`.
- **Add an OS feature:** an interface in `packages/core/src/contracts` (if it is new), implemented in
  `platform-win`.
- **Add a UI ↔ main call:** channel + type in `apps/desktop/src/shared/ipc.ts` → handler in
  `src/main/index.ts` → expose in `src/preload/index.ts`.
- **Add a voice command:** trigger phrases in `packages/core/src/router.ts`, behaviour as a `Tool`.
- **Test without a mic or keys:** use `@subx/core/fakes` (`FakeStt`, `FakeLlm`, `fakePlatform()`…).

## Gotchas

- Shells started from VS Code may have `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node.
  If the app won't open, run `unset ELECTRON_RUN_AS_NODE` first.
- Desktop dependencies all go in `devDependencies` so electron-vite bundles them. Native Node modules
  (koffi) are the exception — put them in `dependencies`, mark them `external` in
  `electron.vite.config.ts`, unpack them in `electron-builder.yml`, and allow their install scripts
  under `allowBuilds` in `pnpm-workspace.yaml`.
- Load Windows DLLs on first use, never at import time (e.g. `koffi.load("user32.dll")`), so tests and
  app start do not pay for them.
- Line endings are LF everywhere (`.gitattributes`); Windows checkouts would otherwise fail the formatter.
- Development settings live in `.env` at the repo root (copy `.env.example`). Only
  `apps/desktop/src/main/providers.ts` reads it, and only when the app is not packaged. Vendor keys
  stay on the backend. Never commit `.env`, never use `VITE_`-prefixed variables for keys.
- `artifactName` in `apps/desktop/electron-builder.yml` is fixed (no version) because the website's
  download button links to `releases/latest/download/SUBXVoice-windows-setup.exe`.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
