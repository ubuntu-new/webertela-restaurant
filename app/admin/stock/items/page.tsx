import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { fmtQty } from "@/lib/stock";
import { tr } from "@/lib/admin-i18n";
import { findExistingDuplicateGroups } from "@/lib/dup";

export const dynamic = "force-dynamic";

export default async function StockItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; archived?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();

  const [items, dupGroups] = await Promise.all([
    db.stockItem.findMany({
      where: { deletedAt: null },
      orderBy: [{ category: "asc" }, { createdAt: "asc" }],
      include: { levels: true },
    }),
    findExistingDuplicateGroups("stockItem"),
  ]);

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

      {/* Not buried in a menu: a split ingredient is corrupting the food-cost
          figure right now, and the person who can fix it is the one reading
          this list. */}
      {dupGroups.length > 0 && (
        <div className="dup-warn">
          <div className="dup-warn-head">
            <b>
              {dupGroups.length}{" "}
              {dupGroups.length === 1
                ? t("ingredient appears more than once")
                : t("ingredients appear more than once")}
            </b>
            <p>
              {t(
                "Your stock for these is split across two rows, so recipes use one and deliveries land on the other. Food cost is understated until they are merged.",
              )}
            </p>
          </div>
          <div className="dup-actions">
            <Link className="btn btn-warn" href="/admin/stock/duplicates">
              {t("Review and merge")}
            </Link>
          </div>
        </div>
      )}

      {/* An empty stock list is the wall every new restaurant hits. Meeting it
          with an explanation of what a stock item is helps nobody; meeting it
          with forty of them, already filled in, is the whole point. */}
      {items.length === 0 && (
        <div className="starter-nudge">
          <b>{t("Start from a kind of place instead of an empty list")}</b>
          <p>
            {t(
              "Pizzeria, burgers, coffee bar — the ingredients, units and portions every kitchen of that kind already has, filled in for you. Your menu and prices stay yours, and all of it can be taken back out.",
            )}
          </p>
          <Link className="btn" href="/admin/setup/starter">
            {t("Choose a kind of place")}
          </Link>
        </div>
      )}

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
