import type { Metadata, Viewport } from "next";
import "../globals.css";
import { LOCALES, DEFAULT_LOCALE, SITE_URL, isLocale } from "@/lib/locales";
import { brandOf } from "@/lib/brand";
import { NO_BRAND } from "@/lib/brand-shared";

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

/**
 * ⚠️ The title used to be written here, and it said "Ronny's Pizza — Fresh
 * pizza delivery in Tbilisi" for every tenant that ever ran this code.
 *
 * That is the single most visible thing on a page. It is the browser tab, the
 * Google result, the Facebook share card and the bookmark. A brand-new
 * restaurant in Monroe opened its own site and found somebody else's name in
 * the tab — with `og:site_name` and the description to match, promising pizza
 * delivery across Tbilisi and a 4.8★ rating it had never earned.
 *
 * The name now comes from the Organization row, which is the only place that
 * knows whose restaurant this is. The rest of the sentence is generic on
 * purpose: a claim about delivery times or ratings belongs to a business, and
 * this file does not know which business it is serving until it asks.
 */
const ogLocaleOf: Record<string, string> = { en: "en_US", ka: "ka_GE" };

const TAGLINE: Record<string, string> = {
  en: "Order online for delivery or pickup.",
  ka: "შეუკვეთე ონლაინ — მიტანით ან წაღებით.",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const l = isLocale(lang) ? lang : DEFAULT_LOCALE;

  /**
   * Asked, not assumed — and a failure here must not take the page down.
   *
   * If the database is unreachable the visitor should still get the menu page
   * (which has its own honest message about that). Losing the title is a
   * cosmetic loss; refusing to render because metadata could not be built is
   * not.
   */
  let b = NO_BRAND;
  try {
    b = await brandOf(l);
  } catch {
    /* no title rather than a wrong one */
  }

  /**
   * The restaurant's own words first.
   *
   * ⚠️ This line was a generic constant, and that cost Ronny's their search
   * result. Their title had been "Fresh pizza delivery in Tbilisi" — hand
   * written, with the two things anybody actually types into Google. Replacing
   * the hardcoded title was right, because it named their city on every other
   * tenant's site; replacing it with a sentence true of all restaurants and
   * useful to none was not.
   *
   * `seoLine` is theirs when they have written one. The fallback stays neutral
   * because a new restaurant has not told us anything yet, and inventing a city
   * or a promise is how this started.
   */
  const line = b.seoLine || TAGLINE[l] || TAGLINE.en;
  const name = b.name;

  const title = name ? `${name} — ${line}` : line;
  const description = b.seoDescription || (name ? `${name}. ${line}` : line);

  return {
    /**
     * ⚠️ `new URL("")` throws, so this has to be conditional.
     *
     * SITE_URL used to fall back to a hardcoded domain, which meant this line
     * could never fail — and also meant an unconfigured tenant published
     * canonical tags pointing at somebody else's restaurant. Removing the
     * fallback fixed that and moved the failure here, where an empty value
     * would have crashed every page instead of mislabelling it.
     *
     * Undefined is the correct answer: Next then emits relative canonicals,
     * which are valid and are right on whatever host is serving.
     */
    metadataBase: SITE_URL ? new URL(SITE_URL) : undefined,
    title,
    description,
    alternates: {
      canonical: `/${l}`,
      languages: { en: "/en", ka: "/ka", "x-default": `/${DEFAULT_LOCALE}` },
    },
    openGraph: {
      type: "website",
      // Undefined rather than a placeholder: an og:site_name naming the wrong
      // restaurant is worse than none, because it is what Facebook prints on
      // the card.
      siteName: name || undefined,
      title,
      description,
      url: `/${l}`,
      locale: ogLocaleOf[l] ?? "en_US",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export const viewport: Viewport = {
  themeColor: "#F1C338",
  width: "device-width",
  initialScale: 1,
};

export default async function LangLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const htmlLang = isLocale(lang) ? lang : DEFAULT_LOCALE;
  return (
    <html lang={htmlLang} data-skin="production">
      <body suppressHydrationWarning>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600;700&family=Noto+Sans+Georgian:wght@400;500;600;700&family=Noto+Serif:ital,wght@0,400;0,600;1,400;1,600&family=Noto+Serif+Georgian:wght@400;600;700&display=swap"
        />
        {children}
      </body>
    </html>
  );
}
