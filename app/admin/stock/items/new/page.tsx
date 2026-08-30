import Link from "next/link";
import { tr } from "@/lib/admin-i18n";
import AdminForm from "@/app/admin/_components/AdminForm";
import NameField from "@/app/admin/_components/NameField";
import { db } from "@/lib/db";
import BarcodeField from "@/app/admin/_components/BarcodeField";
import { createStockItem } from "../../actions";

export const dynamic = "force-dynamic";

export default async function NewStockItem() {
  const t = await tr();

  const suppliers = await db.supplier.findMany({
    where: { deletedAt: null, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("New stock item")}</h1>
          <p>{t("You set the minimums after you create it")}</p>
        </div>
        <Link className="btn btn-ghost" href="/admin/stock/items">
          {t("Back to list")}
        </Link>
      </div>

      <AdminForm
        action={createStockItem}
        submitLabel={t("Create")}
        pendingLabel={t("Creating…")}
        cancelHref="/admin/stock/items"
      >
        <div className="field-row">
          <NameField
            model="stockItem"
            name="name_en"
            label={`${t("Name")} (EN)`}
            required
            autoFocus
            placeholder="Mozzarella"
            contextFields={{ barcode: "barcode", packSize: "packSize", packUnit: "packUnit", supplierId: "supplierId", supplierCode: "supplierCode" }}
          />
          <div className="field">
            <label htmlFor="name_ka">{t("Name")} (KA)</label>
            <input id="name_ka" name="name_ka" type="text" placeholder={t("Mozzarella")} />
          </div>
        </div>

        <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div className="field">
            <label htmlFor="unit">{t("Unit")}</label>
            <select id="unit" name="unit" defaultValue="kg">
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
          </div>
          <div className="field">
            <label htmlFor="category">{t("Group")}</label>
            <input id="category" name="category" type="text" placeholder="dairy / meat / veg" />
          </div>
          <div className="field">
            <label htmlFor="sku">SKU</label>
            <input id="sku" name="sku" type="text" placeholder={t("optional")} />
          </div>
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
            defaultValue={null}
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
                defaultValue=""
                placeholder="500"
                style={{ flex: 1 }}
              />
              <select name="packUnit" defaultValue="" style={{ width: 110 }}>
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
            <select id="supplierId" name="supplierId" defaultValue="">
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
            <input id="supplierCode" name="supplierCode" type="text" defaultValue="" />
            <span className="hint">
              {t("For everything with no barcode — which in a kitchen is most of it.")}
            </span>
          </div>
        </div>

        <div className="field-check">
          <input id="isProduced" name="isProduced" type="checkbox" />
          <label htmlFor="isProduced">{t("Made in-house from a recipe (dough, sauce)")}</label>
        </div>

        <div className="field">
          <label htmlFor="note">{t("Note")}</label>
          <input id="note" name="note" type="text" />
        </div>

        <p className="hint">
          <b>{t("Picking the right unit matters")}</b>{" "}
          {t(
            "— recipes are written in the same unit. If you keep mozzarella in kilograms, the recipe is in kilograms too (0.18 kg).",
          )}
        </p>

      </AdminForm>
    </>
  );
}
