import type { DeciderProvider } from "../contracts/decider";
import type { LlmProvider } from "../contracts/llm";
import type {
  ActionSource,
  AgentAction,
  ScreenDriver,
  ScreenElement,
  ScreenSnapshot,
  StepContext,
} from "./types";

/**
 * Screen control: what is inside an app's window, read from the OS's accessibility tree.
 *
 * The same shape as `ZJU-REAL/CUA-JEV` and `browser-use/jev-ultrafast`: code turns what is on
 * screen into a numbered list of elements, and Jev — a classifier, which cannot invent an element —
 * picks the one this step acts on. Measured 2026-11-11 on lists shaped like YouTube results and
 * WhatsApp (37 and 34 elements): 11/11 right, including "the second video" and refusing a WhatsApp
 * chat on a YouTube page, in 0.5–1 s.
 *
 * These actions are described so that the decider reaches them only for what nothing direct can do:
 * the volume is set through Core Audio, never by dragging a slider.
 */

/** Below this the element is a guess, and clicking a guess in someone's chat list is not harmless. */
const MIN_CONFIDENCE = 0.5;

/** Jev was measured on ~40 options; a long page is cut, keeping the top of the window. */
const MAX_ELEMENTS = 120;

const NONE = "nothing_fits";

/** How long a step waits for a window that is still filling in. */
const LOADING_MS = 10_000;

/** How long a step looks for the window it names before saying it isn't open. */
const FINDING_MS = 4000;

async function readSoon(driver: ScreenDriver, hint: string, pauseMs: number): Promise<ScreenSnapshot> {
  const deadline = Date.now() + FINDING_MS;
  for (;;) {
    try {
      return await driver.read(hint);
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }
}

const NO_STEP: StepContext = { said: "", step: "" };

export const ELEMENT_QUESTION =
  "Choose the on-screen element this step acts on. If none of them is it, choose nothing_fits.";

export const READ_SYSTEM =
  "You answer a question about what an app on the user's computer is showing, from the list of " +
  "what is on its screen. Answer in one or two short sentences, in the language the user spoke but " +
  "always in Roman (Latin) letters, never Devanagari, even when their words arrive in Devanagari: " +
  "'Haan, WhatsApp logged in hai.' If the list does not show the answer, say so.";

export function screenSource(
  driver: ScreenDriver,
  decider: DeciderProvider,
  writer: LlmProvider,
  log?: (line: string) => void,
  pauseMs = 800,
): ActionSource {
  const pick = async (
    snapshot: ScreenSnapshot,
    context: StepContext,
    narrow: (elements: ScreenElement[]) => ScreenElement[],
  ): Promise<ScreenElement> => {
    const elements = narrow(snapshot.elements).slice(0, MAX_ELEMENTS);
    if (!elements.length) throw new Error(`Nothing to act on in ${snapshot.window}`);
    const results = numberResults(elements);
    const criteria: Record<string, string> = {};
    for (const element of elements) criteria[`e${element.id}`] = labelled(element, results);
    criteria[NONE] = "None of these elements is the one this step acts on";
    const { choice, confidence, probabilities } = await decider.decide({
      state: [`This step: ${context.step}`, `User said: "${context.said}"`, `Window: ${snapshot.window}`],
      criteria,
      instructions: ELEMENT_QUESTION,
    });
    const ranked = Object.entries(probabilities ?? {})
      .sort(([, a], [, b]) => b - a)
      .map(([id]) => id);
    const top = ranked.length ? ranked.slice(0, 3) : [choice];
    let chosen =
      confidence >= MIN_CONFIDENCE ? elements.find((element) => `e${element.id}` === choice) : undefined;
    // A sure "none of these" is an answer, not doubt: the WhatsApp message box asked for before any
    // chat was open. No second opinion overrides it.
    const surelyNone = choice === NONE && confidence >= MIN_CONFIDENCE;
    // One candidate and Jev's top pick is it: there is no other element it could have meant. A
    // search box holding the last search loses its name in WhatsApp, and both models then
    // hesitated over "Edit (unlabelled) at the top" — the only box there was — at 0.42.
    if (!chosen && elements.length === 1 && choice === `e${elements[0]?.id}`) chosen = elements[0];
    log?.(
      `screen: ${elements.length} offered in ${snapshot.window} → ${criteria[choice] ?? choice} (${confidence.toFixed(2)}; top ${top.map((id) => criteria[id] ?? id).join(" | ")})`,
    );
    if (!chosen && !surelyNone) {
      // Jev unsure: on a real YouTube page it spread "the 4th video" over three links at 0.2 each.
      // The writer reads the same numbered list; its answer is taken only if Jev ranked it in its
      // own top three, so a click still needs both of them to point the same way.
      const second = await secondOpinion(writer, criteria, context, snapshot.window).catch(() => null);
      log?.(`screen: second opinion → ${second ? (criteria[second] ?? second) : "none"}`);
      if (second && second !== NONE && top.includes(second))
        chosen = elements.find((element) => `e${element.id}` === second);
    }
    if (!chosen) throw new Error(`Couldn't find that in ${snapshot.window}`);
    return chosen;
  };

  /**
   * A window still loading has not got the element yet: WhatsApp just started shows its chats a
   * few seconds after its window, a page just clicked fills in after the click. So a step that
   * finds nothing reads again while the window is still changing, up to LOADING_MS, and asks Jev
   * again only when there is something new to look at. A window that has stopped changing and
   * still lacks it is an answer — no waiting for nothing.
   */
  const settled = async (
    context: StepContext,
    narrow: (elements: ScreenElement[]) => ScreenElement[],
  ): Promise<{ snapshot: ScreenSnapshot; element: ScreenElement }> => {
    const deadline = Date.now() + LOADING_MS;
    let seen: string | null = null;
    let failure: unknown;
    for (;;) {
      // A page opened by the step before still carries its old title for a moment — "YouTube isn't
      // open" came straight after YouTube was searched — so a place not found yet is looked for
      // again, briefly.
      const snapshot = await readSoon(driver, context.step, pauseMs);
      const now = snapshot.elements.map((element) => `${element.role}:${element.name}`).join("\n");
      if (seen !== null && (now === seen || Date.now() >= deadline)) throw failure;
      seen = now;
      try {
        return { snapshot, element: await pick(snapshot, context, narrow) };
      } catch (error) {
        failure = error;
      }
      log?.(`screen: not there yet in ${snapshot.window} — reading again`);
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  };

  const click: AgentAction = {
    id: "screen_click",
    describe:
      "Click or open something shown inside an app's window that no other action can do — a video in " +
      "the results, a chat, a link, a button or a tab. Brings that window forward itself",
    run: async (_args, context = NO_STEP) => {
      const { snapshot, element } = await settled(context, clickable);
      await driver.click(element.id);
      return { did: `Clicked "${short(element.name)}" in ${snapshot.window}` };
    },
  };

  const type: AgentAction = {
    id: "screen_type",
    // Says "particular box … clicking into it first" so the decider tells it from type_text, which
    // types wherever the cursor already is: worded alike, the two split the vote at 0.44.
    describe:
      "Click into a particular box inside an app's window — its search box, a chat's message box — and " +
      "type there, bringing that window forward itself. Types only; never sends",
    args:
      '{"text": string} — only the words to type into the box, in Roman letters, never translated. A search ' +
      "is the name or words being searched for; a message is the message itself.",
    run: async (args, context = NO_STEP) => {
      const text = typeof args.text === "string" ? args.text.trim() : "";
      if (!text) throw new Error("What should I type?");
      const { snapshot, element } = await settled(context, boxes);
      await driver.typeInto(element.id, text);
      const box = element.name ? `"${short(element.name)}"` : `the box at the ${element.where ?? "top"}`;
      return { did: `Typed "${short(text)}" into ${box} in ${snapshot.window}` };
    },
  };

  const read: AgentAction = {
    id: "screen_read",
    describe:
      "Read what an app's window is showing to answer a question about it, such as whether WhatsApp is " +
      "logged in or what the top email is",
    run: async (_args, context = NO_STEP) => {
      const snapshot = await driver.read(context.step);
      const response = await writer.complete({
        system: READ_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              `Window: ${snapshot.window}`,
              "On screen, top to bottom:",
              ...snapshot.elements.slice(0, 300).map((element) => `- ${label(element)}`),
              // What the user asked, not the step: the plan turned "is WhatsApp logged in?" into
              // "Read what WhatsApp is showing", and the answer described the screen instead.
              `The user asked: "${context.said}"`,
            ].join("\n"),
          },
        ],
        maxTokens: 200,
      });
      const answer = response.text.trim();
      if (!answer) throw new Error(`Couldn't read ${snapshot.window}`);
      return { did: `Read ${snapshot.window}`, answer };
    },
  };

  return { observe: async () => [], actions: async () => [click, type, read] };
}

/**
 * What can be clicked, one element per name. A web page names one thing three times — YouTube gives
 * each video as a Text, a Link and a Group — and Jev, offered all three, split its confidence
 * between them and was sure of none (the second video was missed for exactly this). The most
 * clickable role keeps the name; containers and bare labels go.
 */
const RANK: Record<string, number> = {
  Link: 0,
  Button: 1,
  SplitButton: 1,
  ListItem: 2,
  Row: 2,
  TreeItem: 2,
  MenuItem: 2,
  TabItem: 2,
  CheckBox: 3,
  RadioButton: 3,
  ComboBox: 3,
  HeaderItem: 3,
  Edit: 4,
  Group: 5,
  Text: 6,
  Image: 7,
};

/**
 * Long names are compared by their start. YouTube also gives each video two links worded
 * differently at the end — "Kesariya - Brahmāstra | … 4K · 2:53" and "… 4K 2 minutes, 53 seconds" —
 * so "the second video" landed on the first video's second link.
 */
const SAME_START = 40;

export function clickable(elements: ScreenElement[]): ScreenElement[] {
  const best = new Map<string, ScreenElement>();
  for (const element of elements) {
    const rank = RANK[element.role];
    const name = element.name.trim().toLowerCase().slice(0, SAME_START);
    // "•", "4y ago", "624M": labels, not things anyone asks to click.
    if (rank === undefined || !name || (rank >= 6 && name.length < 8)) continue;
    const held = best.get(name);
    if (!held || rank < (RANK[held.role] ?? 9)) best.set(name, element);
  }
  // On a web page — many links — loose text is video descriptions and captions, which only dilute
  // the choice; in an app without links, text may be all there is to click.
  const page = [...best.values()].filter((element) => element.role === "Link").length >= 5;
  const kept = new Set(
    [...best.values()].filter((element) => element.role !== "Image" && !(page && element.role === "Text")),
  );
  // Back in the window's own order, top to bottom: "the second video" depends on it.
  return elements.filter((element) => kept.has(element));
}

/** Real boxes first; a whole page that accepts text (Chrome's document, WhatsApp's) only if there are none. */
export function boxes(elements: ScreenElement[]): ScreenElement[] {
  const editable = elements.filter((element) => element.editable);
  const real = editable.filter((element) => element.role !== "Document");
  return real.length ? real : editable;
}

/**
 * The page's content items — videos, chats, results — numbered in order, so "the 4th video" is
 * matched by its label instead of counted. Jev is a classifier, not a counter: asked for "the 4th
 * video" among 62 unnumbered options it spread its vote at 0.2–0.27 and nothing was clicked. An
 * item is a link or a row with a long name; toolbar buttons and "Go to channel …" are not items.
 */
function numberResults(elements: ScreenElement[]): Map<number, number> {
  const items = elements.filter(
    (element) =>
      ["Link", "ListItem", "Row", "TreeItem"].includes(element.role) &&
      element.name.length >= 25 &&
      !/^go to channel/i.test(element.name) &&
      // YouTube's sidebar lists subscribed channels as "Kahani YT. New content available." —
      // long-named links that are not results; "first wala channel" once opened one.
      !/new content available\.?$/i.test(element.name),
  );
  // Where items carry a running time, those are the videos, and only they are counted: "first
  // wala chalao" once clicked "Kahani YT. New content available." — a channel in YouTube's
  // sidebar, long-named like a video. Elsewhere (a chat list) every item counts.
  const timed = items.filter((element) => DURATION.test(element.name));
  const counted = timed.length >= 3 ? timed : items;
  return new Map(counted.map((element, index) => [element.id, index + 1]));
}

/** "4 minutes, 22 seconds", "1 hour, 2 minutes", "· 3:45". */
const DURATION = /\b\d+ (?:hours?|minutes?|seconds?)\b|·\s*\d{1,2}:\d{2}\b/i;

function labelled(element: ScreenElement, results: Map<number, number>): string {
  const number = results.get(element.id);
  return number ? `${ordinal(number)} result: ${label(element)}` : label(element);
}

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

const SECOND_OPINION_SYSTEM =
  "You choose which on-screen element a step on the user's computer acts on, from a numbered list. " +
  'Reply with only that element\'s key, such as "e12", or "none" if no element on the list is it.';

async function secondOpinion(
  writer: LlmProvider,
  criteria: Record<string, string>,
  context: StepContext,
  window: string,
): Promise<string | null> {
  const response = await writer.complete({
    system: SECOND_OPINION_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `Window: ${window}`,
          ...Object.entries(criteria)
            .filter(([id]) => id !== NONE)
            .map(([id, text]) => `${id}: ${text}`),
          `This step: ${context.step}`,
          `The user said: "${context.said}"`,
        ].join("\n"),
      },
    ],
    maxTokens: 10,
  });
  const key = /\be\d+\b|\bnone\b/i.exec(response.text)?.[0]?.toLowerCase();
  return key === "none" ? NONE : (key ?? null);
}

/** What the decider reads for one element: its role and its name, and a box's contents. */
function label(element: ScreenElement): string {
  const value = element.value ? ` containing "${short(element.value, 60)}"` : "";
  const where = element.where ? ` at the ${element.where} of the window` : "";
  // A box with no name at the top is, in practice, a search box that has lost its label: WhatsApp's
  // does once it holds a search, and Jev then refused it outright (nothing_fits 0.78).
  const name = element.name
    ? `"${short(element.name, 120)}"`
    : element.where === "top"
      ? "(unlabelled — at the top, where a search box usually is)"
      : "(unlabelled)";
  return `${element.role} ${name}${element.name || element.where !== "top" ? where : ""}${value}`;
}

const short = (text: string, max = 40) => (text.length > max ? `${text.slice(0, max)}…` : text);
