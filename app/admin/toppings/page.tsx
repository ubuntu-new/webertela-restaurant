import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText, money } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { saveToppingPrices } from "./actions";

export const dynamic = "force-dynamic";

export default async function ToppingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; archived?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();

  const toppings = await db.topping.findMany({
    where: { deletedAt: null },
    orderBy: { sortOrder: "asc" },
    include: { prices: { orderBy: { sizeKey: "asc" } } },
  });

  const sizeKeys = Array.from(
    new Set(toppings.flatMap((tp) => tp.prices.map((p) => p.sizeKey))),
  ).sort();

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Toppings")}</h1>
          <p>
            {toppings.length} {t("records")} · {t("Prices by size")}
          </p>
        </div>
        <Link className="btn" href="/admin/toppings/new">
          + {t("New topping")}
        </Link>
      </div>

      {sp.saved && <div className="alert alert-ok">{t("Saved.")}</div>}
      {sp.archived && (
        <div className="alert alert-ok">
          {t("Moved to the archive.")} {t("You can restore it from the Archive page.")}
        </div>
      )}

      <form action={saveToppingPrices}>
        <div className="admin-panel">
          <h2>{t("Prices and status")}</h2>
          <p className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
            {t("Everything saves at once. To change a photo or a name, click the name.")}
          </p>

          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 46 }}></th>
                <th>{t("Name")}</th>
                <th>{t("Group")}</th>
                {sizeKeys.map((k) => (
                  <th key={k} style={{ width: 90 }}>
                    {k} (₾)
                  </th>
                ))}
                <th style={{ width: 90 }}>{t("Enabled")}</th>
              </tr>
            </thead>
            <tbody>
              {toppings.map((tp) => (
                <tr key={tp.id}>
                  <td>
                    {tp.photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="admin-thumb" src={tp.photo} alt="" />
                    ) : (
                      <div className="admin-thumb" />
                    )}
                  </td>
                  <td>
                    <Link href={`/admin/toppings/${tp.id}`}>{i18nText(tp.name)}</Link>
                    <div className="hint">
                      {i18nText(tp.name, "en")}
                      {tp.recipeOnly ? ` · ${t("recipe only")}` : ""}
                    </div>
                  </td>
                  <td>
                    <span className="hint">{tp.category ?? "—"}</span>
                  </td>
                  {sizeKeys.map((k) => {
                    const p = tp.prices.find((x) => x.sizeKey === k);
                    return (
                      <td key={k}>
                        {p ? (
                          <input
                            name={`price_${tp.id}_${k}`}
                            type="number"
                            step="0.01"
                            min="0"
                            defaultValue={money(p.price)}
                            style={{
                              width: "100%",
                              padding: "6px 8px",
                              border: "1px solid var(--a-line)",
                              borderRadius: 6,
                              font: "inherit",
                            }}
                          />
                        ) : (
                          <span className="hint">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    <input type="hidden" name={`present_${tp.id}`} value="1" />
                    <input type="checkbox" name={`active_${tp.id}`} defaultChecked={tp.active} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="form-actions" style={{ marginTop: 18 }}>
            <button className="btn" type="submit">
              {t("Save all")}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
