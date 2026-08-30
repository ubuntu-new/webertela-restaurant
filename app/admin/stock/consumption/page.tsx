import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { addRule, saveRules } from "./actions";
import AdminForm from "@/app/admin/_components/AdminForm";

export const dynamic = "force-dynamic";

const inp: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--a-line)",
  borderRadius: 6,
  font: "inherit",
};

export default async function ConsumptionPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; owner?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();

  const [items, products, toppings, rules] = await Promise.all([
    db.stockItem.findMany({ where: { deletedAt: null, active: true }, orderBy: { category: "asc" } }),
    db.product.findMany({
      where: { deletedAt: null },
      orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }],
      include: { category: true },
    }),
    db.topping.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    db.consumptionRule.findMany({ include: { item: true, product: true, topping: true } }),
  ]);

  const productRules = rules.filter((r) => r.productId);
  const toppingRules = rules.filter((r) => r.toppingId);

  const withRules = new Set([
    ...productRules.map((r) => r.productId!),
    ...toppingRules.map((r) => r.toppingId!),
  ]);

  const covered = products.filter((p) => withRules.has(p.id)).length;
  const coveredT = toppings.filter((tp) => withRules.has(tp.id)).length;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Consumption rules")}</h1>
          <p>
            {rules.length} {t("rules")} · {t("Products")} {covered}/{products.length} · {t("Toppings")}{" "}
            {coveredT}/{toppings.length}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link className="btn" href="/admin/stock/consumption/bulk">
            {t("Bulk fill toppings")}
          </Link>
          <Link className="btn btn-ghost" href="/admin/stock">
            ← {t("Stock")}
          </Link>
        </div>
      </div>

      {sp.saved && <div className="alert alert-ok">{t("Saved.")}</div>}

      {items.length === 0 && (
        <div className="alert alert-error">
          {t("No stock items yet.")}{" "}
          <Link href="/admin/stock/items/new">{t("Add them first →")}</Link>
        </div>
      )}

      <div className="admin-panel">
        <h2>{t("How it works")}</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "var(--a-muted)" }}>
          <li>
            <b>{t("On a product")}</b>{" "}
            {t("you put the base — dough, sauce, box. On a Coke — the Coke itself, 1 each.")}
          </li>
          <li>
            <b>{t("On a topping")}</b>{" "}
            {t(
              "you put what it uses — mozzarella 0.18 kg. Pizza ingredients are toppings, so you don't enter them separately.",
            )}
          </li>
          <li>{t("Blank size = the same on every size. A specific size overrides the general one.")}</li>
          <li>
            {t("Quantity is in the unit the")} <b>{t("stock item")}</b>{" "}
            {t("has — if you keep it in kilograms, enter kilograms here too (0.18).")}
          </li>
          <li>{t("A missing rule doesn't hold up an order — that line simply won't touch stock.")}</li>
        </ul>
      </div>

      {/* ── ახალი წესი ── */}
      <AdminForm
        className="admin-panel admin-form"
        style={{ maxWidth: "none" }}
        action={addRule}
        submitLabel={t("Add")}
      >
        <h2>{t("Add a rule")}</h2>

        <div className="field-row" style={{ gridTemplateColumns: "2fr 2fr 1fr 1fr" }}>
          <div className="field">
            <label htmlFor="owner">{t("Applies to")}</label>
            <select id="owner" name="owner" defaultValue={sp.owner ?? ""} required>
              <option value="">{t("— select —")}</option>
              <optgroup label={t("Topping")}>
                {toppings.map((tp) => (
                  <option key={tp.id} value={`topping:${tp.id}`}>
                    {i18nText(tp.name)}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t("Product")}>
                {products.map((p) => (
                  <option key={p.id} value={`product:${p.id}`}>
                    {i18nText(p.name)} · {i18nText(p.category.name)}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="field">
            <label htmlFor="itemId">{t("Stock item")}</label>
            <select id="itemId" name="itemId" required>
              <option value="">{t("— select —")}</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {i18nText(it.name)} ({it.unit})
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="qty">{t("Quantity")}</label>
            <input id="qty" name="qty" type="number" step="0.001" min="0" required />
          </div>

          <div className="field">
            <label htmlFor="sizeKey">{t("Size")}</label>
            <select id="sizeKey" name="sizeKey" defaultValue="">
              <option value="">{t("All")}</option>
              <option value="S">S</option>
              <option value="M">M</option>
              <option value="XL">XL</option>
            </select>
          </div>
        </div>

      </AdminForm>

      {/* ── არსებული წესები ── */}
      {/* A form with a Save button and nothing to save is a button that lies.
          When there are no rules yet, the panels are shown without one. */}
      <AdminForm
        className=""
        action={saveRules}
        submitLabel={rules.length > 0 ? t("Save changes") : ""}
        hideSubmit={rules.length === 0}
      >
        <div className="admin-panel">
          <h2>
            {t("Toppings")} ({toppingRules.length})
          </h2>
          {toppingRules.length === 0 ? (
            <p className="hint" style={{ margin: 0 }}>
              {t("None yet. Start with mozzarella — it's on almost every pizza.")}
            </p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Topping")}</th>
                  <th>{t("Uses")}</th>
                  <th style={{ width: 90 }}>{t("Size")}</th>
                  <th style={{ width: 130 }}>{t("Quantity")}</th>
                  <th style={{ width: 70 }}>{t("Delete")}</th>
                </tr>
              </thead>
              <tbody>
                {toppingRules.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {i18nText(r.topping!.name)}
                      <input type="hidden" name="rule" value={r.id} />
                    </td>
                    <td>{i18nText(r.item.name)}</td>
                    <td>
                      <span className="hint">{r.sizeKey ?? t("All")}</span>
                    </td>
                    <td>
                      <input
                        name={`qty_${r.id}`}
                        type="number"
                        step="0.001"
                        min="0"
                        defaultValue={Number(r.qty)}
                        style={inp}
                      />
                      <span className="hint">{r.item.unit}</span>
                    </td>
                    <td>
                      <input type="checkbox" name={`del_${r.id}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="admin-panel">
          <h2>
            {t("Products")} ({productRules.length})
          </h2>
          {productRules.length === 0 ? (
            <p className="hint" style={{ margin: 0 }}>
              {t("None yet. On a pizza put dough and sauce; on a drink — the drink itself.")}
            </p>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Product")}</th>
                  <th>{t("Uses")}</th>
                  <th style={{ width: 90 }}>{t("Size")}</th>
                  <th style={{ width: 130 }}>{t("Quantity")}</th>
                  <th style={{ width: 70 }}>{t("Delete")}</th>
                </tr>
              </thead>
              <tbody>
                {productRules.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {i18nText(r.product!.name)}
                      <input type="hidden" name="rule" value={r.id} />
                    </td>
                    <td>{i18nText(r.item.name)}</td>
                    <td>
                      <span className="hint">{r.sizeKey ?? t("All")}</span>
                    </td>
                    <td>
                      <input
                        name={`qty_${r.id}`}
                        type="number"
                        step="0.001"
                        min="0"
                        defaultValue={Number(r.qty)}
                        style={inp}
                      />
                      <span className="hint">{r.item.unit}</span>
                    </td>
                    <td>
                      <input type="checkbox" name={`del_${r.id}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </AdminForm>
    </>
  );
}
