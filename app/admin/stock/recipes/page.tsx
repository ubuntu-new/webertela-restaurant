import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { fmtQty } from "@/lib/stock";

export const dynamic = "force-dynamic";

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();

  const recipes = await db.recipe.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: { outputItem: true, lines: { include: { item: true } }, _count: { select: { orders: true } } },
  });

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Production recipes")}</h1>
          <p>
            {recipes.length} {t("recipes")}
          </p>
        </div>
        <Link className="btn" href="/admin/stock/recipes/new">
          + {t("New recipe")}
        </Link>
      </div>

      {sp.archived && <div className="alert alert-ok">{t("Moved to the archive.")}</div>}

      <div className="admin-panel">
        <p className="hint" style={{ marginTop: 0 }}>
          {t("This is a")} <b>{t("warehouse")}</b>{" "}
          {t("recipe — raw material into a prep item. The menu recipe (“what a pizza uses”) is separate:")}{" "}
          <Link href="/admin/stock/consumption">{t("Consumption rules")}</Link>.
        </p>

        {recipes.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            {t("Nothing here yet.")}{" "}
            {t("Example: flour 15kg + water 9L + yeast 0.2kg → 100 dough balls.")}
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Recipe")}</th>
                <th>{t("Produces")}</th>
                <th style={{ width: 130 }}>{t("One run")}</th>
                <th style={{ width: 90 }}>{t("Inputs")}</th>
                <th style={{ width: 90 }}>{t("Batches")}</th>
                <th style={{ width: 100 }}>{t("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {recipes.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/admin/stock/recipes/${r.id}`}>{i18nText(r.name)}</Link>
                    <div className="hint">
                      {r.lines.map((l) => i18nText(l.item.name)).join(", ") || t("No inputs")}
                    </div>
                  </td>
                  <td>{i18nText(r.outputItem.name)}</td>
                  <td>{fmtQty(Number(r.outputQty), r.outputItem.unit)}</td>
                  <td>{r.lines.length}</td>
                  <td>{r._count.orders}</td>
                  <td>
                    <span className={r.active ? "badge badge-on" : "badge badge-off"}>
                      {r.active ? t("Active") : t("Disabled")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
