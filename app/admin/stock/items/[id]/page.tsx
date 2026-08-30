import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { i18nText, i18nOf } from "@/lib/admin-utils";
import { fmtQty } from "@/lib/stock";
import { tr } from "@/lib/admin-i18n";
import { fmt } from "@/lib/format";
import { updateStockItem, archiveStockItem } from "../../actions";
import ArchiveButton from "../../../_components/ArchiveButton";
import AdminForm from "@/app/admin/_components/AdminForm";
import NameField from "@/app/admin/_components/NameField";
import BarcodeField from "@/app/admin/_components/BarcodeField";
import { unitLabel } from "@/lib/units";

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
  const f = await fmt();

  const [item, locations, movements, suppliers] = await Promise.all([
    db.stockItem.findUnique({ where: { id }, include: { levels: true } }),
    db.stockLocation.findMany({ where: { deletedAt: null }, orderBy: [{ type: "asc" }, { createdAt: "asc" }] }),
    db.stockMovement.findMany({
      where: { itemId: id },
      orderBy: { at: "desc" },
      take: 25,
      include: { location: true },
    }),
    db.supplier.findMany({
      where: { deletedAt: null, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
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

      <AdminForm
        className="admin-form"
        style={{ maxWidth: 900 }}
        action={save}
        submitLabel={t("Save")}
        cancelHref="/admin/stock/items"
      >
        <div className="admin-panel">
          <h2>{t("Basics")}</h2>

          <div className="field-row">
            <NameField
              model="stockItem"
              name="name_en"
              label={`${t("Name")} (EN)`}
              defaultValue={name.en}
              excludeId={id}
              required
              contextFields={{ barcode: "barcode", packSize: "packSize", packUnit: "packUnit", supplierId: "supplierId", supplierCode: "supplierCode" }}
            />
            <div className="field">
              <label htmlFor="name_ka">{t("Name")} (KA)</label>
              <input id="name_ka" name="name_ka" type="text" defaultValue={name.ka} />
            </div>
          </div>

          <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            <div className="field">
              <label htmlFor="unit">{t("Unit")}</label>
              <select id="unit" name="unit" defaultValue={item.unit}>
                <optgroup label={t("Weight")}>
                  <option value="kg">{t("Kilogram")}</option>
                  <option value="g">{t("Gram")}</option>
                  <option value="lb">{t("Pound")}</option>
                  <option value="oz">{t("Ounce")}</option>
                </optgroup>
                <optgroup label={t("Volume")}>
                  <option value="l">{t("Liter")}</option>
                  <option value="ml">{t("Milliliter")}</option>
                  <option value="gal">{t("Gallon")}</option>
                  <option value="floz">{t("Fluid ounce")}</option>
                </optgroup>
                <optgroup label={t("Count")}>
                  <option value="pcs">{t("Pieces")}</option>
                  <option value="each">{t("Each")}</option>
                </optgroup>
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


          {/* ── how this thing is identified ────────────────────────────────
              The name is what a person types, so the name is what varies. These
              three are what let the software tell two items apart — or recognise
              that they are one. */}
          <div className="field-row" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
            <BarcodeField
              model="stockItem"
              name="barcode"
              label={t("Barcode")}
              defaultValue={item.barcode}
              excludeId={id}
              hint={t("The code printed on the packaging. Scan it — a barcode you never type is a barcode you never mistype.")}
            />
            <div className="field">
              <label htmlFor="packSize">{t("One pack contains")}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  id="packSize"
                  name="packSize"
                  type="number"
                  step="0.001"
                  min="0"
                  defaultValue={item.packSize != null ? String(item.packSize) : ""}
                  placeholder="500"
                  style={{ flex: 1 }}
                />
                <select name="packUnit" defaultValue={item.packUnit ?? ""} style={{ width: 110 }}>
                  <option value="">—</option>
                  <option value="g">g</option>
                  <option value="kg">kg</option>
                  <option value="oz">oz</option>
                  <option value="lb">lb</option>
                  <option value="ml">ml</option>
                  <option value="l">L</option>
                  <option value="floz">fl oz</option>
                  <option value="gal">gal</option>
                  <option value="pcs">pcs</option>
                  <option value="each">each</option>
                </select>
              </div>
              <span className="hint">
                {t("What one purchased pack holds. This is what tells a 330 ml can apart from a 1.5 L bottle of the same drink.")}
              </span>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="supplierId">{t("Bought from")}</label>
              <select id="supplierId" name="supplierId" defaultValue={item.supplierId ?? ""}>
                <option value="">{t("not set")}</option>
                {suppliers.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="supplierCode">{t("Their code for it")}</label>
              <input id="supplierCode" name="supplierCode" type="text" defaultValue={item.supplierCode ?? ""} />
              <span className="hint">
                {t("For everything with no barcode — which in a kitchen is most of it.")}
              </span>
            </div>
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
                {/* The unit belongs in the header of an editable threshold. It
                    is the only thing telling somebody whether 500 means half a
                    kilo or half a tonne, and it is the number they are least
                    likely to sanity-check afterwards. */}
                <th style={{ width: 130 }}>
                  {t("Min")} <span className="hint">({unitLabel(item.unit)})</span>
                </th>
                <th style={{ width: 130 }}>
                  {t("Target")} <span className="hint">({unitLabel(item.unit)})</span>
                </th>
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

      </AdminForm>

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
                      <span className="hint">{f.dateTime(m.at)}</span>
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
