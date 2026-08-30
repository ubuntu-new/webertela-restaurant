import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { fmtQty } from "@/lib/stock";
import { tr } from "@/lib/admin-i18n";
import { createTransfer } from "../actions";
import AdminForm from "@/app/admin/_components/AdminForm";

export const dynamic = "force-dynamic";

const inp: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--a-line)",
  borderRadius: 6,
  font: "inherit",
};

export default async function NewTransfer({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();

  const [locations, items, levels] = await Promise.all([
    db.stockLocation.findMany({ where: { deletedAt: null, active: true }, orderBy: { type: "asc" } }),
    db.stockItem.findMany({ where: { deletedAt: null, active: true }, orderBy: { category: "asc" } }),
    db.stockLevel.findMany(),
  ]);

  const warehouse = locations.find((l) => l.type === "warehouse");
  const fromId = sp.from ?? warehouse?.id ?? locations[0]?.id ?? "";
  const qtyAt = (loc: string, item: string) =>
    Number(levels.find((l) => l.locationId === loc && l.itemId === item)?.qty ?? 0);

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("New transfer")}</h1>
          <p>{t("Fill in only the lines you are actually moving")}</p>
        </div>
        <Link className="btn btn-ghost" href="/admin/stock/transfers">
          {t("Back to list")}
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="admin-panel">
          <p className="hint" style={{ margin: 0 }}>
            {t("No stock items yet.")}{" "}
            <Link href="/admin/stock/items/new">{t("Add them first →")}</Link>
          </p>
        </div>
      ) : (
        <AdminForm
          className="admin-form"
          style={{ maxWidth: "none" }}
          action={createTransfer}
          submitLabel={t("Create request")}
          cancelHref="/admin/stock/transfers"
        >
          <div className="admin-panel">
            <h2>{t("From and to")}</h2>
            <div className="field-row">
              <div className="field">
                <label htmlFor="fromLocationId">{t("From")}</label>
                <select id="fromLocationId" name="fromLocationId" defaultValue={fromId} required>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {i18nText(l.name)}
                      {l.type === "warehouse" ? " ⭐" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="toLocationId">{t("To")}</label>
                <select id="toLocationId" name="toLocationId" defaultValue={sp.to ?? ""} required>
                  <option value="">{t("— pick one —")}</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {i18nText(l.name)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="note">{t("Note")}</label>
              <input id="note" name="note" type="text" placeholder={t("Reason, deadline…")} />
            </div>
          </div>

          <div className="admin-panel">
            <h2>{t("Lines")}</h2>
            <p className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
              {t("“On hand” is shown for the source that was selected when the page loaded.")}
            </p>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Item")}</th>
                  <th style={{ width: 100 }}>{t("Group")}</th>
                  <th style={{ width: 140 }}>{t("On hand at source")}</th>
                  <th style={{ width: 160 }}>{t("Quantity")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td>{i18nText(it.name)}</td>
                    <td>
                      <span className="hint">{it.category ?? "—"}</span>
                    </td>
                    <td>
                      <span className="hint">{fmtQty(qtyAt(fromId, it.id), it.unit)}</span>
                    </td>
                    <td>
                      <input
                        name={`qty_${it.id}`}
                        type="number"
                        step="0.001"
                        min="0"
                        placeholder="0"
                        style={inp}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </AdminForm>
      )}
    </>
  );
}
