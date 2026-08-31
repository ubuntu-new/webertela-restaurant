import Link from "next/link";
import { db } from "@/lib/db";
import { tr } from "@/lib/admin-i18n";
import { fmt } from "@/lib/format";
import { i18nText } from "@/lib/admin-utils";
import { ABANDONED_AFTER_HOURS } from "@/lib/shift";
import { cashSummaries } from "@/lib/cash";
import AdminForm from "../_components/AdminForm";
import { closeShift } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Who was working, and for how long.
 *
 * This screen exists because prime cost was half a number. Hours are recorded
 * by the till now — signing in starts a shift, signing out ends it — but the
 * ones nobody closed still need a person, and that person needs somewhere to
 * do it. `advice.ts` has been offering a "Close the shift" button since before
 * anything could close one; this is where it now goes.
 */
export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ closed?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();
  const f = await fmt();

  const [open, recent] = await Promise.all([
    db.shift.findMany({
      where: { status: "open" },
      include: { employee: { select: { name: true, hourlyRate: true } }, branch: { select: { name: true } } },
      orderBy: { clockIn: "asc" },
    }),
    db.shift.findMany({
      where: { status: "closed" },
      include: { employee: { select: { name: true, hourlyRate: true } } },
      orderBy: { clockIn: "desc" },
      take: 40,
    }),
  ]);

  /**
   * What each drawer came to.
   *
   * Batched, and for **every** row on the page. The first version looped over
   * `cashSummary` for the first twenty of forty shifts — eighty queries on a
   * page that renders per request, and rows twenty-one to forty printed "not
   * counted" over drawers that had been counted. Half the table quietly said
   * the opposite of the truth, three lines under a comment about not letting
   * that happen.
   */
  const drawers = await cashSummaries([...open.map((r) => r.id), ...recent.map((r) => r.id)]);

  const short = [...drawers.values()].filter((d) => d.variance !== null && d.variance !== 0).length;

  // Cash in and out that was not a sale. Shown rather than only folded into a
  // total: a fabricated "found under the till" and a real supplier payment look
  // identical in a net figure, and only one of them is worth asking about.
  const moves = await db.cashMovement.findMany({
    // Open shifts too. Restricting this to closed ones meant an owner could not
    // see today's payouts until tonight — which is the only time looking at
    // them could still change anything.
    where: { shiftId: { in: [...open.map((r) => r.id), ...recent.map((r) => r.id)] } },
    include: { employee: { select: { name: true } } },
    orderBy: { at: "desc" },
    take: 25,
  });

  const hours = (m: number | null) => (m === null ? null : Math.round((m / 60) * 10) / 10);
  const runningFor = (d: Date) => Math.round(((Date.now() - d.getTime()) / 3600_000) * 10) / 10;

  // A value `datetime-local` will accept, in the server's zone — which is the
  // restaurant's. Suggesting a time is not the same as assuming one: the field
  // is pre-filled so a manager can nudge it, and still has to be looked at.
  const localValue = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  const unpaid = recent.filter((r) => r.durationMin !== null && r.employee?.hourlyRate == null).length;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Shifts")}</h1>
          <p>
            {t(
              "Hours come from the till: signing in starts a shift, signing out ends it. They are the labour half of prime cost — without them that figure is only food.",
            )}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/admin/employees">
          {t("Staff")}
        </Link>
      </div>

      {sp.closed && (
        <div className="alert alert-ok">
          {t("Shift closed")} — {sp.closed} {t("hours")}.
        </div>
      )}

      {/* ── still running ── */}
      <div className="admin-panel">
        <h2>
          {t("On now")} <span className="hint">· {open.length}</span>
        </h2>

        {open.length === 0 && <p className="hint">{t("Nobody is clocked in.")}</p>}

        {open.map((s) => {
          const h = runningFor(s.clockIn);
          const stale = h > ABANDONED_AFTER_HOURS;
          return (
            <div key={s.id} className={`setup-step${stale ? " shift-stale" : ""}`}>
              <span className={`setup-mark ${stale ? "setup-mark-todo" : "setup-mark-done"}`}>
                {stale ? "!" : "•"}
              </span>
              <div className="setup-step-body">
                <b>{s.employee?.name ?? t("Someone")}</b>
                <span>
                  {t("Since")} {f.dateTime(s.clockIn)} · {h} {t("hours")}
                  {s.branch?.name ? ` · ${i18nText(s.branch.name)}` : ""}
                  {s.posId ? ` · ${s.posId}` : ""}
                </span>

                {stale ? (
                  <>
                    <span className="setup-missing">
                      {t(
                        "Running longer than a shift lasts — somebody left without signing out. Until it is closed with the real time, labour cost counts every one of those hours.",
                      )}
                    </span>
                    <AdminForm
                      className="admin-form"
                      action={closeShift}
                      submitLabel={t("Close this shift")}
                      pendingLabel={t("Closing…")}
                      style={{ marginTop: 8 }}
                    >
                      <input type="hidden" name="shiftId" value={s.id} />
                      <div className="field" style={{ maxWidth: 260 }}>
                        <label htmlFor={`out-${s.id}`}>{t("When did they actually finish?")}</label>
                        <input
                          id={`out-${s.id}`}
                          name="clockOut"
                          type="datetime-local"
                          defaultValue={localValue(s.clockIn)}
                          required
                        />
                        <span className="hint">
                          {t("Pre-filled with the start time — change it to when they left.")}
                        </span>
                      </div>
                    </AdminForm>
                  </>
                ) : (
                  <span className="hint">
                    {s.employee?.hourlyRate == null
                      ? t("No hourly rate on this person, so these hours cost nothing in the figures.")
                      : `${f.money(Number(s.employee.hourlyRate) * h)} ${t("so far")}`}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── cash that was not a sale ── */}
      {moves.length > 0 && (
        <div className="admin-panel">
          <h2>
            {t("Money in and out of the till")} <span className="hint">· {t("not sales")}</span>
          </h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {t(
              "Every one of these changes what a drawer was expected to hold. Most are a supplier paid in cash; the ones that are not are the reason this list is here rather than buried in a total.",
            )}
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("When")}</th>
                  <th>{t("Who")}</th>
                  <th>{t("What for")}</th>
                  <th style={{ textAlign: "right" }}>{t("Amount")}</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td>{f.dateTime(m.at)}</td>
                    <td>{m.employee?.name ?? "—"}</td>
                    <td>{m.reason}</td>
                    <td style={{ textAlign: "right", color: Number(m.amount) < 0 ? "#8a6a12" : undefined }}>
                      {f.moneySigned(Number(m.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── what has been recorded ── */}
      <div className="admin-panel">
        <h2>{t("Recent")}</h2>

        {recent.length === 0 && (
          <p className="hint">
            {t(
              "Nothing yet. The first shift appears the moment someone signs in to the till — and prime cost starts including labour the same day.",
            )}
          </p>
        )}

        {short > 0 && (
          <p className="setup-missing" style={{ marginTop: 0 }}>
            {short} {t("of these drawers did not balance. Hover a figure to see what was expected against what was counted — a difference is usually a payout nobody wrote down, and occasionally it is not.")}
          </p>
        )}

        {unpaid > 0 && (
          <p className="setup-missing" style={{ marginTop: 0 }}>
            {unpaid} {t("of these are for people with no hourly rate, so they add nothing to labour cost.")}{" "}
            <Link href="/admin/employees">{t("Set their rates")}</Link>
          </p>
        )}

        {recent.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Who")}</th>
                  <th>{t("Started")}</th>
                  <th>{t("Finished")}</th>
                  <th style={{ textAlign: "right" }}>{t("Hours")}</th>
                  <th style={{ textAlign: "right" }}>{t("Cost")}</th>
                  <th style={{ textAlign: "right" }}>{t("Drawer")}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((s) => {
                  const h = hours(s.durationMin);
                  const rate = s.employee?.hourlyRate == null ? null : Number(s.employee.hourlyRate);
                  return (
                    <tr key={s.id}>
                      <td>{s.employee?.name ?? "—"}</td>
                      <td>{f.dateTime(s.clockIn)}</td>
                      <td>
                        {s.clockOut ? f.dateTime(s.clockOut) : "—"}
                        {/* What the cashier said about a difference. Written
                            since this feature shipped and read by nothing,
                            which made it a question asked and then ignored. */}
                        {s.cashNote && (
                          <div className="hint" style={{ marginTop: 2 }}>
                            &ldquo;{s.cashNote}&rdquo;
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {h === null ? (
                          // Not "0". A shift closed without a duration is one
                          // nobody could account for, and printing a zero would
                          // read as "they worked no time" rather than "we do
                          // not know" — which is the difference between an
                          // honest gap and a wrong number.
                          <span className="hint" title={t("Nobody recorded when this ended")}>
                            {t("unknown")}
                          </span>
                        ) : (
                          h
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>{h !== null && rate !== null ? f.money(rate * h) : "—"}</td>
                      <td style={{ textAlign: "right" }}>
                        {(() => {
                          const d = drawers.get(s.id);
                          // Never a zero for "nobody counted". A drawer that was
                          // not counted has no difference, which is a different
                          // fact from a difference of nothing — and printing 0
                          // would claim the money was checked.
                          if (!d || d.variance === null) {
                            return <span className="hint">{t("not counted")}</span>;
                          }
                          if (d.variance === 0) return <span style={{ color: "var(--a-ok, #3f7d3f)" }}>✓</span>;
                          return (
                            <b
                              style={{ color: "#8a6a12" }}
                              title={
                                d.expected === null || d.closing === null
                                  ? undefined
                                  : `${t("Expected")} ${f.money(d.expected)} · ${t("counted")} ${f.money(d.closing)}`
                              }
                            >
                              {f.moneySigned(d.variance)}
                            </b>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
