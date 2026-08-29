import Link from "next/link";
import { db } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const sp = await searchParams;
  const f = await fmt();

  const orderBy =
    sp.sort === "spent"
      ? [{ totalSpent: "desc" as const }]
      : sp.sort === "points"
        ? [{ loyaltyPoints: "desc" as const }]
        : sp.sort === "new"
          ? [{ createdAt: "desc" as const }]
          : [{ orderCount: "desc" as const }];

  const [customers, totals] = await Promise.all([
    db.user.findMany({ orderBy, take: 200, include: { _count: { select: { orders: true } } } }),
    db.user.aggregate({ _count: true, _sum: { totalSpent: true, loyaltyPoints: true } }),
  ]);

  const sorts = [
    { key: "", label: "Most orders" },
    { key: "spent", label: "Most spent" },
    { key: "points", label: "Most points" },
    { key: "new", label: "Newest" },
  ];

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Customers</h1>
          <p>
            {totals._count} customers · {f.money(Number(totals._sum.totalSpent ?? 0))} lifetime ·{" "}
            {totals._sum.loyaltyPoints ?? 0} points outstanding
          </p>
        </div>
      </div>

      <div className="admin-panel">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {sorts.map((s) => (
            <Link
              key={s.key}
              className={(sp.sort ?? "") === s.key ? "btn" : "btn btn-ghost"}
              href={s.key ? `/admin/customers?sort=${s.key}` : "/admin/customers"}
            >
              {s.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="admin-panel">
        {customers.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            No customers yet. They are created automatically from website and till orders.
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: 170 }}>Phone</th>
                <th style={{ width: 90 }}>Orders</th>
                <th style={{ width: 130 }}>Spent</th>
                <th style={{ width: 110 }}>Points</th>
                <th style={{ width: 150 }}>Last order</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/admin/customers/${c.id}`}>{c.name ?? "No name"}</Link>
                  </td>
                  <td>
                    <span className="hint">{c.phone ? formatPhone(c.phone) : "—"}</span>
                  </td>
                  <td>{c.orderCount}</td>
                  <td>
                    <b>{f.money(Number(c.totalSpent))}</b>
                  </td>
                  <td>
                    {c.loyaltyPoints > 0 ? (
                      <span className="badge" style={{ background: "#e8f2e8", color: "#3f7d3f" }}>
                        {c.loyaltyPoints}
                      </span>
                    ) : (
                      <span className="hint">—</span>
                    )}
                  </td>
                  <td>
                    <span className="hint">
                      {f.date(c.lastOrderAt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="admin-panel">
        <h2>How loyalty works</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "var(--a-muted)" }}>
          <li>
            <b>1 point per {f.symbol}</b> on the items subtotal — not on the delivery fee, and not on the
            part paid with points. Otherwise points could be farmed in a loop.
          </li>
          <li>
            <b>100 points = {f.money(10)}</b>, minimum 100 to redeem. Editable in Settings.
          </li>
          <li>
            The points ledger is the truth; the balance shown is a cache kept in the same
            transaction. Every change has a reason attached.
          </li>
          <li>Voiding an order returns both the points earned and the points spent.</li>
        </ul>
      </div>
    </>
  );
}
