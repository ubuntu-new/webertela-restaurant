"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/admin-auth";
import { fdBool, fdNum, fdStr } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { ActionError, formAction, isConfirmed } from "@/lib/action-state";
import { guardDuplicate } from "@/lib/dup";
import { nameKey } from "@/lib/name-key";

/** სიის გვერდიდან — ყველა ტოპინგის ფასი/სტატუსი ერთი შენახვით. */
export const saveToppingPrices = formAction(async (fd: FormData) => {
  const session = await requirePermission("can_edit_menu");
  const toppings = await db.topping.findMany({ where: { deletedAt: null }, include: { prices: true } });

  for (const t of toppings) {
    if (fd.get(`present_${t.id}`) !== null) {
      await db.topping.update({
        where: { id: t.id },
        data: { active: fdBool(fd, `active_${t.id}`) },
      });
    }
    for (const p of t.prices) {
      const v = fdNum(fd, `price_${t.id}_${p.sizeKey}`);
      if (v !== null) await db.toppingPrice.update({ where: { id: p.id }, data: { price: v } });
    }
  }

  await db.auditLog.create({
    data: { action: "toppings.bulkUpdate", entityType: "Topping", employeeId: session.sub },
  });

  revalidatePath("/admin/toppings");
  redirect("/admin/toppings?saved=1");
}, tr);

/** ახალი ტოპინგი — სამი ზომის ფასით. */
export const createTopping = formAction(async (fd: FormData) => {
  const session = await requirePermission("can_edit_menu");
  const t = await tr();

  const nameEn = fdStr(fd, "name_en");
  if (!nameEn) throw new ActionError(t("The English name is required"), "name_en");

  // A duplicated topping duplicates its consumption rule with it, so the same
  // cheese gets deducted twice or not at all depending on which one the
  // product points at.
  await guardDuplicate("topping", nameEn, { confirmed: isConfirmed(fd), t });

  const topping = await db.topping.create({
    data: {
      name: { en: nameEn, ka: fdStr(fd, "name_ka") || nameEn },
      nameKey: nameKey(nameEn),
      category: fdStr(fd, "category") || null,
      recipeOnly: fdBool(fd, "recipeOnly"),
      active: true,
      sortOrder: 999,
    },
  });

  await db.toppingPrice.createMany({
    data: ["S", "M", "XL"].map((sizeKey) => ({
      toppingId: topping.id,
      sizeKey,
      price: fdNum(fd, `price_${sizeKey}`) ?? 0,
    })),
  });

  await db.auditLog.create({
    data: { action: "topping.create", entityType: "Topping", entityId: topping.id, employeeId: session.sub },
  });

  revalidatePath("/admin/toppings");
  redirect(`/admin/toppings/${topping.id}`);
}, tr);

/** ერთი ტოპინგის სრული რედაქტირება. */
export const updateTopping = formAction(async (fd: FormData, id: string) => {
  const session = await requirePermission("can_edit_menu");
  const t = await tr();

  const nameEn = fdStr(fd, "name_en");
  if (!nameEn) throw new ActionError(t("The English name is required"), "name_en");

  await guardDuplicate("topping", nameEn, { excludeId: id, confirmed: isConfirmed(fd), t });

  await db.topping.update({
    where: { id },
    data: {
      nameKey: nameKey(nameEn),
      name: { en: nameEn, ka: fdStr(fd, "name_ka") || nameEn },
      category: fdStr(fd, "category") || null,
      emoji: fdStr(fd, "emoji") || null,
      dots: fdStr(fd, "dots").split(",").map((x) => x.trim()).filter(Boolean),
      popular: fdBool(fd, "popular"),
      photo: fdStr(fd, "photo") || null,
      recipeOnly: fdBool(fd, "recipeOnly"),
      active: fdBool(fd, "active"),
      sortOrder: fdNum(fd, "sortOrder") ?? 0,
    },
  });

  const prices = await db.toppingPrice.findMany({ where: { toppingId: id } });
  for (const p of prices) {
    const v = fdNum(fd, `price_${p.sizeKey}`);
    if (v !== null) await db.toppingPrice.update({ where: { id: p.id }, data: { price: v } });
  }

  const newKey = fdStr(fd, "newsize_key");
  if (newKey) {
    await db.toppingPrice.upsert({
      where: { toppingId_sizeKey: { toppingId: id, sizeKey: newKey } },
      update: { price: fdNum(fd, "newsize_price") ?? 0 },
      create: { toppingId: id, sizeKey: newKey, price: fdNum(fd, "newsize_price") ?? 0 },
    });
  }

  await db.auditLog.create({
    data: { action: "topping.update", entityType: "Topping", entityId: id, employeeId: session.sub },
  });

  revalidatePath("/admin/toppings");
  redirect("/admin/toppings?saved=1");
}, tr);

/** არქივში გადატანა — ფიზიკურად არაფერი იშლება. */
export async function archiveTopping(id: string) {
  const session = await requirePermission("can_edit_menu");

  await db.topping.update({ where: { id }, data: { deletedAt: new Date() } });

  await db.auditLog.create({
    data: { action: "topping.archive", entityType: "Topping", entityId: id, employeeId: session.sub },
  });

  revalidatePath("/admin/toppings");
  revalidatePath("/", "layout");
  redirect("/admin/toppings?archived=1");
}
