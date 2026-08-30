"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/admin-auth";
import { recordMovement, stockCount } from "@/lib/stock";
import { applyReceiptCost, applyOutgoingCost } from "@/lib/costing";
import { fdNum, fdStr } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { ActionError, formAction, isConfirmed } from "@/lib/action-state";
import { guardDuplicate } from "@/lib/dup";
import { nameKey } from "@/lib/name-key";
import { parseGtin } from "@/lib/gtin";
import type { StockUnit } from "@prisma/client";

const UNITS = ["g", "kg", "ml", "l", "pcs", "oz", "lb", "floz", "gal", "each"] as const;
type Unit = (typeof UNITS)[number];
const unitOf = (v: string): Unit => ((UNITS as readonly string[]).includes(v) ? (v as Unit) : "pcs");

/**
 * Read the identity fields shared by create and update.
 *
 * A barcode that fails its own checksum is rejected here rather than stored:
 * the whole value of a GTIN is that it is not typed by a human, and a mistyped
 * one is worse than none — it looks authoritative and identifies the wrong
 * thing, or nothing.
 */
function identityFrom(fd: FormData, t: (s: string) => string) {
  const rawBarcode = fdStr(fd, "barcode");
  let barcode: string | null = null;
  if (rawBarcode) {
    const g = parseGtin(rawBarcode);
    if (!g.ok) throw new ActionError(g.problem ?? t("That barcode is not valid"), "barcode");
    barcode = g.normalized as string;
  }

  const packSize = fdNum(fd, "packSize");
  const packUnitRaw = fdStr(fd, "packUnit");
  const packUnit = packUnitRaw ? unitOf(packUnitRaw) : null;

  if (packSize !== null && packSize <= 0) {
    throw new ActionError(t("A pack size has to be more than zero"), "packSize");
  }
  // Half a record is worse than none: a size with no unit is a number nobody
  // can compare, and it would silently stop the duplicate check from telling
  // two pack sizes apart.
  if (packSize !== null && !packUnit) {
    throw new ActionError(t("Pick the unit the pack is measured in"), "packUnit");
  }

  const supplierId = fdStr(fd, "supplierId") || null;
  const supplierCode = fdStr(fd, "supplierCode") || null;
  if (supplierCode && !supplierId) {
    throw new ActionError(t("Pick the supplier this code belongs to"), "supplierId");
  }

  return {
    barcode,
    packSize,
    packUnit: packUnit as StockUnit | null,
    supplierId,
    supplierCode,
  };
}

// ─────────────────────────────────────────────
// ერთეულები
// ─────────────────────────────────────────────

export const createStockItem = formAction(async (fd: FormData) => {
  const s = await requirePermission("can_edit_menu");
  const t = await tr();

  const nameEn = fdStr(fd, "name_en");
  if (!nameEn) throw new ActionError(t("The English name is required"), "name_en");

  const sku = fdStr(fd, "sku") || null;
  if (sku) {
    const clash = await db.stockItem.findUnique({ where: { sku } });
    if (clash) throw new ActionError(`SKU "${sku}" ${t("is already in use")}`, "sku");
  }

  const identity = identityFrom(fd, t);

  // The one that matters most. A second mozzarella does not look like an error
  // anywhere — it looks like a slightly lower food cost, forever.
  //
  // The identity fields go in with the name, so the check can weigh evidence
  // rather than compare strings: a matching barcode is certain, and a *different*
  // barcode is proof that this is a different product and no warning is due.
  await guardDuplicate(
    "stockItem",
    { name: nameEn, ...identity },
    { confirmed: isConfirmed(fd), t },
  );

  const item = await db.stockItem.create({
    data: {
      name: { en: nameEn, ka: fdStr(fd, "name_ka") || nameEn },
      nameKey: nameKey(nameEn),
      ...identity,
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
}, tr);

export const updateStockItem = formAction(async (fd: FormData, id: string) => {
  const s = await requirePermission("can_edit_menu");
  const t = await tr();

  const nameEn = fdStr(fd, "name_en");
  if (!nameEn) throw new ActionError(t("The English name is required"), "name_en");

  const sku = fdStr(fd, "sku") || null;
  if (sku) {
    const clash = await db.stockItem.findFirst({ where: { sku, NOT: { id } } });
    if (clash) throw new ActionError(`SKU "${sku}" ${t("is already in use")}`, "sku");
  }

  const identity = identityFrom(fd, t);

  // Renaming an item onto an existing one is the same mistake arriving by a
  // different door, so it is asked the same question.
  await guardDuplicate(
    "stockItem",
    { name: nameEn, ...identity },
    { excludeId: id, confirmed: isConfirmed(fd), t },
  );

  await db.stockItem.update({
    where: { id },
    data: {
      name: { en: nameEn, ka: fdStr(fd, "name_ka") || nameEn },
      nameKey: nameKey(nameEn),
      ...identity,
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
}, tr);

export async function archiveStockItem(id: string) {
  const s = await requirePermission("can_edit_menu");

  // The unique indexes on `sku`, `barcode` and (supplierId, supplierCode) are
  // full indexes, not partial — an archived row goes on holding its codes. But
  // findDuplicates only looks at rows where deletedAt is null, so recreating
  // the item afterwards is a dead end: no warning, and then a P2002 with no
  // explanation of which invisible row is holding the code.
  //
  // So archiving releases them, and records them in the note. The merge tool
  // already does exactly this; the two paths out of an item's life should not
  // behave differently.
  const item = await db.stockItem.findUnique({ where: { id } });

  await db.stockItem.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      active: false,
      sku: null,
      barcode: null,
      supplierCode: null,
      note: [
        item?.note,
        item?.sku ? `SKU was ${item.sku}` : null,
        item?.barcode ? `barcode was ${item.barcode}` : null,
        item?.supplierCode ? `supplier code was ${item.supplierCode}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
    },
  });
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
export const addMovement = formAction(async (fd: FormData) => {
  const s = await requirePermission("can_edit_menu");
  const t = await tr();

  const locationId = fdStr(fd, "locationId");
  const itemId = fdStr(fd, "itemId");
  const kind = fdStr(fd, "kind"); // receipt | waste | count
  const amount = fdNum(fd, "qty");

  if (!locationId || !itemId) throw new ActionError(t("Pick a location and an item"));
  // fdNum already turns anything unparseable — "12.5.0", "abc", an empty box —
  // into null, so this one check covers both "you left it blank" and "that is
  // not a number". The field name is what makes the message actionable.
  if (amount === null) throw new ActionError(t("Enter a quantity as a number"), "qty");

  if (kind === "count") {
    if (amount < 0) throw new ActionError(t("A count cannot be negative"), "qty");
    await stockCount(locationId, itemId, amount, s.sub, fdStr(fd, "note") || null);
  } else {
    if (amount <= 0) throw new ActionError(t("Quantity must be greater than zero"), "qty");
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
}, tr);
