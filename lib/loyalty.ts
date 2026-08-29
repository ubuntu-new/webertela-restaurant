import "server-only";
import { db } from "@/lib/db";
import { fmt } from "@/lib/format";

/**
 * Loyalty points.
 *
 * The `PointsEntry` ledger is the truth; `User.loyaltyPoints` is a cache kept
 * in the same transaction — the same pattern as stock. That way "why does
 * this customer have 340 points" always has an answer.
 *
 * Rules come from the `loyalty` setting, agreed in phase 0:
 *   1 point per GEL · 100 points = 10 ₾ · minimum 100 to redeem
 */

export interface LoyaltySettings {
  enabled: boolean;
  pointsPerGel: number;
  redeemRate: number; // GEL per point
  minRedeem: number;
}

const DEFAULTS: LoyaltySettings = {
  enabled: true,
  pointsPerGel: 1,
  redeemRate: 0.1,
  minRedeem: 100,
};

export async function getLoyaltySettings(): Promise<LoyaltySettings> {
  try {
    const row = await db.setting.findUnique({ where: { key: "loyalty" } });
    const v = (row?.value ?? {}) as Partial<LoyaltySettings>;
    return {
      enabled: v.enabled ?? DEFAULTS.enabled,
      pointsPerGel: Number(v.pointsPerGel ?? DEFAULTS.pointsPerGel),
      redeemRate: Number(v.redeemRate ?? DEFAULTS.redeemRate),
      minRedeem: Number(v.minRedeem ?? DEFAULTS.minRedeem),
    };
  } catch {
    return DEFAULTS;
  }
}

/** What a number of points is worth in GEL, capped at the amount due. */
export function redeemValue(points: number, s: LoyaltySettings, dueAmount: number) {
  const usable = Math.max(0, Math.floor(points));
  if (usable < s.minRedeem) return { points: 0, value: 0 };

  const raw = usable * s.redeemRate;
  const value = Math.min(raw, dueAmount);
  // never spend more points than the bill can absorb
  const spent = value < raw ? Math.ceil(value / s.redeemRate) : usable;

  return { points: spent, value: Math.round(value * 100) / 100 };
}

/**
 * Award points for an order.
 *
 * ⚠️ Two deliberate choices:
 *   • points are earned on the ITEMS subtotal, not the delivery fee — a
 *     customer shouldn't earn loyalty on the courier
 *   • and only on what was actually paid, i.e. after any redemption; without
 *     that, points could be farmed by redeeming and re-earning in a loop
 */
export async function awardPoints(opts: {
  userId: string;
  orderId: string;
  subtotal: number;
  redeemedValue?: number;
}) {
  const s = await getLoyaltySettings();
  if (!s.enabled) return 0;

  const base = Math.max(0, opts.subtotal - (opts.redeemedValue ?? 0));
  const points = Math.floor(base * s.pointsPerGel);
  if (points <= 0) return 0;

  const f = await fmt();

  await db.$transaction([
    db.pointsEntry.create({
      data: {
        userId: opts.userId,
        type: "earn",
        points,
        orderId: opts.orderId,
        reason: `Order · ${f.money(base)}`,
      },
    }),
    db.user.update({
      where: { id: opts.userId },
      data: { loyaltyPoints: { increment: points } },
    }),
  ]);

  return points;
}

/** Spend points. Returns what was actually taken. */
export async function redeemPoints(opts: {
  userId: string;
  orderId: string;
  points: number;
  value: number;
}) {
  if (opts.points <= 0) return 0;

  const f = await fmt();

  await db.$transaction([
    db.pointsEntry.create({
      data: {
        userId: opts.userId,
        type: "redeem",
        points: -opts.points,
        orderId: opts.orderId,
        reason: `Redeemed · ${f.money(opts.value)}`,
      },
    }),
    db.user.update({
      where: { id: opts.userId },
      data: { loyaltyPoints: { decrement: opts.points } },
    }),
  ]);

  return opts.points;
}

/**
 * Undo an order's points — used when an order is voided.
 * Written as counter-entries, never by deleting: the ledger stays append-only.
 */
export async function reversePoints(orderId: string) {
  const entries = await db.pointsEntry.findMany({ where: { orderId } });
  if (entries.length === 0) return;

  for (const e of entries) {
    if (e.type === "adjust") continue; // already a correction
    await db.$transaction([
      db.pointsEntry.create({
        data: {
          userId: e.userId,
          type: "adjust",
          points: -e.points,
          orderId,
          reason: "Order voided",
        },
      }),
      db.user.update({
        where: { id: e.userId },
        data: { loyaltyPoints: { increment: -e.points } },
      }),
    ]);
  }
}

/** Rebuild the cache from the ledger — for verification, not routine use. */
export async function recomputePoints(userId: string) {
  const agg = await db.pointsEntry.aggregate({ where: { userId }, _sum: { points: true } });
  const total = agg._sum.points ?? 0;
  await db.user.update({ where: { id: userId }, data: { loyaltyPoints: total } });
  return total;
}
