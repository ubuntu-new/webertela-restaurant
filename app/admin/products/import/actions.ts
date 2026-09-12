"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { nameKey } from "@/lib/name-key";
import { requirePermission } from "@/lib/admin-auth";
import { parseMenu, type MenuKind, type ParsedRow } from "@/lib/menu-import";

/**
 * Importing a pasted menu.
 *
 * ── The rule this file is built around ──
 *
 * ⚠️ Nothing is written until the person has seen what will be written.
 *
 * The preview and the import run the *same* parser over the *same* text. The
 * table somebody confirms is not a rendering of what might happen — it is the
 * result, shown before it is committed. Any other arrangement means the screen
 * and the database are two opinions, and the one that is wrong is the one
 * nobody is looking at.
 *
 * ── What it will not do ──
 *
 * Overwrite. A product whose name already exists is reported as skipped and
 * left exactly as it is. An import is for getting a menu in; changing a price a
 * restaurant has already set is a different act, and doing both from one button
 * is how a paste from an old spreadsheet quietly reverts a week of work.
 */

/** Where each kind lands. These four ids are the ones lib/menu-db.ts filters on. */
const TARGET: Record<MenuKind, { categoryId: string; type: "pizza" | "item" | "drink" }> = {
  pizza: { categoryId: "cat-pizza", type: "pizza" },
  side: { categoryId: "cat-sides", type: "item" },
  sauce: { categoryId: "cat-sauces", type: "item" },
  drink: { categoryId: "cat-drinks", type: "drink" },
};

const SIZE_KEYS = [
  { key: "S", cm: 20 },
  { key: "M", cm: 30 },
  { key: "XL", cm: 45 },
];

export interface PreviewRow extends ParsedRow {
  /** Already in the menu under this name — will be left alone. */
  exists: boolean;
}

export interface Preview {
  rows: PreviewRow[];
  errors: { line: number; raw: string; message: string }[];
  /** Categories the import needs that this restaurant does not have. */
  missingCategories: string[];
  willCreate: number;
  willSkip: number;
}

/* ------------------------------------------------------------------ */

export async function previewMenu(text: string): Promise<Preview> {
  await requirePermission("can_edit_menu");

  const { rows, errors } = parseMenu(text);

  /**
   * Existing products are matched by `nameKey`, the same normalisation the rest
   * of the admin uses for duplicate detection — so "Margherita", "margherita "
   * and "MARGHERITA" are one product rather than three.
   */
  const keys = rows.map((r) => nameKey(r.name));
  const existing = keys.length
    ? await db.product.findMany({
        where: { nameKey: { in: keys }, deletedAt: null },
        select: { nameKey: true },
      })
    : [];
  const taken = new Set(existing.map((p) => p.nameKey));

  const previewRows: PreviewRow[] = rows.map((r) => ({
    ...r,
    exists: taken.has(nameKey(r.name)),
  }));

  /**
   * ⚠️ Checked, not assumed.
   *
   * lib/menu-db.ts selects the storefront rails by literal category id —
   * `cat-sides`, `cat-sauces`, `cat-drinks`. A tenant whose categories were
   * made by hand has cuid ids, those filters match nothing, and an import would
   * appear to work while the products never reached the menu. Saying so here
   * costs one query; finding it out later costs an afternoon.
   */
  const needed = [
    ...new Set(previewRows.filter((r) => !r.exists).map((r) => TARGET[r.kind].categoryId)),
  ];
  const present = needed.length
    ? await db.category.findMany({ where: { id: { in: needed } }, select: { id: true } })
    : [];
  const have = new Set(present.map((c) => c.id));

  return {
    rows: previewRows,
    errors,
    missingCategories: needed.filter((id) => !have.has(id)),
    willCreate: previewRows.filter((r) => !r.exists).length,
    willSkip: previewRows.filter((r) => r.exists).length,
  };
}

/* ------------------------------------------------------------------ */

export interface ImportResult {
  created: number;
  skipped: number;
  failed: { name: string; message: string }[];
  error?: string;
}

export async function importMenu(text: string): Promise<ImportResult> {
  const session = await requirePermission("can_edit_menu");

  // Parsed again rather than trusting anything the browser sends back. The
  // preview is a courtesy to the reader; it is not an authority on what to
  // write.
  const preview = await previewMenu(text);

  if (preview.missingCategories.length) {
    return {
      created: 0,
      skipped: 0,
      failed: [],
      error:
        `This restaurant has no ${preview.missingCategories.join(", ")}. ` +
        `Those exact ids are what the storefront reads, so the products would be ` +
        `created and never appear. Run scripts/create-org.mjs, which makes them.`,
    };
  }

  const result: ImportResult = { created: 0, skipped: 0, failed: [] };

  /**
   * Pizza numbering, allocated once for the whole import.
   *
   * `legacyId` is how the storefront identifies a pizza and it has to be
   * unique. Reading the maximum inside the loop would give the same answer and
   * one query per pizza; allocating from a single read gives it with one.
   */
  const top = await db.product.aggregate({ _max: { legacyId: true } });
  let nextLegacy = (top._max.legacyId ?? 0) + 1;

  for (const row of preview.rows) {
    if (row.exists) {
      result.skipped++;
      continue;
    }

    const target = TARGET[row.kind];

    try {
      /**
       * One product and its sizes in one transaction.
       *
       * A pizza with no ProductSize rows is a pizza the customiser cannot
       * price. If the sizes fail the product must not survive on its own —
       * half a pizza in the database is worse than none, because it shows up
       * on the admin list looking finished.
       */
      await db.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            name: { en: row.name, ka: row.name },
            nameKey: nameKey(row.name),
            description: { en: "", ka: "" },
            categoryId: target.categoryId,
            type: target.type,
            legacyId: row.kind === "pizza" ? nextLegacy : null,
            price: row.kind === "pizza" ? null : row.prices[0],
            /**
             * ⚠️ Imported switched ON, unlike a product created by hand.
             *
             * The hand form leaves a product off because it arrives unpriced.
             * These arrive priced — the parser refuses a row with no price and
             * refuses one priced at zero — so there is nothing left to fill in.
             * Importing forty products and then ticking forty boxes would be
             * the round trip this feature exists to remove.
             */
            active: true,
            sortOrder: 999,
            updatedBy: session.sub,
          },
        });

        if (row.kind === "pizza") {
          await tx.productSize.createMany({
            data: SIZE_KEYS.map((s, i) => ({
              productId: product.id,
              key: s.key,
              cm: s.cm,
              price: row.prices[i],
              sortOrder: i,
            })),
          });
        }

        await tx.auditLog.create({
          data: {
            action: "product.import",
            entityType: "Product",
            entityId: product.id,
            employeeId: session.sub,
          },
        });
      });

      if (row.kind === "pizza") nextLegacy++;
      result.created++;
    } catch (e) {
      /**
       * One bad row does not abandon the rest.
       *
       * Forty products pasted, one of them tripping a constraint, and an
       * all-or-nothing import means doing the whole thing again — which is
       * what somebody would be doing by hand, only now twice. Each failure is
       * named so that line can be fixed and pasted again; the rows that worked
       * are skipped as existing the second time round.
       */
      result.failed.push({
        name: row.name,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  revalidatePath("/admin/products");
  revalidatePath("/");

  return result;
}
