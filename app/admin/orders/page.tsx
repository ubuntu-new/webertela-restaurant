import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText, money } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  new: "New",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  delivering: "Out for delivery",
  completed: "Done",
  cancelled: "Cancelled",
};

const TONE: Record<string, React.CSSProperties> = {
  new: { background: "#fdf3d6", color: "#8a6a12" },
  completed: { background: "#e8f2e8", color: "#3f7d3f" },
  cancelled: { background: "#fdecea", color: "#b3261e" },
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; branch?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();

  const [branches, orders, counts] = await Promise.all([
    db.branch.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    db.order.findMany({
      where: {
        ...(sp.status ? { status: sp.status as never } : {}),
        ...(sp.branch ? { branchId: sp.branch } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        branch: true,
        driver: { select: { name: true } },
        createdBy: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
    db.order.groupBy({ by: ["status"], _count: true }),
  ]);

  const countOf = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Orders")}</h1>
          <p>
            {orders.length} {t("shown")} · {t("New")} {countOf("new")} · {t("Preparing")}{" "}
            {countOf("preparing")}
          </p>
        </div>
        <Link className="btn" href="/admin/orders/new">
          + {t("New order")}
        </Link>
      </div>

      <div className="admin-panel">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <Link className={sp.status ? "btn btn-ghost" : "btn"} href="/admin/orders">
            {t("All")}
          </Link>
          {Object.keys(LABEL).map((s) => (
            <Link
              key={s}
              className={sp.status === s ? "btn" : "btn btn-ghost"}
              href={`/admin/orders?status=${s}`}
            >
              {t(LABEL[s])} {countOf(s) > 0 && `(${countOf(s)})`}
            </Link>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className={sp.branch ? "btn btn-ghost" : "btn"} href="/admin/orders">
            {t("All branches")}
          </Link>
          {branches.map((b) => (
            <Link
              key={b.id}
              className={sp.branch === b.id ? "btn" : "btn btn-ghost"}
              href={`/admin/orders?branch=${b.id}`}
            >
              {i18nText(b.name)}
            </Link>
          ))}
        </div>
      </div>

      <div className="admin-panel">
        {orders.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            {t("No orders yet.")}
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 80 }}>№</th>
                <th>{t("Customer")}</th>
                <th>{t("Branch")}</th>
                <th style={{ width: 140 }}>{t("Who")}</th>
                <th>{t("Type")}</th>
                <th>{t("Lines")}</th>
                <th>{t("Total")}</th>
                <th>{t("Status")}</th>
                <th>{t("Time")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/admin/orders/${o.id}`}>
                      <b>#{o.orderNo}</b>
                    </Link>
                  </td>
                  <td>
                    {o.customerName ?? "—"}
                    <div className="hint">{o.customerPhone ?? ""}</div>
                  </td>
                  <td>{i18nText(o.branch.name)}</td>
                  <td>
                    {o.createdBy ? (
                      o.createdBy.name
                    ) : (
                      <span className="hint">{o.source === "web" ? t("Website") : o.source}</span>
                    )}
                    {o.posId && <div className="hint">{o.posId}</div>}
                  </td>
                  <td>
                    <span className="hint">
                      {o.fulfillmentType === "pickup" ? t("Pickup") : t("Delivery")}
                    </span>
                    {o.driver && <div className="hint">🛵 {o.driver.name}</div>}
                  </td>
                  <td>{o._count.items}</td>
                  <td>
                    <b>{money(o.total)} ₾</b>
                  </td>
                  <td>
                    <span className="badge" style={TONE[o.status] ?? { background: "#f5f5f4", color: "#78716c" }}>
                      {LABEL[o.status] ? t(LABEL[o.status]) : o.status}
                    </span>
                  </td>
                  <td>
                    <span className="hint">{new Date(o.createdAt).toLocaleString("ka-GE")}</span>
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
