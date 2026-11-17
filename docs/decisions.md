# Decisions

Newest first. Add an entry whenever you pick one option over another — one short paragraph, with the why.

### 2026-11-17 — Windows only
The user decided SUBXVoice is a Windows app. Every other platform's code, build and docs were
removed, along with code nothing used. The plug architecture stays: core still talks only to
interfaces, and `platform-win` is the one OS plug.

### 2026-11-16 — Dictation is written like a chat message, and every Roman dictation goes to the model
The user found the old dictation output poorly written. It added formal capitals and full stops
everywhere, and it turned each "।" that Gnani puts at a pause into a full stop. It also kept
misheard words. The new `dictationPrompt` draws on the user's own history and on VoiceInk's and
OpenWhispr's cleanup prompts. It repairs a misheard word only when a sound-alike is more likely
than the word as heard (the user's bar: "more than half sure"). It writes every Indian language
phonetically in Latin letters and never translates. Its style: no full stops, few commas, a
question mark only on a real question, lowercase except names. `tidyDictation` enforces the
punctuation after the model. English now goes to the model too, which costs it about a second, so
that misheard words and the style are fixed there as well. Emails and messages are unchanged: the
user will work on them separately.

### 2026-11-16 — Dictation rewriting races Gemini 3.5 Flash Lite against gpt-oss-120b
The user asked for Gemini 3.5 Flash Lite, pinned to Google's priority tier
(`only: ["google-ai-studio/priority", "google-vertex/global/priority"]`; OpenRouter answers 404
for an unknown tag, so the pin is real). gpt-oss-120b on Groq is the backup. `RaceLlm` asks the
backup only if Flash Lite has not answered within 1.5 s, or has failed, and types whichever
answers first. Measured: Flash Lite took 0.7–1.1 s, gpt-oss 0.4–1.1 s. A race means the loser's
request is also paid for. Follow My Words keeps its own model (`writer`) and is not part of the
race.

### 2026-11-14 — Creating an account signs you in
Sign-up used to sign straight back out and return the user to the sign-in form, so that they
would use the new password at once. New users read the bounce as a failed sign-up, typed their
details into the sign-in form for an account that had never been created, and were told the email
and password "don't match". Supabase gives the same "Invalid login credentials" for a missing
account as for a wrong password. So sign-up now keeps the session and goes straight to onboarding,
and the sign-in error names both possibilities and points to "Create one".

### 2026-11-14 — Command mode is called "Follow My Words", and it leads the product
The user chose the name (from fifteen offered) and the positioning: SUBXVoice is presented as a
helper you talk to while you work — voice typing taken further — not as a dictation app with an
extra. The website and the app lead with Follow My Words (Ctrl + Alt) and keep dictation
(Ctrl + Win) as a normal, smaller part. Claims stay to what was run through the shipped models:
messages are shown as typed and left unsent, never sent. "Command" remains the word in code.

### 2026-11-14 — A risky action Jev chose at 0.6–0.7 is done when the writer independently agrees
"Notepad band karo" was `close_windows` at 0.69 with the writer agreeing, and nothing happened
because risky actions needed Jev's own 0.7. Two models choosing the same action is now enough
down to 0.6 (`AGREED_RISKY_CONFIDENCE`); at 0.5, where "band karo" splits between closing a
window and killing a program, it stays refused.

### 2026-11-11 — The command writer moves from gemini-2.5-flash-lite to gemini-2.5-flash
Screen control made plans longer (search, open the chat, type) and the planner's prompt grew a rule
per failure. Flash-lite then broke a different command with each prompt change — "hi likho" typed
literally, a song searched twice, an earlier command planned again. On the 22-command end-to-end
suite flash held 20–22/22 against flash-lite's 17–18, for ~0.3 s more per command. Still no
reasoning. `COMMAND_MODEL` in `.env` overrides it in development.

### 2026-11-11 — Command mode types messages but never sends them unless asked separately
The user's rule: "dost ko message bhejo" types the message into the chat and stops; only a later
command that asks for nothing but sending ("ab send kar do") sends it. Handing an AI the last
step of a message to a real person was judged too much responsibility. Enforced in code
(`holdBackSending`), not just in the planner's prompt, because the planner planned "Press Enter"
for "Aarnav ko hi bhejo" while being told not to.

### 2026-11-11 — Screen control reads the accessibility tree through hand-declared UIA3, and Jev picks the element
The approach of `ZJU-REAL/CUA-JEV` and `browser-use/jev-ultrafast` (numbered elements, a classifier
picks one) rather than a vision model: text in, no pixels, a click on "the Search button" rather
than a coordinate, 0.5–1 s per choice. UIA3 (native COM) rather than .NET's
`System.Windows.Automation`, which sees nothing inside WhatsApp's WebView2; declared by hand in
C# rather than bundling FlaUI's interop DLL, since it needs a dozen slots and runs in the existing
PowerShell worker. Screen text reaching Jev and the writer was agreed by the user. A vision
fallback for apps with no tree (BlueStacks, games) is deferred by the user.

### 2026-11-11 — Command mode does not ask "pakka?" before risky actions
The user chose no spoken confirmation. Actions that lose work or cannot be undone by voice —
closing windows, stopping programs, turning Wi-Fi off (which also cuts the speech service) — are
marked `risky` and need the decider at ≥ 0.7 instead of 0.5; the pill says what is happening as it
happens. A confirmation would be one more round trip in every demo for a case the plan-first loop
and the floor already guard.

### 2026-11-11 — Command mode plans first, and its writer is Gemini, not gpt-oss
Command mode (hold Ctrl+Alt, say what to do) splits what was said into steps before acting, then
lets Jev pick the action for each step. The first version asked Jev after every step whether more
was needed; in real use it repeated actions — six identical typings, and a window closed that
nobody named. A fixed plan cannot repeat. The writer that plans and fills in details is
`google/gemini-2.5-flash-lite`, not the gpt-oss-120b dictation uses: same understanding, but
gpt-oss stalled for 2–15 s on 37% of calls through Groq that day, which a user waiting on a
command feels. The Windows side reuses the personal computer-mcp's audited C# inside one
long-lived PowerShell instead of porting it or bundling Python. Details in `docs/command-mode.md`.

### 2026-11-10 — In the app, the user's voice is a typeface, not a colour
The old palette spent two colours on meaning: violet for the product acting, cyan for the user's
voice. The new one has a single accent, so the split moved from colour to type, the same way the
website already makes it: what the microphone heard is DM Mono in `--ink-soft`, what was typed is
Archivo on a Marigold edge. Marigold keeps "the product acting and its result" — the primary
button, the current page, today's bar, time saved. There is no red or green left either; anything
needing attention is a `Notice` with a Marigold edge, and the pill shows errors as Marigold type on
Aubergine. The pill is Aubergine in both themes because it floats over other apps. The sidebar is
the one inverted surface, which is what lets the current page be Marigold *text*. Fonts are
bundled from `@fontsource` rather than linked from Google as the site does: the window must work
offline and its CSP allows only `'self'`.

### 2026-11-10 — Three colours at 60/30/10, and Marigold is a fill
The user supplied Ice Silver `#DDE3E8`, Deep Aubergine `#3A0F34` and Marigold `#EAAA00` in that
order, to be used roughly 60/30/10. Measuring Marigold on Ice Silver settled how it behaves
everywhere: about 1.9:1, which cannot be read, so it is a fill on light ground and only becomes
type on Aubergine (7.5:1). That makes the 10% self-enforcing — there is no way left to overuse it.
The site went light-led; the app follows, light by default, which reverses the S-009 reasoning that
dark suited a window sitting open beside other work. Display face is Bricolage Grotesque: Archivo
Expanded was tried first and rejected as stretched, because it widens the face to gain presence
where Bricolage has an optical-size axis. The whole system is written up in `docs/design.md`,
which is the brief for the app's redesign.

### 2026-11-10 — Composing is classified by a decisions model, not a chat model
`typesafe/jev-1.14` is not reachable on `/chat/completions` — it refuses outright and names
`/api/alpha/decisions`, which takes named criteria and returns a probability per option. That is
why `supabase/functions/llm` is path-aware and why the pipeline can hold a real 0.7 confidence
threshold instead of parsing prose. Measured: 12 of 12 classified correctly at ~500ms and about
$0.000017 a call. Everything about the path is biased toward not composing — below the threshold,
on a failed call, with no classifier, or on an empty result, the user's own words are typed —
because typing what somebody said is never wrong, while composing uninvited destroys their
dictation.

### 2026-11-01 — Installers go to a separate public repo, not the source repo
`subxvoice-app` is private, and a private repo's release assets return 404 to anonymous callers —
the website's download button and every `electron-updater` check would both have seen a repo with
no releases in it. The two alternatives were making the source public, or shipping a GitHub token
inside the app so it could authenticate, which is the exact thing the Supabase work was done to
avoid. So `voldemort9999/subxvoice-releases` exists, holds only installers and `latest.yml`, and is
public; the source stays private. The website and `app-update.yml` both read from it, and because
`releases/latest/download/` always resolves to the newest release, publishing a version never
requires redeploying the site. **This repo must stay public** — making it private silently breaks
downloads and updates together.

### 2026-11-01 — Building an installer and publishing one are different commands
`pnpm dist:win` runs `electron-builder --publish never`. `pnpm release:win` is the only path that
publishes. The requirement was explicit: an installer built to test something must never become an
update that installed copies download. Keeping them as one command with a flag was rejected because
the dangerous case is the one you reach by habit. `scripts/release.mjs` reads the GitHub token from
the credential helper git already pushes with, so no token lives in a file or in shell history, and
it creates the release before electron-builder runs — electron-builder uploads artifacts
concurrently and every uploader creates the release if it finds none, which on a first publish
raced into two half-filled releases sharing one tag.

### 2026-10-31 — Both vendors move behind Supabase, because Gnani has no short-lived tokens
Checked rather than assumed: Gnani's docs have no authentication section at all, only a long-lived
`x-api-key-id` on the websocket upgrade, and they tell you to proxy from a backend to keep it off the
client. So `supabase/functions/stt` relays the dictation socket and `supabase/functions/llm` forwards
rewriting, both with JWT verification on; the app signs in with email and a password and holds no
vendor key. Measured on a real recording, three passes each, release-to-text goes 462ms direct to
503ms relayed — about 40ms, against the 100ms we were willing to spend. The handshake costs more
(182ms to 517ms) but runs at key-down while the user is still speaking, and audio is buffered until
it completes. Three things the relay had to be shaped around, all found by testing: this runtime has
no `WebSocketStream` and Deno's `WebSocket` cannot set headers, so the upstream leg uses `npm:ws`;
the upstream socket must be opened from the client socket's `onopen`, because starting it any
earlier leaves the client connection dead; and `ws` reports every frame as a Buffer, so the frame's
own binary flag is what separates a transcript from audio.

### 2026-10-30 — Gnani replaces Soniox for speech-to-text
Gnani (`wss://api.vachana.ai/stt/v3/stream`) is now the only STT plug; the Soniox provider is gone. The
switch was a project requirement, not a measurement, but the measurements that came with it shape the
configuration. `prisma-v3.0` over the default `prisma-v2.5`: v3.0 writes Indian-accented English in Latin
script, where v2.5 writes it in Devanagari — the input that produced "Pleez note dait" (see the prompt
entry below), so the STT now avoids a problem the prompt had to repair. One locale, `hi-IN`, and
deliberately not `indic-auto`: auto-detection guessed Telugu on a Hindi-English clip and returned Telugu
script. `format=verbatim`, although `transliterate` returns Roman script directly and could in principle
replace the LLM pass — it paraphrases ("मैं अभी वाइवा दे रहा हूँ" came back as "main abhi vaivada de
raavu"), so the LLM still owns Hinglish. Dictionary words go in the `keyterms` header and measurably help:
without them "what's up" came back as "WhatsApp" and "Bhavesh" as "भविष्य". The cost is the tail: Gnani
finalises in ~250–500 ms against Soniox's ~50 ms, so release→paste grows by roughly that much.

### 2026-10-01 — Paste keeps the user's whole clipboard
Paste goes through the clipboard, so we snapshot every format first (Electron 44's `clipboard.read()`,
read eagerly because items are lazy) and restore it ~400 ms later. Restoring only text would erase an
image the user had copied. A failed paste never loses the dictation: it is saved to history and the
text stays on the clipboard.

### 2026-10-01 — Windows hotkey by polling key state (koffi), not a keyboard hook
A low-level keyboard hook (uiohook-napi) is silently removed by Windows when its callback is slow, and one
exception kills it for the rest of the run. Polling `GetAsyncKeyState` every 15 ms can't be revoked and
can't miss a key-up. koffi calls Win32 directly; `user32.dll` is loaded on first use, so importing the package costs
nothing.

### 2026-10-01 — Soniox for speech-to-text, OpenRouter for Roman script
Soniox streams over a websocket while the user talks, so only the tail is left at key release, and it
handles Hindi-English code-switching. Roman-script (Hinglish) output is a transliteration pass through
OpenRouter's `gpt-oss-120b`, routed to Cerebras first (fastest and most consistent in our Hindi-English
benchmark), Groq as fallback; pure-Latin text skips the LLM entirely. Keys come from `.env` in development
only, until the backend issues tokens.

### 2026-09-30 — TypeScript everywhere, Electron for desktop
The team does not know Rust. Electron keeps every part (desktop, backend, website, MCP) in TypeScript,
and Node in the main process runs the MCP SDK, SQLite and system hooks directly. Cost: ~150 MB RAM and a
~100 MB installer. The UI is React and core is interface-based, so moving to Tauri later only means
rewriting the Node-specific plugs.

### 2026-09-30 — Backend in TypeScript (Hono), not Go
The backend is light (login, sync, stats, tokens); the heavy work happens at STT/LLM providers. One
language and shared Zod types matter more than Go's speed here. Any single service can be rewritten
later without touching the app, because the API contract stays the same.

### 2026-09-30 — Plug-point architecture
Core defines interfaces; vendors, the OS and storage are plugs. Lets us start on vendor APIs and
switch to our own models later, add a fallback provider, and test core without Windows or a mic.

### 2026-09-30 — Local-first privacy
Audio, transcripts and history stay on the device. The server only stores numbers (stats), synced
settings and team data.

### 2026-09-30 — Offline model: space reserved, not decided
A local STT model (~400–600 MB) would be one more `SttProvider`, downloaded on demand and run as a
sidecar process. Nothing is built for it yet.
