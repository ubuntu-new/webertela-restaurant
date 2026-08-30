"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/admin-auth";
import { fdBool, fdNum, fdStr } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { ActionError, formAction, isConfirmed } from "@/lib/action-state";
import { guardDuplicate } from "@/lib/dup";
import { nameKey } from "@/lib/name-key";

export const saveCategories = formAction(async (fd: FormData) => {
  const session = await requirePermission("can_edit_menu");

  const cats = await db.category.findMany({ where: { deletedAt: null }, include: { subcategories: { where: { deletedAt: null } } } });

  for (const c of cats) {
    if (fd.get(`cat_${c.id}_present`) === null) continue;
    const nameEn = fdStr(fd, `cat_${c.id}_name_en`);
    if (!nameEn) continue;
    await db.category.update({
      where: { id: c.id },
      data: {
        name: { en: nameEn, ka: fdStr(fd, `cat_${c.id}_name_ka`) || nameEn },
        nameKey: nameKey(nameEn),
        icon: fdStr(fd, `cat_${c.id}_icon`) || null,
        type: fdStr(fd, `cat_${c.id}_type`) === "merch" ? "merch" : "food",
        active: fdBool(fd, `cat_${c.id}_active`),
        sortOrder: fdNum(fd, `cat_${c.id}_order`) ?? 0,
      },
    });

    for (const s of c.subcategories) {
      if (fd.get(`sub_${s.id}_del`) !== null) {
        // ქვე-კატეგორიაც არქივში გადადის, არ იშლება
        await db.subcategory.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
        continue;
      }
      const sEn = fdStr(fd, `sub_${s.id}_name_en`);
      if (!sEn) continue;
      await db.subcategory.update({
        where: { id: s.id },
        data: {
          name: { en: sEn, ka: fdStr(fd, `sub_${s.id}_name_ka`) || sEn },
          nameKey: nameKey(sEn),
          active: fdBool(fd, `sub_${s.id}_active`),
          sortOrder: fdNum(fd, `sub_${s.id}_order`) ?? 0,
        },
      });
    }
  }

  await db.auditLog.create({
    data: { action: "categories.update", entityType: "Category", employeeId: session.sub },
  });

  revalidatePath("/admin/categories");
  redirect("/admin/categories?saved=1");
}, tr);

export const createCategory = formAction(async (fd: FormData) => {
  const session = await requirePermission("can_edit_menu");
  const t = await tr();
  const nameEn = fdStr(fd, "name_en");
  if (!nameEn) throw new ActionError(t("The English name is required"), "name_en");

  // Two "Drinks" categories is not a costing problem, it is a menu that looks
  // broken to the customer — half the drinks under each.
  await guardDuplicate("category", nameEn, { confirmed: isConfirmed(fd), t });

  const c = await db.category.create({
    data: {
      name: { en: nameEn, ka: fdStr(fd, "name_ka") || nameEn },
      nameKey: nameKey(nameEn),
      icon: fdStr(fd, "icon") || null,
      type: fdStr(fd, "type") === "merch" ? "merch" : "food",
      active: true,
      sortOrder: 999,
    },
  });

  await db.auditLog.create({
    data: { action: "category.create", entityType: "Category", entityId: c.id, employeeId: session.sub },
  });

  revalidatePath("/admin/categories");
  redirect("/admin/categories?saved=1");
}, tr);

export const createSubcategory = formAction(async (fd: FormData, categoryId: string) => {
  await requirePermission("can_edit_menu");
  const t = await tr();
  const nameEn = fdStr(fd, "sub_name_en");
  if (!nameEn) throw new ActionError(t("The English name is required"), "sub_name_en");

  await guardDuplicate("subcategory", nameEn, { confirmed: isConfirmed(fd), t });

  await db.subcategory.create({
    data: {
      categoryId,
      name: { en: nameEn, ka: fdStr(fd, "sub_name_ka") || nameEn },
      nameKey: nameKey(nameEn),
      active: true,
      sortOrder: 999,
    },
  });

  revalidatePath("/admin/categories");
  redirect("/admin/categories?saved=1");
}, tr);

/** არქივში გადატანა — ფიზიკურად არაფერი იშლება. */
export async function archiveCategory(id: string) {
  const session = await requirePermission("can_edit_menu");

  await db.category.update({ where: { id }, data: { deletedAt: new Date() } });

  await db.auditLog.create({
    data: { action: "category.archive", entityType: "Category", entityId: id, employeeId: session.sub },
  });

  revalidatePath("/admin/categories");
  redirect("/admin/categories?archived=1");
}
