import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { i18nText, i18nOf } from "@/lib/admin-utils";
import { fmtQty } from "@/lib/stock";
import { tr } from "@/lib/admin-i18n";
import { updateStockItem, archiveStockItem } from "../../actions";
import ArchiveButton from "../../../_components/ArchiveButton";

export const dynamic = "force-dynamic";

const MOVE_LABEL: Record<string, string> = {
  receipt: "Receipt",
  transfer_out: "Transfer out",
  transfer_in: "Transfer in",
  production_in: "Made in production",
  production_out: "Used by production",
  sale: "Sale",
  waste: "Waste",
  count_adjust: "Count",
};

export default async function StockItemEdit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await tr();

  const [item, locations, movements] = await Promise.all([
    db.stockItem.findUnique({ where: { id }, include: { levels: true } }),
    db.stockLocation.findMany({ where: { deletedAt: null }, orderBy: [{ type: "asc" }, { createdAt: "asc" }] }),
    db.stockMovement.findMany({
      where: { itemId: id },
      orderBy: { at: "desc" },
      take: 25,
      include: { location: true },
    }),
  ]);
  if (!item) notFound();

  const name = i18nOf(item.name);
  const levelOf = new Map(item.levels.map((l) => [l.locationId, l]));
  const totalQty = item.levels.reduce((s, l) => s + Number(l.qty), 0);

  const save = updateStockItem.bind(null, id);
  const archive = archiveStockItem.bind(null, id);

  const consequences = [
    t("It disappears from the stock screen and from the movement form."),
    `${item.levels.length} ${t("locations keep their stock")} (${fmtQty(totalQty, item.unit)}).`,
    `${movements.length >= 25 ? "25+" : movements.length} ${t("movements stay in the history untouched.")}`,
    t("If this item is in a recipe, that recipe stops working — check first."),
  ];

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{name.ka || name.en}</h1>
          <p>
            {item.unit} · {t("Total")} {fmtQty(totalQty, item.unit)}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/stock/items">
          {t("Back to list")}
        </Link>
      </div>

      <form className="admin-form" action={save} style={{ maxWidth: 900 }}>
        <div className="admin-panel">
          <h2>{t("Basics")}</h2>

          <div className="field-row">
            <div className="field">
              <label htmlFor="name_en">{t("Name")} (EN)</label>
              <input id="name_en" name="name_en" type="text" defaultValue={name.en} required />
            </div>
            <div className="field">
              <label htmlFor="name_ka">{t("Name")} (KA)</label>
              <input id="name_ka" name="name_ka" type="text" defaultValue={name.ka} />
            </div>
          </div>

          <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            <div className="field">
              <label htmlFor="unit">{t("Unit")}</label>
              <select id="unit" name="unit" defaultValue={item.unit}>
                <option value="kg">{t("Kilogram")}</option>
                <option value="g">{t("Gram")}</option>
                <option value="l">{t("Liter")}</option>
                <option value="ml">{t("Milliliter")}</option>
                <option value="pcs">{t("Each")}</option>
              </select>
              <span className="hint">{t("Changing this does not recalculate past movements.")}</span>
            </div>
            <div className="field">
              <label htmlFor="category">{t("Group")}</label>
              <input id="category" name="category" type="text" defaultValue={item.category ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="sku">SKU</label>
              <input id="sku" name="sku" type="text" defaultValue={item.sku ?? ""} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="note">{t("Note")}</label>
            <input id="note" name="note" type="text" defaultValue={item.note ?? ""} />
          </div>

          <div className="field-check">
            <input id="isProduced" name="isProduced" type="checkbox" defaultChecked={item.isProduced} />
            <label htmlFor="isProduced">{t("Made in-house from a recipe")}</label>
          </div>
          <div className="field-check">
            <input id="active" name="active" type="checkbox" defaultChecked={item.active} />
            <label htmlFor="active">{t("Active")}</label>
          </div>
        </div>

        {/* ── მინიმუმები ლოკაციებზე ── */}
        <div className="admin-panel">
          <h2>{t("Stock and thresholds")}</h2>
          <p className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
            ⭐ <b>{t("The warehouse too")}</b>{" "}
            {t("needs a minimum — otherwise the branches top it up and it quietly runs dry.")}
          </p>

          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Location")}</th>
                <th style={{ width: 130 }}>{t("On hand")}</th>
                <th style={{ width: 130 }}>{t("Min")}</th>
                <th style={{ width: 130 }}>{t("Target")}</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc) => {
                const l = levelOf.get(loc.id);
                const qty = l ? Number(l.qty) : 0;
                const min = l?.minLevel != null ? Number(l.minLevel) : "";
                const target = l?.targetLevel != null ? Number(l.targetLevel) : "";
                const low = l?.minLevel != null && qty <= Number(l.minLevel);

                return (
                  <tr key={loc.id}>
                    <td>
                      {i18nText(loc.name)}
                      {loc.type === "warehouse" && <span className="hint"> ⭐ {t("Warehouse")}</span>}
                    </td>
                    <td>
                      <b style={low ? { color: "var(--a-danger)" } : undefined}>
                        {fmtQty(qty, item.unit)}
                      </b>
                    </td>
                    <td>
                      <input
                        name={`min_${loc.id}`}
                        type="number"
                        step="0.001"
                        min="0"
                        defaultValue={min}
                        style={inp}
                      />
                    </td>
                    <td>
                      <input
                        name={`target_${loc.id}`}
                        type="number"
                        step="0.001"
                        min="0"
                        defaultValue={target}
                        style={inp}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 10 }}>
            {t(
              "Thresholds can be set before you have any stock — set them now, record the receipt later. An empty field means this location is not watched.",
            )}
          </p>
        </div>

        <div className="form-actions">
          <button className="btn" type="submit">
            {t("Save")}
          </button>
          <Link className="btn btn-ghost" href="/admin/stock/items">
            {t("Cancel")}
          </Link>
        </div>
      </form>

      {/* ── ჟურნალი ── */}
      <div className="admin-panel" style={{ maxWidth: 900 }}>
        <h2>{t("Recent movements")}</h2>
        {movements.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            {t("No movements yet.")}
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 150 }}>{t("Time")}</th>
                <th>{t("Location")}</th>
                <th style={{ width: 150 }}>{t("Type")}</th>
                <th style={{ width: 110 }}>{t("Quantity")}</th>
                <th style={{ width: 110 }}>{t("On hand")}</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const q = Number(m.qty);
                return (
                  <tr key={m.id}>
                    <td>
                      <span className="hint">{new Date(m.at).toLocaleString("ka-GE")}</span>
                    </td>
                    <td>
                      {i18nText(m.location.name)}
                      {m.note && <div className="hint">{m.note}</div>}
                    </td>
                    <td>
                      <span className="hint">{t(MOVE_LABEL[m.type] ?? m.type)}</span>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="admin-panel" style={{ maxWidth: 900 }}>
        <h2>{t("Archive")}</h2>
        <ArchiveButton action={archive} subject={name.ka || name.en} consequences={consequences} />
      </div>
    </>
  );
}

const inp: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--a-line)",
  borderRadius: 6,
  font: "inherit",
};
