import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { i18nOf, i18nText, num } from "@/lib/admin-utils";
import { updateDiscount, archiveDiscount } from "../actions";
import ArchiveButton from "../../_components/ArchiveButton";
import { tr } from "@/lib/admin-i18n";

export const dynamic = "force-dynamic";

const inp: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--a-line)",
  borderRadius: 6,
  font: "inherit",
};

function dateVal(d: Date | null) {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}

export default async function DiscountEdit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await tr();

  const [d, categories, products] = await Promise.all([
    db.discount.findUnique({
      where: { id },
      include: {
        rules: {
          include: { targetCategory: true, targetSubcat: true, targetProduct: true },
        },
        _count: { select: { users: true } },
      },
    }),
    db.category.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: "asc" },
      include: { subcategories: { where: { deletedAt: null } } },
    }),
    db.product.findMany({
      where: { deletedAt: null },
      orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }],
      include: { category: true },
    }),
  ]);
  if (!d) notFound();

  const name = i18nOf(d.name);
  const save = updateDiscount.bind(null, id);
  const archive = archiveDiscount.bind(null, id);

  const ruleTarget = (r: (typeof d.rules)[number]) => {
    if (r.targetProduct) return `${t("Product")} · ${i18nText(r.targetProduct.name)}`;
    if (r.targetSubcat) return `${t("Subcategory")} · ${i18nText(r.targetSubcat.name)}`;
    if (r.targetCategory) return `${t("Category")} · ${i18nText(r.targetCategory.name)}`;
    return "—";
  };

  const consequences = [
    t("It stops applying to new orders."),
    d._count.users > 0
      ? `${d._count.users} ${t("customers have it assigned — the link stays, but the discount stops counting.")}`
      : t("It is not assigned to any customer."),
    `${d.rules.length} ${t("rules are kept — they work the same if you restore it.")}`,
    t("Discounts already given on past orders stay as they are."),
  ];

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{name.ka || name.en}</h1>
          <p>
            {d.type} · {d.rules.length} {t("rules")}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/discounts">
          {t("Back to list")}
        </Link>
      </div>

      <form className="admin-form" action={save} style={{ maxWidth: 900 }}>
        <div className="admin-panel">
          <h2>{t("Basics")}</h2>
          <div className="field-row">
            <div className="field">
              <label htmlFor="name_en">{t("Name (EN)")}</label>
              <input id="name_en" name="name_en" type="text" defaultValue={name.en} required />
            </div>
            <div className="field">
              <label htmlFor="name_ka">{t("Name (KA)")}</label>
              <input id="name_ka" name="name_ka" type="text" defaultValue={name.ka} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="type">{t("Type")}</label>
              <select id="type" name="type" defaultValue={d.type}>
                <option value="student">{t("Student")}</option>
                <option value="diplomatic">{t("Diplomatic")}</option>
                <option value="employee">{t("Employee")}</option>
                <option value="loyalty">{t("Loyalty")}</option>
                <option value="promo">{t("Promo")}</option>
                <option value="custom">{t("Other")}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="usageLimit">{t("Usage limit")}</label>
              <input id="usageLimit" name="usageLimit" type="number" min="0" defaultValue={d.usageLimit ?? ""} />
              <span className="hint">
                {t("Blank = unlimited. Used:")} {d.usedCount}
              </span>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="defaultMode">{t("Default type")}</label>
              <select id="defaultMode" name="defaultMode" defaultValue={d.defaultMode}>
                <option value="percent">{t("Percent (%)")}</option>
                <option value="fixed">{t("Fixed")} (₾)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="defaultValue">{t("Default amount")}</label>
              <input
                id="defaultValue"
                name="defaultValue"
                type="number"
                step="0.01"
                min="0"
                defaultValue={num(d.defaultValue)}
              />
              <span className="hint">{t("Used when no specific rule matches the line.")}</span>
            </div>
          </div>
        </div>

        {/* ── წესები ── */}
        <div className="admin-panel">
          <h2>{t("Rules")}</h2>
          <p className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
            {t("Priority:")} <b>{t("product → subcategory → category → default")}</b>.
          </p>

          {d.rules.length > 0 && (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Applies to")}</th>
                  <th style={{ width: 150 }}>{t("Type")}</th>
                  <th style={{ width: 110 }}>{t("Amount")}</th>
                  <th style={{ width: 70 }}>{t("Delete")}</th>
                </tr>
              </thead>
              <tbody>
                {d.rules.map((r) => (
                  <tr key={r.id}>
                    <td>{ruleTarget(r)}</td>
                    <td>
                      <select name={`rule_${r.id}_mode`} defaultValue={r.mode} style={inp}>
                        <option value="percent">%</option>
                        <option value="fixed">₾</option>
                      </select>
                    </td>
                    <td>
                      <input
                        name={`rule_${r.id}_value`}
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={num(r.value)}
                        style={inp}
                      />
                    </td>
                    <td>
                      <input type="checkbox" name={`rule_${r.id}_del`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="field" style={{ marginTop: 16 }}>
            <label>{t("New rule")}</label>
            <div className="field-row" style={{ gridTemplateColumns: "2fr 1fr 1fr" }}>
              <select name="newrule_target" defaultValue="">
                <option value="">{t("— select —")}</option>
                <optgroup label={t("Category")}>
                  {categories.map((c) => (
                    <option key={c.id} value={`cat:${c.id}`}>
                      {i18nText(c.name)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("Subcategory")}>
                  {categories.flatMap((c) =>
                    c.subcategories.map((s) => (
                      <option key={s.id} value={`sub:${s.id}`}>
                        {i18nText(c.name)} › {i18nText(s.name)}
                      </option>
                    )),
                  )}
                </optgroup>
                <optgroup label={t("Product")}>
                  {products.map((p) => (
                    <option key={p.id} value={`prod:${p.id}`}>
                      {i18nText(p.name)} · {i18nText(p.category.name)}
                    </option>
                  ))}
                </optgroup>
              </select>
              <select name="newrule_mode" defaultValue="percent">
                <option value="percent">{t("Percent (%)")}</option>
                <option value="fixed">{t("Fixed")} (₾)</option>
              </select>
              <input name="newrule_value" type="number" step="0.01" min="0" placeholder={t("Amount")} />
            </div>
          </div>
        </div>

        <div className="admin-panel">
          <h2>{t("Dates and status")}</h2>
          <div className="field-row">
            <div className="field">
              <label htmlFor="validFrom">{t("Valid from")}</label>
              <input id="validFrom" name="validFrom" type="date" defaultValue={dateVal(d.validFrom)} />
            </div>
            <div className="field">
              <label htmlFor="validTo">{t("Valid to")}</label>
              <input id="validTo" name="validTo" type="date" defaultValue={dateVal(d.validTo)} />
            </div>
          </div>
          <div className="field-check">
            <input
              id="requiresVerification"
              name="requiresVerification"
              type="checkbox"
              defaultChecked={d.requiresVerification}
            />
            <label htmlFor="requiresVerification">{t("Verification required")}</label>
          </div>
          <div className="field-check">
            <input id="active" name="active" type="checkbox" defaultChecked={d.active} />
            <label htmlFor="active">{t("Active")}</label>
          </div>
        </div>

        <div className="form-actions">
          <button className="btn" type="submit">
            {t("Save")}
          </button>
          <Link className="btn btn-ghost" href="/admin/discounts">
            {t("Cancel")}
          </Link>
        </div>
      </form>

      <div className="admin-panel" style={{ maxWidth: 900, marginTop: 20 }}>
        <h2>{t("Archive")}</h2>
        <p className="hint" style={{ marginBottom: 12 }}>
          {t("For a seasonal discount, set an end date or just turn it off.")}
        </p>
        <ArchiveButton action={archive} subject={name.ka || name.en} consequences={consequences} />
      </div>
    </>
  );
}
