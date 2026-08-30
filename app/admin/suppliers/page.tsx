import Link from "next/link";
import { db } from "@/lib/db";
import { tr } from "@/lib/admin-i18n";
import AdminForm from "../_components/AdminForm";
import NameField from "../_components/NameField";
import { createSupplier } from "./actions";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; archived?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();

  const suppliers = await db.supplier.findMany({
    where: { deletedAt: null },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { items: true } } },
  });

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Suppliers")}</h1>
          <p>{t("Who you buy from — and their code for each thing you buy.")}</p>
        </div>
      </div>

      {sp.saved && <div className="alert alert-ok">{t("Saved.")}</div>}
      {sp.archived && <div className="alert alert-ok">{t("Moved to the archive.")}</div>}
      {sp.error && <div className="alert alert-error">{sp.error}</div>}

      <div className="admin-panel">
        <p className="hint" style={{ marginTop: 0 }}>
          <b>{t("Why this exists:")}</b>{" "}
          {t(
            "most of what a kitchen buys has no barcode. For a sack of flour, the only identifier that nobody typed is the code your supplier uses for it — so the same flour ordered twice under two different names can still be recognised as one thing.",
          )}
        </p>

        {suppliers.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>{t("None yet.")}</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Name")}</th>
                <th style={{ width: 110 }}>{t("Code")}</th>
                <th style={{ width: 160 }}>{t("Contact")}</th>
                <th style={{ width: 100 }}>{t("Items")}</th>
                <th style={{ width: 90 }}>{t("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/admin/suppliers/${s.id}`}>{s.name}</Link>
                  </td>
                  <td>{s.code ?? "—"}</td>
                  <td>{s.phone ?? s.email ?? "—"}</td>
                  <td>{s._count.items}</td>
                  <td>
                    <span className={s.active ? "badge" : "badge badge-off"}>
                      {s.active ? t("Active") : t("Off")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AdminForm
        className="admin-panel admin-form"
        style={{ marginTop: 22 }}
        action={createSupplier}
        submitLabel={t("Add supplier")}
      >
        <h2>{t("New supplier")}</h2>

        <div className="field-row">
          <NameField model="supplier" name="name" label={t("Name")} required placeholder="Bidfood" />
          <div className="field">
            <label htmlFor="code">{t("Your code for them")}</label>
            <input id="code" name="code" type="text" placeholder={t("optional")} />
          </div>
        </div>

        <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div className="field">
            <label htmlFor="contact">{t("Contact person")}</label>
            <input id="contact" name="contact" type="text" />
          </div>
          <div className="field">
            <label htmlFor="phone">{t("Phone")}</label>
            <input id="phone" name="phone" type="text" />
          </div>
          <div className="field">
            <label htmlFor="email">{t("Email")}</label>
            <input id="email" name="email" type="text" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="note">{t("Note")}</label>
          <input id="note" name="note" type="text" placeholder={t("Delivery days, minimum order…")} />
        </div>
      </AdminForm>
    </>
  );
}
