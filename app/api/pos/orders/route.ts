import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPosSession } from "@/lib/pos-auth";
import { getMenu } from "@/lib/menu-db";
import { priceOrder, type CartLineIn } from "@/lib/order-pricing";
import { computeConsumption, locationForBranch } from "@/lib/consumption";
import { recordMovements } from "@/lib/stock";
import { applyOutgoingCost } from "@/lib/costing";
import { logAction } from "@/lib/audit";
import { getLoyaltySettings, redeemValue, awardPoints, redeemPoints } from "@/lib/loyalty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POS order intake.
 *
 * ⚠️ THE IMPORTANT PART IS `clientRef`.
 *
 * The terminal generates a uuid per order and keeps retrying until it gets an
 * answer. A flaky connection means the same order arrives twice; the unique
 * index turns the second one into a no-op that returns the ORIGINAL order.
 *
 * This is what makes offline mode a small addition later rather than a
 * rewrite: the terminal already assumes "send, maybe repeat, trust the
 * server's answer".
 */
export async function POST(req: Request) {
  const session = await getPosSession();
  if (!session) return NextResponse.json({ error: "Session expired — sign in again" }, { status: 401 });

  let body: {
    clientRef?: string;
    lines?: CartLineIn[];
    fulfillment?: "delivery" | "pickup";
    userId?: string;
    redeemPoints?: number;
    customerName?: string;
    customerPhone?: string;
    address?: string;
    notes?: string;
    localNo?: string;
    /** Set by the till when it is sending a sale another shift rang up. */
    adoptedFrom?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const clientRef = String(body.clientRef ?? "").trim();
  if (!clientRef) return NextResponse.json({ error: "clientRef required" }, { status: 400 });

  // ── already received? return the same answer, don't create a second order ──
  const existing = await db.order.findUnique({
    where: { clientRef },
    select: { id: true, orderNo: true, total: true },
  });
  if (existing) {
    return NextResponse.json({
      ok: true,
      duplicate: true,
      orderNo: existing.orderNo,
      total: Number(existing.total),
      id: existing.id,
    });
  }

  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length === 0) return NextResponse.json({ error: "Empty order" }, { status: 400 });

  const fulfillment = body.fulfillment === "delivery" ? "delivery" : "pickup";

  const menu = await getMenu();
  const priced = priceOrder(menu, lines, fulfillment);

  if (priced.errors.length > 0) {
    console.error("pos: pricing failed", priced.errors);
    return NextResponse.json({ error: "Some items are no longer on the menu" }, { status: 409 });
  }

  // ── ქულების გამოყენება ──
  // მხოლოდ ცნობილ კლიენტს და მხოლოდ იმდენით, რამდენიც ანგარიშზე აქვს.
  let redeem = { points: 0, value: 0 };
  if (body.userId && Number(body.redeemPoints) > 0) {
    const [user, ls] = await Promise.all([
      db.user.findUnique({ where: { id: body.userId }, select: { loyaltyPoints: true } }),
      getLoyaltySettings(),
    ]);
    if (user && ls.enabled) {
      const asked = Math.min(Number(body.redeemPoints), user.loyaltyPoints);
      redeem = redeemValue(asked, ls, priced.subtotal);
    }
  }

  const finalTotal = Math.round((priced.total - redeem.value) * 100) / 100;

  const org = await db.organization.findFirst();
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 500 });

  const notes = [body.notes?.trim(), body.localNo ? `POS ${body.localNo}` : null]
    .filter(Boolean)
    .join(" · ");

  try {
    const order = await db.order.create({
      data: {
        source: "pos",
        clientRef,
        posId: session.posId,
        createdByEmployee: session.sub,
        orgId: org.id,
        branchId: session.branchId,
        fulfillmentType: fulfillment,
        address: fulfillment === "delivery" && body.address ? { text: body.address.trim() } : undefined,
        userId: body.userId || null,
        customerName: body.customerName?.trim() || null,
        customerPhone: body.customerPhone?.trim() || null,
        notes: notes || null,
        subtotal: priced.subtotal,
        deliveryFee: priced.deliveryFee,
        total: finalTotal,
        pointsRedeemed: redeem.points,
        pointsValue: redeem.value,
        discountTotal: redeem.value,
        discountBreakdown: redeem.points > 0 ? [{ type: "points", amount: redeem.value }] : [],
        // a till sale is already paid for and already confirmed
        status: "confirmed",
        statusHistory: [
          { status: "new", at: new Date().toISOString(), by: session.name },
          { status: "confirmed", at: new Date().toISOString(), by: session.name },
        ],
        paymentMethod: "cash",
        paymentStatus: "paid",
        items: {
          create: priced.items.map((i) => ({
            kind: i.kind,
            productId: i.refId,
            name: { en: i.name, ka: i.name },
            config: i.config as object,
            qty: i.qty,
            unitPrice: i.unitPrice,
            lineTotal: i.lineTotal,
          })),
        },
      },
      select: { id: true, orderNo: true, total: true },
    });

    // ── loyalty ──
    // Never blocks the sale: a lost point is cheaper than a lost order.
    if (body.userId) {
      try {
        if (redeem.points > 0) {
          await redeemPoints({ userId: body.userId, orderId: order.id, points: redeem.points, value: redeem.value });
        }
        const earned = await awardPoints({
          userId: body.userId,
          orderId: order.id,
          subtotal: priced.subtotal,
          redeemedValue: redeem.value,
        });
        if (earned > 0) {
          await db.order.update({ where: { id: order.id }, data: { pointsEarned: earned } });
        }
      } catch (e) {
        console.error("pos: loyalty failed (order kept)", e);
      }
    }

    // ── stock, same as every other channel ──
    try {
      const loc = await locationForBranch(session.branchId);
      if (loc) {
        const used = await computeConsumption(priced.items);
        if (used.length > 0) {
          const created = await recordMovements(
            used.map((u) => ({
              locationId: loc.id,
              itemId: u.itemId,
              type: "sale" as const,
              qty: -u.qty,
              refType: "Order",
              refId: order.id,
              note: `Order #${order.orderNo} (POS ${session.posId})`,
              employeeId: session.sub,
            })),
          );
          for (const [i, m] of created.entries()) {
            await applyOutgoingCost(loc.id, used[i].itemId, used[i].qty, m.id);
          }
        }
      }
    } catch (e) {
      console.error("pos: stock deduction failed (order kept)", e);
    }

    // მუდმივი კლიენტის სტატისტიკა — ამის გარეშე „ვინ არის ჩვენი
    // მუდმივი კლიენტი" კითხვას პასუხი არ აქვს
    if (body.userId) {
      try {
        await db.user.update({
          where: { id: body.userId },
          data: {
            orderCount: { increment: 1 },
            totalSpent: { increment: priced.total },
            lastOrderAt: new Date(),
          },
        });
      } catch (e) {
        console.error("pos: customer stats update failed (order kept)", e);
      }
    }

    await logAction({
      action: "order.pos",
      entityType: "Order",
      entityId: order.id,
      branchId: session.branchId,
      after: {
        orderNo: order.orderNo,
        total: priced.total,
        posId: session.posId,
        /**
         * Set when the till sent a sale that a *different* shift rang up.
         *
         * The queue is local and survives a handover, so an order taken by one
         * cashier during an outage can be sent by the next one who signs in.
         * The terminal makes that a deliberate act rather than a silent one,
         * but without this line the record would still read as if the sender
         * took the money — and "who sold this" is the question the audit log
         * exists to answer. Untrusted client input, so it is stored as a marker
         * to investigate, never as an identity.
         */
        adoptedFrom: typeof body.adoptedFrom === "string" ? body.adoptedFrom.slice(0, 64) : undefined,
      },
      employeeId: session.sub,
    });

    return NextResponse.json({
      ok: true,
      orderNo: order.orderNo,
      total: Number(order.total),
      id: order.id,
    });
  } catch (e) {
    // unique violation = the retry beat us to it; return the winner
    const again = await db.order.findUnique({
      where: { clientRef },
      select: { id: true, orderNo: true, total: true },
    });
    if (again) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        orderNo: again.orderNo,
        total: Number(again.total),
        id: again.id,
      });
    }
    console.error("pos: create failed", e);
    return NextResponse.json({ error: "Could not save the order" }, { status: 500 });
  }
}
