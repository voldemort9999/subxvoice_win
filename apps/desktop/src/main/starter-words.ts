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
 * in one case gets a capital, as people write their own name ("BHAVESH" → "Bhavesh": in capitals it
 * wrote the name in capitals in every dictation; the Mac app, 6424d95). Short all-capital parts
 * ("AJ") are initials and stay; a part already mixed, or in a script without capitals, stays as typed.
 */
export function nameWords(name: string): string[] {
  const words: string[] = [];
  for (const part of name.trim().split(/\s+/)) {
    const letters = part.replace(/[^\p{L}\p{M}'-]/gu, "");
    if ([...letters].length < 2 || letters.length > 40) continue;
    const oneCase =
      letters === letters.toLowerCase() || (letters === letters.toUpperCase() && [...letters].length > 3);
    const word = oneCase ? letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase() : letters;
    if (!words.some((existing) => existing.toLowerCase() === word.toLowerCase())) words.push(word);
  }
  return words;
}

/**
 * A name given before names in capitals were fixed ("BHAVESH"): written as it should be, in place.
 * Returns how many were fixed.
 */
export async function fixCapitalNames(dictionary: DictionaryStore, name: string): Promise<number> {
  let fixed = 0;
  for (const word of nameWords(name)) {
    if (word === word.toUpperCase()) continue;
    const old = (await dictionary.all()).find((entry) => entry.word === word.toUpperCase());
    if (!old) continue;
    await dictionary.upsert({ ...old, word });
    await dictionary.remove(old.word);
    fixed++;
  }
  return fixed;
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
