"use client";

import { useLang } from "@/lib/i18n";
import { useCart } from "@/lib/cart";
import {
  PIZZAS,
  PIZZA_PHOTOS,
  HH_COMBOS,
  COMBOS,
  EXTRAS,
  SAUCES,
  DRINKS,
  LOCATIONS,
  SLICE_SVG,
  pName,
  pBadge,
  ingLabel,
  itemName,
  itemDesc,
  comboName,
  comboDesc,
  comboBadge,
  type Item,
  type Pizza,
} from "@/lib/data";

// img onError → hide the photo, reveal the slice-SVG fallback sibling
function imgError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  img.style.display = "none";
  const fb = img.parentElement?.querySelector<HTMLElement>(".p-emoji, .byo-img-emoji");
  if (fb) fb.style.display = "flex";
}

const slice = { __html: SLICE_SVG };

export default function MenuBody() {
  const { lang, t, f } = useLang();
  const { openCustomizer, openHH, openCombo } = useCart();

  const menuPizzas = PIZZAS.filter((p) => !p.isBYO);
  const byoPizza = PIZZAS.find((p) => p.id === 14)!;
  const byoLabel = lang === "ka" ? "შექმენი შენი პიცა" : "Build Your Own Pizza";
  const byoSub = lang === "ka" ? "ნულიდან. შენი წესებით." : "Start from scratch. Your rules.";
  const combos = COMBOS.filter((c) => c.active !== false);

  return (
    <div className="menu-body">
      {/* ── COMBOS / DEALS ── */}
      {combos.length > 0 && (
        <>
          <div className="section-head" id="section-combos">
            <h2>{t("combos_heading")}</h2>
            <span className="s-count">
              {combos.length} {t("combos_unit")}
            </span>
          </div>
          <div className="combo-grid">
            {combos.map((c) => {
              const badge = comboBadge(c, lang);
              return (
                <button className="combo-card" key={c.id} onClick={() => openCombo(c)}>
                  <div className="combo-thumb">
                    {badge && <div className="combo-badge">{badge}</div>}
                    {c.photo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.photo} alt={comboName(c, lang)} loading="lazy" onError={(e) => e.currentTarget.remove()} />
                    )}
                  </div>
                  <div className="combo-info">
                    <div className="combo-name">{comboName(c, lang)}</div>
                    <div className="combo-desc">{comboDesc(c, lang)}</div>
                    <div className="combo-foot">
                      <span className="combo-price">
                        {c.pricing.mode === "fixed" ? (
                          <>{f.money(c.pricing.price)}</>
                        ) : (
                          <>−{c.pricing.percent}%</>
                        )}
                      </span>
                      <span className="add-btn">+</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ── PIZZAS ── */}
      <div className="section-head" id="section-pizza">
        <h2>{t("pizzas_heading")}</h2>
        <span className="s-count">
          {menuPizzas.length} {t("options")}
        </span>
      </div>
      <div className="pizza-grid">
        {menuPizzas.map((p) => (
          <PizzaCard key={p.id} p={p} />
        ))}
        {/* Build Your Own */}
        <div className="pizza-card byo-card" onClick={() => openCustomizer(byoPizza)}>
          <div className="byo-img">
            <img src={PIZZA_PHOTOS[13]} alt="" loading="lazy" onError={imgError} />
            <div className="byo-img-q" aria-hidden="true">
              ?
            </div>
            <div className="byo-img-emoji" style={{ display: "none" }} dangerouslySetInnerHTML={slice} />
          </div>
          <div className="pizza-info">
            <div className="pizza-name">{byoLabel}</div>
            <div className="pizza-ings">{byoSub}</div>
            <div className="pizza-footer">
              <div className="pizza-price">
                <span className="from">{t("from_price")} </span>{f.money(9.5)}
              </div>
              <div className="add-btn">+</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── HALF & HALF ── */}
      <div className="section-head hh-section-head" id="section-hh">
        <h2>{t("half_half")}</h2>
        <div className="hh-fair-inline">
          <strong>{t("fair_pricing_t")}</strong>
          <span>{t("fair_pricing_b")}</span>
        </div>
      </div>
      <div className="hh-grid">
        {HH_COMBOS.map((c) => {
          const L = PIZZAS.find((p) => p.id === c.leftId);
          const R = PIZZAS.find((p) => p.id === c.rightId);
          // პრესეტის პიცა შეიძლება აღარ იყოს მენიუში (გამორთული / არქივში /
          // ამ ფილიალში მიუწვდომელი) — მაშინ ბარათს საერთოდ არ ვხატავთ.
          if (!L || !R) return null;
          const price = L.sizes[1] / 2 + R.sizes[1] / 2;
          const lIngs = L.ings.slice(0, 6).map((n) => ingLabel(n, lang)).join(", ");
          const rIngs = R.ings.slice(0, 6).map((n) => ingLabel(n, lang)).join(", ");
          return (
            <div className="hh-card" key={c.id} onClick={() => openHH(c.leftId, c.rightId)}>
              <div className="hh-img">
                <div className="hh-img-half left">
                  <img src={PIZZA_PHOTOS[c.leftId] || ""} alt={pName(L, lang)} loading="lazy" />
                </div>
                <div className="hh-img-half right">
                  <img src={PIZZA_PHOTOS[c.rightId] || ""} alt={pName(R, lang)} loading="lazy" />
                </div>
              </div>
              <div className="hh-card-body">
                <div className="hh-card-side">
                  <div className="hh-side-name left">{pName(L, lang)}</div>
                  <div className="hh-side-ings">{lIngs}</div>
                </div>
                <div className="hh-card-side">
                  <div className="hh-side-name right">{pName(R, lang)}</div>
                  <div className="hh-side-ings">{rIngs}</div>
                </div>
              </div>
              <div className="pizza-footer hh-footer">
                <span className="pizza-price">{f.money(price)}</span>
                <div className="add-btn">+</div>
              </div>
            </div>
          );
        })}
        {/* Build Your Own H&H */}
        <div className="hh-card hh-byohh" onClick={() => openHH()}>
          <div className="hh-img">
            <div className="hh-img-half left">
              <img src={PIZZA_PHOTOS[13]} alt="" loading="lazy" />
              <div className="byo-img-q byo-img-q-half" aria-hidden="true">
                ?
              </div>
            </div>
            <div className="hh-img-half right">
              <img src={PIZZA_PHOTOS[13]} alt="" loading="lazy" />
              <div className="byo-img-q byo-img-q-half" aria-hidden="true">
                ?
              </div>
            </div>
          </div>
          <div className="hh-byohh-body">
            <div className="hh-byohh-label">{t("build_your_own")}</div>
            <div className="hh-byohh-sub">{t("any_two_pizzas")}</div>
          </div>
          <div className="pizza-footer hh-footer">
            <span className="pizza-price hh-byo-price">{t("mix_and_match")}</span>
            <div className="add-btn">+</div>
          </div>
        </div>
      </div>

      {/* ── EXTRAS ── */}
      <div className="section-head" id="section-extras">
        <h2>{t("extras_heading")}</h2>
        <span className="s-count">
          {EXTRAS.length} {t("extras_unit")}
        </span>
      </div>
      <ItemRow items={EXTRAS} />

      {/* ── SAUCES ── */}
      <div className="section-head" id="section-sauces">
        <h2>{t("sauces_heading")}</h2>
        <span className="s-count">
          {SAUCES.length} {t("sauces_unit")}
        </span>
      </div>
      <ItemRow items={SAUCES} />

      {/* ── DRINKS ── */}
      <div className="section-head" id="section-drinks">
        <h2>{t("nav_drinks")}</h2>
        <span className="s-count">
          {DRINKS.length} {t("drinks_unit")}
        </span>
      </div>
      <ItemRow items={DRINKS} />

      {/* ── ABOUT ── */}
      <AboutSection />
    </div>
  );
}

function PizzaCard({ p }: { p: Pizza }) {
  const { lang, t, f } = useLang();
  const { openCustomizer } = useCart();
  const badge = pBadge(p, lang);
  const isVeg = p.badge === "Vegetarian" || p.badge === "Vegan";
  return (
    <div className="pizza-card" onClick={() => openCustomizer(p)}>
      <div className="pizza-img">
        <div className="p-emoji" dangerouslySetInnerHTML={slice} />
        {PIZZA_PHOTOS[p.id] && (
          <img src={PIZZA_PHOTOS[p.id]} alt={pName(p, lang)} loading="lazy" onError={imgError} />
        )}
        {badge && <div className={`p-badge${isVeg ? " veg" : ""}`}>{badge}</div>}
      </div>
      <div className="pizza-info">
        <div className="pizza-name">{pName(p, lang)}</div>
        <div className="pizza-ings">{p.ings.map((n) => ingLabel(n, lang)).join(", ")}</div>
        <div className="pizza-footer">
          <div className="pizza-price">
            <span className="from">{t("from_price")} </span>
            {f.money(p.sizes[0])}
          </div>
          <div className="add-btn">+</div>
        </div>
      </div>
    </div>
  );
}

function ItemRow({ items }: { items: Item[] }) {
  const { lang, t, f } = useLang();
  const { addSimple, showToast, openStick } = useCart();
  const add = (it: Item) => {
    if (it.builder) {
      openStick(it);
      return;
    }
    addSimple(it.id, itemName(it, lang), it.price);
    showToast(t("added_to_order").replace("{name}", itemName(it, lang)));
  };
  return (
    <div className="extras-row compact">
      {items.map((it) => (
        <div className="extra-card" key={it.id} title={itemDesc(it, lang)} onClick={() => add(it)}>
          <div className="pizza-img">
            <div className="p-emoji" dangerouslySetInnerHTML={slice} />
            {it.photo && (
              <img src={it.photo} alt={itemName(it, lang)} loading="lazy" onError={imgError} />
            )}
          </div>
          <div className="pizza-info">
            <div className="pizza-name">{itemName(it, lang)}</div>
            <div className="pizza-ings">{itemDesc(it, lang)}</div>
            <div className="pizza-footer">
              <div className="pizza-price">{f.money(it.price)}</div>
              <div className="add-btn">+</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AboutSection() {
  const { lang, t } = useLang();
  return (
    <section className="about-page" id="section-about">
      <div className="about-hero">
        <h2 className="about-h1">{t("about_h1")}</h2>
        <p className="about-lede">{t("about_lede")}</p>
      </div>

      <div className="about-section">
        <p>{t("about_p1")}</p>
        <p>{t("about_p2")}</p>
      </div>

      <div className="about-section about-section-tinted">
        <h3 className="about-h2">{t("about_h2_people")}</h3>
        <p>{t("about_p3")}</p>
        <p>{t("about_p4")}</p>
      </div>

      <div className="about-section">
        <h3 className="about-h2">{t("about_h2_360")}</h3>
        <p>{t("about_p5")}</p>
        <p>{t("about_p6")}</p>
        <p>{t("about_p7")}</p>
      </div>

      <div className="about-section">
        <h3 className="about-h2">{t("about_h2_room")}</h3>
        <ul className="about-list">
          <li>{t("about_room_1")}</li>
          <li>{t("about_room_2")}</li>
          <li>{t("about_room_3")}</li>
          <li>{t("about_room_4")}</li>
          <li>{t("about_room_5")}</li>
          <li>{t("about_room_6")}</li>
        </ul>
      </div>

      <div className="about-section about-section-tinted">
        <h3 className="about-h2">{t("about_h2_practice")}</h3>
        <p>{t("about_p8")}</p>
        <p>{t("about_p9")}</p>
      </div>

      <div className="about-section about-find-us" id="section-find-us">
        <h3 className="about-h2">{t("about_h2_find")}</h3>
        <p className="about-find-intro">{t("about_p10")}</p>
        <ul className="about-locations">
          {LOCATIONS.map((loc) => (
            <li className="loc-card" key={loc.id}>
              <div className="loc-card-body">
                <div className="loc-name">{lang === "ka" ? loc.branch_ka : loc.branch}</div>
                <div className="loc-address">{lang === "ka" ? loc.address_ka : loc.address}</div>
                <div className="loc-meta">
                  <span className="loc-hours">{loc.hours}</span>
                  <span className="loc-sep">·</span>
                  <a className="loc-phone" href={`tel:${loc.phone.replace(/\s/g, "")}`}>
                    {loc.phone}
                  </a>
                </div>
              </div>
              <a
                className="loc-map-link"
                href={loc.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${lang === "ka" ? "რუკაზე" : "Open in Maps"}: ${loc.branch}`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span>{lang === "ka" ? "რუკაზე" : "Open in Maps"}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>

      <div className="about-closing">
        <p className="about-closing-line">{t("about_closing_a")}</p>
        <p className="about-closing-line about-closing-emph">{t("about_closing_b")}</p>
      </div>

      <div className="about-signature">
        <div className="about-sig-name">Ronny&apos;s Pizza</div>
        <div className="about-sig-tag">{t("about_signature_tag")}</div>
      </div>
    </section>
  );
}
