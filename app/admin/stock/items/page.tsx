import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { fmtQty } from "@/lib/stock";
import { tr } from "@/lib/admin-i18n";

export const dynamic = "force-dynamic";

export default async function StockItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; archived?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();

  const items = await db.stockItem.findMany({
    where: { deletedAt: null },
    orderBy: [{ category: "asc" }, { createdAt: "asc" }],
    include: { levels: true },
  });

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Stock items")}</h1>
          <p>
            {items.length} {t("records")}
          </p>
        </div>
        <Link className="btn" href="/admin/stock/items/new">
          + {t("New item")}
        </Link>
      </div>

      {sp.saved && <div className="alert alert-ok">{t("Saved.")}</div>}
      {sp.archived && <div className="alert alert-ok">{t("Moved to the archive.")}</div>}

      <div className="admin-panel">
        <p className="hint" style={{ marginTop: 0 }}>
          {t("This is what you keep — not what you sell. A pizza is not here; mozzarella, dough and flour are.")}
        </p>

        {items.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            {t("Nothing here yet.")}
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Name")}</th>
                <th style={{ width: 90 }}>SKU</th>
                <th style={{ width: 90 }}>{t("Unit")}</th>
                <th style={{ width: 100 }}>{t("Group")}</th>
                <th style={{ width: 130 }}>{t("On hand")}</th>
                <th style={{ width: 110 }}>{t("Origin")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const total = it.levels.reduce((s, l) => s + Number(l.qty), 0);
                return (
                  <tr key={it.id}>
                    <td>
                      <Link href={`/admin/stock/items/${it.id}`}>{i18nText(it.name)}</Link>
                      {!it.active && <div className="hint">{t("Disabled")}</div>}
                    </td>
                    <td>
                      <span className="hint">{it.sku ?? "—"}</span>
                    </td>
                    <td>{it.unit}</td>
                    <td>
                      <span className="hint">{it.category ?? "—"}</span>
                    </td>
                    <td>{fmtQty(total, it.unit)}</td>
                    <td>
                      <span className="badge badge-off">
                        {it.isProduced ? t("Produced") : t("Purchased")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
