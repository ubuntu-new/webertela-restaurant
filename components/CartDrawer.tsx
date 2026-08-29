"use client";
import { useState } from "react";

import { useCart, type CartLine, type PizzaLine, type SimpleLine } from "@/lib/cart";
import { useLang } from "@/lib/i18n";
import {
  PIZZAS,
  PIZZA_PHOTOS,
  EXTRAS,
  SAUCES,
  DRINKS,
  SLICE_SVG,
  MIN_ORDER,
  FREE_DELIVERY,
  DELIVERY_FEE,
  pName,
  ingLabel,
  itemName,
  type Lang,
} from "@/lib/data";
import { SIZE_KEYS, CRUST_KEYS, SAUCE_KEYS } from "@/lib/pricing";

const SCOOTER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h7l4-8h-4M9 6h3l2 4"/></svg>`;
const FREE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l4 4 10-10"/><circle cx="12" cy="12" r="10" opacity=".25"/></svg>`;

function simpleDisplayName(l: SimpleLine, lang: Lang): string {
  for (const arr of [EXTRAS, SAUCES, DRINKS]) {
    const found = arr.find((x) => x.id === l.itemId);
    if (found) return itemName(found, lang);
  }
  return l.name;
}

/** მარტივი პოზიციის ფოტო — იმავე სიებიდან, საიდანაც სახელი. */
function simplePhoto(l: SimpleLine): string | undefined {
  for (const arr of [EXTRAS, SAUCES, DRINKS]) {
    const found = arr.find((x) => x.id === l.itemId);
    if (found?.photo) return found.photo;
  }
  return undefined;
}

/** კალათის ხატულა: ფოტო, ხოლო მისი არარსებობის/ჩავარდნის შემთხვევაში — ნაჭერი. */
function CartIcon({ photo }: { photo?: string }) {
  const [broken, setBroken] = useState(false);

  if (!photo || broken) {
    return <div className="ci-icon" dangerouslySetInnerHTML={{ __html: SLICE_SVG }} />;
  }
  return (
    <div className="ci-icon ci-icon-photo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo} alt="" onError={() => setBroken(true)} />
    </div>
  );
}

export default function CartDrawer() {
  const { lines, subtotal, cartOpen, closeCart, setQty, openCustomizer, openHH, openCheckout } = useCart();
  const { lang, t, f } = useLang();

  if (!cartOpen) return null;

  const grand = subtotal >= MIN_ORDER && subtotal < FREE_DELIVERY ? subtotal + DELIVERY_FEE : subtotal;

  // min-order bar state
  let barCls = "min-order-bar";
  let icon = SCOOTER;
  let label = "";
  let subCls = "mob-sub";
  let subHtml = "";
  let fillPct = "0%";
  let fillCls = "min-fill";

  if (subtotal >= FREE_DELIVERY) {
    barCls = "min-order-bar free";
    icon = FREE_ICON;
    label = t("free_delivery_earned");
    subCls = "mob-sub free";
    subHtml = t("no_charge_this_order");
    fillPct = "100%";
    fillCls = "min-fill free";
  } else if (subtotal >= MIN_ORDER) {
    const pct = ((subtotal - MIN_ORDER) / (FREE_DELIVERY - MIN_ORDER)) * 100;
    const need = FREE_DELIVERY - subtotal;
    barCls = "min-order-bar ok";
    label = t("good_to_go_fee").replace("{amount}", f.money(DELIVERY_FEE));
    subCls = "mob-sub free-near";
    subHtml = t("add_more_free_delivery").replace("{n}", `<strong>${f.money(need)}</strong>`);
    fillPct = pct.toFixed(1) + "%";
    fillCls = "min-fill ok";
  } else {
    const pct = (subtotal / MIN_ORDER) * 100;
    const need = MIN_ORDER - subtotal;
    label = subtotal > 0 ? t("away_from_delivery").replace("{n}", f.money(need)) : t("cart_no_items");
    subHtml = t("cart_min_hint").replace("{amount}", f.money(MIN_ORDER));
    fillPct = pct.toFixed(1) + "%";
  }

  const showSummary = subtotal >= MIN_ORDER;

  const renderMods = (l: PizzaLine) => {
    const rows: React.ReactNode[] = [];
    const struct: string[] = [];
    if (l.crustIdx !== 0) struct.push(t(CRUST_KEYS[l.crustIdx]) + " " + t("crust_suffix"));
    if (l.sauceIdx !== 2) struct.push(t(SAUCE_KEYS[l.sauceIdx]) + " " + t("sauce_suffix"));
    if (struct.length) rows.push(<div key="s" className="ci-mod">{struct.join(" · ")}</div>);
    l.added.forEach((a, i) => {
      const prefix = a.qty === 2 ? "2× " : "+ ";
      const zSuffix = a.zone === "left" ? " (L)" : a.zone === "right" ? " (R)" : "";
      rows.push(<div key={"a" + i} className="ci-mod">{prefix}{ingLabel(a.name, lang)}{zSuffix}</div>);
    });
    l.removedList.forEach((n, i) => {
      rows.push(<div key={"r" + i} className="ci-mod ci-removed">− {ingLabel(n, lang)}</div>);
    });
    return rows.length ? <div className="ci-mods">{rows}</div> : null;
  };

  const renderLine = (l: CartLine, idx: number) => {
    if (l.kind === "hh") {
      const L = PIZZAS.find((p) => p.id === l.leftId);
      const R = PIZZAS.find((p) => p.id === l.rightId);
      const nm = `${L ? pName(L, lang) : "?"} / ${R ? pName(R, lang) : "?"}`;
      const struct: string[] = [];
      if (l.crustIdx !== 0) struct.push(t(CRUST_KEYS[l.crustIdx]) + " " + t("crust_suffix"));
      if (l.sauceIdx !== 2) struct.push(t(SAUCE_KEYS[l.sauceIdx]) + " " + t("sauce_suffix"));
      const addRows = (l.added || []).map((a, i) => {
        const prefix = a.qty === 2 ? "2× " : "+ ";
        const sfx = a.zone === "left" ? " (L)" : a.zone === "right" ? " (R)" : "";
        return <div key={"ha" + i} className="ci-mod">{prefix}{ingLabel(a.name, lang)}{sfx}</div>;
      });
      return (
        <div className="cart-item" key={idx}>
          <CartIcon photo={PIZZA_PHOTOS[l.leftId] || PIZZA_PHOTOS[l.rightId]} />
          <div className="ci-info">
            <div className="ci-line1">{t("hh_title")} · {nm} · {t(SIZE_KEYS[l.sizeIdx])}</div>
            {(struct.length > 0 || addRows.length > 0) && (
              <div className="ci-mods">
                {struct.length > 0 && <div className="ci-mod">{struct.join(" · ")}</div>}
                {addRows}
              </div>
            )}
            <button className="ci-edit-btn" onClick={() => openHH(l.leftId, l.rightId, idx)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              {t("edit")}
            </button>
          </div>
          <div className="ci-right">
            <div className="ci-price">{f.money(l.price * l.qty)}</div>
            <div className="ci-qty">
              <button className="qty-btn" onClick={() => setQty(idx, -1)}>−</button>
              <span className="qty-num">{l.qty}</span>
              <button className="qty-btn" onClick={() => setQty(idx, 1)}>+</button>
            </div>
          </div>
        </div>
      );
    }
    if (l.kind === "simple") {
      return (
        <div className="cart-item" key={idx}>
          <CartIcon photo={simplePhoto(l)} />
          <div className="ci-info">
            <div className="ci-line1">{simpleDisplayName(l, lang)}</div>
            {l.detail && <div className="ci-detail">{l.detail}</div>}
          </div>
          <div className="ci-right">
            <div className="ci-price">{f.money(l.price * l.qty)}</div>
            <div className="ci-qty">
              <button className="qty-btn" onClick={() => setQty(idx, -1)}>−</button>
              <span className="qty-num">{l.qty}</span>
              <button className="qty-btn" onClick={() => setQty(idx, 1)}>+</button>
            </div>
          </div>
        </div>
      );
    }
    const pizza = PIZZAS.find((p) => p.id === l.pizzaId);
    const name = pizza ? pName(pizza, lang) : "Pizza";
    const sizeLabel = t(SIZE_KEYS[l.sizeIdx]);
    return (
      <div className="cart-item" key={idx}>
        <CartIcon photo={pizza ? PIZZA_PHOTOS[pizza.id] : undefined} />
        <div className="ci-info">
          <div className="ci-line1">{name} · {sizeLabel}</div>
          {renderMods(l)}
          {pizza && (
            <button className="ci-edit-btn" onClick={() => openCustomizer(pizza, idx)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              {t("edit")}
            </button>
          )}
        </div>
        <div className="ci-right">
          <div className="ci-price">{f.money(l.price * l.qty)}</div>
          <div className="ci-qty">
            <button className="qty-btn" onClick={() => setQty(idx, -1)}>−</button>
            <span className="qty-num">{l.qty}</span>
            <button className="qty-btn" onClick={() => setQty(idx, 1)}>+</button>
          </div>
        </div>
      </div>
    );
  };

  const onOverlay = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains("cart-overlay")) closeCart();
  };

  return (
    <div className="cart-overlay" onClick={onOverlay} style={{ position: "fixed" }}>
      <div className="cart-panel-wrap">
        <button className="cart-close-float" onClick={closeCart} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div className="cart-panel">
          <div className="cart-scroll">
            <div className="ci-push" />
            <div className="cart-sticky-head">
              <div className={barCls}>
                <div className="mob-icon brand-icon" style={{ width: 22, height: 22 }} dangerouslySetInnerHTML={{ __html: icon }} />
                <div className="mob-body">
                  <div className="mob-label">{label}</div>
                  <div className={subCls} dangerouslySetInnerHTML={{ __html: subHtml }} />
                  <div className="min-track">
                    <div className={fillCls} style={{ width: fillPct }} />
                  </div>
                </div>
              </div>
              <div className="cart-header">
                <h3>{t("your_order")}</h3>
              </div>
            </div>
            <div className="cart-items">
              {lines.length === 0 ? (
                <div className="empty-cart">
                  <span className="slice-fallback" aria-hidden="true" dangerouslySetInnerHTML={{ __html: SLICE_SVG }} />
                  <p>
                    {t("cart_empty")}
                    <br />
                    <strong>{t("pick_pizza_start")}</strong>
                  </p>
                </div>
              ) : (
                lines.map(renderLine)
              )}
            </div>
          </div>
          <div className="cart-footer">
            {showSummary && (
              <div className="order-summary">
                <div className="summary-row">
                  <span className="sr-label">{t("subtotal")}</span>
                  <span className="sr-value">{f.money(subtotal)}</span>
                </div>
                <div className={`summary-row ${subtotal >= FREE_DELIVERY ? "sr-free" : "sr-delivery"}`}>
                  <span className="sr-label">{subtotal >= FREE_DELIVERY ? t("delivery") : t("delivery_fee")}</span>
                  <span className="sr-value">{subtotal >= FREE_DELIVERY ? t("free") + " 🎉" : f.money(DELIVERY_FEE)}</span>
                </div>
              </div>
            )}
            <button className="checkout-btn" disabled={subtotal < MIN_ORDER} onClick={openCheckout}>
              <span className="co-total">{f.money(grand)}</span>
              <span className="co-label">
                {t("go_to_checkout")}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
