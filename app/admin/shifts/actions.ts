"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission, getSession } from "@/lib/admin-auth";
import { fdStr } from "@/lib/admin-utils";
import { tr } from "@/lib/admin-i18n";
import { ActionError, formAction } from "@/lib/action-state";
import { closeShiftAt } from "@/lib/shift";

/**
 * Repairing a shift somebody forgot to close.
 *
 * `advice.ts` has warned about these since long before anything could act on
 * one — its "Close the shift" button pointed at a page with no such control,
 * because nothing in the product had ever written a shift in the first place.
 * This is the other half of that sentence.
 *
 * The time is required rather than defaulted to now. A cashier who left at
 * eleven and is discovered at nine the next morning did not work twenty-two
 * hours, and quietly recording that they did would push a made-up number
 * straight into labour cost and out again as prime cost — the one figure the
 * owner is being asked to trust.
 */
export const closeShift = formAction(async (fd: FormData) => {
  await requirePermission("can_manage_staff");
  const t = await tr();
  const me = await getSession();

  const id = fdStr(fd, "shiftId");
  if (!id) throw new ActionError(t("Which shift?"), "shiftId");

  const when = fdStr(fd, "clockOut");
  if (!when) throw new ActionError(t("When did they finish?"), "clockOut");

  // `datetime-local` has no zone, so it is read in the server's, which is the
  // restaurant's — see the systemd unit's TZ. A value that does not parse is a
  // browser doing something unexpected, and guessing at it would defeat the
  // point of asking.
  const at = new Date(when);
  if (Number.isNaN(at.getTime())) throw new ActionError(t("That is not a valid time"), "clockOut");
  if (at.getTime() > Date.now() + 60_000) {
    throw new ActionError(t("That is in the future"), "clockOut");
  }

  const res = await closeShiftAt(id, at, me?.sub ?? "");
  if (!res.ok) throw new ActionError(res.error, "clockOut");

  // `formAction` wants a handler returning nothing — anything a person should
  // read comes back as an ActionError or arrives through the URL, so the hours
  // go in the query string and the page says them.
  revalidatePath("/admin/shifts");
  revalidatePath("/admin");
  redirect(`/admin/shifts?closed=${Math.round((res.minutes / 60) * 10) / 10}`);
});
