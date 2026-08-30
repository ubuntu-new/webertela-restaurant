import "server-only";
import { db } from "@/lib/db";
import { orgFormat } from "@/lib/format";

/**
 * ბიზნესის ანალიტიკა.
 *
 * ⚠️ პატიოსნების წესი: დაფა მხოლოდ იმას აჩვენებს, რაც მართლა იცის.
 * სუფთა მოგება მხოლოდ მაშინ ჩნდება, როცა ფიქსირებული ხარჯები შეყვანილია —
 * თორემ „მოგება" ქირისა და ხელფასის გარეშე ტყუილი რიცხვია.
 *
 * ── Where the arithmetic happens ────────────────────────────────────────────
 *
 * All of it used to happen here: every function pulled its whole period into
 * Node and reduced it. On a demo with a few hundred orders that is invisible.
 * On a real restaurant's second year it is a dashboard that loads every order
 * ever placed to print one number — hundreds of megabytes across the wire so
 * that JavaScript can add up a column Postgres can add up without moving it.
 *
 * So the summing is now the database's job. Prisma's typed `groupBy` and
 * `aggregate` cover most of it and are preferred, because they keep the column
 * names checked by the compiler. Three cases they cannot express are written as
 * raw SQL and marked as such: a cross-table multiplication (hours × rate), a
 * grouping on a JSON field, and an hour-of-day extraction in a named time zone.
 *
 * Money is summed in SQL and cast to float8 before it crosses over. Every one
 * of these figures is rounded to the cent immediately afterwards, and a double
 * holds cents exactly far past any restaurant's turnover, so the cast costs
 * nothing and saves converting a Decimal object per row.
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
  // Grouping the current period by fulfilment type gives revenue, order count
  // and the delivery share in one pass. The result has one row per enum value —
  // three at most — however many orders it summarised.
  const [byType, prev] = await Promise.all([
    db.order.groupBy({
      by: ["fulfillmentType"],
      where: { createdAt: { gte: p.from, lte: p.to }, status: { not: "cancelled" } },
      _sum: { total: true },
      _count: { _all: true },
    }),
    db.order.aggregate({
      where: {
        createdAt: { gte: new Date(p.from.getTime() - p.days * 86400_000), lt: p.from },
        status: { not: "cancelled" },
      },
      _sum: { total: true },
      _count: { _all: true },
    }),
  ]);

  const revenue = r2(byType.reduce((s, g) => s + Number(g._sum.total ?? 0), 0));
  const prevRevenue = r2(Number(prev._sum.total ?? 0));
  const count = byType.reduce((s, g) => s + g._count._all, 0);
  const avgCheck = count > 0 ? r2(revenue / count) : 0;

  const growth = prevRevenue > 0 ? Math.round(((revenue - prevRevenue) / prevRevenue) * 1000) / 10 : null;

  const delivery = byType.find((g) => g.fulfillmentType === "delivery")?._count._all ?? 0;

  return {
    revenue,
    prevRevenue,
    growth,
    count,
    prevCount: prev._count._all,
    avgCheck,
    perDay: p.days > 0 ? r2(revenue / p.days) : 0,
    deliveryShare: pct(delivery, count),
  };
}

// ─────────────────────────────────────────────
// ღირებულება — ჟურნალიდან
// ─────────────────────────────────────────────

export async function costMetrics(p: Period) {
  // One row per movement type rather than one row per movement. A busy kitchen
  // writes a stock movement for every ingredient of every sold dish, so this is
  // the largest table in the database and the one worth not reading.
  const byType = await db.stockMovement.groupBy({
    by: ["type"],
    where: { at: { gte: p.from, lte: p.to }, totalCost: { not: null } },
    _sum: { totalCost: true },
  });

  const total = (t: string) => Number(byType.find((g) => g.type === t)?._sum.totalCost ?? 0);

  return {
    cogs: r2(Math.abs(total("sale"))), // გაყიდვაზე ჩამოწერილი
    waste: r2(Math.abs(total("waste"))), // ჩამოწერა — გაფუჭდა, დაიღვარა
    // Kept signed, unlike the two above: a negative count adjustment is a
    // shortfall and a positive one is a surplus, and the sign is the finding.
    countAdjust: r2(total("count_adjust")),
  };
}

/**
 * შრომის ღირებულება ცვლებიდან.
 *
 * Raw, because the figure is a product across two tables — a shift's minutes
 * times its employee's rate — and neither `groupBy` nor `aggregate` can
 * multiply. Everything the old loop did is preserved deliberately:
 *
 *   · a shift still open (no clockOut, no durationMin) contributes no hours,
 *     but is still counted in the shift total — `sum` skips nulls, `count(*)`
 *     does not;
 *   · a shift whose employee has no hourly rate contributes hours but no cost,
 *     and is counted as unpriced so the dashboard can say the labour figure is
 *     incomplete rather than quietly reporting it as low.
 */
export async function labourCost(p: Period) {
  const [row] = await db.$queryRaw<
    { hours: number; cost: number; shifts: number; unpriced: number }[]
  >`
    SELECT
      COALESCE(SUM(t.mins), 0)::float8 / 60.0             AS hours,
      COALESCE(SUM(t.mins * t.rate), 0)::float8 / 60.0    AS cost,
      COUNT(*)::int                                       AS shifts,
      COUNT(*) FILTER (
        WHERE t.rate IS NULL AND t.mins IS NOT NULL
      )::int                                              AS unpriced
    FROM (
      SELECT
        COALESCE(
          s."durationMin",
          CASE WHEN s."clockOut" IS NOT NULL
               THEN ROUND(EXTRACT(EPOCH FROM (s."clockOut" - s."clockIn")) / 60)
          END
        )::float8            AS mins,
        e."hourlyRate"::float8 AS rate
      FROM "Shift" s
      JOIN "Employee" e ON e.id = s."employeeId"
      WHERE s."clockIn" >= ${p.from} AND s."clockIn" <= ${p.to}
    ) t
  `;

  return {
    cost: r2(row?.cost ?? 0),
    hours: Math.round((row?.hours ?? 0) * 10) / 10,
    shifts: row?.shifts ?? 0,
    unpriced: row?.unpriced ?? 0,
  };
}

// ─────────────────────────────────────────────
// პროდუქტები
// ─────────────────────────────────────────────

/**
 * Raw, because the grouping key is `productId` when there is one and the
 * English name out of the JSON snapshot when there is not — a deleted product
 * still has to show its sales rather than vanish from the ranking. Prisma's
 * `groupBy` takes column names, not expressions over JSON.
 *
 * The result has one row per distinct product, which is the size of the menu
 * and not the size of the order history, so returning all of them and sorting
 * twice in Node costs nothing.
 */
export async function productBreakdown(p: Period, limit = 8) {
  const rows = await db.$queryRaw<
    { name: unknown; productId: string | null; qty: number; revenue: number }[]
  >`
    SELECT
      (ARRAY_AGG(oi.name ORDER BY oi.id))[1] AS name,
      oi."productId"                         AS "productId",
      SUM(oi.qty)::int                       AS qty,
      SUM(oi."lineTotal")::float8            AS revenue
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    WHERE o."createdAt" >= ${p.from}
      AND o."createdAt" <= ${p.to}
      AND o.status <> 'cancelled'
    -- The same key the old loop built: the product when it is known, its
    -- snapshotted English name otherwise. Both are in the GROUP BY, but they
    -- never split a group — where productId is set the two agree one-to-one.
    GROUP BY COALESCE(oi."productId", oi.name->>'en', '?'), oi."productId"
  `;

  const all = rows.map((x) => ({ ...x, revenue: r2(x.revenue) }));

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
  const [branches, byBranch] = await Promise.all([
    db.branch.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    db.order.groupBy({
      by: ["branchId"],
      where: { createdAt: { gte: p.from, lte: p.to }, status: { not: "cancelled" } },
      _sum: { total: true },
      _count: { _all: true },
    }),
  ]);

  const totals = new Map(byBranch.map((g) => [g.branchId, g]));

  return branches
    .map((b) => {
      const g = totals.get(b.id);
      const count = g?._count._all ?? 0;
      const revenue = r2(Number(g?._sum.total ?? 0));
      return {
        id: b.id,
        name: b.name,
        count,
        revenue,
        avgCheck: count > 0 ? r2(revenue / count) : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * საათობრივი დატვირთვა — ვინ როდის უნდა მუშაობდეს.
 *
 * Raw, and the only one of these with a correctness question rather than a
 * speed one, because "which hour" depends on whose clock is being read.
 *
 * The old version asked JavaScript: `new Date(createdAt).getHours()`, which
 * uses the *server process's* zone — set by `Environment=TZ=` in the systemd
 * unit. Everything the customer actually sees goes through `format-shared`,
 * which uses the *organisation's* zone from Settings. Today the deploy script
 * writes both from one `--tz` flag so they agree, and this chart was right by
 * coincidence. Change the time zone in Settings and every displayed time would
 * move while the peak-hour chart silently stayed on the old one.
 *
 * So the zone is now named explicitly and comes from the same place as the rest
 * of the interface. `AT TIME ZONE 'UTC'` reads the stored naive timestamp as
 * the UTC instant Prisma wrote, and the second conversion turns it into local
 * wall-clock time before the hour is taken.
 */
export async function hourlyLoad(p: Period) {
  const { timeZone } = await orgFormat();

  const rows = await db.$queryRaw<{ hour: number; count: number; revenue: number }[]>`
    SELECT
      EXTRACT(HOUR FROM o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::int AS hour,
      COUNT(*)::int              AS count,
      SUM(o.total)::float8       AS revenue
    FROM "Order" o
    WHERE o."createdAt" >= ${p.from}
      AND o."createdAt" <= ${p.to}
      AND o.status <> 'cancelled'
    GROUP BY 1
  `;

  // A quiet hour has no row at all, and a chart with holes in it is unreadable.
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, revenue: 0 }));
  for (const r of rows) {
    if (r.hour >= 0 && r.hour < 24) {
      hours[r.hour].count = r.count;
      hours[r.hour].revenue = r2(r.revenue);
    }
  }

  const peak = hours.reduce((m, h) => (h.count > m.count ? h : m), hours[0]);
  return { hours, peak };
}

// ─────────────────────────────────────────────
// წარმოება და მარაგი
// ─────────────────────────────────────────────

export async function productionYield(p: Period) {
  const agg = await db.productionOrder.aggregate({
    where: { status: "done", finishedAt: { gte: p.from, lte: p.to } },
    _sum: { plannedQty: true, actualQty: true },
    _count: { _all: true },
  });

  if (agg._count._all === 0) return null;

  const planned = Number(agg._sum.plannedQty ?? 0);
  const actual = Number(agg._sum.actualQty ?? 0);

  return { batches: agg._count._all, planned: r2(planned), actual: r2(actual), pct: pct(actual, planned) };
}

export async function stockAlerts() {
  // Bounded by ingredients × locations rather than by trading, so this one
  // stays a findMany. The dead rows are excluded in the query rather than
  // afterwards: a deleted ingredient was still being counted into stock value.
  const levels = await db.stockLevel.findMany({
    where: { minLevel: { not: null }, item: { active: true, deletedAt: null } },
    include: {
      item: { select: { name: true, unit: true, active: true, deletedAt: true } },
      location: { select: { name: true } },
    },
  });

  const low = levels.filter((l) => Number(l.qty) <= Number(l.minLevel));

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
