import { db } from "@/lib/db";
import { i18nOf } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { saveCategories, createCategory, createSubcategory, archiveCategory } from "./actions";
import ArchiveButton from "../_components/ArchiveButton";

export const dynamic = "force-dynamic";

const inp: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--a-line)",
  borderRadius: 6,
  font: "inherit",
};

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; archived?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();

  const cats = await db.category.findMany({
    where: { deletedAt: null },
    orderBy: { sortOrder: "asc" },
    include: {
      subcategories: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } },
      _count: { select: { products: true } },
    },
  });

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Categories")}</h1>
          <p>
            {cats.length} {t("categories")}
          </p>
        </div>
      </div>

      {sp.saved && <div className="alert alert-ok">{t("Saved.")}</div>}
      {sp.archived && (
        <div className="alert alert-ok">
          {t("Moved to the archive.")} {t("You can restore it from the Archive page.")}
        </div>
      )}

      <form action={saveCategories}>
        {cats.map((c) => {
          const n = i18nOf(c.name);
          return (
            <div className="admin-panel" key={c.id}>
              <input type="hidden" name={`cat_${c.id}_present`} value="1" />
              <h2>
                {n.ka || n.en}{" "}
                <span className="hint">
                  · {c._count.products} {t("products")}
                </span>
              </h2>

              <div className="field-row">
                <div className="field">
                  <label>{t("Name")} (EN)</label>
                  <input name={`cat_${c.id}_name_en`} type="text" defaultValue={n.en} />
                </div>
                <div className="field">
                  <label>{t("Name")} (KA)</label>
                  <input name={`cat_${c.id}_name_ka`} type="text" defaultValue={n.ka} />
                </div>
              </div>

              <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
                <div className="field">
                  <label>{t("Icon")}</label>
                  <input name={`cat_${c.id}_icon`} type="text" defaultValue={c.icon ?? ""} />
                </div>
                <div className="field">
                  <label>{t("Type")}</label>
                  <select name={`cat_${c.id}_type`} defaultValue={c.type}>
                    <option value="food">{t("Food")}</option>
                    <option value="merch">{t("Merch")}</option>
                  </select>
                </div>
                <div className="field">
                  <label>{t("Sort")}</label>
                  <input name={`cat_${c.id}_order`} type="number" defaultValue={c.sortOrder} />
                </div>
                <div className="field" style={{ alignContent: "end" }}>
                  <div className="field-check">
                    <input type="checkbox" name={`cat_${c.id}_active`} defaultChecked={c.active} />
                    <label>{t("Enabled")}</label>
                  </div>
                </div>
              </div>

              {c.subcategories.length > 0 && (
                <table className="admin-table" style={{ marginTop: 12 }}>
                  <thead>
                    <tr>
                      <th>{t("Subcategory")} (EN)</th>
                      <th>(KA)</th>
                      <th style={{ width: 80 }}>{t("Sort")}</th>
                      <th style={{ width: 80 }}>{t("Enabled")}</th>
                      <th style={{ width: 70 }}>{t("Delete")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.subcategories.map((s) => {
                      const sn = i18nOf(s.name);
                      return (
                        <tr key={s.id}>
                          <td>
                            <input name={`sub_${s.id}_name_en`} type="text" defaultValue={sn.en} style={inp} />
                          </td>
                          <td>
                            <input name={`sub_${s.id}_name_ka`} type="text" defaultValue={sn.ka} style={inp} />
                          </td>
                          <td>
                            <input name={`sub_${s.id}_order`} type="number" defaultValue={s.sortOrder} style={inp} />
                          </td>
                          <td>
                            <input type="checkbox" name={`sub_${s.id}_active`} defaultChecked={s.active} />
                          </td>
                          <td>
                            <input type="checkbox" name={`sub_${s.id}_del`} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}

        <div className="form-actions">
          <button className="btn" type="submit">
            {t("Save all")}
          </button>
        </div>
      </form>

      {/* ── ქვე-კატეგორიის დამატება ── */}
      <div className="admin-panel" style={{ marginTop: 24 }}>
        <h2>{t("Add a subcategory")}</h2>
        {cats.map((c) => {
          const add = createSubcategory.bind(null, c.id);
          const n = i18nOf(c.name);
          return (
            <form key={c.id} action={add} style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 10 }}>
              <div className="field" style={{ minWidth: 150 }}>
                <label>{n.ka || n.en}</label>
                <input name="sub_name_en" type="text" placeholder="EN" style={inp} />
              </div>
              <div className="field" style={{ minWidth: 150 }}>
                <label>&nbsp;</label>
                <input name="sub_name_ka" type="text" placeholder="KA" style={inp} />
              </div>
              <button className="btn btn-ghost" type="submit">
                + {t("Add")}
              </button>
            </form>
          );
        })}
      </div>

      {/* ── ახალი კატეგორია ── */}
      <form className="admin-panel admin-form" action={createCategory} style={{ marginTop: 24 }}>
        <h2>{t("New category")}</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="name_en">{t("Name")} (EN)</label>
            <input id="name_en" name="name_en" type="text" required />
          </div>
          <div className="field">
            <label htmlFor="name_ka">{t("Name")} (KA)</label>
            <input id="name_ka" name="name_ka" type="text" />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="icon">{t("Icon")} (emoji)</label>
            <input id="icon" name="icon" type="text" />
          </div>
          <div className="field">
            <label htmlFor="type">{t("Type")}</label>
            <select id="type" name="type" defaultValue="food">
              <option value="food">{t("Food")}</option>
              <option value="merch">{t("Merch")}</option>
            </select>
          </div>
        </div>
        <div className="form-actions">
          <button className="btn" type="submit">
            {t("Create")}
          </button>
        </div>
      </form>

      {/* ── არქივი ── */}
      <div className="admin-panel" style={{ marginTop: 24 }}>
        <h2>{t("Move a category to the archive")}</h2>
        <p className="hint" style={{ marginBottom: 14 }}>
          {t("The number in brackets is the product count. To hide one for a while, use the “Enabled” switch.")}
        </p>
        <div style={{ display: "grid", gap: 12 }}>
          {cats.map((c) => {
            const n = i18nOf(c.name);
            const archive = archiveCategory.bind(null, c.id);
            const consequences = [
              c._count.products > 0
                ? `${c._count.products} ${t("products stay in the database but drop off the menu — move them to another category first if you still want to sell them.")}`
                : t("No products in it."),
              `${c.subcategories.length} ${t("subcategories are hidden with it.")}`,
              t("It disappears from the menu navigation."),
            ];
            return (
              <div key={c.id}>
                <ArchiveButton
                  action={archive}
                  subject={`${n.ka || n.en} (${c._count.products})`}
                  consequences={consequences}
                  label={`${n.ka || n.en} — ${t("Archive")}`}
                />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
