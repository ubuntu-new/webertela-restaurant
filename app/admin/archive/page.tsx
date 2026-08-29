import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import {
  restoreProduct,
  restoreTopping,
  restoreCombo,
  restoreBranch,
  restoreCategory,
  restoreSubcategory,
  restoreEmployee,
  restoreDiscount,
} from "./actions";

export const dynamic = "force-dynamic";

function when(d: Date | null) {
  return d ? new Date(d).toLocaleString("ka-GE") : "—";
}

function RestoreButton({ action, label }: { action: () => Promise<void>; label: string }) {
  return (
    <form action={action}>
      <button className="btn btn-ghost" type="submit">
        {label}
      </button>
    </form>
  );
}

export default async function ArchivePage() {
  const t = await tr();

  const [products, toppings, combos, branches, categories, subcategories, employees, discounts] =
    await Promise.all([
    db.product.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      include: { category: true },
    }),
    db.topping.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: "desc" } }),
    db.combo.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: "desc" } }),
    db.branch.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: "desc" } }),
    db.category.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: "desc" } }),
    db.subcategory.findMany({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      include: { category: true },
    }),
    db.employee.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: "desc" } }),
    db.discount.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: "desc" } }),
  ]);

  const total =
    products.length +
    toppings.length +
    combos.length +
    branches.length +
    categories.length +
    subcategories.length +
    employees.length +
    discounts.length;

  const sections = [
    {
      title: t("Products"),
      rows: products.map((p) => ({
        id: p.id,
        name: i18nText(p.name),
        note: i18nText(p.category.name),
        at: p.deletedAt,
        active: p.active,
        action: restoreProduct.bind(null, p.id),
      })),
    },
    {
      title: t("Toppings"),
      rows: toppings.map((tp) => ({
        id: tp.id,
        name: i18nText(tp.name),
        note: tp.category ?? "—",
        at: tp.deletedAt,
        active: tp.active,
        action: restoreTopping.bind(null, tp.id),
      })),
    },
    {
      title: t("Combos"),
      rows: combos.map((c) => ({
        id: c.id,
        name: i18nText(c.name),
        note: c.pricingMode === "fixed" ? t("Fixed price") : t("Discount"),
        at: c.deletedAt,
        active: c.active,
        action: restoreCombo.bind(null, c.id),
      })),
    },
    {
      title: t("Categories"),
      rows: categories.map((c) => ({
        id: c.id,
        name: i18nText(c.name),
        note: c.type,
        at: c.deletedAt,
        active: c.active,
        action: restoreCategory.bind(null, c.id),
      })),
    },
    {
      title: t("Subcategories"),
      rows: subcategories.map((s) => ({
        id: s.id,
        name: i18nText(s.name),
        note: i18nText(s.category.name),
        at: s.deletedAt,
        active: s.active,
        action: restoreSubcategory.bind(null, s.id),
      })),
    },
    {
      title: t("Branches"),
      rows: branches.map((b) => ({
        id: b.id,
        name: i18nText(b.name),
        note: b.code,
        at: b.deletedAt,
        active: b.active,
        action: restoreBranch.bind(null, b.id),
      })),
    },
    {
      title: t("Staff"),
      rows: employees.map((e) => ({
        id: e.id,
        name: e.name,
        note: e.role,
        at: e.deletedAt,
        active: e.active,
        action: restoreEmployee.bind(null, e.id),
      })),
    },
    {
      title: t("Discounts"),
      rows: discounts.map((d) => ({
        id: d.id,
        name: i18nText(d.name),
        note: d.type,
        at: d.deletedAt,
        active: d.active,
        action: restoreDiscount.bind(null, d.id),
      })),
    },
  ].filter((s) => s.rows.length > 0);

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Archive")}</h1>
          <p>
            {total} {t("records")}
          </p>
        </div>
      </div>

      <div className="admin-panel">
        <h2>{t("How it works")}</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "var(--a-muted)" }}>
          <li>{t("Nothing is deleted from the database — an archived record is simply hidden from the lists.")}</li>
          <li>{t("Restoring keeps the on/off status: if it was on before it went to the archive, it comes back on.")}</li>
          <li>{t("Order history is never touched — it keeps its own copies of the products.")}</li>
        </ul>
      </div>

      {total === 0 && (
        <div className="admin-panel">
          <p className="hint" style={{ margin: 0 }}>
            {t("The archive is empty.")}
          </p>
        </div>
      )}

      {sections.map((sec) => (
        <div className="admin-panel" key={sec.title}>
          <h2>
            {sec.title} <span className="hint">· {sec.rows.length}</span>
          </h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Name")}</th>
                <th></th>
                <th>{t("After restore")}</th>
                <th>{t("Archived")}</th>
                <th style={{ width: 130 }}></th>
              </tr>
            </thead>
            <tbody>
              {sec.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>
                    <span className="hint">{r.note}</span>
                  </td>
                  <td>
                    <span className={r.active ? "badge badge-on" : "badge badge-off"}>
                      {r.active ? t("Comes back on") : t("Stays off")}
                    </span>
                  </td>
                  <td>
                    <span className="hint">{when(r.at)}</span>
                  </td>
                  <td>
                    <RestoreButton action={r.action} label={t("Restore")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
