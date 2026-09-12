/**
 * A menu, pasted.
 *
 * ── Why this exists ──
 *
 * Entering a normal menu through the admin is about ninety form submissions:
 * every product costs a create and then an edit, and there is no grid, no
 * clone and no importer. That is the largest single cost in installing this
 * system for a new restaurant, and it is paid by the person least able to
 * afford it — the owner, in their first week.
 *
 * A menu already exists somewhere. It is in a spreadsheet, or a Word file, or
 * on a printed card. Retyping it into forty-field forms is not data entry, it
 * is transcription, and software should be doing it.
 *
 * ── What this file is, and what it deliberately is not ──
 *
 * It is a parser. Text in, rows and errors out. No database, no `server-only`,
 * no side effects — so it can be reasoned about, and so the preview the owner
 * confirms is produced by exactly the same code that later writes.
 *
 * ⚠️ It does NOT read photographs, and that is a decision rather than a gap.
 *
 * A model reading a menu photograph will, eventually, read $8.50 as $3.50. Not
 * often — which is the problem, because it means nobody checks. A wrong price
 * here is not a wrong sentence in a chat: it is written to the database, shown
 * to customers, charged at the till, and printed on a receipt that is a tax
 * record. Every guard in this project exists to keep invented numbers out of
 * places like this.
 *
 * A model may one day suggest rows into this parser's format for a person to
 * check. It may never be the thing that writes them.
 *
 * ── The format ──
 *
 * Tab-separated, because that is what a spreadsheet puts on the clipboard.
 * Commas and semicolons are accepted too, for a file somebody exported.
 *
 *   Margherita      pizza    8.50   12.50   18.00
 *   Pepperoni       pizza    9.50   13.50   19.00
 *   Garlic knots    side     6.50
 *   Ronny's Cola    drink    3.50
 *   Garlic dip      sauce    1.20
 *
 * One row per product. A pizza takes three prices, smallest first; everything
 * else takes one. A header line is optional and ignored.
 */

export type MenuKind = "pizza" | "side" | "drink" | "sauce";

export interface ParsedRow {
  /** 1-based, so a message can name the line the person is looking at. */
  line: number;
  raw: string;
  name: string;
  kind: MenuKind;
  /** One price, or three for a pizza — smallest first. */
  prices: number[];
}

export interface RowError {
  line: number;
  raw: string;
  message: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: RowError[];
}

/* ------------------------------------------------------------------ */

/**
 * What somebody might actually type in the second column.
 *
 * Generous on purpose: the person pasting has a menu to get in, not a syntax
 * to learn. Anything unrecognised is an error naming the four that work, never
 * a guess — a side filed as a drink is wrong in a way nobody notices until a
 * customer orders garlic knots from the drinks rail.
 */
const KINDS: Record<string, MenuKind> = {
  pizza: "pizza",
  pizzas: "pizza",
  პიცა: "pizza",

  side: "side",
  sides: "side",
  extra: "side",
  extras: "side",
  starter: "side",
  appetiser: "side",
  appetizer: "side",
  გვერდითი: "side",

  drink: "drink",
  drinks: "drink",
  beverage: "drink",
  სასმელი: "drink",

  sauce: "sauce",
  sauces: "sauce",
  dip: "sauce",
  სოუსი: "sauce",
};

/** How many prices each kind needs. Pizzas are sized; nothing else is. */
export const PRICES_FOR: Record<MenuKind, number> = {
  pizza: 3,
  side: 1,
  drink: 1,
  sauce: 1,
};

/**
 * A price as a human writes it, or null.
 *
 * ⚠️ Null is never coerced to zero anywhere downstream. A price that could not
 * be read is a row that does not import, because a product priced at nothing is
 * a product the till gives away — silently, all day, to everybody.
 *
 * Accepts: 8.50 · 8,50 · $8.50 · ₾8.50 · 8.50 GEL · "8.50" · 1 200.00
 */
export function parsePrice(input: string): number | null {
  let s = (input ?? "").trim();
  if (!s) return null;

  // Currency symbols, codes and quotes, anywhere in the field.
  s = s.replace(/["'`]/g, "");
  s = s.replace(/[$€£₾₽]/g, "");
  s = s.replace(/\b(usd|eur|gbp|gel|lari|dollars?|euros?)\b/gi, "");
  s = s.replace(/\s/g, "");
  s = s.trim();
  if (!s) return null;

  /**
   * Comma as a decimal separator, which most of Europe writes and every
   * spreadsheet there exports. Distinguished from a thousands separator by
   * what follows it: two digits at the end is a decimal, anything else is not.
   */
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");

  if (!/^\d+(\.\d+)?$/.test(s)) return null;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;

  // Rounded to money, so 8.505 does not become a price nobody can pay.
  return Math.round(n * 100) / 100;
}

/** Tabs first, then semicolons, then commas — whichever the line actually uses. */
function splitCells(line: string): string[] {
  if (line.includes("\t")) return line.split("\t");
  if (line.includes(";")) return line.split(";");
  return line.split(",");
}

const HEADER_WORDS = /^(name|product|item|dish|სახელი|პროდუქტი)$/i;

/**
 * Parse a pasted menu.
 *
 * Every line produces exactly one row or one error, and both carry the line
 * number and the original text. Nothing is dropped quietly: a person who pasted
 * forty lines and got thirty-eight products needs to be shown the other two,
 * not left to count.
 */
export function parseMenu(text: string): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();

  const lines = (text ?? "").replace(/\r\n?/g, "\n").split("\n");

  lines.forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();

    if (!trimmed) return;
    if (trimmed.startsWith("#")) return;

    const cells = splitCells(raw).map((c) => c.trim());
    const name = cells[0] ?? "";

    // A header row, skipped rather than reported — pasting one is the normal
    // thing to do when you select a range in a spreadsheet.
    if (HEADER_WORDS.test(name)) return;

    if (!name) {
      errors.push({ line, raw: trimmed, message: "No name in the first column." });
      return;
    }

    const kindCell = (cells[1] ?? "").toLowerCase();
    const kind = KINDS[kindCell];
    if (!kind) {
      errors.push({
        line,
        raw: trimmed,
        message: kindCell
          ? `"${cells[1]}" is not a kind. Use pizza, side, drink or sauce.`
          : "No kind in the second column. Use pizza, side, drink or sauce.",
      });
      return;
    }

    const want = PRICES_FOR[kind];
    const priceCells = cells.slice(2).filter((c) => c !== "");

    if (priceCells.length < want) {
      errors.push({
        line,
        raw: trimmed,
        message:
          want === 3
            ? `A pizza needs three prices — small, medium, large. Found ${priceCells.length}.`
            : "No price.",
      });
      return;
    }

    const prices: number[] = [];
    let bad = false;
    for (let k = 0; k < want; k++) {
      const p = parsePrice(priceCells[k]);
      if (p === null) {
        errors.push({
          line,
          raw: trimmed,
          message: `"${priceCells[k]}" is not a price.`,
        });
        bad = true;
        break;
      }
      prices.push(p);
    }
    if (bad) return;

    /**
     * ⚠️ A free product is refused rather than imported.
     *
     * Zero parses perfectly well and is almost never meant. A row that says 0
     * is a column pasted from the wrong place or a price nobody filled in, and
     * importing it puts an item on the menu that the till hands over for
     * nothing. If a restaurant genuinely gives something away, that is a
     * deliberate act and it can be set in the admin.
     */
    if (prices.some((p) => p === 0)) {
      errors.push({
        line,
        raw: trimmed,
        message: "Priced at 0. If that is deliberate, set it in the admin after importing.",
      });
      return;
    }

    // Pizza prices that go downwards are a pasted column in the wrong order,
    // and the customiser would offer a large for less than a small.
    if (kind === "pizza" && !(prices[0] <= prices[1] && prices[1] <= prices[2])) {
      errors.push({
        line,
        raw: trimmed,
        message: `Prices do not go up with size (${prices.join(" · ")}). Smallest first.`,
      });
      return;
    }

    // Two rows with one name inside a single paste — caught here rather than by
    // the database, where the second one would simply overwrite or be skipped
    // depending on which import path ran.
    const key = name.toLowerCase().replace(/\s+/g, " ");
    const first = seen.get(key);
    if (first !== undefined) {
      errors.push({
        line,
        raw: trimmed,
        message: `"${name}" is already on line ${first}.`,
      });
      return;
    }
    seen.set(key, line);

    rows.push({ line, raw: trimmed, name, kind, prices });
  });

  return { rows, errors };
}

/** The example shown above the box, so nobody has to guess the shape. */
export const EXAMPLE = [
  "Margherita\tpizza\t8.50\t12.50\t18.00",
  "Pepperoni\tpizza\t9.50\t13.50\t19.00",
  "Garlic knots\tside\t6.50",
  "Cola\tdrink\t3.50",
  "Garlic dip\tsauce\t1.20",
].join("\n");
