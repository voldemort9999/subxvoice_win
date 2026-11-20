import type { DictionaryEntry } from "./types";

/**
 * Learning the user's words from their own fixes,: after
 * SUBXVoice pastes, the platform reads the text field again (Accessibility on the Mac) and hands both texts here. What looks like a recognition fix of a name or term becomes a
 * dictionary word, which goes to the recogniser as context next time, so the same mistake is not
 * made twice. Everything here runs on the device; only the learned word is stored.
 *
 * Any word can be learned, in any script ("parson" → "parso", "भविष्य" → "भावेश"),
 * but narrowly, because a wrong lesson is worse than none:
 * - Single words only (user, 2026-11-20): one word written where we wrote one (or two the
 *   recogniser split), inside what we pasted. A phrase, or a rewrite of the sentence, is the user
 *   changing their mind, not a mistake of ours.
 * - The new spelling must look or sound like what we wrote ("Arnav" → "Aarnav"), so a word swapped
 *   for an unrelated one is not taken as a correction.
 * - `name` marks words with a capital or a digit (names, brands, acronyms). The app learns those on
 *   the first fix and other words only once the same fix is seen again, so a one-off grammar fix
 *   ("there" → "they're") does not pad the recogniser's context.
 * - Vocabulary only. A learned word never becomes a replacement rule ("misheard as"): replacing
 *   "seller's" with "Celeris" everywhere would break other sentences. Users add those rules by hand.
 */
export interface LearnedWord {
  /** The spelling the user wants. */
  word: string;
  /** What SUBXVoice had written instead. */
  heardAs: string;
  /** A capital letter or a digit: a name, brand or acronym. */
  name: boolean;
}

/** A word: letters, marks, digits, and joiners inside it (don't, e-mail, SUBX.ai). */
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’.-][\p{L}\p{M}\p{N}]+)*/gu;
const words = (text: string) => text.match(WORD) ?? [];
const fold = (word: string) => word.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");

/** More than this share of our words changed means the user rewrote it, not corrected it. */
const REWRITE_SHARE = 0.4;
const MAX_SWAP = 3;

export function learnFromEdit(pasted: string, fieldNow: string): LearnedWord[] {
  return editsIn(pasted, fieldNow) ?? [];
}

/**
 * The user's fixes to what we pasted, or null when our text is no longer in the field (the message
 * was sent, the field cleared or rewritten). Watching a field over time, null means "keep what the
 * last reading said", where [] means "nothing to learn after all" (the user put it back).
 */
export function editsIn(pasted: string, fieldNow: string): LearnedWord[] | null {
  const ours = words(pasted);
  const theirs = words(fieldNow);
  if (ours.length === 0 || theirs.length === 0) return null;

  const window = locate(ours, theirs);
  if (!window) return null;
  const ops = diff(ours, theirs.slice(window.start, window.end));

  const changed = ops.filter((op) => op.kind === "delete").length;
  if (changed / ours.length > REWRITE_SHARE) return [];

  const learned: LearnedWord[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ops.length; i++) {
    if (ops[i]?.kind !== "delete") continue;
    const removed: string[] = [];
    const added: string[] = [];
    let j = i;
    while (ops[j]?.kind === "delete") removed.push((ops[j++] as Op).word);
    while (ops[j]?.kind === "insert") added.push((ops[j++] as Op).word);
    i = j - 1;
    if (added.length === 0 || removed.length > MAX_SWAP || added.length > MAX_SWAP) continue;
    // Single words only (user, 2026-11-20: "words par kaam kare as single words … lines ya phrases
    // ke liye tayiyaar nahi"): one word in, written where we wrote one word, or two the recogniser
    // split ("SUBX voice" → "SUBXVoice"). A phrase ("Aarnav bhai ji"), or the previous dictation
    // glued to ours ("Jootiyan mat karoJyotiyaapa", Windows hand test), is never learned.
    if (added.length !== 1 || removed.length > 2) continue;
    const word = added.join(" ");
    const heardAs = removed.join(" ");
    if (!isLearnable(word, heardAs) || seen.has(fold(word))) continue;
    seen.add(fold(word));
    learned.push({ word, heardAs, name: /[\p{Lu}\p{N}]/u.test(word) });
  }
  return learned;
}

/** Adds learned words the dictionary does not already have, as vocabulary (no replacement rule). */
export function mergeLearned(entries: DictionaryEntry[], learned: LearnedWord[]): DictionaryEntry[] {
  const known = new Set(entries.map((entry) => fold(entry.word)));
  const added = learned.filter((item) => !known.has(fold(item.word)));
  return [...entries, ...added.map((item) => ({ word: item.word, misheardAs: [] }))];
}

function isLearnable(word: string, heardAs: string): boolean {
  if (word.length < 2 || word.length > 60) return false;
  // Only the spelling of a word we wrote, not a different word: "Arnav"/"Aarnav", "seller's"/"Celeris".
  const a = fold(heardAs).replace(/[^\p{L}\p{N}]/gu, "");
  const b = fold(word).replace(/[^\p{L}\p{N}]/gu, "");
  if (a === b) return word !== heardAs; // only the capitals changed: "bhavesh" → "Bhavesh"
  // Our word with other text stuck to one side ("textArnav"): two pastes with no space between
  // them, not a respelling. A letter or two is a fix ("Arnav" → "Aarnav").
  if ((b.startsWith(a) || b.endsWith(a)) && b.length - a.length >= 3) return false;
  if (scriptOf(a) !== scriptOf(b)) return false;
  const close = (x: string, y: string) => levenshtein(x, y) / Math.max(x.length, y.length) <= 0.6;
  return close(a, b) || skeleton(a) === skeleton(b) || close(spoken(a), spoken(b));
}

/**
 * A Hindi word typed in Latin letters, with the usual spelling variants folded together: "Maujooma"
 * and "Mojmar" are one name said two ways (Windows hand test, 2026-11-20: the fix was never learned).
 */
const spoken = (text: string) =>
  text
    .replace(/au|ou/g, "o")
    .replace(/oo/g, "u")
    .replace(/aa/g, "a")
    .replace(/ee|ii/g, "i")
    .replace(/(.)\1+/g, "$1");

/** Latin or not: a Hindi word swapped for an English one is a translation, not a spelling fix. */
const scriptOf = (text: string) => (/\p{Script=Latin}/u.test(text) ? "latin" : "other");

/** Consonants only, doubled letters merged: "Aarnav" and "Arnav" both read "rnv". */
const skeleton = (text: string) => text.replace(/[aeiouy]/g, "").replace(/(.)\1+/g, "$1");

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j] as number;
      row[j] = Math.min(current + 1, (row[j - 1] as number) + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length] as number;
}

/**
 * Where our text sits in the field: from the first to the last of our words found in it, in order.
 * The field usually holds more than we pasted (the rest of an email, earlier messages).
 */
function locate(ours: string[], theirs: string[]): { start: number; end: number } | null {
  const foldedTheirs = theirs.map(fold);
  const anchors = ours.map(fold);
  let start = -1;
  for (let i = 0; i < anchors.length && start < 0; i++) start = foldedTheirs.indexOf(anchors[i] as string);
  if (start < 0) return null;
  let end = -1;
  for (let i = anchors.length - 1; i >= 0 && end < 0; i--)
    end = foldedTheirs.lastIndexOf(anchors[i] as string);
  if (end < start) return null;
  // The first and last of our words may themselves have been fixed; leave room on both sides.
  return {
    start: Math.max(0, start - MAX_SWAP),
    end: Math.min(theirs.length, end + 1 + MAX_SWAP),
  };
}

interface Op {
  kind: "keep" | "delete" | "insert";
  word: string;
}

/** Word-level diff (longest common subsequence), case- and accent-blind for matching. */
function diff(a: string[], b: string[]): Op[] {
  const fa = a.map(fold);
  const fb = b.map(fold);
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      (lcs[i] as number[])[j] =
        fa[i] === fb[j]
          ? ((lcs[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((lcs[i + 1] as number[])[j] as number, (lcs[i] as number[])[j + 1] as number);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && fa[i] === fb[j]) {
      // Same word but the user changed its capitals: a swap, so "bhavesh" → "Bhavesh" is seen.
      if (a[i] !== b[j])
        ops.push({ kind: "delete", word: a[i] as string }, { kind: "insert", word: b[j] as string });
      else ops.push({ kind: "keep", word: a[i] as string });
      i++;
      j++;
    } else if (
      j < b.length &&
      (i === a.length || ((lcs[i] as number[])[j + 1] as number) >= ((lcs[i + 1] as number[])[j] as number))
    ) {
      ops.push({ kind: "insert", word: b[j++] as string });
    } else {
      ops.push({ kind: "delete", word: a[i++] as string });
    }
  }
  // Group each run of deletions before its insertions, so a swap reads delete…insert.
  return regroup(ops);
}

function regroup(ops: Op[]): Op[] {
  const out: Op[] = [];
  let deletes: Op[] = [];
  let inserts: Op[] = [];
  const flush = () => {
    out.push(...deletes, ...inserts);
    deletes = [];
    inserts = [];
  };
  for (const op of ops) {
    if (op.kind === "keep") {
      flush();
      out.push(op);
    } else (op.kind === "delete" ? deletes : inserts).push(op);
  }
  flush();
  return out;
}
