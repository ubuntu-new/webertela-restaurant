import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { renderEscPos } from "@/lib/escpos";
import type { PrintDoc } from "@/lib/print-doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The one door the print agent knocks on.
 *
 * The agent runs on a machine inside the restaurant and calls this every few
 * seconds: here is what I finished, give me what is next. The connection is
 * always outbound from the restaurant, which is what makes the whole thing work
 * without anybody forwarding a port on a router they may not have the password
 * to.
 *
 * One endpoint rather than two — poll and acknowledge in the same request —
 * because the agent's loop is then a single call with no state to lose between
 * halves, and a dropped connection re-sends both.
 *
 * ── Bytes, not documents ──
 *
 * The response carries ESC/POS already rendered, base64'd. The agent stays a
 * dumb pipe: open a socket, write bytes, close. It has no templates, no fonts
 * and no opinions, so fixing a receipt layout never means visiting a
 * restaurant to update software on a box behind the till.
 */

/** A claimed job whose agent never came back is stuck; this is how long. */
const CLAIM_EXPIRY_MS = 2 * 60 * 1000;

const MAX_BATCH = 10;

export async function POST(req: Request) {
  const token = req.headers.get("x-agent-token")?.trim();
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // The token names the branch. The agent never gets to say which queue it
  // wants — it presents a secret and the server decides what that secret is
  // for, which is the difference between authentication and a request.
  const branch = await db.branch.findUnique({
    where: { agentToken: token },
    select: { id: true, code: true, deletedAt: true, active: true },
  });
  if (!branch || branch.deletedAt || !branch.active) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { done?: string[]; failed?: { id: string; error?: string }[] };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  /* ── what the agent finished ────────────────────────────────────────── */

  const done = Array.isArray(body.done) ? body.done.filter((s) => typeof s === "string") : [];
  if (done.length) {
    await db.printJob.updateMany({
      // Scoped to this branch: a token from one restaurant must not be able to
      // mark another restaurant's job as printed.
      where: { id: { in: done }, branchId: branch.id },
      data: { status: "done", doneAt: new Date(), error: null },
    });
  }

  const failed = Array.isArray(body.failed) ? body.failed : [];
  for (const item of failed) {
    if (!item?.id || typeof item.id !== "string") continue;
    await db.printJob.updateMany({
      where: { id: item.id, branchId: branch.id },
      data: {
        status: "failed",
        // Truncated: this text is written by software on somebody else's
        // machine and lands in a page an owner reads.
        error: String(item.error ?? "print failed").slice(0, 300),
      },
    });
  }

  /* ── jobs nobody came back for ──────────────────────────────────────── */

  /**
   * An agent that claimed work and then lost power leaves those jobs claimed
   * for ever, and the paper never comes out. Nothing would report this — the
   * queue would look busy and the kitchen would look ignored.
   *
   * So a claim expires. Returning them to `pending` risks printing twice if the
   * old agent was merely slow, and that is the right side to err on: a
   * duplicate ticket is thrown away in a second, a missing one loses an order.
   */
  await db.printJob.updateMany({
    where: {
      branchId: branch.id,
      status: "claimed",
      claimedAt: { lt: new Date(Date.now() - CLAIM_EXPIRY_MS) },
    },
    data: { status: "pending", claimedAt: null },
  });

  /* ── what is next ───────────────────────────────────────────────────── */

  const pending = await db.printJob.findMany({
    where: {
      branchId: branch.id,
      status: "pending",
      // A job with no printer has nowhere to go yet. It stays queued and
      // visible rather than being handed to an agent that cannot place it.
      printerId: { not: null },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_BATCH,
    include: { printer: true },
  });

  if (pending.length) {
    await db.printJob.updateMany({
      where: { id: { in: pending.map((j) => j.id) } },
      data: { status: "claimed", claimedAt: new Date(), attempts: { increment: 1 } },
    });
  }

  const jobs = pending
    .filter((job) => job.printer?.host)
    .map((job) => {
      const doc = job.doc as unknown as PrintDoc;
      // The drawer pulse is dropped for a printer with nothing wired to it.
      // Sending it anyway is harmless on most hardware and confusing on the
      // rest, and "harmless on most" is not a standard worth keeping.
      const bytes = renderEscPos(doc, { kick: job.printer!.hasDrawer });
      return {
        id: job.id,
        host: job.printer!.host,
        port: job.printer!.port,
        copies: job.copies,
        title: doc?.title ?? job.kind,
        data: bytes.toString("base64"),
      };
    });

  /**
   * A job whose printer has no address yet is put straight back.
   *
   * It was claimed a moment ago by the query above, and leaving it claimed
   * would take it out of the queue for two minutes for no reason at all.
   */
  const undeliverable = pending.filter((job) => !job.printer?.host).map((j) => j.id);
  if (undeliverable.length) {
    await db.printJob.updateMany({
      where: { id: { in: undeliverable } },
      data: { status: "pending", claimedAt: null, attempts: { decrement: 1 } },
    });
  }

  return NextResponse.json({ branch: branch.code, jobs });
}
