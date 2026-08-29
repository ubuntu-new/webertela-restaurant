"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/admin-auth";
import { tr } from "@/lib/admin-i18n";
import { fdNum, fdStr } from "@/lib/admin-utils";

/** ახალი წესი — ან პროდუქტზე, ან ტოპინგზე. */
export async function addRule(fd: FormData) {
  const s = await requirePermission("can_edit_menu");
  const t = await tr();

  const owner = fdStr(fd, "owner"); // "product:<id>" | "topping:<id>"
  const itemId = fdStr(fd, "itemId");
  const qty = fdNum(fd, "qty");
  const sizeKey = fdStr(fd, "sizeKey") || null;

  if (!owner || !itemId) throw new Error(t("Pick a menu item and a stock item"));
  if (qty === null || qty <= 0) throw new Error(t("Quantity must be greater than zero"));

  const [kind, id] = owner.split(":");
  const productId = kind === "product" ? id : null;
  const toppingId = kind === "topping" ? id : null;

  const existing = await db.consumptionRule.findFirst({
    where: { productId, toppingId, itemId, sizeKey },
  });
  if (existing) {
    await db.consumptionRule.update({ where: { id: existing.id }, data: { qty } });
  } else {
    await db.consumptionRule.create({
      data: { productId, toppingId, itemId, qty, sizeKey, note: fdStr(fd, "note") || null },
    });
  }

  await db.auditLog.create({
    data: { action: "consumption.upsert", entityType: "ConsumptionRule", employeeId: s.sub },
  });

  revalidatePath("/admin/stock/consumption");
  redirect(`/admin/stock/consumption?saved=1&owner=${encodeURIComponent(owner)}`);
}

/** არსებულების რედაქტირება/წაშლა — ერთი შენახვით. */
export async function saveRules(fd: FormData) {
  const s = await requirePermission("can_edit_menu");

  const ids = fd.getAll("rule").map(String);
  let changed = 0;

  for (const id of ids) {
    if (fd.get(`del_${id}`) !== null) {
      await db.consumptionRule.delete({ where: { id } });
      changed++;
      continue;
    }
    const qty = fdNum(fd, `qty_${id}`);
    if (qty === null || qty <= 0) continue;
    await db.consumptionRule.update({ where: { id }, data: { qty } });
    changed++;
  }

  if (changed > 0) {
    await db.auditLog.create({
      data: { action: "consumption.bulkUpdate", entityType: "ConsumptionRule", employeeId: s.sub },
    });
  }

  revalidatePath("/admin/stock/consumption");
  redirect(`/admin/stock/consumption?saved=${changed}`);
}
