/**
 * One name, one shape.
 *
 * Everything a restaurant owner types by hand arrives slightly differently every
 * time: "Mozzarella", "mozzarella ", "Mozzarella  Cheese", "MOZZARELLA".
 * To the database those are four different stock items, and four stock items
 * mean the mozzarella on the shelf is split four ways — recipes point at one of
 * them, deliveries land on another, and the food-cost figure on the dashboard
 * quietly becomes fiction.
 *
 * So before anything is compared or saved, the name is reduced to a key:
 * one predictable string that ignores the things a human varies without meaning
 * to. The key is stored beside the name (`nameKey`) so a duplicate can be found
 * with an index instead of a scan.
 *
 * What the key deliberately does NOT do: stem, singularise, or translate.
 * "Egg" and "Eggs" stay different, because in a kitchen they sometimes are
 * ("Egg" the ingredient, "Eggs" the tray of thirty). Guessing there would block
 * a legitimate entry, and a false block is worse than a warning — the owner
 * stops trusting the warnings.
 *
 * No `server-only`: the same function runs in the browser so the field can warn
 * as the user types, and on the server so the guard cannot be bypassed.
 */

/**
 * Reduce a typed name to its comparison key.
 *
 * - Unicode-normalised and stripped of combining marks, so "Crème" and "Creme"
 *   are the same ingredient. Georgian has no combining marks and passes through.
 * - Lower-cased.
 * - Every run of anything that is not a letter or a digit becomes one space:
 *   "Coca-Cola", "Coca Cola" and "coca_cola" all land on "coca cola".
 * - Trimmed.
 *
 * Returns "" for an empty or punctuation-only name — callers must treat "" as
 * "no key", never as a value to match on, or every unnamed row collides.
 */
export function nameKey(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The key for a `{en,ka}` Json name. English is the source language; Georgian
 *  is the fallback for a record that only ever had a Georgian name. */
export function nameKeyOfI18n(v: unknown): string {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return nameKey(String(o.en ?? "") || String(o.ka ?? ""));
  }
  return nameKey(String(v ?? ""));
}

/** Levenshtein distance, iterative with two rows. Names are short; this is
 *  cheaper than pulling in a dependency and predictable in the browser. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** 0…1, where 1 is identical. */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - editDistance(a, b) / longest;
}

/**
 * Is this close enough to be worth mentioning, without being the same?
 *
 * Two ways in, because typos and additions are different mistakes:
 *
 *  - **A typo**: "Mozarella" vs "Mozzarella" — one edit in ten characters.
 *    The threshold rises with length so that short names are not swept
 *    together: at four characters, 0.84 still demands an exact match, which is
 *    what we want ("Cola" and "Kola" are plausibly two real products).
 *  - **A longer version of the same thing**: "Mozzarella" vs
 *    "Mozzarella Cheese". One key contains the other on a word boundary. This
 *    is the most common real duplicate and edit distance alone misses it.
 */
export function isNearMatch(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;

  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // `long === short` is not tested here: identical keys returned false above,
  // and a duplicate is an exact match, not a near one.
  if (
    short.length >= 4 &&
    (long.startsWith(short + " ") || long.endsWith(" " + short) || long.includes(" " + short + " "))
  ) {
    return true;
  }

  if (short.length < 5) return false;
  return similarity(a, b) >= 0.84;
}
