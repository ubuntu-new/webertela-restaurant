import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { fmtQty } from "@/lib/stock";
import { tr } from "@/lib/admin-i18n";
import { PSTATUS, PTONE } from "./status";

export const dynamic = "force-dynamic";

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();

  const [orders, counts] = await Promise.all([
    db.productionOrder.findMany({
      where: sp.status ? { status: sp.status as never } : undefined,
      orderBy: { startedAt: "desc" },
      take: 100,
      include: { recipe: { include: { outputItem: true } }, location: true },
    }),
    db.productionOrder.groupBy({ by: ["status"], _count: true }),
  ]);

  const countOf = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Production")}</h1>
          <p>
            {orders.length} {t("shown")} · {countOf("in_progress")} {t("in progress")}
          </p>
        </div>
        <Link className="btn" href="/admin/stock/production/new">
          + {t("Start a batch")}
        </Link>
      </div>

      <div className="admin-panel">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className={sp.status ? "btn btn-ghost" : "btn"} href="/admin/stock/production">
            {t("All")}
          </Link>
          {Object.keys(PSTATUS).map((s) => (
            <Link
              key={s}
              className={sp.status === s ? "btn" : "btn btn-ghost"}
              href={`/admin/stock/production?status=${s}`}
            >
              {t(PSTATUS[s])} {countOf(s) > 0 && `(${countOf(s)})`}
            </Link>
          ))}
          <Link className="btn btn-ghost" href="/admin/stock/recipes">
            {t("Recipes")}
          </Link>
        </div>
      </div>

      <div className="admin-panel">
        {orders.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            {t("No batches yet. First create a")}{" "}
            <Link href="/admin/stock/recipes">{t("recipe")}</Link>.
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>№</th>
                <th>{t("Recipe")}</th>
                <th>{t("Location")}</th>
                <th style={{ width: 110 }}>{t("Planned")}</th>
                <th style={{ width: 110 }}>{t("Actual")}</th>
                <th style={{ width: 100 }}>{t("Yield")}</th>
                <th style={{ width: 110 }}>{t("Status")}</th>
                <th style={{ width: 150 }}>{t("Started")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const planned = Number(o.plannedQty);
                const actual = o.actualQty != null ? Number(o.actualQty) : null;
                const pct = actual != null && planned > 0 ? Math.round((actual / planned) * 1000) / 10 : null;
                const unit = o.recipe.outputItem.unit;

                return (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/admin/stock/production/${o.id}`}>
                        <b>#{o.no}</b>
                      </Link>
                    </td>
                    <td>
                      {i18nText(o.recipe.name)}
                      <div className="hint">{i18nText(o.recipe.outputItem.name)}</div>
                    </td>
                    <td>{i18nText(o.location.name)}</td>
                    <td>{fmtQty(planned, unit)}</td>
                    <td>
                      {actual != null ? fmtQty(actual, unit) : <span className="hint">—</span>}
                    </td>
                    <td>
                      {pct != null ? (
                        <span
                          className="badge"
                          style={
                            pct < 95
                              ? { background: "#fdecea", color: "#b3261e" }
                              : { background: "#e8f2e8", color: "#3f7d3f" }
                          }
                        >
                          {pct}%
                        </span>
                      ) : (
                        <span className="hint">—</span>
                      )}
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={PTONE[o.status] ?? { background: "#f5f5f4", color: "#78716c" }}
                      >
                        {PSTATUS[o.status] ? t(PSTATUS[o.status]) : o.status}
                      </span>
                    </td>
                    <td>
                      <span className="hint">{new Date(o.startedAt).toLocaleString("ka-GE")}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="admin-panel">
        <h2>{t("Yield")}</h2>
        <p className="hint" style={{ margin: 0 }}>
          {t("The recipe says 100 dough balls, you got 88 —")} <b>88%</b>.{" "}
          {t(
            "If that number keeps coming in low, either the recipe is off or something is being lost along the way. That is exactly why planned and actual are kept apart.",
          )}
        </p>
      </div>
    </>
  );
}
