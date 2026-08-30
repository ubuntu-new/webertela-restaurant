import "server-only";
import { db } from "@/lib/db";
import { fmt } from "@/lib/format";
import { i18nText } from "@/lib/admin-utils";

/**
 * What is still between this restaurant and a true prime cost.
 *
 * The first version of this was nine boxes to tick. That shape has two faults,
 * and both of them are about the first week, which is the week that decides
 * whether anybody keeps using the software.
 *
 * **A tick is not progress.** "Consumption rules are filled in" went green on
 * the first rule out of a needed thousand. The owner saw a checkmark and had
 * done a tenth of a percent of the work.
 *
 * **A list is not an order.** Nine tasks in a column implies nine equal tasks.
 * They are not: three of them stand between the restaurant and the number the
 * whole product is sold on, and the rest can wait weeks without costing
 * anything. Telling somebody to do nine things is how they do none.
 *
 * So this answers a different question. Not "what is unfinished" but **"what am
 * I still missing, what will it get me, and how long will it take"** — with
 * every count real, every missing thing named, and the steps grouped under the
 * figure they unlock.
 *
 * The estimates are deliberately plain minutes rather than a progress
 * percentage. "About 25 minutes" is a decision somebody can make before lunch
 * service; "62% complete" is not information.
 */

export interface Step {
  id: string;
  title: string;
  /** What it buys, in the owner's terms. Never a system term. */
  why: string;
  href: string;
  done: boolean;
  /** How far along, when the work is a quantity rather than a switch. */
  progress?: { done: number; total: number; noun: string };
  /** The actual things that are missing, by name. At most a handful. */
  missing?: string[];
  /** Honest minutes, for the work that is left rather than all of it. */
  minutes: number;
  /** A short line for a step that is finished. */
  detail?: string;
}

export interface Goal {
  id: string;
  title: string;
  /**
   * How the goal reads at the end of "…and then you can". Held here rather than
   * derived from the title in the view: the first draft did that with
   * `title.replace(/^See your /, "")`, which turned "Take an order" into the
   * sentence "then you can see take an order". A regex over a display string
   * fails quietly and only on the one heading that does not fit the pattern.
   */
  after: string;
  /** The one sentence that says why this figure is worth having. */
  why: string;
  steps: Step[];
  reached: boolean;
  /** Minutes of work left before this figure appears. */
  minutes: number;
}

export interface Checklist {
  goals: Goal[];
  /** The next thing worth doing, or null when everything is reached. */
  next: { goal: Goal; step: Step } | null;
  done: number;
  total: number;
}

/** Names, cut to a readable handful, with the remainder counted. */
function few(names: string[], limit = 4): string[] {
  if (names.length <= limit) return names;
  return [...names.slice(0, limit), `and ${names.length - limit} more`];
}

export async function setupChecklist(): Promise<Checklist> {
  const [
    products,
    branches,
    stockItems,
    itemsNoRule,
    itemsNoPrice,
    staffAll,
    staffNoRate,
    fixedCosts,
  ] = await Promise.all([
    db.product.count({ where: { deletedAt: null, active: true } }),
    db.branch.count({ where: { deletedAt: null, active: true } }),
    db.stockItem.count({ where: { deletedAt: null } }),

    // Ingredients nothing consumes. These are the ones that make food cost
    // understate itself: the dish is sold, the shelf empties, and the software
    // never notices.
    //
    // Three exclusions, all of them real rather than convenient. An item made
    // in-house is consumed by its recipe. An item that appears in a recipe as
    // an input is accounted for by that recipe. And an inactive item is not in
    // use at all. Listing any of those would put flour on a list of things the
    // owner has forgotten, and a list with one wrong entry gets closed.
    db.stockItem.findMany({
      where: {
        deletedAt: null,
        active: true,
        isProduced: false,
        consumption: { none: {} },
        recipeInputs: { none: {} },
      },
      select: { name: true },
      orderBy: { createdAt: "asc" },
    }),

    // Ingredients that have never arrived with a price on them. A recipe
    // without a purchase price costs zero, which is worse than unknown —
    // it is a wrong number that looks like a right one.
    db.stockItem.findMany({
      where: {
        deletedAt: null,
        active: true,
        movements: { none: { type: "receipt", unitCost: { not: null } } },
      },
      select: { name: true },
      orderBy: { createdAt: "asc" },
    }),

    db.employee.count({ where: { deletedAt: null, active: true } }),
    db.employee.findMany({
      where: { deletedAt: null, active: true, hourlyRate: null },
      select: { name: true },
      orderBy: { createdAt: "asc" },
    }),

    db.setting.findUnique({ where: { key: "fixedCosts" } }),
  ]);

  const fc = (fixedCosts?.value ?? {}) as Record<string, unknown>;
  const fcTotal = Number(fc.rent ?? 0) + Number(fc.utilities ?? 0) + Number(fc.other ?? 0);
  const f = await fmt();

  const named = (rows: { name: unknown }[]) => rows.map((r) => i18nText(r.name));

  // Counted against the same population the list is drawn from, so the bar and
  // the names below it cannot disagree.
  const withRules = stockItems - itemsNoRule.length;
  const withPrices = stockItems - itemsNoPrice.length;

  // ── the four things worth having, in the order they become worth having ──

  const takeOrders: Step[] = [
    {
      id: "branches",
      title: "A branch exists",
      why: "Every order belongs to one. Nothing can be taken until there is at least one.",
      href: "/admin/branches",
      done: branches > 0,
      minutes: 5,
      detail: `${branches} active`,
    },
    {
      id: "menu",
      title: "Something to sell",
      why: "The menu the ordering site and the till both read.",
      href: products === 0 ? "/admin/setup/starter" : "/admin/products",
      done: products > 0,
      minutes: 60,
      detail: `${products} products`,
    },
  ];

  const foodCost: Step[] = [
    {
      id: "stockItems",
      title: "The ingredients you keep",
      why: "Not what you sell — what is on the shelf. Mozzarella and flour, not a pizza.",
      // With nothing there the useful destination is the screen that fills it,
      // not an empty form. A step that sends somebody to a blank page has named
      // what is missing and left them to type it.
      href: stockItems > 0 ? "/admin/stock/items" : "/admin/setup/starter",
      done: stockItems > 0,
      minutes: stockItems > 0 ? 0 : 2,
      detail: `${stockItems} ingredients`,
    },
    {
      id: "consumption",
      title: "What each sale uses",
      why: "Without this a dish costs nothing to make, and every margin on the costing screen is fiction.",
      href: "/admin/stock/consumption/bulk",
      done: stockItems > 0 && itemsNoRule.length === 0,
      progress: { done: withRules, total: stockItems, noun: "ingredients" },
      missing: few(named(itemsNoRule)),
      // The bulk screen takes one number per topping and works out the rest,
      // so this is far quicker than the row count suggests.
      minutes: Math.max(5, Math.ceil(itemsNoRule.length * 0.75)),
      detail: `${withRules} of ${stockItems}`,
    },
    {
      id: "prices",
      title: "What you paid for them",
      why: "Recorded on a delivery. Until then an ingredient costs zero, which quietly understates every dish that uses it.",
      href: "/admin/stock",
      done: stockItems > 0 && itemsNoPrice.length === 0,
      progress: { done: withPrices, total: stockItems, noun: "ingredients" },
      missing: few(named(itemsNoPrice)),
      minutes: Math.max(5, Math.ceil(itemsNoPrice.length * 0.5)),
      detail: `${withPrices} of ${stockItems}`,
    },
  ];

  const primeCost: Step[] = [
    {
      id: "hourlyRate",
      title: "What your staff are paid",
      why: "Hours are already recorded. A rate turns them into money, and money is the other half of prime cost.",
      href: "/admin/employees",
      done: staffAll > 0 && staffNoRate.length === 0,
      progress: { done: staffAll - staffNoRate.length, total: staffAll, noun: "people" },
      missing: few(named(staffNoRate)),
      minutes: Math.max(3, staffNoRate.length * 2),
      detail: `${staffAll - staffNoRate.length} of ${staffAll}`,
    },
  ];

  const profit: Step[] = [
    {
      id: "fixedCosts",
      title: "Rent, utilities, insurance",
      why: "The last thing between margin and profit. Two minutes, once — and then the screen answers the only question that matters.",
      href: "/admin/settings",
      done: fcTotal > 0,
      minutes: 2,
      detail: `${f.money(fcTotal)} a month`,
    },
  ];

  const build = (id: string, title: string, after: string, why: string, steps: Step[]): Goal => ({
    id,
    title,
    after,
    why,
    steps,
    reached: steps.every((s) => s.done),
    minutes: steps.filter((s) => !s.done).reduce((m, s) => m + s.minutes, 0),
  });

  const goals: Goal[] = [
    build(
      "orders",
      "Take an order",
      "start taking orders",
      "The site and the till both need this much and no more.",
      takeOrders,
    ),
    build(
      "foodCost",
      "See your food cost",
      "see your food cost",
      "What the ingredients in a sale actually cost — the number nobody has, and the reason a popular dish can lose money.",
      foodCost,
    ),
    build(
      "primeCost",
      "See your prime cost",
      "see your prime cost",
      "Ingredients plus labour, as a share of sales. Under 65% is a business; above it is a hobby that eats money.",
      primeCost,
    ),
    build(
      "profit",
      "See your profit",
      "see your profit",
      "Prime cost tells you the kitchen works. This tells you the month did.",
      profit,
    ),
  ];

  // The next thing worth doing: the first unfinished step of the first goal
  // not yet reached. One thing, not nine — an owner with a delivery arriving in
  // ten minutes will do one.
  let next: Checklist["next"] = null;
  for (const g of goals) {
    if (g.reached) continue;
    const step = g.steps.find((s) => !s.done);
    if (step) {
      next = { goal: g, step };
      break;
    }
  }

  const all = goals.flatMap((g) => g.steps);

  return { goals, next, done: all.filter((s) => s.done).length, total: all.length };
}
