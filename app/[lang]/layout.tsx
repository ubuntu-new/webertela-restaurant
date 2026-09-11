import type { Metadata, Viewport } from "next";
import "../globals.css";
import { LOCALES, DEFAULT_LOCALE, SITE_URL, isLocale } from "@/lib/locales";

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

const META: Record<string, { title: string; description: string; ogLocale: string }> = {
  en: {
    title: "Ronny's Pizza — Fresh pizza delivery in Tbilisi",
    description:
      "Order fresh, hand-built pizza for delivery across Tbilisi. 13 pizzas, a half-and-half builder, custom toppings and combo deals. 30–45 min, 4.8★ rated.",
    ogLocale: "en_US",
  },
  ka: {
    title: "Ronny's Pizza — ახალი პიცის მიტანა თბილისში",
    description:
      "შეუკვეთე ახალი, ხელით ნაკეთები პიცა თბილისში მიტანით. 13 პიცა, ნახევარ-ნახევრის კონსტრუქტორი, ტოპინგები და კომბო აქციები. 30–45 წთ, 4.8★.",
    ogLocale: "ka_GE",
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const l = isLocale(lang) ? lang : DEFAULT_LOCALE;
  const m = META[l];
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
    title: m.title,
    description: m.description,
    alternates: {
      canonical: `/${l}`,
      languages: { en: "/en", ka: "/ka", "x-default": `/${DEFAULT_LOCALE}` },
    },
    openGraph: {
      type: "website",
      siteName: "Ronny's Pizza",
      title: m.title,
      description: m.description,
      url: `/${l}`,
      locale: m.ogLocale,
    },
    twitter: { card: "summary_large_image", title: m.title, description: m.description },
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
