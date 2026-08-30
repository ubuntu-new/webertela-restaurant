import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";

export const dynamic = "force-dynamic";

export default async function BranchesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; archived?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();

  const branches = await db.branch.findMany({
    where: { deletedAt: null },
    orderBy: { sortOrder: "asc" },
    include: { terminals: true },
  });

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Branches")}</h1>
          <p>
            {branches.length} {t("branches")} ·{" "}
            {branches.reduce((n, b) => n + b.terminals.length, 0)} {t("POS terminals")}
          </p>
        </div>
        <Link className="btn" href="/admin/branches/new">
          + {t("New branch")}
        </Link>
      </div>

      {sp.error && <div className="alert alert-error">{sp.error}</div>}
      {sp.saved && <div className="alert alert-ok">{t("Saved.")}</div>}
      {sp.archived && (
        <div className="alert alert-ok">{t("Moved to the archive. Restore it from the Archive page.")}</div>
      )}

      <div className="admin-panel">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Code")}</th>
              <th>{t("Name")}</th>
              <th>{t("Address")}</th>
              <th>{t("Phone")}</th>
              <th>POS</th>
              <th>{t("Status")}</th>
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.id}>
                <td>
                  <code>{b.code}</code>
                </td>
                <td>
                  <Link href={`/admin/branches/${b.id}`}>{i18nText(b.name)}</Link>
                </td>
                <td>
                  <span className="hint">{i18nText(b.address)}</span>
                </td>
                <td>{b.phone ?? "—"}</td>
                <td>
                  {b.terminals.filter((term) => term.active).length}/{b.terminals.length}
                </td>
                <td>
                  <span className={b.active ? "badge badge-on" : "badge badge-off"}>
                    {b.active ? t("Open") : t("Closed")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
