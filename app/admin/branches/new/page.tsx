import Link from "next/link";
import { createBranch } from "../actions";
import { tr } from "@/lib/admin-i18n";
import AdminForm from "@/app/admin/_components/AdminForm";
import NameField from "@/app/admin/_components/NameField";

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

      <AdminForm
        className="admin-panel admin-form"
        action={createBranch}
        submitLabel={t("Create and edit")}
        cancelHref="/admin/branches"
      >
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
          <NameField
            model="branch"
            name="name_en"
            label={t("Name (EN)")}
            required
          />
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

      </AdminForm>
    </>
  );
}
