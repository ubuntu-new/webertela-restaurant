"use client";

import { useLang } from "@/lib/i18n";
import { MIN_ORDER, LOCATIONS } from "@/lib/data";

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function TrustBar() {
  const { t, f, brand } = useLang();

  /**
   * ⚠️ Two of the four items here were claims, not features.
   *
   *   <strong>30–45 min</strong>   a delivery promise
   *   4.8 rating                    a rating
   *
   * Both were written into the markup, so every restaurant that ever ran this
   * code displayed them on its own front page. A pizzeria that opened this
   * morning told its first customer it was rated 4.8 and would be there in
   * forty-five minutes. Nobody had rated it, and nobody in that kitchen had
   * agreed to forty-five minutes.
   *
   * They come from `Setting: org` now, and an unset value hides the item
   * entirely. There is no sensible default for either: an invented rating is a
   * claim about other people's opinions, and an invented delivery time is a
   * promise made on the kitchen's behalf.
   */
  const count = LOCATIONS.length;
  const locations =
    count === 1 ? t("locations_one") : t("locations").replace("{n}", String(count));
  const locationsShort =
    count === 1 ? t("locations_one") : t("locations_short").replace("{n}", String(count));

  return (
    <div className="trust-bar">
      {brand.deliveryTime && (
        <>
          <div className="trust-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span className="t-lbl">{t("delivery")}</span>
            <strong>{brand.deliveryTime}</strong>
          </div>
          <div className="trust-sep" />
        </>
      )}
      {brand.rating && (
        <>
          <div className="trust-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            <span>
              {brand.rating} <span className="trust-rating-lbl">{t("rating")}</span>
            </span>
          </div>
          <div className="trust-sep" />
        </>
      )}
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
        <span className="trust-locations-short">{locationsShort}</span>
        <span className="trust-locations-long">{locations}</span>
      </button>
    </div>
  );
}
