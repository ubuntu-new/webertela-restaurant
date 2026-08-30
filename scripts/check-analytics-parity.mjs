/**
 * Does the SQL version of the dashboard agree with the JavaScript one?
 *
 *   node scripts/check-analytics-parity.mjs [days]
 *
 * Run this BEFORE deploying the change, while the old code is still what the
 * site is serving. It computes every dashboard figure twice against the real
 * database — once the way the old code did, by pulling rows into Node and
 * reducing them, and once the way the new code does, with the summing pushed
 * into Postgres — and prints them side by side.
 *
 * Two things it is honest about:
 *
 *   · It holds its own copy of both implementations. It proves the two
 *     *approaches* agree on this data; `tsc` and the dashboard itself prove the
 *     shipped code is wired up. So run it, then look at /admin and check the
 *     numbers on screen against the "old" column below.
 *
 *   · The time-zone line is the one worth reading. The old hourly chart used
 *     the server process's zone and the new one uses the organisation's, and
 *     this is where you find out whether those two have ever agreed.
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const DAYS = Number(process.argv[2] ?? 30);

const to = new Date();
const from = new Date(to.getTime() - DAYS * 86400_000);
const prevFrom = new Date(from.getTime() - DAYS * 86400_000);

const r2 = (n) => Math.round(n * 100) / 100;

let bad = 0;
let checked = 0;
let section = "";
const failedIn = new Set();

/** Compare one figure. Money is compared to the cent, not to the bit. */
function cmp(label, oldVal, newVal, tol = 0.01) {
  checked++;
  const same =
    oldVal === newVal ||
    (typeof oldVal === "number" && typeof newVal === "number" && Math.abs(oldVal - newVal) <= tol) ||
    (oldVal === null && newVal === null);
  if (!same) {
    bad++;
    failedIn.add(section);
  }
  const mark = same ? "  ok " : "  ✗  ";
  console.log(`${mark}${label.padEnd(34)} old=${fmt(oldVal)}  new=${fmt(newVal)}`);
}

const fmt = (v) => (v === null ? "null" : typeof v === "number" ? String(r2(v)) : String(v));

// ────────────────────────────────────────────────────────────────────────────
console.log(`\nPeriod: last ${DAYS} days  (${from.toISOString()} → ${to.toISOString()})`);

const orgRow = await db.setting.findUnique({ where: { key: "org" } });
const orgTz = orgRow?.value?.timeZone ?? "America/New_York";
const procTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

console.log(`Organisation time zone: ${orgTz}`);
console.log(`This process's zone:    ${procTz}`);
if (orgTz !== procTz) {
  console.log(
    `\n  ⚠ They differ. The hourly chart below WILL disagree, and that is the\n` +
      `    bug being fixed rather than a fault in the rewrite: every time shown\n` +
      `    anywhere else on the site already uses ${orgTz}.`,
  );
}

// ── core ────────────────────────────────────────────────────────────────────
section = "core metrics";
console.log("\n── core metrics ──");
{
  const [orders, prev] = await Promise.all([
    db.order.findMany({
      where: { createdAt: { gte: from, lte: to }, status: { not: "cancelled" } },
      select: { total: true, fulfillmentType: true },
    }),
    db.order.findMany({
      where: { createdAt: { gte: prevFrom, lt: from }, status: { not: "cancelled" } },
      select: { total: true },
    }),
  ]);
  const oldRevenue = r2(orders.reduce((s, o) => s + Number(o.total), 0));
  const oldPrev = r2(prev.reduce((s, o) => s + Number(o.total), 0));
  const oldDelivery = orders.filter((o) => o.fulfillmentType === "delivery").length;

  const [byType, prevAgg] = await Promise.all([
    db.order.groupBy({
      by: ["fulfillmentType"],
      where: { createdAt: { gte: from, lte: to }, status: { not: "cancelled" } },
      _sum: { total: true },
      _count: { _all: true },
    }),
    db.order.aggregate({
      where: { createdAt: { gte: prevFrom, lt: from }, status: { not: "cancelled" } },
      _sum: { total: true },
      _count: { _all: true },
    }),
  ]);
  const newRevenue = r2(byType.reduce((s, g) => s + Number(g._sum.total ?? 0), 0));
  const newCount = byType.reduce((s, g) => s + g._count._all, 0);
  const newDelivery = byType.find((g) => g.fulfillmentType === "delivery")?._count._all ?? 0;

  cmp("revenue", oldRevenue, newRevenue);
  cmp("order count", orders.length, newCount);
  cmp("previous revenue", oldPrev, r2(Number(prevAgg._sum.total ?? 0)));
  cmp("previous count", prev.length, prevAgg._count._all);
  cmp("delivery orders", oldDelivery, newDelivery);
}

// ── cost ────────────────────────────────────────────────────────────────────
section = "cost metrics";
console.log("\n── cost metrics ──");
{
  const moves = await db.stockMovement.findMany({
    where: { at: { gte: from, lte: to }, totalCost: { not: null } },
    select: { type: true, totalCost: true },
  });
  const oldSum = (t) =>
    r2(Math.abs(moves.filter((m) => m.type === t).reduce((s, m) => s + Number(m.totalCost), 0)));
  const oldAdjust = r2(
    moves.filter((m) => m.type === "count_adjust").reduce((s, m) => s + Number(m.totalCost), 0),
  );

  const byType = await db.stockMovement.groupBy({
    by: ["type"],
    where: { at: { gte: from, lte: to }, totalCost: { not: null } },
    _sum: { totalCost: true },
  });
  const total = (t) => Number(byType.find((g) => g.type === t)?._sum.totalCost ?? 0);

  cmp("cogs", oldSum("sale"), r2(Math.abs(total("sale"))));
  cmp("waste", oldSum("waste"), r2(Math.abs(total("waste"))));
  cmp("count adjustment (signed)", oldAdjust, r2(total("count_adjust")));
  console.log(`     (${moves.length} movement rows read the old way, ${byType.length} the new)`);
}

// ── labour ──────────────────────────────────────────────────────────────────
section = "labour";
console.log("\n── labour ──");
{
  const shifts = await db.shift.findMany({
    where: { clockIn: { gte: from, lte: to } },
    include: { employee: { select: { hourlyRate: true } } },
  });
  let oCost = 0;
  let oHours = 0;
  let oUnpriced = 0;
  for (const s of shifts) {
    const mins =
      s.durationMin ??
      (s.clockOut ? Math.round((s.clockOut.getTime() - s.clockIn.getTime()) / 60000) : null);
    if (mins === null) continue;
    const h = mins / 60;
    oHours += h;
    if (s.employee.hourlyRate == null) {
      oUnpriced++;
      continue;
    }
    oCost += h * Number(s.employee.hourlyRate);
  }

  const [row] = await db.$queryRaw`
    SELECT
      COALESCE(SUM(t.mins), 0)::float8 / 60.0          AS hours,
      COALESCE(SUM(t.mins * t.rate), 0)::float8 / 60.0 AS cost,
      COUNT(*)::int                                    AS shifts,
      COUNT(*) FILTER (WHERE t.rate IS NULL AND t.mins IS NOT NULL)::int AS unpriced
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
      WHERE s."clockIn" >= ${from} AND s."clockIn" <= ${to}
    ) t
  `;

  cmp("labour cost", r2(oCost), r2(row?.cost ?? 0));
  cmp("hours", Math.round(oHours * 10) / 10, Math.round((row?.hours ?? 0) * 10) / 10, 0.1);
  cmp("shift count", shifts.length, row?.shifts ?? 0);
  cmp("shifts with no rate", oUnpriced, row?.unpriced ?? 0);
}

// ── products ────────────────────────────────────────────────────────────────
section = "product breakdown";
console.log("\n── product breakdown ──");
{
  const items = await db.orderItem.findMany({
    where: { order: { createdAt: { gte: from, lte: to }, status: { not: "cancelled" } } },
    select: { name: true, qty: true, lineTotal: true, productId: true },
  });
  const acc = new Map();
  for (const i of items) {
    const key = i.productId ?? String(i.name?.en ?? "?");
    const cur = acc.get(key) ?? { qty: 0, revenue: 0 };
    cur.qty += i.qty;
    cur.revenue += Number(i.lineTotal);
    acc.set(key, cur);
  }

  const rows = await db.$queryRaw`
    SELECT
      (ARRAY_AGG(oi.name ORDER BY oi.id))[1] AS name,
      oi."productId"                         AS "productId",
      SUM(oi.qty)::int                       AS qty,
      SUM(oi."lineTotal")::float8            AS revenue
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    WHERE o."createdAt" >= ${from} AND o."createdAt" <= ${to} AND o.status <> 'cancelled'
    GROUP BY COALESCE(oi."productId", oi.name->>'en', '?'), oi."productId"
  `;

  cmp("distinct products", acc.size, rows.length);
  cmp(
    "total qty",
    [...acc.values()].reduce((s, x) => s + x.qty, 0),
    rows.reduce((s, x) => s + x.qty, 0),
  );
  cmp(
    "total revenue",
    r2([...acc.values()].reduce((s, x) => s + x.revenue, 0)),
    r2(rows.reduce((s, x) => s + x.revenue, 0)),
  );

  // The rankings are what the screen shows, so compare them row by row rather
  // than trusting that equal totals mean equal ordering.
  const oldTop = [...acc.entries()]
    .map(([k, v]) => ({ k, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8);
  const newTop = [...rows].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  for (let i = 0; i < Math.max(oldTop.length, newTop.length); i++) {
    const o = oldTop[i];
    const n = newTop[i];
    cmp(`  #${i + 1} by revenue`, o ? r2(o.revenue) : null, n ? r2(n.revenue) : null);
  }
}

// ── branches ────────────────────────────────────────────────────────────────
section = "branches";
console.log("\n── branches ──");
{
  const [branches, orders] = await Promise.all([
    db.branch.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
    db.order.findMany({
      where: { createdAt: { gte: from, lte: to }, status: { not: "cancelled" } },
      select: { branchId: true, total: true },
    }),
  ]);
  const byBranch = await db.order.groupBy({
    by: ["branchId"],
    where: { createdAt: { gte: from, lte: to }, status: { not: "cancelled" } },
    _sum: { total: true },
    _count: { _all: true },
  });
  const totals = new Map(byBranch.map((g) => [g.branchId, g]));

  for (const b of branches) {
    const own = orders.filter((o) => o.branchId === b.id);
    const g = totals.get(b.id);
    const label = String(b.name?.en ?? b.name ?? b.id).slice(0, 20);
    cmp(`${label} revenue`, r2(own.reduce((s, o) => s + Number(o.total), 0)), r2(Number(g?._sum.total ?? 0)));
    cmp(`${label} orders`, own.length, g?._count._all ?? 0);
  }
}

// ── hourly ──────────────────────────────────────────────────────────────────
section = "hourly load";
console.log("\n── hourly load ──");
{
  const orders = await db.order.findMany({
    where: { createdAt: { gte: from, lte: to }, status: { not: "cancelled" } },
    select: { createdAt: true, total: true },
  });
  const oldHours = Array.from({ length: 24 }, () => ({ count: 0, revenue: 0 }));
  for (const o of orders) {
    const h = new Date(o.createdAt).getHours();
    oldHours[h].count++;
    oldHours[h].revenue += Number(o.total);
  }

  const rows = await db.$queryRaw`
    SELECT
      EXTRACT(HOUR FROM o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${orgTz})::int AS hour,
      COUNT(*)::int        AS count,
      SUM(o.total)::float8 AS revenue
    FROM "Order" o
    WHERE o."createdAt" >= ${from} AND o."createdAt" <= ${to} AND o.status <> 'cancelled'
    GROUP BY 1
  `;
  const newHours = Array.from({ length: 24 }, () => ({ count: 0, revenue: 0 }));
  for (const r of rows) if (r.hour >= 0 && r.hour < 24) newHours[r.hour] = { count: r.count, revenue: r.revenue };

  let shifted = 0;
  for (let h = 0; h < 24; h++) {
    if (oldHours[h].count !== newHours[h].count) shifted++;
  }
  cmp("total orders placed", orders.length, rows.reduce((s, r) => s + r.count, 0));
  cmp("hours that differ", 0, shifted, 0);

  const oldPeak = oldHours.reduce((m, h, i) => (h.count > oldHours[m].count ? i : m), 0);
  const newPeak = newHours.reduce((m, h, i) => (h.count > newHours[m].count ? i : m), 0);
  cmp("peak hour", oldPeak, newPeak, 0);

  if (shifted > 0) {
    console.log("\n     hour  old   new");
    for (let h = 0; h < 24; h++) {
      if (oldHours[h].count === newHours[h].count) continue;
      console.log(`     ${String(h).padStart(4)}  ${String(oldHours[h].count).padStart(3)}   ${String(newHours[h].count).padStart(3)}`);
    }
    console.log(
      `\n     A whole-hours offset here means the stored timestamps are not in\n` +
        `     UTC, and the SQL must be told which zone they ARE in. Anything\n` +
        `     else means the two are counting different orders.`,
    );
  }
}

// ── production ──────────────────────────────────────────────────────────────
section = "production";
console.log("\n── production ──");
{
  const orders = await db.productionOrder.findMany({
    where: { status: "done", finishedAt: { gte: from, lte: to } },
    select: { plannedQty: true, actualQty: true },
  });
  const agg = await db.productionOrder.aggregate({
    where: { status: "done", finishedAt: { gte: from, lte: to } },
    _sum: { plannedQty: true, actualQty: true },
    _count: { _all: true },
  });

  cmp("batches", orders.length, agg._count._all);
  cmp(
    "planned",
    r2(orders.reduce((s, o) => s + Number(o.plannedQty), 0)),
    r2(Number(agg._sum.plannedQty ?? 0)),
  );
  cmp(
    "actual",
    r2(orders.reduce((s, o) => s + Number(o.actualQty ?? 0), 0)),
    r2(Number(agg._sum.actualQty ?? 0)),
  );
  if (orders.length === 0) console.log("     (no finished batches in this period — nothing to compare)");
}

// ────────────────────────────────────────────────────────────────────────────
// A disagreement in the hourly chart when the two zones differ is the whole
// point of the change, not a regression — the old chart was reading the wrong
// clock. Treating it as a failure would print "do not deploy" at the one moment
// the rewrite is doing its job, and a check that cries wolf gets ignored.
const onlyHourly = failedIn.size === 1 && failedIn.has("hourly load");
const expectedShift = onlyHourly && orgTz !== procTz;

console.log(`\n${bad === 0 ? "✓" : expectedShift ? "!" : "✗"} ${checked - bad}/${checked} figures agree`);

if (bad === 0) {
  console.log("  Safe to deploy. Now open /admin and check the numbers on screen");
  console.log("  against the 'old' column above — that is the third witness.");
} else if (expectedShift) {
  console.log(`  The only disagreement is the hourly chart, and the two zones differ`);
  console.log(`  (${procTz} vs ${orgTz}). That is the bug being fixed: every other`);
  console.log(`  time on the site already uses ${orgTz}, and now this does too.`);
  console.log("  Check the shifted hours above look like your actual trading day.");
} else {
  console.log("  Do not deploy until each ✗ above is explained.");
}

await db.$disconnect();
process.exit(bad === 0 || expectedShift ? 0 : 1);
