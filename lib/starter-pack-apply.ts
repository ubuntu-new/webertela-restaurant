import "server-only";
import { db } from "@/lib/db";
import { nameKey } from "@/lib/name-key";
import { unitLabel, formatPack } from "@/lib/units";
import { packById, type StarterPack } from "@/lib/starter-packs";

/**
 * Applying a starter pack, and taking it back.
 *
 * The rule that makes this safe enough to offer on the first screen: **a pack
 * only ever adds, and only ever adds what is not already there.** Nothing it
 * touches is edited, nothing is deleted, and anything the restaurant already
 * has under that name is left exactly as it is. So a pack applied twice does
 * nothing the second time, and a pack applied on top of a half-built kitchen
 * fills the gaps rather than arguing with them.
 *
 * "Already there" means the same normalised name — the same rule the duplicate
 * guard uses. Applying the pizzeria pack to a restaurant that has typed
 * "mozzarella " by hand does not create a second mozzarella; it skips it and
 * says so.
 *
 * ── Why it can be undone ──
 *
 * A pack creates forty rows the owner did not choose one by one, and the fear
 * that stops people clicking such a button is not that it will fail, it is that
 * they will be left tidying up. So the exact ids are written into the audit log
 * as the pack is applied, and the undo reads them back.
 *
 * Undo refuses to remove anything that has since been used — a stock item with
 * a movement against it, a topping already on a product. By then the row is the
 * restaurant's, not the pack's, and pulling it out would take real data with it.
 */

const AUDIT_ACTION = "starterPack.apply";

export interface PackPlanRow {
  name: string;
  detail: string;
  /** Already present under this name, so the pack will leave it alone. */
  exists: boolean;
}

export interface PackPlan {
  pack: StarterPack;
  items: PackPlanRow[];
  toppings: PackPlanRow[];
  /** Topping → ingredient portions, one per size. */
  rules: number;
  newItems: number;
  newToppings: number;
  /** Applied before, and still undoable. */
  appliedAt: Date | null;
  canUndo: boolean;
  undoBlockedBy: string | null;
}

/** What this pack would do, without doing any of it. */
export async function planPack(packId: string): Promise<PackPlan | null> {
  const pack = packById(packId);
  if (!pack) return null;

  const [stockItems, toppings, applied] = await Promise.all([
    db.stockItem.findMany({ where: { deletedAt: null }, select: { nameKey: true } }),
    db.topping.findMany({ where: { deletedAt: null }, select: { nameKey: true } }),
    lastApplication(packId),
  ]);

  const haveItems = new Set(stockItems.map((i) => i.nameKey).filter(Boolean));
  const haveToppings = new Set(toppings.map((t) => t.nameKey).filter(Boolean));

  const items: PackPlanRow[] = pack.items.map((i) => ({
    name: i.name.en,
    detail: [
      unitLabel(i.unit),
      i.category,
      i.packSize != null && i.packUnit ? `${formatPack(i.packSize, i.packUnit)} ${"per pack"}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    exists: haveItems.has(nameKey(i.name.en)),
  }));

  const tops: PackPlanRow[] = pack.toppings.map((t) => ({
    name: t.name.en,
    detail: t.consumes ? `uses ${t.consumes.item}` : t.category,
    exists: haveToppings.has(nameKey(t.name.en)),
  }));

  const newToppings = tops.filter((t) => !t.exists).length;

  return {
    pack,
    items,
    toppings: tops,
    // Three sizes per topping that consumes something. Only for the toppings
    // actually being created — a topping the restaurant already had keeps
    // whatever portions it already has, which may well be better than ours.
    rules: pack.toppings.filter((t) => t.consumes && !haveToppings.has(nameKey(t.name.en))).length * 3,
    newItems: items.filter((i) => !i.exists).length,
    newToppings,
    appliedAt: applied?.at ?? null,
    canUndo: applied ? await undoIsSafe(applied) : false,
    undoBlockedBy: applied ? await undoBlocker(applied) : null,
  };
}

interface Application {
  id: string;
  at: Date;
  stockItemIds: string[];
  toppingIds: string[];
  ruleIds: string[];
}

/** The most recent application of this pack that has not been undone. */
async function lastApplication(packId: string): Promise<Application | null> {
  const row = await db.auditLog.findFirst({
    where: { action: AUDIT_ACTION, entityId: packId },
    orderBy: { at: "desc" },
  });
  if (!row) return null;

  const after = (row.after ?? {}) as Record<string, unknown>;
  if (after.undone) return null;

  const ids = (k: string) => (Array.isArray(after[k]) ? (after[k] as string[]) : []);
  return {
    id: row.id,
    at: row.at,
    stockItemIds: ids("stockItemIds"),
    toppingIds: ids("toppingIds"),
    ruleIds: ids("ruleIds"),
  };
}

/** Has anything the pack created been put to use since? */
async function undoBlocker(a: Application): Promise<string | null> {
  if (a.stockItemIds.length === 0 && a.toppingIds.length === 0) return null;

  const [movements, ownRules, onProducts] = await Promise.all([
    // A movement means real stock arrived or left. The row is the
    // restaurant's now.
    db.stockMovement.count({ where: { itemId: { in: a.stockItemIds } } }),
    // A rule somebody wrote themselves, as opposed to the ones the pack made.
    db.consumptionRule.count({
      where: { itemId: { in: a.stockItemIds }, NOT: { id: { in: a.ruleIds } } },
    }),
    db.productTopping.count({ where: { toppingId: { in: a.toppingIds } } }),
  ]);

  if (movements > 0) return `${movements} stock movements have been recorded against these items`;
  if (ownRules > 0) return `${ownRules} of your own ingredient rules now use these items`;
  if (onProducts > 0) return `these toppings are on ${onProducts} products`;
  return null;
}

async function undoIsSafe(a: Application): Promise<boolean> {
  return (await undoBlocker(a)) === null;
}

/**
 * Create everything in the pack that is not already there.
 *
 * One transaction. A pack half applied would leave a kitchen with ingredients
 * but no portions, which looks like the software losing track — and the whole
 * point of this screen is to be the moment somebody starts trusting it.
 */
export async function applyPack(packId: string, employeeId: string): Promise<{ items: number; toppings: number; rules: number }> {
  const pack = packById(packId);
  if (!pack) throw new Error("No such starter pack.");

  return db.$transaction(async (tx) => {
    const [existingItems, existingToppings] = await Promise.all([
      tx.stockItem.findMany({ where: { deletedAt: null }, select: { id: true, nameKey: true } }),
      tx.topping.findMany({ where: { deletedAt: null }, select: { id: true, nameKey: true } }),
    ]);

    // id by normalised name, so a rule can point at an ingredient the
    // restaurant already had rather than insisting on one of ours.
    const itemIdByKey = new Map(existingItems.filter((i) => i.nameKey).map((i) => [i.nameKey as string, i.id]));
    const toppingKeys = new Set(existingToppings.map((t) => t.nameKey).filter(Boolean));

    const stockItemIds: string[] = [];
    const toppingIds: string[] = [];
    const ruleIds: string[] = [];

    // ── stock items ──
    for (const i of pack.items) {
      const key = nameKey(i.name.en);
      if (itemIdByKey.has(key)) continue;

      const created = await tx.stockItem.create({
        data: {
          name: i.name,
          nameKey: key,
          unit: i.unit,
          category: i.category,
          packSize: i.packSize ?? null,
          packUnit: i.packUnit ?? null,
          active: true,
          // Deliberately no minLevel or targetLevel. See lib/starter-packs.ts:
          // a threshold is a promise about days and there is no usage yet.
        },
      });
      itemIdByKey.set(key, created.id);
      stockItemIds.push(created.id);
    }

    // ── toppings, and the portions that make them cost something ──
    const sizes = ["S", "M", "XL"] as const;

    for (const t of pack.toppings) {
      const key = nameKey(t.name.en);
      if (toppingKeys.has(key)) continue;

      const created = await tx.topping.create({
        data: {
          name: t.name,
          nameKey: key,
          category: t.category,
          emoji: t.emoji,
          popular: t.popular ?? false,
          active: true,
          sortOrder: 999,
        },
      });
      toppingIds.push(created.id);
      toppingKeys.add(key);

      // A price of zero on all three sizes, because what a restaurant charges
      // for extra cheese is not something a template can know. The row has to
      // exist for the size to be offerable at all.
      await tx.toppingPrice.createMany({
        data: sizes.map((sizeKey) => ({ toppingId: created.id, sizeKey, price: 0 })),
      });

      if (!t.consumes) continue;
      const itemId = itemIdByKey.get(nameKey(t.consumes.item));
      if (!itemId) continue;

      for (let i = 0; i < sizes.length; i++) {
        const rule = await tx.consumptionRule.create({
          data: {
            toppingId: created.id,
            itemId,
            sizeKey: sizes[i],
            qty: t.consumes.perSize[i],
            note: `From the ${pack.name} starter pack — check the portion against your own`,
          },
        });
        ruleIds.push(rule.id);
      }
    }

    await tx.auditLog.create({
      data: {
        action: AUDIT_ACTION,
        entityType: "StarterPack",
        entityId: packId,
        employeeId,
        after: {
          pack: pack.name,
          stockItemIds,
          toppingIds,
          ruleIds,
          counts: { items: stockItemIds.length, toppings: toppingIds.length, rules: ruleIds.length },
        },
      },
    });

    return { items: stockItemIds.length, toppings: toppingIds.length, rules: ruleIds.length };
  }, { timeout: 60_000 });
}

/**
 * Put it back the way it was.
 *
 * Only what the pack itself created, only while nothing has used it, and only
 * the rows that are still untouched. Anything that has since been given a
 * movement or attached to a product stays — it stopped being the pack's the
 * moment somebody used it.
 */
export async function undoPack(packId: string, employeeId: string): Promise<{ items: number; toppings: number; rules: number }> {
  const applied = await lastApplication(packId);
  if (!applied) throw new Error("This pack has not been applied, or has already been undone.");

  const blocker = await undoBlocker(applied);
  if (blocker) throw new Error(`This can no longer be undone — ${blocker}.`);

  return db.$transaction(async (tx) => {
    const rules = await tx.consumptionRule.deleteMany({ where: { id: { in: applied.ruleIds } } });
    await tx.toppingPrice.deleteMany({ where: { toppingId: { in: applied.toppingIds } } });
    const toppings = await tx.topping.deleteMany({ where: { id: { in: applied.toppingIds } } });

    // Levels can exist with a zero quantity from an edit that set a threshold
    // and nothing else. They carry no history, so they go with the item.
    await tx.stockLevel.deleteMany({ where: { itemId: { in: applied.stockItemIds } } });
    const items = await tx.stockItem.deleteMany({ where: { id: { in: applied.stockItemIds } } });

    // The application is marked undone rather than deleted. The audit log is
    // the record of what happened, and "this was applied and then taken back"
    // is a truer record than silence.
    const row = await tx.auditLog.findUnique({ where: { id: applied.id } });
    await tx.auditLog.update({
      where: { id: applied.id },
      data: { after: { ...((row?.after ?? {}) as object), undone: true, undoneAt: new Date().toISOString() } },
    });

    await tx.auditLog.create({
      data: {
        action: "starterPack.undo",
        entityType: "StarterPack",
        entityId: packId,
        employeeId,
        after: { items: items.count, toppings: toppings.count, rules: rules.count },
      },
    });

    return { items: items.count, toppings: toppings.count, rules: rules.count };
  }, { timeout: 60_000 });
}
