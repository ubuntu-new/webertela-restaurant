import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { signInWithPin, posSignOut, getPosSession } from "@/lib/pos-auth";
import { isValidPin } from "@/lib/pin";
import { logAction } from "@/lib/audit";
import { startShift, endShift, currentShift } from "@/lib/shift";
import {
  check, clientIp, fail, key, relax, slowDown, succeed, waitMessage, worthLogging,
  PIN_POLICY, PIN_POLICY_WIDE, GLOBAL_POLICY,
} from "@/lib/rate-limit";

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
  const on = s ? await currentShift(s.sub) : null;

  return NextResponse.json({
    // `shift` identifies this sign-in, not this person — see PosSession.sid.
    // The till compares it to decide whether the queue changed hands.
    session: s
      ? { name: s.name, branchId: s.branchId, posId: s.posId, shift: s.sid, since: on?.clockIn?.toISOString() ?? null }
      : null,
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

  const ip = await clientIp();

  /**
   * Three keys, checked before any work is done, in order of how much they can
   * hurt an innocent person if they are wrong.
   *
   *   · **wide** — everyone at this address, which is the whole building. Only
   *     ever slows down; ceiling of a minute.
   *   · **global** — every failed attempt at this door from anywhere. The only
   *     thing standing in the way of an attacker who rotates addresses, so set
   *     far beyond any honest traffic and capped at ten seconds.
   *   · **narrow** — this address at this terminal. May pause for minutes,
   *     because it affects one till.
   *
   * The wide and global gates come **before** the database lookup so that a
   * throttled caller costs no query, and the narrow key is built only after the
   * terminal is known to be real — otherwise inventing terminal ids would mint
   * a fresh five-guess allowance, and a fresh entry in memory, per request.
   *
   * An earlier version instead punished unknown terminals with a strict shared
   * lockout. That was wrong twice over. It bought nothing — `/pos` is public and
   * lists every terminal, so there is nothing to enumerate — and cashiers do
   * reach it: the terminal is restored from localStorage without revalidation,
   * and deactivating one till mid-service would then have taken the entire
   * restaurant offline for up to an hour.
   */
  const wide = key("pos", ip);
  const everyone = key("pos", "*");

  // The building's key may refuse; the everyone key may only delay. A hard
  // refusal on a key nobody can be excluded from is a way to close a business —
  // one failure every nine seconds from anywhere would otherwise have kept this
  // endpoint shut for every till at every branch, and no cashier could reopen
  // one. See `slowDown`.
  const gateWide = check(wide);
  if (!gateWide.ok) {
    return NextResponse.json(
      { error: waitMessage(gateWide.retryAfter) },
      { status: 429, headers: { "Retry-After": String(gateWide.retryAfter) } },
    );
  }
  await slowDown(check(everyone));

  // Built before the terminal is known, so a caller already waiting on their
  // own key costs no database query. Only `fail` creates a bucket, so checking
  // a key for a terminal that turns out not to exist allocates nothing.
  const narrow = key("pos", ip, posId);
  const gateNarrow = check(narrow);
  if (!gateNarrow.ok) {
    return NextResponse.json(
      { error: waitMessage(gateNarrow.retryAfter) },
      { status: 429, headers: { "Retry-After": String(gateNarrow.retryAfter) } },
    );
  }

  const terminal = await db.terminal.findFirst({ where: { posId, branchId, active: true } });

  /**
   * An unknown terminal is not a guess, so it does not count as one.
   *
   * This is the correction to a mistake that would have been worse than the
   * hole it patched. Naming a terminal that does not exist reveals nothing
   * about anybody's PIN — `/pos` lists every terminal publicly, so there is
   * nothing to enumerate — and cashiers reach it by ordinary means: the
   * terminal is restored from localStorage without revalidation, so
   * deactivating one till mid-service leaves that cashier posting a dead
   * `posId` every three minutes as the idle lock re-arms. Charging that to the
   * building's key would have let one deactivated till throttle every other.
   *
   * It is still charged to the everyone key, which delays rather than refuses:
   * that is a control on database load, not on guessing.
   */
  if (!terminal) {
    const v = fail(everyone, GLOBAL_POLICY);
    if (worthLogging(v)) {
      await logAction({
        action: "pos.signIn.failed",
        entityType: "Terminal",
        entityId: posId.slice(0, 80),
        after: { why: "unknown terminal", ip, fails: v.fails },
      });
    }
    return NextResponse.json(
      { error: "This terminal is no longer set up. Choose another, or ask the owner to re-enable it." },
      { status: 400 },
    );
  }

  /**
   * Every refusal past this point costs the same.
   *
   * Not only wrong PINs: a *correct* PIN belonging to someone not assigned to
   * this branch is refused too, and that refusal tells an attacker they found a
   * real PIN. If only the 401 counted, the 403 would be a free oracle for
   * walking the whole space. The message stays specific — a manager at the
   * wrong branch's till deserves to know why — and the limit is what makes
   * keeping it affordable.
   */
  const refuse = async (message: string, status: number, why: string) => {
    const n = fail(narrow, PIN_POLICY);
    const w = fail(wide, PIN_POLICY_WIDE);
    fail(everyone, GLOBAL_POLICY);

    if (worthLogging(n)) {
      await logAction({
        action: "pos.signIn.failed",
        entityType: "Terminal",
        entityId: posId,
        branchId,
        // The narrow counter, because it is the one the sampling decision was
        // made on — reporting a different number than the one that triggered
        // the row makes the trail harder to read during an incident.
        after: { why, ip, fails: n.fails, locked: (!n.ok || !w.ok) || undefined },
      });
    }
    return NextResponse.json({ error: message }, { status });
  };

  const result = await signInWithPin(pin, branchId, posId);

  if (!result) return refuse("PIN not recognised", 401, "pin not recognised");
  if ("error" in result) {
    return refuse("You are not assigned to this branch", 403, "wrong branch");
  }

  // This person proved who they are, so the key naming their till goes. The
  // shared keys only step back one, and at most once a minute — see `relax`:
  // clearing them on success would let anyone holding one valid PIN reset the
  // building's allowance at will.
  succeed(narrow);
  relax(wide);
  relax(everyone);

  /**
   * Signing in starts a shift — unless one is already running.
   *
   * This endpoint serves both a cold sign-in and every unlock after the
   * three-minute idle lock, and an unlock is a re-sign-in as far as the server
   * is concerned. Opening a shift on each one would produce twenty a day. So
   * `startShift` is a no-op when the person is already on one, checked by
   * employee rather than terminal because people move between tills.
   *
   * It never blocks the sign-in. Hours that go unrecorded make a report wrong;
   * a sign-in that fails closes a restaurant.
   */
  const shift = await startShift(result.employee.id, branchId, posId);

  await logAction({
    action: "pos.signIn",
    entityType: "Employee",
    entityId: result.employee.id,
    branchId,
    after: { posId },
    employeeId: result.employee.id,
  });

  return NextResponse.json({
    ok: true,
    name: result.employee.name,
    shift: result.sid,
    // When this person actually started, so the till can say "on since 16:20"
    // rather than leaving the hours invisible until payroll.
    since: shift?.clockIn?.toISOString() ?? null,
  });
}

export async function DELETE() {
  const s = await getPosSession();

  // The honest end of a shift. Everything else — a tablet going flat, somebody
  // walking out — leaves it open, and an open shift is repaired by a person
  // rather than guessed at. See lib/shift.ts.
  if (s) await endShift(s.sub);

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
