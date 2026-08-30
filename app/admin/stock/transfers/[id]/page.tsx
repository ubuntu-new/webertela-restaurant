import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { fmtQty } from "@/lib/stock";
import { tr } from "@/lib/admin-i18n";
import { fmt } from "@/lib/format";
import { approveTransfer, sendTransfer, receiveTransfer, cancelTransfer } from "../actions";
import { STATUS } from "../status";
import AdminForm from "@/app/admin/_components/AdminForm";

export const dynamic = "force-dynamic";

const inp: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--a-line)",
  borderRadius: 6,
  font: "inherit",
};

export default async function TransferDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tx = await tr();
  const f = await fmt();

  const t = await db.transfer.findUnique({
    where: { id },
    include: { from: true, to: true, lines: { include: { item: true } } },
  });
  if (!t) notFound();

  // ვინ რა გააკეთა — თანამშრომლების სახელები ერთი მოთხოვნით
  const actorIds = [t.requestedById, t.approvedById, t.sentById, t.receivedById, t.cancelledById]
    .filter((x): x is string => !!x);
  const actors = actorIds.length
    ? await db.employee.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const nameOf = (eid: string | null) =>
    eid ? actors.find((a) => a.id === eid)?.name ?? eid : "—";

  // წყაროს ნაშთები — გაგზავნისას ვინმემ უნდა ნახოს, ჰყოფნის თუ არა
  const sourceLevels = await db.stockLevel.findMany({
    where: { locationId: t.fromLocationId, itemId: { in: t.lines.map((l) => l.itemId) } },
  });
  const haveAt = new Map(sourceLevels.map((l) => [l.itemId, Number(l.qty)]));

  const cancel = cancelTransfer.bind(null, id);
  const approve = approveTransfer.bind(null, id);
  const send = sendTransfer.bind(null, id);
  const receive = receiveTransfer.bind(null, id);

  const stages = [
    { label: tx("Request"), by: t.requestedById, at: t.requestedAt },
    { label: tx("Approve"), by: t.approvedById, at: t.approvedAt },
    { label: tx("Send"), by: t.sentById, at: t.sentAt },
    { label: tx("Receive"), by: t.receivedById, at: t.receivedAt },
    { label: tx("Cancel"), by: t.cancelledById, at: t.cancelledAt },
  ].filter((s) => s.at);

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>
            {tx("Transfer")} #{t.no}
          </h1>
          <p>
            {i18nText(t.from.name)} → {i18nText(t.to.name)} ·{" "}
            {STATUS[t.status] ? tx(STATUS[t.status]) : t.status}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/stock/transfers">
          {tx("Back to list")}
        </Link>
      </div>

      {sp.ok && <div className="alert alert-ok">{tx("Done.")}</div>}

      {/* ── ვინ რა გააკეთა ── */}
      <div className="admin-panel">
        <h2>{tx("Stages")}</h2>
        <table className="admin-table">
          <tbody>
            {stages.map((s) => (
              <tr key={s.label}>
                <td style={{ width: 150 }}>{s.label}</td>
                <td style={{ width: 200 }}>{nameOf(s.by)}</td>
                <td>
                  <span className="hint">
                    {f.dateTime(s.at)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {t.note && (
          <p className="hint" style={{ marginTop: 10 }}>
            {tx("Note")}: {t.note}
          </p>
        )}
      </div>

      {/* ── პოზიციები ── */}
      <div className="admin-panel">
        <h2>{tx("Lines")}</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>{tx("Item")}</th>
              <th style={{ width: 110 }}>{tx("Requested")}</th>
              <th style={{ width: 110 }}>{tx("Approved")}</th>
              <th style={{ width: 110 }}>{tx("Sent")}</th>
              <th style={{ width: 110 }}>{tx("Received")}</th>
              <th style={{ width: 120 }}>{tx("At the source")}</th>
            </tr>
          </thead>
          <tbody>
            {t.lines.map((l) => {
              const sent = l.qtySent != null ? Number(l.qtySent) : null;
              const recv = l.qtyReceived != null ? Number(l.qtyReceived) : null;
              const gap = sent != null && recv != null && sent !== recv;
              const have = haveAt.get(l.itemId) ?? 0;
              const short = t.status === "approved" && have < Number(l.qtyApproved ?? l.qtyRequested);

              return (
                <tr key={l.id}>
                  <td>
                    <Link href={`/admin/stock/items/${l.itemId}`}>{i18nText(l.item.name)}</Link>
                  </td>
                  <td>{fmtQty(Number(l.qtyRequested), l.item.unit)}</td>
                  <td>
                    {l.qtyApproved != null ? (
                      fmtQty(Number(l.qtyApproved), l.item.unit)
                    ) : (
                      <span className="hint">—</span>
                    )}
                  </td>
                  <td>{sent != null ? fmtQty(sent, l.item.unit) : <span className="hint">—</span>}</td>
                  <td>
                    {recv != null ? (
                      <b style={gap ? { color: "var(--a-danger)" } : undefined}>
                        {fmtQty(recv, l.item.unit)}
                      </b>
                    ) : (
                      <span className="hint">—</span>
                    )}
                  </td>
                  <td>
                    <span
                      className="hint"
                      style={short ? { color: "var(--a-danger)", fontWeight: 600 } : undefined}
                    >
                      {fmtQty(have, l.item.unit)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {t.status === "received" &&
          t.lines.some(
            (l) => l.qtySent != null && l.qtyReceived != null && Number(l.qtySent) !== Number(l.qtyReceived),
          ) && (
            <div className="alert alert-error" style={{ marginTop: 14 }}>
              <b>{tx("Sent and received do not match.")}</b>{" "}
              {tx(
                "The gap is in the log and already in the levels — check whether it was lost on the way or miscounted.",
              )}
            </div>
          )}
      </div>

      {/* ── მოქმედებები ── */}
      {t.status === "requested" && (
        <AdminForm
          className="admin-panel admin-form"
          style={{ maxWidth: "none" }}
          action={approve}
          submitLabel={tx("Approve")}
          pendingLabel={tx("Approving…")}
        >
          <h2>{tx("Approve")}</h2>
          <p className="hint" style={{ marginTop: -8 }}>
            {tx("You can change the quantities — requested and approved are stored separately.")}
          </p>
          <table className="admin-table">
            <tbody>
              {t.lines.map((l) => (
                <tr key={l.id}>
                  <td>{i18nText(l.item.name)}</td>
                  <td style={{ width: 110 }}>
                    <span className="hint">
                      {tx("Requested")} {fmtQty(Number(l.qtyRequested), l.item.unit)}
                    </span>
                  </td>
                  <td style={{ width: 160 }}>
                    <input
                      name={`approve_${l.id}`}
                      type="number"
                      step="0.001"
                      min="0"
                      defaultValue={Number(l.qtyRequested)}
                      style={inp}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminForm>
      )}

      {t.status === "approved" && (
        <AdminForm
          className="admin-panel admin-form"
          style={{ maxWidth: "none" }}
          action={send}
          submitLabel={tx("Send")}
          pendingLabel={tx("Sending…")}
        >
          <h2>{tx("Send")}</h2>
          <p className="hint" style={{ marginTop: -8 }}>
            {tx("This button")} <b>{tx("takes the stock off the source")}</b>.{" "}
            {tx("The “at the source” column shows whether there is enough.")}
          </p>
          <table className="admin-table">
            <tbody>
              {t.lines.map((l) => (
                <tr key={l.id}>
                  <td>{i18nText(l.item.name)}</td>
                  <td style={{ width: 140 }}>
                    <span className="hint">
                      {tx("At the source")} {fmtQty(haveAt.get(l.itemId) ?? 0, l.item.unit)}
                    </span>
                  </td>
                  <td style={{ width: 160 }}>
                    <input
                      name={`send_${l.id}`}
                      type="number"
                      step="0.001"
                      min="0"
                      defaultValue={Number(l.qtyApproved ?? l.qtyRequested)}
                      style={inp}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminForm>
      )}

      {t.status === "sent" && (
        <AdminForm
          className="admin-panel admin-form"
          style={{ maxWidth: "none" }}
          action={receive}
          submitLabel={tx("Confirm receipt")}
          pendingLabel={tx("Confirming…")}
        >
          <h2>{tx("Receive")}</h2>
          <p className="hint" style={{ marginTop: -8 }}>
            {tx("Write down how much")} <b>{tx("actually")}</b>{" "}
            {tx("arrived. If it does not match what was sent, the difference is recorded — that is normal and exactly the point.")}
          </p>
          <table className="admin-table">
            <tbody>
              {t.lines.map((l) => (
                <tr key={l.id}>
                  <td>{i18nText(l.item.name)}</td>
                  <td style={{ width: 140 }}>
                    <span className="hint">
                      {tx("Sent")} {fmtQty(Number(l.qtySent ?? 0), l.item.unit)}
                    </span>
                  </td>
                  <td style={{ width: 160 }}>
                    <input
                      name={`receive_${l.id}`}
                      type="number"
                      step="0.001"
                      min="0"
                      defaultValue={Number(l.qtySent ?? 0)}
                      style={inp}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminForm>
      )}

      {!["received", "cancelled"].includes(t.status) && (
        <form action={cancel} style={{ marginTop: 16 }}>
          <button
            className="btn btn-ghost"
            type="submit"
            style={{ color: "var(--a-danger)", borderColor: "#f3d5d2" }}
          >
            {tx("Cancel transfer")}
            {t.status === "sent" && ` ${tx("(the goods go back to the source)")}`}
          </button>
        </form>
      )}
    </>
  );
}
