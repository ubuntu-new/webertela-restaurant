import type { PrintDoc } from "@/lib/print-doc";
import { padRow, wrap } from "@/lib/print-doc";

/**
 * A PrintDoc as bytes a thermal printer understands.
 *
 * ESC/POS is Epson's command set from the 1990s and it won: Epson, Star in
 * emulation mode, Bixolon, Rongta, and the sixty-dollar clones all speak it. So
 * this targets the standard rather than a model, and a restaurant can buy
 * whatever is in stock locally.
 *
 * ── No dependency ──
 *
 * The published ESC/POS libraries all bundle a transport — USB, serial,
 * Bluetooth — and none of them run where this runs. What is actually needed is
 * a few dozen control sequences and a Buffer, so that is what this is. Nothing
 * here touches the network; it returns bytes and the caller decides where they
 * go.
 *
 * ── Encoding ──
 *
 * Code page 437 for anything Latin. Georgian and other non-Latin text does not
 * survive a single-byte code page, and a printer that has never heard of ქართული
 * prints boxes. Rather than pretend, `transliterate` degrades gracefully and the
 * caller can decide whether a kitchen ticket is better in Latin than in boxes.
 * A real fix is per-printer font support, and that is hardware-specific enough
 * to wait for a real printer to test against.
 */

const ESC = 0x1b;
const GS = 0x1d;

const CMD = {
  init: [ESC, 0x40],
  alignLeft: [ESC, 0x61, 0],
  alignCenter: [ESC, 0x61, 1],
  alignRight: [ESC, 0x61, 2],
  boldOn: [ESC, 0x45, 1],
  boldOff: [ESC, 0x45, 0],
  /** Double width and height. */
  bigOn: [GS, 0x21, 0x11],
  bigOff: [GS, 0x21, 0x00],
  /** Feed and full cut. */
  cut: [GS, 0x56, 0x00],
  /** Codepage 437 — US/Latin. */
  cp437: [ESC, 0x74, 0x00],
  /**
   * Drawer pulse on pin 2, 100ms on / 200ms off.
   *
   * The cash drawer is not a peripheral of the computer — it is wired to the
   * till printer with an RJ11 cable, and this is the only way to open it. That
   * is why "open the drawer" is a print job with nothing to print.
   */
  kick: [ESC, 0x70, 0x00, 0x19, 0x32],
} as const;

/**
 * What a code-page-437 printer can render, for text that is not Latin.
 *
 * Deliberately lossy and deliberately visible. A cook reading "Khachapuri" can
 * work; a cook reading "????????" cannot, and neither can they tell whether the
 * order was wrong or the printer was.
 */
const KA_LATIN: Record<string, string> = {
  ა: "a", ბ: "b", გ: "g", დ: "d", ე: "e", ვ: "v", ზ: "z", თ: "t",
  ი: "i", კ: "k", ლ: "l", მ: "m", ნ: "n", ო: "o", პ: "p", ჟ: "zh",
  რ: "r", ს: "s", ტ: "t", უ: "u", ფ: "p", ქ: "k", ღ: "gh", ყ: "q",
  შ: "sh", ჩ: "ch", ც: "ts", ძ: "dz", წ: "ts", ჭ: "ch", ხ: "kh",
  ჯ: "j", ჰ: "h",
};

export function transliterate(text: string): string {
  return Array.from(text ?? "")
    .map((ch) => {
      if (KA_LATIN[ch]) return KA_LATIN[ch];
      // Anything still outside the printable ASCII range would print as a box
      // or as nothing. A dot at least shows a character was there.
      const code = ch.charCodeAt(0);
      if (code >= 0x20 && code <= 0x7e) return ch;
      if (ch === "…") return "...";
      if (ch === "—" || ch === "–") return "-";
      if (ch === "“" || ch === "”") return '"';
      if (ch === "‘" || ch === "’") return "'";
      if (ch === "₾") return "GEL ";
      if (ch === "\n") return "\n";
      return code > 0x7e ? "." : ch;
    })
    .join("");
}

/* ------------------------------------------------------------------ */

/** Turns one document into the byte stream for one printer. */
export function renderEscPos(doc: PrintDoc, opts?: { kick?: boolean }): Buffer {
  const cols = doc.columns;
  const parts: number[] = [];

  const push = (bytes: readonly number[]) => parts.push(...bytes);
  const text = (value: string) => {
    // latin1 rather than utf8: one byte per character is what the printer
    // expects, and `transliterate` has already removed anything that cannot
    // survive that.
    for (const byte of Buffer.from(transliterate(value), "latin1")) parts.push(byte);
  };
  const newline = () => parts.push(0x0a);

  push(CMD.init);
  push(CMD.cp437);

  for (const line of doc.lines) {
    switch (line.t) {
      case "text": {
        push(
          line.align === "c" ? CMD.alignCenter : line.align === "r" ? CMD.alignRight : CMD.alignLeft
        );
        if (line.bold) push(CMD.boldOn);
        if (line.big) push(CMD.bigOn);
        // Wrapped at the effective width: double-width characters take two
        // cells, so a "big" line fits half as much.
        for (const part of wrap(line.v, line.big ? Math.floor(cols / 2) : cols)) {
          text(part);
          newline();
        }
        if (line.big) push(CMD.bigOff);
        if (line.bold) push(CMD.boldOff);
        push(CMD.alignLeft);
        break;
      }

      case "row": {
        if (line.bold) push(CMD.boldOn);
        if (line.big) push(CMD.bigOn);
        text(padRow(line.left, line.right, line.big ? Math.floor(cols / 2) : cols));
        newline();
        if (line.big) push(CMD.bigOff);
        if (line.bold) push(CMD.boldOff);
        break;
      }

      case "rule":
        text((line.ch ?? "-").repeat(cols));
        newline();
        break;

      case "feed":
        for (let i = 0; i < (line.n ?? 1); i += 1) newline();
        break;

      case "cut":
        // Three blank lines first, or the cutter takes the last line of text
        // with it — the cut bar sits above the print head.
        newline();
        newline();
        newline();
        push(CMD.cut);
        break;

      case "kick":
        // Honoured only where a drawer is actually wired. Sending the pulse to
        // the kitchen printer would do nothing at best; at worst it confuses
        // whoever is holding it.
        if (opts?.kick !== false) push(CMD.kick);
        break;
    }
  }

  return Buffer.from(parts);
}
