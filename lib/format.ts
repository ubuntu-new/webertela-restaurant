import { cache } from "react";
import { db } from "@/lib/db";

/**
 * Money, dates and numbers, formatted the way the restaurant's own country
 * writes them.
 *
 * Until now `₾` was written into the markup in about a hundred places and dates
 * went through `toLocaleString("ka-GE")`. That is invisible on a feature list
 * and fatal in a demo: a Monroe owner opens his dashboard and sees lari and
 * day/month/year. Nothing else on the screen matters after that.
 *
 * So the unit of currency stops being a character in the JSX and becomes a
 * property of the organisation, read once per request.
 */

export type OrgFormat = {
  locale: string;
  currency: string;
  timeZone: string;
  country: string;
};

/** Used until an organisation says otherwise. */
const FALLBACK: OrgFormat = {
  locale: "en-US",
  currency: "USD",
  timeZone: "America/New_York",
  country: "US",
};

/**
 * `cache` de-duplicates within a single request, so a page that formats two
 * hundred numbers still makes one query.
 */
export const orgFormat = cache(async (): Promise<OrgFormat> => {
  try {
    const row = await db.setting.findUnique({ where: { key: "org" } });
    const v = (row?.value ?? {}) as Record<string, unknown>;
    return {
      locale: typeof v.locale === "string" && v.locale ? v.locale : FALLBACK.locale,
      currency: typeof v.currency === "string" && v.currency ? v.currency : FALLBACK.currency,
      timeZone: typeof v.timeZone === "string" && v.timeZone ? v.timeZone : FALLBACK.timeZone,
      country: typeof v.country === "string" && v.country ? v.country : FALLBACK.country,
    };
  } catch {
    // A formatting helper must never be the reason a page fails to render.
    return FALLBACK;
  }
});

export type Fmt = {
  /** "$3,240.00" — symbol, grouping and placement all follow the locale. */
  money: (n: number | null | undefined) => string;
  /** Same, without decimals. For headline figures where cents are noise. */
  moneyShort: (n: number | null | undefined) => string;
  /** Signed, for deltas: "+$120.00" / "−$120.00". */
  moneySigned: (n: number | null | undefined) => string;
  /** "8/27/2026" */
  date: (d: Date | string | null | undefined) => string;
  /** "8/27/2026, 6:15 PM" */
  dateTime: (d: Date | string | null | undefined) => string;
  /** "6:15 PM" */
  time: (d: Date | string | null | undefined) => string;
  /** "Thursday" — for "vs the same weekday last week". */
  weekday: (d: Date | string | null | undefined) => string;
  /** Plain number with locale grouping. */
  num: (n: number | null | undefined, decimals?: number) => string;
  /** "58.4%" */
  pct: (n: number | null | undefined, decimals?: number) => string;
  org: OrgFormat;
};

export async function fmt(): Promise<Fmt> {
  const org = await orgFormat();
  const { locale, currency, timeZone } = org;

  const money2 = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const money0 = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const dateF = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "short" });
  const dateTimeF = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "short", timeStyle: "short" });
  const timeF = new Intl.DateTimeFormat(locale, { timeZone, timeStyle: "short" });
  const weekdayF = new Intl.DateTimeFormat(locale, { timeZone, weekday: "long" });

  const d = (x: Date | string | null | undefined) => {
    if (!x) return null;
    const v = x instanceof Date ? x : new Date(x);
    return Number.isNaN(v.getTime()) ? null : v;
  };

  return {
    money: (n) => money2.format(Number(n ?? 0)),
    moneyShort: (n) => money0.format(Number(n ?? 0)),
    // U+2212 rather than a hyphen: a minus sign in front of a figure should
    // look like a minus sign, not like a dash.
    moneySigned: (n) => {
      const v = Number(n ?? 0);
      return v < 0 ? `−${money2.format(-v)}` : `+${money2.format(v)}`;
    },
    date: (x) => { const v = d(x); return v ? dateF.format(v) : "—"; },
    dateTime: (x) => { const v = d(x); return v ? dateTimeF.format(v) : "—"; },
    time: (x) => { const v = d(x); return v ? timeF.format(v) : "—"; },
    weekday: (x) => { const v = d(x); return v ? weekdayF.format(v) : "—"; },
    num: (n, decimals = 0) =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(Number(n ?? 0)),
    pct: (n, decimals = 1) =>
      n === null || n === undefined
        ? "—"
        : `${new Intl.NumberFormat(locale, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          }).format(Number(n))}%`,
    org,
  };
}
