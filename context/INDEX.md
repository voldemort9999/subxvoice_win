# Context index

Rewritten in full by `/context-write`. Read this plus `CLAUDE.md` at the start of every session;
read a numbered file only when the topic table below points at it.

Where things live: this journal is `subxvoice/context/`; the `/context-read` and `/context-write`
commands are one level up at `pillow/.claude/commands/`, because Claude Code is rooted at `pillow/`
and that folder is not a git repository. See `subxvoice/CLAUDE.md` → "Context system".

Last updated: 2026-11-14 · after S-018 · `subxvoice-app` `main` (0.4.1 is `8418f9c`), nothing
uncommitted · website `main` at **`86f926a`** (pulled), live · current journal file **`002`**
(637 lines; `001` closed at 992).

> **Since 2026-11-17 SUBXVoice is Windows only.** macOS support and dead code were removed in
> `19ffa7d` (see `docs/decisions.md` 2026-11-17); older journal entries still describe the Mac work.
> **Since 2026-11-17 the app's main repo is `voldemort9999/subxvoice_win` (`origin`).**
> `subxvoice-app` is now the secondary remote `app`, frozen at `f0cea3a` (0.4.3) and pushed only
> when the user asks; the challenge pitch links to its `PITCH.md`. Not yet journalled: 0.4.2
> (sign-up signs you in) and 0.4.3 (chat-style dictation prompt; Gemini 3.5 Flash Lite racing
> gpt-oss-120b) — see `docs/decisions.md` 2026-11-14 and 2026-11-16 until `/context-write` runs.

## Where things stand

**The work now is a second demo video for Gnani AI's challenge, and it is on hold for a new
chat.** Everything decided and everything still open is in **002 S-018** — read that entry first;
it is written to be enough on its own. In short: Gnani AI's "Great Indian AI Internship Challenge —
Build Sovereign AI for India" (build on Gnani's own models; ten ₹50,000 awards; the user called
**2026-11-14 the final day**). The video should run **about 1 min 45 s**, must say it was built for
Gnani AI's challenge and that **Gnani's model (Prisma) does the hearing**, must not discuss the
team, and should serve the **Jugaad Genius, Mixed Vibes, Real Deal and Crowd Favourite** awards.
The old video script is not to be reused. Still undecided: the weight between the two keys, which
award leads, how the video is produced, the voice, and how to name the Prisma version.

**The product: SUBXVoice 0.4.1 (2026-11-14), live everywhere.** Two keys. **Follow My Words**
(Ctrl + Alt): say what you need done while you work — in Hindi, English or both — and it does it
in front of you: a WhatsApp message typed and left unsent, a resume found in Pictures, earbuds
connected, volume or brightness set, an app opened or closed, a song played on YouTube, tasks
typed into Notepad. Gemini 2.5 Flash plans the steps, Jev picks the action and the on-screen
element, Windows actions run in one PowerShell with C# (`packages/platform-win/src/commands.ts`,
`interop.ts`), screen control reads apps through UIA3 (`docs/command-mode.md`). **Dictation**
(Ctrl + Win): speak and the words are typed at the cursor in Roman Hinglish; ask for an email or a
message and it is written. Speech recognition is **Gnani's Prisma** (`prisma-v3.0`) for both keys —
the only Gnani model in the product. The installer (`SUBXVoice-windows-setup.exe`) is on
`subxvoice-releases` v0.4.1, served by the website's download button and to every install as an
auto-update.

**The website** (`voldemort9999/subxvoice`, `pillow/subxvoice-web`, Vercel, Lovable-connected)
opens on "Keep working. / Say the rest." Since `86f926a` (the user's other agent) both keys lead
**as equals**: two hero rows, "Ask it to do it." and "Say it to type it.", each cycling real
examples with a line for the moment in a working day. Below: the dark Follow My Words section with
tabs of real requests, "Two keys, one habit.", dictation, writing, features, privacy (what Follow
My Words reads), download, FAQ. The app leads with Follow My Words: dashboard panel, both keys in
the sidebar, its key in Settings, onboarding sets both (S-017).

Known weak spots, none blocking: "Pictures" is often misheard among Hindi; the planner sometimes
plans the same sentence differently; apps that draw their own screen (BlueStacks, games) cannot be
acted in (an image fallback was probed, not built). Nothing SUBXVoice is running on the dev machine;
0.4.1 installs itself on the next launch.

Three repos, and confusing them is the easy mistake: `subxvoice-app` holds the app (private);
`subxvoice` holds the website, working copy `pillow/subxvoice-web/` (private);
`subxvoice-releases` holds installers and `latest.yml` and **must stay public**.

## Continue from here

1. **The video.** Read 002 S-018. Ask the user the open questions there first — key weight
   (they said Follow My Words 60–80% before the site went equal), leading award, production
   method, voice, Prisma wording — then write the script (~250–270 words for 1 min 45 s), with a
   shot list. Assets and how to capture fresh app and website screenshots are listed in S-018.
2. Other loose ends (002 S-016/S-017 Open): "dictation: nothing heard" twice, unexplained; a
   second opinion that ran `open_folder` for an upload request and reported done; onboarding's
   "Your keys" step never captured in a preview.
3. Next release: bump `apps/desktop/package.json`; `dist:win`; smoke-test `dist/win-unpacked`
   (launch, attach the inspector, run a command through the workflow's `command` — 002 S-016);
   commit; push; `release:win`; check `latest.yml` and the site link.

### Methods that work here

- **Dev app**, from PowerShell: stop `electron`, free port 5173,
  `Remove-Item Env:ELECTRON_RUN_AS_NODE`, then
  `Start-Process cmd.exe "/c cd /d <subxvoice> && pnpm dev:desktop > <new log>" -WindowStyle Hidden`.
  Close the installed app first (single-instance lock; it starts itself after a reboot).
- **Installed exe** from an agent shell: `explorer.exe <path>` (ELECTRON_RUN_AS_NODE leaks in).
- **Inside a running main process** (dev or packaged): `node -e "process._debugProcess(<pid>)"`,
  CDP on 127.0.0.1:9229; a never-pausing conditional breakpoint in the hotkey `tick` grabs the
  poller, `[[Scopes]]` of its `onEvent` reach the `DictationController` and the workflow `deps`.
- **Dry-run commands through the real models**: copy `apps/desktop/src/main/command.live.test.ts`,
  record every effectful action (open_app included), log to a file (vitest swallows console.log),
  delete the copy afterwards (002 S-017).
- **Live suites**: `LIVE=1` for `packages/platform-win/src/commands.live.test.ts`;
  `LIVE=1 SUBX_TOKEN=$(node reference/command-tests/token.mjs apps/desktop/src/main/auth.ts)` for
  `apps/desktop/src/main/command.live.test.ts`; `LIVE_WHATSAPP=1` for `whatsapp.live.test.ts`.
- **Copy**: unslop (`github.com/theclaymethod/unslop`) — its scanners
  (`banned_phrase_scan`, `structure_scan`, `silhouette_scan`) run with plain `python`.
- **Long text / regexes**: the Write tool; never a Bash heredoc with quotes or backslashes.

## Topic → file

| Topic | File |
|---|---|
| **Second demo video: challenge, Gnani models, decisions, open questions, assets** | **002 (S-018)** |
| First demo video: script versions, Remotion project, captures, render | 002 (S-014 Part 1) |
| **Command mode / Follow My Words: design, loop, screen control, waits, WhatsApp, files, Bluetooth, images probe** | **`docs/command-mode.md`** |
| Naming and positioning of Follow My Words; risky-action agreement rule | `docs/decisions.md` 2026-11-14 |
| Site and app copy for Follow My Words; unslop; dry-run of site examples; preview harness | 002 (S-017) |
| Website pulled to "both keys as equals" (`86f926a`) | 002 (S-018) |
| Stuck "•••" pill (press race, watchdog); Roman retry | `docs/architecture.md`, 002 (S-015 Part 3, S-016) |
| The 0.4.0 release: smoke test, publish, verification | 002 (S-016) |
| Command mode user tests 1–9: what failed and each fix | 002 (S-014 part 4, S-015, S-016) |
| Invisible Explorer windows (`windowsHide`), `CmdBluetooth` | `docs/command-mode.md`, 002 (S-016) |
| UIA3 in C#, WhatsApp/YouTube tree facts, Jev element accuracy | `docs/command-mode.md`, 002 (S-015 Part 2) |
| Live-debugging the Electron main process | 002 (S-015 Part 3, S-016) |
| Jev with images (grid probe, limits, cost) | `docs/command-mode.md` → "Images", 002 (S-015) |
| Research of the three Jev repos and Windows MCPs | 002 (S-014 part 2) |
| Model comparison for the command writer | 002 (S-014 part 3), `docs/decisions.md` 2026-11-11 |
| **Design system** | **`docs/design.md`** |
| App redesign, preview harness, favicon cache | 001 (S-013) |
| `ELECTRON_RUN_AS_NODE` | 001 (S-013), `CLAUDE.md`, 002 (S-015) |
| Composing (Jev intent, decisions endpoint, tones) | 001 (S-012), `docs/decisions.md` 2026-11-10 |
| Pill/main window dying; `revive()`; single-instance lock | 001 (S-012) |
| Auto-update, release pipeline, public releases repo | 001 (S-011, S-013), 002 (S-016), `docs/decisions.md` 2026-11-01 |
| Gnani provider; Supabase backend; auth; daily limit | 001 (S-009, S-010) |
| Streaming pipeline; Windows hotkey and paste; toolchain traps | 001 (S-001, S-002, S-011, S-012) |

## Open decisions

- **The video** — key weight (Follow My Words-led vs equal), leading award angle, production
  method (user screen-records + Remotion / all Remotion / script only), voice, Prisma version
  wording. All in 002 S-018.
- **Image fallback for apps with no tree (BlueStacks)** — asked for on 2026-11-12; probe done,
  go-ahead not given.
- **Language picker** (fixed to hi-IN) — deferred by the user.
- **Per-device quota, or leave account-hopping open?** Unanswered since S-010.
- ~~UAC prompt~~ — not now, only when a need appears. ~~Confirm risky actions~~ — no "pakka?".
  ~~Send messages~~ — never, unless asked separately.

## Ruled out

- **Reusing the first video's script** — the product changed; user, S-018.
- **Asking the decider "what next?" after each step** — repeated actions. Plan first. 002.
- **A router between "API actions" and "UI automation"** — 002.
- **gpt-oss-120b / -20b as the command writer**; **gemini-2.5-flash-lite** — 002, `docs/decisions.md`.
- **.NET `System.Windows.Automation`** — blind inside WhatsApp's WebView2; UIA3 COM instead. 002.
- **A flat UIA `FindAll`**; **messaging as four planned screen steps**; **choosing a window by every
  word of the step**; **reading WhatsApp's results right after typing** — 002.
- **Supabase session lock as the cause of the stuck pill** — disproven live. 002.
- **`spawn("explorer.exe", …, {windowsHide})`** — opens folders invisibly. 002 S-016.
- **WinRT / PnP / Python libraries for Bluetooth device connect** — `docs/command-mode.md`.
- **`vite preview` for website screenshots** — fails on the Vercel build; use `vite dev`. 002 S-017.
- **Bundling the Python MCP**; **Fn in a hotkey**; **C# in a plain template literal** — 002.
- **Cerebras**; **Archivo Expanded**; **Marigold on Ice Silver**; **`npx electron-builder`**;
  **synthetic input to drive this app**; **Supabase Storage for installers**; **Soniox**; **a
  low-level keyboard hook** — 001, `docs/design.md`.

## Settled

- `context/` is committed — S-007. Email/password only — S-010. `dist:*` never publishes,
  `release:*` does — S-011. Every example on the site and in the app is real output — S-012.
- Command mode never touches dictation: separate key, separate writer, `Pipeline.listen()`.
- The original MCP at `Projects/mcp/computer-mcp` is never touched; the copy is in
  `reference/computer-mcp/` (gitignored). Do not push to or re-add `aryan-2255/subxvoice`.
- The website repo is connected to Lovable: never force-push or rewrite its pushed history.

## Sessions

| # | Date | What | File |
|---|---|---|---|
| S-001–S-008 | 2026-10-01 → 10-30 | Pipeline, Windows platform, prompts, context system, fresh repo | 001 |
| S-009 | 2026-10-30 | Gnani replaces Soniox; dashboard, insights | 001 |
| S-010 | 2026-10-31 | Supabase backend, accounts, 2 h/day limit | 001 |
| S-011 | 2026-11-01 | Auto-update, public release repo, website live | 001 |
| S-012 | 2026-11-02 → 11-10 | Composing via Jev; 0.1.3–0.2.0 fixes; website redesign | 001 |
| S-013 | 2026-11-10 | App redesign; favicon fix; 0.3.0 released | 001 |
| S-014 | 2026-11-10 → 11-11 | First demo video; command mode researched, built, first test | 002 |
| S-015 | 2026-11-11 → 11-12 | All Windows actions; screen control (UIA3 + Jev); eight user tests; stuck pill root cause | 002 |
| S-016 | 2026-11-14 | Invisible folders; Bluetooth devices; Roman retry; live suites; **0.4.0 released** | 002 |
| S-017 | 2026-11-14 | "Follow My Words" named; site and app lead with it; **0.4.1 released** | 002 |
| S-018 | 2026-11-14 | Website pulled (`86f926a`, keys as equals); second video prepared, on hold for a new chat | 002 |
