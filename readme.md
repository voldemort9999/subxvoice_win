# SUBXVoice

Keep working, say the rest. A voice helper for Windows: hold a key, speak in Hindi, English or both,
and clean text appears wherever your cursor is — or say what you need done, and it is done on the PC.

## Where things live

| What | Where |
|---|---|
| This repo | the desktop app and its Supabase backend |
| Installers and the update feed | [`voldemort9999/subxvoice-releases`](https://github.com/voldemort9999/subxvoice-releases) — public, because a private repo's release assets 404 for anonymous downloads |
| The website | [`voldemort9999/subxvoice`](https://github.com/voldemort9999/subxvoice), deployed at [subxvoice.vercel.app](https://subxvoice.vercel.app) |

## Releasing

`pnpm --filter @subx/desktop dist:win` builds an installer and publishes nothing.
`pnpm --filter @subx/desktop release:win` is the only command that publishes, and every installed
copy downloads what it publishes. Bump `apps/desktop/package.json` first.

## Getting started

Requirements: Windows 10 or 11, Node 22+ (24 LTS recommended) and pnpm 11.

```bash
pnpm install
pnpm dev:desktop   # Electron app
pnpm check         # lint + typecheck + tests (run before every PR)
```

If the desktop app opens as plain Node inside a VS Code terminal, run `unset ELECTRON_RUN_AS_NODE`.

## What works today

| Feature | Status |
|---|---|
| Hold Ctrl + Win → dictate; any combination of two or more keys can be set | ✅ |
| Microphone through Web Audio, with a picker in Settings | ✅ |
| Speech-to-text by Gnani Prisma, streamed while you speak | ✅ |
| Text pasted at the cursor, the user's clipboard restored | ✅ Ctrl+V via Win32 `SendInput` |
| Hindi and other Indian languages written in Roman letters, chat style; misheard words repaired | ✅ Gemini 3.5 Flash Lite, racing gpt-oss-120b |
| Emails and messages written from one spoken line, in a chosen tone | ✅ |
| Follow My Words (Ctrl + Alt): apps, files, volume, brightness, Wi-Fi, Bluetooth, YouTube, WhatsApp, Notepad | ✅ |
| Always-on-screen pill: live waveform, then the words as heard | ✅ |
| Dashboard, History with playback, Insights, Dictionary, Settings | ✅ |
| Accounts (email and password), two hours of listening a day | ✅ |
| Recordings and history saved locally | ✅ |
| Installer and auto-update | ✅ |

The app holds no vendor keys: speech-to-text and the rewriting go through Supabase Edge Functions
that a signed-in account unlocks. `.env` at the repo root is developer tuning only
(`GNANI_MODEL`, `GNANI_LANGUAGE`, `GNANI_FORMAT`, `OPENROUTER_MODEL`) and is read in development
only — see `.env.example`.

## Docs

- [Agent guide](AGENTS.md) — repo map, rules, how-tos; also the best overview for humans
- [Features](docs/FEATURES.md) — the full product feature list
- [Architecture](docs/architecture.md) — how the pieces fit together
- [Command mode](docs/command-mode.md) — how Follow My Words works
- [Tech stack](docs/TECH_STACK.md)
- [Decisions](docs/decisions.md) — why things are the way they are
