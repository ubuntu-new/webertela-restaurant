import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getPosSession } from "@/lib/pos-auth";
import { hashPin, isValidPin } from "@/lib/pin";
import { recordMovements } from "@/lib/stock";
import { logAction } from "@/lib/audit";
import { check, clientIp, fail, key, succeed, waitMessage, PIN_POLICY } from "@/lib/rate-limit";
import { currentShift } from "@/lib/shift";
import { recordMovement, REFUND_PREFIX } from "@/lib/cash";
import { reversePoints } from "@/lib/loyalty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Voiding a sale from the till.
 *
 * ⚠️ This is the single most important control on any POS. A cashier who can
 * cancel a completed sale unsupervised can take the cash and leave no trace.
 * So a void requires:
 *
 *   • a SECOND person's PIN — someone holding `can_void`
 *   • a written reason
 *   • an audit entry naming both people
 *
 * Stock is returned with counter-entries rather than by deleting the
 * originals: the ledger must stay append-only, or "why is the balance this
 * number" loses its answer.
 */
export async function POST(req: Request) {
  const session = await getPosSession();
  if (!session) return NextResponse.json({ error: "Session expired" }, { status: 401 });

  let body: { orderId?: string; pin?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const reason = (body.reason ?? "").trim();
  if (reason.length < 3) return NextResponse.json({ error: "A reason is required" }, { status: 400 });
  if (!isValidPin(body.pin ?? "")) return NextResponse.json({ error: "Enter the manager PIN" }, { status: 400 });

  // ── how many guesses this till has left ──
  //
  // The higher-value of the two PIN doors: a correct guess here cancels a sale,
  // refunds it, and puts stock back.
  //
  // Keyed on the signed-in cashier and nothing else.
  //
  // Two wrong answers were tried first. The terminal alone let one cashier
  // burning five guesses deny an honest manager the ability to void on that
  // till — a denial of the most time-critical action on the POS. Terminal *and*
  // cashier looked stricter and was looser: it handed the same person a fresh
  // five guesses on each till they signed into. The person is the thing being
  // limited, so the person is the key.
  const ip = await clientIp();
  const bucket = key("void", session.sub);

  const gate = check(bucket);
  if (!gate.ok) {
    return NextResponse.json(
      { error: waitMessage(gate.retryAfter) },
      { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
    );
  }

  // All three refusals count. Two of them are only reachable with a PIN that
  // matched a real employee, so leaving those free would let a cashier confirm
  // a manager's PIN from behind the counter at no cost — and this is the door
  // that person most wants to open.
  const refuse = async (message: string, status: number, why: string) => {
    const v = fail(bucket, PIN_POLICY);
    // Always logged, unlike the other doors: reaching this at all means someone
    // already signed in on a till is trying manager PINs, and the owner wants
    // every one of those. The signed-in session caps the volume.
    await logAction({
      action: "order.void.refused",
      entityType: "Order",
      entityId: body.orderId ?? null,
      branchId: session.branchId,
      after: { why, ip, posId: session.posId, fails: v.fails, locked: !v.ok || undefined },
      employeeId: session.sub,
    });
    return NextResponse.json({ error: message }, { status });
  };

  // ── who authorised it ──
  const approver = await db.employee.findFirst({
    where: { posPinHash: hashPin(body.pin!), active: true, deletedAt: null },
    select: { id: true, name: true, role: true, permissions: true },
  });
  if (!approver) return refuse("PIN not recognised", 401, "pin not recognised");

  const canVoid = approver.role === "super_admin" || approver.permissions.includes("can_void");
  if (!canVoid) return refuse("This person cannot authorise a void", 403, "no permission");

  // The point is a second pair of eyes — approving your own void defeats it
  if (approver.id === session.sub) {
    return refuse("A void must be authorised by someone else", 403, "self-approval");
  }

  /**
   * The counter is cleared only once a void has actually happened.
   *
   * Clearing it the moment the PIN matched looked equivalent and was not: a
   * cashier who knows one manager's PIN could burn four guesses at a second
   * manager's, then submit the known-good PIN with a nonsense order id — which
   * fails at the lookup below and performs no void — and the throttle reset.
   * Four free guesses per two requests, forever, on the one door that moves
   * money. Requiring a completed void makes each reset cost a real, audited,
   * reversible action with two names on it.
   */
  const order = await db.order.findUnique({
    where: { id: body.orderId ?? "" },
    select: {
      id: true, orderNo: true, status: true, branchId: true, total: true,
      statusHistory: true, paymentMethod: true, paymentStatus: true, shiftId: true,
    },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.branchId !== session.branchId) {
    return NextResponse.json({ error: "That order belongs to another branch" }, { status: 403 });
  }
  if (order.status === "cancelled") return NextResponse.json({ error: "Already cancelled" }, { status: 409 });

  // ── return the stock ──
  const moves = await db.stockMovement.findMany({
    where: { refType: "Order", refId: order.id, type: "sale" },
    select: { locationId: true, itemId: true, qty: true },
  });

  if (moves.length > 0) {
    await recordMovements(
      moves.map((m) => ({
        locationId: m.locationId,
        itemId: m.itemId,
        type: "count_adjust" as const,
        qty: Number(m.qty) * -1,
        refType: "Order",
        refId: order.id,
        note: `Order #${order.orderNo} voided — stock returned`,
        employeeId: session.sub,
      })),
    );
  }

  /**
   * The cash leaves *this* drawer, tonight.
   *
   * Not the drawer that sold it. A Tuesday sale voided on Thursday hands
   * Thursday's cash to the customer, and writing it against Tuesday would
   * rewrite a variance that was counted, agreed and audited two days ago while
   * leaving Thursday short with nothing to account for it. Recorded here so the
   * money leaves the drawer it actually left.
   *
   * Best effort, like the reversals around it: a sale is never left half-voided
   * because the ledger had a bad moment.
   */
  // Only a till sale that was actually paid in cash takes money back out of a
  // drawer. A web cash-on-delivery order that was never collected has no cash
  // to refund, and paying it out of this till would be inventing a shortfall.
  if (order.paymentMethod === "cash" && order.paymentStatus === "paid" && order.shiftId) {
    try {
      const shift = await currentShift(session.sub);
      if (shift) {
        await recordMovement(
          shift.id,
          -Number(order.total),
          `${REFUND_PREFIX}#${order.orderNo} — ${reason}`.slice(0, 200),
          session.sub,
          // Allowed even after the drawer has been counted. The guard that
          // normally blocks that exists to stop a cashier making their own
          // shortfall vanish; this is not that. A void already needs a second
          // person's PIN, is refused for self-approval, and is written to the
          // audit trail — so refusing it here would only mean cash left the
          // till with no record, which is the outcome the guard exists to
          // prevent.
          { system: true },
        );
      } else {
        // Nobody is clocked in, so there is no drawer to take it from. Silence
        // here would mean cash leaving a till with no record anywhere, so it is
        // written where an owner will find it instead.
        await logAction({
          action: "cash.refundUnassigned",
          entityType: "Order",
          entityId: order.id,
          branchId: order.branchId,
          after: { amount: Number(order.total), why: "no open shift at the time of the void" },
          employeeId: session.sub,
        });
      }
    } catch (e) {
      console.error("void: could not record the refund against the drawer", e);
    }
  }

  // points go back too — earned and redeemed alike
  try {
    await reversePoints(order.id);
  } catch (e) {
    console.error("void: points reversal failed", e);
  }

  const history = Array.isArray(order.statusHistory) ? (order.statusHistory as unknown[]) : [];

  // A void has now genuinely happened and is about to be recorded: this
  // cashier is who they said they were, so their guess counter goes.
  succeed(bucket);

  await db.order.update({
    where: { id: order.id },
    data: {
      status: "cancelled",
      paymentStatus: "refunded",
      statusHistory: [
        ...history,
        {
          status: "cancelled",
          at: new Date().toISOString(),
          by: session.name,
          approvedBy: approver.name,
          reason,
        },
      ] as object,
    },
  });

  await logAction({
    action: "order.void",
    entityType: "Order",
    entityId: order.id,
    branchId: session.branchId,
    before: { status: order.status, total: Number(order.total) },
    after: { reason, cashier: session.name, approvedBy: approver.name, posId: session.posId },
    employeeId: session.sub,
  });

  return NextResponse.json({ ok: true, approvedBy: approver.name });
}
