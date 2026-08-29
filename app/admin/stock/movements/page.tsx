import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  receipt: "Receipt",
  transfer_out: "Transfer out",
  transfer_in: "Transfer in",
  production_in: "Made in production",
  production_out: "Used by production",
  sale: "Sale",
  waste: "Waste",
  count_adjust: "Count",
};

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ loc?: string; type?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();
  const f = await fmt();

  const [locations, movements] = await Promise.all([
    db.stockLocation.findMany({ where: { deletedAt: null }, orderBy: { type: "asc" } }),
    db.stockMovement.findMany({
      where: {
        ...(sp.loc ? { locationId: sp.loc } : {}),
        ...(sp.type ? { type: sp.type as never } : {}),
      },
      orderBy: { at: "desc" },
      take: 200,
      include: { location: true, item: true },
    }),
  ]);

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Stock log")}</h1>
          <p>
            {t("Last")} {movements.length} {t("movements")}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/stock">
          ← {t("Stock levels")}
        </Link>
      </div>

      <div className="admin-panel">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <Link className={sp.loc ? "btn btn-ghost" : "btn"} href="/admin/stock/movements">
            {t("All locations")}
          </Link>
          {locations.map((l) => (
            <Link
              key={l.id}
              className={sp.loc === l.id ? "btn" : "btn btn-ghost"}
              href={`/admin/stock/movements?loc=${l.id}`}
            >
              {i18nText(l.name)}
            </Link>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className={sp.type ? "btn btn-ghost" : "btn"} href="/admin/stock/movements">
            {t("All types")}
          </Link>
          {Object.keys(LABEL).map((k) => (
            <Link
              key={k}
              className={sp.type === k ? "btn" : "btn btn-ghost"}
              href={`/admin/stock/movements?type=${k}`}
            >
              {t(LABEL[k])}
            </Link>
          ))}
        </div>
      </div>

      <div className="admin-panel">
        {movements.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            {t("No movements yet.")}
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 150 }}>{t("Time")}</th>
                <th>{t("Item")}</th>
                <th>{t("Location")}</th>
                <th style={{ width: 150 }}>{t("Type")}</th>
                <th style={{ width: 100 }}>{t("Qty")}</th>
                <th style={{ width: 100 }}>{t("On hand")}</th>
                <th>{t("Note")}</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const q = Number(m.qty);
                return (
                  <tr key={m.id}>
                    <td>
                      <span className="hint">{f.dateTime(m.at)}</span>
                    </td>
                    <td>
                      <Link href={`/admin/stock/items/${m.itemId}`}>{i18nText(m.item.name)}</Link>
                    </td>
                    <td>{i18nText(m.location.name)}</td>
                    <td>
                      <span className="hint">{t(LABEL[m.type] ?? m.type)}</span>
                    </td>
                    <td>
                      <b style={{ color: q < 0 ? "var(--a-danger)" : "var(--a-ok)" }}>
                        {q > 0 ? "+" : ""}
                        {q}
                      </b>
                    </td>
                    <td>
                      <span className="hint">
                        {m.balanceAfter != null ? Number(m.balanceAfter) : "—"}
                      </span>
                    </td>
                    <td>
                      <span className="hint">
                        {m.note ?? (m.refType ? `${m.refType} ${m.refId ?? ""}` : "")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
