import Link from "next/link";
import { createCombo } from "../actions";
import { tr } from "@/lib/admin-i18n";

export const dynamic = "force-dynamic";

export default async function NewCombo() {
  const t = await tr();

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("New combo")}</h1>
          <p>{t("You'll fill in the slots after you create it")}</p>
        </div>
        <Link className="btn btn-ghost" href="/admin/combos">
          {t("Back to list")}
        </Link>
      </div>

      <form className="admin-panel admin-form" action={createCombo}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="name_en">{t("Name")} (EN)</label>
            <input id="name_en" name="name_en" type="text" required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="name_ka">{t("Name")} (KA)</label>
            <input id="name_ka" name="name_ka" type="text" />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="pricingMode">{t("Pricing")}</label>
            <select id="pricingMode" name="pricingMode" defaultValue="fixed">
              <option value="fixed">{t("Fixed price")}</option>
              <option value="discount">{t("Discount on the total")} (%)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="slots">{t("Number of slots")}</label>
            <input id="slots" name="slots" type="number" min="1" max="8" defaultValue="3" />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="price">{t("Fixed price")} (₾)</label>
            <input id="price" name="price" type="number" step="0.01" min="0" />
          </div>
          <div className="field">
            <label htmlFor="percent">{t("Discount")} (%)</label>
            <input id="percent" name="percent" type="number" step="0.01" min="0" max="100" />
          </div>
        </div>

        <div className="alert" style={{ background: "#fdf3d6", color: "#8a6a12" }}>
          <b>{t("A new combo is created disabled")}</b>.
        </div>

        <div className="form-actions">
          <button className="btn" type="submit">
            {t("Create and edit")}
          </button>
          <Link className="btn btn-ghost" href="/admin/combos">
            {t("Cancel")}
          </Link>
        </div>
      </form>
    </>
  );
}
