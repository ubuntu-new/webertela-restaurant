import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { STATUS, TONE } from "./status";

export const dynamic = "force-dynamic";

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const tx = await tr();

  const [transfers, counts] = await Promise.all([
    db.transfer.findMany({
      where: sp.status ? { status: sp.status as never } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        from: true,
        to: true,
        _count: { select: { lines: true } },
      },
    }),
    db.transfer.groupBy({ by: ["status"], _count: true }),
  ]);

  const countOf = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{tx("Transfers")}</h1>
          <p>
            {transfers.length} {tx("shown")} · {countOf("requested")} {tx("to approve")} ·{" "}
            {countOf("sent")} {tx("in transit")}
          </p>
        </div>
        <Link className="btn" href="/admin/stock/replenish">
          {tx("Replenishment suggestions")}
        </Link>
      </div>

      <div className="admin-panel">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className={sp.status ? "btn btn-ghost" : "btn"} href="/admin/stock/transfers">
            {tx("All")}
          </Link>
          {Object.keys(STATUS).map((s) => (
            <Link
              key={s}
              className={sp.status === s ? "btn" : "btn btn-ghost"}
              href={`/admin/stock/transfers?status=${s}`}
            >
              {tx(STATUS[s])} {countOf(s) > 0 && `(${countOf(s)})`}
            </Link>
          ))}
          <Link className="btn btn-ghost" href="/admin/stock/transfers/new">
            + {tx("New transfer")}
          </Link>
        </div>
      </div>

      <div className="admin-panel">
        {transfers.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            {tx(
              "No transfers yet. Start from “Replenishment suggestions” — the system tells you which branch is short of what.",
            )}
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>№</th>
                <th>{tx("From")}</th>
                <th>{tx("To")}</th>
                <th style={{ width: 90 }}>{tx("Lines")}</th>
                <th style={{ width: 130 }}>{tx("Status")}</th>
                <th style={{ width: 150 }}>{tx("Created")}</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/admin/stock/transfers/${t.id}`}>
                      <b>#{t.no}</b>
                    </Link>
                  </td>
                  <td>{i18nText(t.from.name)}</td>
                  <td>{i18nText(t.to.name)}</td>
                  <td>{t._count.lines}</td>
                  <td>
                    <span
                      className="badge"
                      style={TONE[t.status] ?? { background: "#f5f5f4", color: "#78716c" }}
                    >
                      {STATUS[t.status] ? tx(STATUS[t.status]) : t.status}
                    </span>
                  </td>
                  <td>
                    <span className="hint">{new Date(t.createdAt).toLocaleString("ka-GE")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="admin-panel">
        <h2>{tx("How it works")}</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "var(--a-muted)" }}>
          <li>
            <b>{tx("Request → approve → send → receive.")}</b>{" "}
            {tx("Every step has an owner and lands in the log.")}
          </li>
          <li>
            {tx("Stock changes at two points only:")} <b>{tx("when you send")}</b>{" "}
            {tx("it comes off the source,")} <b>{tx("when you receive")}</b>{" "}
            {tx("it goes on at the branch. The steps in between are agreements, not movement.")}
          </li>
          <li>
            {tx("Sent and received are recorded separately —")} <b>{tx("the gap is visible")}</b>{" "}
            {tx("and never gets lost.")}
          </li>
        </ul>
      </div>
    </>
  );
}
