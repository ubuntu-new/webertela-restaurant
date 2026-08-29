"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart";
import { useLang } from "@/lib/i18n";
import {
  PIZZAS,
  PIZZA_PHOTOS,
  TOPPINGS,
  TOPPING_PHOTOS,
  SLICE_SVG,
  MAX_TOPPINGS,
  pName,
  ingLabel,
  tDisp,
} from "@/lib/data";
import {
  type Zone,
  type ToppingsState,
  SIZE_KEYS,
  SIZE_CM,
  CRUST_KEYS,
  SAUCE_KEYS,
  SAUCE_FWD,
  plainExtra,
  plainSlots,
} from "@/lib/pricing";

type Side = "left" | "right";

const ZONE_BADGE: Record<Zone, { cls: string; check: string; label2x: string }> = {
  whole: { cls: "", check: "✓", label2x: "2×" },
  left: { cls: " zone-left", check: "L", label2x: "2L" },
  right: { cls: " zone-right", check: "R", label2x: "2R" },
};
const CATS = [
  { cat: "all", key: "filter_all" },
  { cat: "cheese", key: "filter_cheese" },
  { cat: "veg", key: "filter_veggie" },
  { cat: "protein", key: "filter_protein" },
  { cat: "heat", key: "filter_heat" },
];
const Slice = () => <span className="t-emoji" dangerouslySetInnerHTML={{ __html: SLICE_SVG }} />;

export default function HalfHalf() {
  const { hhOpen, hhInit, editingHHIdx, lines, commitHH, closeHH, showToast } = useCart();
  const { lang, t, f } = useLang();

  const [leftId, setLeftId] = useState<number | null>(null);
  const [rightId, setRightId] = useState<number | null>(null);
  const [sizeIdx, setSizeIdx] = useState(1);
  const [crustIdx, setCrustIdx] = useState(0);
  const [sauceIdx, setSauceIdx] = useState(2);
  const [zone, setZone] = useState<Zone>("whole");
  const [cat, setCat] = useState("all");
  const [tops, setTops] = useState<ToppingsState>({});
  const [picker, setPicker] = useState<Side | null>(null);

  useEffect(() => {
    if (!hhOpen) return;
    if (editingHHIdx !== null && lines[editingHHIdx]?.kind === "hh") {
      const l = lines[editingHHIdx];
      if (l.kind === "hh") {
        setLeftId(l.leftId);
        setRightId(l.rightId);
        setSizeIdx(l.sizeIdx);
        setCrustIdx(l.crustIdx);
        setSauceIdx(l.sauceIdx);
        setTops(l.toppings ? JSON.parse(JSON.stringify(l.toppings)) : {});
      }
    } else {
      setLeftId(hhInit.leftId);
      setRightId(hhInit.rightId);
      setSizeIdx(1);
      setCrustIdx(0);
      setSauceIdx(2);
      setTops({});
    }
    setZone("whole");
    setCat("all");
    setPicker(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hhOpen, hhInit, editingHHIdx]);

  if (!hhOpen) return null;

  const menuPizzas = PIZZAS.filter((p) => !p.isBYO);
  const left = leftId !== null ? PIZZAS.find((p) => p.id === leftId) ?? null : null;
  const right = rightId !== null ? PIZZAS.find((p) => p.id === rightId) ?? null : null;
  const both = !!left && !!right;

  const slots = plainSlots(tops);
  const limitReached = slots >= MAX_TOPPINGS;
  const baseFair = both ? left!.sizes[sizeIdx] / 2 + right!.sizes[sizeIdx] / 2 : 0;
  const price = both ? Math.round((baseFair + plainExtra(tops, sizeIdx)) * 100) / 100 : 0;

  const stepSauce = (dir: number, isStep: boolean) => {
    setSauceIdx((cur) => {
      if (isStep) return Math.max(0, Math.min(3, cur + dir));
      const i = SAUCE_FWD.indexOf(cur);
      return SAUCE_FWD[(i + dir + 4) % 4];
    });
  };

  const choose = (id: number) => {
    if (picker === "left") setLeftId(id);
    else if (picker === "right") setRightId(id);
    setPicker(null);
  };

  const cycleTopping = (name: string) => {
    const cur = tops[name]?.[zone] || 0;
    if (cur === 0 && slots >= MAX_TOPPINGS) return;
    const nextQ = cur === 0 ? 1 : cur === 1 ? (slots >= MAX_TOPPINGS ? 0 : 2) : 0;
    setTops((prev) => {
      const next = { ...prev };
      const entry = { ...(next[name] || { whole: 0, left: 0, right: 0 }) };
      entry[zone] = nextQ;
      if (!entry.whole && !entry.left && !entry.right) delete next[name];
      else next[name] = entry;
      return next;
    });
  };

  const removeAdded = (name: string, z: Zone) => {
    setTops((prev) => {
      const next = { ...prev };
      const entry = { ...(next[name] || { whole: 0, left: 0, right: 0 }) };
      entry[z] = 0;
      if (!entry.whole && !entry.left && !entry.right) delete next[name];
      else next[name] = entry;
      return next;
    });
  };

  const commit = () => {
    if (!both) return;
    const added: { name: string; qty: number; zone: Zone }[] = [];
    Object.entries(tops).forEach(([name, e]) => {
      (["whole", "left", "right"] as Zone[]).forEach((z) => {
        if (e[z]) added.push({ name, qty: e[z], zone: z });
      });
    });
    commitHH(
      { leftId: leftId!, rightId: rightId!, sizeIdx, crustIdx, sauceIdx, toppings: JSON.parse(JSON.stringify(tops)), added, price },
      editingHHIdx,
    );
    showToast(t("added_to_order").replace("{name}", `${pName(left!, lang)} / ${pName(right!, lang)}`));
    closeHH();
  };

  // ── shared pieces ──
  const pizzaPickers = (
    <div className="config-block" style={{ paddingTop: 0 }}>
      <span className="config-label">{t("hh_title")}</span>
      <div className="hh-sides">
        {(["left", "right"] as Side[]).map((s) => {
          const pz = s === "left" ? left : right;
          return (
            <button key={s} className={`hh-side-pick ${s}${pz ? "" : " empty"}`} onClick={() => setPicker(s)}>
              <span className="hh-pick-role">{t(s === "left" ? "hh_left_role" : "hh_right_role")}</span>
              {pz ? (
                <>
                  <span className="hh-pick-name">{pName(pz, lang)}</span>
                  <span className="hh-pick-edit">{t("hh_change")}</span>
                </>
              ) : (
                <span className="hh-pick-name placeholder">{t("hh_tap_choose")}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  const configBlocks = (
    <>
      {pizzaPickers}
      <div className="config-block">
        <span className="config-label">{t("pick_size")}</span>
        <div className="segment full">
          {[0, 1, 2].map((i) => (
            <button key={i} className={sizeIdx === i ? "active" : ""} onClick={() => setSizeIdx(i)}>
              <span>{t(SIZE_KEYS[i])}</span>
              <span className="s-sub">{SIZE_CM[i]}</span>
              {both && (
                <span className="s-price">{f.money(Math.round((left!.sizes[i] / 2 + right!.sizes[i] / 2) * 100) / 100)}</span>
              )}
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
            <button className="ss-step" onClick={() => stepSauce(-1, true)} aria-label="Less sauce">−</button>
            <span className="ss-label" onClick={() => stepSauce(1, false)}>{t(SAUCE_KEYS[sauceIdx])}</span>
            <button className="ss-step" onClick={() => stepSauce(1, true)} aria-label="More sauce">+</button>
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

  const buildModsPills: { text: string; undo: () => void }[] = [];
  if (crustIdx !== 0) buildModsPills.push({ text: `${t(CRUST_KEYS[crustIdx])} ${t("crust_suffix")}`, undo: () => setCrustIdx(0) });
  if (sauceIdx !== 2) buildModsPills.push({ text: `${t(SAUCE_KEYS[sauceIdx])} ${t("sauce_suffix")}`, undo: () => setSauceIdx(2) });
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

  const baseChips = (side: Side, pizza: typeof left) =>
    pizza && (
      <>
        <span className={`wit-subhead ${side}`}>{t(side === "left" ? "hh_left_role" : "hh_right_role")}</span>
        <div className="ing-chips">
          {pizza.ings.map((n) => (
            <span key={side + n} className={`ing-chip hh-base ${side}`}>
              <span className="hh-dot" aria-hidden="true" />
              {ingLabel(n, lang)}
            </span>
          ))}
        </div>
      </>
    );

  const addedPills: React.ReactNode[] = [];
  Object.entries(tops).forEach(([name, e]) => {
    (["whole", "left", "right"] as Zone[]).forEach((z) => {
      const q = e[z] || 0;
      if (q <= 0) return;
      const sfx = z === "left" ? " (L)" : z === "right" ? " (R)" : "";
      addedPills.push(
        <button key={`ap-${name}-${z}`} className="build-pill added" onClick={() => removeAdded(name, z)}>
          {(q === 2 ? "2× " : "+ ") + ingLabel(name, lang) + sfx}
          <span className="pill-x" aria-hidden="true">×</span>
        </button>,
      );
    });
  });

  const whatsOnItInner = (
    <>
      <span className="wit-label">{t("whats_on_it")}</span>
      {both ? (
        <>
          {baseChips("left", left)}
          {baseChips("right", right)}
          {addedPills.length > 0 && (
            <>
              <span className="wit-subhead" style={{ color: "var(--ink-3)" }}>{t("stick_add_ons")}</span>
              <div className="ing-chips">{addedPills}</div>
            </>
          )}
        </>
      ) : (
        <div className="hh-pick-ings" style={{ padding: "4px 0" }}>{t("hh_tap_choose")}</div>
      )}
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
      {slots >= 4 && (
        <span className={`pill-slot-count${limitReached ? " at-limit" : ""}`}>
          {slots}/{MAX_TOPPINGS}
        </span>
      )}
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

  const visible = TOPPINGS.filter((tp) => !tp.recipeOnly && (cat === "all" || tp.dots.includes(cat)));
  const zb = ZONE_BADGE[zone];
  const isHalf = zone === "left" || zone === "right";

  const toppingGrid = (
    <div className="topping-grid">
      {visible.map((tp) => {
        const qty = tops[tp.name]?.[zone] || 0;
        const limitCls = limitReached && qty === 0 ? " at-limit" : "";
        const cardCls = qty === 2 ? `sel2${zb.cls}` : qty === 1 ? `sel${zb.cls}` : "";
        const tprice = tp.ps[sizeIdx] * (isHalf ? 0.5 : 1);
        const photo = TOPPING_PHOTOS[tp.name];
        return (
          <div key={tp.name} className={`topping-card ${cardCls}${limitCls}`} onClick={() => (both ? cycleTopping(tp.name) : setPicker("left"))}>
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
              <span className="t-price">+{f.money(tprice)}{isHalf ? " (½)" : ""}</span>
            </div>
          </div>
        );
      })}
    </div>
  );

  const cta = (
    <button
      className="cta-primary"
      onClick={commit}
      disabled={!both}
      style={!both ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
    >
      <span>{t("add_to_order")}</span>
      {both && <span className="cta-price">{f.money(price)}</span>}
    </button>
  );

  const onBackdrop = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains("modal-backdrop")) closeHH();
  };

  return (
    <div className="modal-backdrop" onClick={onBackdrop} style={{ position: "fixed" }} data-hh-backdrop>
      <div className="modal-outer">
        <button className="popup-close" onClick={closeHH} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div className="modal">
          <div className="modal-header">
            <div className="modal-title-block">
              <div className="modal-pizza-name">{t("hh_title")}</div>
              {both && <div className="modal-pizza-desc">{pName(left!, lang)} / {pName(right!, lang)}</div>}
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

          {/* Mobile: single column */}
          <div className="modal-body">
            <div style={{ padding: "10px 20px 0" }}>{configBlocks}</div>
            {buildModsRow && <div className="build-mods-wrap">{buildModsRow}</div>}
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

      {picker && (
        <div
          className="hh-picker-backdrop"
          onClick={(e) => {
            if ((e.target as HTMLElement).classList.contains("hh-picker-backdrop")) setPicker(null);
          }}
        >
          <div className="hh-picker-sheet">
            <div className="hh-picker-head">
              <div className="hh-picker-title">
                <span className={picker === "left" ? "role-l" : "role-r"}>
                  {t(picker === "left" ? "hh_pick_for_left" : "hh_pick_for_right")}
                </span>
              </div>
              <button className="hh-picker-close" onClick={() => setPicker(null)} aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="hh-pick-list">
              {menuPizzas.map((p) => {
                const selected = (picker === "left" ? leftId : rightId) === p.id;
                return (
                  <button key={p.id} className={`hh-pick-item${selected ? " selected" : ""}`} onClick={() => choose(p.id)}>
                    <div className="hh-pick-thumb">
                      {PIZZA_PHOTOS[p.id] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={PIZZA_PHOTOS[p.id]} alt={pName(p, lang)} loading="lazy" onError={(e) => e.currentTarget.remove()} />
                      )}
                    </div>
                    <div className="hh-pick-item-info">
                      <div className="hh-pick-item-name">{pName(p, lang)}</div>
                      <div className="hh-pick-item-ings">{p.ings.map((n) => ingLabel(n, lang)).join(", ")}</div>
                    </div>
                    <div className="hh-pick-item-price">{f.money(p.sizes[sizeIdx] / 2)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
