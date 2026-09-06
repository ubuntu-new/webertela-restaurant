"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { logAction } from "@/lib/audit";
import { ActionError, failTo, formAction } from "@/lib/action-state";
import { enqueue } from "@/lib/print";
import type { PrintDoc } from "@/lib/print-doc";

/**
 * Configuring the two printers, and proving one works.
 *
 * The host is optional on purpose. A branch can be set up, print jobs can queue
 * and be read on screen, and the hardware can arrive a week later — the row is
 * what the queue attaches to, not the cable.
 */

const ROLES = ["till", "kitchen"] as const;
type Role = (typeof ROLES)[number];

function readRole(fd: FormData): Role {
  const raw = String(fd.get("role") ?? "");
  const role = ROLES.find((r) => r === raw);
  if (!role) throw new ActionError("Choose whether this is the till or the kitchen printer", "role");
  return role;
}

/**
 * An IP address or hostname, or nothing at all.
 *
 * Validated rather than trusted because a typo here fails silently and late:
 * jobs queue, nothing prints, and the only symptom is a cook standing at an
 * empty printer. Better to refuse "192.168.1" now than to explain it at
 * dinner service.
 */
function readHost(fd: FormData): string | null {
  const raw = String(fd.get("host") ?? "").trim();
  if (!raw) return null;
  if (raw.length > 120) throw new ActionError("That address is too long to be real", "host");
  if (/\s/.test(raw)) throw new ActionError("An address cannot contain spaces", "host");
  // Either four numbers with dots, or something that looks like a hostname.
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4.test(raw)) {
    const parts = raw.split(".").map(Number);
    if (parts.some((n) => n > 255)) {
      throw new ActionError("That is not a valid IP address — each part is 0 to 255", "host");
    }
    return raw;
  }
  if (!/^[a-zA-Z0-9.-]+$/.test(raw)) {
    throw new ActionError("Use an IP address like 192.168.1.50, or a hostname", "host");
  }
  return raw;
}

export const savePrinter = formAction(async (fd: FormData) => {
  const id = String(fd.get("id") ?? "").trim();
  const branchId = String(fd.get("branchId") ?? "").trim();
  if (!branchId) throw new ActionError("Which branch is this printer in?", "branchId");

  const branch = await db.branch.findUnique({
    where: { id: branchId },
    select: { id: true, orgId: true },
  });
  if (!branch) throw new ActionError("That branch no longer exists", "branchId");

  const role = readRole(fd);
  const name = String(fd.get("name") ?? "").trim() || (role === "till" ? "Till" : "Kitchen");
  const host = readHost(fd);

  const portRaw = Number(fd.get("port") ?? 9100);
  const port = Number.isFinite(portRaw) && portRaw > 0 && portRaw < 65536 ? Math.round(portRaw) : 9100;

  const columnsRaw = Number(fd.get("columns") ?? 48);
  // 48 is 80mm paper, 32 is 58mm. Anything else is a typo, and a wrong column
  // count does not fail — it silently prints a receipt with the totals cut off.
  const columns = columnsRaw === 32 ? 32 : 48;

  // Only the till has a drawer hanging off it. Offering the option on the
  // kitchen printer would let someone tick a box that can never do anything.
  const hasDrawer = role === "till" && String(fd.get("hasDrawer") ?? "") === "on";

  const data = { orgId: branch.orgId, branchId, role, name, host, port, columns, hasDrawer };

  if (id) {
    await db.printer.update({ where: { id }, data });
  } else {
    await db.printer.create({ data });
  }

  await logAction({
    action: id ? "printer.update" : "printer.create",
    entityType: "Printer",
    entityId: id || undefined,
    branchId,
    after: data,
  });

  redirect("/admin/printers?saved=1");
});

export async function removePrinter(id: string): Promise<void> {
  const printer = await db.printer.findUnique({
    where: { id },
    select: { id: true, branchId: true, name: true },
  });
  if (!printer) failTo("/admin/printers", "That printer is already gone.");

  // Jobs survive: `PrintJob.printerId` is ON DELETE SET NULL, so the record of
  // what was printed outlives the machine that printed it.
  await db.printer.delete({ where: { id } });

  await logAction({
    action: "printer.delete",
    entityType: "Printer",
    entityId: id,
    branchId: printer.branchId,
    before: { name: printer.name },
  });

  redirect("/admin/printers?removed=1");
}

/**
 * A page of paper that proves the whole chain.
 *
 * Deliberately prints the printer's own name and address. "It printed" is not
 * the useful answer — "the ticket that came out of the kitchen printer says
 * kitchen" is, because the commonest installation mistake is two printers with
 * their addresses the wrong way round, and that mistake is invisible until a
 * customer gets a kitchen ticket instead of a receipt.
 */
export async function testPrint(id: string): Promise<void> {
  const printer = await db.printer.findUnique({ where: { id } });
  if (!printer) failTo("/admin/printers", "That printer is already gone.");

  const doc: PrintDoc = {
    columns: printer.columns,
    title: `Test — ${printer.name}`,
    lines: [
      { t: "text", v: "TEST PAGE", align: "c", bold: true, big: true },
      { t: "feed" },
      { t: "row", left: "Printer", right: printer.name },
      { t: "row", left: "Role", right: printer.role },
      { t: "row", left: "Address", right: printer.host ?? "not set" },
      { t: "row", left: "Width", right: `${printer.columns} cols` },
      { t: "feed" },
      { t: "rule" },
      // A full-width ruler: if the paper is narrower than the configuration
      // claims, the right-hand end is missing and the mistake is visible on the
      // page rather than discovered on a receipt with the total cut off.
      { t: "text", v: "1234567890".repeat(Math.ceil(printer.columns / 10)).slice(0, printer.columns) },
      { t: "rule" },
      { t: "feed" },
      { t: "text", v: new Date().toLocaleString("en-GB"), align: "c" },
      ...(printer.hasDrawer ? [{ t: "kick" } as const] : []),
      { t: "cut" },
    ],
  };

  await enqueue({
    orgId: printer.orgId,
    branchId: printer.branchId,
    kind: "test",
    role: printer.role,
    doc,
  });

  redirect("/admin/printers?queued=1");
}

/** Put a failed job back in the queue. */
export async function retryJob(id: string): Promise<void> {
  const job = await db.printJob.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!job) failTo("/admin/printers", "That job is already gone.");

  // `attempts` is deliberately not reset: how many times a job has been tried
  // is the number that tells you a printer is broken rather than unlucky.
  await db.printJob.update({
    where: { id },
    data: { status: "pending", error: null, claimedAt: null, doneAt: null },
  });

  redirect("/admin/printers?queued=1");
}
