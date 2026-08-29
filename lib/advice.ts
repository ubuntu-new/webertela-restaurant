import "server-only";
import { db } from "@/lib/db";
import { fmt } from "@/lib/format";
import { i18nText } from "@/lib/admin-utils";
import type { Period } from "@/lib/analytics";

/**
 * What the software would say if it were standing next to the owner.
 *
 * `setup-checklist.ts` answers "is it configured?" — a finite list that
 * completes and then disappears. This answers "is it healthy?", which is never
 * finished and changes every week.
 *
 * The rule that separates advice from noise: **consequence first, action
 * second, and never both at once for more than three findings.** An owner who
 * opens the dashboard and sees eleven warnings reads none of them. He is
 * cooking in forty minutes.
 *
 * So every finding must say, in his words:
 *   - what he is losing or cannot see           (title)
 *   - why it is happening                        (why)
 *   - the one thing that fixes it                (action)
 *
 * and the list is ranked and cut. Anything that cannot state all three does
 * not belong here.
 */

export type Severity = "critical" | "warning" | "watch";

export interface Finding {
  id: string;
  severity: Severity;
  /** What is wrong, in money or plain fact. Never a system term. */
  title: string;
  /** Why it is happening, and what it costs. */
  why: string;
  action?: { label: string; href: string };
  /** Which dashboard figure this explains, so it can be shown beside it. */
  attaches?: "revenue" | "foodCost" | "labour" | "primeCost" | "netProfit" | "stock" | "delivery" | "menu";
  /** Higher sorts first. Roughly "dollars at stake per month". */
  weight: number;
}

/** Everything the dashboard has already worked out, so nothing is queried twice. */
export interface AdviceInput {
  period: Period;
  revenue: number;
  growth: number | null;
  cogs: number;
  waste: number;
  countAdjust: number;
  labourCost: number;
  labourHours: number;
  unpricedShifts: number;
  fixedMonthly: number | null;
  lowStockCount: number;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export async function advise(input: AdviceInput): Promise<Finding[]> {
  const f = await fmt();
  const { period: p, revenue } = input;
  const out: Finding[] = [];

  // Scale a period figure to a month, so every weight is comparable no matter
  // which range the owner is looking at.
  const monthly = (n: number) => (p.days > 0 ? (n / p.days) * 30 : 0);

  const foodPct = pct(input.cogs, revenue);
  const labourPct = pct(input.labourCost, revenue);
  const primePct =
    input.cogs > 0 && input.labourCost > 0 ? pct(input.cogs + input.labourCost, revenue) : null;

  // ── the two figures that decide whether this is a business ──────────────

  if (primePct !== null && primePct > 65) {
    const over = ((primePct - 65) / 100) * revenue;
    out.push({
      id: "prime-high",
      severity: "critical",
      title: `Prime cost is ${primePct}% — above the line`,
      why:
        `Ingredients and labour together are eating ${primePct}% of every dollar. ` +
        `Bringing that back under 65% is worth about ${f.money(monthly(over))} a month. ` +
        `Look at portions and at the rota before you look at prices.`,
      action: { label: "See margin per product", href: "/admin/stock/costing" },
      attaches: "primeCost",
      weight: monthly(over),
    });
  }

  if (foodPct !== null && foodPct > 35) {
    const over = ((foodPct - 32) / 100) * revenue;
    out.push({
      id: "food-high",
      severity: "critical",
      title: `Food cost is ${foodPct}% — the norm is 28–33%`,
      why:
        `Every point above 33% is about ${f.money(monthly(revenue * 0.01))} a month. ` +
        `Three things cause it: portions creeping up, a supplier price that rose without anyone noticing, ` +
        `or stock leaving without a sale behind it.`,
      action: { label: "Check margin per product", href: "/admin/stock/costing" },
      attaches: "foodCost",
      weight: monthly(over),
    });
  }

  if (labourPct !== null && labourPct > 32) {
    const over = ((labourPct - 30) / 100) * revenue;
    out.push({
      id: "labour-high",
      severity: "warning",
      title: `Labour is ${labourPct}% of sales`,
      why:
        `Above about 30% the rota is usually out of step with the shape of the day, not overstaffed overall. ` +
        `Compare the hourly load with who was clocked in.`,
      action: { label: "Hourly load", href: "/admin?d=30" },
      attaches: "labour",
      weight: monthly(over),
    });
  }

  // ── money leaving without a sale ────────────────────────────────────────

  if (input.countAdjust < 0 && Math.abs(input.countAdjust) > revenue * 0.002) {
    const loss = Math.abs(input.countAdjust);
    out.push({
      id: "shortage",
      severity: "critical",
      title: `${f.money(loss)} of stock counted short`,
      why:
        `The shelf held less than the movements say it should. That is over-portioning, spoilage, ` +
        `or something walking out. It is the quietest way a kitchen loses money — everyone watches ` +
        `revenue, almost nobody watches this.`,
      action: { label: "Stock movements", href: "/admin/stock/movements" },
      attaches: "foodCost",
      weight: monthly(loss),
    });
  }

  if (input.waste > revenue * 0.01) {
    out.push({
      id: "waste",
      severity: "warning",
      title: `${f.money(input.waste)} written off as waste`,
      why:
        `That is ${pct(input.waste, revenue)}% of sales. Around 1% is normal for a kitchen; ` +
        `above it, prep quantities are usually the cause rather than any one bad delivery.`,
      action: { label: "Stock movements", href: "/admin/stock/movements?type=waste" },
      attaches: "foodCost",
      weight: monthly(input.waste),
    });
  }

  // Not in coreMetrics, so it is asked for here rather than threaded through
  // the dashboard — one small query beats a parameter nobody else needs.
  const discountTotal = Number(
    (
      await db.order.aggregate({
        _sum: { discountTotal: true },
        where: { createdAt: { gte: p.from, lte: p.to }, status: { not: "cancelled" } },
      })
    )._sum.discountTotal ?? 0,
  );

  if (discountTotal > revenue * 0.06) {
    out.push({
      id: "discounts",
      severity: "warning",
      title: `${f.money(discountTotal)} given away in discounts`,
      why:
        `${pct(discountTotal, revenue)}% of sales. Discounts are fine when they bring someone back; ` +
        `they are expensive when they are simply always on.`,
      action: { label: "Review discounts", href: "/admin/discounts" },
      attaches: "revenue",
      weight: monthly(discountTotal * 0.4),
    });
  }

  // ── figures the owner cannot see at all ─────────────────────────────────
  // These score high not because of a loss today, but because a blind figure
  // is worth more than a bad one: he cannot act on what he cannot see.

  if (input.cogs === 0) {
    const [rules, priced] = await Promise.all([
      db.consumptionRule.count(),
      db.stockMovement.count({ where: { type: "receipt", unitCost: { not: null } } }),
    ]);
    out.push({
      id: "no-food-cost",
      severity: "critical",
      title: "Food cost cannot be calculated",
      why:
        rules === 0
          ? "Nothing yet says what a sale consumes, so every dish looks free. Ten minutes of setup turns this on permanently."
          : priced === 0
            ? "Recipes exist, but no delivery has been recorded with a purchase price — so ingredients have no cost attached."
            : "Some part of the chain from recipe to purchase price is incomplete.",
      action:
        rules === 0
          ? { label: "Fill in consumption rules", href: "/admin/stock/consumption/bulk" }
          : { label: "Record a receipt with prices", href: "/admin/stock" },
      attaches: "foodCost",
      weight: monthly(revenue * 0.31), // what the figure would be worth knowing
    });
  }

  if (input.labourCost === 0 || input.unpricedShifts > 0) {
    const staff = await db.employee.count({
      where: { deletedAt: null, active: true, hourlyRate: null },
    });
    if (staff > 0) {
      out.push({
        id: "no-labour",
        severity: input.labourCost === 0 ? "critical" : "warning",
        title:
          input.labourCost === 0
            ? "Labour cost cannot be calculated"
            : `${staff} people have no hourly rate`,
        why:
          `Shifts are being recorded, but without a rate they cannot be turned into money — ` +
          `so prime cost, the one number that says whether the restaurant works, stays blank.`,
        action: { label: "Add hourly rates", href: "/admin/employees" },
        attaches: "labour",
        weight: monthly(revenue * 0.27),
      });
    }
  }

  if (!input.fixedMonthly) {
    out.push({
      id: "no-fixed",
      severity: "warning",
      title: "Net profit is hidden",
      why:
        "Rent, utilities and insurance are not entered, so the dashboard can show margin but never profit. " +
        "Two minutes, once — and then the screen answers the only question that matters.",
      action: { label: "Add fixed costs", href: "/admin/settings" },
      attaches: "netProfit",
      weight: monthly(revenue * 0.09),
    });
  }

  // ── operational, this week ──────────────────────────────────────────────

  const [openShift, worst, late] = await Promise.all([
    db.shift.findFirst({
      where: { status: "open", clockIn: { lt: new Date(Date.now() - 24 * 3600_000) } },
      include: { employee: { select: { name: true } } },
      orderBy: { clockIn: "asc" },
    }),
    worstMargin(),
    db.order.count({
      where: {
        deliveredAt: { not: null },
        assignedAt: { not: null },
        createdAt: { gte: new Date(Date.now() - 7 * 86400_000) },
      },
    }),
  ]);

  if (openShift) {
    const days = Math.floor((Date.now() - openShift.clockIn.getTime()) / 86400_000);
    out.push({
      id: "open-shift",
      severity: "warning",
      title: `${openShift.employee?.name ?? "Someone"}'s shift is still open`,
      why:
        `Clocked in ${days} day${days === 1 ? "" : "s"} ago and never clocked out. ` +
        `Until it is closed, labour cost — and prime cost with it — is wrong.`,
      action: { label: "Close the shift", href: "/admin/employees" },
      attaches: "labour",
      weight: 400,
    });
  }

  if (worst) {
    out.push({
      id: "losing-product",
      severity: "warning",
      title: `${worst.name} sells at ${worst.marginPct}% margin`,
      why:
        `Ingredients cost ${f.money(worst.cost)} against a ${f.money(worst.price)} menu price. ` +
        `A dish can be popular and still lose money — this is the one people never find on their own.`,
      action: { label: "See every margin", href: "/admin/stock/costing" },
      attaches: "menu",
      weight: 800,
    });
  }

  if (input.lowStockCount > 0) {
    out.push({
      id: "low-stock",
      severity: input.lowStockCount > 4 ? "warning" : "watch",
      title: `${input.lowStockCount} item${input.lowStockCount === 1 ? "" : "s"} at or below the minimum`,
      why:
        "Running out mid-service costs a sale and a customer. The replenishment screen already " +
        "works out how much to order.",
      action: { label: "Replenishment list", href: "/admin/stock/replenish" },
      attaches: "stock",
      weight: 300,
    });
  }

  if (late > 0) {
    out.push({
      id: "late-delivery",
      severity: "watch",
      title: `${late} deliveries took over 45 minutes this week`,
      why:
        "Late deliveries are the single most common reason a customer who ordered once does not order again.",
      action: { label: "See the orders", href: "/admin/orders" },
      attaches: "delivery",
      weight: 250,
    });
  }

  if (input.growth !== null && input.growth < -15) {
    out.push({
      id: "revenue-down",
      severity: "warning",
      title: `Sales are down ${Math.abs(input.growth)}% on the period before`,
      why:
        "Worth a look before it becomes a trend — compare the same weekdays, not the raw totals, " +
        "because a month with one less Friday in it looks worse than it was.",
      attaches: "revenue",
      weight: monthly(revenue * (Math.abs(input.growth) / 100) * 0.5),
    });
  }

  // Ranked by what is at stake, and cut. Three is the number a busy person
  // reads; the rest live on their own page for whoever wants them.
  const order: Record<Severity, number> = { critical: 0, warning: 1, watch: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity] || b.weight - a.weight);
}

/**
 * The worst margin on the menu, if it is bad enough to be worth saying.
 *
 * The costing page owns this calculation; this only reads it. Two places
 * working out the same margin is how two screens end up disagreeing, and the
 * day that happens the owner stops trusting both.
 */
async function worstMargin() {
  const { computeMenuCosts } = await import("@/lib/costing");
  const { products } = await computeMenuCosts();

  const bad = products
    .filter((x) => x.marginPct !== null && x.marginPct < 25 && x.price != null)
    .sort((a, b) => (a.marginPct ?? 0) - (b.marginPct ?? 0))[0];

  if (!bad) return null;
  return {
    name: i18nText(bad.name),
    marginPct: bad.marginPct as number,
    cost: bad.cost,
    price: bad.price as number,
  };
}

