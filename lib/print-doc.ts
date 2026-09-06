/**
 * What is on the paper, before anyone decides how to put it there.
 *
 * A print job stores one of these rather than a stream of printer bytes, and
 * the reason is worth stating because it is the decision the rest of the
 * feature hangs off.
 *
 * ── Why not store the bytes ──
 *
 * ESC/POS output is width-specific and printer-specific. Bytes rendered for a
 * 48-column till printer cannot be shown on screen, cannot be re-cut for a
 * 32-column kitchen roll, and cannot be re-rendered when a template is fixed.
 * Storing them would mean the demo needs hardware to show anything at all.
 *
 * ── Why not store the order id and re-read it ──
 *
 * Because a receipt is a record of what happened. Prices change; a reprint of
 * Tuesday's receipt on Thursday must show Tuesday's prices. Re-reading the
 * order at print time would let a reprint quietly rewrite history, which is the
 * one thing a receipt exists to prevent — and it is the same mistake the void
 * logic made before the cash work: recomputing the past instead of recording
 * it.
 *
 * So: a structured, immutable snapshot. Rendered to bytes by the agent, to HTML
 * by the preview, and to nothing at all by neither until the paper exists.
 */

export type PrintLine =
  /** A run of text. `big` doubles both dimensions on ESC/POS. */
  | { t: "text"; v: string; align?: "l" | "c" | "r"; bold?: boolean; big?: boolean }
  /** Label on the left, figure on the right, filled to the column width. */
  | { t: "row"; left: string; right: string; bold?: boolean; big?: boolean }
  /** A horizontal rule made of one repeated character. */
  | { t: "rule"; ch?: string }
  /** Blank lines. */
  | { t: "feed"; n?: number }
  /** Cut the paper. */
  | { t: "cut" }
  /** Fire the drawer solenoid. Only the till printer has one wired. */
  | { t: "kick" };

export interface PrintDoc {
  /** Characters per line this document was laid out for. */
  columns: number;
  /** A human title, for the job list and the preview tab. */
  title: string;
  lines: PrintLine[];
}

/* ------------------------------------------------------------------ */
/* Layout helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Left text and right text on one line, padded apart.
 *
 * When the two cannot fit, the left is truncated rather than the right: the
 * right is the number, and a price with a digit missing is worse than a
 * product name with a letter missing.
 */
export function padRow(left: string, right: string, columns: number): string {
  const r = right.slice(0, columns);
  const room = columns - r.length - 1;
  if (room <= 0) return r.padStart(columns);
  const l = left.length > room ? left.slice(0, room - 1) + "…" : left;
  return l + " ".repeat(columns - l.length - r.length) + r;
}

/** Breaks a long line on spaces so nothing is silently lost off the edge. */
export function wrap(text: string, columns: number): string[] {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];

  const out: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line.length) {
      line = word;
    } else if (line.length + 1 + word.length <= columns) {
      line += " " + word;
    } else {
      out.push(line);
      line = word;
    }
    // A single word longer than the roll — a URL, a German compound — is cut
    // into pieces rather than left to wrap wherever the printer feels like it.
    while (line.length > columns) {
      out.push(line.slice(0, columns));
      line = line.slice(columns);
    }
  }
  if (line.length) out.push(line);
  return out;
}

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */

/**
 * The document as plain text, exactly as wide as the paper.
 *
 * This is what makes the whole feature demonstrable with no hardware at all:
 * the same snapshot the agent will print, laid out at the same column count, in
 * a monospace box on screen. What you see is not an impression of the receipt —
 * it is the receipt, minus the paper.
 */
export function docToText(doc: PrintDoc): string {
  const cols = doc.columns;
  const out: string[] = [];

  for (const line of doc.lines) {
    switch (line.t) {
      case "text": {
        for (const part of wrap(line.v, line.big ? Math.floor(cols / 2) : cols)) {
          const width = line.big ? Math.floor(cols / 2) : cols;
          if (line.align === "c") out.push(part.padStart(Math.floor((width + part.length) / 2)));
          else if (line.align === "r") out.push(part.padStart(width));
          else out.push(part);
        }
        break;
      }
      case "row":
        out.push(padRow(line.left, line.right, line.big ? Math.floor(cols / 2) : cols));
        break;
      case "rule":
        out.push((line.ch ?? "-").repeat(cols));
        break;
      case "feed":
        for (let i = 0; i < (line.n ?? 1); i += 1) out.push("");
        break;
      case "cut":
        out.push("");
        break;
      case "kick":
        // Shown, because a drawer opening is an event somebody may need to
        // account for later. Invisible on paper, visible in the preview.
        out.push("[drawer]");
        break;
    }
  }

  return out.join("\n");
}
