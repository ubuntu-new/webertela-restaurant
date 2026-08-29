import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { fmtQty } from "@/lib/stock";
import { tr } from "@/lib/admin-i18n";
import { fmt } from "@/lib/format";
import { finishProduction, cancelProduction } from "../actions";
import { PSTATUS } from "../status";

export const dynamic = "force-dynamic";

const inp: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--a-line)",
  borderRadius: 6,
  font: "inherit",
};

export default async function ProductionDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await tr();
  const f = await fmt();

  const o = await db.productionOrder.findUnique({
    where: { id },
    include: {
      recipe: { include: { outputItem: true } },
      location: true,
      lines: { include: { item: true } },
    },
  });
  if (!o) notFound();

  // ვინ რა გააკეთა
  const actorIds = [o.startedById, o.finishedById, o.cancelledById].filter((x): x is string => !!x);
  const actors = actorIds.length
    ? await db.employee.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = (eid: string | null) => (eid ? actors.find((a) => a.id === eid)?.name ?? eid : "—");

  // ნაშთები ამ ლოკაციაზე — ჰყოფნის თუ არა
  const levels = await db.stockLevel.findMany({
    where: { locationId: o.locationId, itemId: { in: o.lines.map((l) => l.itemId) } },
  });
  const haveAt = new Map(levels.map((l) => [l.itemId, Number(l.qty)]));

  const planned = Number(o.plannedQty);
  const actual = o.actualQty != null ? Number(o.actualQty) : null;
  const pct = actual != null && planned > 0 ? Math.round((actual / planned) * 1000) / 10 : null;
  const unit = o.recipe.outputItem.unit;

  const finish = finishProduction.bind(null, id);
  const cancel = cancelProduction.bind(null, id);

  const stages = [
    { label: t("Start"), by: o.startedById, at: o.startedAt },
    { label: t("Finish"), by: o.finishedById, at: o.finishedAt },
    { label: t("Cancel"), by: o.cancelledById, at: o.cancelledAt },
  ].filter((s) => s.at);

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>
            {t("Production")} #{o.no}
          </h1>
          <p>
            {i18nText(o.recipe.name)} · {i18nText(o.location.name)} ·{" "}
            {PSTATUS[o.status] ? t(PSTATUS[o.status]) : o.status}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/stock/production">
          {t("Back to list")}
        </Link>
      </div>

      {sp.ok && <div className="alert alert-ok">{t("Done.")}</div>}

      <div className="admin-panel">
        <h2>{t("Result")}</h2>
        <table className="admin-table">
          <tbody>
            <tr>
              <td style={{ width: 200 }}>{t("Runs")}</td>
              <td>{Number(o.batches)}</td>
            </tr>
            <tr>
              <td>{t("Planned")}</td>
              <td>
                {fmtQty(planned, unit)} {i18nText(o.recipe.outputItem.name)}
              </td>
            </tr>
            <tr>
              <td>{t("Actual")}</td>
              <td>
                {actual != null ? (
                  fmtQty(actual, unit)
                ) : (
                  <span className="hint">{t("Not finished yet")}</span>
                )}
              </td>
            </tr>
            {pct != null && (
              <tr>
                <td>{t("Yield")}</td>
                <td>
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
                  {pct < 95 && (
                    <span className="hint">
                      {" "}
                      — {t("short by")}{" "}
                      {fmtQty(Math.round((planned - (actual ?? 0)) * 1000) / 1000, unit)}
                    </span>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {o.note && (
          <p className="hint" style={{ marginTop: 10 }}>
            {t("Note")}: {o.note}
          </p>
        )}
      </div>

      <div className="admin-panel">
        <h2>{t("Stages")}</h2>
        <table className="admin-table">
          <tbody>
            {stages.map((s) => (
              <tr key={s.label}>
                <td style={{ width: 150 }}>{s.label}</td>
                <td style={{ width: 200 }}>{nameOf(s.by)}</td>
                <td>
                  <span className="hint">{f.dateTime(s.at)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-panel">
        <h2>{t("Ingredients")}</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Item")}</th>
              <th style={{ width: 130 }}>{t("Planned")}</th>
              <th style={{ width: 130 }}>{t("Used")}</th>
              <th style={{ width: 140 }}>{t("On hand here")}</th>
            </tr>
          </thead>
          <tbody>
            {o.lines.map((l) => {
              const p = Number(l.qtyPlanned);
              const u = l.qtyUsed != null ? Number(l.qtyUsed) : null;
              const have = haveAt.get(l.itemId) ?? 0;
              const short = o.status === "in_progress" && have < p;
              const over = u != null && u > p;

              return (
                <tr key={l.id}>
                  <td>
                    <Link href={`/admin/stock/items/${l.itemId}`}>{i18nText(l.item.name)}</Link>
                  </td>
                  <td>{fmtQty(p, l.item.unit)}</td>
                  <td>
                    {u != null ? (
                      <b style={over ? { color: "var(--a-danger)" } : undefined}>
                        {fmtQty(u, l.item.unit)}
                      </b>
                    ) : (
                      <span className="hint">—</span>
                    )}
                  </td>
                  <td>
                    <span
                      className="hint"
                      style={short ? { color: "var(--a-danger)", fontWeight: 600 } : undefined}
                    >
                      {fmtQty(have, l.item.unit)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {o.status === "in_progress" && (
        <>
          <form className="admin-panel admin-form" action={finish} style={{ maxWidth: "none" }}>
            <h2>{t("Finish")}</h2>
            <p className="hint" style={{ marginTop: -8 }}>
              {t("This button does the whole move: the ingredients are")} <b>{t("written off")}</b>
              {t(", the product is")} <b>{t("added")}</b>
              {t(". Enter the real numbers — if they do not match the plan, the difference is recorded and stays visible.")}
            </p>

            <div className="field" style={{ maxWidth: 320 }}>
              <label htmlFor="actualQty">
                {t("Actual output")} ({i18nText(o.recipe.outputItem.name)})
              </label>
              <input
                id="actualQty"
                name="actualQty"
                type="number"
                step="0.001"
                min="0"
                defaultValue={planned}
                required
              />
              <span className="hint">
                {t("Planned")}: {fmtQty(planned, unit)}
              </span>
            </div>

            <table className="admin-table" style={{ marginTop: 14 }}>
              <thead>
                <tr>
                  <th>{t("Ingredient")}</th>
                  <th style={{ width: 140 }}>{t("Planned")}</th>
                  <th style={{ width: 170 }}>{t("Actually used")}</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{i18nText(l.item.name)}</td>
                    <td>
                      <span className="hint">{fmtQty(Number(l.qtyPlanned), l.item.unit)}</span>
                    </td>
                    <td>
                      <input
                        name={`used_${l.id}`}
                        type="number"
                        step="0.001"
                        min="0"
                        defaultValue={Number(l.qtyPlanned)}
                        style={inp}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="form-actions" style={{ marginTop: 16 }}>
              <button className="btn" type="submit">
                {t("Finish and write off")}
              </button>
            </div>
          </form>

          <form action={cancel} style={{ marginTop: 16 }}>
            <button
              className="btn btn-ghost"
              type="submit"
              style={{ color: "var(--a-danger)", borderColor: "#f3d5d2" }}
            >
              {t("Cancel batch (stock is untouched)")}
            </button>
          </form>
        </>
      )}
    </>
  );
}
