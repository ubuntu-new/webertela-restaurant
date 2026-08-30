/**
 * What can be added to what.
 *
 * The merge tool refused to join "Flour (g)" and "Flour (kg)" because the units
 * did not match. That was too blunt. Grams and kilograms are the same
 * measurement written two ways — refusing there leaves a real duplicate in
 * place, and the owner is told to go and change a unit by hand first, which is
 * exactly the manual work this system is supposed to remove.
 *
 * Kilograms and pieces are a different matter. There is no factor between them:
 * how many pieces are in a kilogram depends on what the thing is. Converting
 * across that line would invent stock, so it stays refused.
 *
 * The line is the **dimension**. Mass converts to mass, volume to volume, count
 * to count, and nothing crosses.
 *
 * A deliberate omission: no density. Flour has a mass and a volume and there is
 * a factor between them for any given flour — but it is a property of that
 * flour, not of the units, and guessing it would silently misstate stock. If a
 * kitchen buys oil by the litre and uses it by the kilogram, that is a decision
 * for a person, made once, not something to infer.
 */

import type { StockUnit } from "@prisma/client";

export type Dimension = "mass" | "volume" | "count";

/**
 * Every unit as a multiple of its dimension's base: grams, millilitres, or one
 * of a thing.
 *
 * The imperial factors are the international definitions, not rounded ones —
 * 1 lb is exactly 453.59237 g by treaty, and US fluid measures are defined off
 * the gallon at exactly 3.785411784 L. Rounding them here would put a slow
 * drift into food cost that nobody could trace.
 */
const UNITS: Record<StockUnit, { dimension: Dimension; perBase: number; label: string }> = {
  // mass — base: gram
  g: { dimension: "mass", perBase: 1, label: "g" },
  kg: { dimension: "mass", perBase: 1000, label: "kg" },
  oz: { dimension: "mass", perBase: 28.349523125, label: "oz" },
  lb: { dimension: "mass", perBase: 453.59237, label: "lb" },

  // volume — base: millilitre. US customary, because the customers are American.
  ml: { dimension: "volume", perBase: 1, label: "ml" },
  l: { dimension: "volume", perBase: 1000, label: "L" },
  floz: { dimension: "volume", perBase: 29.5735295625, label: "fl oz" },
  gal: { dimension: "volume", perBase: 3785.411784, label: "gal" },

  // count — base: one
  pcs: { dimension: "count", perBase: 1, label: "pcs" },
  each: { dimension: "count", perBase: 1, label: "each" },
};

export function dimensionOf(unit: StockUnit): Dimension {
  return UNITS[unit]?.dimension ?? "count";
}

export function unitLabel(unit: StockUnit): string {
  return UNITS[unit]?.label ?? String(unit);
}

/** Can a quantity in `from` be expressed in `to` without inventing anything? */
export function isConvertible(from: StockUnit, to: StockUnit): boolean {
  return !!UNITS[from] && !!UNITS[to] && UNITS[from].dimension === UNITS[to].dimension;
}

/**
 * Convert a quantity between units of the same dimension.
 *
 * Throws rather than returning null on an impossible conversion: every caller
 * is about to write a stock quantity, and a silent zero there is worse than a
 * crash. `isConvertible` is the check to make first.
 */
export function convert(qty: number, from: StockUnit, to: StockUnit): number {
  if (from === to) return qty;
  if (!isConvertible(from, to)) {
    throw new Error(`Cannot convert ${unitLabel(from)} to ${unitLabel(to)} — different measurements.`);
  }
  return (qty * UNITS[from].perBase) / UNITS[to].perBase;
}

/**
 * Convert a *cost per unit*, which moves the opposite way.
 *
 * Worth spelling out because getting it backwards is easy and the result looks
 * plausible: 1000 g in a kg, so a quantity in grams is 1/1000 of the same
 * quantity in kg — but a price of $2 per kg is $0.002 per gram, not $2000.
 * Inverting this would multiply a restaurant's food cost by a million and the
 * dashboard would simply report it.
 */
export function convertCost(costPerUnit: number, from: StockUnit, to: StockUnit): number {
  if (from === to) return costPerUnit;
  if (!isConvertible(from, to)) {
    throw new Error(`Cannot convert a ${unitLabel(from)} price to ${unitLabel(to)}.`);
  }
  return (costPerUnit * UNITS[to].perBase) / UNITS[from].perBase;
}

/**
 * The same pack size expressed as one comparable number.
 *
 * Used to answer "is this the same pack?" — 500 g and 0.5 kg are, 500 g and
 * 1 kg are not. Returns null when there is nothing to compare, and a null must
 * never be treated as a match: two items with no pack size recorded are not
 * thereby the same pack.
 */
export function packInBase(size: number | null | undefined, unit: StockUnit | null | undefined): number | null {
  if (size == null || !unit || !UNITS[unit]) return null;
  return size * UNITS[unit].perBase;
}

/** Are two recorded pack sizes the same thing? Tolerant of float drift. */
export function samePack(
  aSize: number | null | undefined,
  aUnit: StockUnit | null | undefined,
  bSize: number | null | undefined,
  bUnit: StockUnit | null | undefined,
): boolean {
  const a = packInBase(aSize, aUnit);
  const b = packInBase(bSize, bUnit);
  if (a == null || b == null) return false;
  if (aUnit && bUnit && dimensionOf(aUnit) !== dimensionOf(bUnit)) return false;
  // Relative tolerance: 0.1% covers 453.59237 vs a hand-typed 453.6 without
  // ever merging a 500 g pack into a 1 kg one.
  return Math.abs(a - b) <= Math.max(a, b) * 0.001;
}

/** "500 g", "1.5 L", "12 pcs" — for showing a pack size in a sentence. */
export function formatPack(size: number | null | undefined, unit: StockUnit | null | undefined): string {
  if (size == null || !unit) return "";
  const n = Number.isInteger(size) ? String(size) : String(Number(size.toFixed(3)));
  return `${n} ${unitLabel(unit)}`;
}

/** The units that can share a shelf with this one, for a "convert to" picker. */
export function compatibleUnits(unit: StockUnit): StockUnit[] {
  const d = dimensionOf(unit);
  return (Object.keys(UNITS) as StockUnit[]).filter((u) => UNITS[u].dimension === d);
}
