// A fake Windows desktop for harness tests. Nothing here touches the real machine.
// Tools mirror the kinds of actions Follow My Words has: OS settings, apps, files, and screen
// control through an accessibility-tree-like element list.

export function createWorld() {
  const w = {
    volume: 70,
    brightness: 80,
    open: ["Explorer"],
    focused: "Explorer",
    notepad: "",
    playing: null,
    explorer: { folder: null, selected: null },
    chrome: { url: null },
    whatsapp: {
      view: "list", // list | chat
      search: "",
      chat: null,
      drafts: {},
      sent: [],
      contacts: ["Aryan", "Aarnav", "Mummy", "Office Team"],
    },
    focusElement: null,
    log: [],
  };
  return w;
}

const FILES = [
  "C:\\Users\\me\\Pictures\\My Resume.pdf",
  "C:\\Users\\me\\Pictures\\holiday.jpg",
  "C:\\Users\\me\\Documents\\Resume old.docx",
  "C:\\Users\\me\\Downloads\\report.xlsx",
];
const YT = {
  kesariya: [
    "Kesariya - Brahmastra | Arijit Singh (Official Video)",
    "Kesariya Lofi Mix",
    "Kesariya (Reprise)",
  ],
};

function elements(w) {
  const app = w.focused;
  if (app === "Notepad") return [{ id: "editor", role: "Edit", name: "Text editor", value: w.notepad }];
  if (app === "WhatsApp") {
    const wa = w.whatsapp;
    const els = [{ id: "search", role: "Edit", name: "Search or start a new chat", value: wa.search }];
    const list = wa.contacts.filter((c) => c.toLowerCase().includes(wa.search.toLowerCase()));
    for (const [i, c] of list.entries()) els.push({ id: `chat_${i}`, role: "ListItem", name: c });
    if (wa.view === "chat") {
      els.push({ id: "chat_title", role: "Text", name: wa.chat });
      els.push({
        id: "message_box",
        role: "Edit",
        name: `Type a message to ${wa.chat}`,
        value: wa.drafts[wa.chat] ?? "",
      });
      els.push({ id: "send", role: "Button", name: "Send" });
    }
    return els;
  }
  if (app === "Chrome") {
    const els = [{ id: "address", role: "Edit", name: "Address and search bar", value: w.chrome.url ?? "" }];
    const m = /youtube\.com\/results\?search_query=([^&]+)/i.exec(w.chrome.url ?? "");
    if (m) {
      const q = decodeURIComponent(m[1]).toLowerCase();
      const hits = Object.entries(YT).find(([k]) => q.includes(k))?.[1] ?? [];
      for (const [i, t] of hits.entries()) els.push({ id: `video_${i}`, role: "Link", name: t });
    }
    if (w.playing) els.push({ id: "player", role: "Text", name: `Now playing: ${w.playing}` });
    return els;
  }
  if (app === "Explorer") {
    return [
      { id: "location", role: "Text", name: w.explorer.folder ?? "Home" },
      ...(w.explorer.selected
        ? [{ id: "sel", role: "ListItem", name: w.explorer.selected, selected: true }]
        : []),
    ];
  }
  return [];
}

const APPS = ["Notepad", "WhatsApp", "Chrome", "Explorer"];
const norm = (s) =>
  APPS.find(
    (a) =>
      a.toLowerCase() ===
      String(s)
        .trim()
        .toLowerCase()
        .replace(/^google /, ""),
  );

/** Tool specs: name, description, JSON-schema parameters, and run(world, args) → text. */
export const TOOLS = [
  {
    name: "get_state",
    description: "What is open on the PC right now: open apps, the focused app, volume and brightness.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    run: (w) =>
      JSON.stringify({ open: w.open, focused: w.focused, volume: w.volume, brightness: w.brightness }),
  },
  {
    name: "open_app",
    description:
      "Open an app (or bring it to the front if it is already open) and focus it. Apps: Notepad, WhatsApp, Chrome, Explorer.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
    run: (w, { name }) => {
      const app = norm(name);
      if (!app) return `Error: no app called "${name}". Installed: ${APPS.join(", ")}`;
      if (!w.open.includes(app)) w.open.push(app);
      w.focused = app;
      w.focusElement = null;
      return `${app} is open and focused.`;
    },
  },
  {
    name: "close_app",
    description: "Close an open app.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
    run: (w, { name }) => {
      const app = norm(name);
      if (!app || !w.open.includes(app)) return `Error: ${name} is not open.`;
      w.open = w.open.filter((a) => a !== app);
      if (w.focused === app) w.focused = w.open.at(-1) ?? null;
      return `Closed ${app}.`;
    },
  },
  {
    name: "read_screen",
    description:
      "Read the focused app's window: its elements (id, role, name, current value). Use the ids with click and type_text.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    run: (w) =>
      w.focused ? JSON.stringify({ app: w.focused, elements: elements(w) }) : "Nothing is focused.",
  },
  {
    name: "click",
    description: "Click an element of the focused app, by the id read_screen gave.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    run: (w, { id }) => {
      const el = elements(w).find((e) => e.id === id);
      if (!el) return `Error: no element "${id}" on screen. Call read_screen first.`;
      if (w.focused === "WhatsApp") {
        if (id.startsWith("chat_")) {
          w.whatsapp.view = "chat";
          w.whatsapp.chat = el.name;
          w.focusElement = "message_box";
          return `Opened the chat with ${el.name}.`;
        }
        if (id === "send") {
          const text = w.whatsapp.drafts[w.whatsapp.chat];
          if (!text) return "Nothing to send.";
          w.whatsapp.sent.push({ to: w.whatsapp.chat, text });
          w.whatsapp.drafts[w.whatsapp.chat] = "";
          return `Sent to ${w.whatsapp.chat}.`;
        }
      }
      if (w.focused === "Chrome" && id.startsWith("video_")) {
        w.playing = el.name;
        return `Playing ${el.name}.`;
      }
      w.focusElement = id;
      return `Clicked ${el.name}.`;
    },
  },
  {
    name: "type_text",
    description:
      'Type text into an element of the focused app (by id). It is appended to what is there; with replace: true it replaces it (replace with "" clears the box).',
    parameters: {
      type: "object",
      properties: { id: { type: "string" }, text: { type: "string" }, replace: { type: "boolean" } },
      required: ["id", "text"],
      additionalProperties: false,
    },
    run: (w, { id, text, replace = false }) => {
      const el = elements(w).find((e) => e.id === id);
      if (!el || el.role !== "Edit") return `Error: "${id}" is not a text box on screen. Call read_screen.`;
      const put = (old) => (replace ? text : (old ?? "") + text);
      if (w.focused === "Notepad") w.notepad = put(w.notepad);
      else if (w.focused === "WhatsApp" && id === "search") w.whatsapp.search = put(w.whatsapp.search);
      else if (w.focused === "WhatsApp" && id === "message_box")
        w.whatsapp.drafts[w.whatsapp.chat] = put(w.whatsapp.drafts[w.whatsapp.chat]);
      else if (w.focused === "Chrome" && id === "address") w.chrome.url = put(w.chrome.url);
      return `Typed into ${el.name}.`;
    },
  },
  {
    name: "set_volume",
    description: "Set the PC's volume, 0-100.",
    parameters: {
      type: "object",
      properties: { level: { type: "number" } },
      required: ["level"],
      additionalProperties: false,
    },
    run: (w, { level }) => {
      w.volume = Math.max(0, Math.min(100, Math.round(level)));
      return `Volume set to ${w.volume}%.`;
    },
  },
  {
    name: "set_brightness",
    description: "Set the screen brightness, 0-100.",
    parameters: {
      type: "object",
      properties: { level: { type: "number" } },
      required: ["level"],
      additionalProperties: false,
    },
    run: (w, { level }) => {
      w.brightness = Math.max(0, Math.min(100, Math.round(level)));
      return `Brightness set to ${w.brightness}%.`;
    },
  },
  {
    name: "find_files",
    description: "Search the user's folders for files whose name contains the words. Returns full paths.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    run: (w, { query }) => {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = FILES.filter((f) => words.every((x) => f.toLowerCase().includes(x)));
      return hits.length ? JSON.stringify(hits) : "No files found.";
    },
  },
  {
    name: "show_in_folder",
    description: "Open File Explorer at a file's folder with the file selected.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    run: (w, { path }) => {
      if (!FILES.includes(path)) return `Error: ${path} does not exist.`;
      if (!w.open.includes("Explorer")) w.open.push("Explorer");
      w.focused = "Explorer";
      w.explorer = { folder: path.slice(0, path.lastIndexOf("\\")), selected: path };
      return `Showing ${path} in File Explorer.`;
    },
  },
  {
    name: "open_url",
    description:
      "Open a URL in Chrome (opens Chrome if needed and focuses it). For a YouTube search use https://www.youtube.com/results?search_query=WORDS",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
    run: (w, { url }) => {
      if (!w.open.includes("Chrome")) w.open.push("Chrome");
      w.focused = "Chrome";
      w.chrome.url = url;
      return `Opened ${url} in Chrome.`;
    },
  },
];

export function runTool(world, name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  const result = tool ? tool.run(world, args ?? {}) : `Error: unknown tool ${name}`;
  world.log.push({ name, args, result: String(result).slice(0, 120) });
  return String(result);
}

export const SYSTEM = `You are Follow My Words, a voice assistant that operates the user's Windows PC while they work.
The user spoke a request (often Hindi-English mixed, transcribed by speech recognition, so a word may be misheard).

How to work:
- Use the tools to do exactly what was asked, nothing more. Work step by step: act, then check the result, then decide the next step.
- Before clicking or typing inside an app, call read_screen and use the element ids it returns. After an important action, confirm it worked (read_screen or get_state) before moving on.
- If something is not possible (a contact or file does not exist), do not guess or pick something else: stop and say clearly what could not be done.
- NEVER press Send on any message. Type the message and leave it for the user to send.
- Do not ask the user questions; they are busy. Finish what you can.
- When everything asked is done, reply with one short line in English saying what you did (and what you could not do).`;
