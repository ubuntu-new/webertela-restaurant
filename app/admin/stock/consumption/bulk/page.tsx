import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { createItemsFromToppings, saveBulkConsumption } from "./actions";

export const dynamic = "force-dynamic";

const inp: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--a-line)",
  borderRadius: 6,
  font: "inherit",
};

/** სახელით ავტომატური დაკავშირება — მოცარელა → მოცარელა */
function autoMatch(toppingName: string, items: { id: string; name: unknown }[]) {
  const n = toppingName.trim().toLowerCase();
  return (
    items.find((i) => String((i.name as Record<string, unknown>)?.en ?? "").trim().toLowerCase() === n)?.id ?? ""
  );
}

export default async function BulkConsumptionPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; created?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();

  const [toppings, items, rules] = await Promise.all([
    db.topping.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    db.stockItem.findMany({ where: { deletedAt: null, active: true }, orderBy: { category: "asc" } }),
    db.consumptionRule.findMany({ where: { toppingId: { not: null } } }),
  ]);

  // მიმდინარე მდგომარეობა: M-ის წესი თითო ტოპინგზე
  const current = new Map<string, { itemId: string; qtyM: number }>();
  for (const r of rules) {
    if (!r.toppingId) continue;
    const isM = r.sizeKey === "M" || r.sizeKey === null;
    if (!isM && current.has(r.toppingId)) continue;
    if (isM || !current.has(r.toppingId)) {
      current.set(r.toppingId, { itemId: r.itemId, qtyM: Number(r.qty) });
    }
  }

  const filled = toppings.filter((tp) => current.has(tp.id)).length;
  const missingItems = toppings.filter(
    (tp) => !autoMatch(i18nText(tp.name, "en"), items) && !current.has(tp.id),
  ).length;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Topping consumption")}</h1>
          <p>
            {filled}/{toppings.length} {t("filled in")}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/stock/consumption">
          ← {t("All rules")}
        </Link>
      </div>

      {sp.saved && (
        <div className="alert alert-ok">
          {t("Saved")} — {sp.saved} {t("rules")}.
        </div>
      )}
      {sp.created && (
        <div className="alert alert-ok">
          {sp.created === "0" ? t("Every item already existed.") : `${sp.created} ${t("items created.")}`}
        </div>
      )}

      {missingItems > 0 && (
        <div className="admin-panel">
          <h2>{t("Stock items first")}</h2>
          <p className="hint" style={{ marginTop: -8, marginBottom: 12 }}>
            <b>
              {missingItems} {t("toppings")}
            </b>{" "}
            {t(
              "have no stock item. A premium topping needs its own — you can't work out the cost of prosciutto from mozzarella.",
            )}
          </p>
          <form action={createItemsFromToppings}>
            <button className="btn" type="submit">
              {t("Create from toppings")} ({missingItems})
            </button>
          </form>
          <p className="hint" style={{ marginTop: 10 }}>
            {t("They're created in kilograms. If one is counted by the piece, change it on the item page.")}
          </p>
        </div>
      )}

      <form action={saveBulkConsumption}>
        <div className="admin-panel">
          <h2>{t("Size multipliers")}</h2>
          <p className="hint" style={{ marginTop: -8, marginBottom: 12 }}>
            {t("You enter the")} <b>{t("M")}</b>{" "}
            {t(
              "weight — S and XL come off it. The default numbers are taken from your own price ratios.",
            )}
          </p>
          <div className="field-row" style={{ maxWidth: 420 }}>
            <div className="field">
              <label htmlFor="ratioS">S = M ×</label>
              <input id="ratioS" name="ratioS" type="number" step="0.01" min="0" defaultValue="0.55" />
            </div>
            <div className="field">
              <label htmlFor="ratioXL">XL = M ×</label>
              <input id="ratioXL" name="ratioXL" type="number" step="0.01" min="0" defaultValue="1.68" />
            </div>
          </div>
        </div>

        <div className="admin-panel">
          <h2>{t("Toppings")}</h2>
          <p className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
            {t("Blank weight = no rule needed (an existing one is deleted).")}
          </p>

          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Topping")}</th>
                <th style={{ width: 280 }}>{t("Stock item")}</th>
                <th style={{ width: 150 }}>{t("M weight")}</th>
              </tr>
            </thead>
            <tbody>
              {toppings.map((tp) => {
                const nameEn = i18nText(tp.name, "en");
                const cur = current.get(tp.id);
                const guess = cur?.itemId || autoMatch(nameEn, items);

                return (
                  <tr key={tp.id}>
                    <td>
                      <input type="hidden" name="row" value={tp.id} />
                      {i18nText(tp.name)}
                      <div className="hint">
                        {nameEn}
                        {tp.recipeOnly && ` · ${t("recipe only")}`}
                      </div>
                    </td>
                    <td>
                      <select name={`item_${tp.id}`} defaultValue={guess} style={inp}>
                        <option value="">{t("— not counted —")}</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {i18nText(it.name)} ({it.unit})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        name={`qty_${tp.id}`}
                        type="number"
                        step="0.001"
                        min="0"
                        defaultValue={cur ? cur.qtyM : ""}
                        placeholder="0.18"
                        style={inp}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="form-actions" style={{ marginTop: 18 }}>
            <button className="btn" type="submit">
              {t("Save all")}
            </button>
          </div>
        </div>
      </form>

      <div className="admin-panel">
        <h2>{t("Why it works this way")}</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "var(--a-muted)" }}>
          <li>
            {t("24 toppings × 3 sizes =")} <b>{t("72 records")}</b>.{" "}
            {t("With a multiplier, 24 fields are enough and there's nowhere left to slip up.")}
          </li>
          <li>
            <b>{t("A premium topping")}</b>{" "}
            {t(
              "needs no machinery of its own — it has its own item and its own price, so the margin % comes out right by itself. This is exactly where you see whether premium is really making money or only costing more.",
            )}
          </li>
          <li>
            {t("Pizza ingredients are toppings — you enter them once and")}{" "}
            <b>{t("they apply to every pizza")}</b>.
          </li>
        </ul>
      </div>
    </>
  );
}
