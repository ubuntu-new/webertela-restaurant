import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  branch_manager: "Branch manager",
  cashier: "Cashier",
  kitchen: "Kitchen",
  driver: "Driver",
};

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; archived?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();

  const employees = await db.employee.findMany({
    where: { deletedAt: null },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    include: { branches: { include: { branch: true } } },
  });

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Staff")}</h1>
          <p>
            {employees.length} {t("records")}
          </p>
        </div>
        <Link className="btn" href="/admin/employees/new">
          + {t("New employee")}
        </Link>
      </div>

      {sp.saved && <div className="alert alert-ok">{t("Saved.")}</div>}
      {sp.archived && (
        <div className="alert alert-ok">{t("Moved to the archive. Restore it from the Archive page.")}</div>
      )}

      <div className="admin-panel">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Full name")}</th>
              <th>{t("Role")}</th>
              <th>{t("Branches")}</th>
              <th>{t("Login")}</th>
              <th>POS PIN</th>
              <th>{t("Status")}</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link href={`/admin/employees/${e.id}`}>{e.name}</Link>
                  {e.title && <div className="hint">{e.title}</div>}
                </td>
                <td>{t(ROLE_LABEL[e.role] ?? e.role)}</td>
                <td>
                  <span className="hint">
                    {e.branches.length
                      ? e.branches.map((b) => i18nText(b.branch.name)).join(", ")
                      : "—"}
                  </span>
                </td>
                <td>
                  {e.email ? (
                    <span className="hint">{e.email}</span>
                  ) : (
                    <span className="hint">—</span>
                  )}
                </td>
                <td>
                  <span className={e.posPinHash ? "badge badge-on" : "badge badge-off"}>
                    {e.posPinHash ? t("Set") : t("Not set")}
                  </span>
                </td>
                <td>
                  <span className={e.active ? "badge badge-on" : "badge badge-off"}>
                    {e.active ? t("Active") : t("Disabled")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-panel">
        <h2>{t("How access works")}</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "var(--a-muted)" }}>
          <li>
            <b>{t("Admin panel")}</b> — {t("email + password. Without a password they cannot sign in.")}
          </li>
          <li>
            <b>POS</b> — {t("a 4–8 digit PIN. Every one is unique.")}
          </li>
          <li>
            <b>super_admin</b> {t("has every permission automatically — nothing to tick.")}
          </li>
          <li>{t("Turning off the last active super_admin is blocked.")}</li>
        </ul>
      </div>
    </>
  );
}
