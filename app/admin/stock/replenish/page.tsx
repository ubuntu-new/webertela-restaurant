import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { fmtQty } from "@/lib/stock";
import { suggestReplenishment } from "@/lib/replenish";
import { tr } from "@/lib/admin-i18n";
import { createTransfer } from "../transfers/actions";
import AdminForm from "@/app/admin/_components/AdminForm";

export const dynamic = "force-dynamic";

export default async function ReplenishPage() {
  const tx = await tr();
  const { warehouse, needs, warehouseLow, shortages } = await suggestReplenishment();

  const openTransfers = await db.transfer.findMany({
    where: { status: { in: ["requested", "approved", "sent"] } },
    select: { toLocationId: true, no: true, status: true },
  });

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{tx("Replenishment suggestions")}</h1>
          <p>
            {needs.length} {tx("branches need a top-up")}
            {warehouseLow.length > 0 &&
              ` · ${tx("at the warehouse")} ${warehouseLow.length} ${tx("items are low")}`}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/stock/transfers">
          {tx("Transfers")}
        </Link>
      </div>

      {/* ── საწყობი ვერ დააკმაყოფილებს ── */}
      {shortages.length > 0 && (
        <div className="alert alert-error">
          <b>{tx("The warehouse does not have enough to cover every request:")}</b>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            {shortages.map((s) => (
              <li key={s.itemId}>
                {i18nText(s.name)} — {tx("need")} {s.total} {s.unit}, {tx("have")} {s.have} {s.unit}{" "}
                ({tx("short")} <b>{s.gap}</b>)
              </li>
            ))}
          </ul>
        </div>
      )}

      {warehouseLow.length > 0 && (
        <div className="admin-panel">
          <h2>⭐ {tx("The warehouse itself needs a top-up")}</h2>
          <p className="hint" style={{ marginTop: -8, marginBottom: 12 }}>
            {tx("This is a signal to buy from the supplier — the branches cannot cover it.")}
          </p>
          <table className="admin-table">
            <thead>
              <tr>
                <th>{tx("Item")}</th>
                <th style={{ width: 120 }}>{tx("On hand")}</th>
                <th style={{ width: 120 }}>{tx("Min")}</th>
                <th style={{ width: 140 }}>{tx("To buy")}</th>
              </tr>
            </thead>
            <tbody>
              {warehouseLow.map((i) => (
                <tr key={i.itemId}>
                  <td>{i18nText(i.itemName)}</td>
                  <td>
                    <b style={{ color: "var(--a-danger)" }}>{fmtQty(i.qty, i.unit)}</b>
                  </td>
                  <td>
                    {/* Every other number in this row carries its unit. A bare
                        "500" beside "16.952 kg" is unreadable — and a minimum is
                        exactly the number somebody needs to sanity-check. */}
                    <span className="hint">{fmtQty(Number(i.min), i.unit)}</span>
                  </td>
                  <td>
                    <span className="badge" style={{ background: "#fdf3d6", color: "#8a6a12" }}>
                      +{fmtQty(i.need, i.unit)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {needs.length === 0 ? (
        <div className="admin-panel">
          <p className="hint" style={{ margin: 0 }}>
            {tx("Every branch is above its minimum. Nothing to suggest.")}
          </p>
          <p className="hint" style={{ marginTop: 8 }}>
            {tx("If this stays empty while stock looks thin — check whether you have set a")}
            <b> {tx("minimum and target")}</b> {tx("on the item page.")}
          </p>
        </div>
      ) : (
        needs.map((n) => {
          const open = openTransfers.filter((t) => t.toLocationId === n.locationId);

          return (
            <AdminForm
              key={n.locationId}
              className="admin-panel"
              action={createTransfer}
              submitLabel={tx("Create request")}
              pendingLabel={tx("Creating…")}
              submitDisabled={!warehouse}
              disabledReason={tx("There is no warehouse location yet — a transfer needs somewhere to come from.")}
            >
              <h2>{i18nText(n.locationName)}</h2>

              {open.length > 0 && (
                <div className="alert" style={{ background: "#fdf3d6", color: "#8a6a12" }}>
                  {tx("This branch already has a transfer in flight:")}{" "}
                  {open.map((t) => `#${t.no}`).join(", ")} —{" "}
                  {tx("check that one first so nothing goes out twice.")}
                </div>
              )}

              <input type="hidden" name="fromLocationId" value={warehouse?.id ?? ""} />
              <input type="hidden" name="toLocationId" value={n.locationId} />
              <input type="hidden" name="note" value={tx("Auto suggestion (dropped to minimum)")} />

              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{tx("Item")}</th>
                    <th style={{ width: 110 }}>{tx("On hand")}</th>
                    <th style={{ width: 100 }}>{tx("Min")}</th>
                    <th style={{ width: 100 }}>{tx("Target")}</th>
                    <th style={{ width: 130 }}>{tx("At the warehouse")}</th>
                    <th style={{ width: 150 }}>{tx("Request")}</th>
                  </tr>
                </thead>
                <tbody>
                  {n.items.map((i) => {
                    const enough = i.atSource >= i.need;
                    return (
                      <tr key={i.itemId}>
                        <td>{i18nText(i.itemName)}</td>
                        <td>
                          <b style={{ color: "var(--a-danger)" }}>{fmtQty(i.qty, i.unit)}</b>
                        </td>
                        <td>
                          <span className="hint">{fmtQty(Number(i.min), i.unit)}</span>
                        </td>
                        <td>
                          <span className="hint">{fmtQty(Number(i.target), i.unit)}</span>
                        </td>
                        <td>
                          <span
                            className="hint"
                            style={enough ? undefined : { color: "var(--a-danger)", fontWeight: 600 }}
                          >
                            {fmtQty(i.atSource, i.unit)}
                          </span>
                        </td>
                        <td>
                          <input
                            name={`qty_${i.itemId}`}
                            type="number"
                            step="0.001"
                            min="0"
                            defaultValue={i.need}
                            style={{
                              width: "100%",
                              padding: "6px 8px",
                              border: "1px solid var(--a-line)",
                              borderRadius: 6,
                              font: "inherit",
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

            </AdminForm>
          );
        })
      )}

      <div className="admin-panel">
        <h2>{tx("How it is worked out")}</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "var(--a-muted)" }}>
          <li>
            <b>{tx("On hand ≤ min")}</b> → {tx("suggestion")} <b>{tx("target − on hand")}</b>.{" "}
            {tx("The number is filled in for you, but you can change it.")}
          </li>
          <li>
            {tx("The “at the warehouse” column tells you whether there is enough")}{" "}
            <b>{tx("before you approve")}</b>{" "}
            {tx("— not once the truck has already gone.")}
          </li>
          <li>
            ⭐{" "}
            {tx(
              "The warehouse has its own minimum, checked separately — otherwise all five branches get topped up and the warehouse quietly runs dry.",
            )}
          </li>
        </ul>
      </div>
    </>
  );
}
