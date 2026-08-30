"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin-auth";
import { mergeStockItems } from "@/lib/merge-stock-item";
import { ActionError, formAction } from "@/lib/action-state";
import { fdStr } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";

export const mergeItems = formAction(async (fd: FormData) => {
  const s = await requirePermission("can_edit_menu");
  const t = await tr();

  const keepId = fdStr(fd, "keepId");
  const loseId = fdStr(fd, "loseId");

  if (!keepId || !loseId) throw new ActionError(t("Pick which one to keep and which one to merge into it"));
  if (keepId === loseId) throw new ActionError(t("Those are the same item"));

  // The confirmation the user typed. A merge moves a ledger and cannot be
  // undone with a button, so it is not a thing to click through by accident.
  if (fdStr(fd, "iUnderstand") !== "MERGE") {
    throw new ActionError(t("Type MERGE to confirm — this cannot be undone from here"), "iUnderstand");
  }

  try {
    await mergeStockItems(keepId, loseId, s.sub);
  } catch (e) {
    // The plan's own refusals (different units, item gone) are already shown
    // before this point. Anything that fails here is a database error, and its
    // message is a transaction trace — not something to put in front of a
    // restaurant owner. The transaction rolled back, so the reassurance is true.
    console.error("[merge] failed", { keepId, loseId }, e);
    throw new ActionError(
      t("The merge did not go through, and nothing was changed. Try again, and tell us if it keeps happening."),
    );
  }

  revalidatePath("/admin/stock");
  revalidatePath("/admin/stock/items");
  revalidatePath("/admin/stock/duplicates");
  redirect("/admin/stock/duplicates?merged=1");
}, tr);
