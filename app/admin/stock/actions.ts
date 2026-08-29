"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/admin-auth";
import { recordMovement, stockCount } from "@/lib/stock";
import { applyReceiptCost, applyOutgoingCost } from "@/lib/costing";
import { fdNum, fdStr } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";

const UNITS = ["g", "kg", "ml", "l", "pcs"] as const;
type Unit = (typeof UNITS)[number];
const unitOf = (v: string): Unit => ((UNITS as readonly string[]).includes(v) ? (v as Unit) : "pcs");

// ─────────────────────────────────────────────
// ერთეულები
// ─────────────────────────────────────────────

export async function createStockItem(fd: FormData) {
  const s = await requirePermission("can_edit_menu");
  const t = await tr();

  const nameEn = fdStr(fd, "name_en");
  if (!nameEn) throw new Error(t("The English name is required"));

  const sku = fdStr(fd, "sku") || null;
  if (sku) {
    const clash = await db.stockItem.findUnique({ where: { sku } });
    if (clash) throw new Error(`SKU "${sku}" ${t("is already in use")}`);
  }

  const item = await db.stockItem.create({
    data: {
      name: { en: nameEn, ka: fdStr(fd, "name_ka") || nameEn },
      sku,
      unit: unitOf(fdStr(fd, "unit")),
      category: fdStr(fd, "category") || null,
      isProduced: fd.get("isProduced") === "on",
      note: fdStr(fd, "note") || null,
      active: true,
    },
  });

  await db.auditLog.create({
    data: { action: "stockItem.create", entityType: "StockItem", entityId: item.id, employeeId: s.sub },
  });

  revalidatePath("/admin/stock/items");
  redirect(`/admin/stock/items/${item.id}`);
}

export async function updateStockItem(id: string, fd: FormData) {
  const s = await requirePermission("can_edit_menu");
  const t = await tr();

  const nameEn = fdStr(fd, "name_en");
  if (!nameEn) throw new Error(t("The English name is required"));

  const sku = fdStr(fd, "sku") || null;
  if (sku) {
    const clash = await db.stockItem.findFirst({ where: { sku, NOT: { id } } });
    if (clash) throw new Error(`SKU "${sku}" ${t("is already in use")}`);
  }

  await db.stockItem.update({
    where: { id },
    data: {
      name: { en: nameEn, ka: fdStr(fd, "name_ka") || nameEn },
      sku,
      unit: unitOf(fdStr(fd, "unit")),
      category: fdStr(fd, "category") || null,
      isProduced: fd.get("isProduced") === "on",
      note: fdStr(fd, "note") || null,
      active: fd.get("active") === "on",
    },
  });

  // მინიმუმი/სამიზნე თითო ლოკაციაზე.
  // სტრიქონი შეიძლება ჯერ არ არსებობდეს — ნულოვანი ნაშთით ვქმნით.
  // ეს ჟურნალს არ ეწინააღმდეგება: ცარიელი მოძრაობების ჯამი ისედაც ნულია.
  const locations = await db.stockLocation.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });

  for (const loc of locations) {
    const min = fdNum(fd, `min_${loc.id}`);
    const target = fdNum(fd, `target_${loc.id}`);

    const existing = await db.stockLevel.findUnique({
      where: { locationId_itemId: { locationId: loc.id, itemId: id } },
      select: { id: true },
    });

    if (existing) {
      await db.stockLevel.update({
        where: { id: existing.id },
        data: { minLevel: min, targetLevel: target },
      });
      continue;
    }

    // ცარიელ ველებზე ზედმეტ სტრიქონს არ ვქმნით
    if (min === null && target === null) continue;

    await db.stockLevel.create({
      data: { locationId: loc.id, itemId: id, qty: 0, minLevel: min, targetLevel: target },
    });
  }

  await db.auditLog.create({
    data: { action: "stockItem.update", entityType: "StockItem", entityId: id, employeeId: s.sub },
  });

  revalidatePath("/admin/stock");
  revalidatePath(`/admin/stock/items/${id}`);
  redirect("/admin/stock/items?saved=1");
}

export async function archiveStockItem(id: string) {
  const s = await requirePermission("can_edit_menu");
  await db.stockItem.update({ where: { id }, data: { deletedAt: new Date() } });
  await db.auditLog.create({
    data: { action: "stockItem.archive", entityType: "StockItem", entityId: id, employeeId: s.sub },
  });
  revalidatePath("/admin/stock/items");
  redirect("/admin/stock/items?archived=1");
}

// ─────────────────────────────────────────────
// მოძრაობები
// ─────────────────────────────────────────────

/** მიღება / ჩამოწერა — ხელით. */
export async function addMovement(fd: FormData) {
  const s = await requirePermission("can_edit_menu");
  const t = await tr();

  const locationId = fdStr(fd, "locationId");
  const itemId = fdStr(fd, "itemId");
  const kind = fdStr(fd, "kind"); // receipt | waste | count
  const amount = fdNum(fd, "qty");

  if (!locationId || !itemId) throw new Error(t("Pick a location and an item"));
  if (amount === null) throw new Error(t("Enter a quantity"));

  if (kind === "count") {
    if (amount < 0) throw new Error(t("A count cannot be negative"));
    await stockCount(locationId, itemId, amount, s.sub, fdStr(fd, "note") || null);
  } else {
    if (amount <= 0) throw new Error(t("Quantity must be greater than zero"));
    // ჩამოწერა ყოველთვის მინუსია — ნიშანს მომხმარებელს არ ვაწერინებთ
    const mv = await recordMovement({
      locationId,
      itemId,
      type: kind === "waste" ? "waste" : "receipt",
      qty: kind === "waste" ? -amount : amount,
      note: fdStr(fd, "note") || null,
      employeeId: s.sub,
    });

    // ── თვითღირებულება ──
    if (kind === "waste") {
      // ჩამოწერა მიმდინარე საშუალოთი ფასდება; საშუალო არ იცვლება
      await applyOutgoingCost(locationId, itemId, amount, mv.id);
    } else {
      const unitCost = fdNum(fd, "unitCost");
      if (unitCost !== null && unitCost > 0) {
        await applyReceiptCost(locationId, itemId, amount, unitCost, mv.id);
      }
    }
  }

  revalidatePath("/admin/stock");
  revalidatePath("/admin/stock/movements");
  redirect(`/admin/stock?loc=${locationId}&saved=1`);
}
