import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { createEmployee } from "../actions";
import { PERMISSIONS } from "@/lib/permissions";
import { tr } from "@/lib/admin-i18n";

export const dynamic = "force-dynamic";

const cell: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 14 };

export default async function NewEmployee() {
  const t = await tr();
  const branches = await db.branch.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } });

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("New employee")}</h1>
          <p>{t("You set the PIN after you create them")}</p>
        </div>
        <Link className="btn btn-ghost" href="/admin/employees">
          {t("Back to list")}
        </Link>
      </div>

      <form className="admin-form" action={createEmployee} style={{ maxWidth: 880 }}>
        <div className="admin-panel">
          <h2>{t("Basics")}</h2>
          <div className="field-row">
            <div className="field">
              <label htmlFor="name">{t("Full name")}</label>
              <input id="name" name="name" type="text" required autoFocus />
            </div>
            <div className="field">
              <label htmlFor="title">{t("Job title")}</label>
              <input id="title" name="title" type="text" />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="phone">{t("Phone")}</label>
              <input id="phone" name="phone" type="text" />
            </div>
            <div className="field">
              <label htmlFor="role">{t("Role")}</label>
              <select id="role" name="role" defaultValue="cashier">
                <option value="branch_manager">{t("Branch manager")}</option>
                <option value="cashier">{t("Cashier")}</option>
                <option value="kitchen">{t("Kitchen")}</option>
                <option value="driver">{t("Driver")}</option>
                <option value="super_admin">{t("Super admin")}</option>
              </select>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="email">{t("Email")}</label>
              <input id="email" name="email" type="text" />
              <span className="hint">{t("Only if they need to sign in to the admin panel.")}</span>
            </div>
            <div className="field">
              <label htmlFor="password">{t("Password")}</label>
              <input id="password" name="password" type="text" placeholder={t("at least 10 characters")} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="hourlyRate">{t("Hourly rate")} (₾)</label>
            <input id="hourlyRate" name="hourlyRate" type="number" step="0.01" min="0" />
          </div>
        </div>

        <div className="admin-panel">
          <h2>{t("Permissions")}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
            {PERMISSIONS.map((p) => (
              <label key={p.id} style={cell}>
                <input type="checkbox" name="perm" value={p.id} />
                <span>{p.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="admin-panel">
          <h2>{t("Branches")}</h2>
          <div className="field">
            <label htmlFor="homeBranchId">{t("Home branch")}</label>
            <select id="homeBranchId" name="homeBranchId" defaultValue="">
              <option value="">—</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {i18nText(b.name)} · {b.code}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t("Can work at")}</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
              {branches.map((b) => (
                <label key={b.id} style={cell}>
                  <input type="checkbox" name="branch" value={b.id} />
                  <span>
                    {i18nText(b.name)} <span className="hint">· {b.code}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button className="btn" type="submit">
            {t("Create")}
          </button>
          <Link className="btn btn-ghost" href="/admin/employees">
            {t("Cancel")}
          </Link>
        </div>
      </form>
    </>
  );
}
