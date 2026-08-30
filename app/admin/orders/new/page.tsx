import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { fmt } from "@/lib/format";
import { createManualOrder } from "../actions";
import AdminForm from "@/app/admin/_components/AdminForm";

export const dynamic = "force-dynamic";

const SIZES = ["S", "M", "XL"];

const qtyInp: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--a-line)",
  borderRadius: 6,
  font: "inherit",
  textAlign: "center",
};

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const f = await fmt();

  const [branches, products, settings] = await Promise.all([
    db.branch.findMany({ where: { deletedAt: null, active: true }, orderBy: { sortOrder: "asc" } }),
    db.product.findMany({
      where: { deletedAt: null, active: true },
      orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }],
      include: { category: true, sizes: { orderBy: { sortOrder: "asc" } } },
    }),
    db.setting.findUnique({ where: { key: "order" } }),
  ]);

  const order = (settings?.value ?? {}) as Record<string, unknown>;
  const minOrder = Number(order.minOrder ?? 0);

  // ჯგუფდება კატეგორიით — ტელეფონზე სწრაფად უნდა მოძებნო
  const groups = new Map<string, typeof products>();
  for (const p of products) {
    const key = i18nText(p.category.name);
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>New order</h1>
          <p>Phone or walk-in — priced exactly like the website</p>
        </div>
        <Link className="btn btn-ghost" href="/admin/orders">
          ← Back to list
        </Link>
      </div>

      {sp.error && <div className="alert alert-error">{sp.error}</div>}

      <AdminForm
        className="admin-form"
        style={{ maxWidth: "none" }}
        action={createManualOrder}
        submitLabel={"Create order"}
        cancelHref="/admin/orders"
      >
        {/* ── customer ── */}
        <div className="admin-panel">
          <h2>Customer</h2>

          <div className="field-row">
            <div className="field">
              <label htmlFor="customerName">Name</label>
              <input id="customerName" name="customerName" type="text" required autoFocus />
            </div>
            <div className="field">
              <label htmlFor="customerPhone">Phone</label>
              <input id="customerPhone" name="customerPhone" type="text" required inputMode="tel" />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="branchId">Branch</label>
              <select id="branchId" name="branchId" required>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {i18nText(b.name)} · {b.code}
                  </option>
                ))}
              </select>
              <span className="hint">Stock is deducted from this branch.</span>
            </div>
            <div className="field">
              <label htmlFor="fulfillment">Type</label>
              <select id="fulfillment" name="fulfillment" defaultValue="delivery">
                <option value="delivery">Delivery</option>
                <option value="pickup">Pickup</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="address">Delivery address</label>
            <input id="address" name="address" type="text" placeholder="Required for delivery" />
          </div>

          <div className="field">
            <label htmlFor="notes">Note</label>
            <input id="notes" name="notes" type="text" placeholder="Doorbell, allergy, timing…" />
          </div>
        </div>

        {/* ── items ── */}
        {[...groups.entries()].map(([cat, list]) => (
          <div className="admin-panel" key={cat}>
            <h2>{cat}</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th style={{ width: 200 }}>Size</th>
                  <th style={{ width: 120 }}>Price</th>
                  <th style={{ width: 100 }}>Qty</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const hasSizes = p.sizes.length > 0;
                  return (
                    <tr key={p.id}>
                      <td>{i18nText(p.name)}</td>
                      <td>
                        {hasSizes ? (
                          <select name={`size_${p.id}`} defaultValue="1" style={qtyInp}>
                            {SIZES.map((k, i) => {
                              const sz = p.sizes.find((s) => s.key === k);
                              if (!sz) return null;
                              return (
                                <option key={k} value={i}>
                                  {k} · {f.money(Number(sz.price))}
                                </option>
                              );
                            })}
                          </select>
                        ) : (
                          <span className="hint">—</span>
                        )}
                      </td>
                      <td>
                        {hasSizes ? (
                          <span className="hint">by size</span>
                        ) : (
                          <b>{p.price != null ? f.money(Number(p.price)) : "—"}</b>
                        )}
                      </td>
                      <td>
                        <input
                          name={`qty_${p.id}`}
                          type="number"
                          min="0"
                          step="1"
                          placeholder="0"
                          style={qtyInp}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

        <div className="admin-panel">
          <h2>Before you save</h2>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "var(--a-muted)" }}>
            <li>
              The total is calculated <b>on the server</b> from current prices — the same code the
              website uses, so a phone order and a web order can never disagree.
            </li>
            {minOrder > 0 && (
              <li>
                Minimum order is <b>{f.money(minOrder)}</b>. Manual orders are exempt — staff sometimes
                need to record a small one.
              </li>
            )}
            <li>Stock is deducted automatically, exactly as for a website order.</li>
            <li>
              Extra toppings can’t be added here yet. For a customised pizza, add it and note the
              changes in the order note.
            </li>
          </ul>
        </div>

      </AdminForm>
    </>
  );
}
