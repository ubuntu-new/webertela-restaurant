import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText, money } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";

export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; archived?: string; cat?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();

  const categories = await db.category.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } });
  const branchCount = await db.branch.count({ where: { deletedAt: null } });

  const products = await db.product.findMany({
    where: { deletedAt: null, ...(sp.cat ? { categoryId: sp.cat } : {}) },
    orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }],
    include: {
      category: true,
      sizes: { orderBy: { sortOrder: "asc" } },
      promo: true,
      branchProducts: true,
    },
  });

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Products")}</h1>
          <p>
            {products.length} {t("records")}
          </p>
        </div>
        <Link className="btn" href="/admin/products/new">
          + {t("New product")}
        </Link>
      </div>

      {sp.saved && <div className="alert alert-ok">{t("Saved.")}</div>}
      {sp.archived && (
        <div className="alert alert-ok">
          {t("Moved to the archive.")} {t("You can restore it from the Archive page.")}
        </div>
      )}

      <div className="admin-panel">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className={sp.cat ? "btn btn-ghost" : "btn"} href="/admin/products">
            {t("All")}
          </Link>
          {categories.map((c) => (
            <Link
              key={c.id}
              className={sp.cat === c.id ? "btn" : "btn btn-ghost"}
              href={`/admin/products?cat=${c.id}`}
            >
              {i18nText(c.name)}
            </Link>
          ))}
        </div>
      </div>

      <div className="admin-panel">
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ width: 50 }}></th>
              <th>{t("Name")}</th>
              <th>{t("Category")}</th>
              <th>{t("Price")}</th>
              <th>{t("Promo")}</th>
              <th>{t("Status")}</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="admin-thumb" src={p.photo} alt="" />
                  ) : (
                    <div className="admin-thumb" />
                  )}
                </td>
                <td>
                  <Link href={`/admin/products/${p.id}`}>{i18nText(p.name)}</Link>
                  <div className="hint">{i18nText(p.name, "en")}</div>
                </td>
                <td>{i18nText(p.category.name)}</td>
                <td>
                  {p.sizes.length > 0
                    ? p.sizes.map((s) => `${s.key} ${money(s.price)}`).join(" · ")
                    : `${money(p.price)} ₾`}
                </td>
                <td>
                  {p.promo?.active ? (
                    <span className="badge badge-promo">
                      −{money(p.promo.value)}
                      {p.promo.mode === "percent" ? "%" : "₾"}
                    </span>
                  ) : (
                    <span className="hint">—</span>
                  )}
                </td>
                <td>
                  <span className={p.active ? "badge badge-on" : "badge badge-off"}>
                    {p.active ? t("Enabled") : t("Disabled")}
                  </span>
                  {(() => {
                    const off = p.branchProducts.filter((bp) => !bp.available).length;
                    if (off === 0) return null;
                    const gone = branchCount > 0 && off >= branchCount;
                    return (
                      <div style={{ marginTop: 4 }}>
                        <span
                          className="badge"
                          style={
                            gone
                              ? { background: "#fdecea", color: "var(--a-danger)" }
                              : { background: "#fdf3d6", color: "#8a6a12" }
                          }
                        >
                          {gone ? t("Not sold anywhere") : `${off} ${t("branches have it off")}`}
                        </span>
                      </div>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
