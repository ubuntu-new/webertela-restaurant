import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatPhone, addressLine } from "@/lib/phone";
import { i18nText } from "@/lib/admin-utils";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  earn: "Earned",
  redeem: "Redeemed",
  adjust: "Adjustment",
};

export default async function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await fmt();

  const [customer, orders, points] = await Promise.all([
    db.user.findUnique({
      where: { id },
      include: {
        addresses: { orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] },
        discounts: { include: { discount: true } },
      },
    }),
    db.order.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { branch: true, _count: { select: { items: true } } },
    }),
    db.pointsEntry.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  if (!customer) notFound();

  const avg = customer.orderCount > 0 ? Number(customer.totalSpent) / customer.orderCount : 0;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{customer.name ?? "No name"}</h1>
          <p>{customer.phone ? formatPhone(customer.phone) : "No phone"}</p>
        </div>
        <Link className="btn btn-ghost" href="/admin/customers">
          ← Back to list
        </Link>
      </div>

      <div className="admin-stats">
        <div className="admin-stat">
          <b>{customer.orderCount}</b>
          <span>orders</span>
        </div>
        <div className="admin-stat">
          <b>{f.money(Number(customer.totalSpent))}</b>
          <span>lifetime</span>
        </div>
        <div className="admin-stat">
          <b>{f.money(avg)}</b>
          <span>average order</span>
        </div>
        <div className="admin-stat">
          <b>{customer.loyaltyPoints}</b>
          <span>points · {f.money(customer.loyaltyPoints * 0.1)}</span>
        </div>
      </div>

      {customer.addresses.length > 0 && (
        <div className="admin-panel">
          <h2>Addresses</h2>
          <table className="admin-table">
            <tbody>
              {customer.addresses.map((a) => (
                <tr key={a.id}>
                  <td>
                    {addressLine(a)}
                    {a.note && <div className="hint">{a.note}</div>}
                  </td>
                  <td style={{ width: 100 }}>
                    {a.isDefault && <span className="badge badge-on">Default</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {customer.discounts.length > 0 && (
        <div className="admin-panel">
          <h2>Discounts</h2>
          <table className="admin-table">
            <tbody>
              {customer.discounts.map((d) => (
                <tr key={d.id}>
                  <td>{i18nText(d.discount.name)}</td>
                  <td style={{ width: 180 }}>
                    <span className="hint">
                      {d.expiresAt ? `until ${f.date(d.expiresAt)}` : "no expiry"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="admin-panel">
        <h2>Orders</h2>
        {orders.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>No orders yet.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 80 }}>№</th>
                <th>Branch</th>
                <th style={{ width: 90 }}>Source</th>
                <th style={{ width: 80 }}>Items</th>
                <th style={{ width: 110 }}>Total</th>
                <th style={{ width: 90 }}>Points</th>
                <th style={{ width: 150 }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} style={o.status === "cancelled" ? { opacity: 0.55 } : undefined}>
                  <td>
                    <Link href={`/admin/orders/${o.id}`}>#{o.orderNo}</Link>
                  </td>
                  <td>{i18nText(o.branch.name)}</td>
                  <td>
                    <span className="hint">{o.source}</span>
                  </td>
                  <td>{o._count.items}</td>
                  <td>
                    <b>{f.money(Number(o.total))}</b>
                    {Number(o.pointsValue) > 0 && (
                      <div className="hint">−{f.money(Number(o.pointsValue))} points</div>
                    )}
                  </td>
                  <td>
                    <span className="hint">
                      {o.pointsEarned > 0 && `+${o.pointsEarned}`}
                      {o.pointsRedeemed > 0 && ` −${o.pointsRedeemed}`}
                      {o.pointsEarned === 0 && o.pointsRedeemed === 0 && "—"}
                    </span>
                  </td>
                  <td>
                    <span className="hint">{f.dateTime(o.createdAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="admin-panel">
        <h2>Points ledger</h2>
        {points.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>Nothing yet.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 150 }}>Date</th>
                <th style={{ width: 130 }}>Type</th>
                <th style={{ width: 100 }}>Points</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="hint">{f.dateTime(p.createdAt)}</span>
                  </td>
                  <td>
                    <span className="hint">{TYPE_LABEL[p.type] ?? p.type}</span>
                  </td>
                  <td>
                    <b style={{ color: p.points < 0 ? "var(--a-danger)" : "var(--a-ok)" }}>
                      {p.points > 0 ? "+" : ""}
                      {p.points}
                    </b>
                  </td>
                  <td>
                    <span className="hint">{p.reason ?? ""}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint" style={{ marginTop: 12 }}>
          The ledger is the truth — the balance above is a cache kept in the same transaction.
          Nothing is ever deleted; corrections are added as adjustments.
        </p>
      </div>
    </>
  );
}
