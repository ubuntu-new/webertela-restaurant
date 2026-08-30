import "server-only";
import { db } from "@/lib/db";
import { num } from "@/lib/admin-utils";
import { isConvertible, convert, convertCost, unitLabel } from "@/lib/units";
import type { StockUnit } from "@prisma/client";

/**
 * Put a split ingredient back together.
 *
 * Prevention only helps from today. A restaurant that has been running for
 * months already has its mozzarella in two rows, and telling the owner "don't
 * do that again" fixes nothing — the food cost stays wrong until the two halves
 * are one again.
 *
 * What makes this delicate is that a stock item is not a label. It is the
 * anchor for a running balance, a cost average, a set of recipes and a ledger
 * that must still add up afterwards. So the merge has rules:
 *
 *  - **Quantities add, per location.** Two rows for the warehouse become one
 *    row holding the sum. Anything else would invent or destroy stock.
 *  - **Cost is averaged by weight, not picked.** 10 kg at $6 merged with 2 kg
 *    at $9 is 12 kg at $6.50. Taking either side's average would move the food
 *    cost of every future sale.
 *  - **Movements are re-pointed, never deleted.** The ledger is the reason
 *    "on hand" can be trusted; a merge that erased history would break exactly
 *    the property that makes this software worth paying for. Every past
 *    movement keeps its date, quantity and note, and simply now belongs to the
 *    surviving item.
 *  - **Rules that would collide are dropped, not duplicated.** If both items
 *    are consumed by the same product at the same size, one rule survives, and
 *    it is the one with the larger quantity — under-deducting stock is the
 *    error that hides, over-deducting is the error that shows.
 *  - **The loser is archived, not deleted.** Nothing in this system is deleted.
 *
 * Everything happens in one transaction: a half-finished merge would leave
 * stock in two places with the ledger pointing at one of them, which is worse
 * than the duplicate it was fixing.
 */

export interface MergePlan {
  keepId: string;
  loseId: string;
  /** Same measurement on both sides — kilograms cannot be added to pieces. */
  compatible: boolean;
  reason?: string;
  /** The two sides use different but convertible units, so quantities and costs
   *  will be recalculated. Worth saying out loud before it happens. */
  converting?: boolean;
  fromUnit?: string;
  toUnit?: string;
  moves: {
    levels: number;
    movements: number;
    consumptionRules: number;
    consumptionDropped: number;
    recipeLines: number;
    transferLines: number;
    productionLines: number;
    /** Recipes whose output is this item — their yield is restated too. */
    recipesProducing: number;
  };
  /** What the surviving item will hold afterwards, per location. */
  resulting: Array<{ locationId: string; locationName: string; qty: number; avgCost: number | null }>;
}

/** Work out exactly what a merge would do, without doing any of it. */
export async function planMerge(keepId: string, loseId: string): Promise<MergePlan> {
  const [keep, lose] = await Promise.all([
    db.stockItem.findUnique({ where: { id: keepId }, include: { levels: true } }),
    db.stockItem.findUnique({ where: { id: loseId }, include: { levels: true } }),
  ]);

  const empty: MergePlan["moves"] = {
    levels: 0, movements: 0, consumptionRules: 0, consumptionDropped: 0,
    recipeLines: 0, transferLines: 0, productionLines: 0, recipesProducing: 0,
  };

  if (!keep || !lose) {
    return { keepId, loseId, compatible: false, reason: "One of these no longer exists.", moves: empty, resulting: [] };
  }
  if (keepId === loseId) {
    return { keepId, loseId, compatible: false, reason: "That is the same item.", moves: empty, resulting: [] };
  }
  // Grams and kilograms are the same measurement written two ways, so refusing
  // there left a real duplicate in place and told the owner to go and change a
  // unit by hand — the manual work this system exists to remove. Kilograms and
  // pieces are a different matter: there is no factor between them, it depends
  // on what the thing is, and converting would invent stock.
  if (!isConvertible(lose.unit, keep.unit)) {
    return {
      keepId, loseId, compatible: false,
      reason:
        `One is measured in ${unitLabel(lose.unit)} and the other in ${unitLabel(keep.unit)}, and there is no ` +
        `fixed amount between them — how many pieces make a kilogram depends on the item. ` +
        `Change one of them to the same kind of measurement first.`,
      moves: empty, resulting: [],
    };
  }

  const converting = lose.unit !== keep.unit;

  // Every quantity column here is Decimal(14,3). Converting into a much larger
  // unit rounds small numbers away: 1 ml becomes 0.000 gal, and 1 g becomes
  // 0.002 lb — a 9% error, silently, on every historical movement. The ledger
  // would keep its money and lose its quantity, which is the worst of both.
  //
  // Merging the other way round is exact, so this is a redirection rather than
  // a dead end: keep the smaller unit.
  if (converting && convert(1, lose.unit, keep.unit) < 0.001) {
    return {
      keepId, loseId, compatible: false,
      reason:
        `Converting ${unitLabel(lose.unit)} into ${unitLabel(keep.unit)} would round the small quantities away — ` +
        `three decimal places is not enough to hold them. Merge the other way round instead: ` +
        `keep the item measured in ${unitLabel(lose.unit)} and merge this one into it.`,
      moves: empty, resulting: [],
    };
  }

  const [movements, rules, recipeLines, transferLines, productionLines, locations, keepRules, recipesProducing] = await Promise.all([
    db.stockMovement.count({ where: { itemId: loseId } }),
    db.consumptionRule.findMany({ where: { itemId: loseId } }),
    db.recipeLine.count({ where: { itemId: loseId } }),
    db.transferLine.count({ where: { itemId: loseId } }),
    db.productionLine.count({ where: { itemId: loseId } }),
    db.stockLocation.findMany({ select: { id: true, name: true } }),
    db.consumptionRule.findMany({ where: { itemId: keepId } }),
    db.recipe.count({ where: { outputItemId: loseId } }),
  ]);

  // A rule collides when the same product/topping/size already consumes the
  // surviving item — the unique index would refuse it, so it is resolved here.
  const keyOf = (r: { productId: string | null; toppingId: string | null; sizeKey: string | null }) =>
    `${r.productId ?? ""}|${r.toppingId ?? ""}|${r.sizeKey ?? ""}`;
  const keepKeys = new Set(keepRules.map(keyOf));
  const dropped = rules.filter((r) => keepKeys.has(keyOf(r))).length;

  const locName = new Map(
    locations.map((l) => [l.id, typeof l.name === "object" && l.name ? String((l.name as Record<string, unknown>).en ?? "") : String(l.name ?? "")]),
  );

  // Everything is expressed in the surviving item's unit before it is added.
  // Adding 2 (kg) to 500 (g) and calling it 502 of anything is how a merge
  // would quietly destroy a stock figure.
  const byLocation = new Map<string, { qty: number; value: number; costed: number; fallbackCost?: number }>();
  for (const [side, unit] of [[keep.levels, keep.unit] as const, [lose.levels, lose.unit] as const]) {
    for (const l of side) {
      const cur = byLocation.get(l.locationId) ?? { qty: 0, value: 0, costed: 0 };
      const qty = convert(num(l.qty), unit, keep.unit);
      cur.qty += qty;
      if (l.avgCost != null) {
        const cost = convertCost(num(l.avgCost), unit, keep.unit);
        if (qty > 0) {
          cur.value += qty * cost;
          cur.costed += qty;
        } else {
          // A used-up item still knows what it cost. The executed merge keeps
          // that price (cA ?? cB); the preview must show the same thing, or it
          // promises "—" and then delivers a number.
          cur.fallbackCost ??= cost;
        }
      }
      byLocation.set(l.locationId, cur);
    }
  }

  return {
    keepId,
    loseId,
    compatible: true,
    converting,
    fromUnit: lose.unit,
    toUnit: keep.unit,
    moves: {
      levels: lose.levels.length,
      movements,
      consumptionRules: rules.length - dropped,
      consumptionDropped: dropped,
      recipeLines,
      transferLines,
      productionLines,
      recipesProducing,
    },
    resulting: [...byLocation.entries()].map(([locationId, v]) => ({
      locationId,
      locationName: locName.get(locationId) ?? locationId,
      qty: v.qty,
      avgCost: v.costed > 0 ? v.value / v.costed : (v.fallbackCost ?? null),
    })),
  };
}

/** Carry out the plan. Returns the plan that was executed. */
export async function mergeStockItems(keepId: string, loseId: string, employeeId: string): Promise<MergePlan> {
  const plan = await planMerge(keepId, loseId);
  if (!plan.compatible) throw new Error(plan.reason ?? "These cannot be merged.");

  // Prisma's interactive transactions time out after five seconds by default.
  // This one walks every stock level, movement group, recipe line, transfer
  // line and consumption rule the losing item ever touched — and the item most
  // worth merging is precisely the one with a year of those behind it. At five
  // seconds it would raise P2028 and the merge could never complete, which
  // would leave the duplicate in place with no way to fix it.
  const from = plan.fromUnit as StockUnit;
  const to = plan.toUnit as StockUnit;
  const converting = !!plan.converting;

  /** A quantity on the losing item, expressed in the survivor's unit. */
  const q = (v: unknown) => (converting ? convert(num(v), from, to) : num(v));
  /** Same for a price per unit, which scales the opposite way. */
  const c = (v: unknown) => (converting ? convertCost(num(v), from, to) : num(v));
  /** Nullable variants, because a null cost is "unknown", not zero. */
  const qN = (v: unknown) => (v == null ? null : q(v));

  await db.$transaction(async (tx) => {
    // ── 1. levels: add quantities, weight the cost ──
    const loseLevels = await tx.stockLevel.findMany({ where: { itemId: loseId } });

    for (const l of loseLevels) {
      const existing = await tx.stockLevel.findUnique({
        where: { locationId_itemId: { locationId: l.locationId, itemId: keepId } },
      });

      if (!existing) {
        // Even with nothing to add it to, the row has to be restated in the
        // survivor's unit — otherwise 2 kg silently becomes 2 g.
        await tx.stockLevel.update({
          where: { id: l.id },
          data: {
            itemId: keepId,
            ...(converting
              ? {
                  qty: q(l.qty),
                  avgCost: l.avgCost == null ? null : c(l.avgCost),
                  minLevel: qN(l.minLevel),
                  targetLevel: qN(l.targetLevel),
                }
              : {}),
          },
        });
        continue;
      }

      const qA = num(existing.qty);
      const qB = q(l.qty);
      const cA = existing.avgCost != null ? num(existing.avgCost) : null;
      const cB = l.avgCost != null ? c(l.avgCost) : null;

      // Weighted only over the quantity that actually carries a cost, so an
      // uncosted pile does not drag the average to zero.
      const costedQty = (cA != null ? qA : 0) + (cB != null ? qB : 0);
      const costedValue = (cA != null ? qA * cA : 0) + (cB != null ? qB * cB : 0);

      // Falling back to whichever side knows a price matters more than it
      // looks. An item that has been used up sits at qty 0 with a perfectly
      // good avgCost; merge an uncosted pile into it and a plain weighted
      // average has nothing to weigh, writes null, and every future write-off
      // at that location costs zero. That understates food cost — which is the
      // exact failure this whole feature exists to prevent.
      const mergedCost = costedQty > 0 ? costedValue / costedQty : (cA ?? cB);

      await tx.stockLevel.update({
        where: { id: existing.id },
        data: {
          qty: qA + qB,
          avgCost: mergedCost,
          // Thresholds: keep whichever is set, prefer the survivor's. Losing a
          // minimum silently is how an item stops being watched.
          minLevel: existing.minLevel ?? qN(l.minLevel),
          targetLevel: existing.targetLevel ?? qN(l.targetLevel),
        },
      });
      await tx.stockLevel.delete({ where: { id: l.id } });
    }

    // ── 2. the ledger ──
    // Movements have no uniqueness to violate: two receipts of the same thing
    // on the same day are two real events and both must survive.
    if (!converting) {
      await tx.stockMovement.updateMany({ where: { itemId: loseId }, data: { itemId: keepId } });
    } else {
      // Every historical quantity has to be restated, because "on hand" is the
      // sum of these rows. Leave a gram movement sitting under a kilogram item
      // and the balance the dashboard shows stops matching the shelf — which is
      // the one property that makes any of this worth trusting.
      //
      // Row by row rather than one UPDATE: the quantities are Decimal and the
      // factor is not always whole, so the arithmetic happens where it can be
      // read. `totalCost` is untouched on purpose — a movement's money value
      // does not change because the unit was rewritten.
      const loseMoves = await tx.stockMovement.findMany({ where: { itemId: loseId } });
      for (const m of loseMoves) {
        await tx.stockMovement.update({
          where: { id: m.id },
          data: {
            itemId: keepId,
            qty: q(m.qty),
            balanceAfter: m.balanceAfter == null ? null : q(m.balanceAfter),
            unitCost: m.unitCost == null ? null : c(m.unitCost),
          },
        });
      }
    }
    // A recipe's yield is stated in its OUTPUT ITEM's unit — "this run makes
    // 1000 g of dough". Repoint the output at a kilogram item without touching
    // the number and the recipe now claims to make 1000 kg, and every future
    // production run adds a tonne of dough to stock. The same is true of the
    // batches already raised from it, whose planned and actual quantities are
    // that yield multiplied out.
    if (!converting) {
      await tx.recipe.updateMany({ where: { outputItemId: loseId }, data: { outputItemId: keepId } });
    } else {
      const recipes = await tx.recipe.findMany({ where: { outputItemId: loseId }, select: { id: true, outputQty: true } });
      for (const r of recipes) {
        await tx.recipe.update({
          where: { id: r.id },
          data: { outputItemId: keepId, outputQty: q(r.outputQty) },
        });

        const orders = await tx.productionOrder.findMany({
          where: { recipeId: r.id },
          select: { id: true, plannedQty: true, actualQty: true },
        });
        for (const o of orders) {
          await tx.productionOrder.update({
            where: { id: o.id },
            data: { plannedQty: q(o.plannedQty), actualQty: qN(o.actualQty) },
          });
        }
      }
    }

    // ── 2b. lines, which DO have uniqueness ──
    // RecipeLine is unique on (recipeId, itemId), TransferLine on
    // (transferId, itemId), ProductionLine on (productionOrderId, itemId). A
    // blanket updateMany would hit that constraint the moment one recipe used
    // both halves of the split ingredient — which is exactly the recipe most
    // likely to exist. Quantities are added, because a recipe that called for
    // 0.1 kg of one mozzarella and 0.08 kg of the other really does use 0.18 kg.

    const loseRecipeLines = await tx.recipeLine.findMany({ where: { itemId: loseId } });
    for (const l of loseRecipeLines) {
      const clash = await tx.recipeLine.findUnique({
        where: { recipeId_itemId: { recipeId: l.recipeId, itemId: keepId } },
      });
      if (!clash) {
        await tx.recipeLine.update({
          where: { id: l.id },
          data: { itemId: keepId, ...(converting ? { qty: q(l.qty) } : {}) },
        });
        continue;
      }
      await tx.recipeLine.update({ where: { id: clash.id }, data: { qty: num(clash.qty) + q(l.qty) } });
      await tx.recipeLine.delete({ where: { id: l.id } });
    }

    const loseTransferLines = await tx.transferLine.findMany({ where: { itemId: loseId } });
    for (const l of loseTransferLines) {
      const clash = await tx.transferLine.findUnique({
        where: { transferId_itemId: { transferId: l.transferId, itemId: keepId } },
      });
      if (!clash) {
        await tx.transferLine.update({
          where: { id: l.id },
          data: {
            itemId: keepId,
            ...(converting
              ? {
                  qtyRequested: q(l.qtyRequested),
                  qtyApproved: qN(l.qtyApproved),
                  qtySent: qN(l.qtySent),
                  qtyReceived: qN(l.qtyReceived),
                }
              : {}),
          },
        });
        continue;
      }
      const add = (a: unknown, b: unknown) => (a == null && b == null ? null : num(a) + q(b));
      await tx.transferLine.update({
        where: { id: clash.id },
        data: {
          qtyRequested: num(clash.qtyRequested) + q(l.qtyRequested),
          qtyApproved: add(clash.qtyApproved, l.qtyApproved),
          qtySent: add(clash.qtySent, l.qtySent),
          qtyReceived: add(clash.qtyReceived, l.qtyReceived),
        },
      });
      await tx.transferLine.delete({ where: { id: l.id } });
    }

    const loseProductionLines = await tx.productionLine.findMany({ where: { itemId: loseId } });
    for (const l of loseProductionLines) {
      const clash = await tx.productionLine.findUnique({
        where: { productionOrderId_itemId: { productionOrderId: l.productionOrderId, itemId: keepId } },
      });
      if (!clash) {
        await tx.productionLine.update({
          where: { id: l.id },
          data: {
            itemId: keepId,
            ...(converting ? { qtyPlanned: q(l.qtyPlanned), qtyUsed: qN(l.qtyUsed) } : {}),
          },
        });
        continue;
      }
      await tx.productionLine.update({
        where: { id: clash.id },
        data: {
          qtyPlanned: num(clash.qtyPlanned) + q(l.qtyPlanned),
          qtyUsed: clash.qtyUsed == null && l.qtyUsed == null ? null : num(clash.qtyUsed) + q(l.qtyUsed),
        },
      });
      await tx.productionLine.delete({ where: { id: l.id } });
    }

    // ── 3. consumption rules, resolving collisions ──
    const keyOf = (r: { productId: string | null; toppingId: string | null; sizeKey: string | null }) =>
      `${r.productId ?? ""}|${r.toppingId ?? ""}|${r.sizeKey ?? ""}`;

    const [loseRules, keepRules] = await Promise.all([
      tx.consumptionRule.findMany({ where: { itemId: loseId } }),
      tx.consumptionRule.findMany({ where: { itemId: keepId } }),
    ]);
    const keepByKey = new Map(keepRules.map((r) => [keyOf(r), r]));

    for (const r of loseRules) {
      const clash = keepByKey.get(keyOf(r));
      if (!clash) {
        await tx.consumptionRule.update({
          where: { id: r.id },
          data: { itemId: keepId, ...(converting ? { qty: q(r.qty) } : {}) },
        });
        continue;
      }
      // Both said how much of this ingredient the dish uses. Take the larger:
      // an under-deduction is invisible until a stock count, an over-deduction
      // shows up immediately and gets corrected.
      if (q(r.qty) > num(clash.qty)) {
        await tx.consumptionRule.update({ where: { id: clash.id }, data: { qty: q(r.qty) } });
      }
      await tx.consumptionRule.delete({ where: { id: r.id } });
    }

    // ── 4. archive the loser, with a note saying where it went ──
    const [lose, keep] = await Promise.all([
      tx.stockItem.findUnique({ where: { id: loseId } }),
      tx.stockItem.findUnique({ where: { id: keepId } }),
    ]);

    await tx.stockItem.update({
      where: { id: loseId },
      data: {
        deletedAt: new Date(),
        active: false,
        // The SKU is released: it is unique, and holding it on an archived row
        // would stop the survivor from ever taking it. It is written into the
        // note first — that code is printed on supplier paperwork, and losing
        // it in a merge means nobody can match a delivery note afterwards.
        sku: null,
        barcode: null,
        supplierCode: null,
        note: [
          lose?.note,
          lose?.sku ? `SKU was ${lose.sku}` : null,
          lose?.barcode ? `barcode was ${lose.barcode}` : null,
          lose?.supplierCode ? `supplier code was ${lose.supplierCode}` : null,
          `Merged into ${keepId} on ${new Date().toISOString().slice(0, 10)}`,
        ]
          .filter(Boolean)
          .join(" · "),
      },
    });

    // If the survivor has no code of its own, it inherits the one that was
    // just freed, so the SKU keeps pointing at the same real ingredient.
    // Identity fields move to the survivor when it has none of its own. A
    // barcode is unique, so it must be cleared on the loser in the same
    // statement — otherwise the index refuses the write and the whole merge
    // rolls back.
    const inherit: Record<string, unknown> = {};
    if (lose?.sku && !keep?.sku) inherit.sku = lose.sku;
    if (lose?.barcode && !keep?.barcode) inherit.barcode = lose.barcode;
    if (lose?.supplierId && !keep?.supplierId) {
      inherit.supplierId = lose.supplierId;
      inherit.supplierCode = lose.supplierCode;
    }
    if (Object.keys(inherit).length > 0) {
      await tx.stockItem.update({ where: { id: keepId }, data: inherit });
    }

    await tx.auditLog.create({
      data: {
        action: "stockItem.merge",
        entityType: "StockItem",
        entityId: keepId,
        employeeId,
        after: {
          merged: loseId,
          movements: plan.moves.movements,
          levels: plan.moves.levels,
          rulesMoved: plan.moves.consumptionRules,
          rulesDropped: plan.moves.consumptionDropped,
        },
      },
    });
  }, { timeout: 120_000, maxWait: 15_000 });

  return plan;
}
