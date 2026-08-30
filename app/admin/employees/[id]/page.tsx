import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { i18nText, num } from "@/lib/admin-utils";
import { getSession } from "@/lib/admin-auth";
import {
  updateEmployee,
  setPassword,
  setPin,
  clearPin,
  archiveEmployee,
} from "../actions";
import ArchiveButton from "../../_components/ArchiveButton";
import { PERMISSIONS } from "@/lib/permissions";
import { tr } from "@/lib/admin-i18n";
import { fmt } from "@/lib/format";
import AdminForm from "@/app/admin/_components/AdminForm";
import NameField from "@/app/admin/_components/NameField";

export const dynamic = "force-dynamic";

const ROLES = [
  { v: "super_admin", l: "Super admin — every permission" },
  { v: "branch_manager", l: "Branch manager" },
  { v: "cashier", l: "Cashier" },
  { v: "kitchen", l: "Kitchen" },
  { v: "driver", l: "Driver" },
];

const cell: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 14 };

export default async function EmployeeEdit({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pw?: string; pin?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const t = await tr();
  const f = await fmt();

  const [e, branches, session] = await Promise.all([
    db.employee.findUnique({
      where: { id },
      include: { branches: true, _count: { select: { shifts: true, orders: true } } },
    }),
    db.branch.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    getSession(),
  ]);
  if (!e) notFound();

  const myBranches = new Set(e.branches.map((b) => b.branchId));
  const perms = new Set(e.permissions);
  const isSelf = session?.sub === e.id;

  const save = updateEmployee.bind(null, id);
  const savePw = setPassword.bind(null, id);
  const savePin = setPin.bind(null, id);
  const dropPin = clearPin.bind(null, id);
  const archive = archiveEmployee.bind(null, id);

  const consequences = [
    t("They will no longer be able to sign in to the admin panel or the POS."),
    t("The POS PIN is cleared — that PIN becomes free for someone else."),
    e._count.orders > 0
      ? `${e._count.orders} ${t("orders they appear on stay untouched.")}`
      : t("No orders."),
    e._count.shifts > 0
      ? `${e._count.shifts} ${t("shift records stay — payroll history is not affected.")}`
      : t("No shift records."),
  ];

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{e.name}</h1>
          <p>
            {e.title ?? e.role}
            {isSelf && ` · ${t("this is you")}`}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/employees">
          {t("Back to list")}
        </Link>
      </div>

      {sp.error && <div className="alert alert-error">{sp.error}</div>}
      {sp.pw && <div className="alert alert-ok">{t("Password changed.")}</div>}
      {sp.pin && <div className="alert alert-ok">{t("PIN changed.")}</div>}

      <AdminForm
        className="admin-form"
        style={{ maxWidth: 880 }}
        action={save}
        submitLabel={t("Save")}
        cancelHref="/admin/employees"
      >
        <div className="admin-panel">
          <h2>{t("Basics")}</h2>

          <div className="field-row">
            <NameField
              model="employee"
              name="name"
              label={t("Full name")}
              defaultValue={e.name}
              excludeId={id}
              required
            />
            <div className="field">
              <label htmlFor="title">{t("Job title")}</label>
              <input id="title" name="title" type="text" defaultValue={e.title ?? ""} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="email">{t("Email (for admin sign-in)")}</label>
              <input id="email" name="email" type="text" defaultValue={e.email ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="phone">{t("Phone")}</label>
              <input id="phone" name="phone" type="text" defaultValue={e.phone ?? ""} />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="role">{t("Role")}</label>
              <select id="role" name="role" defaultValue={e.role}>
                {ROLES.map((r) => (
                  <option key={r.v} value={r.v}>
                    {t(r.l)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="hourlyRate">{t("Hourly rate")} ({f.symbol})</label>
              <input
                id="hourlyRate"
                name="hourlyRate"
                type="number"
                step="0.01"
                min="0"
                defaultValue={e.hourlyRate ? num(e.hourlyRate) : ""}
              />
            </div>
          </div>
        </div>

        <div className="admin-panel">
          <h2>{t("Permissions")}</h2>
          <p className="hint" style={{ marginTop: -8, marginBottom: 12 }}>
            {t("super_admin does not need these boxes ticked — it already has every permission.")}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 8 }}>
            {PERMISSIONS.map((p) => (
              <label key={p.id} style={cell}>
                <input type="checkbox" name="perm" value={p.id} defaultChecked={perms.has(p.id)} />
                <span>{p.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="admin-panel">
          <h2>{t("Branches")}</h2>
          <input type="hidden" name="branches_present" value="1" />
          <div className="field">
            <label htmlFor="homeBranchId">{t("Home branch")}</label>
            <select id="homeBranchId" name="homeBranchId" defaultValue={e.homeBranchId ?? ""}>
              <option value="">—</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {i18nText(b.name)} · {b.code}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>{t("Can work at")}</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
              {branches.map((b) => (
                <label key={b.id} style={cell}>
                  <input type="checkbox" name="branch" value={b.id} defaultChecked={myBranches.has(b.id)} />
                  <span>
                    {i18nText(b.name)} <span className="hint">· {b.code}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="admin-panel">
          <h2>{t("Status")}</h2>
          <div className="field-check">
            <input id="active" name="active" type="checkbox" defaultChecked={e.active} />
            <label htmlFor="active">{t("Active (can sign in)")}</label>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            {e._count.shifts} {t("shifts")} · {e._count.orders} {t("orders")}
          </p>
        </div>

      </AdminForm>

      {/* ── პაროლი ── */}
      <AdminForm
        className="admin-panel admin-form"
        style={{ maxWidth: 880, marginTop: 20 }}
        action={savePw}
        submitLabel={t("Set password")}
      >
        <h2>{t("Admin password")}</h2>
        <p className="hint" style={{ marginTop: -8 }}>
          {e.passwordHash
            ? t("Set. Entering a new one replaces it.")
            : t("Not set yet — they cannot sign in.")}
        </p>
        <div className="field">
          <label htmlFor="newPassword">{t("New password")}</label>
          <input id="newPassword" name="newPassword" type="text" placeholder={t("at least 10 characters")} />
          <span className="hint">{t("Write it down and hand it over — you will not see it again after saving.")}</span>
        </div>
      </AdminForm>

      {/* ── POS PIN ── */}
      <AdminForm
        className="admin-panel admin-form"
        style={{ maxWidth: 880 }}
        action={savePin}
        submitLabel={t("Set PIN")}
      >
        <h2>POS PIN</h2>
        <p className="hint" style={{ marginTop: -8 }}>
          {e.posPinHash ? t("Set.") : t("Not set yet — they cannot sign in to the POS.")}
        </p>
        <div className="field">
          <label htmlFor="newPin">{t("New PIN")}</label>
          <input id="newPin" name="newPin" type="text" inputMode="numeric" placeholder={t("4–8 digits")} />
          <span className="hint">{t("It must be unique — a repeat will be rejected.")}</span>
        </div>
      </AdminForm>

      {e.posPinHash && (
        <form action={dropPin} style={{ maxWidth: 880, marginTop: -8 }}>
          <button className="btn btn-ghost" type="submit">
            {t("Clear PIN")}
          </button>
        </form>
      )}

      {/* ── არქივი ── */}
      {!isSelf && (
        <div className="admin-panel" style={{ maxWidth: 880, marginTop: 20 }}>
          <h2>{t("Archive")}</h2>
          <p className="hint" style={{ marginBottom: 12 }}>
            {t("For time off, the “Active” toggle is better. Archive is for when someone has left.")}
          </p>
          <ArchiveButton action={archive} subject={e.name} consequences={consequences} />
        </div>
      )}
    </>
  );
}
