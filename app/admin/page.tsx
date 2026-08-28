import Link from "next/link";
import { db } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { i18nText } from "@/lib/admin-utils";
import { fmtQty } from "@/lib/stock";
import { setupChecklist } from "@/lib/setup-checklist";
import { fmt } from "@/lib/format";
import SetupChecklist from "./_components/SetupChecklist";
import HelpNote from "./_components/HelpNote";
import {
  periodOf,
  coreMetrics,
  costMetrics,
  labourCost,
  productBreakdown,
  branchBreakdown,
  hourlyLoad,
  productionYield,
  stockAlerts,
  fixedCosts,
} from "@/lib/analytics";

export const dynamic = "force-dynamic";

// Quantities only. Money and dates come from the organisation — see lib/format.
const qty = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ერთი მაჩვენებელი — დიდი ციფრი, ქვეშ კონტექსტი. */
function Stat({
  value,
  label,
  sub,
  tone,
}: {
  value: string;
  label: string;
  sub?: string;
  tone?: "ok" | "warn" | "bad";
}) {
  const color =
    tone === "ok" ? "var(--a-ok)" : tone === "bad" ? "var(--a-danger)" : tone === "warn" ? "#8a6a12" : undefined;
  return (
    <div className="admin-stat">
      <b style={color ? { color } : undefined}>{value}</b>
      <span>{label}</span>
      {sub && (
        <span className="hint" style={{ display: "block", marginTop: 2 }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span className="hint" style={{ color: up ? "var(--a-ok)" : "var(--a-danger)" }}>
      {up ? "↑" : "↓"} {Math.abs(pct)}%
    </span>
  );
}

/** მარტივი ჰორიზონტალური ზოლი — გრაფიკის ბიბლიოთეკის გარეშე. */
function Bar({ value, max, tone = "var(--a-orange)" }: { value: number; max: number; tone?: string }) {
  const w = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ background: "#f0efed", borderRadius: 4, height: 8, overflow: "hidden" }}>
      <div style={{ width: `${w}%`, background: tone, height: "100%" }} />
    </div>
  );
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const sp = await searchParams;
  const days = Math.min(365, Math.max(1, Number(sp.d) || 30));
  const p = periodOf(days);

  const [session, f, core, costs, labour, products, branches, load, yieldStats, stock, fixed, pending, setup] =
    await Promise.all([
      getSession(),
      fmt(),
      coreMetrics(p),
      costMetrics(p),
      labourCost(p),
      productBreakdown(p),
      branchBreakdown(p),
      hourlyLoad(p),
      productionYield(p),
      stockAlerts(),
      fixedCosts(),
      db.order.count({ where: { status: "new" } }),
      setupChecklist(),
    ]);

  // ── ეკონომიკა ──
  //
  // A figure that was never calculated must not be displayed as if it had been.
  // With no consumption rules COGS comes back 0 — and then gross profit equals
  // revenue exactly, prime cost is 0%, and the badge paints that green and
  // calls it healthy. An owner reading that screen is being reassured by an
  // empty database, which is worse than showing him nothing.
  //
  // So each figure states whether its inputs exist. Missing shows as "—" with
  // the reason; only real inputs earn a verdict.
  const hasFoodCost = costs.cogs > 0;
  const hasLabour = labour.cost > 0;
  const hasPrime = hasFoodCost && hasLabour;

  const grossProfit = hasFoodCost ? Math.round((core.revenue - costs.cogs) * 100) / 100 : null;
  const foodCostPct = hasFoodCost && core.revenue > 0 ? Math.round((costs.cogs / core.revenue) * 1000) / 10 : null;
  const labourPct = hasLabour && core.revenue > 0 ? Math.round((labour.cost / core.revenue) * 1000) / 10 : null;
  const primeCost = hasPrime ? Math.round((costs.cogs + labour.cost) * 100) / 100 : null;
  const primePct = hasPrime && core.revenue > 0 ? Math.round((primeCost! / core.revenue) * 1000) / 10 : null;

  // ფიქსირებული ხარჯი პერიოდზე გადაანგარიშებული
  const fixedForPeriod = fixed ? Math.round((fixed.monthly / 30) * days * 100) / 100 : null;
  const netProfit =
    fixedForPeriod !== null && grossProfit !== null && hasLabour
      ? Math.round((grossProfit - labour.cost - fixedForPeriod) * 100) / 100
      : null;

  const maxHour = Math.max(...load.hours.map((h) => h.count), 1);
  const maxBranch = Math.max(...branches.map((b) => b.revenue), 1);

  const noData = core.count === 0;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Dashboard</h1>
          <p>
            {session?.name} · last {p.label}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[1, 7, 30, 90].map((d) => (
            <Link key={d} className={days === d ? "btn" : "btn btn-ghost"} href={`/admin?d=${d}`}>
              {d === 1 ? "Today" : `${d} days`}
            </Link>
          ))}
        </div>
      </div>

      {/* ── საჭიროებს ყურადღებას ── */}
      {(pending > 0 || stock.low > 0) && (
        <div className="admin-panel" style={{ borderColor: "#f0d9a0" }}>
          <h2>Needs attention</h2>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {pending > 0 && (
              <Link className="btn" href="/admin/orders?status=new">
                {pending} new orders
              </Link>
            )}
            {stock.low > 0 && (
              <Link className="btn btn-ghost" href="/admin/stock/replenish">
                ⚠️ {stock.low} items low on stock
              </Link>
            )}
          </div>
        </div>
      )}

      {noData ? (
        <div className="admin-panel">
          <h2>No orders in this period</h2>
          <p className="hint" style={{ margin: 0 }}>
            Pick a longer period, or wait for the first orders. This page becomes useful
            over weeks — a single day shows no trend.
          </p>
        </div>
      ) : (
        <>
          {/* ── ბრუნვა ── */}
          <div className="admin-stats cols-4">
            <Stat value={`${f.money(core.revenue)}`} label="Revenue" sub={`${f.money(core.perDay)} / day`} />
            <Stat value={String(core.count)} label="Orders" sub={`previous: ${core.prevCount}`} />
            <Stat value={`${f.money(core.avgCheck)}`} label="Average check" />
            <Stat
              value={grossProfit === null ? "—" : grossProfit >= 0 ? `${f.money(grossProfit)}` : `−${f.money(-grossProfit)}`}
              label="Gross profit"
              sub={grossProfit === null ? "no ingredient cost yet" : "after ingredients"}
              tone={grossProfit === null ? undefined : grossProfit >= 0 ? "ok" : "bad"}
            />
            {core.deliveryShare !== null && (
              <Stat value={`${core.deliveryShare}%`} label="Delivery" sub="rest is pickup" />
            )}
            {core.growth !== null && (
              <Stat
                value={`${core.growth > 0 ? "+" : ""}${core.growth}%`}
                label="Growth"
                sub={`vs previous ${p.label}`}
                tone={core.growth >= 0 ? "ok" : "bad"}
              />
            )}
          </div>

          {/* ── ეკონომიკა ── */}
          <div className="admin-panel">
            <h2>Economics</h2>
            <table className="admin-table">
              <tbody>
                <tr>
                  <td style={{ width: 260 }}>Revenue</td>
                  <td style={{ width: 140 }}>
                    <b>{f.money(core.revenue)}</b>
                  </td>
                  <td>
                    <Delta pct={core.growth} />
                  </td>
                </tr>
                <tr>
                  <td>Ingredients (COGS)</td>
                  <td>{hasFoodCost ? `−${f.money(costs.cogs)}` : "—"}</td>
                  <td>
                    {foodCostPct !== null && (
                      <span
                        className="badge"
                        style={
                          foodCostPct <= 33
                            ? { background: "#e8f2e8", color: "#3f7d3f" }
                            : { background: "#fdecea", color: "#b3261e" }
                        }
                      >
                        {foodCostPct}%
                      </span>
                    )}
                    <span className="hint">
                      {hasFoodCost ? " · target 28–33%" : " · needs consumption rules and purchase prices"}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>Labour</td>
                  <td>{hasLabour ? `−${f.money(labour.cost)}` : "—"}</td>
                  <td>
                    {labourPct !== null && (
                      <span
                        className="badge"
                        style={
                          labourPct <= 30
                            ? { background: "#e8f2e8", color: "#3f7d3f" }
                            : { background: "#fdf3d6", color: "#8a6a12" }
                        }
                      >
                        {labourPct}%
                      </span>
                    )}
                    <span className="hint">
                      {" "}
                      · {labour.hours} h, {labour.shifts} shifts
                      {labour.unpriced > 0 && ` · ${labour.unpriced} shifts without a rate`}
                    </span>
                  </td>
                </tr>
                <tr style={{ borderTop: "2px solid var(--a-line)" }}>
                  <td>
                    <b>Prime cost</b>
                  </td>
                  <td>
                    <b>{primeCost === null ? "—" : f.money(primeCost)}</b>
                  </td>
                  <td>
                    {primePct !== null && (
                      <span
                        className="badge"
                        style={
                          primePct <= 65
                            ? { background: "#e8f2e8", color: "#3f7d3f" }
                            : { background: "#fdecea", color: "#b3261e" }
                        }
                      >
                        {primePct}%
                      </span>
                    )}
                    <span className="hint">
                      {hasPrime
                        ? " · healthy ≤ 65%"
                        : hasFoodCost
                          ? " · needs shifts with an hourly rate"
                          : " · needs ingredient cost and labour"}
                    </span>
                  </td>
                </tr>
                {costs.waste > 0 && (
                  <tr>
                    <td>Waste</td>
                    <td style={{ color: "var(--a-danger)" }}>−{f.money(costs.waste)}</td>
                    <td>
                      <span className="hint">
                        {pct(costs.waste, core.revenue)}% of revenue
                      </span>
                    </td>
                  </tr>
                )}
                {costs.countAdjust !== 0 && (
                  <tr>
                    <td>Stock count variance</td>
                    <td style={{ color: costs.countAdjust < 0 ? "var(--a-danger)" : undefined }}>
                      {costs.countAdjust > 0 ? "+" : ""}
                      {f.money(costs.countAdjust)}
                    </td>
                    <td>
                      <span className="hint">
                        {costs.countAdjust < 0
                          ? "Shortage — over-portioning, spoilage or theft"
                          : "Surplus — a counting error or an unrecorded receipt"}
                      </span>
                    </td>
                  </tr>
                )}
                {fixedForPeriod !== null ? (
                  <>
                    <tr>
                      <td>Fixed costs</td>
                      <td>−{f.money(fixedForPeriod)}</td>
                      <td>
                        <span className="hint">{f.money(fixed!.monthly)}/month, pro-rated</span>
                      </td>
                    </tr>
                    <tr style={{ borderTop: "2px solid var(--a-line)" }}>
                      <td>
                        <b>Net profit</b>
                      </td>
                      <td>
                        <b style={{ color: netProfit! >= 0 ? "var(--a-ok)" : "var(--a-danger)" }}>
                          {netProfit! >= 0 ? "" : "−"}
                          {f.money(Math.abs(netProfit!))}
                        </b>
                      </td>
                      <td>
                        <span className="hint">{pct(netProfit!, core.revenue)}% of revenue</span>
                      </td>
                    </tr>
                  </>
                ) : (
                  <tr>
                    <td colSpan={3}>
                      <span className="hint">
                        Net profit is hidden — rent and utilities haven't been entered.{" "}
                        <Link href="/admin/settings">Add them in Settings →</Link>
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {costs.cogs === 0 && (
              <div className="alert" style={{ background: "#fdf3d6", color: "#8a6a12", marginTop: 14 }}>
                <b>Ingredient cost is zero.</b> Either consumption rules are missing, or receipts have no price. <Link href="/admin/stock/consumption/bulk">Fill in the rules →</Link>
              </div>
            )}
          </div>

          {/* ── ფილიალები ── */}
          {branches.length > 1 && (
            <div className="admin-panel">
              <h2>Branches</h2>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th style={{ width: 90 }}>Orders</th>
                    <th style={{ width: 130 }}>Revenue</th>
                    <th style={{ width: 120 }}>Avg check</th>
                    <th style={{ width: 200 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {branches.map((b) => (
                    <tr key={b.id}>
                      <td>{i18nText(b.name)}</td>
                      <td>{b.count}</td>
                      <td>
                        <b>{f.money(b.revenue)}</b>
                      </td>
                      <td>{b.count > 0 ? `${f.money(b.avgCheck)}` : <span className="hint">—</span>}</td>
                      <td>
                        <Bar value={b.revenue} max={maxBranch} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── საათობრივი დატვირთვა ── */}
          <div className="admin-panel">
            <h2>Hourly load</h2>
            <p className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
              Peak at <b>{load.peak.hour}:00</b> — {load.peak.count} orders. Staff rotas should follow this shape.
            </p>
            <table className="admin-table">
              <tbody>
                {load.hours
                  .filter((h) => h.count > 0)
                  .map((h) => (
                    <tr key={h.hour}>
                      <td style={{ width: 70 }}>
                        {String(h.hour).padStart(2, "0")}:00
                      </td>
                      <td style={{ width: 70 }}>{h.count}</td>
                      <td style={{ width: 120 }}>
                        <span className="hint">{f.money(h.revenue)}</span>
                      </td>
                      <td>
                        <Bar value={h.count} max={maxHour} tone={h.hour === load.peak.hour ? "var(--a-saffron)" : undefined} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* ── პროდუქტები ── */}
          <div className="admin-panel">
            <h2>Top products</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th style={{ width: 90 }}>Qty</th>
                  <th style={{ width: 130 }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {products.byRevenue.map((x, i) => (
                  <tr key={i}>
                    <td>
                      {x.productId ? (
                        <Link href={`/admin/products/${x.productId}`}>{i18nText(x.name)}</Link>
                      ) : (
                        i18nText(x.name)
                      )}
                    </td>
                    <td>{x.qty}</td>
                    <td>
                      <b>{f.money(x.revenue)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint" style={{ marginTop: 12 }}>
              ⚠️ The best seller is often the least profitable —{" "}
              <Link href="/admin/stock/costing">see margin per product →</Link>
            </p>
          </div>

          {/* ── წარმოება ── */}
          {yieldStats && (
            <div className="admin-panel">
              <h2>Production yield</h2>
              <div className="admin-stats" style={{ marginBottom: 0 }}>
                <Stat value={String(yieldStats.batches)} label="Batches" />
                <Stat value={qty(yieldStats.planned)} label="Planned" />
                <Stat value={qty(yieldStats.actual)} label="Actual" />
                <Stat
                  value={`${yieldStats.pct}%`}
                  label="Yield"
                  tone={yieldStats.pct! >= 95 ? "ok" : "bad"}
                  sub={yieldStats.pct! < 95 ? "recipe drift or loss" : undefined}
                />
              </div>
            </div>
          )}
        </>
      )}

      {setup.done < setup.total && (
        <SetupChecklist steps={setup.steps} done={setup.done} total={setup.total} />
      )}

      {/* ── მარაგი ── */}
      <div className="admin-panel">
        <h2>Stock</h2>
        <div className="admin-stats" style={{ marginBottom: stock.items.length ? 14 : 0 }}>
          <Stat value={`${f.money(stock.stockValue)}`} label="Stock value" />
          <Stat
            value={String(stock.low)}
            label="Low on stock"
            tone={stock.low > 0 ? "warn" : "ok"}
          />
        </div>
        {stock.items.length > 0 && (
          <table className="admin-table">
            <tbody>
              {stock.items.map((l) => (
                <tr key={l.id}>
                  <td>{i18nText(l.item.name)}</td>
                  <td style={{ width: 160 }}>
                    <span className="hint">{i18nText(l.location.name)}</span>
                  </td>
                  <td style={{ width: 120 }}>
                    <b style={{ color: "var(--a-danger)" }}>
                      {fmtQty(Number(l.qty), l.item.unit)}
                    </b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="admin-panel">
        <h2>What these numbers mean</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "var(--a-muted)" }}>
          <li>
            <b>Food cost 28–33%</b> — the restaurant norm. Higher means prices are low, portions are large, or something is being lost.
          </li>
          <li>
            <b>Prime cost ≤ 65%</b> — ingredients plus labour. This single number says more about a restaurant's health than revenue does.
          </li>
          <li>
            <b>Stock count variance</b> — what quietly eats the profit. Everyone watches revenue; almost nobody watches this.
          </li>
          <li>
            <b>Gross profit is not net profit.</b> Bank fees, taxes and depreciation are not included — the real figure is lower.
          </li>
        </ul>
      </div>
    </>
  );
}

function pct(a: number, b: number) {
  return b > 0 ? Math.round((a / b) * 1000) / 10 : null;
}
