// How many words a text has, in any language. Used for every word figure the app shows (Home,
// Insights, history) and for the daily totals kept in the main process, so they always agree.

/**
 * Scripts written without spaces between words. Splitting on spaces counted a whole Japanese,
 * Chinese or Thai sentence as one word (2026-11-20); their words are found with the word segmenter
 * instead (dictionary-based for Chinese and Japanese).
 */
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** A piece with no letter or digit (a dash, an ellipsis, a lone emoji) is not a word. */
const HAS_WORD = /[\p{L}\p{N}]/u;

let segmenter: Intl.Segmenter | null = null;

/**
 * Words between spaces, as people count them in spaced languages: "3:30", "₹2,000" and
 * "aryan.sharma@gmail.com" are one word each, "—" is none. Inside a piece written in a script
 * without spaces, each word the segmenter finds counts.
 */
export function wordCount(text: string): number {
  let count = 0;
  for (const piece of text.split(/\s+/)) {
    if (!HAS_WORD.test(piece)) continue;
    if (!UNSPACED.test(piece)) {
      count++;
      continue;
    }
    segmenter ??= new Intl.Segmenter(undefined, { granularity: "word" });
    let words = 0;
    for (const part of segmenter.segment(piece)) if (part.isWordLike) words++;
    count += Math.max(1, words);
  }
  return count;
}
