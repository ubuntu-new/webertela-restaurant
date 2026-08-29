import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText, num } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  student: "Student",
  diplomatic: "Diplomatic",
  employee: "Employee",
  loyalty: "Loyalty",
  promo: "Promo",
  custom: "Other",
};

export default async function DiscountsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; archived?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();

  const discounts = await db.discount.findMany({
    where: { deletedAt: null },
    orderBy: [{ type: "asc" }],
    include: { _count: { select: { rules: true, users: true } } },
  });

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Discounts")}</h1>
          <p>
            {discounts.length} {t("records")}
          </p>
        </div>
        <Link className="btn" href="/admin/discounts/new">
          + {t("New discount")}
        </Link>
      </div>

      {sp.saved && <div className="alert alert-ok">{t("Saved.")}</div>}
      {sp.archived && (
        <div className="alert alert-ok">{t("Moved to the archive. Restore it from the Archive page.")}</div>
      )}

      <div className="admin-panel">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Name")}</th>
              <th>{t("Type")}</th>
              <th>{t("Default")}</th>
              <th>{t("Rules")}</th>
              <th>{t("Assigned")}</th>
              <th>{t("Status")}</th>
            </tr>
          </thead>
          <tbody>
            {discounts.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link href={`/admin/discounts/${d.id}`}>{i18nText(d.name)}</Link>
                  {d.requiresVerification && <div className="hint">{t("Verification required")}</div>}
                </td>
                <td>{t(TYPE_LABEL[d.type] ?? d.type)}</td>
                <td>
                  −{num(d.defaultValue)}
                  {d.defaultMode === "percent" ? "%" : "₾"}
                </td>
                <td>{d._count.rules}</td>
                <td>{d._count.users}</td>
                <td>
                  <span className={d.active ? "badge badge-on" : "badge badge-off"}>
                    {d.active ? t("Active") : t("Disabled")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-panel">
        <h2>{t("How it's worked out")}</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "var(--a-muted)" }}>
          <li>
            {t("For each line we look for the most specific rule:")}{" "}
            <b>{t("product → subcategory → category → default")}</b>.
          </li>
          <li>{t("Combos and items already on special are excluded — that is set in Settings.")}</li>
          <li>{t("A product with “Discountable” unticked is never discounted.")}</li>
        </ul>
      </div>
    </>
  );
}
