import { NextResponse } from "next/server";
import { driverSignIn, driverSignOut, getDriverSession } from "@/lib/driver-auth";
import { isValidPin } from "@/lib/pin";
import { logAction } from "@/lib/audit";
import {
  check, clientIp, fail, key, relax, slowDown, waitMessage, worthLogging,
  PIN_POLICY_SHARED, GLOBAL_POLICY,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ session: await getDriverSession() });
}

export async function POST(req: Request) {
  let body: { pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  if (!isValidPin(body.pin ?? "")) {
    return NextResponse.json({ error: "Enter a 4–8 digit PIN" }, { status: 400 });
  }

  /**
   * Drivers sit behind carrier-grade NAT: every driver on one network in one
   * city can share a source address, so the address is a poor identity and a
   * lockout here would strand a whole shift over one person's mistyping. The
   * first draft used the strictest policy on the weakest key — five misses and
   * nobody could sign in. This throttles instead: ten misses, then a wait that
   * never exceeds a minute.
   */
  const ip = await clientIp();
  const bucket = key("driver", ip);
  // Every failed attempt at this door from anywhere. Behind carrier NAT the
  // address is already a weak identity, and against an attacker rotating
  // addresses it is no identity at all — so this is the backstop. Set far
  // beyond honest traffic and capped at ten seconds, because every driver in
  // the city shares it.
  const everyone = key("driver", "*");

  const gate = check(bucket);
  if (!gate.ok) {
    return NextResponse.json(
      { error: waitMessage(gate.retryAfter) },
      { status: 429, headers: { "Retry-After": String(gate.retryAfter) } },
    );
  }
  // Delays, never refuses. Every driver in the country shares this key, so
  // turning anyone away on it would strand a shift over someone else's script.
  await slowDown(check(everyone));

  // Both refusals count. "This account is not a driver" is only reachable with
  // a PIN that matched a real employee, so leaving it free would hand an
  // attacker a way to confirm PINs at no cost.
  const refuse = async (message: string, status: number, why: string) => {
    const v = fail(bucket, PIN_POLICY_SHARED);
    fail(everyone, GLOBAL_POLICY);
    // Not every failure: writing a row per guess turned an unauthenticated
    // endpoint into unbounded disk growth on the restaurant's own server.
    if (worthLogging(v)) {
      await logAction({
        action: "driver.signIn.failed",
        entityType: "Employee",
        after: { why, ip, fails: v.fails, locked: !v.ok || undefined },
      });
    }
    return NextResponse.json({ error: message }, { status });
  };

  const result = await driverSignIn(body.pin!);
  if (!result) return refuse("PIN not recognised", 401, "pin not recognised");
  if ("error" in result) return refuse("This account is not a driver", 403, "not a driver");

  relax(bucket);
  relax(everyone);

  await logAction({
    action: "driver.signIn",
    entityType: "Employee",
    entityId: result.employee.id,
    employeeId: result.employee.id,
  });

  return NextResponse.json({ ok: true, name: result.employee.name });
}

export async function DELETE() {
  // The POS logs its sign-out and this did not, so a driver's shift had a
  // beginning in the record and no end.
  const s = await getDriverSession();
  await driverSignOut();
  if (s) {
    await logAction({
      action: "driver.signOut",
      entityType: "Employee",
      entityId: s.sub,
      employeeId: s.sub,
    });
  }
  return NextResponse.json({ ok: true });
}
