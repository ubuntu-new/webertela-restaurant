/**
 * Money, dates and numbers — the pure half.
 *
 * No database, no `server-only`, so the POS terminal and the driver app can
 * format too. The server half (lib/format.ts) reads `Setting: org` and hands
 * the result here; a client component receives the same object as a prop and
 * calls `makeFmt` itself.
 *
 * The point of all of it: the unit of currency is a property of the
 * organisation, never a character typed into the markup. `₾` was written into
 * about a hundred places, which is invisible on a feature list and fatal in a
 * demo — a Monroe owner opens his dashboard and sees lari.
 */

export type OrgFormat = {
  locale: string;
  currency: string;
  timeZone: string;
  country: string;
};

/** Used until an organisation says otherwise. Every new customer is American. */
export const FALLBACK: OrgFormat = {
  locale: "en-US",
  currency: "USD",
  timeZone: "America/New_York",
  country: "US",
};

/** Read an unknown value (a Setting row) into a complete OrgFormat. */
export function toOrgFormat(v: unknown): OrgFormat {
  const o = (v ?? {}) as Record<string, unknown>;
  const pick = (k: keyof OrgFormat) =>
    typeof o[k] === "string" && o[k] ? (o[k] as string) : FALLBACK[k];
  return {
    locale: pick("locale"),
    currency: pick("currency"),
    timeZone: pick("timeZone"),
    country: pick("country"),
  };
}

export type Fmt = {
  /** "$3,240.00" — symbol, grouping and placement all follow the locale. */
  money: (n: number | null | undefined) => string;
  /** Same, without decimals. For headline figures where cents are noise. */
  moneyShort: (n: number | null | undefined) => string;
  /** Signed, for deltas: "+$120.00" / "−$120.00". */
  moneySigned: (n: number | null | undefined) => string;
  /** Just the symbol — for a form label like "Rent ($)". */
  symbol: string;
  date: (d: Date | string | null | undefined) => string;
  dateTime: (d: Date | string | null | undefined) => string;
  time: (d: Date | string | null | undefined) => string;
  /** "Thursday" — for "vs the same weekday last week". */
  weekday: (d: Date | string | null | undefined) => string;
  num: (n: number | null | undefined, decimals?: number) => string;
  pct: (n: number | null | undefined, decimals?: number) => string;
  org: OrgFormat;
};

export function makeFmt(org: OrgFormat): Fmt {
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

  // Ask Intl for the symbol rather than keeping a table of our own — it knows
  // that GEL is ₾ and that some currencies put the code where a symbol would go.
  const symbol =
    money2.formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;

  const d = (x: Date | string | null | undefined) => {
    if (!x) return null;
    const v = x instanceof Date ? x : new Date(x);
    return Number.isNaN(v.getTime()) ? null : v;
  };

  return {
    money: (n) => money2.format(Number(n ?? 0)),
    moneyShort: (n) => money0.format(Number(n ?? 0)),
    // U+2212, not a hyphen: a minus in front of a figure should look like one.
    moneySigned: (n) => {
      const v = Number(n ?? 0);
      return v < 0 ? `−${money2.format(-v)}` : `+${money2.format(v)}`;
    },
    symbol,
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
