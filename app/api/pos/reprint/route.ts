import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPosSession } from "@/lib/pos-auth";
import { logAction } from "@/lib/audit";
import { queueReceipt } from "@/lib/print";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Another copy of a receipt that already exists.
 *
 * The commonest reason is the dullest: the paper ran out, or jammed, or the
 * customer walked off without it and came back. None of those are unusual, and
 * before this the answer was to reprint from the office or not at all.
 *
 * ── What a reprint must not do ──
 *
 * It must not recompute anything. The stored job carries the document as it was
 * printed the first time, and this queues **that document again** rather than
 * building a new one from today's menu. If a price changed this afternoon, the
 * copy still shows what the customer actually paid this morning — which is the
 * entire reason a receipt is worth keeping.
 *
 * When there is no earlier job to copy — an order from before printing existed —
 * one is built from the order's own stored snapshot, which is the next most
 * faithful thing available and is still the prices as they were rung up, since
 * `OrderItem` is itself immutable.
 *
 * ── Marked, not hidden ──
 *
 * `reprintOf` records which job this copies. Two identical receipts in a
 * drawer, one of them a duplicate nobody can identify, is exactly the ambiguity
 * the cash reconciliation work exists to remove.
 */
export async function POST(req: Request) {
  const session = await getPosSession();
  if (!session) return NextResponse.json({ error: "Session expired" }, { status: 401 });

  let body: { orderId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const orderId = String(body.orderId ?? "").trim();
  if (!orderId) return NextResponse.json({ error: "orderId required" }, { status: 400 });

  // Scoped to this branch. A terminal may only reprint what its own branch
  // sold — the order id alone must never be enough to pull a receipt out of
  // another restaurant.
  const order = await db.order.findFirst({
    where: { id: orderId, branchId: session.branchId },
    select: { id: true, orgId: true, branchId: true, orderNo: true },
  });
  if (!order) return NextResponse.json({ error: "That order is not on this till." }, { status: 404 });

  // The last receipt actually printed for this order, if there was one.
  const original = await db.printJob.findFirst({
    where: { orderId: order.id, kind: "receipt" },
    orderBy: { createdAt: "asc" },
    select: { id: true, doc: true },
  });

  if (original) {
    const job = await db.printJob.create({
      data: {
        orgId: order.orgId,
        branchId: order.branchId,
        kind: "receipt",
        orderId: order.id,
        // The same bytes, not a fresh rendering.
        doc: original.doc as object,
        requestedBy: session.sub,
        reprintOf: original.id,
        printerId: (
          await db.printer.findFirst({
            where: { branchId: order.branchId, role: "till", active: true },
            select: { id: true },
          })
        )?.id ?? null,
      },
      select: { id: true },
    });

    await logAction({
      action: "print.reprint",
      entityType: "Order",
      entityId: order.id,
      branchId: order.branchId,
      after: { orderNo: order.orderNo, copyOf: original.id, jobId: job.id },
      employeeId: session.sub,
    });

    return NextResponse.json({ ok: true, jobId: job.id, copied: true });
  }

  // No earlier job: an order from before printing existed. Built from the
  // order's own immutable item snapshot, and never opening the drawer — the
  // money crossed the counter once, and a reprint is not a second sale.
  const res = await queueReceipt(order.id, { requestedBy: session.sub, openDrawer: false });
  if (!res.ok) return NextResponse.json({ error: "Could not queue the receipt." }, { status: 500 });

  await logAction({
    action: "print.reprint",
    entityType: "Order",
    entityId: order.id,
    branchId: order.branchId,
    after: { orderNo: order.orderNo, rebuilt: true, jobId: res.id },
    employeeId: session.sub,
  });

  return NextResponse.json({ ok: true, jobId: res.id, copied: false });
}
