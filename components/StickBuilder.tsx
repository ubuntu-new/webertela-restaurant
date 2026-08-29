"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart";
import { useLang } from "@/lib/i18n";
import { SAUCES, itemName, itemDesc } from "@/lib/data";

const DIP_IDS = ["ranch", "marinara", "spicy"];
const EXTRA_MOZZ_PRICE = 2.0; // add-on price (not defined in v12 data — adjust if needed)

export default function StickBuilder() {
  const { stickItem, closeStick, addConfigured, showToast } = useCart();
  const { lang, t, f } = useLang();

  const [dips, setDips] = useState<string[]>([]);
  const [mozz, setMozz] = useState(false);
  const [icing, setIcing] = useState(false);

  useEffect(() => {
    if (stickItem) {
      setDips([]);
      setMozz(false);
      setIcing(false);
    }
  }, [stickItem]);

  if (!stickItem) return null;

  const isCinnamon = stickItem.builder === "cinsticks";
  const dipItems = SAUCES.filter((s) => DIP_IDS.includes(s.id));
  const icingItem = SAUCES.find((s) => s.id === "icing");
  const icingPrice = icingItem?.price ?? 1.8;

  const dipTotal = dips.reduce((s, id) => s + (SAUCES.find((x) => x.id === id)?.price ?? 0), 0);
  const total =
    stickItem.price + dipTotal + (mozz ? EXTRA_MOZZ_PRICE : 0) + (icing ? icingPrice : 0);

  const toggleDip = (id: string) =>
    setDips((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const commit = () => {
    const addons: string[] = [];
    dips.forEach((id) => {
      const it = SAUCES.find((x) => x.id === id);
      if (it) addons.push(itemName(it, lang));
    });
    if (mozz) addons.push(t("stick_extra_mozz"));
    if (icing) addons.push(t("stick_extra_icing"));

    const key =
      stickItem.id +
      "|" +
      [...dips].sort().join(",") +
      (mozz ? "+mozz" : "") +
      (icing ? "+icing" : "");
    const name = itemName(stickItem, lang);
    addConfigured(key, name, Math.round(total * 100) / 100, addons.join(", "));
    showToast(t("added_to_order").replace("{name}", name));
    closeStick();
  };

  const onBackdrop = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains("modal-backdrop")) closeStick();
  };

  return (
    <div className="modal-backdrop" onClick={onBackdrop} style={{ position: "fixed" }} data-sticks-backdrop>
      <div className="modal-outer">
        <button className="popup-close" onClick={closeStick} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div className="modal">
          <div className="modal-header">
            <div className="modal-title-block">
              <div className="modal-pizza-name">{itemName(stickItem, lang)}</div>
            </div>
          </div>

          <div className="stick-body">
            <div className="stick-hero">
              <div className="stick-hero-img">
                {stickItem.photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={stickItem.photo} alt={itemName(stickItem, lang)} loading="lazy" onError={(e) => e.currentTarget.remove()} />
                )}
              </div>
              <div className="stick-hero-desc">{itemDesc(stickItem, lang)}</div>
            </div>

            {isCinnamon ? (
              <div className="stick-group">
                <span className="stick-group-label">{t("stick_add_ons")}</span>
                <button className={`stick-toggle${icing ? " active" : ""}`} onClick={() => setIcing((v) => !v)}>
                  <span className="stick-toggle-txt">
                    <span className="stick-toggle-name">{t("stick_extra_icing")}</span>
                    <span className="stick-toggle-price">+{f.money(icingPrice)}</span>
                  </span>
                  <span className="stick-switch" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <>
                <div className="stick-group">
                  <span className="stick-group-label">{t("stick_add_dips")}</span>
                  <span className="stick-group-hint">{t("stick_dips_hint")}</span>
                  <div className="dip-grid">
                    {dipItems.map((d) => {
                      const sel = dips.includes(d.id);
                      return (
                        <button key={d.id} className={`dip-card${sel ? " selected" : ""}`} onClick={() => toggleDip(d.id)}>
                          <div className="dip-thumb">
                            {d.photo && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={d.photo} alt={itemName(d, lang)} loading="lazy" onError={(e) => e.currentTarget.remove()} />
                            )}
                          </div>
                          <div className="dip-info">
                            <div className="dip-name">{itemName(d, lang)}</div>
                            <div className="dip-price">+{f.money(d.price)}</div>
                          </div>
                          {sel && <div className="dip-check">✓</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="stick-group">
                  <span className="stick-group-label">{t("stick_add_ons")}</span>
                  <button className={`stick-toggle${mozz ? " active" : ""}`} onClick={() => setMozz((v) => !v)}>
                    <span className="stick-toggle-txt">
                      <span className="stick-toggle-name">{t("stick_extra_mozz")}</span>
                      <span className="stick-toggle-price">+{f.money(EXTRA_MOZZ_PRICE)}</span>
                    </span>
                    <span className="stick-switch" aria-hidden="true" />
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="modal-footer">
            <button className="cta-primary" onClick={commit}>
              <span>{t("add_to_order")}</span>
              <span className="cta-price">{f.money(total)}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
