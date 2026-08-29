"use client";

import { createContext, useContext } from "react";
import { trWith, type AdminLang } from "@/lib/admin-i18n-dict";

/**
 * Translation for the handful of admin components that run in the browser.
 *
 * Server components call `await tr()`, which asks the database which language
 * is set. A client component cannot do that — and the alternative, passing a
 * translated string into every component as a prop, means the search box, the
 * archive dialog and the image field each grow a dozen props that exist only
 * to carry words.
 *
 * So the language — one short string — crosses the boundary once, in the
 * layout, and the components translate themselves from the dictionary.
 */

const LangContext = createContext<AdminLang>("en");

export function AdminLangProvider({
  lang,
  children,
}: {
  lang: AdminLang;
  children: React.ReactNode;
}) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

/** Same signature as the server-side `t` — `const t = useT();  t("Search")`. */
export function useT() {
  return trWith(useContext(LangContext));
}
