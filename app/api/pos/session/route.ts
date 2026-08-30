import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { signInWithPin, posSignOut, getPosSession } from "@/lib/pos-auth";
import { isValidPin } from "@/lib/pin";
import { logAction } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who this terminal is signed in as, according to the cookie.
 *
 * The till asks this the moment it is online again, to confirm a shift it
 * restored from the device while there was nobody to ask. Only the cookie
 * holder can read it and no other origin can, so it is not a leak — but it was
 * returning the whole token payload, including the internal employee id and the
 * permission role, neither of which the terminal uses for anything.
 *
 * An endpoint should hand back what its caller needs and stop there. What is
 * needed is: is there a session, is it for this till, and whose name goes on
 * the sale.
 */
export async function GET() {
  const s = await getPosSession();
  return NextResponse.json({
    session: s ? { name: s.name, branchId: s.branchId, posId: s.posId } : null,
  });
}

export async function POST(req: Request) {
  let body: { pin?: string; branchId?: string; posId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const { pin = "", branchId = "", posId = "" } = body;
  if (!isValidPin(pin)) return NextResponse.json({ error: "Enter a 4–8 digit PIN" }, { status: 400 });
  if (!branchId || !posId) return NextResponse.json({ error: "Terminal not selected" }, { status: 400 });

  const terminal = await db.terminal.findFirst({ where: { posId, branchId, active: true } });
  if (!terminal) return NextResponse.json({ error: "Unknown terminal" }, { status: 400 });

  const result = await signInWithPin(pin, branchId, posId);

  if (!result) return NextResponse.json({ error: "PIN not recognised" }, { status: 401 });
  if ("error" in result) {
    return NextResponse.json({ error: "You are not assigned to this branch" }, { status: 403 });
  }

  await logAction({
    action: "pos.signIn",
    entityType: "Employee",
    entityId: result.employee.id,
    branchId,
    after: { posId },
    employeeId: result.employee.id,
  });

  return NextResponse.json({ ok: true, name: result.employee.name });
}

export async function DELETE() {
  const s = await getPosSession();
  await posSignOut();
  if (s) {
    await logAction({
      action: "pos.signOut",
      entityType: "Employee",
      entityId: s.sub,
      branchId: s.branchId,
      employeeId: s.sub,
    });
  }
  return NextResponse.json({ ok: true });
}
