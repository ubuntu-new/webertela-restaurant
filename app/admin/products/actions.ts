"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/admin-auth";
import { fdBool, fdNum, fdStr } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";

const TYPES = ["pizza", "item", "sticks", "drink", "merch"] as const;
type ProductType = (typeof TYPES)[number];

function typeOf(v: string): ProductType {
  return (TYPES as readonly string[]).includes(v) ? (v as ProductType) : "item";
}

/** ახალი პროდუქტი — მინიმალური ველებით, მერე რედაქტირებაზე გადადის. */
export async function createProduct(fd: FormData) {
  const session = await requirePermission("can_edit_menu");
  const t = await tr();

  const nameEn = fdStr(fd, "name_en");
  const categoryId = fdStr(fd, "categoryId");
  if (!nameEn) throw new Error(t("The English name is required"));
  if (!categoryId) throw new Error(t("Pick a category"));

  const type = typeOf(fdStr(fd, "type"));

  const product = await db.product.create({
    data: {
      name: { en: nameEn, ka: fdStr(fd, "name_ka") || nameEn },
      description: { en: "", ka: "" },
      categoryId,
      type,
      price: type === "pizza" ? null : (fdNum(fd, "price") ?? 0),
      active: false, // ახალი პროდუქტი გამორთულია სანამ არ შეავსებ
      sortOrder: 999,
      updatedBy: session.sub,
    },
  });

  // პიცას სამი ზომა ავტომატურად
  if (type === "pizza") {
    const defaults = [
      { key: "S", cm: 20, price: 0, sortOrder: 0 },
      { key: "M", cm: 30, price: 0, sortOrder: 1 },
      { key: "XL", cm: 45, price: 0, sortOrder: 2 },
    ];
    await db.productSize.createMany({
      data: defaults.map((d) => ({ ...d, productId: product.id })),
    });
  }

  await db.auditLog.create({
    data: { action: "product.create", entityType: "Product", entityId: product.id, employeeId: session.sub },
  });

  revalidatePath("/admin/products");
  redirect(`/admin/products/${product.id}`);
}

/** სრული რედაქტირება. */
export async function updateProductFull(id: string, fd: FormData) {
  const session = await requirePermission("can_edit_menu");
  const t = await tr();

  const nameEn = fdStr(fd, "name_en");
  if (!nameEn) throw new Error(t("The English name is required"));

  const badgeEn = fdStr(fd, "badge_en");
  const subcategoryId = fdStr(fd, "subcategoryId");

  // ფილიალები — ახლა BranchProduct-ში (მასივი აღარ გამოიყენება)
  const allBranches = await db.branch.findMany({ where: { deletedAt: null }, select: { id: true } });
  const availableIn = new Set(fd.getAll("availableIn").map(String));

  const gallery = fdStr(fd, "gallery")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const allergens = fdStr(fd, "allergens")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const hasNutrition =
    fdNum(fd, "calories") !== null ||
    fdNum(fd, "protein") !== null ||
    fdNum(fd, "carbs") !== null ||
    fdNum(fd, "fat") !== null ||
    allergens.length > 0;

  await db.product.update({
    where: { id },
    data: {
      name: { en: nameEn, ka: fdStr(fd, "name_ka") || nameEn },
      description: { en: fdStr(fd, "desc_en"), ka: fdStr(fd, "desc_ka") || fdStr(fd, "desc_en") },
      badge: badgeEn ? { en: badgeEn, ka: fdStr(fd, "badge_ka") || badgeEn } : undefined,
      categoryId: fdStr(fd, "categoryId"),
      subcategoryId: subcategoryId || null,
      type: typeOf(fdStr(fd, "type")),
      photo: fdStr(fd, "photo") || null,
      emoji: fdStr(fd, "emoji") || null,
      builder: fdStr(fd, "builder") || null,
      isBYO: fdBool(fd, "isBYO"),
      gallery,
      nutrition: hasNutrition
        ? {
            calories: fdNum(fd, "calories"),
            protein: fdNum(fd, "protein"),
            carbs: fdNum(fd, "carbs"),
            fat: fdNum(fd, "fat"),
            allergens,
          }
        : undefined,
      price: fdNum(fd, "price"),
      tier: fdStr(fd, "tier") || null,
      sortOrder: fdNum(fd, "sortOrder") ?? 0,
      active: fdBool(fd, "active"),
      discountable: fdBool(fd, "discountable"),
      updatedBy: session.sub,
    },
  });

  // ── ზომები: არსებულის რედაქტირება/წაშლა + ახლის დამატება ──
  const sizes = await db.productSize.findMany({ where: { productId: id } });
  for (const s of sizes) {
    if (fd.get(`size_${s.id}_del`) !== null) {
      await db.productSize.delete({ where: { id: s.id } });
      continue;
    }
    const key = fdStr(fd, `size_${s.id}_key`);
    if (!key) continue;
    await db.productSize.update({
      where: { id: s.id },
      data: {
        key,
        cm: fdNum(fd, `size_${s.id}_cm`),
        price: fdNum(fd, `size_${s.id}_price`) ?? 0,
        sortOrder: fdNum(fd, `size_${s.id}_order`) ?? 0,
      },
    });
  }

  const newKey = fdStr(fd, "newsize_key");
  if (newKey) {
    await db.productSize.upsert({
      where: { productId_key: { productId: id, key: newKey } },
      update: { cm: fdNum(fd, "newsize_cm"), price: fdNum(fd, "newsize_price") ?? 0 },
      create: {
        productId: id,
        key: newKey,
        cm: fdNum(fd, "newsize_cm"),
        price: fdNum(fd, "newsize_price") ?? 0,
        sortOrder: sizes.length,
      },
    });
  }

  // ── ფილიალებში ხელმისაწვდომობა ──
  if (fd.get("branches_present") !== null) {
    for (const b of allBranches) {
      const available = availableIn.has(b.id);
      const existing = await db.branchProduct.findUnique({
        where: { branchId_productId: { branchId: b.id, productId: id } },
      });
      if (!existing) {
        if (available) continue; // ჩანაწერის არარსებობა = ხელმისაწვდომია
        await db.branchProduct.create({
          data: { branchId: b.id, productId: id, available: false, updatedBy: session.sub },
        });
        continue;
      }
      if (existing.available !== available) {
        await db.branchProduct.update({
          where: { id: existing.id },
          data: { available, updatedBy: session.sub },
        });
      }
    }
  }

  // ── ნაგულისხმევი ინგრედიენტები ──
  if (fd.get("ings_present") !== null) {
    const picked = fd.getAll("ing").map(String);
    await db.productTopping.deleteMany({
      where: { productId: id, toppingId: { notIn: picked.length ? picked : ["__none__"] } },
    });
    for (const [i, toppingId] of picked.entries()) {
      await db.productTopping.upsert({
        where: { productId_toppingId: { productId: id, toppingId } },
        update: { sortOrder: i },
        create: { productId: id, toppingId, sortOrder: i },
      });
    }
  }

  // ── აქცია ──
  const promoActive = fdBool(fd, "promo_active");
  const promoValue = fdNum(fd, "promo_value");
  const promoMode = fdStr(fd, "promo_mode") === "fixed" ? "fixed" : "percent";
  const promoSizes = fd.getAll("promo_size").map(String);

  if (promoActive && promoValue !== null) {
    const label = `-${promoValue}${promoMode === "fixed" ? "₾" : "%"}`;
    const base = {
      active: true,
      mode: promoMode as "percent" | "fixed",
      value: promoValue,
      sizes: promoSizes,
      label: { en: label, ka: label },
    };
    await db.productPromo.upsert({
      where: { productId: id },
      update: base,
      create: { productId: id, ...base },
    });
  } else {
    await db.productPromo.updateMany({ where: { productId: id }, data: { active: false } });
  }

  await db.auditLog.create({
    data: { action: "product.update", entityType: "Product", entityId: id, employeeId: session.sub },
  });

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${id}`);
  revalidatePath("/", "layout"); // საიტის მენიუ მაშინვე განახლდეს
  redirect("/admin/products?saved=1");
}

/** არქივში გადატანა — ფიზიკურად არაფერი იშლება, `active` უცვლელი რჩება. */
export async function archiveProduct(id: string) {
  const session = await requirePermission("can_edit_menu");

  await db.product.update({ where: { id }, data: { deletedAt: new Date() } });

  await db.auditLog.create({
    data: { action: "product.archive", entityType: "Product", entityId: id, employeeId: session.sub },
  });

  revalidatePath("/admin/products");
  revalidatePath("/", "layout");
  redirect("/admin/products?archived=1");
}
