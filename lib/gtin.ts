/**
 * Barcodes — the only identifier on a product that a human did not invent.
 *
 * A name is typed, so a name varies. A GTIN is printed on the packaging by the
 * manufacturer and is globally unique, which makes it the strongest evidence
 * this system can hold about what something is. Two stock items with the same
 * GTIN are the same product; there is no judgement call to make.
 *
 * Just as useful, and easier to overlook: **two different GTINs are proof that
 * two things are NOT the same.** "Coca-Cola 330 ml" and "Coca-Cola 1.5 L" have
 * the same name and different barcodes, and a duplicate warning on that pair is
 * noise. Noise is what teaches an owner to click past warnings, so the barcode
 * earns its place twice — once by catching real duplicates, once by silencing
 * false ones.
 *
 * ── The formats, and why they are stored as one ──
 *
 * GS1 defines four lengths, and they are not different systems — they are the
 * same number with different amounts of leading zero:
 *
 *   GTIN-8   EAN-8    small packs (a chocolate bar)
 *   GTIN-12  UPC-A    North America
 *   GTIN-13  EAN-13   the rest of the world
 *   GTIN-14  ITF-14   the outer case, with a packaging-level indicator digit
 *
 * A can of Coke bought in New York carries a 12-digit UPC; the same can in
 * Europe carries the 13-digit EAN, and the EAN is the UPC with a "0" in front.
 * Store them as typed and the same product lands in the database twice — the
 * exact failure this module exists to prevent. So everything is normalised to
 * **14 digits, zero-padded**, which is GS1's own recommendation for storage.
 *
 * ── The check digit ──
 *
 * The last digit is a mod-10 checksum over the others. That means a mistyped
 * barcode can be rejected *at the keyboard*, before it becomes a wrong row that
 * somebody has to find later. Very few identifiers can be validated without
 * asking anyone; this one can, and it would be a waste not to.
 *
 * No `server-only`: the field validates as you type, and the server validates
 * again because a client check is a courtesy, not a guarantee.
 */

export type GtinLength = 8 | 12 | 13 | 14;

export interface GtinResult {
  ok: boolean;
  /** 14-digit canonical form, for storing and comparing. */
  normalized?: string;
  /** How it was entered, so it can be shown back the way it is printed. */
  enteredLength?: GtinLength;
  /** Plain-language reason, ready to show. */
  problem?: string;
}

/** Mod-10: digits weighted 3,1,3,1… from the right, sum, round up to ten. */
function checkDigit(digitsWithoutCheck: string): number {
  let sum = 0;
  // Weights run right-to-left, so the rightmost body digit is always ×3.
  for (let i = digitsWithoutCheck.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += Number(digitsWithoutCheck[i]) * w;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Accept anything a person or a scanner might produce, or explain why not.
 *
 * Scanners often append a carriage return, phones sometimes hand back spaces,
 * and people type hyphens because that is how the number is printed. All of
 * that is stripped before anything is judged — refusing a barcode over a space
 * would be pedantry, not validation.
 */
export function parseGtin(input: string): GtinResult {
  const digits = String(input ?? "").replace(/\D+/g, "");

  if (digits.length === 0) return { ok: false, problem: "Enter or scan a barcode." };

  if (![8, 12, 13, 14].includes(digits.length)) {
    return {
      ok: false,
      problem:
        `A barcode is 8, 12, 13 or 14 digits — this has ${digits.length}. ` +
        `If you are reading it off the packet, include every digit, including the small one at the end.`,
    };
  }

  const body = digits.slice(0, -1);
  const given = Number(digits.slice(-1));
  const expected = checkDigit(body);

  if (given !== expected) {
    return {
      ok: false,
      problem:
        `That barcode does not check out — the last digit should be ${expected}, not ${given}. ` +
        `One of the digits is probably wrong. Scan it again, or read it once more.`,
    };
  }

  return {
    ok: true,
    normalized: digits.padStart(14, "0"),
    enteredLength: digits.length as GtinLength,
  };
}

/** True if this is a usable barcode. For places that only need a yes or no. */
export function isValidGtin(input: string): boolean {
  return parseGtin(input).ok;
}

/**
 * The 14-digit form for storing, or null if it is not a barcode.
 *
 * Null rather than throwing: a blank barcode field is the normal case — most
 * kitchen ingredients arrive in an unlabelled sack — and must never be an error.
 */
export function toStoredGtin(input: string): string | null {
  const r = parseGtin(input);
  return r.ok ? (r.normalized as string) : null;
}

/**
 * Back to the shortest true form, for showing.
 *
 * Storage wants one shape; a person wants the number that is printed on the
 * box. Showing "00012345678905" where the packet says "012345678905" makes
 * people think the software has changed their data.
 */
export function displayGtin(stored: string | null | undefined): string {
  if (!stored) return "";
  const d = String(stored).replace(/\D+/g, "");
  if (d.length !== 14) return d;

  // Strip leading zeros down to the next standard length, never below 8.
  const trimmed = d.replace(/^0+/, "");
  for (const len of [8, 12, 13] as const) {
    if (trimmed.length <= len) return d.slice(14 - len);
  }
  return d;
}

/**
 * What the barcode says about the packaging level.
 *
 * On a GTIN-14 the first digit is the indicator: 0 means this is the item as
 * sold, 1–8 mean it is an outer case containing several of them, 9 means a
 * variable-measure item (something sold by weight, where the price is encoded
 * rather than fixed).
 *
 * This matters for stock. Scanning the case barcode and the unit barcode gives
 * two different, both correct, numbers for the same product — so they are *not*
 * flagged as duplicates of each other, but it is worth telling the user which
 * one they just scanned, because entering a case as if it were a unit is how a
 * count ends up twelve times too small.
 */
export function packagingLevel(stored: string | null | undefined): "unit" | "case" | "variable" | null {
  if (!stored) return null;
  const d = String(stored).replace(/\D+/g, "");
  if (d.length !== 14) return null;

  // Anything shorter than 14 that we zero-padded has indicator 0 by
  // construction, which is correct: those barcodes describe the item as sold.
  const indicator = Number(d[0]);
  if (indicator === 0) return "unit";
  if (indicator === 9) return "variable";
  return "case";
}
