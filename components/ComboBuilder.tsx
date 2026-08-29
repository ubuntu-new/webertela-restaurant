"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart";
import { useLang } from "@/lib/i18n";
import { resolveRef, comboName, comboDesc } from "@/lib/data";

export default function ComboBuilder() {
  const { comboItem, closeCombo, addConfigured, showToast } = useCart();
  const { lang, t, f } = useLang();

  const [choices, setChoices] = useState<string[]>([]);

  useEffect(() => {
    if (comboItem) {
      setChoices(comboItem.slots.map((s) => s.options[0] ?? ""));
    }
  }, [comboItem]);

  if (!comboItem) return null;

  const baseSum = choices.reduce((s, ref) => s + (resolveRef(ref, lang)?.price ?? 0), 0);
  let price = baseSum;
  if (comboItem.pricing.mode === "fixed") price = comboItem.pricing.price ?? baseSum;
  else if (comboItem.pricing.mode === "discount")
    price = baseSum * (1 - (comboItem.pricing.percent ?? 0) / 100);
  price = Math.round(price * 100) / 100;
  const saved = Math.round((baseSum - price) * 100) / 100;

  const setChoice = (slotIdx: number, ref: string) =>
    setChoices((prev) => prev.map((c, i) => (i === slotIdx ? ref : c)));

  const commit = () => {
    const key = `combo:${comboItem.id}|${choices.join(",")}`;
    const name = comboName(comboItem, lang);
    const detail = choices.map((r) => resolveRef(r, lang)?.name).filter(Boolean).join(" + ");
    addConfigured(key, name, price, detail);
    showToast(t("added_to_order").replace("{name}", name));
    closeCombo();
  };

  const onBackdrop = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains("modal-backdrop")) closeCombo();
  };

  return (
    <div className="modal-backdrop" onClick={onBackdrop} style={{ position: "fixed" }} data-combo-backdrop>
      <div className="modal-outer">
        <button className="popup-close" onClick={closeCombo} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div className="modal">
          <div className="modal-header">
            <div className="modal-title-block">
              <div className="modal-pizza-name">{comboName(comboItem, lang)}</div>
              <div className="modal-pizza-desc">{comboDesc(comboItem, lang)}</div>
            </div>
          </div>

          <div className="combo-body">
            {comboItem.slots.map((slot, i) => {
              const label = lang === "ka" ? slot.label_ka : slot.label;
              if (slot.mode === "fixed") {
                const r = resolveRef(slot.options[0], lang);
                return (
                  <div className="combo-slot" key={i}>
                    <span className="combo-slot-label">{label}</span>
                    <div className="combo-fixed">
                      <div className="cf-thumb">
                        {r?.photo && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.photo} alt={r?.name ?? ""} loading="lazy" onError={(e) => e.currentTarget.remove()} />
                        )}
                      </div>
                      <span className="cf-name">{r?.name}</span>
                      <span className="cf-lock" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="11" width="18" height="11" rx="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      </span>
                    </div>
                  </div>
                );
              }
              return (
                <div className="combo-slot" key={i}>
                  <span className="combo-slot-label">{label}</span>
                  <select className="combo-select" value={choices[i] ?? ""} onChange={(e) => setChoice(i, e.target.value)}>
                    {slot.options.map((ref) => {
                      const r = resolveRef(ref, lang);
                      return (
                        <option key={ref} value={ref}>
                          {r ? `${r.name} — ${f.money(r.price)}` : ref}
                        </option>
                      );
                    })}
                  </select>
                </div>
              );
            })}

            {saved > 0 && (
              <div className="combo-note">
                <span className="co-was">{f.money(baseSum)}</span>
                <span className="co-now">{f.money(price)}</span>
                {" · "}
                {t("combo_you_save").replace("{n}", f.money(saved))}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button className="cta-primary" onClick={commit}>
              <span>{t("add_to_order")}</span>
              <span className="cta-price">{f.money(price)}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
