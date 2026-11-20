import { spawn } from "node:child_process";
import { basename, dirname } from "node:path";
import {
  type ActionSource,
  type AgentAction,
  closest,
  resolveOne,
  type ScreenElement,
  type TextInserter,
} from "@subx/core";
import { WinScreenCapture } from "./capture";
import { KEYS } from "./hotkey";
import { WinScreenInput } from "./input";
import { INTEROP } from "./interop";
import { asOwnInput } from "./own-input";
import { PowerShellWorker, psQuote } from "./powershell";
import { WinScreenProbe } from "./probe";
import { BROWSERS, WinScreenDriver, words } from "./screen";
import { sendChord, VK, waitForModifiersUp } from "./win32";

/**
 * What command mode can do on Windows without touching the screen: launching apps, the browser,
 * volume, windows, processes. Each action's `describe` is the exact wording measured against Jev
 * (docs/command-mode.md) — reword one and re-measure, because the choice is made on these words.
 *
 * The heavy lifting runs in one long-lived PowerShell (see powershell.ts), started on the first
 * command and kept, so only the first command pays its ~0.5 s start-up.
 */

export interface WindowInfo {
  handle: number;
  title: string;
  program: string;
  pid: number;
  state: string;
  foreground: boolean;
}

interface AppEntry {
  Name: string;
  AppID: string;
}

interface Session {
  pid: number;
  name: string;
  percent: number;
  muted: boolean;
  system_sounds: boolean;
}

interface ProcessGroup {
  name: string;
  mb: number;
  count: number;
}

/**
 * Never stopped by voice, whatever was heard: Windows itself, the shell, security, and this app
 * along with its own PowerShell worker. A misheard name must not take the machine down.
 */
const PROTECTED = new Set([
  "system",
  "idle",
  "registry",
  "smss",
  "csrss",
  "wininit",
  "winlogon",
  "services",
  "lsass",
  "svchost",
  "fontdrvhost",
  "dwm",
  "explorer",
  "sihost",
  "ctfmon",
  "msmpeng",
  "securityhealthservice",
  "runtimebroker",
  "searchhost",
  "startmenuexperiencehost",
  "shellexperiencehost",
  "textinputhost",
  "audiodg",
  "conhost",
  "memory compression",
  "subxvoice",
  "electron",
  "powershell",
]);

/** Our own windows are not the user's to close by voice — closing them ends the command mid-run. */
const OWN_PROGRAMS = new Set(["subxvoice", "electron"]);

/**
 * How long a launched app gets to show a window before we stop waiting and say so. Waiting ends
 * the moment the window appears, so this is only paid by an app that is slow — just after a
 * reboot, the norm rather than the exception.
 */
const LAUNCH_WAIT_MS = 15_000;

/** WhatsApp's waits: its chat list after a cold start, a search's results, an opened chat. */
const STARTUP_MS = 20_000;
const SEARCH_MS = 2500;
const CHAT_MS = 4000;

export interface CommandDeps {
  inserter: TextInserter;
  openUrl(url: string): Promise<void>;
}

export class WinCommandSource implements ActionSource {
  private readonly worker = new PowerShellWorker(INTEROP);
  private readonly deps: CommandDeps;
  private apps: { at: number; list: AppEntry[] } | null = null;

  /** Screen control, on this same worker — see screen.ts. */
  readonly screen: WinScreenDriver;
  /** The assistant's eyes and hands (capture.ts, input.ts, probe.ts), on this same worker too. */
  readonly capture = new WinScreenCapture(this.worker, { windows: () => this.windows() });
  readonly input = new WinScreenInput(this.capture);
  readonly probe = new WinScreenProbe(this.worker);

  constructor(deps: CommandDeps) {
    this.deps = deps;
    // The classic screen step's own picture and hands, apart from the assistant's: a click on text
    // read off the pixels lands in the frame of the picture that text came from.
    const shots = new WinScreenCapture(this.worker, { windows: () => this.windows() });
    const hands = new WinScreenInput(shots);
    this.screen = new WinScreenDriver(this.worker, {
      windows: () => this.windows(),
      inserter: deps.inserter,
      launchNamed: (hint) => this.launchNamed(hint),
      capture: shots,
      clickAt: (x, y) => hands.click(...shots.toShot(x, y)),
    });
  }

  /** Start PowerShell now, so the first command does not pay for it. */
  warm(): void {
    void this.worker.warm().catch(() => {});
  }

  dispose(): void {
    this.worker.dispose();
  }

  async observe(): Promise<string[]> {
    const front = (await this.windows()).find((window) => window.foreground);
    if (!front) return [];
    const facts = [`Focused window: ${front.title} (${front.program})`];
    // "Is folder mein dhoondo" needs the folder's path; the window title holds only its name.
    if (front.program.toLowerCase() === "explorer") {
      const folder = await this.worker
        .run(EXPLORER_FOLDER.replace("HANDLE", String(front.handle)))
        .catch(() => "");
      if (typeof folder === "string" && folder) facts.push(`Folder open in File Explorer: ${folder}`);
    }
    return facts;
  }

  async actions(): Promise<AgentAction[]> {
    const all = [
      this.openApp(),
      this.openWeb(),
      this.writeEmail(),
      this.whatsappMessage(),
      this.setVolume(),
      this.appVolume(),
      this.typeText(),
      this.pressKeys(),
      this.closeWindows(),
      this.arrangeWindows(),
      this.killProcess(),
      this.findFiles(),
      this.openFolder(),
      this.makeFolder(),
      this.copyFiles(),
      this.screenshot(),
      this.brightness(),
      this.radio("bluetooth"),
      this.radio("wifi"),
      this.bluetoothDevice(),
      this.power(),
      this.systemStatus(),
      ...NOT_YET,
    ];
    // Whatever an action types, pastes or clicks is the app's own input, not the user touching
    // the PC (own-input.ts).
    return all.map((action) => ({ ...action, run: (args) => asOwnInput(() => action.run(args)) }));
  }

  /* ───────────── apps ───────────── */

  private openApp(): AgentAction {
    return {
      id: "open_app",
      describe: "Open or launch an application by its name, such as Chrome, Notepad, WhatsApp or Spotify",
      args:
        '{"name": string} — copied exactly from the list of installed apps. The name the user said came through ' +
        "speech recognition and is often misheard: choose the installed app whose name is pronounced like what " +
        'was heard. Sounding the same beats merely containing the word: "cloud" is pronounced like "Claude", ' +
        'while "Cloudflare" only contains it; "load" and "flow" are also "Claude" misheard, and "room" can be ' +
        '"Chrome". Then prefer the one that matches any extra words ' +
        '("instance manager" is "BlueStacks Multi-Instance Manager"). When several fit equally, choose the main ' +
        "app, the one with the plainest name. If nothing on the list sounds like it, give the name as heard.",
      // The writer, not a string match, maps what was heard to an app: the only way a misheard
      // "cloud app" can become Claude. ~255 names, a few thousand tokens, read only for this action.
      facts: async () => [
        `Installed apps: ${[...new Set((await this.appList(false)).map((app) => app.Name))].join("; ")}`,
      ],
      run: async (args) => {
        const name = text(args.name, "Which app?");
        // "YouTube kholo" is a website, not an app — unless an app of that name is installed.
        const app = await this.findApp(name).catch(async (error) => {
          const site = SITES[name.toLowerCase().replace(/\s+/g, "")];
          if (!site) throw error;
          await this.deps.openUrl(site);
          return null;
        });
        if (!app) return { did: `Opened ${name} in the browser` };
        const window = await this.launch(app);
        return { did: window ? `Opened ${app.Name}` : `Asked Windows to open ${app.Name}` };
      },
    };
  }

  /**
   * The Start menu's own list: 255 entries on the dev machine, desktop and Store apps side by
   * side, and a fresh install appears without anyone being told. Costs ~700 ms, so it is cached —
   * and refreshed on a miss, because the likeliest cause of a miss is an app installed since.
   */
  private async findApp(name: string): Promise<AppEntry> {
    const fresh = !this.apps || Date.now() - this.apps.at > 5 * 60_000;
    let match = resolveOne(name, await this.appList(fresh), (app) => app.Name);
    if (!match.chosen && match.how === "none")
      match = resolveOne(name, await this.appList(true), (app) => app.Name);
    if (match.chosen) return match.chosen;
    // "BlueStacks" matches BlueStacks 5, BlueStacks Desktop and the Multi-Instance Manager. The user
    // asked for the app, not a choice: the plainest name is the main one.
    const [plainest] = [...match.candidates].sort((a, b) => a.Name.length - b.Name.length);
    if (plainest) return plainest;
    throw new Error(`No app called "${name}" on this computer`);
  }

  /**
   * The installed app a screen step names, started when none of its windows is open. Named means
   * "in WhatsApp" or "WhatsApp's …" — not any word that happens to be an app's name, so "the
   * search box" never starts an app called Search.
   */
  private async launchNamed(hint: string): Promise<boolean> {
    const said = new Set(words(hint));
    const [app] = (await this.appList(false))
      .filter((entry) => {
        const name = words(entry.Name);
        if (!name.length || !name.every((word) => said.has(word))) return false;
        const escaped = entry.Name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`\\b(in|on|into|inside)\\s+(the\\s+)?${escaped}\\b|${escaped}['’]s`, "i").test(
          hint,
        );
      })
      .sort((a, b) => b.Name.length - a.Name.length);
    if (!app) return false;
    spawn("explorer.exe", [`shell:AppsFolder\\${app.AppID}`], { detached: true }).unref();
    return true;
  }

  private async appList(refresh: boolean): Promise<AppEntry[]> {
    if (refresh || !this.apps) {
      const list = await this.worker.json<AppEntry[] | AppEntry>(
        "Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress",
      );
      this.apps = { at: Date.now(), list: Array.isArray(list) ? list : [list] };
    }
    return this.apps.list;
  }

  /**
   * Done when a new window appears, or when the app's existing window comes to the front —
   * opening WhatsApp while it is already open raises it rather than making another.
   */
  private async waitForWindow(before: Set<number>, appName: string): Promise<WindowInfo | null> {
    const words = appName.toLowerCase().split(/\s+/);
    const deadline = Date.now() + LAUNCH_WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(250);
      const windows = await this.windows();
      const fresh = windows.find((window) => !before.has(window.handle));
      if (fresh) return fresh;
      const front = windows.find((window) => window.foreground);
      if (front && words.some((word) => `${front.title} ${front.program}`.toLowerCase().includes(word)))
        return front;
    }
    return null;
  }

  /**
   * Starts an app — or brings its window forward when it is already open — and waits for it.
   * Explorer launches anything the Start menu lists — a desktop app, a Store app like WhatsApp
   * that has no reachable .exe at all, a system app — through one path. It also starts it as the
   * user rather than as this process, which matters if this process is ever elevated.
   */
  private async launch(app: AppEntry): Promise<WindowInfo | null> {
    const before = new Set((await this.windows()).map((window) => window.handle));
    spawn("explorer.exe", [`shell:AppsFolder\\${app.AppID}`], { detached: true }).unref();
    const window = await this.waitForWindow(before, app.Name);
    if (window) await this.worker.run(`[CmdWindows]::Focus(${window.handle})`).catch(() => false);
    return window;
  }

  /* ───────────── messaging ───────────── */

  /**
   * A message to someone on WhatsApp, as one fixed procedure rather than four planned screen
   * steps. Planned, one skipped step broke it: with "NL" still in WhatsApp's search box, "Aryan ko
   * hi bhejo" was planned as "open Aryan's chat" with no search, Aryan was not in the filtered list,
   * and three commands in a row failed. Here every run does every step, each one checked:
   *
   *   WhatsApp open and in front → its search box replaced with the name → a chat row whose name
   *   starts with it (then each other spelling the writer gave, for a misheard name) → opened →
   *   the message typed into the message box and read back. Never sent.
   */
  private whatsappMessage(): AgentAction {
    return {
      id: "whatsapp_message",
      describe:
        "Write a WhatsApp message to a person or group: opens WhatsApp, finds their chat and types the " +
        "message there, without sending it",
      args:
        '{"to": string, "text": string, "alternatives": string[]} — "to" is the person\'s name as heard, in ' +
        'Roman letters; "text" is the message itself, in the language the user spoke, in Roman letters; ' +
        '"alternatives" are up to three other spellings the name might really have if speech recognition ' +
        'misheard it (heard "NL" → ["Anal", "Anil", "Nal"]), or [] when the name is clear.',
      run: async (args) => {
        const to = text(args.to, "Who should the message go to?");
        const message = text(args.text, "What should the message say?");
        const given = [to, ...(Array.isArray(args.alternatives) ? args.alternatives.map(String) : [])];
        // Hindi names are spelled with doubled letters or without — "Aaryan" was searched for a chat
        // saved as "Aryan" and none was found (laptop demo, 2026-11-19) — so each gets its plain form.
        // The bare name first ("Bolo aur Dragon" → "Dragon"): a chat is never named with those words.
        const bare = given.map(bareName);
        const spellings = [...bare, ...given, ...bare.map(plainSpelling)]
          .filter((name, index, all) => name.trim() && all.indexOf(name) === index)
          .slice(0, 5);

        // An open WhatsApp is brought forward directly. Asking Explorer to launch it again only
        // raised it some of the time: "WhatsApp didn't open" after a 15 s wait, with it open (S-024).
        const open = appWindow("WhatsApp", await this.userWindows());
        if (!(open && (await this.worker.run(`[CmdWindows]::Focus(${open.handle})`).catch(() => false)))) {
          const app = await this.findApp("WhatsApp").catch(() => null);
          if (!app) throw new Error("WhatsApp isn't installed on this computer");
          if (!(await this.launch(app))) throw new Error("WhatsApp didn't open");
        }

        // Each wait ends as soon as what it waits for is there, so an open WhatsApp costs nothing.
        // Just started after a reboot, WhatsApp showed its window seconds before its chat list:
        // the search box, read once, "wasn't there" and the message failed.
        let chat: { id: number; name: string } | null = null;
        for (const name of spellings) {
          const search = await this.whatsappWait(
            STARTUP_MS,
            (element) => element.editable && element.where === "top",
          );
          if (!search) throw new Error("WhatsApp opened, but its chats didn't load");
          await this.screen.typeInto(search.id, name);
          // The chat's own row starts with its name; rows that only mention it in a message do not.
          // WhatsApp lists chats before message hits, so the first such row is the chat.
          const found = (await this.whatsappResults()).find((row) => startsWithName(row.name, name));
          if (found) {
            chat = { id: found.id, name };
            break;
          }
        }
        if (!chat) {
          const tried = spellings.map((name) => `"${name}"`).join(", ");
          // The nearest real chat, found by the name's first two letters, so a misheard "Aryn" comes
          // back as a fact ("closest: Aryan") rather than a bare miss (plan T16).
          const search = await this.whatsappWait(0, (element) => element.editable && element.where === "top");
          let near: string | null = null;
          if (search) {
            // From the plain spelling: "Aa" of "Aaryan" matches nothing in "Aryan", "Ar" does.
            await this.screen.typeInto(search.id, plainSpelling(bareName(to)).slice(0, 2));
            near = nearestChat(
              bareName(to),
              (await this.whatsappResults()).map((row) => row.name),
            );
          }
          throw new Error(`No WhatsApp chat called ${tried}; ${near ? `closest: ${near}` : "none close"}`);
        }
        await this.screen.click(chat.id);

        // The message box names its chat — "Type a message to Aryan" — so the typing goes in only
        // once the chat asked for is the one open. The box of the chat open before the click is
        // there at once, and the click itself once landed on "Yash arya" (see whatsappResults).
        const named = (element: ScreenElement) => /^type a message to (.+)$/i.exec(element.name)?.[1];
        const wanted = chat.name;
        const box =
          (await this.whatsappWait(CHAT_MS, (element) => {
            const opened = element.editable ? named(element) : undefined;
            return opened !== undefined && startsWithName(opened, wanted);
          })) ?? (await this.whatsappWait(0, (element) => element.editable && element.where === "bottom"));
        if (!box) throw new Error(`Opened ${chat.name}, but couldn't find its message box`);
        const opened = named(box);
        if (opened && !startsWithName(opened, chat.name))
          throw new Error(`Meant to open ${chat.name}, but ${opened}'s chat opened — typed nothing`);
        await this.screen.typeInto(box.id, message);
        return { did: `Typed "${message}" to ${chat.name} on WhatsApp — not sent` };
      },
    };
  }

  /** WhatsApp read until an element is there, or `ms` runs out; null when it never came. */
  private async whatsappWait(ms: number, wanted: (element: ScreenElement) => boolean) {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = (await this.screen.read("in WhatsApp")).elements.find(wanted);
      if (found || Date.now() >= deadline) return found ?? null;
      await sleep(400);
    }
  }

  /**
   * WhatsApp's chat list once a search has filtered it. For a moment after typing, the list still
   * shows what it showed before: "Aryan" was found in that old list, and by the time the click
   * landed the filtered list had moved "Yash arya" into the row's place. So the rows are read until
   * two reads agree.
   */
  private async whatsappResults(): Promise<ScreenElement[]> {
    const deadline = Date.now() + SEARCH_MS;
    let before = "";
    for (;;) {
      await sleep(400);
      const rows = (await this.screen.read("in WhatsApp")).elements.filter(
        (element) => (element.role === "Row" || element.role === "ListItem") && element.name,
      );
      const now = rows.map((row) => row.name).join("\n");
      if (now === before || Date.now() >= deadline) return rows;
      before = now;
    }
  }

  /* ───────────── browser ───────────── */

  /**
   * An email, written in one step: Gmail's new-mail page takes the address, subject and body in its
   * URL. Left to the model as an open_web URL, it was written in full on one PC and opened empty on
   * another, which then asked "kisko mail karun?" again and again (laptop demo, 2026-11-19) — so the
   * URL is built here, and the address is never something to stop for.
   */
  private writeEmail(): AgentAction {
    return {
      id: "write_email",
      describe:
        "Write an email for the user in Gmail — to a manager, a friend, anyone: opens a new email with the " +
        "subject and the whole message already written, not sent. Do not ask for the address first",
      args:
        '{"to"?: string, "subject": string, "body": string} — "to" only when the user said the address or it is ' +
        "known; otherwise leave it out and say at the end that the address is still to fill. A spoken address is " +
        'written as an address: "batch manager at the rate gmail dot com" → batchmanager@gmail.com. "body" is the ' +
        "full email written for them — greeting, the message, sign-off — in the language they spoke, in Roman " +
        "letters; line breaks as \\n.",
      run: async (args) => {
        const subject = text(args.subject, "What is the email about?");
        const body = text(args.body, "What should the email say?");
        const to = typeof args.to === "string" ? args.to.trim() : "";
        const url = new URL("https://mail.google.com/mail/");
        url.searchParams.set("view", "cm");
        url.searchParams.set("fs", "1");
        if (to) url.searchParams.set("to", to);
        url.searchParams.set("su", subject);
        url.searchParams.set("body", body);
        await this.deps.openUrl(url.toString());
        return {
          did: `Opened a new Gmail email "${subject}"${to ? ` to ${to}` : " — no address yet"}, written, not sent`,
        };
      },
    };
  }

  private openWeb(): AgentAction {
    return {
      id: "open_web",
      describe: "Open a website in the browser, or search YouTube, Google or Gmail by address",
      args:
        '{"url": string, "here"?: boolean} — "here" is true only when the user said to open it in the tab that is ' +
        'already open ("yahan", "isi tab mein", "in this tab"). "url" is a full https URL. YouTube search is https://www.youtube.com/results?search_query=..., ' +
        "Google search is https://www.google.com/search?q=..., Gmail is https://mail.google.com. URL-encode queries. " +
        "To write an email, use write_email instead. " +
        "A query is in Roman letters as the user would type it: केसरिया → kesariya, never Devanagari.",
      run: async (args) => {
        const url = new URL(text(args.url, "Which website?"));
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("That isn't a website");
        const front = (await this.windows()).find((window) => window.foreground);
        const browser = front && BROWSERS.has(front.program.toLowerCase());
        // In the tab in front when the user said so — or when that tab is a blank new tab, which
        // is where "Chrome kholo" then "YouTube kholo" meant it to go, not a second tab beside it.
        const here = browser && (args.here === true || /^new tab\b/i.test(front.title));
        if (here) {
          await waitForModifiersUp();
          sendChord([VK.control], 0x4c); // Ctrl+L: the address bar
          await sleep(150);
          await this.deps.inserter.insert(url.toString());
          await sleep(100);
          sendChord([], 0x0d);
        } else {
          await this.deps.openUrl(url.toString());
        }
        const query = url.searchParams.get("search_query") ?? url.searchParams.get("q");
        const site = url.hostname.replace(/^www\./, "");
        const where = here ? " in this tab" : "";
        return { did: query ? `Searched ${site} for "${query}"${where}` : `Opened ${site}${where}` };
      },
    };
  }

  /* ───────────── sound ───────────── */

  private setVolume(): AgentAction {
    return {
      id: "set_volume",
      // "Unless an app is named": with Chrome playing, "volume 50% karo" set Chrome alone.
      describe:
        "Change the whole computer's system volume, or mute or unmute it — unless the user named one app",
      args:
        '{"level": number 0-100} or {"mute": boolean}. "aadha" means 50. A relative change ("thoda kam") ' +
        "is applied to the current level.",
      facts: async () => {
        const now = await this.volume();
        return [`Current volume: ${now.percent}%${now.muted ? ", muted" : ""}`];
      },
      run: async (args) => {
        if (typeof args.mute === "boolean") {
          await this.worker.run(`[CmcpAudio]::SetMute(0, $${args.mute})`);
          return { did: args.mute ? "Muted" : "Unmuted" };
        }
        const level = clamp(number(args.level, "What volume?"));
        await this.worker.run(`[CmcpAudio]::SetVolume(0, ${level})`);
        // Setting a level while muted would otherwise change a number nobody can hear.
        if (level > 0) await this.worker.run("[CmcpAudio]::SetMute(0, $false)");
        return { did: `Volume set to ${level}%` };
      },
    };
  }

  private appVolume(): AgentAction {
    return {
      id: "app_volume",
      describe:
        "Change or silence the sound of one app the user named, such as Chrome or Spotify, leaving the others",
      args: '{"app": string, "level": number 0-100}. 0 silences it.',
      facts: async () => {
        const names = [...new Set((await this.sessions()).map((session) => session.name))];
        return [`Apps playing sound: ${names.join(", ") || "none"}`];
      },
      run: async (args) => {
        const sessions = await this.sessions();
        if (!sessions.length) throw new Error("Nothing is playing sound right now");
        const match = resolveOne(text(args.app, "Which app?"), sessions, (session) => session.name);
        // Chrome holds one session per process, so "Chrome" is several matches that are all
        // Chrome. When every match shares a name, the user meant all of them.
        const targets =
          match.chosen !== null
            ? [match.chosen]
            : new Set(match.candidates.map((session) => session.name.toLowerCase())).size === 1
              ? match.candidates
              : [];
        if (!targets.length) {
          throw new Error(
            match.how === "ambiguous"
              ? `Which one? ${match.candidates.map((session) => session.name).join(", ")}`
              : `${String(args.app)} isn't playing sound`,
          );
        }
        const level = clamp(number(args.level, "What volume?"));
        for (const session of targets) {
          await this.worker.run(
            `[CmcpAudio]::SetSessionVolume(0, ${session.pid}, ${level}, ${level === 0 ? 1 : 0})`,
          );
        }
        const name = targets[0]?.name ?? String(args.app);
        return { did: level === 0 ? `Silenced ${name}` : `${name} volume set to ${level}%` };
      },
    };
  }

  /* ───────────── typing ───────────── */

  private typeText(): AgentAction {
    return {
      id: "type_text",
      describe:
        "Type or write out text the user asked for — words, a message, or a whole email composed as text, not " +
        "sent — wherever the cursor already is in the app in front. Not for a named box inside an app, such as a " +
        "search box or a chat's message box",
      args:
        '{"text": string} — only the words the user wants typed, without the instruction around them. Always in ' +
        "Latin (Roman) letters: if the words arrive in Devanagari, transliterate them (कल → kal, ग्यारह → gyarah). " +
        "Never translate them into English. When the user asked for a message or email to be written for them " +
        "rather than dictating it word for word, write it out in full, in the language they spoke, in Roman letters.",
      run: async (args) => {
        const words = text(args.text, "What should I type?");
        // A window that has just opened can still be painting; typing into it a moment early
        // sends the keystrokes to whatever was in front before.
        await sleep(300);
        await this.deps.inserter.insert(words);
        return { did: `Typed "${words.length > 40 ? `${words.slice(0, 40)}…` : words}"` };
      },
    };
  }

  /**
   * Press a key or a shortcut. Covers what has no action of its own — paste, save, undo, Enter,
   * a new tab — without one action per shortcut.
   */
  private pressKeys(): AgentAction {
    return {
      id: "press_keys",
      describe:
        "Press a key or keyboard shortcut, such as paste, copy, save, undo, Enter, opening or closing a browser " +
        "tab, or a Windows shortcut like a new virtual desktop or switching desktops",
      args:
        '{"keys": string, "times"?: number} — key names joined by "+": "ctrl+v" pastes, "ctrl+c" copies, ' +
        '"ctrl+s" saves, "ctrl+z" undoes, "ctrl+t" opens a tab, "ctrl+w" closes the current tab, "enter", ' +
        '"alt+tab", "win+ctrl+d" a new virtual desktop, "win+ctrl+right" / "win+ctrl+left" the next / previous ' +
        'desktop, "win+d" shows the desktop. Names: ctrl, shift, alt, win, enter, tab, esc, space, backspace, ' +
        "delete, up, down, left, right, home, end, pageup, pagedown, printscreen, f1-f12, single letters and " +
        'digits. "times" only when the user asked for a count.',
      run: async (args) => {
        const names = text(args.keys, "Which keys?")
          .toLowerCase()
          .split("+")
          .map((name) => KEY_ALIASES[name.trim()] ?? name.trim())
          .filter(Boolean);
        const vks = names.map((name) => {
          const vk = name === "win" ? VK.lwin : name === "printscreen" ? VK_SNAPSHOT : KEYS[name]?.[0];
          if (vk === undefined) throw new Error(`I don't know the key "${name}"`);
          return vk;
        });
        const main = vks.pop() as number;
        const times = Math.max(1, Math.min(MAX_PRESSES, Math.round(Number(args.times) || 1)));
        // The command key may still be down; Ctrl+V pressed under a held Alt is Ctrl+Alt+V.
        if (!(await waitForModifiersUp())) throw new Error("Let go of the keys first");
        // The app just opened or focused can still be taking the focus; keys sent a moment early
        // land on whatever was in front before.
        await sleep(150);
        for (let press = 0; press < times; press++) {
          if (!sendChord(vks, main)) throw new Error("Windows didn't accept the key press");
          if (times > 1) await sleep(40);
        }
        const chord = names.map((name) => (name.length === 1 ? name.toUpperCase() : capital(name))).join("+");
        return { did: `Pressed ${chord}${times > 1 ? ` ×${times}` : ""}` };
      },
    };
  }

  /* ───────────── windows and processes ───────────── */

  private closeWindows(): AgentAction {
    return {
      id: "close_windows",
      // "with all its tabs": "close the WhatsApp tab" once closed the whole Chrome window.
      describe: "Close whole windows that are open — a browser window closes with all of its tabs",
      args: '{"close": string[]} — window titles copied exactly from the list of open windows.',
      risky: true,
      facts: () => this.windowFacts(),
      run: async (args) => {
        const targets = await this.pickWindows(args.close, false);
        for (const window of targets) await this.worker.run(`[CmdWindows]::Close(${window.handle})`);
        return { did: `Closed ${windowNames(targets)}` };
      },
    };
  }

  /**
   * Its own action rather than a mode of closing: "minimize" once reached close_windows, whose
   * details had nowhere to put it, and the run asked "Which windows?" five times.
   */
  private arrangeWindows(): AgentAction {
    return {
      id: "arrange_windows",
      describe: "Minimize, maximize or restore a window, or switch to a window that is already open",
      args:
        '{"windows": string[], "do": "minimize" | "maximize" | "restore" | "focus"} — window titles copied ' +
        'exactly from the list of open windows. "focus" brings one window to the front. "wapas lao" / "bring ' +
        'back" a minimized window is "restore". With no window named, leave "windows" empty.',
      facts: () => this.windowFacts(),
      run: async (args) => {
        const how = String(args.do ?? "").toLowerCase();
        if (!(how in SHOW) && how !== "focus") throw new Error("Minimize, maximize or switch to it?");
        // "restore karo" names nothing and means what was minimized; "minimize karo" means the
        // window in front. Asking "Which windows?" there was the failure.
        const windows = await this.userWindows();
        const unnamed =
          how === "restore"
            ? windows.filter((window) => window.state === "minimized")
            : windows.filter((window) => window.foreground);
        const targets = await this.pickWindows(args.windows, true, unnamed);
        if (how === "focus") {
          const [window] = targets as [WindowInfo];
          if (!(await this.worker.run(`[CmdWindows]::Focus(${window.handle})`)))
            throw new Error(`Windows wouldn't bring ${window.program} to the front`);
          return { did: `Switched to ${window.title}` };
        }
        for (const window of targets)
          await this.worker.run(`[CmdWindows]::Show(${window.handle}, ${SHOW[how as keyof typeof SHOW]})`);
        return { did: `${capital(how === "restore" ? "restored" : `${how}d`)} ${windowNames(targets)}` };
      },
    };
  }

  /** The user's windows, with the minimized ones named apart so their titles stay copyable as-is. */
  private async windowFacts(): Promise<string[]> {
    const windows = await this.userWindows();
    const minimized = windows.filter((window) => window.state === "minimized");
    return [
      `Open windows: ${windows.map((window) => window.title).join("; ") || "none"}`,
      ...(minimized.length
        ? [`Of those, minimized: ${minimized.map((window) => window.title).join("; ")}`]
        : []),
    ];
  }

  /**
   * The windows the writer named (see `matchWindows`). A name that cannot be pinned down is
   * skipped, not guessed at; two names landing on one window act on it once. `unnamed` is used
   * when no window was named at all.
   */
  private async pickWindows(
    named: unknown,
    many: boolean,
    unnamed: WindowInfo[] = [],
  ): Promise<WindowInfo[]> {
    const titles = (
      Array.isArray(named) ? named.map(String) : typeof named === "string" ? [named] : []
    ).filter((title) => title.trim());
    if (!titles.length) {
      if (unnamed.length) return unnamed;
      throw new Error("Which windows?");
    }
    const windows = await this.userWindows();
    const picked = new Map<number, WindowInfo>();
    for (const title of titles) {
      for (const window of matchWindows(title, windows, many, new Set(picked.keys())))
        picked.set(window.handle, window);
    }
    if (!picked.size) throw new Error(`Couldn't find ${titles.join(", ")} among the open windows`);
    return [...picked.values()];
  }

  private async userWindows(): Promise<WindowInfo[]> {
    return (await this.windows()).filter((window) => !OWN_PROGRAMS.has(window.program.toLowerCase()));
  }

  private killProcess(): AgentAction {
    return {
      id: "kill_process",
      describe: "Stop a running program, for example the one using the most memory",
      args:
        '{"name": string} — a program name copied exactly from the list of programs by memory. Never a Windows ' +
        "system program.",
      risky: true,
      facts: async () => [
        `Programs by memory: ${(await this.processes())
          .map((group) => `${group.name} ${group.mb} MB`)
          .join("; ")}`,
      ],
      run: async (args) => {
        const asked = text(args.name, "Which program?");
        // Said as such: "No running program called SUBXVoice" read as a bug, not as a refusal.
        const guarded = resolveOne(asked, [...PROTECTED], (name) => name);
        if (guarded.chosen && guarded.how !== "substring")
          throw new Error(`${asked} is part of Windows or SUBXVoice itself, so I won't stop it`);
        const groups = await this.processes();
        const match = resolveOne(asked, groups, (group) => group.name);
        const target = match.chosen;
        if (!target) throw new Error(`No running program called "${String(args.name)}"`);
        // Its windows are asked to close first, the way clicking X would — an app with unsaved
        // work gets the chance to say so. Only what is still running a moment later is stopped.
        const windows = (await this.windows()).filter(
          (window) => window.program.toLowerCase() === target.name.toLowerCase(),
        );
        for (const window of windows) await this.worker.run(`[CmdWindows]::Close(${window.handle})`);
        if (windows.length) await sleep(1500);
        await this.worker.run(
          `Stop-Process -Name ${psQuote(target.name)} -Force -ErrorAction SilentlyContinue`,
        );
        const size = target.mb >= 1024 ? `${(target.mb / 1024).toFixed(1)} GB` : `${target.mb} MB`;
        return { did: `Closed ${target.name}, which was using ${size}` };
      },
    };
  }

  /* ───────────── files ───────────── */

  private findFiles(): AgentAction {
    return {
      id: "find_files",
      describe: "Find a file or a folder on this computer by its name and show it in File Explorer",
      args:
        '{"name": string, "in"?: string} — "name" is the words of the file\'s name as the user said them, always in ' +
        'Roman letters, without "file" or the extension. File names are usually English: an English word that ' +
        'arrives in Devanagari is written in English (रजिस्ट्रेशन → registration, रिज्यूमे → resume). "in" is where to look: "pictures", "documents", "downloads", ' +
        '"desktop", "videos", "music", or a full path such as the folder open in File Explorer when the user says ' +
        '"is folder mein". Leave "in" out to look in all of those.',
      run: async (args) => {
        const name = text(args.name, "Which file?");
        let where = typeof args.in === "string" ? args.in.trim() : "";
        // The writer, told to give the open folder's path, gave "this folder" and "current folder"
        // instead whenever File Explorer was not the window in front. That folder is looked up
        // here; with no File Explorer open, everywhere is searched.
        if (!/[\\/]/.test(where) && /\b(this|current|open|explorer)\b/i.test(where))
          where = (await this.explorerFolder()) ?? "";
        const found = await this.worker.json<Found[] | Found>(
          `${PLACES}\n$name = ${psQuote(name)}; $where = ${psQuote(where)}\n${FIND_SCRIPT}`,
        );
        const matches = (Array.isArray(found) ? found : [found]).filter((item) => item?.path);
        const [newest] = matches;
        if (!newest) throw new Error(`Couldn't find "${name}"${where ? ` in ${where}` : ""}`);
        const paths = matches.map((item) => item.path);
        // Full paths in what is said, because the next step ("copy it to Downloads") has only this
        // line to go on. The other places are named by folder: "resume" found four in Downloads and
        // one in Pictures, and the Pictures one — the one the user meant — was cut from the list,
        // so "Pictures wala" had nothing to point at.
        const others = (folder: string) => {
          const places = [...new Set(paths.map(dirname).filter((path) => path !== folder))].slice(0, 4);
          if (!places.length) return "";
          const listed = places.map((place) => {
            const names = paths.filter((path) => dirname(path) === place).map((path) => basename(path));
            return `${place}: ${names.slice(0, 3).join(", ")}`;
          });
          return ` (also in ${listed.join("; ")})`;
        };
        // A folder is shown by opening it, the way "open it" means for a folder.
        if (newest.dir) {
          await this.showFolder(newest.path, []);
          return { did: `Opened the folder ${newest.path}${others(dirname(newest.path))}` };
        }
        // A file is shown the way "Show in folder" does: the folder of the newest match opened, and
        // every match in that folder selected in it.
        const folder = dirname(newest.path);
        const here = paths.filter((path) => dirname(path) === folder).map((path) => basename(path));
        await this.showFolder(folder, here);
        const shown = here.length === 1 ? newest.path : `${here.length} in ${folder}: ${here.join("; ")}`;
        return { did: `Found ${shown}, selected in File Explorer${others(folder)}` };
      },
    };
  }

  /**
   * A File Explorer window on `folder`, in front, with `names` selected in it — an open one reused.
   * Fails rather than saying "Opened" when no window appeared: explorer.exe started with
   * `windowsHide` made real but invisible windows, and "Opened Pictures" was said three times over
   * nothing on screen.
   */
  private async showFolder(folder: string, names: string[]): Promise<void> {
    await this.worker.run(
      `$showFolder = ${psQuote(folder)}; $showNames = @(${names.map(psQuote).join(",")})\n${SHOW_SCRIPT}`,
    );
  }

  /** The folder shown in the topmost File Explorer window, if any is open. */
  private async explorerFolder(): Promise<string | null> {
    for (const window of await this.windows()) {
      if (window.program.toLowerCase() !== "explorer") continue;
      const folder = await this.worker
        .run(EXPLORER_FOLDER.replace("HANDLE", String(window.handle)))
        .catch(() => "");
      if (typeof folder === "string" && folder) return folder;
    }
    return null;
  }

  private openFolder(): AgentAction {
    return {
      id: "open_folder",
      describe: "Open a folder in File Explorer, such as Downloads, Pictures or Documents",
      args: '{"path": string} — "downloads", "pictures", "documents", "desktop", "videos", "music", or a full path.',
      run: async (args) => {
        const path = String(
          await this.worker.run(`${PLACES}\nResolve-Place ${psQuote(text(args.path, "Which folder?"))}`),
        );
        await this.showFolder(path, []);
        return { did: `Opened ${path}` };
      },
    };
  }

  private makeFolder(): AgentAction {
    return {
      id: "make_folder",
      describe: "Make a new folder",
      args:
        '{"path": string} — where and what, e.g. "downloads/my resume", or a full path. A known folder name ' +
        "(downloads, pictures, documents, desktop, videos, music) can start it.",
      run: async (args) => {
        const path = String(
          await this.worker.run(
            `${PLACES}\n$p = Resolve-Place ${psQuote(text(args.path, "Which folder?"))}\nNew-Item -ItemType Directory -Force -Path $p | Out-Null\n$p`,
          ),
        );
        return { did: `Made the folder ${path}` };
      },
    };
  }

  /** Copying never replaces: a file already at the destination is left as it is, and said so. */
  private copyFiles(): AgentAction {
    return {
      id: "copy_files",
      describe: "Copy files or folders into another folder",
      args:
        '{"files": string[], "to": string} — "files" are full paths, copied from what was found earlier; "to" is ' +
        'a full path or a known folder name with an optional subfolder, e.g. "downloads/my resume". A folder ' +
        "that does not exist yet is made.",
      run: async (args) => {
        const files = Array.isArray(args.files) ? args.files.map(String).filter(Boolean) : [];
        if (!files.length) throw new Error("Which files?");
        const to = psQuote(text(args.to, "Copy where?"));
        const result = await this.worker.json<{ to: string; copied: number; skipped: string[] }>(
          `${PLACES}\n$files = @(${files.map(psQuote).join(",")}); $toArg = ${to}\n${COPY_SCRIPT}`,
        );
        const skipped = result.skipped ?? [];
        if (!result.copied && !skipped.length) throw new Error("Couldn't find those files to copy");
        const note = skipped.length ? ` (${skipped.join(", ")} already there, left as is)` : "";
        return { did: `Copied ${result.copied} into ${result.to}${note}` };
      },
    };
  }

  /* ───────────── screen and radios ───────────── */

  private screenshot(): AgentAction {
    return {
      id: "screenshot",
      describe: "Take a screenshot of the screen",
      // Two flags that default to false, not a "which": offered "largest" | "primary", the writer
      // chose "primary" for a plain "screenshot lo", and the user wanted their big 2K monitor.
      args:
        '{"all_screens"?: boolean, "main_screen"?: boolean} — both false unless the user asked for every screen ' +
        "or named the main one. Otherwise the largest screen is taken.",
      run: async (args) => {
        const which = args.all_screens === true ? "all" : args.main_screen === true ? "primary" : "largest";
        const shot = await this.worker.json<{ path: string; size: string }>(
          SCREENSHOT_SCRIPT.replace("WHICH", which),
        );
        return { did: `Screenshot (${shot.size}) saved to ${shot.path} and copied` };
      },
    };
  }

  private brightness(): AgentAction {
    return {
      id: "brightness",
      describe: "Change the screen's brightness, or say what it is",
      args:
        '{"level": number 0-100 | null} — null when the user only asked what it is. A relative change ' +
        '("thoda kam", "badha do") is applied to the current level.',
      facts: async () => {
        const now = await this.readBrightness();
        return [now < 0 ? "Current brightness: unknown" : `Current brightness: ${now}%`];
      },
      run: async (args) => {
        if (args.level === null || args.level === undefined) {
          const now = await this.readBrightness();
          if (now < 0) throw new Error("This screen's brightness can't be read from here");
          return { did: "Read the brightness", answer: `Brightness is ${now}%` };
        }
        const level = clamp(number(args.level, "What brightness?"));
        const changed = Number(await this.worker.run(SET_BRIGHTNESS.replace(/LEVEL/g, String(level))));
        if (!changed) throw new Error("This screen's brightness can't be changed from here");
        return { did: `Brightness set to ${level}%` };
      },
    };
  }

  /** A laptop's own panel through WMI; any monitor that speaks DDC/CI through its cable. */
  private async readBrightness(): Promise<number> {
    return Number(await this.worker.run(GET_BRIGHTNESS));
  }

  /**
   * The radio itself, as the quick-settings tile switches it — not connecting a particular device,
   * which stays `bluetooth_device`.
   */
  private radio(kind: "bluetooth" | "wifi"): AgentAction {
    const name = kind === "wifi" ? "Wi-Fi" : "Bluetooth";
    const winrt = kind === "wifi" ? "WiFi" : "Bluetooth";
    return {
      id: kind,
      describe: kind === "wifi" ? "Turn Wi-Fi on or off, or restart it" : "Turn Bluetooth on or off",
      args: kind === "wifi" ? '{"turn": "on" | "off" | "restart"}' : '{"turn": "on" | "off"}',
      // Wi-Fi off also cuts the speech service, so it cannot be turned back on by voice. A guess
      // should not do that.
      risky: kind === "wifi",
      facts: async () => [`${name} is currently ${(await this.radioState(winrt)).toLowerCase()}`],
      run: async (args) => {
        const turn = String(args.turn ?? "").toLowerCase();
        // The next step is decided by a model online, and the radio being on is not the network
        // being back: a step decided at once timed out (S-024). Wait for it, briefly.
        const back = async () =>
          kind === "wifi" && !(await online()) ? " — the internet isn't back yet" : "";
        if (turn === "restart" && kind === "wifi") {
          await this.setRadio(winrt, name, "Off");
          await this.setRadio(winrt, name, "On");
          return { did: `Restarted ${name}${await back()}` };
        }
        if (turn !== "on" && turn !== "off") throw new Error(`On or off?`);
        const target = turn === "on" ? "On" : "Off";
        await this.setRadio(winrt, name, target);
        return { did: `${name} turned ${turn}${turn === "on" ? await back() : ""}` };
      },
    };
  }

  /**
   * One paired device — "OnePlus Buds se connect karo" — connected or disconnected, then read back
   * from the radio. Bluetooth is switched on first if it is off. Pairing a new device stays in
   * Settings: it needs the device in pairing mode and a confirmation on screen.
   */
  private bluetoothDevice(): AgentAction {
    return {
      id: "bluetooth_device",
      describe:
        "Connect or disconnect a particular Bluetooth device such as earbuds, headphones or a speaker",
      args:
        '{"device": string, "connect": boolean} — "device" is copied exactly from the paired devices listed ' +
        "above, the one pronounced like what was heard; connect is false only for disconnecting.",
      facts: async () => {
        const devices = await this.pairedDevices().catch(() => []);
        return devices.length
          ? [
              `Paired Bluetooth devices: ${devices.map((d) => `${d.name} (${d.connected ? "connected" : "not connected"})`).join("; ")}`,
            ]
          : [];
      },
      run: async (args) => {
        const wanted = text(args.device, "Which device?");
        const connect = args.connect !== false;
        if ((await this.radioState("Bluetooth")) !== "On")
          await this.setRadio("Bluetooth", "Bluetooth", "On");
        const devices = await this.pairedDevices();
        const match = resolveOne(wanted, devices, (device) => device.name);
        const device = match.chosen ?? [...match.candidates][0];
        if (!device)
          throw new Error(`No paired Bluetooth device called "${wanted}" — pair it once in Settings`);
        if (!connect) {
          await this.worker.run(`[CmdBluetooth]::Disconnect('${device.address}')`);
          return { did: `Disconnected ${device.name}` };
        }
        if (device.connected) return { did: `${device.name} is already connected` };
        const connected = await this.worker.run(`[CmdBluetooth]::Connect('${device.address}')`);
        if (connected !== true)
          throw new Error(`${device.name} didn't connect — is it out of its case and nearby?`);
        return { did: `Connected ${device.name}` };
      },
    };
  }

  private async pairedDevices(): Promise<{ name: string; address: string; connected: boolean }[]> {
    const devices =
      await this.worker.json<{ name: string; address: string; connected: boolean; paired: boolean }[]>(
        "[CmdBluetooth]::Devices()",
      );
    return (Array.isArray(devices) ? devices : [devices]).filter((device) => device?.paired);
  }

  private async radioState(kind: string): Promise<string> {
    return String(await this.worker.run(`${RADIOS}\n${radioOf(kind)}\n"$($r.State)"`));
  }

  /**
   * "Allowed" only means Windows accepted the request, not that the radio got there, so the state
   * is read back until it does — the computer-mcp's rule.
   */
  private async setRadio(kind: string, name: string, target: "On" | "Off"): Promise<void> {
    const access = String(
      await this.worker.run(
        `${RADIOS}\n${radioOf(kind)}\n"$(Await ($r.SetStateAsync([Windows.Devices.Radios.RadioState]::${target})) ([Windows.Devices.Radios.RadioAccessStatus]))"`,
      ),
    );
    if (access !== "Allowed") throw new Error(`Windows didn't let me switch ${name} (${access})`);
    const deadline = Date.now() + RADIO_WAIT_MS;
    while (Date.now() < deadline) {
      if ((await this.radioState(kind)) === target) return;
      await sleep(300);
    }
    throw new Error(`${name} didn't turn ${target.toLowerCase()}`);
  }

  /** Restart and shutdown wait 15 s, long enough to say "cancel the shutdown". */
  private power(): AgentAction {
    return {
      id: "power",
      describe: "Lock, sleep, restart, shut down or sign out of the computer, or cancel a shutdown",
      args: '{"do": "lock" | "sleep" | "restart" | "shutdown" | "sign_out" | "cancel"}',
      risky: true,
      run: async (args) => {
        const power = POWER[String(args.do ?? "").toLowerCase() as keyof typeof POWER];
        if (!power) throw new Error("Lock, sleep, restart or shut down?");
        // Detached, not on the worker: going to sleep would hold the worker until the machine wakes.
        const [program, ...rest] = power.command;
        spawn(program, rest, { detached: true }).unref();
        return { did: power.did };
      },
    };
  }

  private systemStatus(): AgentAction {
    return {
      id: "system_status",
      describe: "Answer a question about this computer: battery, memory, storage, or connection",
      run: async () => {
        const status = await this.worker.json<{
          battery: number | null;
          charging: boolean | null;
          minutes: number | null;
          memory: number;
          disk: number;
        }>(STATUS_SCRIPT);
        const parts: string[] = [];
        if (status.battery === null) parts.push("No battery");
        else {
          parts.push(`Battery ${status.battery}%${status.charging ? ", charging" : ""}`);
          if (status.minutes)
            parts.push(`about ${Math.floor(status.minutes / 60)}h ${status.minutes % 60}m left`);
        }
        parts.push(`memory ${status.memory}% used`, `${status.disk} GB free on C:`);
        const answer = parts.join(" · ");
        return { did: "Read the computer's status", answer };
      },
    };
  }

  /* ───────────── reads ───────────── */

  private async windows(): Promise<WindowInfo[]> {
    return this.worker.json<WindowInfo[]>("[CmdWindows]::List()");
  }

  /** For "mute other audio while dictating" (feedback.ts). */
  async outputMuted(): Promise<boolean> {
    return (await this.volume()).muted;
  }

  async setOutputMuted(on: boolean): Promise<void> {
    await this.worker.run(`[CmcpAudio]::SetMute(0, $${on})`);
  }

  private async volume(): Promise<{ percent: number; muted: boolean }> {
    return this.worker.json("[CmcpAudio]::Volume(0)");
  }

  private async sessions(): Promise<Session[]> {
    const all = await this.worker.json<Session[]>("[CmcpAudio]::ListSessions(0)");
    return all.filter((session) => !session.system_sounds && session.pid !== 0);
  }

  /** Grouped by name: Chrome is twenty processes and one program, and "close Chrome" means all of it. */
  private async processes(): Promise<ProcessGroup[]> {
    const groups = await this.worker.json<ProcessGroup[] | ProcessGroup>(PROCESS_SCRIPT);
    return (Array.isArray(groups) ? groups : [groups]).filter(
      (group) => !PROTECTED.has(group.name.toLowerCase()),
    );
  }
}

/**
 * Offered to the decider so that "connect my headphones" is recognised for what it is and answered
 * honestly, instead of being matched to the nearest action that does exist.
 */
const NOT_YET: AgentAction[] = [
  ["focus_mode", "Turn Do Not Disturb or focus mode on or off", "Focus mode isn't switched on yet"],
].map(([id, describe, unavailable]) => ({
  id: id as string,
  describe: describe as string,
  available: false,
  unavailable: unavailable as string,
  run: async () => {
    throw new Error(unavailable as string);
  },
}));

/** Only this user's session: another user's processes are not theirs to stop by voice. */
const PROCESS_SCRIPT = `
$me = (Get-Process -Id $PID).SessionId
Get-Process | Where-Object { $_.SessionId -eq $me } | Group-Object ProcessName | ForEach-Object {
  [pscustomobject]@{ name = $_.Name; mb = [int](($_.Group | Measure-Object WorkingSet64 -Sum).Sum / 1MB); count = $_.Count }
} | Sort-Object mb -Descending | Select-Object -First 12 | ConvertTo-Json -Compress`;

/** EstimatedRunTime of 71582788 is Windows' "unknown", reported while charging. */
const STATUS_SCRIPT = `
$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
$os = Get-CimInstance Win32_OperatingSystem
$c = Get-PSDrive C
[pscustomobject]@{
  battery = if ($b) { [int]$b.EstimatedChargeRemaining } else { $null }
  charging = if ($b) { $b.BatteryStatus -eq 2 } else { $null }
  minutes = if ($b -and $b.EstimatedRunTime -lt 71582788) { [int]$b.EstimatedRunTime } else { $null }
  memory = [int](100 - $os.FreePhysicalMemory * 100 / $os.TotalVisibleMemorySize)
  disk = [int]($c.Free / 1GB)
} | ConvertTo-Json -Compress`;

/**
 * Known folders resolved through the shell, so a Pictures folder moved to OneDrive or another drive
 * is still found. A leading known name may carry a subfolder: "downloads/my resume".
 */
const PLACES = String.raw`
function Resolve-Place([string]$p) {
  $p = $p.Trim()
  if ([IO.Path]::IsPathRooted($p)) { return $p }
  $parts = $p -split '[\\/]', 2
  $known = @{ desktop = 'shell:Desktop'; documents = 'shell:Personal'; document = 'shell:Personal'
    downloads = 'shell:Downloads'; download = 'shell:Downloads'; pictures = 'shell:My Pictures'
    picture = 'shell:My Pictures'; photos = 'shell:My Pictures'; videos = 'shell:My Video'
    video = 'shell:My Video'; music = 'shell:My Music'; home = 'shell:Profile' }
  $key = $known[$parts[0].Trim().ToLower()]
  if (-not $key) { throw "I don't know a folder called $($parts[0])" }
  $base = (New-Object -ComObject Shell.Application).NameSpace($key).Self.Path
  if ($parts.Count -gt 1 -and $parts[1].Trim()) { Join-Path $base $parts[1].Trim() } else { $base }
}`;

/**
 * Every word of the name must appear, in any order — "my resume" finds My_Resume_2026.pdf. Depth is
 * capped so a search with no match in a large Downloads still answers inside the worker's 20 s.
 * Newest first, ten at most.
 */
const FIND_SCRIPT = String.raw`

$words = @($name -split '[\s_.-]+' | Where-Object { $_ })
# A place that is not one — misheard ("features" for Pictures), or a path the writer made up — is
# not a reason to find nothing: everywhere is searched instead.
$roots = $null
if ($where) { try { $r = Resolve-Place $where; if (Test-Path -LiteralPath $r) { $roots = @($r) } } catch {} }
if (-not $roots) { $roots = @('desktop','documents','downloads','pictures','videos','music') | ForEach-Object { Resolve-Place $_ } }
$found = foreach ($root in $roots) {
  if (Test-Path -LiteralPath $root) {
    Get-ChildItem -LiteralPath $root -Recurse -Depth 5 -Filter ('*' + $words[0] + '*') -ErrorAction SilentlyContinue |
      Where-Object { $n = $_.Name; @($words | Where-Object { $n -notlike ('*' + $_ + '*') }).Count -eq 0 } |
      Select-Object -First 20
  }
}
ConvertTo-Json -Compress -InputObject @($found | Sort-Object LastWriteTime -Descending | Select-Object -First 10 | ForEach-Object { [pscustomobject]@{ path = $_.FullName; dir = $_.PSIsContainer } })`;

interface Found {
  path: string;
  dir?: boolean;
}

const COPY_SCRIPT = String.raw`
$to = Resolve-Place $toArg
New-Item -ItemType Directory -Force -Path $to | Out-Null
$copied = 0; $skipped = @()
foreach ($file in $files) {
  if (-not (Test-Path -LiteralPath $file)) { continue }
  $target = Join-Path $to (Split-Path -Leaf $file)
  if (Test-Path -LiteralPath $target) { $skipped += (Split-Path -Leaf $file); continue }
  Copy-Item -LiteralPath $file -Destination $target -Recurse
  $copied++
}
[pscustomobject]@{ to = $to; copied = $copied; skipped = @($skipped) } | ConvertTo-Json -Compress`;

/**
 * Into Pictures\Screenshots, where Windows' own Win+PrintScreen puts them, and onto the clipboard so
 * "screenshot lo aur WhatsApp pe paste karo" works.
 */
const SCREENSHOT_SCRIPT = String.raw`
$dir = Join-Path ((New-Object -ComObject Shell.Application).NameSpace('shell:My Pictures').Self.Path) 'Screenshots'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$file = Join-Path $dir ('Screenshot ' + (Get-Date -Format 'yyyy-MM-dd HHmmss') + '.png')
$size = [CmdScreen]::Capture('WHICH', $file)
try {
  Add-Type -AssemblyName System.Windows.Forms
  $image = [System.Drawing.Image]::FromFile($file)
  try { [System.Windows.Forms.Clipboard]::SetImage($image) } finally { $image.Dispose() }
} catch {}
[pscustomobject]@{ path = $file; size = $size } | ConvertTo-Json -Compress`;

/** The folder an Explorer window shows, by its handle. */
const EXPLORER_FOLDER = String.raw`
(New-Object -ComObject Shell.Application).Windows() | Where-Object { $_.HWND -eq HANDLE } |
  ForEach-Object { $_.Document.Folder.Self.Path } | Select-Object -First 1`;

/**
 * Opens (or reuses) a File Explorer window on $showFolder and selects $showNames in it. SelectItem
 * flags: 1 select, 4 deselect the rest, 8 scroll into view, 16 focus — 29 for the first, 1 after.
 */
const SHOW_SCRIPT = String.raw`
$shell = New-Object -ComObject Shell.Application
function Find-View { foreach ($w in @($shell.Windows())) { try { if ($w.Visible -and $w.Document.Folder.Self.Path -eq $showFolder) { return $w } } catch {} } }
$view = Find-View
if (-not $view) {
  Start-Process explorer.exe -ArgumentList ('"' + $showFolder + '"')
  for ($i = 0; $i -lt 30 -and -not $view; $i++) { Start-Sleep -Milliseconds 200; $view = Find-View }
}
if (-not $view) { throw "File Explorer didn't open $showFolder" }
Start-Sleep -Milliseconds 300
$first = $true
foreach ($n in $showNames) {
  $item = $view.Document.Folder.ParseName($n)
  if ($item) { $view.Document.SelectItem($item, $(if ($first) { 29 } else { 1 })); $first = $false }
}
[void][CmdWindows]::Focus([long]$view.HWND)`;

/** WMI answers "not supported" on a desktop; DDC/CI answers -1 when no monitor speaks it. */
const GET_BRIGHTNESS = `
$w = $null
try { $w = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1 } catch {}
if ($w) { [int]$w.CurrentBrightness } else { [CmdBrightness]::Get() }`;

/** Both paths, because a laptop with a monitor plugged in has one screen of each kind. Returns how many changed. */
const SET_BRIGHTNESS = `
$n = 0
try {
  Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | ForEach-Object {
    Invoke-CimMethod -InputObject $_ -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]LEVEL } -ErrorAction Stop | Out-Null
    $n++
  }
} catch {}
$n + [CmdBrightness]::Set(LEVEL)`;

/**
 * WinRT from Windows PowerShell 5.1, after the computer-mcp (`core/network.py`): an IAsyncOperation
 * is turned into a .NET Task through `AsTask` and waited on. `IAsyncOperation?1` matches the
 * generic's name without a backtick, which a JS template literal cannot hold.
 */
const RADIOS = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation?1' }
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
[Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Radios.RadioAccessStatus, Windows.System.Devices, ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Radios.RadioState, Windows.System.Devices, ContentType=WindowsRuntime] | Out-Null
$access = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
if ("$access" -ne 'Allowed') { throw "Windows denied radio access: $access" }
$radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])`;

const radioOf = (kind: string) =>
  `$r = $radios | Where-Object { "$($_.Kind)" -eq ${psQuote(kind)} } | Select-Object -First 1\n` +
  `if (-not $r) { throw 'This computer has no ${kind === "WiFi" ? "Wi-Fi" : kind}' }`;

/** A radio that has not switched by now is not going to. */
const RADIO_WAIT_MS = 5000;

/** ShowWindow commands. */
const SHOW = { minimize: 6, maximize: 3, restore: 9 } as const;

const POWER: Record<string, { command: [string, ...string[]]; did: string }> = {
  lock: { command: ["rundll32.exe", "user32.dll,LockWorkStation"], did: "Locked the computer" },
  sleep: {
    command: [
      "powershell.exe",
      "-NoProfile",
      "-Command",
      "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)",
    ],
    did: "Putting the computer to sleep",
  },
  restart: {
    command: ["shutdown.exe", "/r", "/t", "15"],
    did: 'Restarting in 15 seconds — say "cancel the shutdown" to stop it',
  },
  shutdown: {
    command: ["shutdown.exe", "/s", "/t", "15"],
    did: 'Shutting down in 15 seconds — say "cancel the shutdown" to stop it',
  },
  sign_out: { command: ["shutdown.exe", "/l"], did: "Signing out" },
  cancel: { command: ["shutdown.exe", "/a"], did: "Cancelled the shutdown" },
};

/** Asked for as an app, opened as the website when no app of that name is installed. */
const SITES: Record<string, string> = {
  youtube: "https://www.youtube.com",
  gmail: "https://mail.google.com",
  google: "https://www.google.com",
  instagram: "https://www.instagram.com",
  facebook: "https://www.facebook.com",
  twitter: "https://x.com",
  x: "https://x.com",
  linkedin: "https://www.linkedin.com",
  netflix: "https://www.netflix.com",
  amazon: "https://www.amazon.in",
  flipkart: "https://www.flipkart.com",
  github: "https://github.com",
  chatgpt: "https://chatgpt.com",
  whatsappweb: "https://web.whatsapp.com",
  googlemaps: "https://maps.google.com",
  maps: "https://maps.google.com",
};

/** "Press Enter 500 times" is a mistake, not a request. */
const MAX_PRESSES = 20;

/** What the writer says that hotkey.ts's vocabulary spells differently. */
const KEY_ALIASES: Record<string, string> = {
  control: "ctrl",
  windows: "win",
  escape: "esc",
  return: "enter",
  del: "delete",
  pgup: "pageup",
  pgdn: "pagedown",
  "print screen": "printscreen",
  prtsc: "printscreen",
  prtscn: "printscreen",
};

/** Not a hotkey key, so not in hotkey.ts's vocabulary. */
const VK_SNAPSHOT = 0x2c;

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** A name with its doubled letters single: Aaryan → Aryan, Priyaa → Priya, Deepak → Depak. */
export function plainSpelling(name: string): string {
  return name.replace(/(\p{L})\1+/giu, "$1");
}

/**
 * Words speech carries along with a name ("bolo aur Dragon ko", "WhatsApp pe Aryan") that are
 * never part of one. ponytail: a word list; add a word when a log shows it came along.
 */
const SPOKEN_AROUND_NAMES = new Set(
  "bolo bol aur ko ka ki ke se ne pe par mein me ek and to tell say whatsapp message msg karo kar likho bhejo".split(
    " ",
  ),
);

/**
 * The name without the words speech put around it: "Bolo aur Dragon" was searched as it was, found
 * nothing, and the model typed the message into WhatsApp's search box by hand (demo hand test,
 * 2026-11-19). Only those words go — "Dragon Bhai" stays whole — and a name of nothing else stays.
 */
export function bareName(name: string): string {
  const words = name.trim().split(/\s+/);
  const kept = words.filter((word) => !SPOKEN_AROUND_NAMES.has(word.toLowerCase()));
  return kept.length > 0 ? kept.join(" ") : name.trim();
}

/** The chat name in WhatsApp's rows nearest to `name`, as many leading words as it has; null when none is close. */
export function nearestChat(name: string, rows: string[]): string | null {
  const words = name.trim().split(/\s+/).length;
  const names = rows.map((row) =>
    row
      .replace(/^\d+ unread messages?\s+/i, "")
      .replace(/^[@~]/, "")
      .split(/\s+/)
      .slice(0, words)
      .join(" "),
  );
  return closest(name, names);
}

/** "2 unread messages Aryan Monday", "@MCUPortal (You)" start with Aryan and MCUPortal; "Aryanshi" does not. */
function startsWithName(row: string, name: string): boolean {
  const clean = row
    .toLowerCase()
    .replace(/^\d+ unread messages?\s+/, "")
    .replace(/^[@~]/, "");
  const wanted = name.trim().toLowerCase().replace(/^[@~]/, "");
  return clean.startsWith(wanted) && !/[\p{L}\p{N}]/u.test(clean.charAt(wanted.length));
}

/**
 * Two windows with exactly the title named — two "Untitled - Notepad" — mean the topmost, the one
 * just used: the list is in z-order. Acting on both closed a Notepad nobody named, in a test.
 * Only `many` (minimize, restore — nothing lost) widens a looser name to every window of one
 * program, so "minimize Chrome" means all of Chrome; closing never guesses that.
 *
 * `taken`: windows already picked for earlier names. The same title named three times — "saare
 * Notepad band karo" gave ["Untitled - Notepad" ×3] — means three windows, the topmost first; it
 * used to land on the topmost every time and close one of three (S-024).
 */
export function matchWindows(
  name: string,
  windows: WindowInfo[],
  many: boolean,
  taken: ReadonlySet<number> = new Set(),
): WindowInfo[] {
  const byTitle = resolveOne(name, windows, (window) => window.title);
  if (byTitle.chosen) return [byTitle.chosen];
  const wanted = name.trim().toLowerCase();
  const exact = byTitle.candidates.filter((window) => window.title.toLowerCase() === wanted);
  if (exact.length) return [exact.find((window) => !taken.has(window.handle)) ?? (exact[0] as WindowInfo)];
  if (!many) return [];
  const programs = [...new Set(byTitle.candidates.map((window) => window.program.toLowerCase()))];
  if (programs.length === 1) return byTitle.candidates;
  const all = [...new Set(windows.map((window) => window.program))];
  const byProgram = resolveOne(name.replace(/^google /i, ""), all, (program) => program);
  return byProgram.chosen ? windows.filter((window) => window.program === byProgram.chosen) : [];
}

/** An open window of the app: every word of its name in the window's title or program, topmost first. */
export function appWindow(appName: string, windows: WindowInfo[]): WindowInfo | undefined {
  const words = (text: string) =>
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
  const wanted = words(appName);
  return windows.find((window) => {
    const have = new Set(words(`${window.title} ${window.program}`));
    return wanted.every((word) => have.has(word));
  });
}

/** One window by its title, several by count — a pill line, and what memory gives the next command. */
const windowNames = (windows: WindowInfo[]) =>
  windows.length === 1 ? (windows[0] as WindowInfo).title : `${windows.length} windows`;

function text(value: unknown, missing: string): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result) throw new Error(missing);
  return result;
}

function number(value: unknown, missing: string): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(result)) throw new Error(missing);
  return result;
}

const clamp = (level: number) => Math.round(Math.max(0, Math.min(100, level)));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether the internet answers, waiting up to `ms`. The address is Windows' own connectivity check
 * (NCSI), which the PC already calls on every network change.
 */
async function online(ms = 20_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const ok = await fetch("https://www.msftconnecttest.com/connecttest.txt", {
      signal: AbortSignal.timeout(2000),
    })
      .then((response) => response.ok)
      .catch(() => false);
    if (ok) return true;
    await sleep(1000);
  }
  return false;
}
