import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { i18nOf, i18nText, money, num } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { updateProductFull, archiveProduct } from "../actions";
import ImageField from "../../_components/ImageField";
import ArchiveButton from "../../_components/ArchiveButton";

export const dynamic = "force-dynamic";

const TYPES = [
  { v: "pizza", l: "Pizza (with sizes)" },
  { v: "item", l: "Regular" },
  { v: "sticks", l: "Sticks / builder" },
  { v: "drink", l: "Drink" },
  { v: "merch", l: "Merch" },
];

function nutritionOf(v: unknown) {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    calories: o.calories ?? "",
    protein: o.protein ?? "",
    carbs: o.carbs ?? "",
    fat: o.fat ?? "",
    allergens: Array.isArray(o.allergens) ? (o.allergens as string[]).join(", ") : "",
  };
}

export default async function ProductEdit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await tr();

  const [p, categories, toppings, branches, orderCount, comboSlots] = await Promise.all([
    db.product.findUnique({
      where: { id },
      include: {
        category: true,
        sizes: { orderBy: { sortOrder: "asc" } },
        promo: true,
        ingredients: true,
        branchProducts: true,
      },
    }),
    db.category.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" }, include: { subcategories: true } }),
    db.topping.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    db.branch.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    db.orderItem.count({ where: { productId: id } }),
    db.comboSlotOption.findMany({
      where: { productId: id },
      include: { slot: { include: { combo: true } } },
    }),
  ]);
  if (!p) notFound();

  const name = i18nOf(p.name);
  const desc = i18nOf(p.description);
  const badge = i18nOf(p.badge);
  const nut = nutritionOf(p.nutrition);
  const chosenIngs = new Set(p.ingredients.map((i) => i.toppingId));
  const disabled = new Set(p.branchProducts.filter((bp) => !bp.available).map((bp) => bp.branchId));
  const goneEverywhere = branches.length > 0 && disabled.size >= branches.length;
  const promoSizes = new Set(p.promo?.sizes ?? []);

  const save = updateProductFull.bind(null, id);
  const archive = archiveProduct.bind(null, id);

  const combosUsing = Array.from(
    new Set(comboSlots.map((o) => i18nOf(o.slot.combo.name).ka || i18nOf(o.slot.combo.name).en)),
  );

  const consequences = [
    t("It disappears from the menu and from the admin lists — customers can no longer order it."),
    orderCount > 0
      ? `${orderCount} ${t("orders include it — those orders stay untouched (each one keeps its own copy of the product).")}`
      : t("No order includes it."),
    combosUsing.length > 0
      ? `${t("Part of these combos:")} ${combosUsing.join(", ")} — ${t("it drops out of them too, but the combos stay.")}`
      : t("Not part of any combo."),
  ];

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{name.ka || name.en}</h1>
          <p>
            {i18nText(p.category.name)} · {p.type}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/products">
          {t("Back to list")}
        </Link>
      </div>

      <form className="admin-form" action={save} style={{ maxWidth: 900 }}>
        {/* ── ძირითადი ── */}
        <div className="admin-panel">
          <h2>{t("Basics")}</h2>

          <div className="field-row">
            <div className="field">
              <label htmlFor="name_en">{t("Name")} (EN)</label>
              <input id="name_en" name="name_en" type="text" defaultValue={name.en} required />
            </div>
            <div className="field">
              <label htmlFor="name_ka">{t("Name")} (KA)</label>
              <input id="name_ka" name="name_ka" type="text" defaultValue={name.ka} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="desc_en">{t("Description")} (EN)</label>
              <textarea id="desc_en" name="desc_en" defaultValue={desc.en} />
            </div>
            <div className="field">
              <label htmlFor="desc_ka">{t("Description")} (KA)</label>
              <textarea id="desc_ka" name="desc_ka" defaultValue={desc.ka} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="categoryId">{t("Category")}</label>
              <select id="categoryId" name="categoryId" defaultValue={p.categoryId}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {i18nText(c.name)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="subcategoryId">{t("Subcategory")}</label>
              <select id="subcategoryId" name="subcategoryId" defaultValue={p.subcategoryId ?? ""}>
                <option value="">—</option>
                {categories.flatMap((c) =>
                  c.subcategories.map((s) => (
                    <option key={s.id} value={s.id}>
                      {i18nText(c.name)} › {i18nText(s.name)}
                    </option>
                  )),
                )}
              </select>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="type">{t("Type")}</label>
              <select id="type" name="type" defaultValue={p.type}>
                {TYPES.map((ty) => (
                  <option key={ty.v} value={ty.v}>
                    {t(ty.l)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="tier">{t("Tier")}</label>
              <input id="tier" name="tier" type="text" defaultValue={p.tier ?? ""} placeholder="standard / house" />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="emoji">{t("Emoji")}</label>
              <input id="emoji" name="emoji" type="text" defaultValue={p.emoji ?? ""} placeholder="🍕" />
              <span className="hint">{t("Shown when the photo fails to load.")}</span>
            </div>
            <div className="field">
              <label htmlFor="builder">{t("Builder")}</label>
              <select id="builder" name="builder" defaultValue={p.builder ?? ""}>
                <option value="">—</option>
                <option value="sticks">{t("Sticks")}</option>
                <option value="cinsticks">{t("Cinnamon sticks")}</option>
              </select>
              <span className="hint">{t("Which picker opens on “Choose”.")}</span>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="badge_en">{t("Badge")} (EN)</label>
              <input id="badge_en" name="badge_en" type="text" defaultValue={badge.en} />
            </div>
            <div className="field">
              <label htmlFor="badge_ka">{t("Badge")} (KA)</label>
              <input id="badge_ka" name="badge_ka" type="text" defaultValue={badge.ka} />
            </div>
          </div>
        </div>

        {/* ── ფოტო ── */}
        <div className="admin-panel">
          <h2>{t("Photo")}</h2>
          <ImageField name="photo" label={t("Main photo")} defaultValue={p.photo} />
          <div className="field">
            <label htmlFor="gallery">{t("Gallery (one link per line)")}</label>
            <textarea id="gallery" name="gallery" defaultValue={p.gallery.join("\n")} style={{ minHeight: 90 }} />
          </div>
        </div>

        {/* ── ფასი ── */}
        <div className="admin-panel">
          <h2>{t("Price")}</h2>

          {p.sizes.length > 0 && (
            <table className="admin-table" style={{ marginBottom: 16 }}>
              <thead>
                <tr>
                  <th style={{ width: 90 }}>{t("Size")}</th>
                  <th style={{ width: 90 }}>{t("cm")}</th>
                  <th style={{ width: 110 }}>{t("Price")} (₾)</th>
                  <th style={{ width: 90 }}>{t("Sort")}</th>
                  <th style={{ width: 70 }}>{t("Delete")}</th>
                </tr>
              </thead>
              <tbody>
                {p.sizes.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <input name={`size_${s.id}_key`} type="text" defaultValue={s.key} style={inp} />
                    </td>
                    <td>
                      <input name={`size_${s.id}_cm`} type="number" defaultValue={s.cm ?? ""} style={inp} />
                    </td>
                    <td>
                      <input name={`size_${s.id}_price`} type="number" step="0.01" min="0" defaultValue={money(s.price)} style={inp} />
                    </td>
                    <td>
                      <input name={`size_${s.id}_order`} type="number" defaultValue={s.sortOrder} style={inp} />
                    </td>
                    <td>
                      <input type="checkbox" name={`size_${s.id}_del`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="field">
            <label>{t("Add a size")}</label>
            <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              <input name="newsize_key" type="text" placeholder={t("Size (e.g. XXL)")} />
              <input name="newsize_cm" type="number" placeholder={t("cm")} />
              <input name="newsize_price" type="number" step="0.01" min="0" placeholder={t("Price")} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="price">{t("Single price")} (₾)</label>
            <input id="price" name="price" type="number" step="0.01" min="0" defaultValue={p.price ? money(p.price) : ""} />
            <span className="hint">{t("Use this when the product has no sizes. Empty = it sells by size.")}</span>
          </div>
        </div>

        {/* ── ინგრედიენტები ── */}
        <div className="admin-panel">
          <h2>
            {t("Default ingredients")} ({chosenIngs.size})
          </h2>
          <input type="hidden" name="ings_present" value="1" />
          <div style={grid}>
            {toppings.map((tp) => (
              <label key={tp.id} style={cell}>
                <input type="checkbox" name="ing" value={tp.id} defaultChecked={chosenIngs.has(tp.id)} />
                <span>
                  {i18nText(tp.name)}
                  {tp.recipeOnly && <span className="hint"> · {t("Recipe")}</span>}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* ── აქცია ── */}
        <div className="admin-panel">
          <h2>{t("Promo")}</h2>
          <div className="field-check">
            <input id="promo_active" name="promo_active" type="checkbox" defaultChecked={!!p.promo?.active} />
            <label htmlFor="promo_active">{t("Promo is on")}</label>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="promo_mode">{t("Type")}</label>
              <select id="promo_mode" name="promo_mode" defaultValue={p.promo?.mode ?? "percent"}>
                <option value="percent">{t("Percent")} (%)</option>
                <option value="fixed">{t("Fixed")} (₾)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="promo_value">{t("Amount")}</label>
              <input id="promo_value" name="promo_value" type="number" step="0.01" min="0" defaultValue={p.promo ? num(p.promo.value) : ""} />
            </div>
          </div>
          {p.sizes.length > 0 && (
            <div className="field">
              <label>{t("Which sizes")}</label>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                {p.sizes.map((s) => (
                  <label key={s.id} style={cell}>
                    <input type="checkbox" name="promo_size" value={s.key} defaultChecked={promoSizes.has(s.key)} />
                    <span>{s.key}</span>
                  </label>
                ))}
              </div>
              <span className="hint">{t("None ticked = every size.")}</span>
            </div>
          )}
        </div>

        {/* ── ხელმისაწვდომობა ── */}
        <div className="admin-panel">
          <h2>{t("Availability by branch")}</h2>
          <input type="hidden" name="branches_present" value="1" />
          {goneEverywhere && (
            <div className="alert alert-error">
              <b>{t("Not sold at any branch")}</b> — {t("this product does not show on the site at all.")}
            </div>
          )}
          {!goneEverywhere && disabled.size > 0 && (
            <div className="alert" style={{ background: "#fdf3d6", color: "#8a6a12" }}>
              {t("Turned off at")} {disabled.size} {t("branches:")}{" "}
              {branches.filter((b) => disabled.has(b.id)).map((b) => i18nText(b.name)).join(", ")}
            </div>
          )}
          <div style={grid}>
            {branches.map((b) => (
              <label key={b.id} style={cell}>
                <input type="checkbox" name="availableIn" value={b.id} defaultChecked={!disabled.has(b.id)} />
                <span>
                  {i18nText(b.name)} <span className="hint">· {b.code}</span>
                </span>
              </label>
            ))}
          </div>
          <span className="hint">
            {t("Unticked = not sold at that branch for now. To pull it for good, use the “Enabled” switch.")}
          </span>
        </div>

        {/* ── კვებითი ღირებულება ── */}
        <div className="admin-panel">
          <h2>{t("Nutrition")}</h2>
          <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
            <div className="field">
              <label htmlFor="calories">{t("Calories")}</label>
              <input id="calories" name="calories" type="number" step="0.1" defaultValue={String(nut.calories)} />
            </div>
            <div className="field">
              <label htmlFor="protein">{t("Protein (g)")}</label>
              <input id="protein" name="protein" type="number" step="0.1" defaultValue={String(nut.protein)} />
            </div>
            <div className="field">
              <label htmlFor="carbs">{t("Carbs (g)")}</label>
              <input id="carbs" name="carbs" type="number" step="0.1" defaultValue={String(nut.carbs)} />
            </div>
            <div className="field">
              <label htmlFor="fat">{t("Fat (g)")}</label>
              <input id="fat" name="fat" type="number" step="0.1" defaultValue={String(nut.fat)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="allergens">{t("Allergens (comma separated)")}</label>
            <input id="allergens" name="allergens" type="text" defaultValue={nut.allergens} placeholder="gluten, dairy" />
          </div>
        </div>

        {/* ── სტატუსი ── */}
        <div className="admin-panel">
          <h2>{t("Status")}</h2>
          <div className="field-row">
            <div className="field">
              <label htmlFor="sortOrder">{t("Order")}</label>
              <input id="sortOrder" name="sortOrder" type="number" defaultValue={p.sortOrder} />
            </div>
            <div className="field" style={{ alignContent: "end" }}>
              <div className="field-check">
                <input id="active" name="active" type="checkbox" defaultChecked={p.active} />
                <label htmlFor="active">{t("Enabled (visible on the menu)")}</label>
              </div>
              <div className="field-check">
                <input id="discountable" name="discountable" type="checkbox" defaultChecked={p.discountable} />
                <label htmlFor="discountable">{t("Discounts apply")}</label>
              </div>
              <div className="field-check">
                <input id="isBYO" name="isBYO" type="checkbox" defaultChecked={p.isBYO} />
                <label htmlFor="isBYO">{t("“Build your own” — from scratch")}</label>
              </div>
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button className="btn" type="submit">
            {t("Save")}
          </button>
          <Link className="btn btn-ghost" href="/admin/products">
            {t("Cancel")}
          </Link>
        </div>
      </form>

      <div className="admin-panel" style={{ maxWidth: 900, marginTop: 20 }}>
        <h2>{t("Archive")}</h2>
        <p className="hint" style={{ marginBottom: 12 }}>
          <b>{t("To take it off the menu for a while, better to just turn it off above (“Enabled”).")}</b>{" "}
          {t("The archive is for products you no longer use.")}
        </p>
        <ArchiveButton action={archive} subject={name.ka || name.en} consequences={consequences} />
      </div>
    </>
  );
}

const inp: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--a-line)",
  borderRadius: 6,
  font: "inherit",
};

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
  gap: 6,
  maxHeight: 300,
  overflowY: "auto",
  border: "1px solid var(--a-line)",
  borderRadius: 8,
  padding: "10px 12px",
};

const cell: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 14,
};
