// ═══════════════════════════════════════════════
// Shared pricing helpers — mirror the v12 topping/price model exactly.
// ═══════════════════════════════════════════════
import { TOPPINGS, MAX_TOPPINGS, type Pizza } from "./data";

export type Zone = "whole" | "left" | "right";
export type ZoneQty = { whole: number; left: number; right: number };
export type ToppingsState = Record<string, ZoneQty>;

export const SIZE_KEYS = ["size_small", "size_medium", "size_xl"];
export const CRUST_KEYS = ["crust_original", "crust_thin"];
export const SAUCE_KEYS = ["sauce_none", "sauce_less", "sauce_regular", "sauce_extra"];
export const SIZE_CM = ["20 cm", "30 cm", "45 cm"];
export const SAUCE_FWD = [2, 1, 3, 0]; // label-tap cycle order

function toppingByName(name: string) {
  return TOPPINGS.find((t) => t.name === name);
}

export function normDefEntry(raw: unknown): ZoneQty {
  if (typeof raw === "number") return { whole: raw, left: 0, right: 0 };
  if (raw && typeof raw === "object") {
    const r = raw as Partial<ZoneQty>;
    return { whole: r.whole || 0, left: r.left || 0, right: r.right || 0 };
  }
  return { whole: 0, left: 0, right: 0 };
}

// User-added qty for a zone = stored − baked-in default (never below 0).
export function userQtyForZone(
  stored: ToppingsState,
  defaults: Pizza["defaultExtras"],
  name: string,
  zone: Zone,
): number {
  const storedQty = (stored?.[name]?.[zone]) || 0;
  const def = normDefEntry((defaults || {})[name]);
  return Math.max(0, storedQty - (def[zone] || 0));
}

// Total user-added slots (above defaults) across all zones — counts toward MAX.
export function userAddedSlots(
  toppings: ToppingsState,
  defaults: Pizza["defaultExtras"],
): number {
  let slots = 0;
  Object.entries(toppings || {}).forEach(([name, e]) => {
    const def = normDefEntry((defaults || {})[name]);
    slots += Math.max(0, (e.whole || 0) - def.whole);
    slots += Math.max(0, (e.left || 0) - def.left);
    slots += Math.max(0, (e.right || 0) - def.right);
  });
  return slots;
}

export function atLimit(toppings: ToppingsState, defaults: Pizza["defaultExtras"]) {
  return userAddedSlots(toppings, defaults) >= MAX_TOPPINGS;
}

// Extra cost = only the delta above defaults; half-zones priced at 50%.
export function pizzaExtra(pizza: Pizza, toppings: ToppingsState, sizeIdx: number): number {
  const defaults = pizza.defaultExtras || {};
  let extra = 0;
  Object.entries(toppings).forEach(([n, e]) => {
    const t = toppingByName(n);
    if (!t) return;
    const p = t.ps[sizeIdx];
    const def = normDefEntry(defaults[n]);
    const wDelta = (e.whole || 0) - def.whole;
    const lDelta = (e.left || 0) - def.left;
    const rDelta = (e.right || 0) - def.right;
    extra += p * wDelta + p * 0.5 * lDelta + p * 0.5 * rDelta;
  });
  return extra;
}

// Standard-tier pizzas credit removed default toppings (except Mozzarella).
export function removalCredit(pizza: Pizza, removed: Record<string, boolean>, sizeIdx: number): number {
  if (pizza.tier !== "standard") return 0;
  return Object.keys(removed).reduce((s, n) => {
    if (n === "Mozzarella") return s;
    const t = toppingByName(n);
    return s + (t ? t.ps[sizeIdx] : 0);
  }, 0);
}

export function pizzaTotal(
  pizza: Pizza,
  sizeIdx: number,
  toppings: ToppingsState,
  removed: Record<string, boolean>,
): number {
  return pizza.sizes[sizeIdx] + pizzaExtra(pizza, toppings, sizeIdx) - removalCredit(pizza, removed, sizeIdx);
}

// Seed toppings state from a pizza's defaultExtras.
export function seedToppings(pizza: Pizza): ToppingsState {
  const st: ToppingsState = {};
  Object.entries(pizza.defaultExtras || {}).forEach(([name, val]) => {
    const d = normDefEntry(val);
    st[name] = { whole: d.whole, left: d.left, right: d.right };
  });
  return st;
}

// ── Half & Half per-side toppings (user-added, half price each) ──
export type HHToppings = { left: Record<string, number>; right: Record<string, number> };

// Generic added-topping cost with NO defaults (used by H&H, whole/left/right zones).
// whole = full price (both halves); left/right = half price.
export function plainExtra(toppings: ToppingsState, sizeIdx: number): number {
  let e = 0;
  Object.entries(toppings).forEach(([n, z]) => {
    const t = toppingByName(n);
    if (!t) return;
    const p = t.ps[sizeIdx];
    e += p * (z.whole || 0) + p * 0.5 * (z.left || 0) + p * 0.5 * (z.right || 0);
  });
  return Math.round(e * 100) / 100;
}

export function plainSlots(toppings: ToppingsState): number {
  let s = 0;
  Object.values(toppings).forEach((z) => {
    s += (z.whole || 0) + (z.left || 0) + (z.right || 0);
  });
  return s;
}
