import { NextResponse } from "next/server";
import { getPosSession } from "@/lib/pos-auth";
import { currentShift } from "@/lib/shift";
import { cashSummary, countOpening, countClosing, recordMovement } from "@/lib/cash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The drawer, from the till's side.
 *
 * Everything here is about the shift the caller is *currently on*. A cashier
 * can only count their own drawer and only while they are standing at it —
 * there is no shift id in any request, because accepting one would let anyone
 * with a session write a closing figure into somebody else's evening.
 */

export async function GET() {
  const s = await getPosSession();
  if (!s) return NextResponse.json({ error: "Session expired" }, { status: 401 });

  const shift = await currentShift(s.sub);
  if (!shift) return NextResponse.json({ shift: null });

  const summary = await cashSummary(shift.id);
  return NextResponse.json({ shift: { id: shift.id, since: shift.clockIn }, summary });
}

export async function POST(req: Request) {
  const s = await getPosSession();
  if (!s) return NextResponse.json({ error: "Session expired" }, { status: 401 });

  let body: { action?: string; amount?: number; reason?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const shift = await currentShift(s.sub);
  if (!shift) {
    return NextResponse.json(
      { error: "No shift is open, so there is no drawer to count." },
      { status: 409 },
    );
  }

  const amount = Number(body.amount);

  switch (body.action) {
    case "open": {
      const r = await countOpening(shift.id, amount, s.sub);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ ok: true, summary: await cashSummary(shift.id) });
    }

    case "close": {
      const r = await countClosing(shift.id, amount, s.sub, body.note);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      // The variance goes back so the cashier sees it at the moment they can
      // still look for the money, rather than in a report next week.
      return NextResponse.json({ ok: true, variance: r.variance, summary: await cashSummary(shift.id) });
    }

    case "move": {
      const r = await recordMovement(shift.id, amount, String(body.reason ?? ""), s.sub);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ ok: true, summary: await cashSummary(shift.id) });
    }

    default:
      return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
}
