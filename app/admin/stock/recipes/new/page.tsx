import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { createRecipe } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewRecipe() {
  const t = await tr();

  const items = await db.stockItem.findMany({
    where: { deletedAt: null, active: true },
    orderBy: { category: "asc" },
  });

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("New recipe")}</h1>
          <p>{t("You'll add the inputs after you create it")}</p>
        </div>
        <Link className="btn btn-ghost" href="/admin/stock/recipes">
          {t("Back to list")}
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="admin-panel">
          <p className="hint" style={{ margin: 0 }}>
            {t("No stock items yet.")}{" "}
            <Link href="/admin/stock/items/new">{t("Add them first →")}</Link>
          </p>
        </div>
      ) : (
        <form className="admin-panel admin-form" action={createRecipe}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="name_en">{t("Name")} (EN)</label>
              <input id="name_en" name="name_en" type="text" required autoFocus placeholder="Dough batch" />
            </div>
            <div className="field">
              <label htmlFor="name_ka">{t("Name")} (KA)</label>
              <input id="name_ka" name="name_ka" type="text" placeholder={t("Dough batch")} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="outputItemId">{t("Produces")}</label>
              <select id="outputItemId" name="outputItemId" required>
                <option value="">{t("— select —")}</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {i18nText(it.name)} ({it.unit})
                    {it.isProduced ? ` · ${t("Produced")}` : ""}
                  </option>
                ))}
              </select>
              <span className="hint">
                {t("The item should ideally have “Made in the warehouse” checked.")}
              </span>
            </div>
            <div className="field">
              <label htmlFor="outputQty">{t("Yield per run")}</label>
              <input id="outputQty" name="outputQty" type="number" step="0.001" min="0" required placeholder="100" />
              <span className="hint">{t("In a batch this is multiplied by the number of runs.")}</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="note">{t("Note")}</label>
            <input id="note" name="note" type="text" placeholder={t("Method, temperature…")} />
          </div>

          <div className="form-actions">
            <button className="btn" type="submit">
              {t("Create")}
            </button>
            <Link className="btn btn-ghost" href="/admin/stock/recipes">
              {t("Cancel")}
            </Link>
          </div>
        </form>
      )}
    </>
  );
}
