"use client";

import { useEffect, useState } from "react";
import { useCart, type AddedTopping } from "@/lib/cart";
import { useLang } from "@/lib/i18n";
import {
  TOPPINGS,
  TOPPING_PHOTOS,
  SLICE_SVG,
  pName,
  pTagline,
  tDisp,
  ingLabel,
  MAX_TOPPINGS,
  type Topping,
} from "@/lib/data";
import {
  type Zone,
  type ToppingsState,
  SAUCE_KEYS,
  SAUCE_FWD,
  CRUST_KEYS,
  SIZE_KEYS,
  SIZE_CM,
  normDefEntry,
  userQtyForZone,
  userAddedSlots,
  pizzaTotal,
  seedToppings,
} from "@/lib/pricing";

const ZONE_BADGE: Record<Zone, { cls: string; check: string; label2x: string }> = {
  whole: { cls: "", check: "✓", label2x: "2×" },
  left: { cls: " zone-left", check: "L", label2x: "2L" },
  right: { cls: " zone-right", check: "R", label2x: "2R" },
};

const CATS: { cat: string; key: string }[] = [
  { cat: "all", key: "filter_all" },
  { cat: "cheese", key: "filter_cheese" },
  { cat: "veg", key: "filter_veggie" },
  { cat: "protein", key: "filter_protein" },
  { cat: "heat", key: "filter_heat" },
];

const Slice = () => <span className="t-emoji" dangerouslySetInnerHTML={{ __html: SLICE_SVG }} />;

export default function Customizer() {
  const { customizerPizza, editingIdx, lines, commitPizza, closeCustomizer, showToast } = useCart();
  const { lang, t, f } = useLang();

  const [sizeIdx, setSizeIdx] = useState(1);
  const [crustIdx, setCrustIdx] = useState(0);
  const [sauceIdx, setSauceIdx] = useState(2);
  const [zone, setZone] = useState<Zone>("whole");
  const [cat, setCat] = useState("all");
  const [toppings, setToppings] = useState<ToppingsState>({});
  const [removed, setRemoved] = useState<Record<string, boolean>>({});

  const pizza = customizerPizza;

  // Seed state whenever a pizza is opened (fresh or from an edited cart line).
  useEffect(() => {
    if (!pizza) return;
    if (editingIdx !== null && lines[editingIdx]?.kind === "pizza") {
      const l = lines[editingIdx];
      if (l.kind === "pizza") {
        setSizeIdx(l.sizeIdx);
        setCrustIdx(l.crustIdx);
        setSauceIdx(l.sauceIdx);
        setToppings(JSON.parse(JSON.stringify(l.toppings)));
        setRemoved(JSON.parse(JSON.stringify(l.removed)));
      }
    } else {
      setSizeIdx(1);
      setCrustIdx(0);
      setSauceIdx(2);
      setToppings(seedToppings(pizza));
      setRemoved({});
    }
    setZone("whole");
    setCat("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pizza, editingIdx]);

  if (!pizza) return null;

  const defaults = pizza.defaultExtras || {};
  const slots = userAddedSlots(toppings, defaults);
  const limitReached = slots >= MAX_TOPPINGS;
  const total = pizzaTotal(pizza, sizeIdx, toppings, removed);

  // ── handlers ──
  const cycleTopping = (top: Topping) => {
    const defForZone = normDefEntry(defaults[top.name])[zone] || 0;
    const storedQty = toppings[top.name]?.[zone] || 0;
    const userQty = Math.max(0, storedQty - defForZone);
    if (userQty === 0 && slots >= MAX_TOPPINGS) return; // gate new adds at limit
    let newUser: number;
    if (userQty === 0) newUser = 1;
    else if (userQty === 1) newUser = slots >= MAX_TOPPINGS ? 0 : 2;
    else newUser = 0;
    setToppings((prev) => {
      const next = { ...prev };
      const entry = { ...(next[top.name] || { whole: 0, left: 0, right: 0 }) };
      entry[zone] = defForZone + newUser;
      if (!entry.whole && !entry.left && !entry.right) delete next[top.name];
      else next[top.name] = entry;
      return next;
    });
  };

  const toggleRemoved = (name: string) => {
    setRemoved((prev) => {
      const next = { ...prev };
      if (next[name]) delete next[name];
      else next[name] = true;
      return next;
    });
  };

  const toggleExtraChip = (name: string, z: Zone) => {
    const defQty = normDefEntry(defaults[name])[z] || 0;
    setToppings((prev) => {
      const next = { ...prev };
      const entry = { ...(next[name] || { whole: 0, left: 0, right: 0 }) };
      const cur = entry[z] || 0;
      entry[z] = cur < defQty ? defQty : 0;
      next[name] = entry;
      return next;
    });
  };

  const removeAddedPill = (name: string) => {
    const defE = normDefEntry(defaults[name]);
    setToppings((prev) => {
      const next = { ...prev };
      if (defE.whole || defE.left || defE.right) next[name] = { ...defE };
      else delete next[name];
      return next;
    });
  };

  const stepSauce = (dir: number, isStep: boolean) => {
    setSauceIdx((cur) => {
      if (isStep) return Math.max(0, Math.min(3, cur + dir));
      const i = SAUCE_FWD.indexOf(cur);
      return SAUCE_FWD[(i + dir + 4) % 4];
    });
  };

  const commit = () => {
    // recompute added/removed display lists from snapshot
    const added: AddedTopping[] = [];
    Object.entries(toppings).forEach(([name, e]) => {
      (["whole", "left", "right"] as Zone[]).forEach((z) => {
        const qty = e[z] || 0;
        if (qty) added.push({ name, qty, zone: z });
      });
    });
    commitPizza(
      {
        pizzaId: pizza.id,
        sizeIdx,
        crustIdx,
        sauceIdx,
        toppings: JSON.parse(JSON.stringify(toppings)),
        removed: JSON.parse(JSON.stringify(removed)),
        added,
        removedList: Object.keys(removed),
        price: total,
      },
      editingIdx,
    );
    showToast(
      (editingIdx !== null ? t("updated") : t("added_to_order")).replace("{name}", pName(pizza, lang)),
    );
    closeCustomizer();
  };

  // ── shared render pieces ──
  const configBlocks = (
    <>
      <div className="config-block" style={{ paddingTop: 0 }}>
        <span className="config-label">{t("pick_size")}</span>
        <div className="segment full">
          {[0, 1, 2].map((i) => (
            <button key={i} className={sizeIdx === i ? "active" : ""} onClick={() => setSizeIdx(i)}>
              <span>{t(SIZE_KEYS[i])}</span>
              <span className="s-sub">{SIZE_CM[i]}</span>
              <span className="s-price">{f.money(pizza.sizes[i])}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="config-block">
        <span className="config-label">{t("choose_crust")}</span>
        <div className="segment full">
          {[0, 1].map((i) => (
            <button key={i} className={crustIdx === i ? "active" : ""} onClick={() => setCrustIdx(i)}>
              {t(CRUST_KEYS[i])}
            </button>
          ))}
        </div>
      </div>
      <div className="config-block" style={{ marginBottom: 0 }}>
        <span className="config-label">{t("how_much_sauce")}</span>
        <div className="sauce-cycler">
          <div className={`sauce-stepper${sauceIdx !== 2 ? " is-changed" : ""}`}>
            <button className="ss-step ss-step-l" onClick={() => stepSauce(-1, true)} aria-label="Less sauce">−</button>
            <span className="ss-label" onClick={() => stepSauce(1, false)}>{t(SAUCE_KEYS[sauceIdx])}</span>
            <button className="ss-step ss-step-r" onClick={() => stepSauce(1, true)} aria-label="More sauce">+</button>
          </div>
          <div className="sauce-track">
            {[0, 1, 2, 3].map((i) => (
              <button key={i} className={`sauce-dot${sauceIdx === i ? " active" : ""}`} onClick={() => setSauceIdx(i)} aria-label={t(SAUCE_KEYS[i])} />
            ))}
          </div>
        </div>
      </div>
    </>
  );

  const buildModsPills = (() => {
    const pills: { text: string; undo: () => void }[] = [];
    if (crustIdx !== 0) pills.push({ text: `${t(CRUST_KEYS[crustIdx])} ${t("crust_suffix")}`, undo: () => setCrustIdx(0) });
    if (sauceIdx !== 2) pills.push({ text: `${t(SAUCE_KEYS[sauceIdx])} ${t("sauce_suffix")}`, undo: () => setSauceIdx(2) });
    return pills;
  })();

  const buildModsRow = buildModsPills.length > 0 && (
    <div className="build-mods">
      {buildModsPills.map((p, i) => (
        <button key={i} className="build-pill modified" onClick={p.undo}>
          {p.text}
          <span className="pill-x" aria-hidden="true">×</span>
        </button>
      ))}
    </div>
  );

  const whatsOnItInner = (
    <>
      <span className="wit-label">{t("whats_on_it")}</span>
      <div className="ing-chips">
        {/* included ingredients (defaultExtras render as "Extra X") */}
        {pizza.ings.map((name) => {
          const defE = normDefEntry(defaults[name]);
          const hasDefault = defE.whole || defE.left || defE.right;
          if (hasDefault) {
            const z: Zone = defE.whole > 0 ? "whole" : defE.left > 0 ? "left" : "right";
            const defQty = defE[z];
            const curQty = toppings[name]?.[z] || 0;
            const isRemoved = curQty < defQty;
            const zSuffix = z === "left" ? " (L)" : z === "right" ? " (R)" : "";
            return (
              <div key={"ex-" + name} className={`ing-chip${isRemoved ? " removed" : ""}`} onClick={() => toggleExtraChip(name, z)}>
                Extra {ingLabel(name, lang)}{zSuffix}
                <span className="ic-btn">{isRemoved ? "↩" : "×"}</span>
              </div>
            );
          }
          const isRemoved = !!removed[name];
          return (
            <div key={name} className={`ing-chip${isRemoved ? " removed" : ""}`} onClick={() => toggleRemoved(name)}>
              {ingLabel(name, lang)}
              <span className="ic-btn">{isRemoved ? "↩" : "×"}</span>
            </div>
          );
        })}
        {/* user-added pills (above default) */}
        {Object.entries(toppings).flatMap(([name, e]) =>
          (["whole", "left", "right"] as Zone[]).flatMap((z) => {
            const above = (e[z] || 0) - (normDefEntry(defaults[name])[z] || 0);
            if (above <= 0) return [];
            const zSuffix = z === "left" ? " (L)" : z === "right" ? " (R)" : "";
            return [
              <button key={`add-${name}-${z}`} className="build-pill added" onClick={() => removeAddedPill(name)}>
                {(above === 2 ? "2× " : "+ ") + ingLabel(name, lang) + zSuffix}
                <span className="pill-x" aria-hidden="true">×</span>
              </button>,
            ];
          }),
        )}
        {slots >= 4 && (
          <span className={`pill-slot-count${limitReached ? " at-limit" : ""}`}>
            {slots}/{MAX_TOPPINGS}
          </span>
        )}
      </div>
    </>
  );

  const zoneRow = (
    <div className="zone-row">
      <span className="zone-lbl">{t("make_it_yours")}</span>
      <div className="segment">
        {(["whole", "left", "right"] as Zone[]).map((z) => (
          <button key={z} className={zone === z ? "active" : ""} data-zone={z} onClick={() => setZone(z)}>
            {t("zone_" + z)}
          </button>
        ))}
      </div>
    </div>
  );

  const catFilter = (
    <div className="cat-filter">
      {CATS.map((c) => (
        <button key={c.cat} className={`cf-pill${cat === c.cat ? " active" : ""}`} onClick={() => setCat(c.cat)}>
          {t(c.key)}
        </button>
      ))}
    </div>
  );

  const visibleToppings = TOPPINGS.filter((tp) => {
    if (tp.recipeOnly) return false;
    if (cat === "all") return true;
    return tp.dots.includes(cat);
  });

  const toppingGrid = (
    <div className="topping-grid">
      {visibleToppings.map((tp) => {
        const qty = userQtyForZone(toppings, defaults, tp.name, zone);
        const zb = ZONE_BADGE[zone];
        const limitCls = limitReached && qty === 0 ? " at-limit" : "";
        const cardCls = qty === 2 ? `sel2${zb.cls}` : qty === 1 ? `sel${zb.cls}` : "";
        const isHalf = zone === "left" || zone === "right";
        const price = tp.ps[sizeIdx] * (isHalf ? 0.5 : 1);
        let hint = "";
        if (qty === 1) hint = limitReached ? t("tap_to_remove") : t("tap_for_2x");
        else if (qty === 2) hint = t("tap_to_remove");
        const photo = TOPPING_PHOTOS[tp.name];
        return (
          <div key={tp.name} className={`topping-card ${cardCls}${limitCls}`} onClick={() => cycleTopping(tp)}>
            <div className="t-img">
              <Slice />
              {photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt={tp.name} loading="lazy" onError={(e) => e.currentTarget.remove()} />
              )}
              {qty === 2 ? (
                <div className={`badge-2x${zb.cls}`}>{zb.label2x}</div>
              ) : qty === 1 ? (
                <div className={`t-check${zb.cls}`}>{zb.check}</div>
              ) : null}
              <div className="d-dots">
                {tp.dots.map((d) => (
                  <div key={d} className={`d-dot ${d}`} />
                ))}
              </div>
            </div>
            <div className="t-name">{tDisp(tp, lang)}</div>
            <div className="t-price-row">
              <span className="t-price">
                +{f.money(price)}{isHalf ? " (½)" : ""}
              </span>
              {hint && <div className="t-hint" aria-hidden="true">{hint}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );

  const cta = (
    <button className="cta-primary" onClick={commit}>
      <span>{t("add_to_order")}</span>
      <span className="cta-price">{f.money(total)}</span>
    </button>
  );

  const onBackdrop = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains("modal-backdrop")) closeCustomizer();
  };

  return (
    <div className="modal-backdrop" onClick={onBackdrop} style={{ position: "fixed" }}>
      <div className="modal-outer">
        <button className="popup-close" onClick={closeCustomizer} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div className="modal">
          <div className="modal-header">
            <div className="modal-title-block">
              <div className="modal-pizza-name">{pName(pizza, lang)}</div>
              <div className="modal-pizza-desc">{pTagline(pizza, lang)}</div>
            </div>
          </div>

          {/* Desktop / tablet: two columns */}
          <div className="modal-cols">
            <div className="col-config">
              <div className="col-config-opts">{configBlocks}</div>
              {buildModsRow && <div className="build-mods-wrap">{buildModsRow}</div>}
              <div className="col-config-wit">
                <div className="what-on-it">{whatsOnItInner}</div>
              </div>
            </div>
            <div className="col-right">
              <div className="toppings-header">
                {zoneRow}
                {catFilter}
              </div>
              <div className="topping-grid-scroll">{toppingGrid}</div>
              <div className="col-right-cta">{cta}</div>
            </div>
          </div>

          {/* Mobile: single-column scroll body */}
          <div className="modal-body">
            <div style={{ padding: "10px 20px 0" }}>{configBlocks}</div>
            {buildModsRow && <div className="build-mods-wrap" data-build-mods-mob-wrap>{buildModsRow}</div>}
            <div className="what-on-it" data-wit-mob>{whatsOnItInner}</div>
            <div className="toppings-header" style={{ margin: 0 }}>
              {zoneRow}
              {catFilter}
            </div>
            <div style={{ padding: "12px 16px 16px" }}>{toppingGrid}</div>
          </div>

          <div className="modal-footer">{cta}</div>
        </div>
      </div>
    </div>
  );
}
