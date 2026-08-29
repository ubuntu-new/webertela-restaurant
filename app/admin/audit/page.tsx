import Link from "next/link";
import { db } from "@/lib/db";
import { i18nText } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";

export const dynamic = "force-dynamic";

/** მოქმედების პრეფიქსი → ქართული ჯგუფი */
const GROUP: Record<string, string> = {
  product: "Products",
  topping: "Toppings",
  toppings: "Toppings",
  combo: "Combos",
  category: "Categories",
  categories: "Categories",
  branch: "Branches",
  employee: "Staff",
  discount: "Discounts",
  setting: "Settings",
  order: "Orders",
  availability: "Availability",
  stockItem: "Stock items",
  consumption: "Consumption rules",
  transfer: "Transfers",
};

const VERB: Record<string, string> = {
  create: "Create",
  update: "Update",
  archive: "Archived",
  restore: "Restore",
  delete: "Delete",
  bulkUpdate: "Bulk update",
  upsert: "Record",
  setPassword: "Change password",
  setPin: "Change PIN",
  new: "New",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  delivering: "Delivering",
  completed: "Completed",
  cancelled: "Cancelled",
};

function label(action: string) {
  const [head, tail] = action.split(".");
  const group = GROUP[head] ?? head;
  const verb = tail ? (VERB[tail] ?? tail) : "";
  return { group, verb };
}

/** ჟურნალი კითხვადი უნდა იყოს — ერთ ხაზზე მოკლედ. */
function shortJson(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  try {
    const s = JSON.stringify(v);
    if (!s || s === "{}" || s === "null") return null;
    return s.length > 160 ? s.slice(0, 160) + "…" : s;
  } catch {
    return null;
  }
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; who?: string; days?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();

  const days = Math.min(90, Math.max(1, Number(sp.days) || 7));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [employees, logs, groups] = await Promise.all([
    db.employee.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.auditLog.findMany({
      where: {
        at: { gte: since },
        ...(sp.who ? { employeeId: sp.who } : {}),
        ...(sp.group ? { action: { startsWith: `${sp.group}.` } } : {}),
      },
      orderBy: { at: "desc" },
      take: 300,
      include: { employee: { select: { id: true, name: true } } },
    }),
    db.auditLog.groupBy({
      by: ["entityType"],
      where: { at: { gte: since } },
      _count: true,
    }),
  ]);

  // action-ის პრეფიქსები ფილტრისთვის
  const prefixes = Array.from(
    new Set(logs.map((l) => l.action.split(".")[0])),
  ).sort();

  const totalInPeriod = groups.reduce((s, g) => s + g._count, 0);

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Activity log")}</h1>
          <p>
            {t("Last")} {days} {t("days")} · {logs.length} {t("shown")}
            {totalInPeriod > logs.length && ` (${t("Total")}: ${totalInPeriod})`}
          </p>
        </div>
      </div>

      <div className="admin-panel">
        <h2>{t("Period")}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {[1, 7, 30, 90].map((d) => (
            <Link
              key={d}
              className={days === d ? "btn" : "btn btn-ghost"}
              href={`/admin/audit?days=${d}${sp.group ? `&group=${sp.group}` : ""}${sp.who ? `&who=${sp.who}` : ""}`}
            >
              {d === 1 ? t("Today") : `${d} ${t("days")}`}
            </Link>
          ))}
        </div>

        <h2>{t("What")}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <Link
            className={sp.group ? "btn btn-ghost" : "btn"}
            href={`/admin/audit?days=${days}${sp.who ? `&who=${sp.who}` : ""}`}
          >
            {t("All")}
          </Link>
          {prefixes.map((p) => (
            <Link
              key={p}
              className={sp.group === p ? "btn" : "btn btn-ghost"}
              href={`/admin/audit?days=${days}&group=${p}${sp.who ? `&who=${sp.who}` : ""}`}
            >
              {t(GROUP[p] ?? p)}
            </Link>
          ))}
        </div>

        <h2>{t("Who")}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link
            className={sp.who ? "btn btn-ghost" : "btn"}
            href={`/admin/audit?days=${days}${sp.group ? `&group=${sp.group}` : ""}`}
          >
            {t("All")}
          </Link>
          {employees.map((e) => (
            <Link
              key={e.id}
              className={sp.who === e.id ? "btn" : "btn btn-ghost"}
              href={`/admin/audit?days=${days}&who=${e.id}${sp.group ? `&group=${sp.group}` : ""}`}
            >
              {e.name}
            </Link>
          ))}
        </div>
      </div>

      <div className="admin-panel">
        {logs.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            {t("Nothing in this period.")}
          </p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 150 }}>{t("Time")}</th>
                <th style={{ width: 160 }}>{t("Who")}</th>
                <th style={{ width: 140 }}>{t("What")}</th>
                <th style={{ width: 130 }}>{t("Action")}</th>
                <th>{t("Details")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => {
                const { group, verb } = label(l.action);
                const before = shortJson(l.before);
                const after = shortJson(l.after);

                return (
                  <tr key={l.id}>
                    <td>
                      <span className="hint">{new Date(l.at).toLocaleString("ka-GE")}</span>
                    </td>
                    <td>{l.employee?.name ?? <span className="hint">{t("System")}</span>}</td>
                    <td>{t(group)}</td>
                    <td>
                      <span className="hint">{verb ? t(verb) : l.action}</span>
                    </td>
                    <td>
                      <span className="hint">{l.entityId ?? ""}</span>
                      {before && (
                        <div className="hint" style={{ color: "var(--a-danger)" }}>
                          − {before}
                        </div>
                      )}
                      {after && (
                        <div className="hint" style={{ color: "var(--a-ok)" }}>
                          + {after}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="admin-panel">
        <h2>{t("What this means")}</h2>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.8, color: "var(--a-muted)" }}>
          <li>{t("Entries are")} <b>{t("only ever added")}</b> — {t("never deleted, never edited.")}</li>
          <li>
            <span style={{ color: "var(--a-danger)" }}>−</span> {t("old value,")}{" "}
            <span style={{ color: "var(--a-ok)" }}>+</span> {t("new. Only the fields that changed.")}
          </li>
          <li>{t("“System” means the action was automatic — an order that came in from the website, for example.")}</li>
          <li>{t("The search box at the top works on this table too — type an id, a name or a number.")}</li>
        </ul>
      </div>
    </>
  );
}
