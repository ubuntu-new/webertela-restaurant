#!/usr/bin/env node
/**
 * A thermal printer that costs nothing and prints to your terminal.
 *
 *   node fake-printer.mjs            # listens on 9100
 *   node fake-printer.mjs 9101       # or wherever
 *
 * ── Why ──
 *
 * Everything between the till and the paper can be wrong in ways that only
 * show up on the paper: a receipt that wraps, a drawer pulse sent to the
 * kitchen, a job claimed and never acknowledged. Waiting for hardware to find
 * those out means finding them out in a restaurant, during service.
 *
 * This listens on the port a real printer listens on and speaks nothing back,
 * which is exactly what a real one does. Point a branch's printer at
 * 127.0.0.1, run the agent, and the whole chain is under test — server, queue,
 * agent, socket, bytes — with the last inch swapped for a screen.
 *
 * It also decodes the ESC/POS control codes rather than dumping hex, because
 * the question being asked is usually "did the cut come after the total" and
 * not "what is byte 412".
 */

const port = Number(process.argv[2] ?? 9100);

const net = await import("node:net");

/** The sequences this project actually emits. Anything else is shown raw. */
const CONTROL = [
  { bytes: [0x1b, 0x40], name: "INIT" },
  { bytes: [0x1b, 0x74, 0x00], name: "CP437" },
  { bytes: [0x1b, 0x61, 0x00], name: "«left" },
  { bytes: [0x1b, 0x61, 0x01], name: "«center" },
  { bytes: [0x1b, 0x61, 0x02], name: "«right" },
  { bytes: [0x1b, 0x45, 0x01], name: "«bold" },
  { bytes: [0x1b, 0x45, 0x00], name: "bold»" },
  { bytes: [0x1d, 0x21, 0x11], name: "«BIG" },
  { bytes: [0x1d, 0x21, 0x00], name: "BIG»" },
  { bytes: [0x1d, 0x56, 0x00], name: "✂ CUT" },
  { bytes: [0x1b, 0x70, 0x00, 0x19, 0x32], name: "💰 DRAWER KICK" },
];

function decode(buffer) {
  const out = [];
  let text = "";

  const flush = () => {
    if (text.length) out.push(text);
    text = "";
  };

  let i = 0;
  outer: while (i < buffer.length) {
    for (const cmd of CONTROL) {
      if (
        i + cmd.bytes.length <= buffer.length &&
        cmd.bytes.every((b, n) => buffer[i + n] === b)
      ) {
        // Alignment and emphasis are noise when reading a receipt; the cut and
        // the drawer are events worth a line of their own.
        if (cmd.name.startsWith("✂") || cmd.name.startsWith("💰")) {
          flush();
          out.push(`   ── ${cmd.name} ──`);
        }
        i += cmd.bytes.length;
        continue outer;
      }
    }

    const byte = buffer[i];
    if (byte === 0x0a) {
      flush();
      i += 1;
      continue;
    }
    text += String.fromCharCode(byte);
    i += 1;
  }

  flush();
  return out;
}

const server = net.createServer((socket) => {
  const chunks = [];
  socket.on("data", (chunk) => chunks.push(chunk));
  socket.on("end", () => {
    const buffer = Buffer.concat(chunks);
    const stamp = new Date().toLocaleTimeString();

    console.log(`\n┌─ ${stamp} · ${buffer.length} bytes ${"─".repeat(28)}`);
    for (const line of decode(buffer)) console.log(`│ ${line}`);
    console.log(`└${"─".repeat(52)}\n`);
  });
  // A real printer says nothing back either.
  socket.on("error", () => {});
});

server.listen(port, "0.0.0.0", () => {
  console.log(`fake printer listening on :${port} — point a branch printer here`);
});
