import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { makeFmt, toOrgFormat, FALLBACK, type Fmt, type OrgFormat } from "@/lib/format-shared";

export { makeFmt, toOrgFormat, FALLBACK };
export type { Fmt, OrgFormat };

/**
 * The organisation's money and date format, read from `Setting: org`.
 *
 * The arithmetic lives in lib/format-shared.ts so the POS and the driver app
 * can use it too; this half only knows how to ask the database.
 *
 * `cache` de-duplicates within a request, so a page that formats two hundred
 * numbers still makes one query.
 */
export const orgFormat = cache(async (): Promise<OrgFormat> => {
  try {
    const row = await db.setting.findUnique({ where: { key: "org" } });
    return toOrgFormat(row?.value);
  } catch {
    // A formatting helper must never be the reason a page fails to render.
    return FALLBACK;
  }
});

/** `const f = await fmt();  f.money(order.total)` */
export async function fmt(): Promise<Fmt> {
  return makeFmt(await orgFormat());
}
