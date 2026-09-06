#!/usr/bin/env node
/**
 * The print agent. Runs in the restaurant; nothing else does.
 *
 *   WEBERTELA_URL=https://demo.webertela.online \
 *   WEBERTELA_AGENT_TOKEN=... \
 *   node print-agent.mjs
 *
 * ── Why this exists ──
 *
 * The server is in a datacentre. The printer is on a shelf behind the till,
 * behind a router with a password nobody remembers, on an address that changes
 * whenever the internet company sends a new box. There is no route from one to
 * the other and there is not going to be.
 *
 * So the direction is inverted. This asks the server for work every couple of
 * seconds and writes the answer to a socket on the local network. The
 * restaurant reaches out; the datacentre never reaches in. No port forwarding,
 * no static IP, no firewall conversation with a pizzeria owner.
 *
 * ── Deliberately stupid ──
 *
 * It has no templates, no fonts and no idea what a receipt is. The server sends
 * bytes; this opens a socket and writes them. That means a layout fix is a
 * deploy, not a visit — and on the day a restaurant's receipt is wrong, the
 * difference between those two is the difference between ten minutes and a
 * drive to Monroe.
 *
 * ── Requirements ──
 *
 * Node 18 or newer, and nothing else. No npm install: `net` and `fetch` are
 * both built in. It will run on a €40 mini PC, a Raspberry Pi, or the till
 * itself.
 */

import net from "node:net";

const BASE = (process.env.WEBERTELA_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.WEBERTELA_AGENT_TOKEN ?? "";

/** How often to ask. Two seconds is well inside "instant" for a kitchen. */
const POLL_MS = Number(process.env.WEBERTELA_POLL_MS ?? 2000);

/** A printer that does not answer this quickly is off, jammed, or unplugged. */
const PRINTER_TIMEOUT_MS = 8000;

if (!BASE || !TOKEN) {
  console.error("Set WEBERTELA_URL and WEBERTELA_AGENT_TOKEN.");
  process.exit(1);
}

const log = (...args) => console.log(new Date().toISOString(), ...args);

/* ------------------------------------------------------------------ */

/**
 * Write one job's bytes to one printer.
 *
 * Resolves on the socket closing cleanly. Rejects on anything else — and the
 * rejection reason travels back to the server, so an owner reading the printers
 * page sees "ECONNREFUSED 192.168.1.50:9100" rather than "failed", which is the
 * difference between fixing it and calling somebody.
 */
function sendToPrinter(host, port, buffer) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      err ? reject(err) : resolve();
    };

    socket.setTimeout(PRINTER_TIMEOUT_MS);
    socket.once("timeout", () => finish(new Error(`timeout after ${PRINTER_TIMEOUT_MS}ms`)));
    socket.once("error", (err) => finish(err));

    socket.connect(port, host, () => {
      // `end` writes the last bytes and closes. The callback fires once the
      // data is flushed to the OS — not once the paper is out, which no
      // thermal printer will tell us anyway.
      socket.end(buffer, () => finish());
    });
  });
}

/* ------------------------------------------------------------------ */

/** Jobs finished since the last poll, sent back with the next request. */
let done = [];
let failed = [];

/** So a printer that has been unplugged for an hour logs once, not 1800 times. */
let lastError = "";

async function tick() {
  let payload;
  try {
    const res = await fetch(`${BASE}/api/print/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent-token": TOKEN },
      body: JSON.stringify({ done, failed }),
    });

    if (res.status === 401) {
      // Fatal and worth stopping for: a wrong token will never become right by
      // being retried, and a process that retries forever on a permanent
      // failure is how a broken install goes unnoticed for a month.
      console.error("Token rejected. Check WEBERTELA_AGENT_TOKEN.");
      process.exit(1);
    }
    if (!res.ok) throw new Error(`server answered ${res.status}`);

    payload = await res.json();

    // Only cleared once the server has actually taken them. If the request
    // failed, the same acknowledgements ride along with the next one.
    done = [];
    failed = [];
    lastError = "";
  } catch (err) {
    const message = String(err?.message ?? err);
    if (message !== lastError) {
      log("server unreachable:", message);
      lastError = message;
    }
    return;
  }

  for (const job of payload.jobs ?? []) {
    const bytes = Buffer.from(job.data, "base64");
    try {
      for (let copy = 0; copy < (job.copies || 1); copy += 1) {
        await sendToPrinter(job.host, job.port, bytes);
      }
      done.push(job.id);
      log(`printed ${job.title} → ${job.host}:${job.port}`);
    } catch (err) {
      const message = `${err?.code ?? "error"} ${job.host}:${job.port} — ${err?.message ?? err}`;
      failed.push({ id: job.id, error: message });
      log(`FAILED ${job.title}: ${message}`);
    }
  }
}

/* ------------------------------------------------------------------ */

log(`print agent up · ${BASE} · polling every ${POLL_MS}ms`);

/**
 * Sequential, not an interval.
 *
 * `setInterval` would start a second poll while the first is still writing to a
 * printer that is not answering, and after a minute of that there are thirty
 * overlapping requests and the same job is being sent repeatedly. One tick at a
 * time, then wait.
 */
async function loop() {
  for (;;) {
    try {
      await tick();
    } catch (err) {
      // Nothing above should throw, but this loop must not be the thing that
      // stops. A crashed agent is a silent kitchen.
      log("unexpected:", err?.message ?? err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

loop();
