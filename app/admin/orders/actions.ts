"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission, getSession } from "@/lib/admin-auth";
import { recordMovements } from "@/lib/stock";
import { redirect } from "next/navigation";
import { getMenu } from "@/lib/menu-db";
import { priceOrder, type CartLineIn } from "@/lib/order-pricing";
import { computeConsumption, locationForBranch } from "@/lib/consumption";
import { applyOutgoingCost } from "@/lib/costing";
import { logAction } from "@/lib/audit";
import { tr } from "@/lib/admin-i18n";
import { ActionError, failTo, formAction } from "@/lib/action-state";

const FLOW = ["new", "confirmed", "preparing", "ready", "delivering", "completed", "cancelled"] as const;
type Status = (typeof FLOW)[number];

export async function setOrderStatus(id: string, status: string) {
  // გაუქმება ცალკე უფლებაა — შემთხვევით დაჭერა ძვირი ჯდება
  const perm = status === "cancelled" ? "can_void" : "can_view_reports";
  await requirePermission(perm);
  const session = await getSession();
  const t = await tr();

  // A button, not a form — there is no state to return to, so the refusal
  // travels in the URL and the order page shows it.
  //
  // Every call is `return fail(...)`, and the return is the point. TypeScript
  // will treat a bare call as terminating control flow, but only when the callee
  // is a function declaration or a variable whose *declared type* ends in never
  // — annotating the arrow's return type is not enough, which cost two builds
  // to find out. A return statement needs no such rule: flow stops because the
  // function is over.
  const fail = (msg: string): never => failTo(`/admin/orders/${id}`, msg);

  if (!(FLOW as readonly string[]).includes(status)) return fail(t("Unknown status"));

  const order = await db.order.findUnique({ where: { id }, select: { statusHistory: true, status: true } });
  if (!order) return fail(t("Order not found"));
  if (order.status === "completed" || order.status === "cancelled") {
    return fail(t("A finished or cancelled order cannot change status"));
  }

  const history = Array.isArray(order.statusHistory) ? (order.statusHistory as unknown[]) : [];

  await db.order.update({
    where: { id },
    data: {
      status: status as Status,
      statusHistory: [
        ...history,
        { status, at: new Date().toISOString(), by: session?.name ?? session?.sub ?? "admin" },
      ] as object,
      ...(status === "completed" ? { deliveredAt: new Date() } : {}),
    },
  });

  // გაუქმებისას ჩამოწერილი მარაგი ბრუნდება — უკუ-მოძრაობით, არა წაშლით
  if (status === "cancelled") {
    const moves = await db.stockMovement.findMany({
      where: { refType: "Order", refId: id, type: "sale" },
      select: { locationId: true, itemId: true, qty: true },
    });
    if (moves.length > 0) {
      await recordMovements(
        moves.map((m) => ({
          locationId: m.locationId,
          itemId: m.itemId,
          type: "count_adjust" as const,
          qty: Number(m.qty) * -1,
          refType: "Order",
          refId: id,
          note: t("Order cancelled — stock returned"),
          employeeId: session?.sub ?? null,
        })),
      );
    }
  }

  await db.auditLog.create({
    data: {
      action: `order.${status}`,
      entityType: "Order",
      entityId: id,
      employeeId: session?.sub,
    },
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
}

/**
 * ხელით შეკვეთა — ტელეფონით ან ადგილზე.
 *
 * ფასს **სერვერი** ითვლის იმავე ფუნქციით, რასაც საიტი (`priceOrder`).
 * ხელით შეყვანილი ჯამის ველი განზრახ არ არსებობს: ორი გზა ერთსა და იმავე
 * პროდუქტს ერთსა და იმავე ფასად უნდა ყიდდეს, თორემ ჩეკები და რეპორტები
 * ერთმანეთს დაშორდება.
 */
export const createManualOrder = formAction(async (fd: FormData) => {
  const session = await getSession();
  if (!session) throw new ActionError("Not signed in");

  const branchId = String(fd.get("branchId") ?? "");
  const fulfillment = fd.get("fulfillment") === "pickup" ? "pickup" : "delivery";
  const customerName = String(fd.get("customerName") ?? "").trim();
  const customerPhone = String(fd.get("customerPhone") ?? "").trim();
  const address = String(fd.get("address") ?? "").trim();
  const notes = String(fd.get("notes") ?? "").trim();

  // This used to redirect back with the message in the URL, which threw away
  // everything already typed — on a manual order that is a customer name, a
  // phone number, an address and every line. Now the form stays where it is and
  // the message appears above it.
  const fail = (msg: string): never => {
    throw new ActionError(msg);
  };

  if (!customerName || !customerPhone) fail("Name and phone are required");
  if (fulfillment === "delivery" && !address) fail("Delivery needs an address");

  const branch = await db.branch.findFirst({ where: { id: branchId, deletedAt: null, active: true } });
  if (!branch) fail("Pick a branch");

  // ── ხაზები ფორმიდან ──
  const products = await db.product.findMany({
    where: { deletedAt: null, active: true },
    select: { id: true, type: true, legacyId: true },
  });

  const lines: CartLineIn[] = [];

  for (const p of products) {
    const raw = fd.get(`qty_${p.id}`);
    const qty = Number(String(raw ?? "").trim());
    if (!Number.isFinite(qty) || qty <= 0) continue;

    if (p.type === "pizza" && p.legacyId != null) {
      const sizeIdx = Number(fd.get(`size_${p.id}`) ?? 1);
      lines.push({
        kind: "pizza",
        qty: Math.floor(qty),
        pizzaId: p.legacyId,
        sizeIdx: Number.isFinite(sizeIdx) ? sizeIdx : 1,
        // საიტი ნაგულისხმევ პიცაზე ცარიელ ტოპინგებს აგზავნის — იგივე აქაც,
        // რომ ფასი ზუსტად დაემთხვეს
        toppings: {},
        removed: {},
      });
    } else {
      lines.push({
        kind: "simple",
        qty: Math.floor(qty),
        itemId: p.id.replace(/^(side|drink)-/, ""),
      });
    }
  }

  if (lines.length === 0) fail("Add at least one item");

  // ── ფასი სერვერზე ──
  const menu = await getMenu();
  const priced = priceOrder(menu, lines, fulfillment);

  if (priced.errors.length > 0) {
    console.error("manual order: pricing failed", priced.errors);
    fail("Some items are no longer on the menu");
  }

  const org = await db.organization.findFirst();
  if (!org) throw new ActionError("Organization not found");

  const order = await db.order.create({
    data: {
      source: "phone",
      createdByEmployee: session.sub,
      orgId: org.id,
      branchId: branch!.id,
      fulfillmentType: fulfillment === "pickup" ? "pickup" : "delivery",
      address: fulfillment === "delivery" ? { text: address } : undefined,
      customerName,
      customerPhone,
      notes: notes || null,
      subtotal: priced.subtotal,
      deliveryFee: priced.deliveryFee,
      total: priced.total,
      status: "confirmed", // ხელით შეყვანილი უკვე დადასტურებულია
      statusHistory: [
        { status: "new", at: new Date().toISOString(), by: session.name ?? "admin" },
        { status: "confirmed", at: new Date().toISOString(), by: session.name ?? "admin" },
      ],
      paymentMethod: "cash",
      paymentStatus: "unpaid",
      items: {
        create: priced.items.map((i) => ({
          kind: i.kind,
          productId: i.refId,
          name: { en: i.name, ka: i.name },
          config: i.config as object,
          qty: i.qty,
          unitPrice: i.unitPrice,
          lineTotal: i.lineTotal,
        })),
      },
    },
    select: { id: true, orderNo: true },
  });

  // ── მარაგის ჩამოწერა — იგივე, რაც საიტზე ──
  try {
    const loc = await locationForBranch(branch!.id);
    if (loc) {
      const used = await computeConsumption(priced.items);
      if (used.length > 0) {
        const created = await recordMovements(
          used.map((u) => ({
            locationId: loc.id,
            itemId: u.itemId,
            type: "sale" as const,
            qty: -u.qty,
            refType: "Order",
            refId: order.id,
            note: `Order #${order.orderNo} (manual)`,
            employeeId: session.sub,
          })),
        );
        for (const [i, m] of created.entries()) {
          await applyOutgoingCost(loc.id, used[i].itemId, used[i].qty, m.id);
        }
      }
    }
  } catch (e) {
    console.error("manual order: stock deduction failed (order kept)", e);
  }

  await logAction({
    action: "order.manual",
    entityType: "Order",
    entityId: order.id,
    branchId: branch!.id,
    after: { orderNo: order.orderNo, total: priced.total, items: priced.items.length },
    employeeId: session.sub,
  });

  revalidatePath("/admin/orders");
  redirect(`/admin/orders/${order.id}`);
}, tr);
