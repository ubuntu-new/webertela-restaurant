"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/admin-auth";
import { recordMovements } from "@/lib/stock";
import { logAction } from "@/lib/audit";
import { fdNum, fdStr } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";

/**
 * პარტიის დაწყება.
 *
 * ⚠️ მარაგი აქ **არ იცვლება**. დაწყებული პარტია განზრახვაა, არა ფაქტი —
 * თუ შუა პროცესში გაუქმდა, ჟურნალში ნაგავი არ რჩება. ნედლეული
 * დასრულებისას ჩამოიწერება, ფაქტობრივი რაოდენობით.
 */
export async function startProduction(fd: FormData) {
  const s = await requirePermission("can_transfer_branch");
  const t = await tr();

  const recipeId = fdStr(fd, "recipeId");
  const locationId = fdStr(fd, "locationId");
  const batches = fdNum(fd, "batches");

  if (!recipeId || !locationId) throw new Error(t("Pick a recipe and a location"));
  if (batches === null || batches <= 0) throw new Error(t("Number of runs must be greater than zero"));

  const recipe = await db.recipe.findUnique({ where: { id: recipeId }, include: { lines: true } });
  if (!recipe) throw new Error(t("Recipe not found"));
  if (recipe.lines.length === 0) throw new Error(t("This recipe has no ingredients"));

  const plannedQty = Number(recipe.outputQty) * batches;

  const order = await db.productionOrder.create({
    data: {
      recipeId,
      locationId,
      batches,
      plannedQty,
      status: "in_progress",
      note: fdStr(fd, "note") || null,
      startedById: s.sub,
      // ნედლეულის ასლი — რეცეპტის მერე შეცვლა ამ პარტიას აღარ ეხება
      lines: {
        create: recipe.lines.map((l) => ({
          itemId: l.itemId,
          qtyPlanned: Number(l.qty) * batches,
        })),
      },
    },
  });

  await logAction({
    action: "production.started",
    entityType: "ProductionOrder",
    entityId: order.id,
    after: { no: order.no, batches, plannedQty },
    employeeId: s.sub,
  });

  revalidatePath("/admin/stock/production");
  redirect(`/admin/stock/production/${order.id}`);
}

/**
 * დასრულება — აქ ხდება მთელი მოძრაობა.
 *   ნედლეული  → production_out (ფაქტობრივად დახარჯული)
 *   პროდუქტი  → production_in  (ფაქტობრივად გამოსული)
 */
export async function finishProduction(id: string, fd: FormData) {
  const s = await requirePermission("can_transfer_branch");
  const t = await tr();

  const order = await db.productionOrder.findUnique({
    where: { id },
    include: { lines: true, recipe: true },
  });
  if (!order) throw new Error(t("Batch not found"));
  if (order.status !== "in_progress") throw new Error(t("This batch is already closed"));

  const actualQty = fdNum(fd, "actualQty");
  if (actualQty === null || actualQty < 0) throw new Error(t("Enter the actual output"));

  const moves = [];
  const usedLog: Record<string, number> = {};

  for (const l of order.lines) {
    const planned = Number(l.qtyPlanned);
    const q = fdNum(fd, `used_${l.id}`);
    const used = q === null ? planned : q;
    if (used < 0) throw new Error(t("Used amount cannot be negative"));

    await db.productionLine.update({ where: { id: l.id }, data: { qtyUsed: used } });
    if (used === 0) continue;

    usedLog[l.itemId] = used;
    moves.push({
      locationId: order.locationId,
      itemId: l.itemId,
      type: "production_out" as const,
      qty: -used,
      refType: "ProductionOrder",
      refId: id,
      note: `${t("Production")} #${order.no}`,
      employeeId: s.sub,
    });
  }

  if (actualQty > 0) {
    moves.push({
      locationId: order.locationId,
      itemId: order.recipe.outputItemId,
      type: "production_in" as const,
      qty: actualQty,
      refType: "ProductionOrder",
      refId: id,
      note: `${t("Production")} #${order.no}`,
      employeeId: s.sub,
    });
  }

  if (moves.length > 0) await recordMovements(moves);

  await db.productionOrder.update({
    where: { id },
    data: { status: "done", actualQty, finishedById: s.sub, finishedAt: new Date() },
  });

  const planned = Number(order.plannedQty);
  const yieldPct = planned > 0 ? Math.round((actualQty / planned) * 1000) / 10 : null;

  await logAction({
    action: "production.finished",
    entityType: "ProductionOrder",
    entityId: id,
    after: { no: order.no, planned, actual: actualQty, yield: yieldPct ? `${yieldPct}%` : null, used: usedLog },
    employeeId: s.sub,
  });

  revalidatePath("/admin/stock");
  revalidatePath("/admin/stock/production");
  redirect(`/admin/stock/production/${id}?ok=1`);
}

export async function cancelProduction(id: string) {
  const s = await requirePermission("can_transfer_branch");
  const t = await tr();

  const order = await db.productionOrder.findUnique({ where: { id } });
  if (!order) throw new Error(t("Batch not found"));
  if (order.status !== "in_progress") throw new Error(t("This batch is already closed"));

  // მარაგი ჯერ არ შეცვლილა — დასაბრუნებელი არაფერია
  await db.productionOrder.update({
    where: { id },
    data: { status: "cancelled", cancelledById: s.sub, cancelledAt: new Date() },
  });

  await logAction({
    action: "production.cancelled",
    entityType: "ProductionOrder",
    entityId: id,
    after: { no: order.no },
    employeeId: s.sub,
  });

  revalidatePath("/admin/stock/production");
  redirect(`/admin/stock/production/${id}?ok=1`);
}
