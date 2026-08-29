import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { fmtQty } from "@/lib/stock";
import { tr } from "@/lib/admin-i18n";
import { startProduction } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewProduction() {
  const t = await tr();

  const [recipes, locations, levels] = await Promise.all([
    db.recipe.findMany({
      where: { deletedAt: null, active: true },
      orderBy: { createdAt: "asc" },
      include: { outputItem: true, lines: { include: { item: true } } },
    }),
    db.stockLocation.findMany({ where: { deletedAt: null, active: true }, orderBy: { type: "asc" } }),
    db.stockLevel.findMany(),
  ]);

  const warehouse = locations.find((l) => l.type === "warehouse");

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Start a batch")}</h1>
          <p>{t("Stock does not move yet — it comes off when you finish")}</p>
        </div>
        <Link className="btn btn-ghost" href="/admin/stock/production">
          {t("Back to list")}
        </Link>
      </div>

      {recipes.length === 0 ? (
        <div className="admin-panel">
          <p className="hint" style={{ margin: 0 }}>
            {t("No active recipes.")}{" "}
            <Link href="/admin/stock/recipes/new">{t("Create a recipe first →")}</Link>
          </p>
        </div>
      ) : (
        <>
          <form className="admin-panel admin-form" action={startProduction}>
            <div className="field-row">
              <div className="field">
                <label htmlFor="recipeId">{t("Recipe")}</label>
                <select id="recipeId" name="recipeId" required>
                  {recipes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {i18nText(r.name)} → {fmtQty(Number(r.outputQty), r.outputItem.unit)}{" "}
                      {i18nText(r.outputItem.name)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="locationId">{t("Where")}</label>
                <select id="locationId" name="locationId" defaultValue={warehouse?.id ?? ""} required>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {i18nText(l.name)}
                      {l.type === "warehouse" ? " ⭐" : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field">
              <label htmlFor="batches">{t("Number of runs")}</label>
              <input id="batches" name="batches" type="number" step="0.001" min="0" defaultValue="1" required />
              <span className="hint">
                {t("4 runs × 100 dough balls = 400. Ingredients scale by the same number.")}
              </span>
            </div>

            <div className="field">
              <label htmlFor="note">{t("Note")}</label>
              <input id="note" name="note" type="text" />
            </div>

            <div className="form-actions">
              <button className="btn" type="submit">
                {t("Start")}
              </button>
              <Link className="btn btn-ghost" href="/admin/stock/production">
                {t("Cancel")}
              </Link>
            </div>
          </form>

          <div className="admin-panel">
            <h2>{t("Recipes and what is on hand")}</h2>
            <p className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
              {t("Quantities are shown for the warehouse — check that there is enough.")}
            </p>
            {recipes.map((r) => (
              <div key={r.id} style={{ marginBottom: 18 }}>
                <b>{i18nText(r.name)}</b>
                <table className="admin-table" style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>{t("Ingredient")}</th>
                      <th style={{ width: 150 }}>{t("Per run")}</th>
                      <th style={{ width: 150 }}>{t("At the warehouse")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.lines.map((l) => {
                      const have = Number(
                        levels.find((x) => x.locationId === warehouse?.id && x.itemId === l.itemId)?.qty ?? 0,
                      );
                      const short = have < Number(l.qty);
                      return (
                        <tr key={l.id}>
                          <td>{i18nText(l.item.name)}</td>
                          <td>{fmtQty(Number(l.qty), l.item.unit)}</td>
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
            ))}
          </div>
        </>
      )}
    </>
  );
}
