import type { DictionaryEntry, DictionaryStore } from "@subx/core";

/**
 * Words every account's dictionary starts with: the product's name, and the person's own name, so
 * both come out spelled right from the first dictation (the user's call, 2026-11-20). SUBXVoice was
 * heard as "sab X voice" and "sub x voice" before it was in a dictionary.
 */
export const PRODUCT_WORD: DictionaryEntry = {
  word: "SUBXVoice",
  misheardAs: ["sub x voice", "subx voice", "sab x voice"],
};

/**
 * Each part of a name as its own word ("choudhary aryan" → "Choudhary", "Aryan"): a part typed all
 * in lowercase gets a capital, as people write their own name; one already capitalised, or in a
 * script without capitals, stays as typed. Initials and bits without letters are left out.
 */
export function nameWords(name: string): string[] {
  const words: string[] = [];
  for (const part of name.trim().split(/\s+/)) {
    const letters = part.replace(/[^\p{L}\p{M}'-]/gu, "");
    if ([...letters].length < 2 || letters.length > 40) continue;
    const word =
      letters === letters.toLowerCase() ? letters.charAt(0).toUpperCase() + letters.slice(1) : letters;
    if (!words.some((existing) => existing.toLowerCase() === word.toLowerCase())) words.push(word);
  }
  return words;
}

/**
 * Adds the starter words that are not in the dictionary yet (compared without case, so a spelling
 * the person already chose wins). Returns how many were added.
 */
export async function addStarterWords(
  dictionary: DictionaryStore,
  name: string,
  now = Date.now(),
): Promise<number> {
  const have = new Set((await dictionary.all()).map((entry) => entry.word.toLowerCase()));
  const wanted: DictionaryEntry[] = [
    PRODUCT_WORD,
    ...nameWords(name).map((word) => ({ word, misheardAs: [] })),
  ];
  let added = 0;
  for (const entry of wanted) {
    if (have.has(entry.word.toLowerCase())) continue;
    await dictionary.upsert({ ...entry, misheardAs: [...entry.misheardAs], source: "you", addedAt: now });
    have.add(entry.word.toLowerCase());
    added++;
  }
  return added;
}
