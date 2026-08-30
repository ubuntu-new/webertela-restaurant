"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/admin-auth";
import { logAction } from "@/lib/audit";
import { tr } from "@/lib/admin-i18n";
import { fdNum, fdStr } from "@/lib/admin-utils";
import { ActionError, formAction, isConfirmed } from "@/lib/action-state";
import { guardDuplicate } from "@/lib/dup";
import { nameKey } from "@/lib/name-key";

export const createRecipe = formAction(async (fd: FormData) => {
  const s = await requirePermission("can_edit_menu");
  const t = await tr();

  const nameEn = fdStr(fd, "name_en");
  const outputItemId = fdStr(fd, "outputItemId");
  const outputQty = fdNum(fd, "outputQty");

  if (!nameEn) throw new ActionError(t("The English name is required"), "name_en");
  if (!outputItemId) throw new ActionError(t("Pick what it produces"), "outputItemId");
  if (outputQty === null || outputQty <= 0) throw new ActionError(t("Yield must be greater than zero"), "outputQty");

  await guardDuplicate("recipe", nameEn, { confirmed: isConfirmed(fd), t });

  const r = await db.recipe.create({
    data: {
      name: { en: nameEn, ka: fdStr(fd, "name_ka") || nameEn },
      nameKey: nameKey(nameEn),
      outputItemId,
      outputQty,
      note: fdStr(fd, "note") || null,
      active: true,
    },
  });

  await logAction({
    action: "recipe.create",
    entityType: "Recipe",
    entityId: r.id,
    after: { name: nameEn, outputQty },
    employeeId: s.sub,
  });

  revalidatePath("/admin/stock/recipes");
  redirect(`/admin/stock/recipes/${r.id}`);
}, tr);

export const updateRecipe = formAction(async (fd: FormData, id: string) => {
  const s = await requirePermission("can_edit_menu");
  const t = await tr();

  const nameEn = fdStr(fd, "name_en");
  const outputQty = fdNum(fd, "outputQty");
  if (!nameEn) throw new ActionError(t("The English name is required"), "name_en");
  if (outputQty === null || outputQty <= 0) throw new ActionError(t("Yield must be greater than zero"), "outputQty");

  await guardDuplicate("recipe", nameEn, { excludeId: id, confirmed: isConfirmed(fd), t });

  await db.recipe.update({
    where: { id },
    data: {
      name: { en: nameEn, ka: fdStr(fd, "name_ka") || nameEn },
      nameKey: nameKey(nameEn),
      outputItemId: fdStr(fd, "outputItemId"),
      outputQty,
      note: fdStr(fd, "note") || null,
      active: fd.get("active") === "on",
    },
  });

  // არსებული შემავალები
  const lines = await db.recipeLine.findMany({ where: { recipeId: id } });
  for (const l of lines) {
    if (fd.get(`del_${l.id}`) !== null) {
      await db.recipeLine.delete({ where: { id: l.id } });
      continue;
    }
    const qty = fdNum(fd, `qty_${l.id}`);
    if (qty === null || qty <= 0) continue;
    await db.recipeLine.update({ where: { id: l.id }, data: { qty } });
  }

  // ახალი შემავალი
  const newItem = fdStr(fd, "new_itemId");
  const newQty = fdNum(fd, "new_qty");
  if (newItem && newQty !== null && newQty > 0) {
    await db.recipeLine.upsert({
      where: { recipeId_itemId: { recipeId: id, itemId: newItem } },
      update: { qty: newQty },
      create: { recipeId: id, itemId: newItem, qty: newQty },
    });
  }

  await logAction({
    action: "recipe.update",
    entityType: "Recipe",
    entityId: id,
    after: { name: nameEn, outputQty },
    employeeId: s.sub,
  });

  revalidatePath("/admin/stock/recipes");
  redirect(`/admin/stock/recipes/${id}?saved=1`);
}, tr);

export async function archiveRecipe(id: string) {
  const s = await requirePermission("can_edit_menu");
  await db.recipe.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
  await logAction({ action: "recipe.archive", entityType: "Recipe", entityId: id, employeeId: s.sub });
  revalidatePath("/admin/stock/recipes");
  redirect("/admin/stock/recipes?archived=1");
}
