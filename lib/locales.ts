// Central locale configuration (no "use client" — safe to import in middleware).
export const LOCALES = ["en", "ka"] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(x: string | undefined): x is Locale {
  return !!x && (LOCALES as readonly string[]).includes(x);
}

/**
 * Which language a visitor lands on.
 *
 * This used to be `"ka"`, written into the file — so a Monroe restaurant's
 * customers were redirected to a Georgian menu. It is a property of the
 * restaurant, not of the codebase.
 *
 * Middleware runs before any database call is available, so it comes from the
 * environment rather than from `Setting: org`. `new-tenant.sh` writes it; the
 * fallback is English because every new customer is American, and Ronny's has
 * `NEXT_PUBLIC_DEFAULT_LOCALE=ka` set explicitly so that the new default can
 * never reach it by accident.
 */
const configured = process.env.NEXT_PUBLIC_DEFAULT_LOCALE;
export const DEFAULT_LOCALE: Locale = isLocale(configured) ? configured : "en";

// Absolute site origin — set NEXT_PUBLIC_SITE_URL in .env for production.
// Used for canonical URLs, hreflang alternates, sitemap and JSON-LD.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://ronnys.ge").replace(/\/$/, "");
