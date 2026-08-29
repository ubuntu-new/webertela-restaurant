"use client";

import { useLang } from "@/lib/i18n";
import { useCart } from "@/lib/cart";
import { SINGLE_LOCALE } from "@/lib/locales";

export default function Header() {
  const { lang, setLang, t } = useLang();
  const { openCart, count } = useCart();

  return (
    <header className="site-header">
      <div className="header-inner">
        <div className="header-brand">
          <div className="header-logo">Ronny&apos;s</div>
          <div className="header-motto">{t("motto")}</div>
        </div>
        <div className="header-actions">
          {/* A restaurant that offers one language has nothing to switch to;
              the control is then a question the customer cannot answer. */}
          {!SINGLE_LOCALE && (
          <div className="lang-toggle" role="group" aria-label="Language">
            <button
              className={`lang-btn${lang === "en" ? " active" : ""}`}
              aria-label="English"
              onClick={() => setLang(lang === "en" ? "ka" : "en")}
            >
              <span className="lang-short">ENG</span>
              <span className="lang-long">English</span>
            </button>
            <button
              className={`lang-btn${lang === "ka" ? " active" : ""}`}
              aria-label="ქართული"
              onClick={() => setLang(lang === "ka" ? "en" : "ka")}
            >
              <span className="lang-short">ქარ</span>
              <span className="lang-long">ქართული</span>
            </button>
          </div>
          )}
          <button className="cart-btn" aria-label={t("your_order")} onClick={openCart}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 01-8 0" />
            </svg>
            <div className="cart-count" data-empty={count === 0 ? "true" : "false"}>
              {count}
            </div>
          </button>
        </div>
      </div>
    </header>
  );
}
