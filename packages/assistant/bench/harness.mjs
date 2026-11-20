// The deep bench through the real harness (createAssistant + the assistant prompt), instead of
// driving Pi's Agent directly. BENCH_VARIANT=harness. Questions get "aap khud tay karo"; every
// approval is refused, so a send can only happen if the guard is bypassed — which the row records.
import { readFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import { resolveModel } from "../src/model";
import { buildSystemPrompt } from "../src/prompt";
import { createAssistant } from "../src/run";
import { domainTools } from "../src/tools/domain";
import { screenTools } from "../src/tools/screen";
import { deepTool, drawGameHub, KEY, LLM_URL, STATE, TILES } from "./deep.mjs";
import { createWorld, TOOLS } from "./world.mjs";

const LOOKS = new Set(["get_state", "read_screen"]);

/** A tool's JSON schema as an action's prose args: {"name": string, "here"?: boolean}. */
function proseArgs(schema) {
  const required = new Set(schema.required ?? []);
  const kind = (p) =>
    p.enum
      ? p.enum.map((v) => JSON.stringify(v)).join(" | ")
      : p.type === "array"
        ? "string[]"
        : (p.type ?? "string");
  const fields = Object.entries(schema.properties ?? {}).map(
    ([name, p]) => `"${name}"${required.has(name) ? "" : "?"}: ${kind(p)}`,
  );
  return fields.length ? `{${fields.join(", ")}}` : undefined;
}

/** The fake world's direct actions; BENCH_DOMAIN=prose builds them as src/tools/domain.ts builds the real ones. */
const DIRECT = [
  "open_app",
  "close_app",
  "open_url",
  "set_volume",
  "set_brightness",
  "find_files",
  "show_in_folder",
];

/** What a real PC tells the model through its tools; the fake desktop states it here. */
const WORLD_FACTS = `# This PC
- Inside an app, read_screen returns its UI tree as elements with ids; click and type_text act on those ids.
- When an app exposes no elements, take a screenshot and use the screen tools (left_click and the rest) with pixel coordinates from it.
- A WhatsApp message is sent by clicking its Send button.`;

/**
 * The real screen tools (T11) over the fake desktop: GameHub is an 800x500 canvas with no tree, so
 * the guard sees no element under a click and falls back to "OCR", which here is GameHub's own
 * labels — what Windows OCR reads off the real thing.
 */
function fakeScreen(w) {
  let cursor = [0, 0];
  const plain = (app) => {
    const c = createCanvas(800, 500);
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 800, 500);
    g.fillStyle = "#000";
    g.font = "22px sans-serif";
    g.fillText(`${app ?? "Desktop"} — this app has a UI tree; use read_screen.`, 30, 250);
    return c.toBuffer("image/png").toString("base64");
  };
  const shot = () => ({
    data: w.focused === "GameHub" ? drawGameHub(w) : plain(w.focused),
    mimeType: "image/png",
    width: 800,
    height: 500,
    scale: 1,
    display: { x: 0, y: 0, width: 800, height: 500 },
    redacted: 0,
  });
  const inside = (x, y) => {
    if (!(x >= 0 && y >= 0 && x <= 800 && y <= 500))
      throw new Error(`(${x}, ${y}) is outside the 800x500 screenshot`);
    return [Math.round(x), Math.round(y)];
  };
  const none = async () => {};
  const capture = {
    screenshot: async () => shot(),
    zoom: async () => shot(),
    toPhysical: inside,
    toShot: (x, y) => [x, y],
  };
  const input = {
    click: async (x, y) => {
      cursor = inside(x, y);
      deepTool(w, "click_at", { x: cursor[0], y: cursor[1] });
    },
    move: async (x, y) => {
      cursor = inside(x, y);
    },
    drag: none,
    mouseDown: none,
    mouseUp: async () => void deepTool(w, "click_at", { x: cursor[0], y: cursor[1] }),
    scroll: none,
    type: none,
    key: none,
    holdKey: none,
    cursor: async () => cursor,
    releaseAll: none,
    lastInjectedAt: () => 0,
  };
  const probe = {
    elementAt: async () => (w.focused === "GameHub" ? [{ role: "Pane", name: "GameHub" }] : []),
    focused: async () => ({
      role: "Pane",
      name: w.focused ?? "",
      help: "",
      window: w.focused ?? "",
      program: w.focused ?? "",
    }),
    textNear: async () =>
      w.focused === "GameHub"
        ? (TILES[w.gamehub.screen] ?? []).map((t) => ({
            text: t.name,
            box: { x: t.x, y: t.y, width: t.w, height: t.h },
          }))
        : [],
  };
  return screenTools({ capture, input, probe, settleMs: 0 });
}

export async function runHarness(task, spec) {
  const w = createWorld();
  w.whatsapp.contacts = ["Aryan", "Aryan Office", "Aarnav", "Priya", "Mummy", "Office Team"];
  w.gamehub = { screen: "home", launched: null, update: null, cart: [], ordered: false };
  task.setup?.(w);
  if (spec.startsWith("bedrock:")) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = readFileSync(KEY, "utf8").trim();
    process.env.AWS_REGION ??= "us-east-1";
  }
  const { model, stream } = resolveModel(spec, { chatUrl: LLM_URL });

  let turns = 0;
  const usage = { input: 0, output: 0, cacheRead: 0, cost: 0 };
  const counted = async (m, context, options) => {
    turns++;
    const s = await stream(m, context, options);
    s.result().then((r) => {
      usage.input += r.usage?.input ?? 0;
      usage.output += r.usage?.output ?? 0;
      usage.cacheRead += r.usage?.cacheRead ?? 0;
      usage.cost += r.usage?.cost?.total ?? 0;
    });
    return s;
  };

  const worldTools = TOOLS.map((t) => ({
    name: t.name,
    description:
      t.name === "open_app" ? t.description.replace("Explorer.", "Explorer, GameHub.") : t.description,
    parameters: t.parameters,
    risk: "safe",
    readOnly: LOOKS.has(t.name),
    // The fake tree names its Send button "send"; the real ui tool (T12) checks the element's name.
    classify:
      t.name === "click"
        ? (input) =>
            input?.id === "send"
              ? { kind: "ask", what: "Send the message", why: "it sends" }
              : { kind: "allow" }
        : undefined,
    run: async (input) => {
      const r = deepTool(w, t.name, input);
      // Speech mid-run (friend's bench: a correction or addition after the Nth tool call).
      if (task.steer && ++calls === task.steer.afterCalls)
        run.reply({ kind: "speech", text: task.steer.text });
      return r.image ? { text: r.text, image: { data: r.image, mimeType: "image/png" } } : { text: r.text };
    },
  }));
  // BENCH_DOMAIN=prose: the direct actions through src/tools/domain.ts, args in prose as the real
  // actions give them — the shape the app ships (T16 A/B, S-024; grouped lost and was removed).
  const prose = process.env.BENCH_DOMAIN === "prose";
  const asActions = worldTools
    .filter((t) => DIRECT.includes(t.name))
    .map((t) => ({
      id: t.name,
      describe: t.description.replace(/\.$/, ""),
      // In the real actions' own format, `{"name": string, "level"?: number}` — what argsSchema
      // reads. A JSON schema here was read as a field named "type" (S-024, a wasted run).
      args: proseArgs(t.parameters),
      run: async (args) => ({ did: (await t.run(args)).text }),
    }));
  const tools = [
    ...(prose ? worldTools.filter((t) => !DIRECT.includes(t.name)) : worldTools),
    ...(prose ? domainTools(asActions, DIRECT) : []),
    ...fakeScreen(w),
  ];

  let calls = 0;
  let asks = 0;
  let approvals = 0;
  const t0 = performance.now();
  const run = createAssistant({
    model,
    stream: counted,
    systemPrompt: `${buildSystemPrompt({ memory: "", playbookIndex: "", recent: [] })}\n\n${WORLD_FACTS}`,
    tools,
    observeState: async () => STATE(w),
    getApiKey: (p) => (p === "openrouter" ? process.env.SUBX_TOKEN : undefined),
    waitForUserMs: 2000,
    // T19b A/B: the friend's multi-part checklist, kept only if it lifts a mid model.
    checklist: process.env.BENCH_CHECKLIST === "1",
  }).start(task.say, (e) => {
    if (e.kind === "ask") {
      asks++;
      w.asksAsked = asks;
      // A task that is about a choice only the user can make carries the user's answer.
      run.reply({ kind: "speech", text: task.answer ?? "aap khud tay karo, jo sabse theek lage" });
    }
    if (e.kind === "approve") {
      approvals++;
      w.approvalsAsked = approvals;
      run.reply({ kind: "approval", id: e.id, allowed: false });
    }
  });
  const result = await run.finished;
  w.final = result.text;
  return { w, ms: Math.round(performance.now() - t0), turns, usage, final: result.text, asks, approvals };
}
