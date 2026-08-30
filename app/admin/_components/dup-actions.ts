"use server";

import { requirePermission } from "@/lib/admin-auth";
import { findDuplicates, type Candidate } from "@/lib/dup";
import type { DupHit, DupModel } from "@/lib/action-state";

/**
 * The live lookup behind NameField.
 *
 * Separate from the section action files on purpose: it is called from the
 * browser on a debounce while somebody types, so it must be cheap, must return
 * nothing but what is already visible on the page it came from, and must still
 * check permission. Someone who cannot edit the menu cannot use this to
 * enumerate it.
 */

const PERMISSION: Record<DupModel, Parameters<typeof requirePermission>[0]> = {
  stockItem: "can_edit_menu",
  supplier: "can_edit_menu",
  product: "can_edit_menu",
  category: "can_edit_menu",
  subcategory: "can_edit_menu",
  topping: "can_edit_menu",
  combo: "can_edit_menu",
  discount: "can_discount",
  recipe: "can_edit_menu",
  branch: "can_edit_menu",
  employee: "can_manage_staff",
};

export async function checkDuplicateName(
  model: DupModel,
  name: string,
  excludeId?: string,
  /** What else is already filled in. A barcode or a pack size here is what lets
   *  the answer be "no, those are two different pack sizes" instead of a
   *  warning the user has to think about. */
  context?: Omit<Candidate, "name">,
): Promise<DupHit[]> {
  const permission = PERMISSION[model];
  if (!permission) return [];

  await requirePermission(permission);

  // Below three characters everything looks like everything. Warning on "mo"
  // would fire on every second keystroke and train the user to ignore the box.
  if (name.trim().length < 3) return [];

  return findDuplicates(model, { ...context, name }, { excludeId, limit: 3 });
}

/**
 * The same question for a barcode, which needs no debounce forgiveness: a GTIN
 * is either complete and valid or it is not, so by the time this is called
 * there is a real number to look up.
 */
export async function checkDuplicateBarcode(
  model: DupModel,
  barcode: string,
  excludeId?: string,
): Promise<DupHit[]> {
  const permission = PERMISSION[model];
  if (!permission) return [];

  await requirePermission(permission);
  if (!barcode) return [];

  return findDuplicates(model, { name: "", barcode }, { excludeId, limit: 3 });
}
