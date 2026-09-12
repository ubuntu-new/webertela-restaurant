import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { NO_BRAND, toBrand, type Brand } from "@/lib/brand-shared";
import { toSocialLinks } from "@/lib/social";

export { NO_BRAND, toBrand };
export type { Brand };

/**
 * Whose restaurant this is, read from the database.
 *
 * ── Why this exists ──
 *
 * The name was not stored anywhere the interface could reach. It lived in the
 * `Organization` row, which only the order endpoints read, and separately as
 * the literal string "Ronny's" typed into the header, the footer, the copyright
 * line, the about signature, a menu tab and the page title — with "30–45 min"
 * and "4.8 rating" beside it in the trust bar.
 *
 * Every tenant served all of it, and nothing was wrong enough to notice: the
 * pages rendered and the orders worked. The only clue was that a restaurant in
 * Monroe was apparently called Ronny's, had five locations in Tbilisi, and had
 * been rated 4.8 by nobody.
 *
 * `cache` de-duplicates within a request, the same as `orgFormat()`.
 */
export const brandOf = cache(async (lang: string = "en"): Promise<Brand> => {
  try {
    const [org, settings] = await Promise.all([
      db.organization.findFirst({ select: { name: true } }),
      db.setting.findMany({ where: { key: { in: ["org", "social"] } } }),
    ]);

    const byKey = Object.fromEntries(settings.map((s) => [s.key, s.value]));
    const n = org?.name as Record<string, string> | null | undefined;

    return toBrand(
      byKey.org,
      n?.[lang] || n?.en || "",
      toSocialLinks(byKey.social),
      lang,
    );
  } catch {
    // Identity is decoration. A database that cannot be reached is already a
    // problem for the menu, which says so itself — it must not blank the page
    // as well.
    return NO_BRAND;
  }
});
