// {en,ka} Json ველების და Decimal-ის დამხმარეები (admin-ისთვის)

export interface I18n {
  en: string;
  ka: string;
}

/** Prisma Json → {en,ka}, ნებისმიერი ფორმისგან დაცულად. */
export function i18nOf(v: unknown): I18n {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return { en: String(o.en ?? ""), ka: String(o.ka ?? o.en ?? "") };
  }
  return { en: "", ka: "" };
}

/**
 * A record's own name, in the reader's language.
 *
 * The default was "ka", from when there was one customer and she was Georgian.
 * On an English instance that put Georgian product names on an English screen —
 * the advice panel announced that "ჩიზქეიქი sells at 17.3% margin". English is
 * the source language everywhere else in this codebase; it is the default here
 * too, and a Georgian instance still reads Georgian because the record carries
 * both and the caller passes the language when it knows it.
 */
export function i18nText(v: unknown, lang: "en" | "ka" = "en"): string {
  const t = i18nOf(v);
  return lang === "ka" ? t.ka || t.en : t.en || t.ka;
}

/** Decimal | number | null → number (UI-სთვის). */
export function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return Number(v);
}

export function money(v: unknown): string {
  return num(v).toFixed(2);
}

/** FormData-დან number, ცარიელი → null. */
export function fdNum(fd: FormData, key: string): number | null {
  const raw = String(fd.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function fdStr(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export function fdBool(fd: FormData, key: string): boolean {
  return fd.get(key) === "on" || fd.get(key) === "true";
}
