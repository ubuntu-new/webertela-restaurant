import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { fmtQty } from "@/lib/stock";
import { tr } from "@/lib/admin-i18n";
import { fmt } from "@/lib/format";
import { addMovement } from "./actions";
import AdminForm from "../_components/AdminForm";

export const dynamic = "force-dynamic";

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ loc?: string; saved?: string; low?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();
  const f = await fmt();

  const locations = await db.stockLocation.findMany({
    where: { deletedAt: null },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
  });

  const locId = sp.loc || locations[0]?.id || "";
  const location = locations.find((l) => l.id === locId) ?? null;

  const [items, levels] = await Promise.all([
    db.stockItem.findMany({ where: { deletedAt: null, active: true }, orderBy: { category: "asc" } }),
    locId
      ? db.stockLevel.findMany({ where: { locationId: locId }, include: { item: true } })
      : Promise.resolve([]),
  ]);

  const levelOf = new Map(levels.map((l) => [l.itemId, l]));

  const rows = items.map((it) => {
    const l = levelOf.get(it.id);
    const qty = l ? Number(l.qty) : 0;
    const min = l?.minLevel != null ? Number(l.minLevel) : null;
    const target = l?.targetLevel != null ? Number(l.targetLevel) : null;
    const low = min != null && qty <= min;
    const need = low && target != null ? Math.max(0, target - qty) : 0;
    return { it, qty, min, target, low, need };
  });

  const shown = sp.low === "1" ? rows.filter((r) => r.low) : rows;
  const lowCount = rows.filter((r) => r.low).length;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Stock")}</h1>
          <p>
            {location ? i18nText(location.name) : t("No location")} · {items.length} {t("items")}
            {lowCount > 0 && ` · ${lowCount} ${t("running low")}`}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/stock/movements">
          {t("Movement log")}
        </Link>
      </div>

      {sp.saved && <div className="alert alert-ok">{t("Recorded.")}</div>}

      {lowCount > 0 && sp.low !== "1" && (
        <div className="alert" style={{ background: "#fdf3d6", color: "#8a6a12" }}>
          <b>
            {lowCount} {t("items are at or below minimum.")}
          </b>{" "}
          <Link href={`/admin/stock?loc=${locId}&low=1`}>{t("Show only those")} →</Link>
        </div>
      )}

      <div className="admin-panel">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {locations.map((l) => (
            <Link
              key={l.id}
              className={l.id === locId ? "btn" : "btn btn-ghost"}
              href={`/admin/stock?loc=${l.id}`}
            >
              {i18nText(l.name)}
              {l.type === "warehouse" && " ⭐"}
            </Link>
          ))}
          <Link className="btn btn-ghost" href="/admin/stock/items">
            {t("Manage items")}
          </Link>
        </div>
      </div>

      {locations.length === 0 ? (
        <div className="admin-panel">
          <p className="hint" style={{ margin: 0 }}>
            {t("No locations yet — run")} <code>npx tsx scripts/seed-stock-locations.mjs</code>
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="admin-panel">
          <p className="hint" style={{ marginTop: 0 }}>
            {t(
              "No stock items yet. Add what you keep on hand — mozzarella (kg), Coke (each), flour (kg).",
            )}
          </p>
          <Link className="btn" href="/admin/stock/items/new">
            + {t("First item")}
          </Link>
        </div>
      ) : (
        <>
          <div className="admin-panel">
            <h2>{t("Stock levels")}</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Item")}</th>
                  <th style={{ width: 90 }}>{t("Group")}</th>
                  <th style={{ width: 120 }}>{t("On hand")}</th>
                  <th style={{ width: 100 }}>{t("Min")}</th>
                  <th style={{ width: 100 }}>{t("Target")}</th>
                  <th style={{ width: 150 }}>{t("Needed")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.it.id} style={r.low ? { background: "#fffaf9" } : undefined}>
                    <td>
                      <Link href={`/admin/stock/items/${r.it.id}`}>{i18nText(r.it.name)}</Link>
                      <div className="hint">
                        {r.it.sku ?? ""}
                        {r.it.isProduced && ` · ${t("Produced")}`}
                      </div>
                    </td>
                    <td>
                      <span className="hint">{r.it.category ?? "—"}</span>
                    </td>
                    <td>
                      <b style={r.low ? { color: "var(--a-danger)" } : undefined}>
                        {fmtQty(r.qty, r.it.unit)}
                      </b>
                    </td>
                    <td>
                      <span className="hint">{r.min ?? "—"}</span>
                    </td>
                    <td>
                      <span className="hint">{r.target ?? "—"}</span>
                    </td>
                    <td>
                      {r.need > 0 ? (
                        <span className="badge" style={{ background: "#fdf3d6", color: "#8a6a12" }}>
                          +{fmtQty(r.need, r.it.unit)}
                        </span>
                      ) : (
                        <span className="hint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── ხელით მოძრაობა ── */}
          <AdminForm
            className="admin-panel admin-form"
            style={{ maxWidth: "none" }}
            action={addMovement}
            submitLabel={t("Record")}
            pendingLabel={t("Recording…")}
          >
            <h2>{t("Add movement")}</h2>
            <input type="hidden" name="locationId" value={locId} />

            <div className="field-row" style={{ gridTemplateColumns: "2fr 1fr 1fr" }}>
              <div className="field">
                <label htmlFor="itemId">{t("Item")}</label>
                <select id="itemId" name="itemId" required>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {i18nText(it.name)} ({it.unit})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="kind">{t("Type")}</label>
                <select id="kind" name="kind" defaultValue="receipt">
                  <option value="receipt">{t("Receipt")} (+)</option>
                  <option value="waste">{t("Waste")} (−)</option>
                  <option value="count">{t("Count")}</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="qty">{t("Quantity")}</label>
                <input id="qty" name="qty" type="number" step="0.001" min="0" required />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="unitCost">{t("Unit cost")} ({f.symbol})</label>
                <input id="unitCost" name="unitCost" type="number" step="0.0001" min="0" placeholder={t("Receipts only")} />
                <span className="hint">
                  {t("Purchase price per unit. Without it we cannot work out food cost.")}
                </span>
              </div>
              <div className="field">
                <label htmlFor="note">{t("Note")}</label>
                <input id="note" name="note" type="text" placeholder={t("Supplier, reason…")} />
              </div>
            </div>

            <p className="hint" style={{ marginTop: -4 }}>
              <b>{t("Receipt")}</b> {t("adds")} · <b>{t("Waste")}</b>{" "}
              {t("subtracts (we put the minus in for you)")} · <b>{t("Count")}</b>{" "}
              {t("— enter what you actually counted, the system works out the difference.")}
            </p>

          </AdminForm>
        </>
      )}

      <div className="admin-panel">
        <h2>{t("How it works")}</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "var(--a-muted)" }}>
          <li>
            {t("On hand")} <b>{t("is never typed in by hand")}</b>{" "}
            {t(
              "— it is the sum of the movements. So you can always ask why this much is left, and the answer is in the log.",
            )}
          </li>
          <li>
            <b>{t("The warehouse too")}</b>{" "}
            {t(
              "needs a minimum too — otherwise all five branches top up from it and it quietly runs dry.",
            )}
          </li>
          <li>{t("Automatic deduction on orders comes with recipes (stage 3B).")}</li>
        </ul>
      </div>
    </>
  );
}
