"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/admin-auth";
import { fdBool, fdNum, fdStr } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";

export async function saveCategories(fd: FormData) {
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
}

export async function createCategory(fd: FormData) {
  const session = await requirePermission("can_edit_menu");
  const t = await tr();
  const nameEn = fdStr(fd, "name_en");
  if (!nameEn) throw new Error(t("The English name is required"));

  const c = await db.category.create({
    data: {
      name: { en: nameEn, ka: fdStr(fd, "name_ka") || nameEn },
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
}

export async function createSubcategory(categoryId: string, fd: FormData) {
  await requirePermission("can_edit_menu");
  const t = await tr();
  const nameEn = fdStr(fd, "sub_name_en");
  if (!nameEn) throw new Error(t("The English name is required"));

  await db.subcategory.create({
    data: {
      categoryId,
      name: { en: nameEn, ka: fdStr(fd, "sub_name_ka") || nameEn },
      active: true,
      sortOrder: 999,
    },
  });

  revalidatePath("/admin/categories");
  redirect("/admin/categories?saved=1");
}

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
