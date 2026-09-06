import { db } from "@/lib/db";
import { tr } from "@/lib/admin-i18n";
import { fmt } from "@/lib/format";
import { i18nText } from "@/lib/admin-utils";
import { docToText, type PrintDoc } from "@/lib/print-doc";
import AdminForm from "../_components/AdminForm";
import { removePrinter, retryJob, savePrinter, testPrint } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Two printers in a branch, and everything that has been sent to them.
 *
 * ── Why the preview is the point of this screen ──
 *
 * A restaurant that has not bought a printer yet can open this page, ring up an
 * order on the till, and read the receipt and the kitchen ticket exactly as they
 * would come out — same width, same wrapping, same line breaks. Not a mock-up:
 * the same stored document the printer will be handed, laid out at the same
 * column count.
 *
 * That matters twice over. It is how the feature gets finished and demonstrated
 * before any hardware exists, and it is how a template mistake — a total that
 * wraps, a name that truncates at the wrong place — gets found on a screen
 * instead of on a busy Friday.
 */

const ROLE_LABEL: Record<string, string> = { till: "Till", kitchen: "Kitchen" };

const STATUS_STYLE: Record<string, string> = {
  pending: "setup-mark-todo",
  claimed: "setup-mark-todo",
  done: "setup-mark-done",
  failed: "setup-mark-todo",
};

export default async function PrintersPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; removed?: string; queued?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();
  const f = await fmt();

  const [branches, jobs] = await Promise.all([
    db.branch.findMany({
      where: { deletedAt: null, active: true },
      orderBy: { sortOrder: "asc" },
      include: { printers: { orderBy: { role: "asc" } } },
    }),
    db.printJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      include: {
        printer: { select: { name: true, role: true } },
        order: { select: { orderNo: true } },
      },
    }),
  ]);

  // A branch with no printer at all is the state every branch starts in, and it
  // is worth naming rather than leaving as an empty space someone has to
  // interpret.
  const unconfigured = branches.filter((b) => b.printers.length === 0).length;
  const waiting = jobs.filter((j) => j.status === "pending").length;
  const failed = jobs.filter((j) => j.status === "failed").length;

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Printers")}</h1>
          <p>
            {t(
              "Two per branch: the till prints the customer's receipt and opens the drawer, the kitchen prints the ticket the cooks work from. Jobs queue here whether or not a printer exists yet — so you can see exactly what would come out before you buy one.",
            )}
          </p>
        </div>
      </div>

      {sp.saved && <div className="alert alert-ok">{t("Printer saved.")}</div>}
      {sp.removed && <div className="alert alert-ok">{t("Printer removed. Its past jobs were kept.")}</div>}
      {sp.queued && <div className="alert alert-ok">{t("Queued.")}</div>}
      {sp.error && <div className="alert alert-error">{sp.error}</div>}

      {/* ── the machines ── */}
      {branches.map((branch) => {
        const till = branch.printers.find((p) => p.role === "till");
        const kitchen = branch.printers.find((p) => p.role === "kitchen");

        return (
          <div className="admin-panel" key={branch.id}>
            <h2>{i18nText(branch.name)}</h2>

            {branch.printers.length === 0 && (
              <p className="setup-missing" style={{ marginTop: 0 }}>
                {t(
                  "No printers here yet. Orders still work and their tickets still queue — they simply wait. Add the two below when the hardware arrives.",
                )}
              </p>
            )}

            <div className="grid-2">
              {(["till", "kitchen"] as const).map((role) => {
                const printer = role === "till" ? till : kitchen;
                return (
                  <AdminForm
                    key={role}
                    action={savePrinter}
                    className="admin-form"
                    submitLabel={printer ? t("Save") : t("Add this printer")}
                    pendingLabel={t("Saving…")}
                  >
                    <input type="hidden" name="branchId" value={branch.id} />
                    <input type="hidden" name="role" value={role} />
                    {printer && <input type="hidden" name="id" value={printer.id} />}

                    <h3>
                      {t(ROLE_LABEL[role])}
                      {!printer && <span className="hint"> · {t("not set up")}</span>}
                    </h3>

                    <div className="field">
                      <label htmlFor={`name-${branch.id}-${role}`}>{t("Name")}</label>
                      <input
                        id={`name-${branch.id}-${role}`}
                        name="name"
                        defaultValue={printer?.name ?? ROLE_LABEL[role]}
                        maxLength={60}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor={`host-${branch.id}-${role}`}>{t("Address on the local network")}</label>
                      <input
                        id={`host-${branch.id}-${role}`}
                        name="host"
                        defaultValue={printer?.host ?? ""}
                        placeholder="192.168.1.50"
                        inputMode="decimal"
                      />
                      <span className="hint">
                        {t(
                          "Leave empty until the printer is installed. The queue works without it — nothing is lost, jobs simply wait.",
                        )}
                      </span>
                    </div>

                    <div className="field" style={{ maxWidth: 160 }}>
                      <label htmlFor={`port-${branch.id}-${role}`}>{t("Port")}</label>
                      <input
                        id={`port-${branch.id}-${role}`}
                        name="port"
                        type="number"
                        defaultValue={printer?.port ?? 9100}
                        className="num"
                      />
                      <span className="hint">{t("9100 on almost every thermal printer.")}</span>
                    </div>

                    <div className="field">
                      <label htmlFor={`cols-${branch.id}-${role}`}>{t("Paper")}</label>
                      <select
                        id={`cols-${branch.id}-${role}`}
                        name="columns"
                        defaultValue={String(printer?.columns ?? 48)}
                      >
                        <option value="48">{t("80mm — 48 characters (standard)")}</option>
                        <option value="32">{t("58mm — 32 characters")}</option>
                      </select>
                    </div>

                    {role === "till" && (
                      <label className="check">
                        <input
                          type="checkbox"
                          name="hasDrawer"
                          defaultChecked={printer?.hasDrawer ?? true}
                        />
                        <span>
                          {t("The cash drawer is plugged into this printer")}
                          <span className="hint">
                            {" "}
                            {t("— that cable is the only thing that can open it")}
                          </span>
                        </span>
                      </label>
                    )}
                  </AdminForm>
                );
              })}
            </div>

            {branch.printers.length > 0 && (
              <div className="row-actions" style={{ marginTop: 12 }}>
                {branch.printers.map((p) => (
                  <form key={p.id} action={testPrint.bind(null, p.id)} style={{ display: "inline" }}>
                    <button className="btn btn-ghost" type="submit">
                      {t("Test")} · {p.name}
                    </button>
                  </form>
                ))}
                {branch.printers.map((p) => (
                  <form key={`rm-${p.id}`} action={removePrinter.bind(null, p.id)} style={{ display: "inline" }}>
                    <button className="btn btn-ghost" type="submit">
                      {t("Remove")} · {p.name}
                    </button>
                  </form>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* ── what has been sent ── */}
      <div className="admin-panel">
        <h2>
          {t("Recent jobs")}{" "}
          <span className="hint">
            · {waiting} {t("waiting")}
            {failed > 0 ? ` · ${failed} ${t("failed")}` : ""}
          </span>
        </h2>

        {unconfigured > 0 && (
          <p className="hint" style={{ marginTop: 0 }}>
            {unconfigured} {t("branch(es) have no printer yet, so their jobs sit here unprinted. Open one anyway — the preview is the real thing, at the real width.")}
          </p>
        )}

        {jobs.length === 0 && (
          <p className="hint">
            {t("Nothing yet. Ring up an order on the till and two jobs appear here — the kitchen ticket and the receipt.")}
          </p>
        )}

        {jobs.map((job) => {
          const doc = job.doc as unknown as PrintDoc;
          return (
            <details key={job.id} className="setup-step">
              <summary className="setup-step-body" style={{ cursor: "pointer" }}>
                <span className={`setup-mark ${STATUS_STYLE[job.status] ?? ""}`}>
                  {job.status === "done" ? "✓" : job.status === "failed" ? "!" : "•"}
                </span>
                <b>
                  {doc?.title ?? job.kind}
                  {job.order ? ` · #${job.order.orderNo}` : ""}
                </b>
                <span>
                  {f.dateTime(job.createdAt)} · {job.printer?.name ?? t("no printer assigned")}
                  {job.reprintOf ? ` · ${t("reprint")}` : ""}
                  {job.attempts > 0 ? ` · ${job.attempts} ${t("attempts")}` : ""}
                </span>
                {job.error && <span className="setup-missing">{job.error}</span>}
              </summary>

              {/*
                The paper, at the paper's width. `white-space: pre` and a
                monospace face are not decoration here — they are what makes
                this an accurate preview rather than an approximation.
              */}
              <pre className="receipt-preview">{doc ? docToText(doc) : ""}</pre>

              {job.status === "failed" && (
                <form action={retryJob.bind(null, job.id)}>
                  <button className="btn btn-ghost" type="submit">
                    {t("Send it again")}
                  </button>
                </form>
              )}
            </details>
          );
        })}
      </div>
    </>
  );
}
