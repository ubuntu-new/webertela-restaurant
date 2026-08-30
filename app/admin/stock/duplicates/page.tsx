import Link from "next/link";
import { db } from "@/lib/db";
import { tr } from "@/lib/admin-i18n";
import { fmt } from "@/lib/format";
import { i18nText, num } from "@/lib/admin-utils";
import { findExistingDuplicateGroups } from "@/lib/dup";
import { unitLabel } from "@/lib/units";
import { planMerge } from "@/lib/merge-stock-item";
import AdminForm from "../../_components/AdminForm";
import { mergeItems } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The duplicates that are already there.
 *
 * The guard on the create form stops new ones. This is for the pile that
 * accumulated before anyone was watching — and on a restaurant that has been
 * open a year, that pile is where the food-cost error actually lives.
 *
 * The screen is deliberately not a one-click "clean up". A merge moves a
 * ledger, and the owner is the only one who knows whether "Tomato" and
 * "Tomatoes" are the same tomato. So it shows what it found, shows exactly what
 * would move, and asks him to choose which name survives.
 */
export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<{ merged?: string; keep?: string; lose?: string }>;
}) {
  const { merged, keep, lose } = await searchParams;
  const t = await tr();
  const f = await fmt();

  const groups = await findExistingDuplicateGroups("stockItem");

  // Enough about each row to decide which one is the real one.
  const ids = groups.flatMap((g) => g.rows.map((r) => r.id));
  const items = ids.length
    ? await db.stockItem.findMany({
        where: { id: { in: ids } },
        include: { levels: true, _count: { select: { movements: true, consumption: true, recipeInputs: true } } },
      })
    : [];
  const byId = new Map(items.map((i) => [i.id, i]));

  const plan = keep && lose ? await planMerge(keep, lose) : null;

  // byId only holds rows that are currently in a duplicate group. A bookmarked
  // or stale ?keep=&lose= URL — one of them already merged, say — would render
  // an empty name and a missing unit, which looks like a bug rather than an
  // answer. Load whatever the plan actually points at.
  if (plan?.compatible) {
    const missing = [plan.keepId, plan.loseId].filter((x) => !byId.has(x));
    if (missing.length > 0) {
      const extra = await db.stockItem.findMany({
        where: { id: { in: missing } },
        include: { levels: true, _count: { select: { movements: true, consumption: true, recipeInputs: true } } },
      });
      for (const e of extra) byId.set(e.id, e);
    }
  }

  /** 12.300000000000001 is a true sum and a bad answer. */
  const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, ""));

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Duplicate stock items")}</h1>
          <p>
            {t(
              "Two rows for one ingredient split your stock: recipes use one, deliveries land on the other, and food cost stops being true.",
            )}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/stock/items">
          {t("Back to items")}
        </Link>
      </div>

      {merged && <div className="alert alert-ok">{t("Merged. The stock, the history and the recipes are now on one item.")}</div>}

      {groups.length === 0 && (
        <div className="admin-panel">
          <p style={{ margin: 0 }}>
            <b>{t("Nothing is duplicated.")}</b>{" "}
            {t("Every stock item has a name of its own, so your food cost is counting each ingredient once.")}
          </p>
        </div>
      )}

      {/* ── the confirmation step ── */}
      {plan && (
        <div className="admin-panel" style={{ borderLeft: "3px solid var(--a-orange)" }}>
          <h2>{t("Merge these two")}</h2>

          {!plan.compatible ? (
            <div className="alert alert-error" style={{ marginTop: 10 }}>
              {plan.reason}
            </div>
          ) : (
            <>
              <p style={{ fontSize: 14.5 }}>
                <b>{i18nText(byId.get(plan.keepId)?.name)}</b> {t("stays.")}{" "}
                <b>{i18nText(byId.get(plan.loseId)?.name)}</b> {t("is archived, and everything it holds moves across:")}
              </p>

              {plan.converting && (
                <div className="dup-warn" style={{ margin: "12px 0" }}>
                  <div className="dup-warn-head">
                    <b>
                      {t("These are measured differently —")} {unitLabel(plan.fromUnit as never)} {t("and")}{" "}
                      {unitLabel(plan.toUnit as never)}
                    </b>
                    <p>
                      {t(
                        "The same measurement written two ways, so everything is converted into the one that survives: quantities, minimums, unit costs, recipe amounts and every past movement. The figures below are already converted.",
                      )}
                    </p>
                  </div>
                </div>
              )}

              <ul style={{ fontSize: 14, lineHeight: 1.9, color: "var(--a-muted)" }}>
                <li>
                  <b>{plan.moves.movements}</b> {t("movements keep their dates and quantities")}
                </li>
                <li>
                  <b>{plan.moves.levels}</b> {t("stock balances are added together, per location")}
                </li>
                <li>
                  <b>{plan.moves.consumptionRules}</b> {t("menu rules move across")}
                  {plan.moves.consumptionDropped > 0 && (
                    <>
                      {" · "}
                      <b>{plan.moves.consumptionDropped}</b>{" "}
                      {t("already existed on both, so the larger quantity is kept")}
                    </>
                  )}
                </li>
                <li>
                  <b>{plan.moves.recipeLines}</b> {t("recipe lines")} · <b>{plan.moves.transferLines}</b>{" "}
                  {t("transfer lines")} · <b>{plan.moves.productionLines}</b> {t("production lines")}
                </li>
                {plan.moves.recipesProducing > 0 && (
                  <li>
                    <b>{plan.moves.recipesProducing}</b>{" "}
                    {t("recipes produce this item — their yield moves across")}
                    {plan.converting && t(", restated in the new unit")}
                  </li>
                )}
              </ul>

              <div className="merge-note">
                <b>{t("What you will have afterwards")}</b>
                <table className="admin-table" style={{ marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th>{t("Location")}</th>
                      <th style={{ width: 130 }}>{t("On hand")}</th>
                      <th style={{ width: 150 }}>{t("Average cost")}</th>
                      <th style={{ width: 200 }}>{t("Min / target")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.resulting.map((r) => (
                      <tr key={r.locationId}>
                        <td>{r.locationName}</td>
                        <td>
                          {qty(r.qty)} {unitLabel(byId.get(plan.keepId)!.unit)}
                        </td>
                        <td>{r.avgCost != null ? f.money(r.avgCost) : "—"}</td>
                        <td>
                          {r.minLevel == null && r.targetLevel == null ? (
                            <span className="hint">—</span>
                          ) : (
                            <>
                              {r.minLevel != null ? qty(r.minLevel) : "—"} /{" "}
                              {r.targetLevel != null ? qty(r.targetLevel) : "—"}{" "}
                              {unitLabel(byId.get(plan.keepId)!.unit)}
                              {/* A threshold arriving from the row about to be
                                  archived is the one number here nobody chose on
                                  purpose. It drives the replenishment screen, so
                                  it is worth a colour. */}
                              {r.thresholdInherited && (
                                <div className="hint" style={{ color: "var(--a-orange)", fontWeight: 600 }}>
                                  {t("taken from the item being archived")}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {plan.resulting.some((r) => r.thresholdInherited) && (
                  <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--a-orange)" }}>
                    <b>{t("Check the minimums marked above.")}</b>{" "}
                    {t(
                      "Where the surviving item has no threshold of its own, the one from the archived item is carried over. That is usually what you want — but a minimum somebody typed while testing will start driving what the software tells you to buy.",
                    )}
                  </p>
                )}
                <p style={{ margin: "8px 0 0", fontSize: 13 }}>
                  {t(
                    "Cost is averaged by quantity, not chosen — 10 at $6 and 2 at $9 becomes 12 at $6.50, so no future sale changes price because of the merge.",
                  )}
                </p>
              </div>

              <AdminForm
                className="admin-form"
                action={mergeItems}
                submitLabel={t("Merge them")}
                pendingLabel={t("Merging…")}
                cancelHref="/admin/stock/duplicates"
              >
                <input type="hidden" name="keepId" value={plan.keepId} />
                <input type="hidden" name="loseId" value={plan.loseId} />
                <div className="field" style={{ maxWidth: 280 }}>
                  <label htmlFor="iUnderstand">{t("Type MERGE to confirm")}</label>
                  <input id="iUnderstand" name="iUnderstand" type="text" autoComplete="off" placeholder="MERGE" />
                  <span className="hint">
                    {t("This cannot be undone from here. Nothing is deleted, but unpicking it means a restore.")}
                  </span>
                </div>
              </AdminForm>
            </>
          )}
        </div>
      )}

      {/* ── what was found ── */}
      {groups.map((g) => (
        <div className="merge-group" key={g.key}>
          <h3>{g.rows[0].name}</h3>
          <p>
            {g.rows.length} {t("items share this name. Pick the one to keep, then merge the others into it.")}
          </p>

          {g.rows.map((r) => {
            const it = byId.get(r.id);
            const onHand = it ? it.levels.reduce((s, l) => s + num(l.qty), 0) : 0;
            const others = g.rows.filter((o) => o.id !== r.id);

            return (
              <div className="merge-row" key={r.id}>
                <span>·</span>
                <div>
                  <Link href={r.href}>{r.name}</Link>
                  <div className="m-use">
                    {qty(onHand)} {it ? unitLabel(it.unit) : ""} {t("on hand")} · {it?._count.movements ?? 0} {t("movements")} ·{" "}
                    {it?._count.consumption ?? 0} {t("menu rules")} · {it?._count.recipeInputs ?? 0} {t("recipes")}
                    {it?.sku && ` · SKU ${it.sku}`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {others.map((o) => (
                    <Link
                      key={o.id}
                      className="btn btn-ghost"
                      style={{ fontSize: 12.5, padding: "5px 9px" }}
                      href={`/admin/stock/duplicates?keep=${r.id}&lose=${o.id}`}
                    >
                      {t("Keep this, merge the other")}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <div className="admin-panel">
        <h2>{t("Which one should you keep?")}</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "var(--a-muted)" }}>
          <li>{t("The one with the most movements — its history is the longest and the most useful.")}</li>
          <li>{t("The one your recipes already point at, so fewer rules have to move.")}</li>
          <li>
            {t("Either way nothing is lost: quantities are added together and every movement keeps its date.")}
          </li>
          <li>
            <b>{t("Different units cannot be merged")}</b>{" "}
            {t("— kilograms and pieces are not the same measurement. Change one to match first.")}
          </li>
        </ul>
      </div>
    </>
  );
}
