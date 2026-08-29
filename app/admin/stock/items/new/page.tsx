import Link from "next/link";
import { tr } from "@/lib/admin-i18n";
import { createStockItem } from "../../actions";

export const dynamic = "force-dynamic";

export default async function NewStockItem() {
  const t = await tr();

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("New stock item")}</h1>
          <p>{t("You set the minimums after you create it")}</p>
        </div>
        <Link className="btn btn-ghost" href="/admin/stock/items">
          {t("Back to list")}
        </Link>
      </div>

      <form className="admin-panel admin-form" action={createStockItem}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="name_en">{t("Name")} (EN)</label>
            <input id="name_en" name="name_en" type="text" required autoFocus placeholder="Mozzarella" />
          </div>
          <div className="field">
            <label htmlFor="name_ka">{t("Name")} (KA)</label>
            <input id="name_ka" name="name_ka" type="text" placeholder={t("Mozzarella")} />
          </div>
        </div>

        <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div className="field">
            <label htmlFor="unit">{t("Unit")}</label>
            <select id="unit" name="unit" defaultValue="kg">
              <option value="kg">{t("Kilogram")}</option>
              <option value="g">{t("Gram")}</option>
              <option value="l">{t("Liter")}</option>
              <option value="ml">{t("Milliliter")}</option>
              <option value="pcs">{t("Each")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="category">{t("Group")}</label>
            <input id="category" name="category" type="text" placeholder="dairy / meat / veg" />
          </div>
          <div className="field">
            <label htmlFor="sku">SKU</label>
            <input id="sku" name="sku" type="text" placeholder={t("optional")} />
          </div>
        </div>

        <div className="field-check">
          <input id="isProduced" name="isProduced" type="checkbox" />
          <label htmlFor="isProduced">{t("Made in-house from a recipe (dough, sauce)")}</label>
        </div>

        <div className="field">
          <label htmlFor="note">{t("Note")}</label>
          <input id="note" name="note" type="text" />
        </div>

        <p className="hint">
          <b>{t("Picking the right unit matters")}</b>{" "}
          {t(
            "— recipes are written in the same unit. If you keep mozzarella in kilograms, the recipe is in kilograms too (0.18 kg).",
          )}
        </p>

        <div className="form-actions">
          <button className="btn" type="submit">
            {t("Create")}
          </button>
          <Link className="btn btn-ghost" href="/admin/stock/items">
            {t("Cancel")}
          </Link>
        </div>
      </form>
    </>
  );
}
