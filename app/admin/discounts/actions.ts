"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/admin-auth";
import { fdBool, fdNum, fdStr } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";

const TYPES = ["student", "diplomatic", "employee", "loyalty", "promo", "custom"] as const;
type DType = (typeof TYPES)[number];

function typeOf(v: string): DType {
  return (TYPES as readonly string[]).includes(v) ? (v as DType) : "custom";
}

export async function createDiscount(fd: FormData) {
  const session = await requirePermission("can_discount");
  const t = await tr();

  const nameEn = fdStr(fd, "name_en");
  if (!nameEn) throw new Error(t("The English name is required"));

  const d = await db.discount.create({
    data: {
      name: { en: nameEn, ka: fdStr(fd, "name_ka") || nameEn },
      type: typeOf(fdStr(fd, "type")),
      defaultMode: fdStr(fd, "defaultMode") === "fixed" ? "fixed" : "percent",
      defaultValue: fdNum(fd, "defaultValue") ?? 0,
      requiresVerification: fdBool(fd, "requiresVerification"),
      active: false,
    },
  });

  await db.auditLog.create({
    data: { action: "discount.create", entityType: "Discount", entityId: d.id, employeeId: session.sub },
  });

  revalidatePath("/admin/discounts");
  redirect(`/admin/discounts/${d.id}`);
}

export async function updateDiscount(id: string, fd: FormData) {
  const session = await requirePermission("can_discount");
  const t = await tr();

  const nameEn = fdStr(fd, "name_en");
  if (!nameEn) throw new Error(t("The English name is required"));

  const validFrom = fdStr(fd, "validFrom");
  const validTo = fdStr(fd, "validTo");

  await db.discount.update({
    where: { id },
    data: {
      name: { en: nameEn, ka: fdStr(fd, "name_ka") || nameEn },
      type: typeOf(fdStr(fd, "type")),
      defaultMode: fdStr(fd, "defaultMode") === "fixed" ? "fixed" : "percent",
      defaultValue: fdNum(fd, "defaultValue") ?? 0,
      requiresVerification: fdBool(fd, "requiresVerification"),
      usageLimit: fdNum(fd, "usageLimit"),
      validFrom: validFrom ? new Date(validFrom) : null,
      validTo: validTo ? new Date(validTo) : null,
      active: fdBool(fd, "active"),
    },
  });

  // ── არსებული წესები: რედაქტირება / წაშლა ──
  const rules = await db.discountRule.findMany({ where: { discountId: id } });
  for (const r of rules) {
    if (fd.get(`rule_${r.id}_del`) !== null) {
      await db.discountRule.delete({ where: { id: r.id } });
      continue;
    }
    const value = fdNum(fd, `rule_${r.id}_value`);
    if (value === null) continue;
    await db.discountRule.update({
      where: { id: r.id },
      data: { mode: fdStr(fd, `rule_${r.id}_mode`) === "fixed" ? "fixed" : "percent", value },
    });
  }

  // ── ახალი წესი ──
  const target = fdStr(fd, "newrule_target"); // "cat:<id>" | "sub:<id>" | "prod:<id>"
  const newValue = fdNum(fd, "newrule_value");
  if (target && newValue !== null) {
    const [kind, targetId] = target.split(":");
    await db.discountRule.create({
      data: {
        discountId: id,
        targetCategoryId: kind === "cat" ? targetId : null,
        targetSubcategoryId: kind === "sub" ? targetId : null,
        targetProductId: kind === "prod" ? targetId : null,
        mode: fdStr(fd, "newrule_mode") === "fixed" ? "fixed" : "percent",
        value: newValue,
      },
    });
  }

  await db.auditLog.create({
    data: { action: "discount.update", entityType: "Discount", entityId: id, employeeId: session.sub },
  });

  revalidatePath("/admin/discounts");
  redirect("/admin/discounts?saved=1");
}

export async function archiveDiscount(id: string) {
  const session = await requirePermission("can_discount");

  await db.discount.update({ where: { id }, data: { deletedAt: new Date(), active: false } });

  await db.auditLog.create({
    data: { action: "discount.archive", entityType: "Discount", entityId: id, employeeId: session.sub },
  });

  revalidatePath("/admin/discounts");
  redirect("/admin/discounts?archived=1");
}
