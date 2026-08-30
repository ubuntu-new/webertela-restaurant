import "server-only";
import { Prisma, type StockUnit } from "@prisma/client";
import { unitLabel } from "@/lib/units";
import { db } from "@/lib/db";

/**
 * მარაგის მოძრაობა.
 *
 * ⚠️ ნაშთი ხელით არასდროს იწერება. ყოველი ცვლილება ჟურნალში ჩანაწერია,
 * `StockLevel.qty` კი მისი ჯამის ქეში — იმავე ტრანზაქციაში ახლდება.
 * ასე ყოველთვის შეიძლება კითხვა „რატომ დარჩა ამდენი?" და პასუხი ჟურნალშია.
 */

export type MoveType =
  | "receipt"
  | "transfer_out"
  | "transfer_in"
  | "production_in"
  | "production_out"
  | "sale"
  | "waste"
  | "count_adjust";

export interface MoveInput {
  locationId: string;
  itemId: string;
  type: MoveType;
  /** + შემოსვლა, − გასვლა. ნიშანს გამომძახებელი წყვეტს. */
  qty: number | Prisma.Decimal;
  refType?: string | null;
  refId?: string | null;
  note?: string | null;
  employeeId?: string | null;
}

const D = (v: number | Prisma.Decimal) => new Prisma.Decimal(v);

/**
 * ერთი მოძრაობა. ტრანზაქციაში: ჟურნალი + ნაშთის ქეში.
 * `tx` გადაეცემა მაშინ, როცა რამდენიმე მოძრაობა ერთად უნდა ჩაიწეროს
 * (მაგ. შეკვეთის ჩამოწერა — ან ყველა, ან არცერთი).
 */
export async function recordMovement(input: MoveInput, tx?: Prisma.TransactionClient) {
  const run = async (c: Prisma.TransactionClient) => {
    const qty = D(input.qty);

    const level = await c.stockLevel.upsert({
      where: { locationId_itemId: { locationId: input.locationId, itemId: input.itemId } },
      update: { qty: { increment: qty } },
      create: { locationId: input.locationId, itemId: input.itemId, qty },
      select: { qty: true },
    });

    return c.stockMovement.create({
      data: {
        locationId: input.locationId,
        itemId: input.itemId,
        type: input.type,
        qty,
        balanceAfter: level.qty,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        note: input.note ?? null,
        employeeId: input.employeeId ?? null,
      },
    });
  };

  return tx ? run(tx) : db.$transaction(run);
}

/** რამდენიმე მოძრაობა ერთ ტრანზაქციაში — ან ყველა, ან არცერთი. */
export async function recordMovements(inputs: MoveInput[]) {
  if (inputs.length === 0) return [];
  return db.$transaction(async (tx) => {
    const out = [];
    for (const i of inputs) out.push(await recordMovement(i, tx));
    return out;
  });
}

/**
 * ინვენტარიზაცია: ფაქტობრივი ნაშთი ჩაწერე, სისტემა სხვაობას თვითონ დაითვლის.
 * ეს ერთადერთი გზაა ნაშთის „პირდაპირ" შესაცვლელად — და ისიც ჟურნალით.
 */
export async function stockCount(
  locationId: string,
  itemId: string,
  countedQty: number,
  employeeId?: string | null,
  note?: string | null,
) {
  return db.$transaction(async (tx) => {
    const level = await tx.stockLevel.findUnique({
      where: { locationId_itemId: { locationId, itemId } },
      select: { qty: true },
    });

    const current = level ? Number(level.qty) : 0;
    const delta = Math.round((countedQty - current) * 1000) / 1000;

    if (delta === 0) return null;

    return recordMovement(
      {
        locationId,
        itemId,
        type: "count_adjust",
        qty: delta,
        note: note ?? `ინვენტარიზაცია: ${current} → ${countedQty}`,
        employeeId,
      },
      tx,
    );
  });
}

/**
 * ნაშთის ხელახლა გამოთვლა ჟურნალიდან — ქეშის გადამოწმება.
 * ჩვეულებრივ არ გვჭირდება; გამოდგება, თუ ოდესმე ეჭვი გაგვიჩნდა.
 */
export async function recomputeLevel(locationId: string, itemId: string) {
  const agg = await db.stockMovement.aggregate({
    where: { locationId, itemId },
    _sum: { qty: true },
  });
  const sum = agg._sum.qty ?? new Prisma.Decimal(0);

  await db.stockLevel.upsert({
    where: { locationId_itemId: { locationId, itemId } },
    update: { qty: sum },
    create: { locationId, itemId, qty: sum },
  });

  return sum;
}

/**
 * ერთეულის ჩვენება — გრამები/მილილიტრები დიდ რიცხვებში იკარგება.
 *
 * The labels used to be a hard-coded Georgian list of five: გ, კგ, მლ, ლ, ცალი.
 * That put "6.062 კგ" on the stock screen of an English demo — the very screen a
 * prospect is shown — and left the five imperial units added in wave 1 with no
 * label at all, so oz and lb printed as raw enum values.
 *
 * The symbols come from lib/units.ts now, which knows all ten. They are not
 * English so much as international: kg is kg in Tbilisi too, and a Georgian
 * reading "kg" loses nothing, while an American reading "კგ" loses everything.
 */
export function fmtQty(qty: number, unit: string): string {
  const n = Math.round(qty * 1000) / 1000;
  return `${n} ${unitLabel(unit as StockUnit)}`;
}
