"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/admin-auth";
import { fdStr } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { ActionError, formAction } from "@/lib/action-state";
import { applyPack, undoPack } from "@/lib/starter-pack-apply";
import { packById } from "@/lib/starter-packs";

export const applyStarterPack = formAction(async (fd: FormData) => {
  const s = await requirePermission("can_edit_menu");
  const t = await tr();

  const packId = fdStr(fd, "packId");
  const pack = packById(packId);
  if (!pack) throw new ActionError(t("Pick which kind of place this is"));

  // The preview above the button lists every row. Typing the word is not
  // ceremony: forty rows arriving at once is the thing people are nervous
  // about, and a deliberate keystroke is what turns it from something that
  // happened into something they did.
  if (fdStr(fd, "iUnderstand").toUpperCase() !== "ADD") {
    throw new ActionError(t("Type ADD to confirm — everything here can be undone afterwards"), "iUnderstand");
  }

  const made = await applyPack(packId, s.sub);

  revalidatePath("/admin/stock/items");
  revalidatePath("/admin/toppings");
  revalidatePath("/admin/stock/consumption");
  revalidatePath("/admin/setup/starter");
  redirect(
    `/admin/setup/starter?pack=${packId}&added=${made.items}&toppings=${made.toppings}&rules=${made.rules}`,
  );
}, tr);

export const undoStarterPack = formAction(async (fd: FormData) => {
  const s = await requirePermission("can_edit_menu");
  const t = await tr();

  const packId = fdStr(fd, "packId");
  if (!packById(packId)) throw new ActionError(t("No such starter pack"));

  try {
    await undoPack(packId, s.sub);
  } catch (e) {
    // undoPack's refusals are written for the owner — "these toppings are on 6
    // products" — so unlike a database error they are worth passing through.
    throw new ActionError(e instanceof Error ? e.message : t("That could not be undone."));
  }

  revalidatePath("/admin/stock/items");
  revalidatePath("/admin/toppings");
  revalidatePath("/admin/setup/starter");
  redirect(`/admin/setup/starter?pack=${packId}&undone=1`);
}, tr);
