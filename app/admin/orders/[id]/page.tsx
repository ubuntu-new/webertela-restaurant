import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { setOrderStatus } from "../actions";
import { detailLines, lineColor } from "@/lib/item-detail";
import { tr } from "@/lib/admin-i18n";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  new: "New",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  delivering: "Out for delivery",
  completed: "Done",
  cancelled: "Cancelled",
};

/** რა შეიძლება მოხდეს მიმდინარე სტატუსიდან. */
const NEXT: Record<string, string[]> = {
  new: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["delivering", "completed", "cancelled"],
  delivering: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const KIND: Record<string, string> = {
  pizza: "Pizza",
  half_and_half: "Half and half",
  combo: "Combo",
  sticks: "Sticks",
  product: "Product",
};

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await tr();
  const f = await fmt();

  const o = await db.order.findUnique({
    where: { id },
    include: {
      branch: true,
      items: true,
      createdBy: { select: { name: true, role: true } },
      driver: { select: { name: true } },
    },
  });
  if (!o) notFound();

  // ძველი შეკვეთები ინგრედიენტების ასლის გარეშე შეიქმნა — მათთვის
  // პროდუქტის მიმდინარე რეცეპტს ვიყენებთ, რომ სია მაინც ჩანდეს
  const productIds = o.items.map((i) => i.productId).filter((x): x is string => !!x);
  const recipes = productIds.length
    ? await db.productTopping.findMany({
        where: { productId: { in: productIds } },
        include: { topping: { select: { name: true } } },
        orderBy: { sortOrder: "asc" },
      })
    : [];
  const recipeOf = (pid: string | null) =>
    pid
      ? recipes
          .filter((r) => r.productId === pid)
          .map((r) => String((r.topping.name as Record<string, unknown>)?.en ?? ""))
          .filter(Boolean)
      : [];

  const history = Array.isArray(o.statusHistory)
    ? (o.statusHistory as { status?: string; at?: string; by?: string }[])
    : [];

  const addr =
    o.address && typeof o.address === "object" && "text" in (o.address as Record<string, unknown>)
      ? String((o.address as Record<string, unknown>).text)
      : null;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>
            {t("Order #")}
            {o.orderNo}
          </h1>
          <p>
            {i18nText(o.branch.name)} · {o.fulfillmentType === "pickup" ? t("Pickup") : t("Delivery")}{" "}
            · {f.dateTime(o.createdAt)}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/orders">
          {t("Back to list")}
        </Link>
      </div>

      <div className="admin-panel">
        <h2>
          {t("Status")} — {LABEL[o.status] ? t(LABEL[o.status]) : o.status}
        </h2>
        {NEXT[o.status]?.length ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {NEXT[o.status].map((s) => {
              const go = setOrderStatus.bind(null, id, s);
              return (
                <form key={s} action={go}>
                  <button
                    className={s === "cancelled" ? "btn btn-ghost" : "btn"}
                    type="submit"
                    style={s === "cancelled" ? { color: "var(--a-danger)", borderColor: "#f3d5d2" } : undefined}
                  >
                    {t(LABEL[s])}
                  </button>
                </form>
              );
            })}
          </div>
        ) : (
          <p className="hint" style={{ margin: 0 }}>
            {t("This order is closed — the status cannot change.")}
          </p>
        )}
      </div>

      <div className="admin-panel">
        <h2>{t("Customer")}</h2>
        <table className="admin-table">
          <tbody>
            {(o.createdBy || o.posId) && (
              <tr>
                <td style={{ width: 160 }}>{t("Taken by")}</td>
                <td>
                  {o.createdBy?.name ?? (o.source === "web" ? t("Website") : o.source)}
                  {o.posId && <span className="hint"> · {o.posId}</span>}
                </td>
              </tr>
            )}
            {o.driver && (
              <tr>
                <td>{t("Driver")}</td>
                <td>
                  🛵 {o.driver.name}
                  {o.deliveredAt && (
                    <span className="hint">
                      {" "}
                      · {t("delivered")} {f.dateTime(o.deliveredAt)}
                    </span>
                  )}
                </td>
              </tr>
            )}
            <tr>
              <td style={{ width: 160 }}>{t("Name")}</td>
              <td>{o.customerName ?? "—"}</td>
            </tr>
            <tr>
              <td>{t("Phone")}</td>
              <td>{o.customerPhone ?? "—"}</td>
            </tr>
            {addr && (
              <tr>
                <td>{t("Address")}</td>
                <td>{addr}</td>
              </tr>
            )}
            {o.notes && (
              <tr>
                <td>{t("Note")}</td>
                <td>{o.notes}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-panel">
        <h2>{t("Lines")}</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t("Name")}</th>
              <th style={{ width: 130 }}>{t("Type")}</th>
              <th style={{ width: 70 }}>{t("Qty")}</th>
              <th style={{ width: 110 }}>{t("Price")}</th>
              <th style={{ width: 110 }}>{t("Total")}</th>
            </tr>
          </thead>
          <tbody>
            {o.items.map((it) => (
              <tr key={it.id}>
                <td>
                  <b>{i18nText(it.name)}</b>
                  {(() => {
                    const lines = detailLines(it.config, recipeOf(it.productId));
                    if (lines.length === 0) return null;
                    return (
                      <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 13, lineHeight: 1.6 }}>
                        {lines.map((l, i) => (
                          <li key={i} style={{ color: lineColor(l.kind) ?? "var(--a-muted)" }}>
                            {l.kind === "removed" ? "− " : l.kind === "added" ? "+ " : ""}
                            {l.text}
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                </td>
                <td>
                  <span className="hint">{KIND[it.kind] ? t(KIND[it.kind]) : it.kind}</span>
                </td>
                <td>{it.qty}</td>
                <td>{f.money(Number(it.unitPrice))}</td>
                <td>
                  <b>{f.money(Number(it.lineTotal))}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="admin-table" style={{ marginTop: 16, maxWidth: 340, marginLeft: "auto" }}>
          <tbody>
            <tr>
              <td>{t("Subtotal")}</td>
              <td style={{ textAlign: "right" }}>{f.money(Number(o.subtotal))}</td>
            </tr>
            <tr>
              <td>{t("Delivery")}</td>
              <td style={{ textAlign: "right" }}>
                {Number(o.deliveryFee) > 0 ? f.money(Number(o.deliveryFee)) : t("Free")}
              </td>
            </tr>
            <tr>
              <td>
                <b>{t("Total")}</b>
              </td>
              <td style={{ textAlign: "right" }}>
                <b>{f.money(Number(o.total))}</b>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="hint" style={{ textAlign: "right", marginTop: 6 }}>
          {t("The price is worked out on the server — nothing from the client is trusted.")}
        </p>
      </div>

      {history.length > 0 && (
        <div className="admin-panel">
          <h2>{t("History")}</h2>
          <table className="admin-table">
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td style={{ width: 180 }}>
                    {LABEL[h.status ?? ""] ? t(LABEL[h.status ?? ""]) : h.status}
                  </td>
                  <td>
                    <span className="hint">{f.dateTime(h.at)}</span>
                  </td>
                  <td>
                    <span className="hint">{h.by ?? ""}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
