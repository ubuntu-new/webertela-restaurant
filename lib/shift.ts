import "server-only";
import { db } from "@/lib/db";
import { logAction } from "@/lib/audit";

/**
 * Who was working, and for how long.
 *
 * ── Why this file did not exist, and what that cost ──
 *
 * The `Shift` table has been in the schema since the beginning. `analytics.ts`
 * computes labour cost from it, `advice.ts` warns about shifts left open, and
 * the setup checklist puts "See your prime cost" behind filling in everybody's
 * hourly rate. Every one of those was reading a table that **nothing has ever
 * written to.**
 *
 * So labour cost was structurally zero, and prime cost — the number this whole
 * product is sold on, the one the deck says separates a business from a hobby —
 * was only ever food cost wearing prime cost's name. An owner could complete
 * the setup checklist, watch it turn green, and still be looking at half a
 * figure with nothing on screen admitting it.
 *
 * ── The rules, and why each one ──
 *
 * **Signing in to the till starts a shift, if one is not already running.** Not
 * a separate button: a cashier who has to remember a second action will forget
 * it, and hours nobody recorded are worth exactly as much as no feature at all.
 * Unlocking after the idle lock is a re-sign-in, so it must not open a second
 * shift — hence "if one is not already running", which is checked per employee
 * rather than per terminal, because someone can move tills mid-shift.
 *
 * **Signing out closes it.** The honest end. Everything else is a guess.
 *
 * **A shift left open is not silently guessed at.** Somebody walks out without
 * signing off; the next morning the clock says fourteen hours. Writing that
 * down as fourteen hours of pay is worse than writing nothing, because it is
 * wrong in the direction that makes the headline figure look terrible and
 * nobody can tell whether the number or the evening was at fault. So an
 * abandoned shift is closed with **no duration** and surfaced for a human to
 * say when the person actually left.
 */

/** Longer than this and nobody clocked out — it was abandoned. */
export const ABANDONED_AFTER_HOURS = 14;

export interface OpenShift {
  id: string;
  employeeId: string;
  clockIn: Date;
  branchId: string;
  posId: string | null;
}

/** The shift this person is currently on, if any. */
export async function currentShift(employeeId: string): Promise<OpenShift | null> {
  const s = await db.shift.findFirst({
    where: { employeeId, status: "open" },
    orderBy: { clockIn: "desc" },
    select: { id: true, employeeId: true, clockIn: true, branchId: true, posId: true },
  });
  return s ?? null;
}

/**
 * Start a shift, unless this person is already on one.
 *
 * Returns the shift either way, so a caller can show "on since 16:20" without
 * caring whether this particular sign-in was the one that started it. Failures
 * are swallowed: a cashier must never be kept out of the till because the hours
 * ledger had a bad moment. An unrecorded shift is a wrong report; a refused
 * sign-in is a closed restaurant.
 */
export async function startShift(
  employeeId: string,
  branchId: string,
  posId: string | null,
): Promise<OpenShift | null> {
  try {
    const already = await currentShift(employeeId);
    if (already) return already;

    const s = await db.shift.create({
      data: { employeeId, branchId, posId },
      select: { id: true, employeeId: true, clockIn: true, branchId: true, posId: true },
    });

    await logAction({
      action: "shift.start",
      entityType: "Shift",
      entityId: s.id,
      branchId,
      after: { posId },
      employeeId,
    });

    return s;
  } catch (e) {
    console.error("shift: could not start", e);
    return null;
  }
}

/**
 * End a shift.
 *
 * `at` lets a manager correct a forgotten clock-out to when the person really
 * left. Without it the clock is trusted, and only up to the point where
 * trusting it stops being reasonable — see `ABANDONED_AFTER_HOURS`.
 */
export async function endShift(
  employeeId: string,
  opts: { at?: Date; by?: string } = {},
): Promise<{ minutes: number | null } | null> {
  try {
    const s = await currentShift(employeeId);
    if (!s) return null;

    const now = opts.at ?? new Date();
    const raw = Math.round((now.getTime() - s.clockIn.getTime()) / 60_000);

    /**
     * Two ways this ends up with no duration, and both are deliberate.
     *
     * A correction that lands *before* the clock-in is not a shorter shift, it
     * is a mistake. And a shift running past the abandoned threshold was not
     * worked for that long — the person left and nobody told the system. In
     * both cases the honest record is "we do not know", because a made-up
     * number here goes straight into prime cost and quietly poisons the one
     * figure the owner is meant to trust.
     */
    const abandoned = !opts.at && raw > ABANDONED_AFTER_HOURS * 60;
    const minutes = raw < 0 || abandoned ? null : raw;

    await db.shift.update({
      where: { id: s.id },
      data: {
        clockOut: now,
        durationMin: minutes,
        status: "closed",
        approvedBy: opts.by ?? null,
      },
    });

    await logAction({
      action: abandoned ? "shift.abandoned" : "shift.end",
      entityType: "Shift",
      entityId: s.id,
      branchId: s.branchId,
      after: { minutes, hours: minutes === null ? null : Math.round((minutes / 60) * 10) / 10, corrected: !!opts.at },
      employeeId: opts.by ?? employeeId,
    });

    return { minutes };
  } catch (e) {
    console.error("shift: could not end", e);
    return null;
  }
}

/**
 * Close a specific shift by id, at a stated time.
 *
 * The manager's correction path. Separate from `endShift` because that one is
 * about the person signing themselves out and this one is about somebody else
 * repairing a record — different authority, different audit entry, and the time
 * is required rather than assumed.
 */
export async function closeShiftAt(
  shiftId: string,
  at: Date,
  by: string,
): Promise<{ ok: true; minutes: number } | { ok: false; error: string }> {
  const s = await db.shift.findUnique({
    where: { id: shiftId },
    select: { id: true, clockIn: true, status: true, branchId: true, employeeId: true },
  });
  if (!s) return { ok: false, error: "That shift no longer exists." };
  if (s.status === "closed") return { ok: false, error: "That shift is already closed." };

  const minutes = Math.round((at.getTime() - s.clockIn.getTime()) / 60_000);
  if (minutes < 0) return { ok: false, error: "That is before they clocked in." };
  if (minutes > 24 * 60) return { ok: false, error: "More than 24 hours — check the date." };

  await db.shift.update({
    where: { id: shiftId },
    data: { clockOut: at, durationMin: minutes, status: "closed", approvedBy: by },
  });

  await logAction({
    action: "shift.corrected",
    entityType: "Shift",
    entityId: shiftId,
    branchId: s.branchId,
    after: { minutes, hours: Math.round((minutes / 60) * 10) / 10, forEmployee: s.employeeId },
  });

  return { ok: true, minutes };
}
