import "server-only";
import { db } from "@/lib/db";
import { fmt } from "@/lib/format";

/**
 * Setup checklist — the program teaching the user what to do next.
 *
 * Every step inspects the database and reports whether it is done, why it
 * matters, and where to fix it. This is deliberately data-driven rather than
 * a static tutorial: a static list goes stale, a query never does.
 */

export interface Step {
  id: string;
  title: string;
  why: string;
  href: string;
  done: boolean;
  detail?: string;
  /** Blocks a whole feature until it's done */
  blocking?: boolean;
}

export async function setupChecklist(): Promise<{ steps: Step[]; done: number; total: number }> {
  const [
    products,
    stockItems,
    consumption,
    pricedReceipts,
    ratedStaff,
    staff,
    fixedCosts,
    branches,
    recipes,
    orders,
  ] = await Promise.all([
    db.product.count({ where: { deletedAt: null, active: true } }),
    db.stockItem.count({ where: { deletedAt: null } }),
    db.consumptionRule.count(),
    db.stockMovement.count({ where: { type: "receipt", unitCost: { not: null } } }),
    db.employee.count({ where: { deletedAt: null, active: true, hourlyRate: { not: null } } }),
    db.employee.count({ where: { deletedAt: null, active: true } }),
    db.setting.findUnique({ where: { key: "fixedCosts" } }),
    db.branch.count({ where: { deletedAt: null, active: true } }),
    db.recipe.count({ where: { deletedAt: null } }),
    db.order.count(),
  ]);

  const fc = (fixedCosts?.value ?? {}) as Record<string, unknown>;
  const fcTotal = Number(fc.rent ?? 0) + Number(fc.utilities ?? 0) + Number(fc.other ?? 0);

  const f = await fmt();

  const steps: Step[] = [
    {
      id: "menu",
      title: "Menu is in the database",
      why: "Everything else builds on the menu — prices, stock, reports.",
      href: "/admin/products",
      done: products > 0,
      detail: `${products} active products`,
    },
    {
      id: "branches",
      title: "Branches are set up",
      why: "Orders and stock are tracked per branch.",
      href: "/admin/branches",
      done: branches > 0,
      detail: `${branches} branches`,
    },
    {
      id: "stockItems",
      title: "Stock items exist",
      why: "What you STORE (mozzarella in kg), not what you sell (a pizza).",
      href: "/admin/stock/items",
      done: stockItems > 0,
      detail: stockItems > 0 ? `${stockItems} items` : "Nothing to track yet",
      blocking: true,
    },
    {
      id: "consumption",
      title: "Consumption rules are filled in",
      why: "Without these the system can't know what a sale uses — cost stays at zero.",
      href: "/admin/stock/consumption/bulk",
      done: consumption > 0,
      detail: consumption > 0 ? `${consumption} rules` : "Cost cannot be calculated",
      blocking: true,
    },
    {
      id: "prices",
      title: "Receipts recorded with a purchase price",
      why: "Cost is captured at receipt. Without a price, margin can't be computed.",
      href: "/admin/stock",
      done: pricedReceipts > 0,
      detail: pricedReceipts > 0 ? `${pricedReceipts} priced receipts` : "No prices recorded yet",
      blocking: true,
    },
    {
      id: "hourlyRate",
      title: "Staff have an hourly rate",
      why: "Labour cost and prime cost come from shifts × rate.",
      href: "/admin/employees",
      done: staff > 0 && ratedStaff === staff,
      detail: staff === 0 ? "No staff yet" : `${ratedStaff} of ${staff} have a rate`,
    },
    {
      id: "fixedCosts",
      title: "Fixed costs entered",
      why: "Net profit stays hidden until rent and utilities are known — a profit figure without them is a lie.",
      href: "/admin/settings",
      done: fcTotal > 0,
      detail: fcTotal > 0 ? `${f.money(fcTotal)} / month` : "Net profit is hidden",
    },
    {
      id: "recipes",
      title: "Production recipes (optional)",
      why: "Only if you make dough or sauce in-house.",
      href: "/admin/stock/recipes",
      done: recipes > 0,
      detail: recipes > 0 ? `${recipes} recipes` : "Not set up",
    },
    {
      id: "orders",
      title: "First order received",
      why: "Analytics start once real orders exist.",
      href: "/admin/orders",
      done: orders > 0,
      detail: `${orders} orders`,
    },
  ];

  return { steps, done: steps.filter((s) => s.done).length, total: steps.length };
}
