import "server-only";
import { db } from "@/lib/db";
import { nameKey, isNearMatch } from "@/lib/name-key";
import { i18nText, num } from "@/lib/admin-utils";
import { displayGtin, packagingLevel } from "@/lib/gtin";
import { samePack, formatPack } from "@/lib/units";
import { DuplicateError, type DupHit, type DupModel } from "@/lib/action-state";
import type { StockUnit } from "@prisma/client";

/**
 * "You already have one of these."
 *
 * The question is not "is this string in the table" — it is "is the person
 * about to split something in half without noticing". Those are different
 * questions, and the second is the expensive one: two rows for one ingredient
 * mean recipes deduct from one and deliveries land on the other, the shelf is
 * right and the software is wrong, and food cost is understated with nothing
 * anywhere looking broken.
 *
 * ── Why a name is not enough ──
 *
 * The first version of this compared names, and a name is the weakest evidence
 * available because it is the one part a human types. It made two kinds of
 * mistake in opposite directions:
 *
 *   It missed real duplicates. The same product bought from two suppliers gets
 *   two names — "Mozzarella" and "Mozzarella Fior di Latte 2kg" — and nothing
 *   connected them.
 *
 *   It invented false ones. "Coca-Cola 330 ml" and "Coca-Cola 1.5 L" are two
 *   genuinely different items with one name, and warning about them is noise.
 *   Noise is worse than silence here: it is what teaches an owner to click past
 *   warnings, and then the warning that mattered goes past too.
 *
 * ── So evidence is weighed, not matched ──
 *
 *   barcode identical       certain. A GTIN is assigned by the manufacturer and
 *                           is globally unique; there is no judgement to make.
 *   supplier + code same    strong. Same mill, same order code, same flour.
 *   name + same pack        probable.
 *   name, no pack recorded  possible — the old behaviour, now the weakest case.
 *   name, different pack    NOT a duplicate. Said out loud, not silently.
 *
 * And the rule that makes the whole thing feel intelligent rather than nagging:
 *
 *   **Two different barcodes are proof that two things are different.**
 *
 * When both sides carry a GTIN and the GTINs differ, the name similarity is
 * discarded entirely. That single rule removes almost all the false alarms,
 * because the products most likely to share a name — the same brand in two pack
 * sizes — are exactly the ones that both have barcodes.
 */

export type Confidence = "certain" | "strong" | "probable" | "possible";

interface ModelSpec {
  label: string;
  href: (id: string) => string;
  /** `name` is a String column rather than {en,ka} Json. */
  plainName?: boolean;
  scope?: Record<string, unknown>;
  /** Has a `barcode` column worth comparing. */
  hasBarcode?: boolean;
  /** Has packSize/packUnit/supplierId/supplierCode. */
  hasPackAndSupplier?: boolean;
}

const SPEC: Record<DupModel, ModelSpec> = {
  stockItem: {
    label: "stock item",
    href: (id) => `/admin/stock/items/${id}`,
    scope: { deletedAt: null },
    hasBarcode: true,
    hasPackAndSupplier: true,
  },
  product: {
    label: "product",
    href: (id) => `/admin/products/${id}`,
    scope: { deletedAt: null },
    hasBarcode: true,
  },
  category: { label: "category", href: () => `/admin/categories`, scope: { deletedAt: null } },
  subcategory: { label: "subcategory", href: () => `/admin/categories`, scope: { deletedAt: null } },
  topping: { label: "topping", href: (id) => `/admin/toppings/${id}`, scope: { deletedAt: null } },
  combo: { label: "combo", href: (id) => `/admin/combos/${id}`, scope: { deletedAt: null } },
  discount: { label: "discount", href: (id) => `/admin/discounts/${id}`, scope: { deletedAt: null } },
  recipe: { label: "recipe", href: (id) => `/admin/stock/recipes/${id}`, scope: { deletedAt: null } },
  branch: { label: "branch", href: (id) => `/admin/branches/${id}`, scope: { deletedAt: null } },
  supplier: { label: "supplier", href: (id) => `/admin/suppliers/${id}`, scope: { deletedAt: null }, plainName: true },
  // Employee.name is a plain String — a person has one name. Nothing is
  // archived here either: staff are deactivated, and a former employee's name
  // still clashes for a good reason.
  employee: { label: "person", href: (id) => `/admin/employees/${id}`, plainName: true, scope: {} },
};

/** What the caller knows about the thing being created or renamed. */
export interface Candidate {
  name: string;
  barcode?: string | null;
  packSize?: number | null;
  packUnit?: StockUnit | null;
  supplierId?: string | null;
  supplierCode?: string | null;
}

interface Row {
  id: string;
  name: unknown;
  nameKey: string | null;
  barcode?: string | null;
  packSize?: unknown;
  packUnit?: StockUnit | null;
  supplierId?: string | null;
  supplierCode?: string | null;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { certain: 0, strong: 1, probable: 2, possible: 3 };

/**
 * What the existing record is used for, so the warning is worth reading.
 * Small queries, and only for the handful of rows actually shown — this runs
 * while the user is typing.
 */
async function usageOf(model: DupModel, id: string): Promise<string[]> {
  const out: string[] = [];

  try {
    if (model === "stockItem") {
      const [levels, rules, recipes, item] = await Promise.all([
        db.stockLevel.findMany({ where: { itemId: id }, select: { qty: true } }),
        db.consumptionRule.count({ where: { itemId: id } }),
        db.recipeLine.count({ where: { itemId: id } }),
        db.stockItem.findUnique({ where: { id }, select: { unit: true } }),
      ]);
      const onHand = levels.reduce((s, l) => s + num(l.qty), 0);
      if (onHand > 0) out.push(`${onHand % 1 === 0 ? onHand : onHand.toFixed(2)} ${item?.unit ?? ""} on hand`);
      if (rules > 0) out.push(`used by ${rules} menu ${rules === 1 ? "rule" : "rules"}`);
      if (recipes > 0) out.push(`in ${recipes} ${recipes === 1 ? "recipe" : "recipes"}`);
    } else if (model === "product") {
      const [sold, rules] = await Promise.all([
        db.orderItem.count({ where: { productId: id } }),
        db.consumptionRule.count({ where: { productId: id } }),
      ]);
      if (sold > 0) out.push(`sold ${sold} ${sold === 1 ? "time" : "times"}`);
      if (rules > 0) out.push(`${rules} ingredient ${rules === 1 ? "rule" : "rules"}`);
    } else if (model === "category") {
      const n = await db.product.count({ where: { categoryId: id, deletedAt: null } });
      if (n > 0) out.push(`${n} ${n === 1 ? "product" : "products"}`);
    } else if (model === "topping") {
      const [onProducts, rules] = await Promise.all([
        db.productTopping.count({ where: { toppingId: id } }),
        db.consumptionRule.count({ where: { toppingId: id } }),
      ]);
      if (onProducts > 0) out.push(`on ${onProducts} ${onProducts === 1 ? "product" : "products"}`);
      if (rules > 0) out.push(`${rules} ingredient ${rules === 1 ? "rule" : "rules"}`);
    } else if (model === "recipe") {
      const n = await db.recipeLine.count({ where: { recipeId: id } });
      if (n > 0) out.push(`${n} ${n === 1 ? "ingredient" : "ingredients"}`);
    } else if (model === "employee") {
      const n = await db.shift.count({ where: { employeeId: id } });
      if (n > 0) out.push(`${n} ${n === 1 ? "shift" : "shifts"}`);
    } else if (model === "branch") {
      const n = await db.terminal.count({ where: { branchId: id } });
      if (n > 0) out.push(`${n} POS ${n === 1 ? "terminal" : "terminals"}`);
    } else if (model === "supplier") {
      const n = await db.stockItem.count({ where: { supplierId: id, deletedAt: null } });
      if (n > 0) out.push(`supplies ${n} ${n === 1 ? "item" : "items"}`);
    }
  } catch (e) {
    console.error("[dup] usage lookup failed", model, id, e);
  }

  return out;
}

/** The select list, narrowed to the columns a given model actually has. */
function selectFor(spec: ModelSpec) {
  return {
    id: true,
    name: true,
    nameKey: true,
    ...(spec.hasBarcode ? { barcode: true } : {}),
    ...(spec.hasPackAndSupplier
      ? { packSize: true, packUnit: true, supplierId: true, supplierCode: true }
      : {}),
  };
}

/**
 * Everything that already exists and might be this thing, with how sure we are
 * and why.
 */
export async function findDuplicates(
  model: DupModel,
  candidate: Candidate | string,
  opts: { excludeId?: string; limit?: number } = {},
): Promise<DupHit[]> {
  const c: Candidate = typeof candidate === "string" ? { name: candidate } : candidate;
  const spec = SPEC[model];
  const limit = opts.limit ?? 4;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = (db as any)[model];
  const select = selectFor(spec);

  const base = { ...(spec.scope ?? {}), ...(opts.excludeId ? { NOT: { id: opts.excludeId } } : {}) };
  const key = nameKey(c.name ?? "");

  /** id → the strongest reason we have for suspecting this row. */
  const found = new Map<string, { row: Row; confidence: Confidence; why: string }>();
  const note = (row: Row, confidence: Confidence, why: string) => {
    const prev = found.get(row.id);
    if (!prev || CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK[prev.confidence]) {
      found.set(row.id, { row, confidence, why });
    }
  };

  // ── 1. barcode: the only certainty available ────────────────────────────
  if (spec.hasBarcode && c.barcode) {
    const byBarcode: Row[] = await table.findMany({
      where: { ...base, barcode: c.barcode },
      select,
      take: limit,
    });
    for (const r of byBarcode) {
      note(r, "certain", `same barcode ${displayGtin(c.barcode)}`);
    }
  }

  // ── 2. the supplier's own code ──────────────────────────────────────────
  if (spec.hasPackAndSupplier && c.supplierId && c.supplierCode) {
    const bySupplier: Row[] = await table.findMany({
      where: { ...base, supplierId: c.supplierId, supplierCode: c.supplierCode },
      select,
      take: limit,
    });
    for (const r of bySupplier) {
      note(r, "strong", `same supplier code ${c.supplierCode}`);
    }
  }

  // ── 3. the name, which is where judgement starts ────────────────────────
  if (key) {
    const byName: Row[] = await table.findMany({ where: { ...base, nameKey: key }, select, take: limit });

    for (const r of byName) {
      // THE RULE. Both sides carry a manufacturer's identifier and they differ,
      // so these are two different products that happen to share a name. Not a
      // duplicate, and saying otherwise would be the software being wrong out
      // loud. Skipped entirely — no hit, no warning.
      if (c.barcode && r.barcode && c.barcode !== r.barcode) continue;

      // Both units too: while someone is mid-way through typing a pack size the
      // unit is not picked yet, and treating that as "known" would make the
      // live warning vanish exactly when the form is being filled in.
      const packKnown = c.packSize != null && c.packUnit != null && r.packSize != null && r.packUnit != null;
      const packMatches = packKnown && samePack(c.packSize, c.packUnit, num(r.packSize), r.packUnit ?? null);

      if (packKnown && !packMatches) {
        // Same name, different pack — also two real items. Told, not warned.
        continue;
      }

      note(
        r,
        packMatches ? "probable" : "possible",
        packMatches ? `same name and same pack (${formatPack(c.packSize, c.packUnit)})` : "same name",
      );
    }

    // Near matches only when nothing firmer turned up — a typo is the weakest
    // signal of all and should never bury a barcode hit.
    if (found.size === 0) {
      // Both kinds of near match share a prefix with the typed name (a typo late
      // in the word, or the same words with more added), so the index narrows on
      // the first two characters and only the survivors are compared properly.
      // Two, not three: a typo in the third character would otherwise escape.
      const candidates: Row[] = await table.findMany({
        where: { ...base, nameKey: { startsWith: key.slice(0, 2) } },
        select,
        take: 400,
      });

      for (const r of candidates) {
        if (!r.nameKey || !isNearMatch(key, r.nameKey)) continue;
        if (c.barcode && r.barcode && c.barcode !== r.barcode) continue;
        note(r, "possible", "similar name");
      }
    }
  }

  const ranked = [...found.values()]
    .sort((a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence])
    .slice(0, limit);

  return Promise.all(
    ranked.map(async ({ row, confidence, why }) => {
      const usage = await usageOf(model, row.id);

      // The pack and the barcode belong in the line the user reads: they are
      // how he tells at a glance whether this really is his mozzarella.
      const detail: string[] = [];
      if (row.barcode) {
        const lvl = packagingLevel(row.barcode);
        detail.push(`barcode ${displayGtin(row.barcode)}${lvl === "case" ? " (case)" : ""}`);
      }
      if (row.packSize != null && row.packUnit) {
        detail.push(formatPack(num(row.packSize), row.packUnit));
      }

      return {
        id: row.id,
        name: spec.plainName ? String(row.name ?? "") : i18nText(row.name),
        href: spec.href(row.id),
        usage: [...detail, ...usage],
        exact: confidence === "certain" || confidence === "strong",
        confidence,
        why,
      };
    }),
  );
}

/**
 * Stop the save and put the question to the user — unless they have already
 * answered it.
 *
 * `confirmed` comes from the form's hidden field, which is only ever set by the
 * user pressing "create anyway" on the warning they just read. It cannot be set
 * by simply submitting again, which is what makes this a decision rather than
 * an obstacle.
 */
export async function guardDuplicate(
  model: DupModel,
  candidate: Candidate | string,
  opts: { excludeId?: string; confirmed?: boolean; t?: (s: string) => string } = {},
): Promise<void> {
  const hits = await findDuplicates(model, candidate, { excludeId: opts.excludeId });
  if (hits.length === 0) return;

  const t = opts.t ?? ((s: string) => s);
  const spec = SPEC[model];
  const strongest = hits[0].confidence ?? "possible";

  // Neither of these is a judgement call, and both are enforced by a unique index — `barcode`, and
  // `(supplierId, supplierCode)`. Offering "create anyway" would produce a row
  // the database refuses a moment later, with a generic P2002 the person cannot
  // act on. A button that cannot work is worse than no button.
  if (strongest === "certain" || strongest === "strong") {
    const isBarcode = strongest === "certain";
    throw new DuplicateError({
      title: isBarcode
        ? t("That barcode is already on another item")
        : t("That supplier already has an item under this code"),
      message: isBarcode
        ? t(
            "A barcode identifies one product worldwide, so this cannot be a second item. Open the one you have — " +
              "or if the barcode was scanned onto the wrong item, correct it there first.",
          )
        : t(
            "One supplier code means one thing you order from them. Open the item that already has it, " +
              "or clear the code here if this really is something else.",
          ),
      hits,
      confirmLabel: "",
    });
  }

  if (opts.confirmed) return;

  const one = hits.length === 1;

  throw new DuplicateError({
    title: `${t("You already have a")} ${t(spec.label)} ${t("with this name")}`,
    message: t(
      model === "stockItem"
        ? "Two rows for the same ingredient split your stock in half: recipes use one, deliveries land on the other, and your food cost stops being true. Open the one you have — or, if this really is a different item, record its barcode or pack size so the two can be told apart."
        : "Check whether this is the one you meant. If it is, open it instead of creating a second.",
    ),
    hits,
    confirmLabel: one ? t("No — this is a different thing, create it") : t("None of these — create it anyway"),
  });
}

/**
 * Everything in a table that shares a key with something else in that table.
 *
 * Used by the merge screen and the advice panel. Groups are returned largest
 * first, because the biggest pile is usually the oldest mistake.
 *
 * Rows that carry different barcodes are not grouped together, for the same
 * reason they are not warned about: a manufacturer's identifier outranks a
 * typed name, and reporting a pile of "duplicates" that are really pack sizes
 * would make the whole screen untrustworthy.
 */
export async function findExistingDuplicateGroups(
  model: DupModel,
): Promise<Array<{ key: string; rows: Array<{ id: string; name: string; href: string }> }>> {
  const spec = SPEC[model];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = (db as any)[model];

  const rows: Row[] = await table.findMany({ where: spec.scope ?? {}, select: selectFor(spec) });

  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.nameKey) continue;
    const list = byKey.get(r.nameKey);
    if (list) list.push(r);
    else byKey.set(r.nameKey, [r]);
  }

  const out: Array<{ key: string; rows: Array<{ id: string; name: string; href: string }> }> = [];

  for (const [key, list] of byKey) {
    if (list.length < 2) continue;

    // Split the name-group only where there is real evidence of a difference —
    // and evidence means *both* sides carrying it, exactly as findDuplicates
    // requires.
    //
    // The first version bucketed on "has a barcode or doesn't", which quietly
    // hid the commonest duplicate of all: one row scanned and one row typed.
    // Each landed in a bucket of one, no group was emitted, and the screen
    // reported nothing wrong. A duplicate finder that misses the usual case is
    // worse than none, because it is believed.
    const distinctBarcodes = new Set(list.filter((r) => r.barcode).map((r) => r.barcode));
    const distinctPacks = new Set(
      list.filter((r) => r.packSize != null && r.packUnit).map((r) => `${num(r.packSize)}:${r.packUnit}`),
    );

    // Only a group where *every* row carries the identifier, and they genuinely
    // differ, is really several products. Anything else stays together.
    const allHaveBarcodes = list.every((r) => r.barcode);
    const allHavePacks = list.every((r) => r.packSize != null && r.packUnit);

    let buckets: Row[][];
    if (allHaveBarcodes && distinctBarcodes.size > 1) {
      const m = new Map<string, Row[]>();
      for (const r of list) {
        const b = m.get(r.barcode as string);
        if (b) b.push(r);
        else m.set(r.barcode as string, [r]);
      }
      buckets = [...m.values()];
    } else if (allHavePacks && distinctPacks.size > 1) {
      const m = new Map<string, Row[]>();
      for (const r of list) {
        const k = `${num(r.packSize)}:${r.packUnit}`;
        const b = m.get(k);
        if (b) b.push(r);
        else m.set(k, [r]);
      }
      buckets = [...m.values()];
    } else {
      buckets = [list];
    }

    for (const group of buckets) {
      if (group.length < 2) continue;
      out.push({
        key,
        rows: group.map((r) => ({
          id: r.id,
          name: spec.plainName ? String(r.name ?? "") : i18nText(r.name),
          href: spec.href(r.id),
        })),
      });
    }
  }

  return out.sort((a, b) => b.rows.length - a.rows.length);
}

export type { DupHit, DupModel };
