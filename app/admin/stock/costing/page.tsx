import Link from "next/link";
import { i18nText } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { computeMenuCosts, stockValue } from "@/lib/costing";

export const dynamic = "force-dynamic";

const money = (n: number) => n.toFixed(2);

function MarginBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="hint">—</span>;
  const tone =
    pct >= 60
      ? { background: "#e8f2e8", color: "#3f7d3f" }
      : pct >= 35
        ? { background: "#fdf3d6", color: "#8a6a12" }
        : { background: "#fdecea", color: "#b3261e" };
  return (
    <span className="badge" style={tone}>
      {pct}%
    </span>
  );
}

export default async function CostingPage() {
  const t = await tr();
  const [{ products, toppings }, values] = await Promise.all([computeMenuCosts(), stockValue()]);

  const totalValue = values.reduce((s, v) => s + v.value, 0);
  const unpriced = values.reduce((s, v) => s + v.unpriced, 0);

  const sorted = [...products].sort((a, b) => {
    if (a.marginPct === null) return 1;
    if (b.marginPct === null) return -1;
    return a.marginPct - b.marginPct;
  });

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Costing")}</h1>
          <p>
            {t("Stock value")} <b>{money(totalValue)} ₾</b>
            {unpriced > 0 && ` · ${unpriced} ${t("items are missing a price")}`}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/stock">
          ← {t("Stock")}
        </Link>
      </div>

      {unpriced > 0 && (
        <div className="alert" style={{ background: "#fdf3d6", color: "#8a6a12" }}>
          <b>
            {unpriced} {t("items have no average cost.")}
          </b>{" "}
          {t(
            "Cost is recorded on receiving — put the purchase price on the next delivery and the numbers fill in.",
          )}
        </div>
      )}

      {/* ── მარაგის ღირებულება ── */}
      <div className="admin-panel">
        <h2>{t("Stock value")}</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Location")}</th>
              <th style={{ width: 110 }}>{t("Items")}</th>
              <th style={{ width: 140 }}>{t("Value")}</th>
              <th style={{ width: 130 }}>{t("No price")}</th>
            </tr>
          </thead>
          <tbody>
            {values.map((v) => (
              <tr key={v.location.id}>
                <td>
                  {i18nText(v.location.name)}
                  {v.location.type === "warehouse" && <span className="hint"> ⭐</span>}
                </td>
                <td>{v.items}</td>
                <td>
                  <b>{money(v.value)} ₾</b>
                </td>
                <td>
                  {v.unpriced > 0 ? (
                    <span className="badge" style={{ background: "#fdf3d6", color: "#8a6a12" }}>
                      {v.unpriced}
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

      {/* ── პროდუქტები ── */}
      <div className="admin-panel">
        <h2>{t("Product margins")}</h2>
        <p className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
          {t("Sorted with")} <b>{t("the lowest margin on top")}</b>{" "}
          {t("— those are the ones that need attention.")}
        </p>

        {sorted.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            {t("No consumption rules yet.")}{" "}
            <Link href="/admin/stock/consumption">{t("Add them →")}</Link>
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Product")}</th>
                <th style={{ width: 70 }}>{t("Size")}</th>
                <th style={{ width: 110 }}>{t("Cost")}</th>
                <th style={{ width: 110 }}>{t("Price")}</th>
                <th style={{ width: 110 }}>{t("Margin")}</th>
                <th style={{ width: 90 }}>%</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => (
                <tr key={`${p.productId}-${p.sizeKey}-${i}`}>
                  <td>
                    {p.productId ? (
                      <Link href={`/admin/products/${p.productId}`}>{i18nText(p.name)}</Link>
                    ) : (
                      i18nText(p.name)
                    )}
                    <div className="hint">
                      {p.lines
                        .map((l) => `${i18nText(l.name)} ${l.qty}${l.unit}`)
                        .join(" · ")}
                    </div>
                    {p.missing > 0 && (
                      <div className="hint" style={{ color: "var(--a-danger)" }}>
                        {p.missing} {t("ingredients are missing a price — the cost is incomplete")}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className="hint">{p.sizeKey ?? "—"}</span>
                  </td>
                  <td>{money(p.cost)} ₾</td>
                  <td>{p.price != null ? `${money(p.price)} ₾` : <span className="hint">—</span>}</td>
                  <td>
                    {p.margin != null ? (
                      <b style={p.margin < 0 ? { color: "var(--a-danger)" } : undefined}>
                        {money(p.margin)} ₾
                      </b>
                    ) : (
                      <span className="hint">—</span>
                    )}
                  </td>
                  <td>
                    <MarginBadge pct={p.marginPct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── ტოპინგები ── */}
      {toppings.length > 0 && (
        <div className="admin-panel">
          <h2>{t("Topping margins")}</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Topping")}</th>
                <th style={{ width: 70 }}>{t("Size")}</th>
                <th style={{ width: 110 }}>{t("Cost")}</th>
                <th style={{ width: 110 }}>{t("Add-on price")}</th>
                <th style={{ width: 110 }}>{t("Margin")}</th>
                <th style={{ width: 90 }}>%</th>
              </tr>
            </thead>
            <tbody>
              {toppings.map((tp, i) => (
                <tr key={`${tp.toppingId}-${tp.sizeKey}-${i}`}>
                  <td>
                    {tp.toppingId ? (
                      <Link href={`/admin/toppings/${tp.toppingId}`}>{i18nText(tp.name)}</Link>
                    ) : (
                      i18nText(tp.name)
                    )}
                    <div className="hint">
                      {tp.lines.map((l) => `${i18nText(l.name)} ${l.qty}${l.unit}`).join(" · ")}
                    </div>
                  </td>
                  <td>
                    <span className="hint">{tp.sizeKey ?? t("All")}</span>
                  </td>
                  <td>{money(tp.cost)} ₾</td>
                  <td>{tp.price != null ? `${money(tp.price)} ₾` : <span className="hint">—</span>}</td>
                  <td>
                    {tp.margin != null ? (
                      <b style={tp.margin < 0 ? { color: "var(--a-danger)" } : undefined}>
                        {money(tp.margin)} ₾
                      </b>
                    ) : (
                      <span className="hint">—</span>
                    )}
                  </td>
                  <td>
                    <MarginBadge pct={tp.marginPct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="admin-panel">
        <h2>{t("How it's worked out")}</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "var(--a-muted)" }}>
          <li>
            <b>{t("Moving average:")}</b>{" "}
            {t("on receiving, the new price blends into the balance you already have.")}{" "}
            {/* Units and currency stay out of the sentence: a worked example
                reads the same in any country if it is only arithmetic. */}
            20 × 8 + 10 × 11 = 30 × <b>9</b>.
          </li>
          <li>
            {t("Cost comes from the")} <b>{t("warehouse")}</b>{" "}
            {t("location — that's the central receiving point.")}
          </li>
          <li>
            {t("If an ingredient is missing a price, it")} <b>{t("isn't counted")}</b>{" "}
            {t("in the total — so the cost shows lower than it really is. The column carries a warning.")}
          </li>
          <li>
            {t("This is the")} <b>{t("ingredient")}</b>{" "}
            {t("cost. Labor, power and rent are not in it — real margin is lower than this.")}
          </li>
        </ul>
      </div>
    </>
  );
}
