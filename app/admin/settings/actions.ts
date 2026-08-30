"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { clearLangCache, tr } from "@/lib/admin-i18n";
import { getSession } from "@/lib/admin-auth";
import { requirePermission } from "@/lib/admin-auth";
import { fdBool, fdNum, fdStr } from "@/lib/admin-utils";
import { ActionError, formAction } from "@/lib/action-state";

async function put(key: string, value: object, employeeId: string) {
  await db.setting.upsert({
    where: { key },
    update: { value, updatedBy: employeeId },
    create: { key, value, updatedBy: employeeId },
  });
  await db.auditLog.create({
    data: { action: "setting.update", entityType: "Setting", entityId: key, employeeId },
  });
  revalidatePath("/admin/settings");
}

export const saveOrderSettings = formAction(async (fd: FormData) => {
  const s = await requirePermission("can_edit_menu");
  await put(
    "order",
    {
      minOrder: fdNum(fd, "minOrder") ?? 0,
      deliveryFee: fdNum(fd, "deliveryFee") ?? 0,
      freeDeliveryThreshold: fdNum(fd, "freeDeliveryThreshold") ?? 0,
      maxToppings: fdNum(fd, "maxToppings") ?? 6,
      currency: fdStr(fd, "currency") || "GEL",
    },
    s.sub,
  );
  redirect("/admin/settings?saved=order");
}, tr);

export const saveLoyaltySettings = formAction(async (fd: FormData) => {
  const s = await requirePermission("can_discount");
  await put(
    "loyalty",
    {
      enabled: fdBool(fd, "enabled"),
      pointsPerGel: fdNum(fd, "pointsPerGel") ?? 1,
      redeemRate: fdNum(fd, "redeemRate") ?? 0.1,
      minRedeem: fdNum(fd, "minRedeem") ?? 100,
    },
    s.sub,
  );
  redirect("/admin/settings?saved=loyalty");
}, tr);

export const saveEmployeeDiscount = formAction(async (fd: FormData) => {
  const s = await requirePermission("can_discount");
  await put(
    "employeeDiscount",
    {
      enabled: fdBool(fd, "enabled"),
      value: fdNum(fd, "value") ?? 0,
      mode: fdStr(fd, "mode") === "fixed" ? "fixed" : "percent",
      appliesEverywhere: fdBool(fd, "appliesEverywhere"),
    },
    s.sub,
  );
  redirect("/admin/settings?saved=employeeDiscount");
}, tr);

export const saveDiscountRules = formAction(async (fd: FormData) => {
  const s = await requirePermission("can_discount");
  await put(
    "discountRules",
    {
      stackable: fdBool(fd, "stackable"),
      excludeCombos: fdBool(fd, "excludeCombos"),
      excludePromoProducts: fdBool(fd, "excludePromoProducts"),
    },
    s.sub,
  );
  await put("discountVerification", { mode: fdStr(fd, "verification") || "manual" }, s.sub);
  redirect("/admin/settings?saved=discountRules");
}, tr);

export const saveTax = formAction(async (fd: FormData) => {
  const s = await requirePermission("can_edit_menu");
  await put("tax", { rate: fdNum(fd, "rate") ?? 0, inclusive: fdBool(fd, "inclusive") }, s.sub);
  redirect("/admin/settings?saved=tax");
}, tr);

export const saveSocial = formAction(async (fd: FormData) => {
  const s = await requirePermission("can_edit_menu");

  const current = await db.setting.findUnique({ where: { key: "social" } });
  const list = Array.isArray(current?.value) ? (current!.value as Array<Record<string, unknown>>) : [];

  const next = list.map((item) => {
    const id = String(item.id);
    return {
      id,
      label: String(item.label ?? id),
      href: fdStr(fd, `href_${id}`),
      enabled: fdBool(fd, `enabled_${id}`),
    };
  });

  await put("social", next as unknown as object, s.sub);
  redirect("/admin/settings?saved=social");
}, tr);

export const saveTelegram = formAction(async (fd: FormData) => {
  const s = await requirePermission("can_edit_menu");
  await put(
    "telegram",
    {
      enabled: fdBool(fd, "enabled"),
      chatId: fdStr(fd, "chatId"),
      events: {
        order: fdBool(fd, "ev_order"),
        transferRequest: fdBool(fd, "ev_transferRequest"),
        transferSent: fdBool(fd, "ev_transferSent"),
        lowStock: fdBool(fd, "ev_lowStock"),
      },
    },
    s.sub,
  );
  redirect("/admin/settings?saved=telegram");
}, tr);

export const saveFixedCosts = formAction(async (fd: FormData) => {
  const s = await requirePermission("can_view_reports");
  await put(
    "fixedCosts",
    {
      rent: fdNum(fd, "rent") ?? 0,
      utilities: fdNum(fd, "utilities") ?? 0,
      other: fdNum(fd, "other") ?? 0,
    },
    s.sub,
  );
  redirect("/admin/settings?saved=fixedCosts");
}, tr);

/** ინტერფეისის ენა — მხოლოდ super_admin ცვლის. */
export const saveAdminLanguage = formAction(async (fd: FormData) => {
  const session = await getSession();
  if (session?.role !== "super_admin") {
    throw new ActionError("Only a super admin can change the interface language");
  }

  const lang = fdStr(fd, "lang") === "ka" ? "ka" : "en";
  await put("adminLanguage", { lang }, session.sub);
  clearLangCache();

  redirect("/admin/settings?saved=language");
}, tr);
