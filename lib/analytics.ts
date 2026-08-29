import "server-only";
import { db } from "@/lib/db";

/**
 * ბიზნესის ანალიტიკა.
 *
 * ⚠️ პატიოსნების წესი: დაფა მხოლოდ იმას აჩვენებს, რაც მართლა იცის.
 * სუფთა მოგება მხოლოდ მაშინ ჩნდება, როცა ფიქსირებული ხარჯები შეყვანილია —
 * თორემ „მოგება" ქირისა და ხელფასის გარეშე ტყუილი რიცხვია.
 */

export interface Period {
  from: Date;
  to: Date;
  days: number;
  label: string;
}

export function periodOf(days: number): Period {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400_000);
  return {
    from,
    to,
    days,
    // English is the source language; the dictionary translates it.
    label: days === 1 ? "24 hours" : `${days} days`,
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

// ─────────────────────────────────────────────
// ძირითადი მაჩვენებლები
// ─────────────────────────────────────────────

export async function coreMetrics(p: Period) {
  const [orders, prev] = await Promise.all([
    db.order.findMany({
      where: { createdAt: { gte: p.from, lte: p.to }, status: { not: "cancelled" } },
      select: { total: true, subtotal: true, deliveryFee: true, createdAt: true, branchId: true, fulfillmentType: true },
    }),
    db.order.findMany({
      where: {
        createdAt: { gte: new Date(p.from.getTime() - p.days * 86400_000), lt: p.from },
        status: { not: "cancelled" },
      },
      select: { total: true },
    }),
  ]);

  const revenue = r2(orders.reduce((s, o) => s + Number(o.total), 0));
  const prevRevenue = r2(prev.reduce((s, o) => s + Number(o.total), 0));
  const count = orders.length;
  const avgCheck = count > 0 ? r2(revenue / count) : 0;

  const growth = prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 1000) / 10 : null;

  const delivery = orders.filter((o) => o.fulfillmentType === "delivery").length;

  return {
    revenue,
    prevRevenue,
    growth,
    count,
    prevCount: prev.length,
    avgCheck,
    perDay: p.days > 0 ? r2(revenue / p.days) : 0,
    deliveryShare: pct(delivery, count),
  };
}

// ─────────────────────────────────────────────
// ღირებულება — ჟურნალიდან
// ─────────────────────────────────────────────

export async function costMetrics(p: Period) {
  const moves = await db.stockMovement.findMany({
    where: { at: { gte: p.from, lte: p.to }, totalCost: { not: null } },
    select: { type: true, totalCost: true },
  });

  const sum = (t: string) =>
    r2(Math.abs(moves.filter((m) => m.type === t).reduce((s, m) => s + Number(m.totalCost), 0)));

  return {
    cogs: sum("sale"), // გაყიდვაზე ჩამოწერილი
    waste: sum("waste"), // ჩამოწერა — გაფუჭდა, დაიღვარა
    countAdjust: r2(
      moves.filter((m) => m.type === "count_adjust").reduce((s, m) => s + Number(m.totalCost), 0),
    ), // ინვენტარიზაციის სხვაობა (მინუსი = დანაკლისი)
  };
}

/** შრომის ღირებულება ცვლებიდან. */
export async function labourCost(p: Period) {
  const shifts = await db.shift.findMany({
    where: { clockIn: { gte: p.from, lte: p.to } },
    include: { employee: { select: { hourlyRate: true } } },
  });

  let cost = 0;
  let hours = 0;
  let unpriced = 0;

  for (const s of shifts) {
    const mins =
      s.durationMin ??
      (s.clockOut ? Math.round((s.clockOut.getTime() - s.clockIn.getTime()) / 60000) : null);
    if (mins === null) continue;

    const h = mins / 60;
    hours += h;

    if (s.employee.hourlyRate == null) {
      unpriced++;
      continue;
    }
    cost += h * Number(s.employee.hourlyRate);
  }

  return { cost: r2(cost), hours: Math.round(hours * 10) / 10, shifts: shifts.length, unpriced };
}

// ─────────────────────────────────────────────
// პროდუქტები
// ─────────────────────────────────────────────

export async function productBreakdown(p: Period, limit = 8) {
  const items = await db.orderItem.findMany({
    where: { order: { createdAt: { gte: p.from, lte: p.to }, status: { not: "cancelled" } } },
    select: { name: true, qty: true, lineTotal: true, productId: true, kind: true },
  });

  const acc = new Map<string, { name: unknown; productId: string | null; qty: number; revenue: number }>();

  for (const i of items) {
    const n = i.name as Record<string, unknown>;
    const key = i.productId ?? String(n?.en ?? "?");
    const cur = acc.get(key) ?? { name: i.name, productId: i.productId, qty: 0, revenue: 0 };
    cur.qty += i.qty;
    cur.revenue += Number(i.lineTotal);
    acc.set(key, cur);
  }

  const all = [...acc.values()].map((x) => ({ ...x, revenue: r2(x.revenue) }));

  return {
    byRevenue: [...all].sort((a, b) => b.revenue - a.revenue).slice(0, limit),
    byQty: [...all].sort((a, b) => b.qty - a.qty).slice(0, limit),
    total: all.length,
  };
}

// ─────────────────────────────────────────────
// ფილიალები და დრო
// ─────────────────────────────────────────────

export async function branchBreakdown(p: Period) {
  const [branches, orders] = await Promise.all([
    db.branch.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    db.order.findMany({
      where: { createdAt: { gte: p.from, lte: p.to }, status: { not: "cancelled" } },
      select: { branchId: true, total: true },
    }),
  ]);

  return branches
    .map((b) => {
      const own = orders.filter((o) => o.branchId === b.id);
      const revenue = r2(own.reduce((s, o) => s + Number(o.total), 0));
      return {
        id: b.id,
        name: b.name,
        count: own.length,
        revenue,
        avgCheck: own.length > 0 ? r2(revenue / own.length) : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

/** საათობრივი დატვირთვა — ვინ როდის უნდა მუშაობდეს. */
export async function hourlyLoad(p: Period) {
  const orders = await db.order.findMany({
    where: { createdAt: { gte: p.from, lte: p.to }, status: { not: "cancelled" } },
    select: { createdAt: true, total: true },
  });

  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, revenue: 0 }));
  for (const o of orders) {
    const h = new Date(o.createdAt).getHours();
    hours[h].count++;
    hours[h].revenue += Number(o.total);
  }

  const peak = hours.reduce((m, h) => (h.count > m.count ? h : m), hours[0]);
  return { hours: hours.map((h) => ({ ...h, revenue: r2(h.revenue) })), peak };
}

// ─────────────────────────────────────────────
// წარმოება და მარაგი
// ─────────────────────────────────────────────

export async function productionYield(p: Period) {
  const orders = await db.productionOrder.findMany({
    where: { status: "done", finishedAt: { gte: p.from, lte: p.to } },
    select: { plannedQty: true, actualQty: true },
  });

  if (orders.length === 0) return null;

  let planned = 0;
  let actual = 0;
  for (const o of orders) {
    planned += Number(o.plannedQty);
    actual += Number(o.actualQty ?? 0);
  }

  return { batches: orders.length, planned: r2(planned), actual: r2(actual), pct: pct(actual, planned) };
}

export async function stockAlerts() {
  const levels = await db.stockLevel.findMany({
    where: { minLevel: { not: null } },
    include: { item: { select: { name: true, unit: true, active: true, deletedAt: true } }, location: { select: { name: true } } },
  });

  const low = levels.filter(
    (l) => l.item.active && !l.item.deletedAt && Number(l.qty) <= Number(l.minLevel),
  );

  const value = levels.reduce(
    (s, l) => s + (l.avgCost != null ? Number(l.qty) * Number(l.avgCost) : 0),
    0,
  );

  return { low: low.length, items: low.slice(0, 6), stockValue: r2(value) };
}

// ─────────────────────────────────────────────
// ფიქსირებული ხარჯები (არჩევითი)
// ─────────────────────────────────────────────

export interface FixedCosts {
  rent: number;
  utilities: number;
  other: number;
  monthly: number;
}

export async function fixedCosts(): Promise<FixedCosts | null> {
  const row = await db.setting.findUnique({ where: { key: "fixedCosts" } });
  if (!row) return null;

  const v = row.value as Record<string, unknown>;
  const rent = Number(v.rent ?? 0);
  const utilities = Number(v.utilities ?? 0);
  const other = Number(v.other ?? 0);
  const monthly = rent + utilities + other;

  return monthly > 0 ? { rent, utilities, other, monthly: r2(monthly) } : null;
}
