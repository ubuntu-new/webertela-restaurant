import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText, num } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CombosPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; archived?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();
  const f = await fmt();
  const branchCount = await db.branch.count({ where: { deletedAt: null } });

  const combos = await db.combo.findMany({
    where: { deletedAt: null },
    orderBy: { sortOrder: "asc" },
    include: { slots: { include: { options: true } }, branchCombos: true },
  });

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Combos")}</h1>
          <p>
            {combos.length} {t("records")}
          </p>
        </div>
        <Link className="btn" href="/admin/combos/new">
          + {t("New combo")}
        </Link>
      </div>

      {sp.saved && <div className="alert alert-ok">{t("Saved.")}</div>}
      {sp.archived && (
        <div className="alert alert-ok">
          {t("Moved to the archive.")} {t("Bring it back from the Archive page.")}
        </div>
      )}

      <div className="admin-panel">
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ width: 50 }}></th>
              <th>{t("Name")}</th>
              <th>{t("Pricing")}</th>
              <th>{t("Slots")}</th>
              <th>{t("Status")}</th>
            </tr>
          </thead>
          <tbody>
            {combos.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="admin-thumb" src={c.photo} alt="" />
                  ) : (
                    <div className="admin-thumb" />
                  )}
                </td>
                <td>
                  <Link href={`/admin/combos/${c.id}`}>{i18nText(c.name)}</Link>
                  <div className="hint">{i18nText(c.description)}</div>
                </td>
                <td>
                  {c.pricingMode === "fixed" ? (
                    <>{f.money(num(c.price))}</>
                  ) : (
                    <span className="badge badge-promo">−{num(c.percent)}%</span>
                  )}
                </td>
                <td>
                  {c.slots.map((s) => (
                    <div key={s.id} className="hint">
                      {i18nText(s.label)} ·{" "}
                      {s.mode === "fixed" ? t("Fixed") : `${s.options.length} ${t("options")}`}
                    </div>
                  ))}
                </td>
                <td>
                  <span className={c.active ? "badge badge-on" : "badge badge-off"}>
                    {c.active ? t("Enabled") : t("Disabled")}
                  </span>
                  {(() => {
                    const off = c.branchCombos.filter((bc) => !bc.available).length;
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
                          {gone
                            ? t("Not sold at any branch")
                            : `${t("Turned off at")} ${off} ${t("branches")}`}
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

      <div className="admin-panel">
        <h2>{t("Note")}</h2>
        <p className="hint">
          {t("A customer discount never applies to a combo — that rule is settled.")}
        </p>
      </div>
    </>
  );
}
