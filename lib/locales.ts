// Central locale configuration (no "use client" — safe to import in middleware).

/** Every language the codebase has translations for. */
export const ALL_LOCALES = ["en", "ka"] as const;
export type Locale = (typeof ALL_LOCALES)[number];

/**
 * The languages *this* restaurant offers.
 *
 * A Monroe pizzeria has no use for a Georgian language switch in its footer —
 * it is a question the customer cannot answer and an invitation to a menu
 * nobody there can read. So the offered set is per-instance:
 *
 *     NEXT_PUBLIC_LOCALES=en        one language, no switcher
 *     NEXT_PUBLIC_LOCALES=en,ka     both
 *
 * Unset means English only, because every new customer is American. Ronny's
 * sets it explicitly, so the new default can never reach it by accident.
 */
const requested = (process.env.NEXT_PUBLIC_LOCALES || "en")
  .split(",")
  .map((x) => x.trim())
  .filter((x): x is Locale => (ALL_LOCALES as readonly string[]).includes(x));

export const LOCALES: readonly Locale[] = requested.length ? requested : ["en"];

export function isLocale(x: string | undefined): x is Locale {
  return !!x && (LOCALES as readonly string[]).includes(x);
}

/** True when there is nothing to switch between — hide the language control. */
export const SINGLE_LOCALE = LOCALES.length < 2;

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
export const DEFAULT_LOCALE: Locale = isLocale(configured) ? configured : LOCALES[0];

/**
 * Absolute site origin, for canonical URLs, hreflang, the sitemap and JSON-LD.
 *
 * ⚠️ The fallback used to be "https://ronnys.ge". Every tenant that forgot to
 * set NEXT_PUBLIC_SITE_URL therefore published canonical tags, a sitemap and
 * structured data pointing at a different restaurant's domain — which is the
 * one SEO mistake that actively helps a competitor and shows up nowhere on the
 * page. Nothing renders wrong; the site simply tells search engines it is a
 * copy of somewhere else.
 *
 * An empty string produces relative URLs. Those are valid, they are correct on
 * whatever host is serving, and — unlike a wrong absolute origin — they cannot
 * point at somebody else.
 */
const CONFIGURED_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "";

if (!CONFIGURED_SITE_URL && typeof window === "undefined") {
  console.warn(
    "[locales] NEXT_PUBLIC_SITE_URL is not set — canonical URLs and the sitemap will be relative",
  );
}

export const SITE_URL = CONFIGURED_SITE_URL;
