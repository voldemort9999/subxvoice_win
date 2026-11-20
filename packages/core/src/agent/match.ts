/**
 * Choosing one thing from a list of named things.
 *
 * Ported from the personal computer-mcp (`core/match.py`), where it was written after both earlier
 * versions failed in opposite directions: one reported "no match" when two devices matched, which
 * reads as though the device is absent; the other silently took the first of several and connected
 * the wrong headphones while reporting success. There are three honest answers — this one, none of
 * them, several and I must be told which — and this keeps all three apart.
 *
 * Tiers run in order and the first that matches anything decides. "speakers" should not be
 * ambiguous merely because a full name is "Speakers (Steam Streaming Speakers)": a prefix match
 * beats a substring match, and only ties within a tier are ambiguous. A tier with several matches
 * stops the search — a looser tier can only match more.
 */

export type MatchHow = "id" | "exact" | "prefix" | "word" | "substring" | "ambiguous" | "none";

export interface Match<T> {
  chosen: T | null;
  candidates: T[];
  how: MatchHow;
}

export function resolveOne<T>(
  query: string,
  items: readonly T[],
  name: (item: T) => string,
  identity?: (item: T) => string,
): Match<T> {
  const needle = loose(query);
  if (!needle) return { chosen: null, candidates: [], how: "none" };

  // An exact id cannot be ambiguous, so it wins before any name is compared.
  if (identity) {
    const byId = items.find((item) => identity(item) === query.trim());
    if (byId !== undefined) return { chosen: byId, candidates: [byId], how: "id" };
  }

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u");
  const tiers: [MatchHow, (text: string) => boolean][] = [
    ["exact", (text) => text === needle],
    ["prefix", (text) => text.startsWith(needle)],
    ["word", (text) => word.test(text)],
    ["substring", (text) => text.includes(needle)],
  ];

  for (const [how, matches] of tiers) {
    const found = items.filter((item) => matches(loose(name(item))));
    if (found.length === 1) return { chosen: found[0] as T, candidates: found, how };
    if (found.length > 1) return { chosen: null, candidates: found, how: "ambiguous" };
  }
  return { chosen: null, candidates: [], how: "none" };
}

/**
 * The candidate a misheard name is nearest to, or null when none is close enough to say so (plan
 * T16, friend's bench recommendation 4): "Aryn" not found → "closest: Aryan", so the prompt's
 * sound-alike rule acts on a fact. Each candidate is compared by as many leading words as the
 * name has — "dragon" against "Dragon Bhai" — and close means about one edit in three letters.
 */
export function closest(name: string, candidates: readonly string[]): string | null {
  const wanted = loose(name);
  const words = wanted.split(" ").length;
  let best: string | null = null;
  let bestDistance = Math.max(1, Math.round(wanted.length / 3)) + 1;
  for (const candidate of candidates) {
    const head = loose(candidate).split(" ").slice(0, words).join(" ");
    const distance = edits(wanted, head);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Levenshtein distance. */
function edits(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        (row[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[b.length] ?? 0;
}

/**
 * Lower case, with "-", "_" and "." read as spaces and runs of space as one: "Multi-Instance" is
 * "Multi Instance" (S-024, a window close that failed on the hyphen alone).
 */
const loose = (text: string) =>
  text
    .toLowerCase()
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
