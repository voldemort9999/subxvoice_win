# SUBXVoice — Tech Stack

One language everywhere: **TypeScript**. The app runs on **Windows 10 and 11**.

## Desktop App
| Part | Tech |
|---|---|
| App shell | Electron + electron-vite |
| Mic capture | Web Audio in the pill window, kept warm for a minute after each dictation |
| Hold-to-talk hotkey | `GetAsyncKeyState` polling via koffi, default Ctrl + Win (dictation) and Ctrl + Alt (Follow My Words) |
| Paste at cursor | Full clipboard snapshot → Ctrl+V via `SendInput` (koffi) → restore |
| Active app / window title | The foreground window, through Win32 |
| Follow My Words actions | One PowerShell process with C# interop (`packages/platform-win/src/commands.ts`, `interop.ts`) |
| Screen control | UI Automation (UIA3), read as text — no screenshots |
| Local storage | JSON files + WAV recordings (`apps/desktop/src/main/stores.ts`) |
| Token storage | Electron safeStorage (the refresh token only) |
| Installer | electron-builder — NSIS .exe |
| Auto-update | electron-updater + GitHub Releases (`voldemort9999/subxvoice-releases`) |

Rule: the renderer (UI) never touches the disk, network or OS directly — it asks the main process through a typed preload bridge.

## GUI
| Part | Tech |
|---|---|
| Framework | React + TypeScript |
| Styling | Tailwind CSS v4 with design tokens (see `docs/design.md`) |
| Icons | Small inline SVG set in `renderer/src/shared/icons.tsx` |
| Navigation | Plain React state |
| Audio playback | `<audio>` with a Blob of the local WAV |

### App windows
| Window | Notes |
|---|---|
| Main window | Dashboard, History, Insights, Dictionary, Settings; sign-in and onboarding first |
| Recording pill | Small, transparent, always on top, **never takes focus** (otherwise the paste goes to the wrong app) |
| Tray | Electron Tray with Open / Quit |

## Speech and language engines
| Part | Tech |
|---|---|
| Speech-to-text | Gnani realtime (`prisma-v3.0`), streamed over a websocket while the user speaks; `hi-IN` covers Hindi + English |
| Dictation rewriting | Gemini 3.5 Flash Lite (Google priority tier) racing `openai/gpt-oss-120b` on Groq, via OpenRouter |
| Follow My Words planning | Gemini 2.5 Flash writes the steps; Jev picks each action or on-screen element |
| Keys | On the backend only: Supabase Edge Functions unlocked by the user's session |

## Backend
| Part | Tech |
|---|---|
| Accounts | Supabase Auth, email and password |
| Vendor proxies | Supabase Edge Functions (`supabase/functions/stt`, `llm`, `usage`) |
| Daily limit | Two hours of listening per account, counted on the server |

## Website
TanStack Start on Vercel, in its own repo (`voldemort9999/subxvoice`).

## Where Data Lives
| Data | Location |
|---|---|
| Audio, transcripts, history, dictionary | Device only |
| Seconds listened (for the daily limit) | Supabase |
| STT / LLM API keys | Backend only |

## Tooling
| Part | Tech |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Lint + format | Biome |
| Tests | Vitest |
| CI | GitHub Actions on Windows (`pnpm check`, `pnpm build`) |

## Repo Layout
```
subxvoice/
├── apps/
│   └── desktop/        Electron (main = core + the Windows plug, renderer = UI)
├── packages/
│   ├── core/           interfaces (plug points) + pipeline + rules + router + Follow My Words loop
│   ├── providers/      STT / LLM / decider plugs
│   └── platform-win/   the Windows plug
├── supabase/           Edge Functions
└── docs/
```
