"use client";

import { useLang } from "@/lib/i18n";
import { MIN_ORDER } from "@/lib/data";

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function TrustBar() {
  const { t, f } = useLang();
  return (
    <div className="trust-bar">
      <div className="trust-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="t-lbl">{t("delivery")}</span>
        <strong>30–45 min</strong>
      </div>
      <div className="trust-sep" />
      <div className="trust-item">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <span>
          4.8 <span className="trust-rating-lbl">{t("rating")}</span>
        </span>
      </div>
      <div className="trust-sep" />
      <div className="trust-item">
        <span className="t-lbl t-lbl-min">{t("min_order")}</span>
        <strong>{f.money(MIN_ORDER)}</strong>
      </div>
      <div className="trust-sep" />
      <button
        className="trust-item green trust-item-link"
        type="button"
        aria-label="Jump to Find us"
        onClick={() => scrollToId("section-find-us")}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span className="trust-locations-short">{t("locations_short")}</span>
        <span className="trust-locations-long">{t("locations")}</span>
      </button>
    </div>
  );
}
