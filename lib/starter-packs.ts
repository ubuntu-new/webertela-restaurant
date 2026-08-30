import type { StockUnit } from "@prisma/client";

/**
 * What a kitchen of this kind already has on its shelves.
 *
 * Onboarding is where restaurant software dies, and the reason is not that the
 * owner does not understand what to do. He understands perfectly. The reason is
 * **typing**: forty ingredients, their units, their groups, ten toppings, and
 * the portion of each one that goes on a pizza. Two days of it, before the
 * software has told him a single true thing about his business.
 *
 * Almost none of that is specific to him. Two pizzerias hold the same flour,
 * the same mozzarella, the same boxes, and put roughly the same weight of
 * cheese on a 16-inch pie. The part that is his — the menu, the prices, the
 * names on the board — is the part he actually wants to type.
 *
 * So a pack carries the boring half and never the interesting half:
 *
 *   ✓ stock items, with the right unit and a typical purchase pack
 *   ✓ toppings
 *   ✓ how much of which ingredient each topping uses, per size
 *   ✗ products, prices, the menu — those are the restaurant
 *
 * The numbers are not invented. They are the ones the demo trades on, which is
 * to say they have produced a coherent food cost across ninety days of orders:
 * a 16-inch pie takes 420 g of mozzarella, which is about fourteen ounces, and
 * is why cheese is roughly 60% of a pizza's ingredient cost.
 *
 * **No minimums or targets.** A threshold is a promise about days, not about
 * kilograms, and on day one there is no consumption to measure it against. A
 * pack that guessed would put a number on the replenishment screen that nobody
 * chose and nobody can check — which is exactly the failure that produced a
 * demand for 783 kg of mozzarella. The thresholds arrive after the first weeks
 * of trading, when the software can propose them from real usage.
 */

export interface PackItem {
  name: { en: string; ka: string };
  unit: StockUnit;
  /** "dairy" | "meat" | "veg" | "dry" | "bakery" | "packaging" | "drink" */
  category: string;
  /** What one purchased pack typically holds — the field that tells two pack
   *  sizes of the same product apart. Left off where it genuinely varies. */
  packSize?: number;
  packUnit?: StockUnit;
}

export interface PackTopping {
  name: { en: string; ka: string };
  category: string;
  emoji: string;
  popular?: boolean;
  /**
   * The ingredient this topping consumes, and how much at each size.
   *
   * `item` is the English name of a PackItem in the same pack. Names rather
   * than ids, because the rule has to survive being matched against stock items
   * the restaurant already had before the pack was applied.
   */
  consumes?: { item: string; perSize: [number, number, number] };
}

export interface StarterPack {
  id: string;
  emoji: string;
  name: string;
  /** One sentence, in the owner's terms, about what he is about to get. */
  description: string;
  items: PackItem[];
  toppings: PackTopping[];
}

// ── packaging, shared by every kind of place ─────────────────────────────────
// Applied with any pack. Two packs both wanting a paper bag is not a problem:
// the duplicate check matches on the normalised name and skips what exists.
const BAG: PackItem = { name: { en: "Paper bag + napkins", ka: "პარკი და ხელსახოცი" }, unit: "each", category: "packaging" };

export const STARTER_PACKS: StarterPack[] = [
  {
    id: "pizzeria",
    emoji: "🍕",
    name: "Pizzeria",
    description:
      "Dough, sauce, cheese, the usual toppings and the three box sizes — with the portion of each topping already written down per pizza size.",
    items: [
      { name: { en: "Flour '00'", ka: "ფქვილი" }, unit: "kg", category: "dry", packSize: 25, packUnit: "kg" },
      { name: { en: "Olive oil", ka: "ზეითუნის ზეთი" }, unit: "l", category: "dry", packSize: 5, packUnit: "l" },
      { name: { en: "Pizza sauce", ka: "პიცის სოუსი" }, unit: "kg", category: "dry", packSize: 3, packUnit: "kg" },
      { name: { en: "Garlic cream sauce", ka: "ნიორის სოუსი" }, unit: "kg", category: "dairy", packSize: 2, packUnit: "kg" },
      { name: { en: "Mozzarella", ka: "მოცარელა" }, unit: "kg", category: "dairy", packSize: 2.27, packUnit: "kg" },
      { name: { en: "Ricotta", ka: "რიკოტა" }, unit: "kg", category: "dairy", packSize: 1.36, packUnit: "kg" },
      { name: { en: "Parmesan", ka: "პარმეზანი" }, unit: "kg", category: "dairy", packSize: 1, packUnit: "kg" },
      { name: { en: "Garlic butter", ka: "ნიორის კარაქი" }, unit: "kg", category: "dairy" },
      { name: { en: "Pepperoni", ka: "პეპერონი" }, unit: "kg", category: "meat", packSize: 2.27, packUnit: "kg" },
      { name: { en: "Italian sausage", ka: "სოსისი" }, unit: "kg", category: "meat" },
      { name: { en: "Mushrooms", ka: "სოკო" }, unit: "kg", category: "veg" },
      { name: { en: "Red onion", ka: "წითელი ხახვი" }, unit: "kg", category: "veg" },
      { name: { en: "Bell pepper", ka: "წიწაკა" }, unit: "kg", category: "veg" },
      { name: { en: "Black olives", ka: "ზეთისხილი" }, unit: "kg", category: "veg" },
      { name: { en: "Fresh garlic", ka: "ნიორი" }, unit: "kg", category: "veg" },
      { name: { en: "Fresh basil", ka: "ბაზილიკი" }, unit: "kg", category: "veg" },
      { name: { en: 'Pizza box 12"', ka: 'პიცის ყუთი 12"' }, unit: "each", category: "packaging", packSize: 50, packUnit: "each" },
      { name: { en: 'Pizza box 16"', ka: 'პიცის ყუთი 16"' }, unit: "each", category: "packaging", packSize: 50, packUnit: "each" },
      { name: { en: 'Pizza box 18"', ka: 'პიცის ყუთი 18"' }, unit: "each", category: "packaging", packSize: 50, packUnit: "each" },
      BAG,
    ],
    toppings: [
      // 9.5 / 14.8 / 18.7 oz across the three sizes. American pizzerias are
      // generous with cheese, and this one line is most of a pizza's cost.
      { name: { en: "Mozzarella", ka: "მოცარელა" }, category: "cheese", emoji: "🧀", popular: true, consumes: { item: "Mozzarella", perSize: [0.27, 0.42, 0.53] } },
      { name: { en: "Pepperoni", ka: "პეპერონი" }, category: "meat", emoji: "🍖", popular: true, consumes: { item: "Pepperoni", perSize: [0.09, 0.13, 0.165] } },
      { name: { en: "Italian Sausage", ka: "სოსისი" }, category: "meat", emoji: "🌭", popular: true, consumes: { item: "Italian sausage", perSize: [0.085, 0.125, 0.155] } },
      { name: { en: "Mushrooms", ka: "სოკო" }, category: "veg", emoji: "🍄", popular: true, consumes: { item: "Mushrooms", perSize: [0.06, 0.09, 0.115] } },
      { name: { en: "Red Onion", ka: "წითელი ხახვი" }, category: "veg", emoji: "🧅", consumes: { item: "Red onion", perSize: [0.05, 0.075, 0.095] } },
      { name: { en: "Bell Pepper", ka: "წიწაკა" }, category: "veg", emoji: "🫑", consumes: { item: "Bell pepper", perSize: [0.05, 0.075, 0.095] } },
      { name: { en: "Black Olives", ka: "ზეთისხილი" }, category: "veg", emoji: "🫒", consumes: { item: "Black olives", perSize: [0.04, 0.06, 0.075] } },
      { name: { en: "Ricotta", ka: "რიკოტა" }, category: "cheese", emoji: "🧀", consumes: { item: "Ricotta", perSize: [0.09, 0.13, 0.16] } },
      { name: { en: "Roasted Garlic", ka: "შემწვარი ნიორი" }, category: "veg", emoji: "🧄", consumes: { item: "Fresh garlic", perSize: [0.012, 0.018, 0.022] } },
      { name: { en: "Fresh Basil", ka: "ბაზილიკი" }, category: "veg", emoji: "🌿", consumes: { item: "Fresh basil", perSize: [0.005, 0.008, 0.01] } },
    ],
  },

  {
    id: "burgers",
    emoji: "🍔",
    name: "Burgers & fried",
    description:
      "Patties, buns, the salad and sauces that go on them, fries and fryer oil — counted the way a grill actually buys them, by the each rather than by weight.",
    items: [
      { name: { en: "Beef patty 3oz", ka: "ხორცის კოტლეტი" }, unit: "each", category: "meat", packSize: 40, packUnit: "each" },
      { name: { en: "Breaded chicken fillet", ka: "ქათმის ფილე" }, unit: "each", category: "meat", packSize: 24, packUnit: "each" },
      { name: { en: "Veggie patty", ka: "ვეგეტარიანული კოტლეტი" }, unit: "each", category: "veg", packSize: 24, packUnit: "each" },
      { name: { en: "Brioche bun", ka: "ბრიოშ ბულკა" }, unit: "each", category: "bakery", packSize: 12, packUnit: "each" },
      { name: { en: "American cheese slice", ka: "ამერიკული ყველი" }, unit: "each", category: "dairy", packSize: 120, packUnit: "each" },
      { name: { en: "Lettuce", ka: "სალათის ფოთოლი" }, unit: "kg", category: "veg" },
      { name: { en: "Tomato", ka: "პომიდორი" }, unit: "kg", category: "veg" },
      { name: { en: "Pickles", ka: "მწნილი" }, unit: "kg", category: "veg", packSize: 5, packUnit: "kg" },
      { name: { en: "House burger sauce", ka: "ბურგერის სოუსი" }, unit: "l", category: "dry", packSize: 3.78, packUnit: "l" },
      { name: { en: "Frozen fries", ka: "გაყინული კარტოფილი" }, unit: "kg", category: "dry", packSize: 11.34, packUnit: "kg" },
      { name: { en: "Fryer oil", ka: "შესაწვავი ზეთი" }, unit: "l", category: "dry", packSize: 15.14, packUnit: "l" },
      { name: { en: "Clamshell box", ka: "ყუთი" }, unit: "each", category: "packaging", packSize: 200, packUnit: "each" },
      BAG,
    ],
    toppings: [
      { name: { en: "Extra patty", ka: "დამატებითი კოტლეტი" }, category: "meat", emoji: "🥩", popular: true, consumes: { item: "Beef patty 3oz", perSize: [1, 1, 1] } },
      { name: { en: "Extra cheese", ka: "დამატებითი ყველი" }, category: "cheese", emoji: "🧀", popular: true, consumes: { item: "American cheese slice", perSize: [1, 1, 1] } },
      { name: { en: "Pickles", ka: "მწნილი" }, category: "veg", emoji: "🥒", consumes: { item: "Pickles", perSize: [0.015, 0.015, 0.015] } },
    ],
  },

  {
    id: "coffee",
    emoji: "☕",
    name: "Coffee bar",
    description:
      "Beans, milk and cups. Small next to a kitchen, and the one place where a few grams either way is the whole margin.",
    items: [
      { name: { en: "Espresso beans", ka: "ყავის მარცვალი" }, unit: "kg", category: "drink", packSize: 1, packUnit: "kg" },
      { name: { en: "Whole milk", ka: "რძე" }, unit: "l", category: "dairy", packSize: 3.78, packUnit: "l" },
      { name: { en: "Oat milk", ka: "შვრიის რძე" }, unit: "l", category: "dairy", packSize: 1, packUnit: "l" },
      { name: { en: "Cold brew concentrate", ka: "ცივი ყავის კონცენტრატი" }, unit: "l", category: "drink" },
      { name: { en: "Drinking chocolate", ka: "შოკოლადი" }, unit: "kg", category: "drink" },
      { name: { en: "Hot cup 12oz + lid", ka: "ჭიქა 12oz" }, unit: "each", category: "packaging", packSize: 100, packUnit: "each" },
      { name: { en: "Cup 16oz + lid", ka: "ჭიქა 16oz" }, unit: "each", category: "packaging", packSize: 100, packUnit: "each" },
      BAG,
    ],
    toppings: [
      { name: { en: "Extra shot", ka: "დამატებითი შოტი" }, category: "other", emoji: "☕", popular: true, consumes: { item: "Espresso beans", perSize: [0.009, 0.009, 0.009] } },
      { name: { en: "Oat milk", ka: "შვრიის რძე" }, category: "other", emoji: "🌾", popular: true, consumes: { item: "Oat milk", perSize: [0.24, 0.34, 0.34] } },
    ],
  },
];

export function packById(id: string): StarterPack | undefined {
  return STARTER_PACKS.find((p) => p.id === id);
}
