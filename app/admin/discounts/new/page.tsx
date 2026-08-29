import Link from "next/link";
import { createDiscount } from "../actions";
import { tr } from "@/lib/admin-i18n";

export const dynamic = "force-dynamic";

export default async function NewDiscount() {
  const t = await tr();

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("New discount")}</h1>
          <p>{t("You add the rules after you create it")}</p>
        </div>
        <Link className="btn btn-ghost" href="/admin/discounts">
          {t("Back to list")}
        </Link>
      </div>

      <form className="admin-panel admin-form" action={createDiscount}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="name_en">{t("Name (EN)")}</label>
            <input id="name_en" name="name_en" type="text" required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="name_ka">{t("Name (KA)")}</label>
            <input id="name_ka" name="name_ka" type="text" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="type">{t("Type")}</label>
          <select id="type" name="type" defaultValue="custom">
            <option value="student">{t("Student")}</option>
            <option value="diplomatic">{t("Diplomatic")}</option>
            <option value="employee">{t("Employee")}</option>
            <option value="loyalty">{t("Loyalty")}</option>
            <option value="promo">{t("Promo")}</option>
            <option value="custom">{t("Other")}</option>
          </select>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="defaultMode">{t("Default type")}</label>
            <select id="defaultMode" name="defaultMode" defaultValue="percent">
              <option value="percent">{t("Percent (%)")}</option>
              <option value="fixed">{t("Fixed")} (₾)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="defaultValue">{t("Default amount")}</label>
            <input id="defaultValue" name="defaultValue" type="number" step="0.01" min="0" defaultValue="0" />
          </div>
        </div>

        <div className="field-check">
          <input id="requiresVerification" name="requiresVerification" type="checkbox" />
          <label htmlFor="requiresVerification">{t("Verification required (student, diplomat)")}</label>
        </div>

        <div className="alert" style={{ background: "#fdf3d6", color: "#8a6a12" }}>
          {t("A new discount is created disabled.")}
        </div>

        <div className="form-actions">
          <button className="btn" type="submit">
            {t("Create and edit")}
          </button>
          <Link className="btn btn-ghost" href="/admin/discounts">
            {t("Cancel")}
          </Link>
        </div>
      </form>
    </>
  );
}
