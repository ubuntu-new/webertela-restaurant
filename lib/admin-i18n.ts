import "server-only";
import { db } from "@/lib/db";
import { KA, type AdminLang } from "@/lib/admin-i18n-dict";

export { trWith } from "@/lib/admin-i18n-dict";
export type { AdminLang };

/**
 * Admin interface language, resolved from the database.
 *
 * English is the SOURCE language — every string in the code is written in
 * English and lib/admin-i18n-dict.ts maps it to Georgian. A new screen written
 * in English already works; forgetting to translate it degrades to English
 * rather than to a missing key.
 */

let cache: { lang: AdminLang; at: number } | null = null;

/** Cached briefly — this runs on every admin page render. */
export async function getAdminLang(): Promise<AdminLang> {
  if (cache && Date.now() - cache.at < 30_000) return cache.lang;

  try {
    const row = await db.setting.findUnique({ where: { key: "adminLanguage" } });
    const v = (row?.value ?? {}) as Record<string, unknown>;
    const lang: AdminLang = v.lang === "ka" ? "ka" : "en";
    cache = { lang, at: Date.now() };
    return lang;
  } catch {
    return "en";
  }
}

export function clearLangCache() {
  cache = null;
}

/**
 * Translate. English text is the key; unknown keys return unchanged.
 *
 * Usage:  const t = await tr();  …  t("Products")
 */
export async function tr() {
  const lang = await getAdminLang();
  return (en: string): string => (lang === "ka" ? (KA[en] ?? en) : en);
}
