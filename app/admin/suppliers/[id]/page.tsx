import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import AdminForm from "../../_components/AdminForm";
import NameField from "../../_components/NameField";
import ArchiveButton from "../../_components/ArchiveButton";
import { updateSupplier, archiveSupplier } from "../actions";

export const dynamic = "force-dynamic";

export default async function SupplierEdit({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await tr();

  const supplier = await db.supplier.findUnique({
    where: { id },
    include: { items: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } } },
  });
  if (!supplier) notFound();

  const save = updateSupplier.bind(null, id);
  const archive = archiveSupplier.bind(null, id);

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{supplier.name}</h1>
          <p>
            {supplier.items.length} {t("stock items")}
            {supplier.code && ` · ${supplier.code}`}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/suppliers">
          {t("Back to list")}
        </Link>
      </div>

      {sp.error && <div className="alert alert-error">{sp.error}</div>}

      <AdminForm
        className="admin-form"
        style={{ maxWidth: 820 }}
        action={save}
        submitLabel={t("Save")}
        cancelHref="/admin/suppliers"
      >
        <div className="admin-panel">
          <h2>{t("Basics")}</h2>

          <div className="field-row">
            <NameField
              model="supplier"
              name="name"
              label={t("Name")}
              defaultValue={supplier.name}
              excludeId={id}
              required
            />
            <div className="field">
              <label htmlFor="code">{t("Your code for them")}</label>
              <input id="code" name="code" type="text" defaultValue={supplier.code ?? ""} />
            </div>
          </div>

          <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            <div className="field">
              <label htmlFor="contact">{t("Contact person")}</label>
              <input id="contact" name="contact" type="text" defaultValue={supplier.contact ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="phone">{t("Phone")}</label>
              <input id="phone" name="phone" type="text" defaultValue={supplier.phone ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="email">{t("Email")}</label>
              <input id="email" name="email" type="text" defaultValue={supplier.email ?? ""} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="note">{t("Note")}</label>
            <input id="note" name="note" type="text" defaultValue={supplier.note ?? ""} />
          </div>

          <div className="field-check">
            <input id="active" name="active" type="checkbox" defaultChecked={supplier.active} />
            <label htmlFor="active">{t("Active")}</label>
          </div>
        </div>
      </AdminForm>

      <div className="admin-panel" style={{ maxWidth: 820, marginTop: 20 }}>
        <h2>{t("What you buy from them")}</h2>
        {supplier.items.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            {t("Nothing yet. Pick this supplier on a stock item and record their code for it.")}
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Item")}</th>
                <th style={{ width: 160 }}>{t("Their code")}</th>
                <th style={{ width: 110 }}>{t("Unit")}</th>
              </tr>
            </thead>
            <tbody>
              {supplier.items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <Link href={`/admin/stock/items/${it.id}`}>{i18nText(it.name)}</Link>
                  </td>
                  <td>{it.supplierCode ?? "—"}</td>
                  <td>{it.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="admin-panel" style={{ maxWidth: 820, marginTop: 20 }}>
        <h2>{t("Archive")}</h2>
        <p className="hint" style={{ marginBottom: 12 }}>
          {t(
            "A supplier with items still attached cannot be archived — their code is what identifies those items, and losing it would leave nothing but the typed name.",
          )}
        </p>
        <ArchiveButton
          action={archive}
          label={t("Move to archive")}
          subject={supplier.name}
          consequences={[
            t("It disappears from the supplier picker on stock items."),
            t("Nothing already bought from them changes."),
          ]}
        />
      </div>
    </>
  );
}
