"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission, getSession } from "@/lib/admin-auth";
import { recordMovements } from "@/lib/stock";
import { logAction } from "@/lib/audit";
import { notifyTransferRequest, notifyTransferSent } from "@/lib/telegram";
import { fdNum, fdStr } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { ActionError, failTo, formAction } from "@/lib/action-state";

/**
 * გადატანის ეტაპები.
 *
 * მოძრაობა მხოლოდ ორ წერტილში ხდება:
 *   გაგზავნა → წყაროს აკლდება (`transfer_out`)
 *   მიღება   → დანიშნულებას ემატება (`transfer_in`)
 *
 * შუალედური ეტაპები (მოთხოვნა, დამტკიცება) მარაგს არ ეხება — ისინი
 * შეთანხმებაა, არა მოძრაობა. ამიტომ დამტკიცებული, მაგრამ გაუგზავნელი
 * გადატანა ნაშთს არ ცვლის.
 */

const FLOW: Record<string, string[]> = {
  draft: ["requested", "cancelled"],
  requested: ["approved", "cancelled"],
  approved: ["sent", "cancelled"],
  sent: ["received", "cancelled"],
  received: [],
  cancelled: [],
};

/**
 * `button` says the caller is a button rather than a form. A form can show a
 * returned message above its fields; a button has nowhere to put one, so its
 * refusal travels in the URL instead of being redacted into "Application error".
 */
async function loadOrFail(id: string, button = false) {
  const tx = await tr();
  const t = await db.transfer.findUnique({ where: { id }, include: { lines: true } });
  if (!t) {
    if (button) failTo("/admin/stock/transfers", tx("Transfer not found"));
    throw new ActionError(tx("Transfer not found"));
  }
  return t;
}

async function guard(from: string, to: string, backTo?: string) {
  if (!FLOW[from]?.includes(to)) {
    const tx = await tr();
    const msg = `${tx("Status")} "${from}" → "${to}" ${tx("is not allowed")}`;
    if (backTo) failTo(backTo, msg);
    throw new ActionError(msg);
  }
}

// ─────────────────────────────────────────────
// შექმნა
// ─────────────────────────────────────────────

export const createTransfer = formAction(async (fd: FormData) => {
  const s = await requirePermission("can_transfer_branch");
  const tx = await tr();

  const fromLocationId = fdStr(fd, "fromLocationId");
  const toLocationId = fdStr(fd, "toLocationId");
  if (!fromLocationId || !toLocationId) throw new ActionError(tx("Pick both locations"));
  if (fromLocationId === toLocationId) throw new ActionError(tx("Source and destination cannot be the same"));

  // მხოლოდ შევსებული სტრიქონები
  const lines: { itemId: string; qty: number }[] = [];
  for (const [key, value] of fd.entries()) {
    if (!key.startsWith("qty_")) continue;
    const qty = Number(String(value).replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    lines.push({ itemId: key.slice(4), qty });
  }
  if (lines.length === 0) throw new ActionError(tx("Fill in at least one line"));

  const t = await db.transfer.create({
    data: {
      fromLocationId,
      toLocationId,
      status: "requested",
      note: fdStr(fd, "note") || null,
      requestedById: s.sub,
      requestedAt: new Date(),
      lines: { create: lines.map((l) => ({ itemId: l.itemId, qtyRequested: l.qty })) },
    },
  });

  await logAction({
    action: "transfer.requested",
    entityType: "Transfer",
    entityId: t.id,
    after: { no: t.no, lines: lines.length, from: fromLocationId, to: toLocationId },
    employeeId: s.sub,
  });

  const locs = await db.stockLocation.findMany({
    where: { id: { in: [fromLocationId, toLocationId] } },
    select: { id: true, name: true },
  });
  const nm = (id: string) => {
    const n = locs.find((l) => l.id === id)?.name as Record<string, unknown> | undefined;
    return String(n?.ka ?? n?.en ?? "");
  };

  void notifyTransferRequest({
    no: t.no,
    from: nm(fromLocationId),
    to: nm(toLocationId),
    lines: lines.length,
    by: s.name,
  });

  revalidatePath("/admin/stock/transfers");
  redirect(`/admin/stock/transfers/${t.id}`);
}, tr);

// ─────────────────────────────────────────────
// დამტკიცება — რაოდენობის შეცვლით
// ─────────────────────────────────────────────

export const approveTransfer = formAction(async (fd: FormData, id: string) => {
  const s = await requirePermission("can_transfer_branch");
  const tx = await tr();
  const t = await loadOrFail(id);
  await guard(t.status, "approved");

  const changes: Record<string, { requested: number; approved: number }> = {};

  for (const l of t.lines) {
    const q = fdNum(fd, `approve_${l.id}`);
    const approved = q === null ? Number(l.qtyRequested) : q;
    if (approved < 0) throw new ActionError(tx("Quantity cannot be negative"));

    await db.transferLine.update({ where: { id: l.id }, data: { qtyApproved: approved } });

    if (approved !== Number(l.qtyRequested)) {
      changes[l.itemId] = { requested: Number(l.qtyRequested), approved };
    }
  }

  await db.transfer.update({
    where: { id },
    data: { status: "approved", approvedById: s.sub, approvedAt: new Date() },
  });

  await logAction({
    action: "transfer.approved",
    entityType: "Transfer",
    entityId: id,
    after: { no: t.no, changed: changes },
    employeeId: s.sub,
  });

  revalidatePath("/admin/stock/transfers");
  redirect(`/admin/stock/transfers/${id}?ok=approved`);
}, tr);

// ─────────────────────────────────────────────
// გაგზავნა — წყაროს აკლდება
// ─────────────────────────────────────────────

export const sendTransfer = formAction(async (fd: FormData, id: string) => {
  const s = await requirePermission("can_transfer_branch");
  const tx = await tr();
  const t = await loadOrFail(id);
  await guard(t.status, "sent");

  const moves = [];
  const sent: Record<string, number> = {};

  for (const l of t.lines) {
    const fallback = l.qtyApproved != null ? Number(l.qtyApproved) : Number(l.qtyRequested);
    const q = fdNum(fd, `send_${l.id}`);
    const qty = q === null ? fallback : q;
    if (qty < 0) throw new ActionError(tx("Quantity cannot be negative"));

    await db.transferLine.update({ where: { id: l.id }, data: { qtySent: qty } });
    if (qty === 0) continue;

    sent[l.itemId] = qty;
    moves.push({
      locationId: t.fromLocationId,
      itemId: l.itemId,
      type: "transfer_out" as const,
      qty: -qty,
      refType: "Transfer",
      refId: id,
      note: `${tx("Transfer")} #${t.no} — ${tx("Send")}`,
      employeeId: s.sub,
    });
  }

  if (moves.length > 0) await recordMovements(moves);

  await db.transfer.update({
    where: { id },
    data: { status: "sent", sentById: s.sub, sentAt: new Date() },
  });

  await logAction({
    action: "transfer.sent",
    entityType: "Transfer",
    entityId: id,
    after: { no: t.no, sent },
    employeeId: s.sub,
  });

  const full = await db.transfer.findUnique({
    where: { id },
    select: { from: { select: { name: true } }, to: { select: { name: true } } },
  });
  const label = (n: unknown) => {
    const o = n as Record<string, unknown> | undefined;
    return String(o?.ka ?? o?.en ?? "");
  };

  void notifyTransferSent({
    no: t.no,
    from: label(full?.from.name),
    to: label(full?.to.name),
    by: s.name,
  });

  revalidatePath("/admin/stock");
  revalidatePath("/admin/stock/transfers");
  redirect(`/admin/stock/transfers/${id}?ok=sent`);
}, tr);

// ─────────────────────────────────────────────
// მიღება — დანიშნულებას ემატება
// ─────────────────────────────────────────────

export const receiveTransfer = formAction(async (fd: FormData, id: string) => {
  const s = await requirePermission("can_transfer_branch");
  const tx = await tr();
  const t = await loadOrFail(id);
  await guard(t.status, "received");

  const moves = [];
  const received: Record<string, number> = {};
  const gaps: Record<string, { sent: number; received: number }> = {};

  for (const l of t.lines) {
    const sentQty = l.qtySent != null ? Number(l.qtySent) : 0;
    const q = fdNum(fd, `receive_${l.id}`);
    const qty = q === null ? sentQty : q;
    if (qty < 0) throw new ActionError(tx("Quantity cannot be negative"));

    await db.transferLine.update({ where: { id: l.id }, data: { qtyReceived: qty } });
    if (qty !== sentQty) gaps[l.itemId] = { sent: sentQty, received: qty };
    if (qty === 0) continue;

    received[l.itemId] = qty;
    moves.push({
      locationId: t.toLocationId,
      itemId: l.itemId,
      type: "transfer_in" as const,
      qty,
      refType: "Transfer",
      refId: id,
      note: `${tx("Transfer")} #${t.no} — ${tx("Receive")}`,
      employeeId: s.sub,
    });
  }

  if (moves.length > 0) await recordMovements(moves);

  await db.transfer.update({
    where: { id },
    data: { status: "received", receivedById: s.sub, receivedAt: new Date() },
  });

  await logAction({
    action: "transfer.received",
    entityType: "Transfer",
    entityId: id,
    after: { no: t.no, received, ...(Object.keys(gaps).length ? { gap: gaps } : {}) },
    employeeId: s.sub,
  });

  revalidatePath("/admin/stock");
  revalidatePath("/admin/stock/transfers");
  redirect(`/admin/stock/transfers/${id}?ok=received`);
}, tr);

// ─────────────────────────────────────────────
// გაუქმება
// ─────────────────────────────────────────────

export async function cancelTransfer(id: string) {
  const s = await requirePermission("can_transfer_branch");
  const tx = await tr();
  const session = await getSession();
  const t = await loadOrFail(id, true);
  await guard(t.status, "cancelled", `/admin/stock/transfers/${id}`);

  // თუ უკვე გაგზავნილი იყო, საქონელი წყაროს უბრუნდება
  if (t.status === "sent") {
    const moves = t.lines
      .filter((l) => l.qtySent != null && Number(l.qtySent) > 0)
      .map((l) => ({
        locationId: t.fromLocationId,
        itemId: l.itemId,
        type: "transfer_in" as const,
        qty: Number(l.qtySent),
        refType: "Transfer",
        refId: id,
        note: `${tx("Transfer")} #${t.no} — ${tx("cancelled, returned")}`,
        employeeId: session?.sub ?? null,
      }));
    if (moves.length > 0) await recordMovements(moves);
  }

  await db.transfer.update({
    where: { id },
    data: { status: "cancelled", cancelledById: s.sub, cancelledAt: new Date() },
  });

  await logAction({
    action: "transfer.cancelled",
    entityType: "Transfer",
    entityId: id,
    before: { status: t.status },
    after: { no: t.no, returned: t.status === "sent" },
    employeeId: s.sub,
  });

  revalidatePath("/admin/stock");
  revalidatePath("/admin/stock/transfers");
  redirect(`/admin/stock/transfers/${id}?ok=cancelled`);
}
