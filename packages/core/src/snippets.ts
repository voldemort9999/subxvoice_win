/**
 * Snippets: what the person says (one or more ways of saying it, in any language or script) and the
 * text that goes in for it. Made by the person; there is no built-in list. Ported from the Mac app's
 * SUBXCore/Snippets.swift (e6315c8, c8eec41).
 *
 * Two cases, both decided on this computer with nothing sent anywhere: the whole dictation is a
 * trigger (its text goes in at once), or a trigger is said inside a sentence (the words go in as said
 * and the pill offers the snippet: "check my email" must not become an address, and only the person
 * knows which was meant). Matching is on what the person sees: any case, any punctuation the clean-up
 * added ("My email."), any spacing.
 */
export interface Snippet {
  id: string;
  triggers: string[];
  text: string;
}

/** A trigger said inside a sentence: the snippet, the trigger as given, and the sentence with it swapped in. */
export interface SnippetInside {
  snippet: Snippet;
  trigger: string;
  text: string;
}

/** From a saved record ({id, triggers, text}); null when it has nothing to say or to type. */
export function snippetFrom(record: unknown): Snippet | null {
  if (!record || typeof record !== "object") return null;
  const { id, triggers, text } = record as Record<string, unknown>;
  if (typeof id !== "string" || typeof text !== "string" || !text.trim()) return null;
  const said = (Array.isArray(triggers) ? triggers : [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => plain(item) !== "");
  return said.length ? { id, triggers: said, text } : null;
}

/** The dictation is one of the triggers, and nothing else. */
export function wholeSnippet(text: string, snippets: Snippet[]): Snippet | null {
  const said = plain(text);
  if (!said) return null;
  return snippets.find((snippet) => snippet.triggers.some((trigger) => plain(trigger) === said)) ?? null;
}

/**
 * A trigger said among other words: which snippet, which of its triggers, and the dictation with the
 * snippet's text in its place (every time that trigger was said). The longest trigger is tried
 * first, so "my work email" wins over "my email".
 */
export function snippetInside(text: string, snippets: Snippet[]): SnippetInside | null {
  const candidates = snippets
    .flatMap((snippet) => snippet.triggers.map((trigger) => ({ snippet, trigger })))
    .sort((a, b) => [...b.trigger].length - [...a.trigger].length);
  for (const { snippet, trigger } of candidates) {
    const regex = pattern(trigger);
    if (!regex?.test(text)) continue;
    regex.lastIndex = 0;
    // A function, so "$1" in the snippet's text is text, not a reference to the match.
    return { snippet, trigger, text: text.replace(regex, () => snippet.text) };
  }
  return null;
}

/** Lowercased, without punctuation or symbols, spaces made single: what is compared. */
export function plain(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "")
    .split(/\s+/u)
    .filter(Boolean)
    .join(" ");
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The trigger as whole words, any case, any spacing between its words. In a script written without
 * spaces (Chinese, Japanese, Thai, Lao, Khmer, Burmese) there are no word edges to look for:
 * "我的邮箱" inside "请发到我的邮箱" is found as it stands.
 */
function pattern(trigger: string): RegExp | null {
  const words = trigger.split(/\s+/u).filter(Boolean).map(escapeRegex);
  if (!words.length) return null;
  if (SPACELESS.test(trigger)) return new RegExp(words.join("\\s*"), "giu");
  const wordChar = "[\\p{L}\\p{M}\\p{N}_]";
  return new RegExp(`(?<!${wordChar})${words.join("\\s+")}(?!${wordChar})`, "giu");
}

/** A letter of a script that does not put spaces between words: kana, CJK, Thai, Lao, Burmese, Khmer. */
const SPACELESS = /[぀-ヿ㐀-䶿一-鿿豈-﫿฀-໿က-႟ក-៿]/u;
