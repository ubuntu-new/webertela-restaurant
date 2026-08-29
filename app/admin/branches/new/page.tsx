import Link from "next/link";
import { createBranch } from "../actions";
import { tr } from "@/lib/admin-i18n";

export const dynamic = "force-dynamic";

export default async function NewBranch() {
  const t = await tr();

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("New branch")}</h1>
          <p>{t("POS terminals are created automatically from the code")}</p>
        </div>
        <Link className="btn btn-ghost" href="/admin/branches">
          {t("Back to list")}
        </Link>
      </div>

      <form className="admin-panel admin-form" action={createBranch}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="code">{t("Branch code")}</label>
            <input id="code" name="code" type="text" placeholder="TBS-06" required autoFocus />
            <span className="hint">{t("Must be unique. POS IDs are built from it.")}</span>
          </div>
          <div className="field">
            <label htmlFor="posCount">{t("POS terminals")}</label>
            <input id="posCount" name="posCount" type="number" min="1" max="10" defaultValue="2" />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="name_en">{t("Name (EN)")}</label>
            <input id="name_en" name="name_en" type="text" required />
          </div>
          <div className="field">
            <label htmlFor="name_ka">{t("Name (KA)")}</label>
            <input id="name_ka" name="name_ka" type="text" />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="address_en">{t("Address (EN)")}</label>
            <input id="address_en" name="address_en" type="text" />
          </div>
          <div className="field">
            <label htmlFor="address_ka">{t("Address (KA)")}</label>
            <input id="address_ka" name="address_ka" type="text" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="phone">{t("Phone")}</label>
          <input id="phone" name="phone" type="text" />
        </div>

        <div className="alert" style={{ background: "#fdf3d6", color: "#8a6a12" }}>
          {t("A new branch starts closed — it takes no orders until you open it.")}
        </div>

        <div className="form-actions">
          <button className="btn" type="submit">
            {t("Create and edit")}
          </button>
          <Link className="btn btn-ghost" href="/admin/branches">
            {t("Cancel")}
          </Link>
        </div>
      </form>
    </>
  );
}
