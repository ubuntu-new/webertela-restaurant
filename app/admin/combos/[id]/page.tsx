import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { i18nOf, i18nText, money, num } from "@/lib/admin-utils";
import { updateCombo, addComboSlot, archiveCombo } from "../actions";
import { tr } from "@/lib/admin-i18n";
import ImageField from "../../_components/ImageField";
import ArchiveButton from "../../_components/ArchiveButton";

export const dynamic = "force-dynamic";

const cell: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 14 };
const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
  gap: 6,
  maxHeight: 260,
  overflowY: "auto",
  border: "1px solid var(--a-line)",
  borderRadius: 8,
  padding: "10px 12px",
};

function dateVal(d: Date | null) {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}

export default async function ComboEdit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await tr();

  const [c, products, branches] = await Promise.all([
    db.combo.findUnique({
      where: { id },
      include: {
        slots: { orderBy: { sortOrder: "asc" }, include: { options: true } },
        branchCombos: true,
      },
    }),
    db.product.findMany({
      where: { deletedAt: null },
      orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }],
      include: { category: true },
    }),
    db.branch.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
  ]);
  if (!c) notFound();

  const name = i18nOf(c.name);
  const desc = i18nOf(c.description);
  const badge = i18nOf(c.badge);
  const disabled = new Set(c.branchCombos.filter((bc) => !bc.available).map((bc) => bc.branchId));
  const goneEverywhere = branches.length > 0 && disabled.size >= branches.length;

  const save = updateCombo.bind(null, id);
  const addSlot = addComboSlot.bind(null, id);
  const archive = archiveCombo.bind(null, id);

  const consequences = [
    t("It disappears from the “Combos and deals” block on the menu."),
    `${c.slots.length} ${t("slots and their product picks are kept — bring it back and it works as before.")}`,
    t("Past orders with this combo stay exactly as they are."),
    t("The products inside this combo are not touched."),
  ];

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{name.ka || name.en}</h1>
          <p>
            {t("Combo")} · {c.slots.length} {t("slots")}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/combos">
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
          <div className="field-row">
            <div className="field">
              <label htmlFor="desc_en">{t("Description")} (EN)</label>
              <textarea id="desc_en" name="desc_en" defaultValue={desc.en} />
            </div>
            <div className="field">
              <label htmlFor="desc_ka">{t("Description")} (KA)</label>
              <textarea id="desc_ka" name="desc_ka" defaultValue={desc.ka} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="badge_en">{t("Badge")} (EN)</label>
              <input id="badge_en" name="badge_en" type="text" defaultValue={badge.en} />
            </div>
            <div className="field">
              <label htmlFor="badge_ka">{t("Badge")} (KA)</label>
              <input id="badge_ka" name="badge_ka" type="text" defaultValue={badge.ka} />
            </div>
          </div>
        </div>

        <div className="admin-panel">
          <h2>{t("Photo")}</h2>
          <ImageField name="photo" defaultValue={c.photo} />
        </div>

        <div className="admin-panel">
          <h2>{t("Pricing")}</h2>
          <div className="field-row">
            <div className="field">
              <label htmlFor="pricingMode">{t("Mode")}</label>
              <select id="pricingMode" name="pricingMode" defaultValue={c.pricingMode}>
                <option value="fixed">{t("Fixed price")}</option>
                <option value="discount">{t("Discount on the total")} (%)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="price">{t("Fixed price")} (₾)</label>
              <input id="price" name="price" type="number" step="0.01" min="0" defaultValue={c.price ? money(c.price) : ""} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="percent">{t("Discount")} (%)</label>
            <input id="percent" name="percent" type="number" step="0.01" min="0" max="100" defaultValue={c.percent ? num(c.percent) : ""} />
            <span className="hint">{t("Fill in only the field that matches the mode you picked.")}</span>
          </div>
        </div>

        {c.slots.map((s, i) => {
          const chosen = new Set(s.options.map((o) => o.productId));
          const label = i18nOf(s.label);
          return (
            <div className="admin-panel" key={s.id}>
              <h2>
                {t("Slot")} {i + 1}{" "}
                <span className="hint">
                  · {chosen.size} {t("selected")}
                </span>
              </h2>
              <input type="hidden" name={`slot_${s.id}_present`} value="1" />

              <div className="field-row">
                <div className="field">
                  <label>{t("Label")} (EN)</label>
                  <input name={`slot_${s.id}_label_en`} type="text" defaultValue={label.en} />
                </div>
                <div className="field">
                  <label>{t("Label")} (KA)</label>
                  <input name={`slot_${s.id}_label_ka`} type="text" defaultValue={label.ka} />
                </div>
              </div>

              <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                <div className="field">
                  <label>{t("Mode")}</label>
                  <select name={`slot_${s.id}_mode`} defaultValue={s.mode}>
                    <option value="choice">{t("Choice")}</option>
                    <option value="fixed">{t("Fixed")}</option>
                  </select>
                </div>
                <div className="field">
                  <label>{t("Order")}</label>
                  <input name={`slot_${s.id}_order`} type="number" defaultValue={s.sortOrder} />
                </div>
                <div className="field" style={{ alignContent: "end" }}>
                  <div className="field-check">
                    <input type="checkbox" name={`slot_${s.id}_del`} />
                    <label>{t("Delete this slot")}</label>
                  </div>
                </div>
              </div>

              <div className="field">
                <label>{t("Products")}</label>
                <div style={grid}>
                  {products.map((p) => (
                    <label key={p.id} style={cell}>
                      <input type="checkbox" name={`slot_${s.id}_opt`} value={p.id} defaultChecked={chosen.has(p.id)} />
                      <span>
                        {i18nText(p.name)}
                        <span className="hint"> · {i18nText(p.category.name)}</span>
                        {!p.active && <span className="hint"> · {t("Disabled")}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          );
        })}

        <div className="admin-panel">
          <h2>{t("Availability by branch")}</h2>
          <input type="hidden" name="branches_present" value="1" />
          {goneEverywhere && (
            <div className="alert alert-error">
              <b>{t("Not sold at any branch")}</b> — {t("this combo never shows on the site.")}
            </div>
          )}
          {!goneEverywhere && disabled.size > 0 && (
            <div className="alert" style={{ background: "#fdf3d6", color: "#8a6a12" }}>
              {t("Turned off at")} {disabled.size} {t("branches")}:{" "}
              {branches.filter((b) => disabled.has(b.id)).map((b) => i18nText(b.name)).join(", ")}
            </div>
          )}
          <div style={grid}>
            {branches.map((b) => (
              <label key={b.id} style={cell}>
                <input type="checkbox" name="availableIn" value={b.id} defaultChecked={!disabled.has(b.id)} />
                <span>
                  {i18nText(b.name)} <span className="hint">· {b.code}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="admin-panel">
          <h2>{t("Validity and status")}</h2>
          <div className="field-row">
            <div className="field">
              <label htmlFor="validFrom">{t("Valid from")}</label>
              <input id="validFrom" name="validFrom" type="date" defaultValue={dateVal(c.validFrom)} />
            </div>
            <div className="field">
              <label htmlFor="validTo">{t("Valid to")}</label>
              <input id="validTo" name="validTo" type="date" defaultValue={dateVal(c.validTo)} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="sortOrder">{t("Order")}</label>
              <input id="sortOrder" name="sortOrder" type="number" defaultValue={c.sortOrder} />
            </div>
            <div className="field" style={{ alignContent: "end" }}>
              <div className="field-check">
                <input id="active" name="active" type="checkbox" defaultChecked={c.active} />
                <label htmlFor="active">{t("Enabled")}</label>
              </div>
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button className="btn" type="submit">
            {t("Save")}
          </button>
          <Link className="btn btn-ghost" href="/admin/combos">
            {t("Cancel")}
          </Link>
        </div>
      </form>

      <form action={addSlot} style={{ marginTop: 16 }}>
        <button className="btn btn-ghost" type="submit">
          + {t("Add slot")}
        </button>
      </form>

      <div className="admin-panel" style={{ maxWidth: 900, marginTop: 20 }}>
        <h2>{t("Archive")}</h2>
        <p className="hint" style={{ marginBottom: 12 }}>
          {t("For a seasonal deal it is better to set a")} <b>{t("date range")}</b> {t("or to")}{" "}
          <b>{t("turn it off")}</b> — {t("archive it once the combo is done for good.")}
        </p>
        <ArchiveButton action={archive} subject={name.ka || name.en} consequences={consequences} />
      </div>
    </>
  );
}
