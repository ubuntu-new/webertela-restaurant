"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/admin-auth";
import { logAction } from "@/lib/audit";
import { fdNum, fdStr } from "@/lib/admin-utils";
import { nameKey, nameKeyOfI18n } from "@/lib/name-key";

/**
 * ტოპინგებიდან საწყობის ერთეულების შექმნა.
 *
 * პრემიუმ ტოპინგსაც თავისი ერთეული სჭირდება — პროშუტოს ღირებულება
 * მოცარელადან ვერ გამოითვლება. ეს ღილაკი 24 ცალს ერთდროულად ქმნის.
 *
 * `recipeOnly` ტოპინგები გამოტოვებულია — ისინი დამატებით არ იყიდება.
 */
export async function createItemsFromToppings() {
  const s = await requirePermission("can_edit_menu");

  const [toppings, items] = await Promise.all([
    db.topping.findMany({ where: { deletedAt: null }, select: { id: true, name: true, category: true } }),
    db.stockItem.findMany({ where: { deletedAt: null }, select: { name: true } }),
  ]);

  // This was the only duplicate check in the codebase, and it used its own
  // rule: lower-case the English name. That missed "Mozzarella" against
  // "mozzarella cheese" and against a trailing space, so it could still make a
  // second row for something already on the shelf. It now uses the same
  // normalisation as everything else — one rule, one behaviour.
  const existing = new Set(items.map((i) => nameKeyOfI18n(i.name)).filter(Boolean));

  let made = 0;
  let skipped = 0;

  for (const t of toppings) {
    const n = t.name as Record<string, unknown>;
    const en = String(n?.en ?? "").trim();
    if (!en) continue;

    const key = nameKey(en);
    if (existing.has(key)) {
      skipped++;
      continue;
    }

    await db.stockItem.create({
      data: {
        name: { en, ka: String(n?.ka ?? en) },
        nameKey: key,
        unit: "kg", // ტოპინგები წონით იზომება; ცალობითს ხელით შეცვლი
        category: t.category ?? null,
        active: true,
      },
    });
    // Two toppings can normalise to the same key ("Extra Cheese" twice, in
    // different categories). Without this the second one creates the duplicate
    // this whole function is trying to avoid.
    existing.add(key);
    made++;
  }

  await logAction({
    action: "stockItem.bulkCreate",
    entityType: "StockItem",
    after: { fromToppings: made, skippedAsDuplicates: skipped },
    employeeId: s.sub,
  });

  revalidatePath("/admin/stock/items");
  revalidatePath("/admin/stock/consumption/bulk");
  redirect(`/admin/stock/consumption/bulk?created=${made}`);
}

/**
 * ხარჯვის წესების ჯგუფური შენახვა.
 *
 * ჩაწერ **M-ის** გრამაჟს, S და XL კოეფიციენტით ითვლება. ეს იმიტომ, რომ
 * ტოპინგის ხარჯი ზომაზე პროპორციულია — 72 ველის ხელით შევსება
 * შეცდომების წყარო იქნებოდა.
 */
export async function saveBulkConsumption(fd: FormData) {
  const s = await requirePermission("can_edit_menu");

  const ratioS = fdNum(fd, "ratioS") ?? 0.55;
  const ratioXL = fdNum(fd, "ratioXL") ?? 1.68;
  const toppingIds = fd.getAll("row").map(String);

  let written = 0;
  let cleared = 0;

  for (const toppingId of toppingIds) {
    const itemId = fdStr(fd, `item_${toppingId}`);
    const qtyM = fdNum(fd, `qty_${toppingId}`);

    // ცარიელი = წესი არ გვინდა; არსებული იშლება
    if (!itemId || qtyM === null || qtyM <= 0) {
      const removed = await db.consumptionRule.deleteMany({ where: { toppingId } });
      cleared += removed.count;
      continue;
    }

    // ერთეულის შეცვლისას ძველი ბმა უნდა გაქრეს
    await db.consumptionRule.deleteMany({ where: { toppingId, NOT: { itemId } } });

    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const sizes: [string, number][] = [
      ["S", r3(qtyM * ratioS)],
      ["M", r3(qtyM)],
      ["XL", r3(qtyM * ratioXL)],
    ];

    for (const [sizeKey, qty] of sizes) {
      if (qty <= 0) continue;
      const found = await db.consumptionRule.findFirst({ where: { toppingId, itemId, sizeKey } });
      if (found) {
        await db.consumptionRule.update({ where: { id: found.id }, data: { qty } });
      } else {
        await db.consumptionRule.create({ data: { toppingId, itemId, qty, sizeKey } });
      }
      written++;
    }
  }

  await logAction({
    action: "consumption.bulkToppings",
    entityType: "ConsumptionRule",
    after: { written, cleared, ratioS, ratioXL },
    employeeId: s.sub,
  });

  revalidatePath("/admin/stock/consumption");
  redirect(`/admin/stock/consumption/bulk?saved=${written}`);
}
