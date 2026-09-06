import "server-only";
import { db } from "@/lib/db";
import { i18nText, money, num } from "@/lib/admin-utils";
import type { PrintDoc, PrintLine } from "@/lib/print-doc";

/**
 * Two printers in a branch, and the queue between them and the server.
 *
 * ── Why a queue and not a socket ──
 *
 * The server is in a datacentre; the printer is behind a router in a restaurant
 * in Orange County. There is no route from one to the other, and there never
 * will be without asking a restaurant owner to forward a port — which is a
 * conversation nobody should have to have to print a receipt.
 *
 * So nothing here talks to hardware. Jobs are written to a table, and whatever
 * is standing next to the printer comes and asks for them. That inverts the
 * direction of the connection, which is the whole trick: the restaurant reaches
 * out, and the datacentre never has to reach in.
 *
 * It also means the feature is finished and demonstrable before any printer is
 * bought. The queue fills, the preview renders, and the day the hardware
 * arrives it starts draining.
 *
 * ── Why the till and the kitchen are not the same thing ──
 *
 * They print at different moments, in different shapes, for different people. A
 * receipt is a record for the customer, printed once the money is settled. A
 * kitchen ticket is an instruction for a cook, printed the second the order
 * exists and useless a minute later. Sharing a template between them would have
 * produced something that serves neither.
 */

const RECEIPT_COLUMNS = 48;

export interface PrintableItem {
  name: unknown; // i18n Json snapshot
  qty: number;
  unitPrice: unknown;
  lineTotal: unknown;
  config?: unknown;
}

export interface PrintableOrder {
  orderNo: number;
  createdAt: Date;
  items: PrintableItem[];

  subtotal: unknown;
  discountTotal: unknown;
  deliveryFee: unknown;
  tax: unknown;
  tip: unknown;
  total: unknown;

  paymentMethod: string;
  paidAmount?: unknown;
  changeGiven?: unknown;

  fulfillmentType: string;
  tableNo?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  notes?: string | null;

  branchName: string;
  orgName?: string | null;
  branchPhone?: string | null;
  branchAddress?: string | null;
}

/* ------------------------------------------------------------------ */
/* Options a customer chose, flattened for one line of paper           */
/* ------------------------------------------------------------------ */

/**
 * `config` holds sizes, toppings, half-and-half — whatever the product allows.
 * Its shape varies by product, so this reads what it can and stays quiet about
 * the rest rather than printing raw JSON at somebody at six in the morning.
 */
function configLines(config: unknown): string[] {
  if (!config || typeof config !== "object") return [];
  const c = config as Record<string, unknown>;
  const out: string[] = [];

  if (typeof c.size === "string" && c.size) out.push(String(c.size));

  const toppings = c.toppings;
  if (Array.isArray(toppings) && toppings.length) {
    const names = toppings
      .map((t) => (typeof t === "string" ? t : i18nText((t as { name?: unknown })?.name)))
      .filter(Boolean);
    if (names.length) out.push(`+ ${names.join(", ")}`);
  }

  if (typeof c.note === "string" && c.note.trim()) out.push(`! ${c.note.trim()}`);

  return out;
}

/* ------------------------------------------------------------------ */
/* The customer's copy                                                 */
/* ------------------------------------------------------------------ */

export function receiptDoc(order: PrintableOrder, columns = RECEIPT_COLUMNS): PrintDoc {
  const lines: PrintLine[] = [];
  const at = order.createdAt;

  lines.push({ t: "text", v: order.orgName || order.branchName, align: "c", bold: true, big: true });
  if (order.orgName) lines.push({ t: "text", v: order.branchName, align: "c" });
  if (order.branchAddress) lines.push({ t: "text", v: order.branchAddress, align: "c" });
  if (order.branchPhone) lines.push({ t: "text", v: order.branchPhone, align: "c" });

  lines.push({ t: "feed" });
  lines.push({ t: "row", left: `#${order.orderNo}`, right: at.toLocaleString("en-GB") });
  if (order.tableNo) lines.push({ t: "row", left: "Table", right: order.tableNo });
  if (order.customerName) lines.push({ t: "row", left: "Customer", right: order.customerName });
  lines.push({ t: "rule" });

  for (const item of order.items) {
    lines.push({
      t: "row",
      left: `${item.qty} x ${i18nText(item.name)}`,
      right: money(item.lineTotal),
    });
    // Indented so a cook or a customer can see at a glance which line the
    // options belong to.
    for (const extra of configLines(item.config)) {
      lines.push({ t: "text", v: `   ${extra}` });
    }
  }

  lines.push({ t: "rule" });
  lines.push({ t: "row", left: "Subtotal", right: money(order.subtotal) });
  if (num(order.discountTotal) > 0)
    lines.push({ t: "row", left: "Discount", right: `-${money(order.discountTotal)}` });
  if (num(order.deliveryFee) > 0)
    lines.push({ t: "row", left: "Delivery", right: money(order.deliveryFee) });
  if (num(order.tax) > 0) lines.push({ t: "row", left: "Tax", right: money(order.tax) });
  if (num(order.tip) > 0) lines.push({ t: "row", left: "Tip", right: money(order.tip) });

  lines.push({ t: "feed" });
  lines.push({ t: "row", left: "TOTAL", right: money(order.total), bold: true, big: true });
  lines.push({ t: "feed" });

  lines.push({ t: "row", left: "Paid by", right: order.paymentMethod });
  // Only when it was actually recorded. Printing "Change 0.00" on a card sale
  // states a fact about a drawer that was never opened.
  if (order.paidAmount !== null && order.paidAmount !== undefined) {
    lines.push({ t: "row", left: "Cash", right: money(order.paidAmount) });
    if (order.changeGiven !== null && order.changeGiven !== undefined) {
      lines.push({ t: "row", left: "Change", right: money(order.changeGiven) });
    }
  }

  lines.push({ t: "feed" });
  lines.push({ t: "text", v: "Thank you", align: "c" });
  lines.push({ t: "cut" });

  return { columns, title: `Receipt #${order.orderNo}`, lines };
}

/* ------------------------------------------------------------------ */
/* The cook's copy                                                     */
/* ------------------------------------------------------------------ */

/**
 * Big, short, and priceless — literally.
 *
 * No money on a kitchen ticket. A cook does not need it, it lengthens the
 * ticket, and on a busy Friday every line that is not an instruction is a line
 * between them and the one that is.
 */
export function kitchenDoc(order: PrintableOrder, columns = RECEIPT_COLUMNS): PrintDoc {
  const lines: PrintLine[] = [];

  lines.push({ t: "text", v: `#${order.orderNo}`, align: "c", bold: true, big: true });

  const where =
    order.fulfillmentType === "delivery"
      ? "DELIVERY"
      : order.tableNo
      ? `TABLE ${order.tableNo}`
      : order.fulfillmentType.toUpperCase();
  lines.push({ t: "text", v: where, align: "c", bold: true });
  lines.push({ t: "text", v: order.createdAt.toLocaleTimeString("en-GB"), align: "c" });
  lines.push({ t: "rule", ch: "=" });

  for (const item of order.items) {
    // Double height: this is read at arm's length, over a hot pass, by someone
    // holding a pan.
    lines.push({ t: "text", v: `${item.qty} x ${i18nText(item.name)}`, bold: true, big: true });
    for (const extra of configLines(item.config)) {
      lines.push({ t: "text", v: `  ${extra}` });
    }
    lines.push({ t: "feed" });
  }

  if (order.notes) {
    lines.push({ t: "rule", ch: "=" });
    lines.push({ t: "text", v: order.notes, bold: true });
  }

  lines.push({ t: "cut" });

  return { columns, title: `Kitchen #${order.orderNo}`, lines };
}

/* ------------------------------------------------------------------ */
/* The queue                                                           */
/* ------------------------------------------------------------------ */

/**
 * Adds a job. Never throws into the caller.
 *
 * ⚠️ Printing must not be able to fail a sale. A jammed printer, an unplugged
 * one, a branch with none configured at all — none of those are reasons to
 * refuse a customer's order, and a till that rejects a sale because the paper
 * ran out is worse than one that never printed. So every failure here is logged
 * and swallowed, and the order stands.
 */
export async function enqueue(input: {
  orgId: string;
  branchId: string;
  kind: "receipt" | "kitchen" | "drawer" | "test";
  doc: PrintDoc;
  orderId?: string | null;
  role: "till" | "kitchen";
  requestedBy?: string | null;
  reprintOf?: string | null;
  copies?: number;
}): Promise<{ ok: boolean; id?: string; reason?: string }> {
  try {
    const printer = await db.printer.findFirst({
      where: { branchId: input.branchId, role: input.role, active: true },
      orderBy: { createdAt: "asc" },
    });

    const job = await db.printJob.create({
      data: {
        orgId: input.orgId,
        branchId: input.branchId,
        // A job with no printer is still a job. It queues, it previews, and it
        // prints the moment one is configured — which is what makes the demo
        // work before any hardware exists.
        printerId: printer?.id ?? null,
        orderId: input.orderId ?? null,
        kind: input.kind,
        doc: input.doc as unknown as object,
        copies: input.copies ?? 1,
        requestedBy: input.requestedBy ?? null,
        reprintOf: input.reprintOf ?? null,
      },
      select: { id: true },
    });

    return { ok: true, id: job.id };
  } catch (err) {
    console.error("[print] could not queue a job", err);
    return { ok: false, reason: "queue failed" };
  }
}

/** Everything needed to print an order, read once and snapshotted. */
export async function printableOrder(orderId: string): Promise<PrintableOrder | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      branch: { select: { name: true, phone: true, address: true } },
      org: { select: { name: true } },
    },
  });
  if (!order) return null;

  const address = order.branch?.address;
  const addressLine =
    address && typeof address === "object"
      ? [
          (address as Record<string, unknown>).street,
          (address as Record<string, unknown>).city,
        ]
          .filter(Boolean)
          .join(", ")
      : null;

  return {
    orderNo: order.orderNo,
    createdAt: order.createdAt,
    items: order.items.map((i) => ({
      name: i.name,
      qty: i.qty,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
      config: i.config,
    })),
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    deliveryFee: order.deliveryFee,
    tax: order.tax,
    tip: order.tip,
    total: order.total,
    paymentMethod: order.paymentMethod,
    paidAmount: order.paidAmount,
    changeGiven: order.changeGiven,
    fulfillmentType: order.fulfillmentType,
    tableNo: order.tableNo,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    notes: order.notes,
    branchName: i18nText(order.branch?.name) || "",
    orgName: order.org?.name ? i18nText(order.org.name) : null,
    branchPhone: order.branch?.phone ?? null,
    branchAddress: addressLine,
  };
}

/**
 * The kitchen ticket, the moment the order exists.
 *
 * Deliberately not the receipt. The cook needs the ticket now; the customer's
 * receipt can wait for the money to settle, and printing it at the same moment
 * would put a piece of paper on the counter for an order nobody has paid for.
 */
export async function queueKitchenTicket(
  orderId: string,
  opts?: { requestedBy?: string | null }
): Promise<void> {
  const order = await printableOrder(orderId);
  if (!order) return;

  const printer = await db.order.findUnique({
    where: { id: orderId },
    select: { orgId: true, branchId: true },
  });
  if (!printer) return;

  await enqueue({
    orgId: printer.orgId,
    branchId: printer.branchId,
    kind: "kitchen",
    role: "kitchen",
    orderId,
    doc: kitchenDoc(order),
    requestedBy: opts?.requestedBy ?? null,
  });
}

/** The customer's receipt, on request or once payment is settled. */
export async function queueReceipt(
  orderId: string,
  opts?: { requestedBy?: string | null; reprintOf?: string | null; openDrawer?: boolean }
): Promise<{ ok: boolean; id?: string }> {
  const order = await printableOrder(orderId);
  if (!order) return { ok: false };

  const ids = await db.order.findUnique({
    where: { id: orderId },
    select: { orgId: true, branchId: true },
  });
  if (!ids) return { ok: false };

  const doc = receiptDoc(order);
  // The drawer opens with the receipt on a cash sale, because that is the
  // moment a hand needs to be in it. The pulse rides along with the paper
  // rather than being a second job that could arrive out of order.
  if (opts?.openDrawer) doc.lines.unshift({ t: "kick" });

  const res = await enqueue({
    orgId: ids.orgId,
    branchId: ids.branchId,
    kind: "receipt",
    role: "till",
    orderId,
    doc,
    requestedBy: opts?.requestedBy ?? null,
    reprintOf: opts?.reprintOf ?? null,
  });

  return { ok: res.ok, id: res.id };
}

/** Open the drawer and print nothing — a no-sale, or making change. */
export async function queueDrawerKick(input: {
  orgId: string;
  branchId: string;
  requestedBy?: string | null;
}): Promise<{ ok: boolean }> {
  const res = await enqueue({
    orgId: input.orgId,
    branchId: input.branchId,
    kind: "drawer",
    role: "till",
    doc: { columns: RECEIPT_COLUMNS, title: "Open drawer", lines: [{ t: "kick" }] },
    requestedBy: input.requestedBy ?? null,
  });
  return { ok: res.ok };
}
