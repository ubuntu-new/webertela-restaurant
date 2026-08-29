import { db } from "@/lib/db";
import { getSession } from "@/lib/admin-auth";
import { tr } from "@/lib/admin-i18n";
import { fmt } from "@/lib/format";
import {
  saveOrderSettings,
  saveLoyaltySettings,
  saveEmployeeDiscount,
  saveDiscountRules,
  saveTax,
  saveSocial,
  saveTelegram,
  saveFixedCosts,
  saveAdminLanguage,
} from "./actions";

export const dynamic = "force-dynamic";

type Bag = Record<string, unknown>;

function obj(v: unknown): Bag {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : {};
}
function n(v: unknown, d = 0): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function b(v: unknown, d = false): boolean {
  return typeof v === "boolean" ? v : d;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const sp = await searchParams;
  const t = await tr();
  const f = await fmt();

  const session = await getSession();
  const rows = await db.setting.findMany();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, unknown>;

  const lang = obj(map.adminLanguage);
  const order = obj(map.order);
  const loyalty = obj(map.loyalty);
  const emp = obj(map.employeeDiscount);
  const rules = obj(map.discountRules);
  const verif = obj(map.discountVerification);
  const tax = obj(map.tax);
  const tg = obj(map.telegram);
  const tgEvents = obj(tg.events);
  const fc = obj(map.fixedCosts);
  const social = Array.isArray(map.social) ? (map.social as Bag[]) : [];

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>{t("Settings")}</h1>
          <p>{t("Every value is managed from here")}</p>
        </div>
      </div>

      {sp.saved && (
        <div className="alert alert-ok">
          {t("Saved")}: {sp.saved}
        </div>
      )}

      {/* language */}
      <form className="admin-panel admin-form" action={saveAdminLanguage} style={{ maxWidth: "none" }}>
        <h2>Interface language</h2>
        {session?.role === "super_admin" ? (
          <>
            <p className="hint" style={{ marginTop: -8 }}>
              English is the source language — new screens appear in English first.
              Changing this affects every admin user.
            </p>
            <div className="field" style={{ maxWidth: 320 }}>
              <label htmlFor="lang">Language</label>
              <select id="lang" name="lang" defaultValue={String(lang.lang ?? "en")}>
                <option value="en">English</option>
                <option value="ka">{t("Georgian")}</option>
              </select>
            </div>
            <div className="form-actions">
              <button className="btn" type="submit">Save</button>
            </div>
          </>
        ) : (
          <p className="hint" style={{ margin: 0 }}>
            Current: <b>{String(lang.lang ?? "en") === "ka" ? t("Georgian") : "English"}</b> — only a
            super admin can change this.
          </p>
        )}
      </form>

      {/* ── შეკვეთა ── */}
      <form className="admin-panel admin-form" action={saveOrderSettings} style={{ maxWidth: "none" }}>
        <h2>{t("Orders and delivery")}</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="minOrder">{t("Minimum order")} ({f.symbol})</label>
            <input id="minOrder" name="minOrder" type="number" step="0.01" min="0" defaultValue={n(order.minOrder, 25)} />
          </div>
          <div className="field">
            <label htmlFor="deliveryFee">{t("Delivery fee")} ({f.symbol})</label>
            <input id="deliveryFee" name="deliveryFee" type="number" step="0.01" min="0" defaultValue={n(order.deliveryFee, 5.5)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="freeDeliveryThreshold">{t("Free delivery over")} ({f.symbol})</label>
            <input id="freeDeliveryThreshold" name="freeDeliveryThreshold" type="number" step="0.01" min="0" defaultValue={n(order.freeDeliveryThreshold, 60)} />
          </div>
          <div className="field">
            <label htmlFor="maxToppings">{t("Max toppings per pizza")}</label>
            <input id="maxToppings" name="maxToppings" type="number" min="1" defaultValue={n(order.maxToppings, 6)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="currency">{t("Currency")}</label>
          <input id="currency" name="currency" type="text" defaultValue={String(order.currency ?? "GEL")} />
        </div>
        <div className="form-actions">
          <button className="btn" type="submit">{t("Save")}</button>
        </div>
      </form>

      {/* ── ლოიალობა ── */}
      <form className="admin-panel admin-form" action={saveLoyaltySettings} style={{ maxWidth: "none" }}>
        <h2>{t("Loyalty points")}</h2>
        <div className="field-check">
          <input id="l_enabled" name="enabled" type="checkbox" defaultChecked={b(loyalty.enabled, true)} />
          <label htmlFor="l_enabled">{t("Enabled")}</label>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="pointsPerGel">{t("Points per")} 1 {f.symbol}</label>
            <input id="pointsPerGel" name="pointsPerGel" type="number" step="0.01" min="0" defaultValue={n(loyalty.pointsPerGel, 1)} />
          </div>
          <div className="field">
            <label htmlFor="redeemRate">{t("Value of 1 point")} ({f.symbol})</label>
            <input id="redeemRate" name="redeemRate" type="number" step="0.01" min="0" defaultValue={n(loyalty.redeemRate, 0.1)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="minRedeem">{t("Minimum redemption (points)")}</label>
          <input id="minRedeem" name="minRedeem" type="number" min="0" defaultValue={n(loyalty.minRedeem, 100)} />
          <span className="hint">
            {t("Right now 100 points are worth")}{" "}
            {f.money(n(loyalty.minRedeem, 100) * n(loyalty.redeemRate, 0.1))}
          </span>
        </div>
        <div className="form-actions">
          <button className="btn" type="submit">{t("Save")}</button>
        </div>
      </form>

      {/* ── თანამშრომლის ფასდაკლება ── */}
      <form className="admin-panel admin-form" action={saveEmployeeDiscount} style={{ maxWidth: "none" }}>
        <h2>{t("Staff discount")}</h2>
        <div className="field-check">
          <input id="e_enabled" name="enabled" type="checkbox" defaultChecked={b(emp.enabled, true)} />
          <label htmlFor="e_enabled">{t("Enabled")}</label>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="e_value">{t("Amount")}</label>
            <input id="e_value" name="value" type="number" step="0.01" min="0" defaultValue={n(emp.value, 30)} />
          </div>
          <div className="field">
            <label htmlFor="e_mode">{t("Type")}</label>
            <select id="e_mode" name="mode" defaultValue={String(emp.mode ?? "percent")}>
              <option value="percent">{t("Percent")} (%)</option>
              <option value="fixed">{t("Fixed")} ({f.symbol})</option>
            </select>
          </div>
        </div>
        <div className="field-check">
          <input id="appliesEverywhere" name="appliesEverywhere" type="checkbox" defaultChecked={b(emp.appliesEverywhere, true)} />
          <label htmlFor="appliesEverywhere">{t("Applies at every branch")}</label>
        </div>
        <div className="form-actions">
          <button className="btn" type="submit">{t("Save")}</button>
        </div>
      </form>

      {/* ── ფასდაკლების წესები ── */}
      <form className="admin-panel admin-form" action={saveDiscountRules} style={{ maxWidth: "none" }}>
        <h2>{t("Discount rules")}</h2>
        <div className="field-check">
          <input id="stackable" name="stackable" type="checkbox" defaultChecked={b(rules.stackable, false)} />
          <label htmlFor="stackable">{t("Discounts stack")}</label>
        </div>
        <div className="field-check">
          <input id="excludeCombos" name="excludeCombos" type="checkbox" defaultChecked={b(rules.excludeCombos, true)} />
          <label htmlFor="excludeCombos">{t("Never applies to a combo")}</label>
        </div>
        <div className="field-check">
          <input id="excludePromoProducts" name="excludePromoProducts" type="checkbox" defaultChecked={b(rules.excludePromoProducts, true)} />
          <label htmlFor="excludePromoProducts">{t("Never applies to a promo product")}</label>
        </div>
        <div className="field">
          <label htmlFor="verification">{t("Verification (student/diplomat)")}</label>
          <select id="verification" name="verification" defaultValue={String(verif.mode ?? "manual")}>
            <option value="manual">{t("Confirmed by hand")}</option>
            <option value="upload">{t("Document upload")}</option>
          </select>
          <span className="hint">{t("“Upload” needs file storage — we don't have it yet.")}</span>
        </div>
        <div className="form-actions">
          <button className="btn" type="submit">{t("Save")}</button>
        </div>
      </form>

      {/* fixed costs */}
      <form className="admin-panel admin-form" action={saveFixedCosts} style={{ maxWidth: "none" }}>
        <h2>
          {t("Fixed costs")} ({t("per month")})
        </h2>
        <p className="hint" style={{ marginTop: -8 }}>
          {t("Without these the dashboard cannot show net profit. Labour comes from the shifts.")}
        </p>
        <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div className="field">
            <label htmlFor="rent">{t("Rent")} ({f.symbol})</label>
            <input id="rent" name="rent" type="number" step="0.01" min="0" defaultValue={n(fc.rent, 0)} />
          </div>
          <div className="field">
            <label htmlFor="utilities">{t("Utilities")} ({f.symbol})</label>
            <input id="utilities" name="utilities" type="number" step="0.01" min="0" defaultValue={n(fc.utilities, 0)} />
          </div>
          <div className="field">
            <label htmlFor="other">{t("Other")} ({f.symbol})</label>
            <input id="other" name="other" type="number" step="0.01" min="0" defaultValue={n(fc.other, 0)} />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn" type="submit">{t("Save")}</button>
        </div>
      </form>

      {/* ── გადასახადი ── */}
      <form className="admin-panel admin-form" action={saveTax} style={{ maxWidth: "none" }}>
        <h2>{t("Tax")}</h2>
        <div className="field-row">
          <div className="field">
            <label htmlFor="rate">{t("Rate")} (%)</label>
            <input id="rate" name="rate" type="number" step="0.01" min="0" defaultValue={n(tax.rate, 0)} />
          </div>
          <div className="field" style={{ alignContent: "end" }}>
            <div className="field-check">
              <input id="inclusive" name="inclusive" type="checkbox" defaultChecked={b(tax.inclusive, true)} />
              <label htmlFor="inclusive">{t("Included in the price")}</label>
            </div>
          </div>
        </div>
        <div className="form-actions">
          <button className="btn" type="submit">{t("Save")}</button>
        </div>
      </form>

      {/* ── Telegram ── */}
      <form className="admin-panel admin-form" action={saveTelegram} style={{ maxWidth: "none" }}>
        <h2>Telegram {t("notifications")}</h2>
        <p className="hint" style={{ marginTop: -8 }}>
          {t("The bot token lives in")} <code>.env</code> (<code>TELEGRAM_BOT_TOKEN</code>) —{" "}
          {t("it is not shown here.")}
        </p>

        <div className="field-check">
          <input id="tg_enabled" name="enabled" type="checkbox" defaultChecked={b(tg.enabled, false)} />
          <label htmlFor="tg_enabled">{t("Enabled")}</label>
        </div>

        <div className="field">
          <label htmlFor="chatId">Chat ID</label>
          <input id="chatId" name="chatId" type="text" defaultValue={String(tg.chatId ?? "")} placeholder="-1001234567890" />
          <span className="hint">{t("A group id starts with a minus, a private chat id does not.")}</span>
        </div>

        <div className="field">
          <label>{t("What to send")}</label>
          <div className="field-check">
            <input id="ev_order" name="ev_order" type="checkbox" defaultChecked={b(tgEvents.order, true)} />
            <label htmlFor="ev_order">🍕 {t("New order")}</label>
          </div>
          <div className="field-check">
            <input id="ev_transferRequest" name="ev_transferRequest" type="checkbox" defaultChecked={b(tgEvents.transferRequest, true)} />
            <label htmlFor="ev_transferRequest">📦 {t("Top-up request (to approve)")}</label>
          </div>
          <div className="field-check">
            <input id="ev_transferSent" name="ev_transferSent" type="checkbox" defaultChecked={b(tgEvents.transferSent, true)} />
            <label htmlFor="ev_transferSent">🚚 {t("A shipment has left")}</label>
          </div>
          <div className="field-check">
            <input id="ev_lowStock" name="ev_lowStock" type="checkbox" defaultChecked={b(tgEvents.lowStock, true)} />
            <label htmlFor="ev_lowStock">⚠️ {t("Stock at the minimum (daily digest)")}</label>
          </div>
          <span className="hint">
            {t("Turn off the noise — a few alerts people read beat a pile they ignore.")}
          </span>
        </div>

        <div className="form-actions">
          <button className="btn" type="submit">{t("Save")}</button>
        </div>
      </form>

      {/* ── სოც. ქსელები ── */}
      <form className="admin-panel admin-form" action={saveSocial} style={{ maxWidth: "none" }}>
        <h2>{t("Social links (footer)")}</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th style={{ width: 120 }}>{t("Network")}</th>
              <th>{t("Link")}</th>
              <th style={{ width: 90 }}>{t("Visible")}</th>
            </tr>
          </thead>
          <tbody>
            {social.map((s) => {
              const id = String(s.id);
              return (
                <tr key={id}>
                  <td>{String(s.label ?? id)}</td>
                  <td>
                    <input
                      name={`href_${id}`}
                      type="text"
                      defaultValue={String(s.href ?? "")}
                      placeholder="https://…"
                      style={{ width: "100%", padding: "6px 8px", border: "1px solid var(--a-line)", borderRadius: 6, font: "inherit" }}
                    />
                  </td>
                  <td>
                    <input type="checkbox" name={`enabled_${id}`} defaultChecked={b(s.enabled, false)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="form-actions" style={{ marginTop: 14 }}>
          <button className="btn" type="submit">{t("Save")}</button>
        </div>
      </form>
    </>
  );
}
