import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMenu } from "@/lib/menu-db";
import { priceOrder, type CartLineIn } from "@/lib/order-pricing";
import { computeConsumption, locationForBranch } from "@/lib/consumption";
import { recordMovements } from "@/lib/stock";
import { applyOutgoingCost } from "@/lib/costing";
import { notifyNewOrder } from "@/lib/telegram";
import { awardPoints } from "@/lib/loyalty";
import { normalizePhone } from "@/lib/phone";
import { fmt } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * შეკვეთის მიღება.
 *
 * ⚠️ კლიენტისგან მოდის **მხოლოდ არჩევანი** — რომელი პიცა, რა ზომა, რა ტოპინგები.
 * ფასს სერვერი თვითონ ითვლის ბაზიდან. კლიენტის `price`/`total` იგნორირდება.
 * მის გარეშე ნებისმიერს შეეძლებოდა DevTools-ით `total: 0` გამოეგზავნა.
 *
 * ORDER_STRICT=1 → ჯამის შეუსაბამობა შეკვეთას აუქმებს.
 * ნაგულისხმევად „მშრალი" რეჟიმია: შეუსაბამობა ლოგში იწერება, შეკვეთა გადის.
 */
const STRICT = process.env.ORDER_STRICT === "1";

interface Body {
  branchId?: string;
  fulfillment?: "delivery" | "pickup";
  name?: string;
  phone?: string;
  address?: string;
  notes?: string;
  lines?: CartLineIn[];
  clientTotal?: number;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "არასწორი მოთხოვნა" }, { status: 400 });
  }

  const fulfillment = body.fulfillment === "pickup" ? "pickup" : "delivery";
  const name = (body.name ?? "").trim();
  const phone = (body.phone ?? "").trim();
  const address = (body.address ?? "").trim();
  const notes = (body.notes ?? "").trim();
  const lines = Array.isArray(body.lines) ? body.lines : [];

  if (!name || !phone) return NextResponse.json({ error: "სახელი და ტელეფონი სავალდებულოა" }, { status: 400 });
  if (lines.length === 0) return NextResponse.json({ error: "კალათა ცარიელია" }, { status: 400 });
  if (fulfillment === "delivery" && !address) {
    return NextResponse.json({ error: "მიწოდების მისამართი სავალდებულოა" }, { status: 400 });
  }

  // ── ფილიალი ──
  const branch = await db.branch.findFirst({
    where: { id: body.branchId ?? "", deletedAt: null, active: true },
  });
  if (!branch) return NextResponse.json({ error: "აირჩიე ფილიალი" }, { status: 400 });

  // ── ფასი სერვერზე ──
  const menu = await getMenu();
  const priced = priceOrder(menu, lines, fulfillment);

  if (priced.errors.length > 0) {
    console.error("order: ფასის გამოთვლა ჩავარდა", priced.errors);
    return NextResponse.json(
      { error: "ზოგიერთი პოზიცია მენიუში აღარ არის. განაახლე გვერდი." },
      { status: 409 },
    );
  }

  if (priced.subtotal < menu.MIN_ORDER) {
    const f = await fmt();
    return NextResponse.json(
      { error: `მინიმალური შეკვეთაა ${f.money(menu.MIN_ORDER)}` },
      { status: 400 },
    );
  }

  // ── კლიენტის ჯამთან შედარება ──
  const client = typeof body.clientTotal === "number" ? body.clientTotal : null;
  const drift = client !== null ? Math.abs(client - priced.total) : 0;

  if (client !== null && drift > 0.01) {
    console.warn(
      `order: ჯამი არ ემთხვევა — კლიენტი ${client}, სერვერი ${priced.total} (სხვაობა ${drift.toFixed(2)})`,
      JSON.stringify(priced.items.map((i) => ({ n: i.name, u: i.unitPrice, q: i.qty }))),
    );
    if (STRICT) {
      return NextResponse.json(
        { error: "ფასი შეიცვალა. განაახლე გვერდი და სცადე ხელახლა." },
        { status: 409 },
      );
    }
  }

  // ── ჩაწერა ──
  const org = await db.organization.findFirst();
  if (!org) return NextResponse.json({ error: "ორგანიზაცია ვერ მოიძებნა" }, { status: 500 });

  // menu-ს id → Product.id (მხოლოდ არსებულებზე)
  const refIds = priced.items.map((i) => i.refId).filter((x): x is string => !!x);
  const products = refIds.length
    ? await db.product.findMany({ where: { id: { in: refIds } }, select: { id: true } })
    : [];
  const known = new Set(products.map((p) => p.id));

  try {
    const order = await db.order.create({
      data: {
        source: "web",
        orgId: org.id,
        branchId: branch.id,
        fulfillmentType: fulfillment === "pickup" ? "pickup" : "delivery",
        address: fulfillment === "delivery" ? { text: address } : undefined,
        customerName: name,
        customerPhone: phone,
        notes: notes || null,
        subtotal: priced.subtotal,
        deliveryFee: priced.deliveryFee,
        total: priced.total,
        status: "new",
        statusHistory: [{ status: "new", at: new Date().toISOString(), by: "web" }],
        paymentMethod: "cash",
        paymentStatus: "unpaid",
        items: {
          create: priced.items.map((i) => ({
            kind: i.kind,
            productId: i.refId && known.has(i.refId) ? i.refId : null,
            name: { en: i.name, ka: i.name },
            config: i.config as object,
            qty: i.qty,
            unitPrice: i.unitPrice,
            lineTotal: i.lineTotal,
          })),
        },
      },
      select: { id: true, orderNo: true, total: true },
    });

    // ── loyalty ──
    // The website has no accounts yet, so the phone identifies the customer.
    // Same key as the till, so a phone order and a web order are one person.
    try {
      const key = normalizePhone(phone);
      if (key) {
        const user = await db.user.upsert({
          where: { phone: key },
          update: { name: name || undefined },
          create: { phone: key, name: name || null },
          select: { id: true },
        });
        await db.order.update({
          where: { id: order.id },
          data: { userId: user.id },
        });
        const earned = await awardPoints({
          userId: user.id,
          orderId: order.id,
          subtotal: priced.subtotal,
        });
        if (earned > 0) {
          await db.order.update({ where: { id: order.id }, data: { pointsEarned: earned } });
        }
        await db.user.update({
          where: { id: user.id },
          data: {
            orderCount: { increment: 1 },
            totalSpent: { increment: priced.total },
            lastOrderAt: new Date(),
          },
        });
      }
    } catch (e) {
      console.error("order: loyalty failed (order kept)", e);
    }

    // ── Telegram (ფონურად — პასუხს არ ვაყოვნებთ) ──
    void notifyNewOrder({
      orderNo: order.orderNo,
      branch: String((branch.name as Record<string, unknown>)?.ka ?? (branch.name as Record<string, unknown>)?.en ?? ""),
      total: Number(order.total).toFixed(2),
      itemCount: priced.items.length,
      type: fulfillment,
      customer: name,
      phone,
    });

    // ── მარაგის ჩამოწერა ──
    // შეკვეთა უკვე შექმნილია; ჩამოწერის ჩავარდნა მას არ აუქმებს.
    try {
      const loc = await locationForBranch(branch.id);
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
              note: `შეკვეთა #${order.orderNo}`,
            })),
          );

          // ჩამოწერის ღირებულება მიმდინარე საშუალოთი — რეპორტისთვის
          for (const [i, m] of created.entries()) {
            await applyOutgoingCost(loc.id, used[i].itemId, used[i].qty, m.id);
          }
        }
      } else {
        console.warn(`order: ფილიალს ${branch.id} საწყობის ლოკაცია არ აქვს — ჩამოწერა გამოტოვდა`);
      }
    } catch (e) {
      console.error("order: მარაგის ჩამოწერა ჩავარდა (შეკვეთა შენარჩუნებულია)", e);
    }

    return NextResponse.json({
      ok: true,
      orderNo: order.orderNo,
      total: Number(order.total),
    });
  } catch (e) {
    console.error("order: ჩაწერა ჩავარდა", e);
    return NextResponse.json({ error: "შეკვეთა ვერ შეიქმნა. სცადე ხელახლა." }, { status: 500 });
  }
}
