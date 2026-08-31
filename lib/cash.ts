import "server-only";
import { db } from "@/lib/db";
import { logAction } from "@/lib/audit";

/**
 * What should be in the drawer, and what actually is.
 *
 * Until now the till computed the change a customer was owed, showed it, and
 * threw both numbers away — so the one question an owner most wants answered
 * about cash, *"how much should be here?"*, had no answer anywhere in the
 * product. Theft and honest mistakes looked identical, which is to say
 * invisible.
 *
 * ── The arithmetic ──
 *
 *   expected = counted at open  +  cash taken  ±  the movement ledger
 *   variance = counted at close −  expected
 *
 * A refund is a movement, not a separate term — see `cashSummary`. Subtracting
 * cancelled orders instead would rewrite the variance of a shift that was
 * counted and audited days ago, and leave today's drawer short with nothing to
 * explain it.
 *
 * Four rules hold this together, and each one exists because breaking it
 * accuses the wrong person.
 *
 * **Only counted money is counted.** A branch may configure the float it
 * usually starts with, and that number is a suggestion for a form field and
 * nothing else. A drawer set up as 200 that actually held 180 would otherwise
 * report a 20 shortfall tonight for yesterday's mistake.
 *
 * **Null is not zero.** A shift nobody counted has no variance — not a variance
 * of zero. Printing zero would claim the drawer was checked and balanced when
 * nobody looked in it.
 *
 * **Cash out is recordable.** A manager pays the vegetable supplier forty from
 * the till. Without somewhere to put that, the drawer is forty short at
 * midnight with a cashier's name against it. That is not a missing feature, it
 * is a false accusation.
 *
 * **Only cash.** Card sales never touch the drawer, so including them would
 * make every till look enormously short every single night, and the number
 * would be ignored within a week.
 */

export interface CashSummary {
  /** Counted at the start, or null if nobody did. */
  opening: number | null;
  /** What the branch suggests starting with — never used in the arithmetic. */
  suggested: number | null;
  /** Cash actually taken in, from orders paid in cash. */
  sales: number;
  /** Cash handed back on voids, as a positive figure. Part of `movements`. */
  refunds: number;
  /** Everything in or out that was not a sale, signed and including refunds. */
  movements: number;
  /** Counted at the end, or null if nobody did. */
  closing: number | null;
  /** Null until the drawer was counted at the start — see "Null is not zero". */
  expected: number | null;
  /** Null until it was counted at both ends. */
  variance: number | null;
  /** How many sales were cash, so a nil figure can be read correctly. */
  cashOrders: number;
}

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * How a refund is written into the ledger, so it can be told apart from a
 * supplier payout when the screen breaks the figures down.
 */
export const REFUND_PREFIX = "Refund: ";

/**
 * Everything the drawer did during one shift.
 *
 * Summed in the database rather than pulled into Node — a busy Friday is
 * hundreds of orders and this is read on a screen a cashier is waiting on.
 */
export async function cashSummary(shiftId: string): Promise<CashSummary | null> {
  const shift = await db.shift.findUnique({
    where: { id: shiftId },
    select: {
      openingCash: true,
      closingCash: true,
      branch: { select: { openingFloat: true } },
    },
  });
  if (!shift) return null;

  const [sold, refunded, moved] = await Promise.all([
    /**
     * Cancelled orders are **not** excluded, and that is the point.
     *
     * Leaving `status: { not: "cancelled" }` here alongside the refund movement
     * subtracted the same money twice: ring a 50, void it a minute later, and
     * `sales` fell by 50 *and* the ledger held −50, so the drawer read 50 over
     * every time — on the commonest void there is. Across shifts it was worse:
     * dropping the sale still rewrote the selling shift's counted, audited
     * variance, which is the exact thing moving refunds to the ledger was meant
     * to stop.
     *
     * The cash came in when the sale was rung up. It went out when somebody
     * refunded it. Those are two events, on two possibly-different evenings,
     * and each belongs to the drawer it happened at.
     */
    db.order.aggregate({
      where: { shiftId, paymentMethod: "cash" },
      _sum: { total: true },
      _count: { _all: true },
    }),
    /**
     * Refunds are read from the movement ledger, not from cancelled orders.
     *
     * Subtracting `status: "cancelled"` orders looked obvious and was wrong in
     * both directions. A Tuesday sale voided on Thursday would silently rewrite
     * Tuesday's already-counted, already-audited variance — history is not
     * supposed to move — while Thursday's drawer, the one the cash actually
     * came out of, showed a shortfall with nothing to explain it.
     *
     * So a void writes a movement against the shift doing the refunding, and
     * this only ever reads the ledger. Money leaves the drawer it left.
     */
    db.cashMovement.aggregate({
      where: { shiftId, amount: { lt: 0 }, reason: { startsWith: REFUND_PREFIX } },
      _sum: { amount: true },
    }),
    db.cashMovement.aggregate({ where: { shiftId }, _sum: { amount: true } }),
  ]);

  const opening = shift.openingCash === null ? null : Number(shift.openingCash);
  const closing = shift.closingCash === null ? null : Number(shift.closingCash);
  const sales = money(Number(sold._sum.total ?? 0));
  // Stored negative in the ledger; shown as a positive amount that came out.
  const refunds = money(Math.abs(Number(refunded._sum.amount ?? 0)));
  // `moved` is every movement including the refunds, so they are already in
  // here. Subtracting `refunds` separately would take the same money twice.
  const movements = money(Number(moved._sum.amount ?? 0));

  // Both ends, or no answer. Guessing either would produce a confident number
  // about a drawer nobody looked in.
  // No `- refunds`: a refund is a movement and is already inside `movements`.
  // It is reported separately only so the screen can name it.
  const expected = opening === null ? null : money(opening + sales + movements);
  const variance = expected === null || closing === null ? null : money(closing - expected);

  return {
    opening,
    suggested: shift.branch?.openingFloat == null ? null : Number(shift.branch.openingFloat),
    sales,
    refunds,
    movements,
    closing,
    expected,
    variance,
    cashOrders: sold._count._all,
  };
}

/** Record what was counted at the start of a shift. */
export async function countOpening(
  shiftId: string,
  amount: number,
  by: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "That is not an amount." };
  if (amount > 100_000) return { ok: false, error: "That is more than a till holds — check the figure." };

  const s = await db.shift.findUnique({
    where: { id: shiftId },
    select: { openingCash: true, closingCash: true, branchId: true },
  });
  if (!s) return { ok: false, error: "That shift no longer exists." };

  /**
   * Counted once, and counted *first*.
   *
   * "Once" alone was not enough, and the hole was wide. Ring the whole shift,
   * physically count the drawer, read the sales figure off the screen, and then
   * enter `opening = counted − sales − movements`. The variance is zero for
   * ever, and the rule was never broken because the opening was still only
   * written a single time.
   *
   * So it must also be the first thing that happens: no sale on this shift, and
   * no closing count. After either, the number is no longer a count of what was
   * in the drawer — it is whatever makes tonight work out.
   */
  if (s.openingCash !== null) return { ok: false, error: "The opening float has already been counted." };
  if (s.closingCash !== null) return { ok: false, error: "This drawer has already been counted for the night." };

  const sold = await db.order.count({ where: { shiftId, paymentMethod: "cash" } });
  if (sold > 0) {
    return {
      ok: false,
      error: "Sales have already been taken on this shift, so a starting figure can no longer be counted. Ask a manager.",
    };
  }

  await db.shift.update({ where: { id: shiftId }, data: { openingCash: amount } });
  await logAction({
    action: "cash.opened",
    entityType: "Shift",
    entityId: shiftId,
    branchId: s.branchId,
    after: { amount },
    employeeId: by,
  });
  return { ok: true };
}

/**
 * Record what was counted at the end, and what the variance turned out to be.
 *
 * The variance is written into the audit trail rather than only shown, because
 * a difference that exists solely on a screen somebody closed is a difference
 * nobody can look into next week.
 */
export async function countClosing(
  shiftId: string,
  amount: number,
  by: string,
  note?: string,
): Promise<{ ok: true; variance: number | null } | { ok: false; error: string }> {
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "That is not an amount." };
  if (amount > 100_000) return { ok: false, error: "That is more than a till holds — check the figure." };

  const s = await db.shift.findUnique({ where: { id: shiftId }, select: { closingCash: true, branchId: true } });
  if (!s) return { ok: false, error: "That shift no longer exists." };
  if (s.closingCash !== null) return { ok: false, error: "This drawer has already been counted." };

  await db.shift.update({
    where: { id: shiftId },
    data: { closingCash: amount, cashNote: note?.trim() || null },
  });

  const summary = await cashSummary(shiftId);
  await logAction({
    action: "cash.closed",
    entityType: "Shift",
    entityId: shiftId,
    branchId: s.branchId,
    after: {
      counted: amount,
      expected: summary?.expected ?? null,
      variance: summary?.variance ?? null,
      note: note?.trim() || undefined,
    },
    employeeId: by,
  });

  return { ok: true, variance: summary?.variance ?? null };
}

/** Money in or out of the drawer that was not a sale. Negative leaves. */
export async function recordMovement(
  shiftId: string,
  amount: number,
  reason: string,
  by: string,
  /**
   * A movement the software is making, not a person.
   *
   * Only the void path sets this, and only to get past the "drawer already
   * counted" wall. That wall stops a cashier erasing their own shortfall; a
   * refund is the opposite situation — the cash has genuinely left the till,
   * a second person authorised it with their PIN, self-approval is refused,
   * and the whole thing is in the audit log. Blocking it would mean money out
   * of the drawer with nothing recorded, which is the very thing being guarded
   * against.
   */
  opts: { system?: boolean } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isFinite(amount) || amount === 0) return { ok: false, error: "How much?" };
  if (Math.abs(amount) > 100_000) return { ok: false, error: "That is more than a till holds." };

  // A reason is required and not a dropdown. "Paid Giorgi for the tomatoes" is
  // worth ten times "Other" to whoever reads this in a month, and the moment
  // this becomes a list of categories, "Other" is what everybody picks.
  const why = reason.trim();
  if (why.length < 3) return { ok: false, error: "Say what it was for." };

  const s = await db.shift.findUnique({
    where: { id: shiftId },
    select: { status: true, closingCash: true, branchId: true },
  });
  if (!s) return { ok: false, error: "That shift no longer exists." };
  if (s.status === "closed") return { ok: false, error: "That shift is closed." };

  /**
   * The drawer being counted is the wall, not the shift ending.
   *
   * Guarding on shift status alone left the whole attack open: counting the
   * drawer does not close the shift, so a cashier could count, read the −40 on
   * screen, then add a −40 "paid the supplier" and watch the variance become
   * zero on their own till and on the owner's report. Only the audit row kept
   * the truth, and nothing showed it.
   *
   * Once the count is in, the evening's figures are settled. Anything genuinely
   * missed is a correction a manager makes, in daylight, with their name on it.
   */
  if (s.closingCash !== null && !opts.system) {
    return {
      ok: false,
      error: "The drawer has been counted, so the figures for this shift are settled.",
    };
  }

  await db.cashMovement.create({
    data: { shiftId, amount, reason: why.slice(0, 200), employeeId: by },
  });

  await logAction({
    action: amount < 0 ? "cash.paidOut" : "cash.paidIn",
    entityType: "Shift",
    entityId: shiftId,
    branchId: s.branchId,
    after: { amount, reason: why.slice(0, 200) },
    employeeId: by,
  });

  return { ok: true };
}

/**
 * The same figures for many shifts at once.
 *
 * The shifts page called `cashSummary` in a loop — twenty shifts, four queries
 * each, eighty round trips on a page that renders on every request. The comment
 * defending it was right that the arithmetic must exist in exactly one place;
 * the answer to that is a batched version *here*, not a clever join written a
 * second time in a page.
 *
 * Four queries total, whatever the number of shifts.
 */
export async function cashSummaries(shiftIds: string[]): Promise<Map<string, CashSummary>> {
  const out = new Map<string, CashSummary>();
  if (shiftIds.length === 0) return out;

  const [shifts, sold, refunded, moved] = await Promise.all([
    db.shift.findMany({
      where: { id: { in: shiftIds } },
      select: { id: true, openingCash: true, closingCash: true, branch: { select: { openingFloat: true } } },
    }),
    db.order.groupBy({
      by: ["shiftId"],
      // No `status` filter — see the note in `cashSummary`. A void is a
      // movement out of the drawer that refunded it, never a sale un-happening.
      where: { shiftId: { in: shiftIds }, paymentMethod: "cash" },
      _sum: { total: true },
      _count: { _all: true },
    }),
    db.cashMovement.groupBy({
      by: ["shiftId"],
      where: { shiftId: { in: shiftIds }, amount: { lt: 0 }, reason: { startsWith: REFUND_PREFIX } },
      _sum: { amount: true },
    }),
    db.cashMovement.groupBy({
      by: ["shiftId"],
      where: { shiftId: { in: shiftIds } },
      _sum: { amount: true },
    }),
  ]);

  const soldBy = new Map(sold.map((r) => [r.shiftId, r]));
  const refundBy = new Map(refunded.map((r) => [r.shiftId, Number(r._sum.amount ?? 0)]));
  const moveBy = new Map(moved.map((r) => [r.shiftId, Number(r._sum.amount ?? 0)]));

  for (const sh of shifts) {
    const opening = sh.openingCash === null ? null : Number(sh.openingCash);
    const closing = sh.closingCash === null ? null : Number(sh.closingCash);
    const sales = money(Number(soldBy.get(sh.id)?._sum.total ?? 0));
    const movements = money(moveBy.get(sh.id) ?? 0);
    // The one arithmetic, kept identical to `cashSummary` on purpose — if these
    // two ever drift, the till and the owner's report disagree about the same
    // evening and neither can be trusted.
    const expected = opening === null ? null : money(opening + sales + movements);

    out.set(sh.id, {
      opening,
      suggested: sh.branch?.openingFloat == null ? null : Number(sh.branch.openingFloat),
      sales,
      refunds: money(Math.abs(refundBy.get(sh.id) ?? 0)),
      movements,
      closing,
      expected,
      variance: expected === null || closing === null ? null : money(closing - expected),
      cashOrders: soldBy.get(sh.id)?._count._all ?? 0,
    });
  }

  return out;
}
