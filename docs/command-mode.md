# Command mode ("Follow My Words") — speak, and the computer does it

Hold a second key, say what you want in Hindi, English or both, and the machine does it. The
existing hotkey still dictates; this is a separate key that acts instead of typing.

Written 2026-11-11. The plan, and the reasoning behind the shape.

## Why this shape

Windows has English voice typing. It has no voice *control* in an Indian language at all. That is
the gap, and it is the product's own gap too — SUBXVoice already hears Hinglish better than
anything on the machine, and that hearing was only ever used to type.

## The loop, not a router

The first design asked a model to choose between "do it through an API" and "do it by driving the
screen". That was dropped. Three reasons: many requests need both ("open Chrome *and* play this
song"), the user never thinks in those terms, and it costs an extra model call per step.

Instead there is one loop:

```
observe  →  build candidate actions  →  Jev picks one  →  run it  →  observe again
```

Jev is never told how an action is carried out. Every candidate is described by its **outcome**:

```
  "Set the volume to 50%"            (runs through a Win32 call)
  "Click the volume slider"          (runs through UI Automation)
```

Jev picks the first because it matches what was said, not because anything told it which
subsystem owns the job. The mechanism travels with the candidate, invisible to the model.

This is the shape `browser-use/jev-ultrafast` and `ZJU-REAL/CUA-JEV` both arrived at separately.

### Plan first, then act (changed 2026-11-11, after the first real use)

The first loop asked the decider after every step what to do next, with `done` as one option.
On real use it rarely chose `done`: "hai type karo" typed *hai* six times, "volume 100% kar do" set
it twice, and "close the BlueStacks instance manager" went on to close the main BlueStacks window,
which nobody asked for. Memory made it worse — "hi likho" right after an earlier "hi" was judged
already done and nothing was typed.

So the loop is now `packages/core/src/agent/loop.ts`:

```
writer splits what was said into ordered steps  (sees the capability list, so "play Kesariya on
                                                 YouTube" is one search step, not three)
for each step: decider picks the action (or nothing_fits) → writer fills its details → run
```

The number of steps is fixed before anything runs, so nothing can repeat and nothing has to
recognise "done". An empty plan means "not a command". Actions that lose work (`risky`) need
decider confidence ≥ 0.7; everything else ≥ 0.5. Every model or network failure becomes a pill
message instead of an exception.

## Two models, two jobs

Jev cannot invent an action. It picks one key out of a map of named options
(`contracts/decider.ts`). So:

| Model | When | What it answers |
|---|---|---|
| **Jev** | every step | which action carries out this step |
| **Writer** — `google/gemini-2.5-flash` (was flash-lite; see decisions 2026-11-11) | once to plan, then once per step that has details | the steps; the volume level, the URL, the text |

Not gpt-oss-120b, which dictation still uses: on 17 Hinglish commands × 3 runs (2026-11-11) it
understood everything but took over 2 s on 19 of 51 calls, up to 15 s. Gemini 2.5 Flash Lite got
51/51 at a steady ~1 s, and 17/17 on Devanagari input once its prompt said to transliterate.
gpt-oss-20b was fast but dangerous (it listed Chrome among the windows to close when told to keep
Chrome). Jev was 42/42 on Roman input and 21/21 on Devanagari. The writer runs with reasoning off
and an 8 s timeout. The test script is in `reference/command-tests/` (gitignored).

The writer's JSON is parsed leniently only where there is one meaning (`parseArgs`): a fence, the
fields wrapped in the action's name, a bare list for a one-field action, and junk after a complete
object — Gemini once answered `{"url": "…"}` then `\n"}`.

## Action sources

The loop knows nothing about where an action came from:

```ts
interface ActionSource {
  observe(): Promise<string[]>;        // what is true right now
  actions(): Promise<AgentAction[]>;   // what could be done next
}
```

- **`WinCommandSource`** — Win32 and shell. Volume, per-app volume, Bluetooth, Wi-Fi, launching apps,
  windows, processes, files. Built first.
- **`screenSource`** (`packages/core/src/agent/screen.ts`) — the screen, through the OS's
  accessibility tree: `screen_click`, `screen_type`, `screen_read`. The OS side is a
  `ScreenDriver`; on Windows, `WinScreenDriver` (`packages/platform-win/src/screen.ts`). See
  "Screen control" below. Turning it on changed nothing in the loop except that `run` now receives
  the step it is running.

Perception is the tree, never pixels. Windows keeps a list of every control in every window, with
names and types, and that is text — no vision model, and a click lands on "the Search button"
rather than on a coordinate that a different screen size would move. The cost is that an app which
draws its own interface (BlueStacks, games, canvas) exposes nothing, and those are out of scope
(the user chose to leave a vision fallback for later).

## Screen control

The shape is the one `ZJU-REAL/CUA-JEV` and `browser-use/jev-ultrafast` use: code turns what is on
screen into a numbered list of elements, Jev picks the one a step acts on, and the writer only
supplies text to type. Jev cannot invent an element, so it cannot click something that is not there.

```
step "Play the second video on YouTube"
  → decider picks screen_click (over open_web etc.)
  → driver.read(step): the window the step names (title/program words), else the one in front
  → clickable(): one element per name, most clickable role, web-page text and images dropped
  → Jev picks e70 "Link Kesariya - Brahmāstra …" (or nothing_fits; < 0.5 is not acted on)
  → driver.click(70): UIA Invoke if offered, else a real click at its centre, cursor put back
```

**Direct first.** The planner is told to use the screen only for what is inside an app's window
and nothing direct can do; the screen actions describe themselves the same way. Volume, apps,
windows, keys, files and searches-by-URL never go through the screen.

**UIA3, declared by hand** (`CmdUia` in `interop.ts`). The .NET `System.Windows.Automation` client
saw only five title-bar buttons in WhatsApp (WinUI around WebView2); the native COM API sees the
whole app. Only the vtable slots up to the last one called are declared, and every property is
read by id. **The tree is walked depth first, never entering an off-screen subtree**: a flat
`FindAll` over WhatsApp's ~21,000 elements took 2.4 s; the walk visits ~360 in ~90 ms (Chrome's
YouTube page ~60 ms). Depth first keeps the window's own top-to-bottom order, which "the second
video" depends on. Chromium enables page accessibility only once asked, so a bare first read of a
browser (under 60 elements) is read again.

**Names, measured.** Jev on YouTube- and WhatsApp-shaped lists: 11/11, 0.5–1 s, including "the
second video" and nothing_fits for a WhatsApp chat on a YouTube page. On the real YouTube page Jev
first split its vote, because each video is a Text, a Link and a Group of the same name, plus a
second link worded differently at the end ("… · 2:53" / "… 2 minutes, 53 seconds"); `clickable()`
keeps one per 40-character start. YouTube also reorders results between loads, so "second" is
whatever is second now.

**Ordinals are labelled, not counted.** Content items — links and rows with long names — are
offered as "1st result: …", "2nd result: …". Jev is a classifier: asked for "the 4th video" among
62 unnumbered options it spread its vote at 0.2–0.27 and nothing was clicked; labelled, it chose
the 4th at 0.99.

**A second opinion when Jev is unsure.** Below 0.5 the writer reads the same numbered list and
names an element; it is clicked only if Jev had it in its own top three, so both must point the same
way. A confident nothing_fits is never overruled. ("Aryan Monday" was opened this way at Jev 0.49.)

**Multi-step tasks hold together** (after the fourth test, 2026-11-11). Each piece is checked, not
assumed:

- *The app is there.* Messaging plans start with "Open the app WhatsApp" (it only brings it forward
  if open), and a screen step that names an app with no window — "in WhatsApp", "WhatsApp's …" —
  starts it (`launchNamed`) and waits for its window. A window behind others is brought forward.
- *The box is the right one.* A box with no name is described by where it sits ("at the top, where
  a search box usually is"): WhatsApp's search box loses its name and placeholder once it holds a
  search. With only one box on screen and Jev's top pick being it, it is taken.
- *Old text goes.* Typing selects all in the box first, so a leftover search or an unsent draft is
  replaced, not added to ("hiHigh CourtHi, message" in real use).
- *The text landed.* The box is read back after pasting; if it does not show the words, the step
  fails and says so.
- *Unsure is asked twice.* When Jev is under the floor, the writer picks between Jev's top two
  actions (or top three elements) and is acted on only when it agrees; a risky action still needs
  Jev's own 0.7, and a confident nothing_fits is final.

The whole messaging flow is tested for real by `apps/desktop/src/main/whatsapp.live.test.ts`
(LIVE_WHATSAPP=1) on the user's own "Message yourself" chat: WhatsApp minimized → search →
open chat → type "hi" → not sent → draft and search cleared.

**Play means play; and carrying on** (after the fifth test, 2026-11-11):

- "Chalao / lagao / play" on YouTube is two steps — search by address, then click the 1st result;
  "search karo" stops at the results. The driver waits for a browser page to fill in (up to ~3.5 s)
  before reading it, so the click lands on the results, not the loading toolbar.
- Where items carry a running time ("4 minutes, 22 seconds", "· 3:45"), only they are numbered:
  YouTube's sidebar channels ("Kahani YT. New content available.") are long-named links too.
- `AgentMemory.continuing()`: a command within 3 minutes of the last one is told "Continuing: the
  last command did …", and one that names no app or site carries on there — "first wala chalao"
  after a YouTube search, "usko hello likho" after opening a chat. Older than that, a command
  stands alone, as the user asked.
- A screen step that names its place ("in YouTube", "into WhatsApp's search box") acts there or
  says it isn't open — never on whatever window is in front. Only the place's name chooses the
  window: the step's own words ("search") once matched a Chrome tab titled "… Google Search".
- `open_web` opens in the tab in front when that tab is a blank new tab, or when the user said
  "yahan / isi tab mein" — through Ctrl+L, the address and Enter.

**WhatsApp messages are one fixed procedure, `whatsapp_message`** (after the sixth test). Planned as
four screen steps, the flow broke whenever the planner skipped one: with an earlier search ("NL")
still in WhatsApp's box, "Aryan ko hi bhejo" was planned as "open Aryan's chat" alone, Aryan was
not in the filtered list, and three commands failed in a row. The action now always: opens or
brings forward WhatsApp → replaces the search with the name → takes the first row that *starts
with* the name (chats come before message hits; "2 unread messages" and "@" are ignored) → tries
the writer's other spellings for a misheard name → opens it → types into the box named "Type a
message…" and reads it back (for up to 1.5 s; a group's box reported late). It never sends. A name
that matches nothing says so: "No WhatsApp chat called "NL"". Tested for real on the user's own
chat, starting from a stale search and a minimized window.

**Waiting only for what is loading** (2026-11-12). Right after a reboot WhatsApp shows its window
seconds before its chat list, and a single read said "Couldn't find WhatsApp's search box".
`screen_click` / `screen_type` (`settled()` in `core/agent/screen.ts`) read again every 0.8 s while
the window's elements keep changing, up to 10 s, and ask Jev again only when something changed; a
window that has stopped changing and still lacks the element is an answer at once. A launched app
gets up to 15 s to show a window (`LAUNCH_WAIT_MS`). `whatsapp_message` waits for each thing it
needs by name: the search box (20 s, cold start), the filtered list, the chat's box (4 s). Every
wait ends the moment its element appears, so an app that is ready costs nothing.

**WhatsApp checks it opened the right chat** (2026-11-12). For a moment after the search is typed,
the list still shows the unfiltered chats; "Aryan" was found there, and by the time the click
landed the filtered list had moved "Yash arya" into that row's place — "hi" went into Yash arya's
box. Now the result rows are read until two reads agree (`whatsappResults`), and the message box,
which names its chat ("Type a message to Aryan"), must name the one asked for: otherwise nothing is
typed and the step says which chat opened instead.

**Never sends** (the user's rule, `docs/decisions.md` 2026-11-11). `screen_type` pastes and stops;
after anything is typed, `holdBackSending` drops a later send or Enter step unless the user said
"enter" or "search" themselves; the pill then says "not sent — say 'send it'". The planner had
planned "Press Enter" for "Aarnav ko hi bhejo" despite being told not to.

**What leaves the machine.** The read window's element names (chat names, titles, previews) go to
Jev and the writer through the app's backend when a screen action runs — the user agreed. Password
boxes' contents are never read.

## Memory

A rolling trace of the last ~10 steps and the current observation, expiring after 10 minutes idle.
Not a chat log. This is what makes "open Notepad" then "now write this in it" resolve — the trace
says Notepad was opened and is focused.

## Where it plugs in

Almost nothing new is needed around the edges, because the app was already built for it:

- `HotkeyBinding` already carries a `mode`, and the Windows layer already watches several
  bindings at once. A third mode, `"command"`, is all the hotkey layer needs.
- `DictationController` already passes that mode to `engine.open(mode)`. The controller is
  untouched except for allowing the new mode.
- So command mode reuses the streaming microphone, the Gnani stream, the pill, and the level
  meter for free. The only new branch is in `workflow.ts`: on `"command"`, run the loop instead
  of pasting.

**`Ctrl+Alt`**, not `Fn+Alt`. The Fn key is handled inside the keyboard's own firmware and never
reaches Windows, so no application can watch it — `packages/platform-win/src/hotkey.ts` lists the
whole vocabulary, and Fn is not in it. Releasing a chord that includes Win can also open the Start
menu, which `Ctrl+Alt` avoids.

## Safety

This runs with the user's full access on someone else's machine, driven by speech that may have
been misheard. So:

- The pill says what is happening as it happens.
- No spoken confirmation (the user's call, `docs/decisions.md` 2026-11-11). Instead, actions that
  lose work or cannot be undone by voice are `risky` and need the decider at ≥ 0.7: closing
  windows, stopping programs, and turning Wi-Fi off — which also cuts the speech service, so it
  could not be turned back on by voice.
- Windows itself, the shell, security and this app are never stopped, whatever was heard.
- A plan longer than six steps is cut there.

## No elevation

Every action in the first scope — volume, per-app volume, Bluetooth, Wi-Fi, launching apps,
windows, user-owned processes, searching the user's own folders — runs with ordinary user rights.
Administrator is only needed for services and the deeper registry, which nothing here touches. So
install is unchanged and there is no UAC prompt.

## Not bundling Python

`reference/computer-mcp/` is a read-only copy of the personal MCP (the original stays at
`Projects/mcp/computer-mcp`, untouched). It is **reference, not a dependency** — gitignored, never
imported, never shipped.

Its core reaches Windows through `ctypes` into system DLLs. This app already reaches Windows
through koffi into the same DLLs. Porting the ten or so calls that are needed is therefore the
same work in a different language — and it avoids bundling a Python runtime, a second process, a
PyInstaller binary that an unsigned installer would have to explain to antivirus, and the two
elevated hosts the MCP normally runs as.

The most valuable thing in that copy is not its code. It is the record in each module of what was
tried and did not work.

### How the Windows side actually runs

`packages/platform-win/src/powershell.ts` keeps **one PowerShell process alive** and talks to it in
JSON lines (`{id, code}` base64'd → `{id, ok, value|error}`). `interop.ts` holds C# that it compiles
once with `Add-Type`: the MCP's audio interop copied unchanged (`CmcpAudio`), and its window code
translated from ctypes (`CmdWindows`: the shell's taskbar filter, cloaked windows, Store apps' real
process, and attaching input queues to take the foreground). Measured: ready in ~440 ms, then ~2 ms
for the volume and ~20 ms for the window list; Devanagari round-trips exactly. The C# is held in
`String.raw` — a plain template literal ate its backslash escapes and Add-Type failed to compile.
Windows PowerShell 5.1's compiler is C# 5: no interpolated strings, no `out var`.

Apps launch through `explorer.exe shell:AppsFolder\<AppID>` from `Get-StartApps` — the Start menu's
own list, so Store apps like WhatsApp work and nothing is hard-coded.

## What it can do (2026-11-11)

All in `packages/platform-win/src/commands.ts`, each checked on the dev machine by
`commands.live.test.ts` and, through the real models, by `apps/desktop/src/main/command.live.test.ts`.

| Action | Covers |
|---|---|
| `open_app` | anything in the Start menu, Store apps included; the writer sees the installed list and picks by sound — "cloud app" is Claude, "instance manager" is BlueStacks Multi-Instance Manager; several equal matches take the plainest name |
| `open_web` | a site, or a YouTube / Google / Gmail search — "play Kesariya on YouTube" |
| `set_volume`, `app_volume` | overall volume and mute; one app's volume |
| `type_text` | type into the focused app, transliterated to Roman |
| `press_keys` | paste, copy, save, undo, Enter, new tab — any chord in `hotkey.ts`'s vocabulary |
| `close_windows` (risky) | close named windows; two windows with the same title mean the topmost, never both |
| `arrange_windows` | minimize, maximize, restore, switch to; a program name means all its windows; "restore" with no name restores what is minimized |
| `find_files`, `open_folder`, `make_folder`, `copy_files` | search the user's folders (or the folder open in File Explorer) by the words of a name, show it; copying never replaces a file |
| `screenshot` | the largest display by default, into Pictures\Screenshots and onto the clipboard |
| `kill_process` (risky) | stop a program, e.g. the heaviest |
| `brightness` | set or read: WMI for a laptop panel, DDC/CI for monitors |
| `bluetooth`, `wifi` (risky) | the radio on/off (Wi-Fi also restart), WinRT `Radio`, read back after |
| `bluetooth_device` | connect / disconnect a paired device by name ("OnePlus Buds se connect karo"); radio switched on first; `CmdBluetooth` in `interop.ts`, ported from the computer-mcp: connecting cycles the device's audio services off and on (a plain enable is refused as "already enabled"), ~6 s; disconnect is `IOCTL_BTH_DISCONNECT_DEVICE`. Pairing a new device stays in Settings |
| `power` (risky) | lock, sleep, restart / shut down in 15 s, sign out, cancel a shutdown |
| `system_status` | battery, memory, disk |
| `screen_click`, `screen_type`, `screen_read` | inside an app: a result, a chat, a search box, a question about what it shows (see "Screen control") |

`find_files` opens the folder of the newest match with every match in it selected, the way "Show in
folder" does (verified with `Document.SelectedItems()`: selection holds in a fresh window and an
open one). A matching *folder* is opened itself. Matches elsewhere are named by folder in what it
says — "(also in C:\Users\…\Pictures: My Resume.pdf)" — so "Pictures wala" can follow; the newest
match is not always the one meant. "In" given as "this / current folder" means the topmost File
Explorer window's folder; a place that is not one (misheard "features", a path the writer made up)
searches everywhere rather than finding nothing. The planner keeps the place in the step ("Find
the file resume in Pictures").

**What speech recognition is primed with in command mode.** `Pipeline.listen()` sends
`COMMAND_TERMS` (`core/pipeline.ts`: Pictures, Documents, Downloads, folder, File Explorer,
WhatsApp, YouTube, Chrome, BlueStacks, …) as Gnani keyterms ahead of the dictionary. Among Hindi,
"Pictures wale folder" came back as "search folder", "features wale folder" and "इस तरह वाले folder"
across seven tries on 2026-11-12. Whether keyterms fix that is not yet measured.

Offered but unavailable, so it is refused honestly instead of matched to something nearby:
`focus_mode`.

**File Explorer windows are opened through `showFolder`, never `spawn("explorer.exe", …,
{windowsHide})`.** That made real but invisible windows (`Shell.Application` reported them
`Visible=False`): "Opened Pictures" was said three times on 2026-11-14 and nothing appeared.
`showFolder` reuses a visible window on the folder or starts one, waits for it, brings it forward,
and fails if none appears — so "Opened" is only said about a window that is there.

### What the planner is told, and why

`SPLIT_SYSTEM` in `loop.ts` carries one rule per failure seen in the user's second test
(2026-11-11): never search the web as a fallback for something not understood (a misheard app
became "open Chrome, search YouTube"); an app name stays as heard for `open_app` to match by sound;
type only when asked (garbled speech was typed out, chat was typed out); a tab is Ctrl+W, never its
window (a whole Chrome window was closed for one tab); a question about what an app shows is screen
reading (it once opened WhatsApp and typed a search); never copy an earlier result as a step. A
step said twice is dropped in code, and a failed writer call is retried once after 0.7 s.

After the third test: earlier commands are shown under their own heading, "already done — never
plan them again" (a finished `kill msedgewebview2` was planned again for "shutdown karo");
"Chrome pe WhatsApp kholo" is the website; and a run that stops partway says what it could not do
instead of showing only what it did.

## Images: what Jev can do with a screenshot (measured 2026-11-12)

For apps with no accessibility tree (BlueStacks, games). `typesafe/jev-1.14` accepts images on
OpenRouter's Decisions API as `{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,…"}}`
in `state`, and the app's backend (`supabase/functions/llm`) passes it through unchanged. Each side
must be 256–1,568 px (a 1096×1888 window capture was refused "Invalid image dimensions"; scaled to
871×1500 it was taken). TypeSafe's "Box" question (an object's edges) is not served through
OpenRouter, so location has to be asked as a choice: a numbered grid drawn on the screenshot, "which
cell contains X". One request with three questions: ~1 s, 7.4k input tokens, **$0.0003**. On a
BlueStacks window, two things not on screen got 0.23 and 0.17 (rightly unsure); the one present, an
X button, got **0.89 for the cell next to the right one** — a 6×10 grid is too coarse to click from.
TypeSafe calls image input "danger zone, not for production". The test is
`reference/command-tests/grid.ps1` (capture + grid) and `jev-image.mjs` (gitignored, local only);
a design would need a second, zoomed pass and a confidence floor before any click.

## Out of scope for now

- Anything inside an app that draws its own screen (BlueStacks, games) — see "Images" above.
- Chaining across more than one app in a single sentence beyond launch-then-act.
