"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/admin-auth";
import { fdStr } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { ActionError, failTo, formAction, isConfirmed } from "@/lib/action-state";
import { guardDuplicate } from "@/lib/dup";
import { nameKey } from "@/lib/name-key";

/**
 * Suppliers exist for one narrow reason: most of what a kitchen buys has no
 * barcode. A sack of flour, a tub of sauce, a case of tomatoes from the local
 * wholesaler — none of it is labelled by a manufacturer, so the only identifier
 * that is not a typed name is "the code this supplier uses for it".
 *
 * That is why this is a small screen and not a purchasing module. It holds who
 * you buy from, so the stock item can hold their code for the thing.
 */

export const createSupplier = formAction(async (fd: FormData) => {
  await requirePermission("can_edit_menu");
  const t = await tr();

  const name = fdStr(fd, "name");
  if (!name) throw new ActionError(t("A name is required"), "name");

  const code = fdStr(fd, "code").toUpperCase() || null;
  if (code) {
    const clash = await db.supplier.findUnique({ where: { code } });
    if (clash) throw new ActionError(`${t("Code")} "${code}" ${t("is already in use")}`, "code");
  }

  await guardDuplicate("supplier", name, { confirmed: isConfirmed(fd), t });

  const s = await db.supplier.create({
    data: {
      name,
      nameKey: nameKey(name),
      code,
      phone: fdStr(fd, "phone") || null,
      email: fdStr(fd, "email").toLowerCase() || null,
      contact: fdStr(fd, "contact") || null,
      note: fdStr(fd, "note") || null,
      active: true,
    },
  });

  revalidatePath("/admin/suppliers");
  redirect(`/admin/suppliers/${s.id}`);
}, tr);

export const updateSupplier = formAction(async (fd: FormData, id: string) => {
  await requirePermission("can_edit_menu");
  const t = await tr();

  const name = fdStr(fd, "name");
  if (!name) throw new ActionError(t("A name is required"), "name");

  const code = fdStr(fd, "code").toUpperCase() || null;
  if (code) {
    const clash = await db.supplier.findFirst({ where: { code, NOT: { id } } });
    if (clash) throw new ActionError(`${t("Code")} "${code}" ${t("is already in use")}`, "code");
  }

  await guardDuplicate("supplier", name, { excludeId: id, confirmed: isConfirmed(fd), t });

  await db.supplier.update({
    where: { id },
    data: {
      name,
      nameKey: nameKey(name),
      code,
      phone: fdStr(fd, "phone") || null,
      email: fdStr(fd, "email").toLowerCase() || null,
      contact: fdStr(fd, "contact") || null,
      note: fdStr(fd, "note") || null,
      active: fd.get("active") === "on",
    },
  });

  revalidatePath("/admin/suppliers");
  redirect("/admin/suppliers?saved=1");
}, tr);

export async function archiveSupplier(id: string) {
  await requirePermission("can_edit_menu");
  const t = await tr();

  // Items keep pointing at an archived supplier on purpose — the history of
  // where something came from is worth more than a tidy list, and the foreign
  // key is ON DELETE SET NULL only for a real deletion, which never happens.
  const items = await db.stockItem.count({ where: { supplierId: id, deletedAt: null } });
  if (items > 0) {
    failTo(
      `/admin/suppliers/${id}`,
      `${items} ${t("stock items still list this supplier. Move them to another supplier first, or clear the supplier on each — otherwise you lose the code that identifies them.")}`,
    );
  }

  await db.supplier.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
  revalidatePath("/admin/suppliers");
  redirect("/admin/suppliers?archived=1");
}
