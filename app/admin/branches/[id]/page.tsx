import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { i18nOf } from "@/lib/admin-utils";
import { updateBranch, addTerminal, archiveBranch } from "../actions";
import ArchiveButton from "../../_components/ArchiveButton";
import { tr } from "@/lib/admin-i18n";
import AdminForm from "@/app/admin/_components/AdminForm";
import NameField from "@/app/admin/_components/NameField";

export const dynamic = "force-dynamic";

const inp: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid var(--a-line)",
  borderRadius: 6,
  font: "inherit",
};

function hoursOf(v: unknown): { en: string; ka: string } {
  if (v && typeof v === "object" && "display" in (v as Record<string, unknown>)) {
    return i18nOf((v as Record<string, unknown>).display);
  }
  return { en: "", ka: "" };
}

export default async function BranchEdit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await tr();

  const b = await db.branch.findUnique({
    where: { id },
    include: { terminals: { orderBy: { posId: "asc" } }, _count: { select: { orders: true } } },
  });
  if (!b) notFound();

  const name = i18nOf(b.name);
  const address = i18nOf(b.address);
  const hours = hoursOf(b.hours);

  const save = updateBranch.bind(null, id);
  const addPos = addTerminal.bind(null, id);
  const archive = archiveBranch.bind(null, id);

  const consequences = [
    t("It disappears from the branch list on the site and from the order form."),
    b._count.orders > 0
      ? `${b._count.orders} ${t("orders stay in the database and in reports — history is not affected.")}`
      : t("No orders."),
    `${b.terminals.length} ${t("POS terminals are kept — the POS IDs are needed for history.")}`,
    t("Staff assignments and shift records stay."),
  ];

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{name.ka || name.en}</h1>
          <p>
            <code>{b.code}</code> · {b.terminals.length} POS · {b._count.orders} {t("orders")}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/branches">
          {t("Back to list")}
        </Link>
      </div>

      <AdminForm
        className="admin-form"
        style={{ maxWidth: 900 }}
        action={save}
        submitLabel={t("Save")}
        cancelHref="/admin/branches"
      >
        <div className="admin-panel">
          <h2>{t("Basics")}</h2>

          <div className="field-row">
            <div className="field">
              <label htmlFor="code">{t("Branch code")}</label>
              <input id="code" name="code" type="text" defaultValue={b.code} required />
              <span className="hint">{t("Must be unique. E.g. TBS-01")}</span>
            </div>
            <div className="field">
              <label htmlFor="sortOrder">{t("Order")}</label>
              <input id="sortOrder" name="sortOrder" type="number" defaultValue={b.sortOrder} />
            </div>
          </div>

          <div className="field-row">
            <NameField
              model="branch"
              name="name_en"
              label={t("Name (EN)")}
              defaultValue={name.en}
              excludeId={id}
              required
            />
            <div className="field">
              <label htmlFor="name_ka">{t("Name (KA)")}</label>
              <input id="name_ka" name="name_ka" type="text" defaultValue={name.ka} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="address_en">{t("Address (EN)")}</label>
              <input id="address_en" name="address_en" type="text" defaultValue={address.en} />
            </div>
            <div className="field">
              <label htmlFor="address_ka">{t("Address (KA)")}</label>
              <input id="address_ka" name="address_ka" type="text" defaultValue={address.ka} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="hours">{t("Opening hours (EN)")}</label>
              <input id="hours" name="hours" type="text" defaultValue={hours.en} />
            </div>
            <div className="field">
              <label htmlFor="hours_ka">{t("Opening hours (KA)")}</label>
              <input id="hours_ka" name="hours_ka" type="text" defaultValue={hours.ka} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="phone">{t("Phone")}</label>
              <input id="phone" name="phone" type="text" defaultValue={b.phone ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="openingFloat">{t("Cash normally in the drawer at open")}</label>
              <input
                id="openingFloat"
                name="openingFloat"
                type="number"
                step="0.01"
                min="0"
                defaultValue={b.openingFloat == null ? "" : String(b.openingFloat)}
              />
              <span className="hint">
                {t(
                  "Only a reminder on the till — the cashier still counts, and the counted figure is the one every drawer total is built on. Leave it empty if it varies.",
                )}
              </span>
            </div>
            <div className="field" style={{ alignContent: "end" }}>
              <div className="field-check">
                <input id="active" name="active" type="checkbox" defaultChecked={b.active} />
                <label htmlFor="active">{t("Open (taking orders)")}</label>
              </div>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="lat">{t("Latitude (lat)")}</label>
              <input id="lat" name="lat" type="number" step="0.0000001" defaultValue={b.lat ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="lng">{t("Longitude (lng)")}</label>
              <input id="lng" name="lng" type="number" step="0.0000001" defaultValue={b.lng ?? ""} />
            </div>
          </div>
        </div>

        <div className="admin-panel">
          <h2>{t("POS terminals")}</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>POS ID</th>
                <th>{t("Label (EN)")}</th>
                <th>{t("Label (KA)")}</th>
                <th style={{ width: 80 }}>{t("Active")}</th>
                <th style={{ width: 80 }}>{t("Card")}</th>
                <th style={{ width: 70 }}>{t("Delete")}</th>
              </tr>
            </thead>
            <tbody>
              {b.terminals.map((term) => {
                const l = i18nOf(term.label);
                return (
                  <tr key={term.id}>
                    <td>
                      <code>{term.posId}</code>
                      <input type="hidden" name={`term_${term.id}_present`} value="1" />
                    </td>
                    <td>
                      <input name={`term_${term.id}_label_en`} type="text" defaultValue={l.en} style={inp} />
                    </td>
                    <td>
                      <input name={`term_${term.id}_label_ka`} type="text" defaultValue={l.ka} style={inp} />
                    </td>
                    <td>
                      <input type="checkbox" name={`term_${term.id}_active`} defaultChecked={term.active} />
                    </td>
                    <td>
                      <input type="checkbox" name={`term_${term.id}_card`} defaultChecked={term.hasCardTerminal} />
                    </td>
                    <td>
                      <input type="checkbox" name={`term_${term.id}_del`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 12 }}>
            {t(
              "POS IDs are built from the branch code and never change — they are stored on every order. Deleting a terminal only deactivates it; the POS ID stays for history.",
            )}
          </p>
        </div>

      </AdminForm>

      <form action={addPos} style={{ marginTop: 16 }}>
        <button className="btn btn-ghost" type="submit">
          + {t("Add POS terminal")}
        </button>
      </form>

      <div className="admin-panel" style={{ maxWidth: 900, marginTop: 20 }}>
        <h2>{t("Archive")}</h2>
        <p className="hint" style={{ marginBottom: 12 }}>
          {t(
            "For a temporary closure (repairs, a holiday) use the “Open” toggle. Archive is for when a branch shuts for good.",
          )}
        </p>
        <ArchiveButton action={archive} subject={name.ka || name.en} consequences={consequences} />
      </div>
    </>
  );
}
