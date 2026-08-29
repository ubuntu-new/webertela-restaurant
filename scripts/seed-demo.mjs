// scripts/seed-demo.mjs
//
// The `mixed` demo dataset — one venue selling pizza, burgers and coffee,
// with ninety days of trading behind it.
//
//   node scripts/seed-demo.mjs
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ONE RULE
//
// Every figure on the dashboard is derived, never typed. Food cost is not a
// constant: it is the sum of `StockMovement` rows of type `sale`, each priced
// at the moving average that the branch's stock had at that minute, which in
// turn comes from receipts booked at real purchase prices. Labour is the sum
// of `Shift` rows times `Employee.hourlyRate`. If a prospect clicks from 31%
// into the ingredients, the arithmetic holds — because the arithmetic is what
// produced the 31%.
//
// The only numbers chosen by hand are the ones a restaurant actually chooses:
// menu prices, purchase prices, portion sizes, hourly rates, the rota, and how
// much stock to order. Everything downstream is computed.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS SCRIPT RE-IMPLEMENTS lib/consumption.ts AND lib/costing.ts
//
// It would be better to call them. It cannot:
//
//   1. they are TypeScript with `import "server-only"` and `@/lib/*` path
//      aliases — a plain .mjs run under node cannot load them;
//   2. `recordMovement` + `applyOutgoingCost` do three round trips per stock
//      line. Ninety days is ~45,000 sale movements, i.e. ~135,000 queries.
//
// So the consumption walk below is a line-for-line mirror of
// `lib/consumption.ts` (`pick()`, the recipe+extras merge, the half-and-half
// halving) and the costing is a line-for-line mirror of `lib/costing.ts`
// (moving average on receipt, current average on the way out, 4 dp / 2 dp
// rounding). Every deviation is marked `DEVIATION:` in a comment.
//
// If either library changes, this file has to change with it. That is the cost
// of the speed-up and it is written down here so nobody has to discover it.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";

// ═════════════════════════════════════════════════════════════════════════════
// 0. SAFETY
//    This script deletes. Pointed at a live restaurant it would delete that
//    restaurant. So it refuses to run anywhere that has not declared itself a
//    demo, it says out loud which database it is about to touch, and it counts
//    the rows before it removes them.
// ═════════════════════════════════════════════════════════════════════════════

const ARGV = process.argv.slice(2);
const FORCE = ARGV.includes("--force");

function databaseLabel(raw) {
  if (!raw) return "(DATABASE_URL is not set)";
  try {
    const u = new URL(raw);
    const name = decodeURIComponent(u.pathname.replace(/^\//, "")) || "(no database in URL)";
    return `${name}  on  ${u.hostname}:${u.port || "5432"}  as ${u.username || "?"}`;
  } catch {
    // A password with an unescaped '@' or '#' breaks URL(). Fall back to a
    // regex rather than refusing to print anything — the operator needs to see
    // *something* before a destructive run.
    const m = /\/([^/?#]+)(\?|#|$)/.exec(raw.replace(/^[a-z+]+:\/\//i, ""));
    return m ? `${m[1]}  (URL could not be fully parsed)` : "(unparsable DATABASE_URL)";
  }
}

if (process.env.DEMO_MODE !== "1" && !FORCE) {
  console.error("");
  console.error("  REFUSING TO RUN.");
  console.error("");
  console.error("  This script wipes and reseeds a restaurant's data. It only runs");
  console.error("  against an instance that has declared itself a demo:");
  console.error("");
  console.error("      DEMO_MODE=1 node scripts/seed-demo.mjs");
  console.error("");
  console.error("  If you genuinely mean to run it somewhere else, pass --force and");
  console.error("  read the database name it prints before answering the prompt.");
  console.error("");
  console.error(`  DATABASE_URL currently points at:  ${databaseLabel(process.env.DATABASE_URL)}`);
  console.error("");
  process.exit(1);
}

const db = new PrismaClient();

console.log("");
console.log("╭──────────────────────────────────────────────────────────────────────╮");
console.log("│  webertela — demo seed  ·  dataset: mixed  ·  90 days of trading      │");
console.log("╰──────────────────────────────────────────────────────────────────────╯");
console.log("");
console.log(`  database   ${databaseLabel(process.env.DATABASE_URL)}`);
console.log(`  DEMO_MODE  ${process.env.DEMO_MODE === "1" ? "1" : `not set  (running under --force)`}`);
console.log(`  timezone   ${Intl.DateTimeFormat().resolvedOptions().timeZone} — order hours are written in local time,`);
console.log(`             so run this with the same TZ the app runs under (America/New_York).`);
console.log("");

// ═════════════════════════════════════════════════════════════════════════════
// 1. DETERMINISM
//    One fixed constant seeds everything. Two runs produce byte-identical
//    figures, which is what makes "the demo showed 31% yesterday" a statement
//    anyone can check.
// ═════════════════════════════════════════════════════════════════════════════

const SEED = 0x5eed_c0de;

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// `let`, not `const`: order generation swaps in a stream seeded from the day
// and the order's index within it, so order (day 7, ticket 12) is always the
// same order no matter how many tickets the other days end up having. That is
// what lets the growth line be solved for rather than guessed at — see the
// bisection further down.
let rng = mulberry32(SEED);

const chance = (p) => rng() < p;
const randint = (a, b) => a + Math.floor(rng() * (b - a + 1));
const jitter = (v, pct) => v * (1 - pct + rng() * 2 * pct);

/** entries: [[value, weight], …] */
function wpick(entries) {
  let total = 0;
  for (const e of entries) total += e[1];
  let r = rng() * total;
  for (const e of entries) {
    r -= e[1];
    if (r <= 0) return e[0];
  }
  return entries[entries.length - 1][0];
}

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
const r4 = (n) => Math.round(n * 10000) / 10000;

// ═════════════════════════════════════════════════════════════════════════════
// 2. THE CALENDAR AND THE SHAPE OF TRADE
//
//    Three multipliers stack: weekday × trend × noise.
//
//    · WEEKDAY — Friday and Saturday are roughly double Monday and Tuesday.
//      A flat line is the first thing that tells a restaurateur the data is
//      invented. Normalised to mean 1 so BASE_ORDERS stays readable.
//
//    · TREND — a straight line across the ninety days. The slope is not chosen;
//      it is solved for, so that the last thirty days' takings come out 12%
//      ahead of the thirty before them. See "the growth line" in section 10.
//
//    · NOISE — ±10% per day. Restaurants have weather.
//
//    Within the day, orders fall on an hour curve: a lunch bump at 12–13, the
//    real peak at 18–20, a tail to 21.
// ═════════════════════════════════════════════════════════════════════════════

const DAYS = 90;

const NOW = new Date();
const TODAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());

/** day 0 = ninety days ago · day 89 = yesterday (the last complete trading day) */
function dayDate(d) {
  return new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - (DAYS - d));
}
function at(d, hour, minute = 0, second = 0) {
  return new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - (DAYS - d), hour, minute, second);
}

// Sun … Sat. Fri/Sat ≈ 2× Mon/Tue.
const WEEKDAY_RAW = [1.1, 0.72, 0.7, 0.85, 0.95, 1.45, 1.5];
const WEEKDAY_MEAN = WEEKDAY_RAW.reduce((s, x) => s + x, 0) / 7;
const weekday = (dow) => WEEKDAY_RAW[dow] / WEEKDAY_MEAN;

// Weekday shape and weather, drawn once so the trend can be solved against
// the days that actually exist rather than against an idealised average.
const DAY_SHAPE = Array.from({ length: DAYS }, (_, d) => weekday(dayDate(d).getDay()) * jitter(1, 0.1));

// The growth target. The slope that delivers it is solved for after the orders
// exist — see "the growth line" below section 10.
const GROWTH = 1.12;

// Trading hours 11:00 → 21:45. Weights, not counts.
const HOUR_WEIGHTS = [
  [11, 0.35],
  [12, 1.0],
  [13, 0.85],
  [14, 0.45],
  [15, 0.3],
  [16, 0.4],
  [17, 0.75],
  [18, 1.35],
  [19, 1.5],
  [20, 1.2],
  [21, 0.55],
];

// ── TUNING ──────────────────────────────────────────────────────────────────
// The only dial that moves the whole model. It was solved backwards from the
// targets in DEMO.md, which are only mutually satisfiable inside a narrow band:
//
//   net profit  = 100% − food% − labour% − (fixed ÷ revenue)
//
// With food ≈ 31% and labour ≈ 27%, and fixed costs of $9,200/month, net profit
// lands in 8–11% only when revenue is roughly $27–29k/month. Higher, and the
// fixed costs stop biting: net profit climbs past 15% and the demo starts
// lying. Lower, and the restaurant loses money. About $925/day is that band —
// and it happens to be exactly the size of a real Monroe pizzeria.
//
// Measured across all seven possible weekday starts, 32 gives food 30.7–31.0%,
// labour 26.6–26.9%, prime 57.3–57.8%, net 8.8–9.9%. If a run misses a target,
// this is the number to move first.
const BASE_ORDERS = 32; // mean orders per day, before weekday/trend/noise

const FIXED_COSTS = { rent: 5200, utilities: 1450, other: 2550 }; // $9,200/month

// ═════════════════════════════════════════════════════════════════════════════
// 3. THE WORLD
// ═════════════════════════════════════════════════════════════════════════════

const ORG_ID = "org-demo";
const BRANCH_ID = "br-monroe";
const BRANCH_CODE = "MON-01";
const POS_1 = "MON-01-POS-1";
const POS_2 = "MON-01-POS-2";
const LOC_WAREHOUSE = "loc-warehouse";
const LOC_BRANCH = "loc-br-monroe";

// ── categories ───────────────────────────────────────────────────────────────
//
// NOTE ON THE IDS. `lib/menu-db.ts` still keys the customer-facing menu off
// three hard-coded category ids — `cat-sides` → EXTRAS, `cat-drinks` → DRINKS,
// `cat-sauces` → SAUCES — and off `Product.type === "pizza"` for the pizza
// section. That is Wave-1 work that has not landed yet.
//
// A product filed under any other category id is invisible on the public site.
// So the ids here are the legacy plumbing and the *names* are the menu the
// prospect reads. Burgers and sides share the `cat-sides` bucket and are
// separated by subcategory, which is how the admin displays them anyway.
// When menu-db moves onto categories properly, only these three ids change.
const CATEGORIES = [
  { id: "cat-pizza", name: { en: "Pizza", ka: "პიცა" }, icon: "🍕", sortOrder: 1 },
  { id: "cat-sides", name: { en: "Kitchen", ka: "სამზარეულო" }, icon: "🍔", sortOrder: 2 },
  { id: "cat-drinks", name: { en: "Coffee bar", ka: "ყავა" }, icon: "☕", sortOrder: 3 },
];

const SUBCATEGORIES = [
  { id: "sub-pizza-classic", categoryId: "cat-pizza", name: { en: "Classic", ka: "კლასიკური" }, sortOrder: 1 },
  { id: "sub-pizza-house", categoryId: "cat-pizza", name: { en: "House pies", ka: "სახლის" }, sortOrder: 2 },
  { id: "sub-burgers", categoryId: "cat-sides", name: { en: "Burgers", ka: "ბურგერები" }, sortOrder: 1 },
  { id: "sub-sides", categoryId: "cat-sides", name: { en: "Sides & sweets", ka: "გარნირი და ტკბილეული" }, sortOrder: 2 },
  { id: "sub-coffee", categoryId: "cat-drinks", name: { en: "Espresso bar", ka: "ესპრესო" }, sortOrder: 1 },
  { id: "sub-cold", categoryId: "cat-drinks", name: { en: "Cold & other", ka: "ცივი" }, sortOrder: 2 },
];

const SIZE_KEYS = ["S", "M", "XL"];

// ── the sixteen products ─────────────────────────────────────────────────────
//
// Capability flags per DEMO.md:
//   pizza   hasSizes · hasModifiers · splittable   sizes in inches
//   burger  hasModifiers                           flat price
//   coffee  hasSizes · hasModifiers                sizes in oz
//   side    hasModifiers                           flat price
//
// `taxable` is true throughout: New York taxes every prepared-food sale a
// restaurant makes, hot or cold, eat-in or out. The flag exists for the states
// where that is not true.
const PRODUCTS = [
  // ── pizza (type kept as "pizza" because menu-db still reads it) ──
  {
    id: "pizza-1", legacyId: 1, type: "pizza", categoryId: "cat-pizza", subcategoryId: "sub-pizza-classic",
    name: { en: "Margherita", ka: "მარგარიტა" },
    description: { en: "Tomato, fresh mozzarella, basil", ka: "" },
    emoji: "🍕", tier: "standard", sortOrder: 1,
    hasSizes: true, hasModifiers: true, splittable: true, hasVariants: false,
    sizeMeta: { unit: "in" },
    sizes: [{ key: "S", inches: 12, price: 14 }, { key: "M", inches: 16, price: 19 }, { key: "XL", inches: 18, price: 23 }],
    recipe: ["top-mozzarella", "top-basil"],
  },
  {
    id: "pizza-2", legacyId: 2, type: "pizza", categoryId: "cat-pizza", subcategoryId: "sub-pizza-classic",
    name: { en: "Pepperoni", ka: "პეპერონი" },
    description: { en: "Cup-and-char pepperoni, mozzarella", ka: "" },
    emoji: "🍕", tier: "standard", sortOrder: 2,
    hasSizes: true, hasModifiers: true, splittable: true, hasVariants: false,
    sizeMeta: { unit: "in" },
    sizes: [{ key: "S", inches: 12, price: 16 }, { key: "M", inches: 16, price: 21 }, { key: "XL", inches: 18, price: 25 }],
    recipe: ["top-mozzarella", "top-pepperoni"],
  },
  {
    id: "pizza-3", legacyId: 3, type: "pizza", categoryId: "cat-pizza", subcategoryId: "sub-pizza-house",
    name: { en: "White Garlic", ka: "თეთრი ნიორი" },
    description: { en: "Garlic cream, ricotta, mozzarella — no tomato", ka: "" },
    emoji: "🧄", tier: "house", sortOrder: 3,
    hasSizes: true, hasModifiers: true, splittable: true, hasVariants: false,
    sizeMeta: { unit: "in" },
    sizes: [{ key: "S", inches: 12, price: 16 }, { key: "M", inches: 16, price: 22 }, { key: "XL", inches: 18, price: 26 }],
    recipe: ["top-mozzarella", "top-ricotta", "top-garlic"],
  },
  {
    id: "pizza-4", legacyId: 4, type: "pizza", categoryId: "cat-pizza", subcategoryId: "sub-pizza-house",
    name: { en: "Build your own", ka: "ჩემი პიცა" },
    description: { en: "Start with cheese, add what you like", ka: "" },
    emoji: "🛠️", tier: "standard", isBYO: true, sortOrder: 4,
    hasSizes: true, hasModifiers: true, splittable: true, hasVariants: false,
    sizeMeta: { unit: "in" },
    sizes: [{ key: "S", inches: 12, price: 13 }, { key: "M", inches: 16, price: 17 }, { key: "XL", inches: 18, price: 21 }],
    recipe: ["top-mozzarella"],
  },

  // ── burgers: modifiers, no sizes, not splittable ──
  {
    id: "side-classic-smash", type: "item", categoryId: "cat-sides", subcategoryId: "sub-burgers",
    name: { en: "Classic Smash", ka: "კლასიკური სმეში" },
    description: { en: "Two smashed patties, American cheese, house sauce", ka: "" },
    emoji: "🍔", price: 11, sortOrder: 10,
    hasSizes: false, hasModifiers: true, splittable: false, hasVariants: false,
  },
  {
    id: "side-double-smash", type: "item", categoryId: "cat-sides", subcategoryId: "sub-burgers",
    name: { en: "Double Smash", ka: "ორმაგი სმეში" },
    description: { en: "Four patties, four slices of cheese", ka: "" },
    emoji: "🍔", price: 15, sortOrder: 11,
    hasSizes: false, hasModifiers: true, splittable: false, hasVariants: false,
  },
  {
    id: "side-crispy-chicken", type: "item", categoryId: "cat-sides", subcategoryId: "sub-burgers",
    name: { en: "Crispy Chicken", ka: "ხრაშუნა ქათამი" },
    description: { en: "Buttermilk chicken, pickles, ranch", ka: "" },
    emoji: "🍗", price: 12, sortOrder: 12,
    hasSizes: false, hasModifiers: true, splittable: false, hasVariants: false,
  },
  {
    id: "side-veggie-burger", type: "item", categoryId: "cat-sides", subcategoryId: "sub-burgers",
    name: { en: "Veggie Burger", ka: "ვეგეტარიანული ბურგერი" },
    description: { en: "Black bean and beetroot patty", ka: "" },
    emoji: "🥬", price: 11, sortOrder: 13,
    hasSizes: false, hasModifiers: true, splittable: false, hasVariants: false,
  },

  // ── sides & sweets ──
  {
    id: "side-garlic-knots", type: "item", categoryId: "cat-sides", subcategoryId: "sub-sides",
    name: { en: "Garlic Knots", ka: "ნიორის კვანძები" },
    description: { en: "Six, with parmesan and a cup of marinara", ka: "" },
    emoji: "🥖", price: 6, sortOrder: 20,
    hasSizes: false, hasModifiers: true, splittable: false, hasVariants: false,
  },
  {
    id: "side-fries", type: "item", categoryId: "cat-sides", subcategoryId: "sub-sides",
    name: { en: "Fries", ka: "კარტოფილი ფრი" },
    description: { en: "Skin-on, sea salt", ka: "" },
    emoji: "🍟", price: 4, sortOrder: 21,
    hasSizes: false, hasModifiers: true, splittable: false, hasVariants: false,
  },
  {
    id: "side-cheesecake", type: "item", categoryId: "cat-sides", subcategoryId: "sub-sides",
    name: { en: "Cheesecake slice", ka: "ჩიზქეიქი" },
    description: { en: "New York style, from the bakery on Route 17", ka: "" },
    emoji: "🍰", price: 7, sortOrder: 22,
    hasSizes: false, hasModifiers: true, splittable: false, hasVariants: false,
  },
  {
    id: "side-cookie", type: "item", categoryId: "cat-sides", subcategoryId: "sub-sides",
    name: { en: "Cookie", ka: "ნამცხვარი" },
    description: { en: "Baked through the day", ka: "" },
    emoji: "🍪", price: 3, sortOrder: 23,
    hasSizes: false, hasModifiers: true, splittable: false, hasVariants: false,
  },

  // ── coffee: sizes in ounces ──
  {
    id: "drink-drip", type: "drink", categoryId: "cat-drinks", subcategoryId: "sub-coffee",
    name: { en: "Drip Coffee", ka: "ფილტრის ყავა" },
    description: { en: "Brewed every forty minutes", ka: "" },
    emoji: "☕", price: 2.75, sortOrder: 30,
    hasSizes: true, hasModifiers: true, splittable: false, hasVariants: false,
    sizeMeta: { unit: "oz" },
    sizes: [{ key: "S", oz: 12, price: 2.75 }, { key: "M", oz: 16, price: 3.25 }],
  },
  {
    id: "drink-latte", type: "drink", categoryId: "cat-drinks", subcategoryId: "sub-coffee",
    name: { en: "Latte", ka: "ლატე" },
    description: { en: "Double shot, steamed whole milk", ka: "" },
    emoji: "🥛", price: 4.5, sortOrder: 31,
    hasSizes: true, hasModifiers: true, splittable: false, hasVariants: false,
    sizeMeta: { unit: "oz" },
    sizes: [{ key: "S", oz: 12, price: 4.5 }, { key: "M", oz: 16, price: 5.25 }],
  },
  {
    id: "drink-cold-brew", type: "drink", categoryId: "cat-drinks", subcategoryId: "sub-cold",
    name: { en: "Cold Brew", ka: "ცივი ყავა" },
    description: { en: "Sixteen hours, no heat", ka: "" },
    emoji: "🧊", price: 5, sortOrder: 32,
    hasSizes: true, hasModifiers: true, splittable: false, hasVariants: false,
    sizeMeta: { unit: "oz" },
    sizes: [{ key: "M", oz: 16, price: 5 }],
  },
  {
    id: "drink-hot-chocolate", type: "drink", categoryId: "cat-drinks", subcategoryId: "sub-cold",
    name: { en: "Hot Chocolate", ka: "ცხელი შოკოლადი" },
    description: { en: "Dark, with whole milk", ka: "" },
    emoji: "🍫", price: 4, sortOrder: 33,
    hasSizes: true, hasModifiers: true, splittable: false, hasVariants: false,
    sizeMeta: { unit: "oz" },
    sizes: [{ key: "S", oz: 12, price: 4 }],
  },
];

const PRODUCT_BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));
const PIZZAS = PRODUCTS.filter((p) => p.type === "pizza");

// ── toppings ─────────────────────────────────────────────────────────────────
// The English name is load-bearing: `lib/consumption.ts` maps an order's
// `config.toppings` keys onto Topping rows by `name.en`. Change one and the
// deduction silently stops happening for that topping.
const TOPPINGS = [
  { id: "top-mozzarella", name: { en: "Mozzarella", ka: "მოცარელა" }, category: "cheese", emoji: "🧀", popular: true, prices: [2.0, 2.75, 3.25] },
  { id: "top-pepperoni", name: { en: "Pepperoni", ka: "პეპერონი" }, category: "meat", emoji: "🍖", popular: true, prices: [2.0, 2.75, 3.25] },
  { id: "top-sausage", name: { en: "Italian Sausage", ka: "სოსისი" }, category: "meat", emoji: "🌭", popular: true, prices: [2.0, 2.75, 3.25] },
  { id: "top-mushroom", name: { en: "Mushrooms", ka: "სოკო" }, category: "veg", emoji: "🍄", popular: true, prices: [1.5, 2.0, 2.5] },
  { id: "top-onion", name: { en: "Red Onion", ka: "წითელი ხახვი" }, category: "veg", emoji: "🧅", popular: false, prices: [1.25, 1.75, 2.0] },
  { id: "top-pepper", name: { en: "Bell Pepper", ka: "წიწაკა" }, category: "veg", emoji: "🫑", popular: false, prices: [1.25, 1.75, 2.0] },
  { id: "top-olives", name: { en: "Black Olives", ka: "ზეთისხილი" }, category: "veg", emoji: "🫒", popular: false, prices: [1.5, 2.0, 2.5] },
  { id: "top-ricotta", name: { en: "Ricotta", ka: "რიკოტა" }, category: "cheese", emoji: "🧀", popular: false, prices: [2.0, 2.75, 3.25] },
  { id: "top-garlic", name: { en: "Roasted Garlic", ka: "შემწვარი ნიორი" }, category: "veg", emoji: "🧄", popular: false, prices: [1.0, 1.25, 1.5] },
  { id: "top-basil", name: { en: "Fresh Basil", ka: "ბაზილიკი" }, category: "veg", emoji: "🌿", popular: false, prices: [1.0, 1.25, 1.5] },
];

const TOPPING_BY_ID = new Map(TOPPINGS.map((t) => [t.id, t]));

// ═════════════════════════════════════════════════════════════════════════════
// 4. STOCK — what the kitchen buys, in the units it buys it in, at what it pays
//
//    `price` is the purchase price in the middle of the ninety days.
//    `drift` is how much it moves across the period, low to high: a purchase
//    price at day d is  price × (1 + drift·(d/89 − ½)), so the mean is `price`
//    and the moving average genuinely moves. Mozzarella drifts 14% — the cheese
//    market did that, and it is why the pizza margin narrows over the period.
//
//    `cadence` decides delivery days: fresh arrives Mon/Wed/Fri, dry weekly on
//    Tuesday. `cover` and `minCover` are par levels, expressed in days, and
//    turned into kilos by measured usage further down.
// ═════════════════════════════════════════════════════════════════════════════

const F = "fresh";
const D = "dry";

const STOCK_ITEMS = [
  // id, sku, name, unit, category, price, drift, cadence
  ["si-flour", "DRY-FLR", { en: "Flour '00'", ka: "ფქვილი" }, "kg", "dry", 1.42, 0.06, D],
  ["si-olive-oil", "DRY-OIL", { en: "Olive oil", ka: "ზეითუნის ზეთი" }, "l", "dry", 9.4, 0.05, D],
  ["si-pizza-sauce", "DRY-SCE", { en: "Pizza sauce", ka: "პიცის სოუსი" }, "kg", "dry", 2.35, 0.04, D],
  ["si-garlic-cream", "FRS-GCR", { en: "Garlic cream sauce", ka: "ნიორის სოუსი" }, "kg", "dairy", 5.1, 0.05, F],
  ["si-mozzarella", "FRS-MOZ", { en: "Mozzarella", ka: "მოცარელა" }, "kg", "dairy", 9.6, 0.14, F],
  ["si-ricotta", "FRS-RIC", { en: "Ricotta", ka: "რიკოტა" }, "kg", "dairy", 6.15, 0.06, F],
  ["si-parmesan", "FRS-PAR", { en: "Parmesan", ka: "პარმეზანი" }, "kg", "dairy", 12.6, 0.06, F],
  ["si-garlic-butter", "FRS-GBT", { en: "Garlic butter", ka: "ნიორის კარაქი" }, "kg", "dairy", 6.3, 0.05, F],
  ["si-pepperoni", "FRS-PEP", { en: "Pepperoni", ka: "პეპერონი" }, "kg", "meat", 11.4, 0.07, F],
  ["si-sausage", "FRS-SAU", { en: "Italian sausage", ka: "სოსისი" }, "kg", "meat", 9.1, 0.08, F],
  ["si-mushroom", "FRS-MSH", { en: "Mushrooms", ka: "სოკო" }, "kg", "veg", 5.3, 0.16, F],
  ["si-onion", "FRS-ONI", { en: "Red onion", ka: "წითელი ხახვი" }, "kg", "veg", 1.55, 0.1, F],
  ["si-pepper", "FRS-BPP", { en: "Bell pepper", ka: "წიწაკა" }, "kg", "veg", 3.75, 0.18, F],
  ["si-olives", "DRY-OLV", { en: "Black olives", ka: "ზეთისხილი" }, "kg", "veg", 6.8, 0.04, D],
  ["si-garlic", "FRS-GRL", { en: "Fresh garlic", ka: "ნიორი" }, "kg", "veg", 5.4, 0.09, F],
  ["si-basil", "FRS-BAS", { en: "Fresh basil", ka: "ბაზილიკი" }, "kg", "veg", 17.5, 0.2, F],
  ["si-beef-patty", "FRS-PTY", { en: "Beef patty 3oz", ka: "ხორცის კოტლეტი" }, "each", "meat", 0.72, 0.09, F],
  ["si-chicken-fillet", "FRS-CHK", { en: "Breaded chicken fillet", ka: "ქათმის ფილე" }, "each", "meat", 2.2, 0.07, F],
  ["si-veggie-patty", "FRS-VEG", { en: "Veggie patty", ka: "ვეგეტარიანული კოტლეტი" }, "each", "veg", 1.95, 0.04, F],
  ["si-bun", "FRS-BUN", { en: "Brioche bun", ka: "ბრიოშ ბულკა" }, "each", "bakery", 0.52, 0.05, F],
  ["si-cheese-slice", "FRS-AMC", { en: "American cheese slice", ka: "ამერიკული ყველი" }, "each", "dairy", 0.17, 0.06, F],
  ["si-lettuce", "FRS-LET", { en: "Lettuce", ka: "სალათის ფოთოლი" }, "kg", "veg", 3.1, 0.15, F],
  ["si-tomato", "FRS-TOM", { en: "Tomato", ka: "პომიდორი" }, "kg", "veg", 3.55, 0.17, F],
  ["si-pickle", "DRY-PKL", { en: "Pickles", ka: "მწნილი" }, "kg", "veg", 4.0, 0.03, D],
  ["si-burger-sauce", "DRY-BSC", { en: "House burger sauce", ka: "ბურგერის სოუსი" }, "l", "dry", 6.3, 0.04, D],
  ["si-fries", "DRY-FRY", { en: "Frozen fries", ka: "გაყინული კარტოფილი" }, "kg", "dry", 2.45, 0.06, D],
  ["si-fry-oil", "DRY-FOL", { en: "Fryer oil", ka: "შესაწვავი ზეთი" }, "l", "dry", 3.05, 0.1, D],
  ["si-coffee-beans", "DRY-CFE", { en: "Espresso beans", ka: "ყავის მარცვალი" }, "kg", "drink", 19.8, 0.06, D],
  ["si-milk", "FRS-MLK", { en: "Whole milk", ka: "რძე" }, "l", "dairy", 1.05, 0.08, F],
  ["si-cold-brew", "DRY-CBR", { en: "Cold brew concentrate", ka: "ცივი ყავის კონცენტრატი" }, "l", "drink", 11.8, 0.04, D],
  ["si-cocoa", "DRY-COC", { en: "Drinking chocolate", ka: "შოკოლადი" }, "kg", "drink", 9.6, 0.05, D],
  // The cheesecake is bought in whole and cut. It is a good cheesecake and the
  // wholesale price says so — this single line is what makes the dessert the
  // worst-margin thing on the menu, and the owner has never checked.
  ["si-cheesecake", "FRS-CHZ", { en: "NY cheesecake, per slice", ka: "ჩიზქეიქი" }, "each", "bakery", 5.55, 0.03, F],
  ["si-cookie-dough", "DRY-CKD", { en: "Cookie dough puck", ka: "ნამცხვრის ცომი" }, "each", "bakery", 0.38, 0.04, D],
  ["si-box-s", "PKG-B12", { en: "Pizza box 12\"", ka: "პიცის ყუთი 12\"" }, "each", "packaging", 0.32, 0.05, D],
  ["si-box-m", "PKG-B16", { en: "Pizza box 16\"", ka: "პიცის ყუთი 16\"" }, "each", "packaging", 0.48, 0.05, D],
  ["si-box-xl", "PKG-B18", { en: "Pizza box 18\"", ka: "პიცის ყუთი 18\"" }, "each", "packaging", 0.58, 0.05, D],
  ["si-clamshell", "PKG-CLM", { en: "Clamshell box", ka: "ყუთი" }, "each", "packaging", 0.26, 0.05, D],
  ["si-dessert-box", "PKG-DST", { en: "Dessert box", ka: "დესერტის ყუთი" }, "each", "packaging", 0.28, 0.05, D],
  ["si-cup-12", "PKG-C12", { en: "Hot cup 12oz + lid", ka: "ჭიქა 12oz" }, "each", "packaging", 0.13, 0.04, D],
  ["si-cup-16", "PKG-C16", { en: "Cup 16oz + lid", ka: "ჭიქა 16oz" }, "each", "packaging", 0.16, 0.04, D],
  ["si-bag", "PKG-BAG", { en: "Paper bag + napkins", ka: "პარკი და ხელსახოცი" }, "each", "packaging", 0.09, 0.03, D],
].map(([id, sku, name, unit, category, price, drift, cadence]) => ({
  id, sku, name, unit, category, price, drift, cadence,
}));

const STOCK_BY_ID = new Map(STOCK_ITEMS.map((s) => [s.id, s]));

/** purchase price on day d — mean over the window is exactly `price` */
function purchasePrice(item, d) {
  return r4(item.price * (1 + item.drift * (d / (DAYS - 1) - 0.5)));
}

// Par levels, in days of measured usage.
//
// Fresh arrives Monday/Wednesday/Friday, so the longest gap is Friday to
// Monday: three calendar days, but nearly five days' worth of trade, and more
// than that at the end of the period when volumes are 18% above the mean.
// Eight days of par absorbs that plus the lumpiness of an item like cheesecake,
// which moves in ones and twos. Six days did not — the first run pushed the
// cheesecake balance negative nine times, which is how the number got here.
const COVER = { fresh: 8.0, dry: 14.0 };
const MIN_COVER = { fresh: 3.0, dry: 6.0 };

// ═════════════════════════════════════════════════════════════════════════════
// 5. RECIPES — ConsumptionRule rows
//
//    A rule belongs to a product OR a topping, never both. `sizeKey` null means
//    "every size". This is the only place a portion is written down, and it is
//    where food cost actually comes from.
//
//    Portions are US pizzeria reality, not the back of a textbook: a 16" pie
//    gets 400 g (14 oz) of mozzarella, which is why cheese is 60% of a pizza's
//    ingredient cost and why the cheese price rise shows up on the dashboard.
// ═════════════════════════════════════════════════════════════════════════════

// index 0/1/2 → S/M/XL
const PIZZA_BASE = {
  "si-flour": [0.22, 0.34, 0.42],
  "si-olive-oil": [0.01, 0.015, 0.019],
};
const PIZZA_BOX = ["si-box-s", "si-box-m", "si-box-xl"];
const RED_SAUCE = [0.09, 0.14, 0.17]; // si-pizza-sauce
const WHITE_SAUCE = [0.1, 0.15, 0.18]; // si-garlic-cream

const TOPPING_PORTIONS = {
  // 9.5 / 14.8 / 18.7 oz. American pizzerias are generous with cheese, and this
  // single line is about 60% of a pizza's ingredient cost — which is why the
  // cheese price rise over the ninety days is visible on the dashboard at all.
  "top-mozzarella": ["si-mozzarella", [0.27, 0.42, 0.53]],
  "top-pepperoni": ["si-pepperoni", [0.09, 0.13, 0.165]],
  "top-sausage": ["si-sausage", [0.085, 0.125, 0.155]],
  "top-mushroom": ["si-mushroom", [0.06, 0.09, 0.115]],
  "top-onion": ["si-onion", [0.05, 0.075, 0.095]],
  "top-pepper": ["si-pepper", [0.05, 0.075, 0.095]],
  "top-olives": ["si-olives", [0.04, 0.06, 0.075]],
  "top-ricotta": ["si-ricotta", [0.09, 0.13, 0.16]],
  "top-garlic": ["si-garlic", [0.012, 0.018, 0.022]],
  "top-basil": ["si-basil", [0.005, 0.008, 0.01]],
};

/** flat recipes for everything that is not a pizza; sizeKey null unless noted */
const FLAT_RECIPES = {
  "side-classic-smash": [
    ["si-beef-patty", 2], ["si-bun", 1], ["si-cheese-slice", 2], ["si-lettuce", 0.02],
    ["si-tomato", 0.03], ["si-pickle", 0.015], ["si-burger-sauce", 0.02],
    ["si-clamshell", 1], ["si-bag", 1],
  ],
  "side-double-smash": [
    ["si-beef-patty", 4], ["si-bun", 1], ["si-cheese-slice", 4], ["si-lettuce", 0.02],
    ["si-tomato", 0.03], ["si-pickle", 0.015], ["si-burger-sauce", 0.025],
    ["si-clamshell", 1], ["si-bag", 1],
  ],
  "side-crispy-chicken": [
    ["si-chicken-fillet", 1], ["si-bun", 1], ["si-lettuce", 0.025], ["si-tomato", 0.025],
    ["si-burger-sauce", 0.02], ["si-fry-oil", 0.02], ["si-clamshell", 1], ["si-bag", 1],
  ],
  "side-veggie-burger": [
    ["si-veggie-patty", 1], ["si-bun", 1], ["si-lettuce", 0.025], ["si-tomato", 0.03],
    ["si-pickle", 0.01], ["si-burger-sauce", 0.02], ["si-clamshell", 1], ["si-bag", 1],
  ],
  "side-garlic-knots": [
    ["si-flour", 0.2], ["si-olive-oil", 0.008], ["si-garlic-butter", 0.05],
    ["si-parmesan", 0.02], ["si-pizza-sauce", 0.06], ["si-clamshell", 1], ["si-bag", 1],
  ],
  "side-fries": [["si-fries", 0.24], ["si-fry-oil", 0.02], ["si-clamshell", 1], ["si-bag", 1]],
  // Two lines. $5.83 of ingredients against a $7 price. This is the demo's
  // deliberate wound and it is entirely real arithmetic.
  "side-cheesecake": [["si-cheesecake", 1], ["si-dessert-box", 1]],
  "side-cookie": [["si-cookie-dough", 1], ["si-bag", 1]],
};

/** coffee is per size — see the DEVIATION note in consume() */
const COFFEE_RECIPES = {
  "drink-drip": {
    S: [["si-coffee-beans", 0.018], ["si-cup-12", 1]],
    M: [["si-coffee-beans", 0.024], ["si-cup-16", 1]],
  },
  "drink-latte": {
    S: [["si-coffee-beans", 0.02], ["si-milk", 0.24], ["si-cup-12", 1]],
    M: [["si-coffee-beans", 0.024], ["si-milk", 0.34], ["si-cup-16", 1]],
  },
  "drink-cold-brew": { M: [["si-cold-brew", 0.15], ["si-cup-16", 1]] },
  "drink-hot-chocolate": { S: [["si-cocoa", 0.038], ["si-milk", 0.3], ["si-cup-12", 1]] },
};

/** Build the ConsumptionRule rows, and the in-memory index used to deduct. */
function buildConsumptionRules() {
  const rows = [];
  const byProduct = new Map(); // productId → [{itemId, qty, sizeKey}]
  const byTopping = new Map();

  const push = (owner, ownerId, itemId, qty, sizeKey, note) => {
    rows.push({
      id: `cr-${rows.length + 1}`,
      itemId,
      qty: r3(qty),
      sizeKey,
      productId: owner === "product" ? ownerId : null,
      toppingId: owner === "topping" ? ownerId : null,
      note: note ?? null,
    });
    const map = owner === "product" ? byProduct : byTopping;
    const list = map.get(ownerId) ?? [];
    list.push({ itemId, qty: r3(qty), sizeKey });
    map.set(ownerId, list);
  };

  // pizza bases, per size
  for (const p of PIZZAS) {
    const sauceItem = p.id === "pizza-3" ? "si-garlic-cream" : "si-pizza-sauce";
    const saucePortions = p.id === "pizza-3" ? WHITE_SAUCE : RED_SAUCE;
    for (let i = 0; i < 3; i++) {
      const key = SIZE_KEYS[i];
      for (const [itemId, portions] of Object.entries(PIZZA_BASE)) push("product", p.id, itemId, portions[i], key);
      push("product", p.id, sauceItem, saucePortions[i], key);
      push("product", p.id, PIZZA_BOX[i], 1, key);
      push("product", p.id, "si-bag", 1, key);
    }
  }

  // toppings, per size
  for (const [toppingId, [itemId, portions]] of Object.entries(TOPPING_PORTIONS)) {
    for (let i = 0; i < 3; i++) push("topping", toppingId, itemId, portions[i], SIZE_KEYS[i]);
  }

  // flat products
  for (const [productId, lines] of Object.entries(FLAT_RECIPES)) {
    for (const [itemId, qty] of lines) push("product", productId, itemId, qty, null);
  }

  // coffee, per size
  for (const [productId, bySize] of Object.entries(COFFEE_RECIPES)) {
    for (const [sizeKey, lines] of Object.entries(bySize)) {
      for (const [itemId, qty] of lines) push("product", productId, itemId, qty, sizeKey);
    }
  }

  return { rows, byProduct, byTopping };
}

const RULES = buildConsumptionRules();

/**
 * Mirror of `pick()` in lib/consumption.ts: an exact-size rule shadows a
 * generic one for the same stock item; generic rules that were not shadowed
 * still apply.
 */
function pickRules(rules, sizeKey) {
  if (!rules) return [];
  const exact = rules.filter((r) => r.sizeKey === sizeKey);
  const generic = rules.filter((r) => r.sizeKey === null);
  const taken = new Set(exact.map((r) => r.itemId));
  return [...exact, ...generic.filter((r) => !taken.has(r.itemId))];
}

// recipe map: productId → topping ids (the ProductTopping rows)
const RECIPE = new Map(PIZZAS.map((p) => [p.id, p.recipe]));

/**
 * One order line → stock consumption, accumulated into `acc`.
 *
 * Mirrors `computeConsumption` in lib/consumption.ts:
 *   · a pizza consumes its base rules at its size, plus its recipe toppings,
 *     plus whatever the customer added on top;
 *   · a half-and-half takes both bases and both recipes at half a portion, and
 *     the added toppings once;
 *   · anything else takes its product rules.
 *
 * DEVIATION: for a plain product, lib/consumption.ts always passes sizeKey
 * `null`, because when it was written no non-pizza product had sizes. Coffee
 * now does — a 16 oz latte is not a 12 oz latte — so this passes the line's
 * size through. The rules are keyed S/M, so the app would fall back to *no*
 * rule for coffee rather than to the wrong one. When Wave 1 finishes the sized
 * non-pizza path, this becomes identical again.
 */
function consume(acc, line) {
  const add = (itemId, qty) => {
    if (!qty) return;
    acc.set(itemId, (acc.get(itemId) ?? 0) + qty);
  };

  const applyToppings = (toppingIds, sizeKey, factor) => {
    const units = new Map();
    for (const tid of toppingIds) units.set(tid, (units.get(tid) ?? 0) + 1);
    for (const [tid, u] of units) {
      for (const r of pickRules(RULES.byTopping.get(tid), sizeKey)) add(r.itemId, r.qty * u * factor);
    }
  };

  if (line.kind === "pizza") {
    const size = SIZE_KEYS[line.sizeIdx];
    for (const r of pickRules(RULES.byProduct.get(line.productId), size)) add(r.itemId, r.qty * line.qty);
    applyToppings([...(RECIPE.get(line.productId) ?? []), ...line.extras], size, line.qty);
    return;
  }

  if (line.kind === "half_and_half") {
    const size = SIZE_KEYS[line.sizeIdx];
    for (const pid of [line.leftId, line.rightId]) {
      for (const r of pickRules(RULES.byProduct.get(pid), size)) add(r.itemId, r.qty * 0.5 * line.qty);
      applyToppings(RECIPE.get(pid) ?? [], size, 0.5 * line.qty);
    }
    applyToppings(line.extras, size, line.qty);
    return;
  }

  // plain product — burgers, sides, coffee
  for (const r of pickRules(RULES.byProduct.get(line.productId), line.sizeKey ?? null)) {
    add(r.itemId, r.qty * line.qty);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. STAFF AND THE ROTA
//
//    Labour cost is not a percentage: it is these six people, these rates and
//    these hours. The rota follows the trading shape — a cashier through the
//    lunch bump, a pizzaiolo from four until close, a driver for the evening,
//    and extra hands only on nights that earn them.
//
//    Thin? Yes. A single-location pizzeria at $950 a day is thin, because the
//    owner works the floor and takes profit rather than a wage. Her hours are
//    deliberately not on the payroll — putting them there would push labour to
//    35% and would also be untrue.
// ═════════════════════════════════════════════════════════════════════════════

const EMPLOYEES = [
  { id: "emp-demo-maria", name: "Maria Ortiz", role: "branch_manager", title: "General manager", rate: 25.0, pin: "421905", phone: "+18455550110", email: "maria@demo.invalid" },
  { id: "emp-demo-danny", name: "Danny Cruz", role: "kitchen", title: "Pizzaiolo", rate: 20.0, pin: "318472", phone: "+18455550111", email: "danny@demo.invalid" },
  { id: "emp-demo-alicia", name: "Alicia Reyes", role: "kitchen", title: "Line cook", rate: 18.0, pin: "770214", phone: "+18455550112", email: "alicia@demo.invalid" },
  { id: "emp-demo-trevor", name: "Trevor Blake", role: "cashier", title: "Counter", rate: 15.5, pin: "205836", phone: "+18455550113", email: "trevor@demo.invalid" },
  { id: "emp-demo-sam", name: "Sam Whitfield", role: "cashier", title: "Counter", rate: 15.0, pin: "649130", phone: "+18455550114", email: "sam@demo.invalid" },
  { id: "emp-demo-victor", name: "Victor Nunes", role: "driver", title: "Driver", rate: 11.0, pin: "583927", phone: "+18455550115", email: "victor@demo.invalid" },
];

const CASHIERS = ["emp-demo-trevor", "emp-demo-sam"];
const DRIVER = "emp-demo-victor";

const ROLE_PERMISSIONS = {
  branch_manager: ["can_edit_menu", "can_discount", "can_refund", "can_void", "can_manage_staff", "can_view_reports", "can_transfer_branch"],
  kitchen: [],
  cashier: ["can_discount"],
  driver: [],
};

/**
 * The rota for one day, given how many orders that day is expected to take.
 * Returns shifts as [employeeId, startHour, startMin, endHour, endMin, posId].
 */
function rotaFor(d, dow, nOrders) {
  const shifts = [];

  // counter through the lunch bump — an hour longer Friday to Sunday
  const trevorEnd = dow === 5 || dow === 6 || dow === 0 ? 16 : 15;
  shifts.push(["emp-demo-trevor", 11, 0, trevorEnd, 0, POS_1]);

  // the pizzaiolo, every single day, half four to close
  shifts.push(["emp-demo-danny", 16, 30, 21, 15, null]);

  // the driver, every evening — the window when deliveries actually happen
  shifts.push([DRIVER, 17, 15, 20, 45, null]);

  // a second pair of hands on nights that pay for them. The thresholds are the
  // dial that sets labour cost: at 36 and 41 the first run came out at 30.2% of
  // revenue, which is a restaurant in trouble, not a restaurant to sell to.
  if (nOrders >= 40) shifts.push(["emp-demo-alicia", 17, 0, 21, 30, null]);
  if (nOrders >= 46) shifts.push(["emp-demo-sam", 17, 30, 21, 30, POS_2]);

  // the manager takes Saturday
  if (dow === 6) shifts.push(["emp-demo-maria", 12, 0, 15, 30, POS_1]);

  return shifts;
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. CUSTOMERS
//    Invented names, and 845-555-01xx — the range reserved for fiction.
//    No real person's phone number is ever in a demo database.
// ═════════════════════════════════════════════════════════════════════════════

const FIRST = ["James", "Maria", "Robert", "Linda", "Michael", "Patricia", "David", "Jennifer", "Anthony", "Karen", "Joseph", "Nancy", "Frank", "Lisa", "Peter", "Donna", "Nick", "Carol", "Steve", "Angela", "Paul", "Diane", "Chris", "Rosa", "Vinny", "Theresa", "Danny", "Joanne", "Mark", "Sandra", "Louis", "Christine", "Sal", "Michelle", "Gary", "Kathy", "Tony", "Denise", "Ray", "Laura"];
const LAST = ["Russo", "Delgado", "Kowalski", "Brennan", "Marino", "Whitfield", "Okafor", "Santoro", "Fitzgerald", "Nguyen", "Castellano", "Byrne", "Petrov", "Alvarez", "MacLeod", "Rosenthal", "DeLuca", "Halloran", "Bianchi", "Vaughn", "Espinoza", "Larkin", "Moretti", "Ferrara", "Quinn"];
const STREETS = ["Millpond Pkwy", "Stage Rd", "Lakes Rd", "Gilbert St", "Spring St", "Still Rd", "Carpenter Pl", "Bakertown Rd", "Mine Rd", "Museum Village Rd", "Nininger Rd", "Smith Clove Rd", "Freeland St", "High St", "Elm St"];

const CUSTOMER_COUNT = 96; // 555-0100 … 555-0195

const CUSTOMERS = Array.from({ length: CUSTOMER_COUNT }, (_, i) => ({
  id: `usr-demo-${String(i + 1).padStart(3, "0")}`,
  name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
  phone: `+1845555${String(100 + i).padStart(4, "0")}`,
  address: `${randint(2, 240)} ${STREETS[i % STREETS.length]}, Monroe NY 10950`,
}));

// ═════════════════════════════════════════════════════════════════════════════
// 8. WIPE
//    Scoped to demo ids only, in foreign-key order, counted before it happens.
//    `Setting: org` is never touched — deploy/new-tenant.sh owns it, and it
//    carries the instance's currency, locale and timezone.
// ═════════════════════════════════════════════════════════════════════════════

const PRODUCT_IDS = PRODUCTS.map((p) => p.id);
const TOPPING_IDS = TOPPINGS.map((t) => t.id);
const STOCK_ITEM_IDS = STOCK_ITEMS.map((s) => s.id);
const LOCATION_IDS = [LOC_WAREHOUSE, LOC_BRANCH];
const EMPLOYEE_IDS = EMPLOYEES.map((e) => e.id);
const SETTING_KEYS = [
  "order", "loyalty", "tax", "tip", "employeeDiscount", "discountRules",
  "discountVerification", "social", "fixedCosts", "menu.modifierLabel",
  "units.system", "adminLanguage",
];

async function wipe() {
  const counts = await Promise.all([
    db.order.count({ where: { orgId: ORG_ID } }),
    db.orderItem.count({ where: { order: { orgId: ORG_ID } } }),
    db.stockMovement.count({ where: { locationId: { in: LOCATION_IDS } } }),
    db.shift.count({ where: { branchId: BRANCH_ID } }),
    db.product.count({ where: { id: { in: PRODUCT_IDS } } }),
    db.employee.count({ where: { id: { in: EMPLOYEE_IDS } } }),
    db.user.count({ where: { id: { startsWith: "usr-demo-" } } }),
  ]);

  console.log("  about to delete");
  console.log(`    orders ................ ${counts[0]}`);
  console.log(`    order items ........... ${counts[1]}`);
  console.log(`    stock movements ....... ${counts[2]}`);
  console.log(`    shifts ................ ${counts[3]}`);
  console.log(`    products .............. ${counts[4]}`);
  console.log(`    employees ............. ${counts[5]}`);
  console.log(`    demo customers ........ ${counts[6]}`);
  console.log("");

  // One transaction: either the old dataset is gone and the new one lands, or
  // nothing moved. 120s because a full wipe is tens of thousands of rows.
  await db.$transaction(
    async (tx) => {
      await tx.auditLog.deleteMany({ where: { OR: [{ branchId: BRANCH_ID }, { employeeId: { in: EMPLOYEE_IDS } }] } });
      await tx.order.deleteMany({ where: { orgId: ORG_ID } }); // cascades OrderItem
      await tx.pointsEntry.deleteMany({ where: { userId: { startsWith: "usr-demo-" } } });
      await tx.shift.deleteMany({ where: { branchId: BRANCH_ID } });
      await tx.transferLine.deleteMany({ where: { transfer: { OR: [{ fromLocationId: { in: LOCATION_IDS } }, { toLocationId: { in: LOCATION_IDS } }] } } });
      await tx.transfer.deleteMany({ where: { OR: [{ fromLocationId: { in: LOCATION_IDS } }, { toLocationId: { in: LOCATION_IDS } }] } });
      await tx.productionLine.deleteMany({ where: { order: { locationId: { in: LOCATION_IDS } } } });
      await tx.productionOrder.deleteMany({ where: { locationId: { in: LOCATION_IDS } } });
      await tx.stockMovement.deleteMany({ where: { locationId: { in: LOCATION_IDS } } });
      await tx.stockLevel.deleteMany({ where: { locationId: { in: LOCATION_IDS } } });
      await tx.consumptionRule.deleteMany({ where: { itemId: { in: STOCK_ITEM_IDS } } });
      await tx.productTopping.deleteMany({ where: { productId: { in: PRODUCT_IDS } } });
      await tx.branchProduct.deleteMany({ where: { branchId: BRANCH_ID } });
      await tx.branchCombo.deleteMany({ where: { branchId: BRANCH_ID } });
      await tx.product.deleteMany({ where: { id: { in: PRODUCT_IDS } } }); // cascades sizes/promo
      await tx.topping.deleteMany({ where: { id: { in: TOPPING_IDS } } }); // cascades prices
      await tx.subcategory.deleteMany({ where: { id: { in: SUBCATEGORIES.map((s) => s.id) } } });
      await tx.category.deleteMany({ where: { id: { in: CATEGORIES.map((c) => c.id) } } });
      await tx.stockItem.deleteMany({ where: { id: { in: STOCK_ITEM_IDS } } });
      await tx.stockLocation.deleteMany({ where: { id: { in: LOCATION_IDS } } });
      await tx.user.deleteMany({ where: { id: { startsWith: "usr-demo-" } } });
      await tx.employeeBranch.deleteMany({ where: { branchId: BRANCH_ID } });
      await tx.employee.deleteMany({ where: { id: { in: EMPLOYEE_IDS } } });
      await tx.terminal.deleteMany({ where: { branchId: BRANCH_ID } });
      await tx.branch.deleteMany({ where: { id: BRANCH_ID } });
      await tx.organization.deleteMany({ where: { id: ORG_ID } });
      await tx.setting.deleteMany({ where: { key: { in: SETTING_KEYS } } });
    },
    { timeout: 120_000, maxWait: 20_000 },
  );

  console.log("  ✓ old demo data removed");
}

// ═════════════════════════════════════════════════════════════════════════════
// 9. THE WORLD, WRITTEN
// ═════════════════════════════════════════════════════════════════════════════

function pinHash(pin) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null; // POS PINs need AUTH_SECRET; without it, no PIN.
  return createHmac("sha256", secret).update(pin).digest("hex");
}

async function seedWorld() {
  const noPin = !process.env.AUTH_SECRET;

  await db.$transaction(
    async (tx) => {
      await tx.organization.create({
        data: {
          id: ORG_ID,
          name: { en: "Hudson Fire & Grind", ka: "Hudson Fire & Grind" },
          active: true,
        },
      });

      await tx.branch.create({
        data: {
          id: BRANCH_ID,
          orgId: ORG_ID,
          code: BRANCH_CODE,
          name: { en: "Monroe", ka: "Monroe" },
          address: { en: "38 Millpond Parkway, Monroe, NY 10950", ka: "38 Millpond Parkway, Monroe, NY 10950" },
          phone: "+18455550100",
          hours: {
            display: { en: "11:00 – 22:00 daily", ka: "11:00 – 22:00" },
            mon: { open: "11:00", close: "22:00" }, tue: { open: "11:00", close: "22:00" },
            wed: { open: "11:00", close: "22:00" }, thu: { open: "11:00", close: "22:00" },
            fri: { open: "11:00", close: "23:00" }, sat: { open: "11:00", close: "23:00" },
            sun: { open: "11:00", close: "22:00" },
          },
          lat: 41.3287, lng: -74.1868,
          active: true, sortOrder: 1,
        },
      });

      await tx.terminal.createMany({
        data: [
          { id: "trm-1", branchId: BRANCH_ID, posId: POS_1, label: { en: "Counter", ka: "დახლი" }, active: true, hasCardTerminal: true },
          { id: "trm-2", branchId: BRANCH_ID, posId: POS_2, label: { en: "Second till", ka: "მეორე სალარო" }, active: true, hasCardTerminal: true },
        ],
      });

      await tx.category.createMany({ data: CATEGORIES.map((c) => ({ ...c, type: "food", active: true })) });
      await tx.subcategory.createMany({ data: SUBCATEGORIES.map((s) => ({ ...s, active: true })) });

      await tx.product.createMany({
        data: PRODUCTS.map((p) => ({
          id: p.id,
          legacyId: p.legacyId ?? null,
          name: p.name,
          description: p.description ?? null,
          categoryId: p.categoryId,
          subcategoryId: p.subcategoryId,
          type: p.type,
          hasSizes: p.hasSizes,
          hasModifiers: p.hasModifiers,
          splittable: p.splittable,
          hasVariants: p.hasVariants,
          sizeMeta: p.sizeMeta ?? null,
          taxable: true,
          price: p.price ?? null,
          emoji: p.emoji ?? null,
          tier: p.tier ?? null,
          isBYO: p.isBYO ?? false,
          discountable: true,
          active: true,
          sortOrder: p.sortOrder,
        })),
      });

      // ProductSize.meta carries the unit the size is actually measured in —
      // inches for a pie, ounces for a cup. `cm` is filled for pizzas only, so
      // any reader still on the old column keeps working.
      const sizeRows = [];
      for (const p of PRODUCTS) {
        if (!p.sizes) continue;
        p.sizes.forEach((s, i) => {
          sizeRows.push({
            id: `sz-${p.id}-${s.key}`,
            productId: p.id,
            key: s.key,
            cm: s.inches ? Math.round(s.inches * 2.54) : null,
            meta: s.inches ? { in: s.inches } : { oz: s.oz },
            price: s.price,
            sortOrder: i,
          });
        });
      }
      await tx.productSize.createMany({ data: sizeRows });

      await tx.topping.createMany({
        data: TOPPINGS.map((t, i) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          emoji: t.emoji,
          dots: [t.category],
          ui: { dots: [t.category] },
          popular: t.popular,
          recipeOnly: false,
          active: true,
          sortOrder: i + 1,
        })),
      });

      await tx.toppingPrice.createMany({
        data: TOPPINGS.flatMap((t) =>
          SIZE_KEYS.map((key, i) => ({ id: `tp-${t.id}-${key}`, toppingId: t.id, sizeKey: key, price: t.prices[i] })),
        ),
      });

      await tx.productTopping.createMany({
        data: PIZZAS.flatMap((p) => p.recipe.map((toppingId, i) => ({ productId: p.id, toppingId, sortOrder: i }))),
      });

      await tx.branchProduct.createMany({
        data: PRODUCTS.map((p) => ({ id: `bp-${p.id}`, branchId: BRANCH_ID, productId: p.id, available: true })),
      });

      await tx.stockLocation.createMany({
        data: [
          { id: LOC_WAREHOUSE, name: { en: "Back store", ka: "საწყობი" }, type: "warehouse", active: true },
          { id: LOC_BRANCH, name: { en: "Monroe kitchen", ka: "Monroe სამზარეულო" }, type: "branch", branchId: BRANCH_ID, active: true },
        ],
      });

      await tx.stockItem.createMany({
        data: STOCK_ITEMS.map((s) => ({
          id: s.id, sku: s.sku, name: s.name, unit: s.unit, category: s.category,
          isProduced: false, active: true,
        })),
      });

      await tx.consumptionRule.createMany({ data: RULES.rows });

      await tx.employee.createMany({
        data: EMPLOYEES.map((e) => ({
          id: e.id,
          name: e.name,
          phone: e.phone,
          email: e.email,
          role: e.role,
          permissions: ROLE_PERMISSIONS[e.role] ?? [],
          homeBranchId: BRANCH_ID,
          posPinHash: noPin ? null : pinHash(e.pin),
          title: e.title,
          hourlyRate: e.rate,
          hiredAt: at(0, 9, 0),
          active: true,
        })),
      });

      await tx.employeeBranch.createMany({
        data: EMPLOYEES.map((e) => ({ employeeId: e.id, branchId: BRANCH_ID })),
      });
    },
    { timeout: 120_000, maxWait: 20_000 },
  );

  console.log(`  ✓ world: 1 org · 1 branch · 2 terminals · ${CATEGORIES.length} categories · ${PRODUCTS.length} products · ${TOPPINGS.length} toppings`);
  console.log(`  ✓ stock: ${STOCK_ITEMS.length} items · 2 locations · ${RULES.rows.length} consumption rules`);
  console.log(`  ✓ staff: ${EMPLOYEES.length} employees${noPin ? "  (AUTH_SECRET not set — POS PINs left empty)" : ""}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 10. NINETY DAYS OF ORDERS
//
//     Everything below happens in memory first. Nothing is written until the
//     whole period exists, because the stock par levels are derived from the
//     usage the orders turn out to produce — you cannot know how much cheese to
//     order until you know how much cheese gets sold.
// ═════════════════════════════════════════════════════════════════════════════

// Extra toppings a customer adds on top of the recipe. Never one already on
// the pie — `lib/order-pricing.ts` would charge for it and consumption would
// count it twice, which is right for "extra cheese" and wrong here.
const EXTRA_POOL = TOPPINGS.map((t) => t.id);

function pizzaSizeIdx(daypart) {
  if (daypart === "lunch") return wpick([[0, 0.6], [1, 0.4], [2, 0.0]]);
  if (daypart === "afternoon") return wpick([[0, 0.55], [1, 0.4], [2, 0.05]]);
  return wpick([[0, 0.13], [1, 0.52], [2, 0.35]]);
}

function chooseExtras(productId, sizeIdx) {
  const onPie = new Set(RECIPE.get(productId) ?? []);
  const pool = EXTRA_POOL.filter((t) => !onPie.has(t));
  // Build-your-own is why people order build-your-own: they load it.
  const n = productId === "pizza-4"
    ? wpick([[1, 0.2], [2, 0.35], [3, 0.3], [4, 0.15]])
    : wpick([[0, 0.45], [1, 0.28], [2, 0.17], [3, 0.1]]);
  const picked = [];
  const used = new Set();
  for (let i = 0; i < n && pool.length > 0; i++) {
    let t;
    let guard = 0;
    do {
      t = pool[Math.floor(rng() * pool.length)];
    } while (used.has(t) && ++guard < 12);
    if (used.has(t)) break;
    used.add(t);
    picked.push(t);
  }
  return picked;
}

/** one pizza line, priced the way lib/order-pricing.ts prices it */
function makePizzaLine(daypart) {
  const sizeIdx = pizzaSizeIdx(daypart);
  const size = SIZE_KEYS[sizeIdx];

  // 6% of pies go out half-and-half — the capability the pizza vertical is
  // usually sold on, and the one a burger shop must not be forced to carry.
  if (chance(0.06)) {
    const left = PIZZAS[randint(0, 2)];
    let right = PIZZAS[randint(0, 2)];
    if (right.id === left.id) right = PIZZAS[(PIZZAS.indexOf(left) + 1) % 3];
    const extras = chance(0.35) ? chooseExtras("pizza-4", sizeIdx).slice(0, 2) : [];
    const base = left.sizes[sizeIdx].price / 2 + right.sizes[sizeIdx].price / 2;
    const extraPrice = extras.reduce((s, t) => s + TOPPING_BY_ID.get(t).prices[sizeIdx], 0);
    return {
      kind: "half_and_half",
      productId: null,
      leftId: left.id,
      rightId: right.id,
      sizeIdx,
      sizeKey: size,
      extras,
      qty: 1,
      unitPrice: r2(base + extraPrice),
      name: { en: `${left.name.en} / ${right.name.en}`, ka: `${left.name.ka} / ${right.name.ka}` },
      config: {
        leftId: left.legacyId,
        rightId: right.legacyId,
        sizeIdx,
        crustIdx: 0,
        sauceIdx: 2,
        toppings: Object.fromEntries(extras.map((t) => [TOPPING_BY_ID.get(t).name.en, { whole: 1, left: 0, right: 0 }])),
        leftIngredients: left.recipe.map((t) => TOPPING_BY_ID.get(t).name.en),
        rightIngredients: right.recipe.map((t) => TOPPING_BY_ID.get(t).name.en),
      },
    };
  }

  const p = wpick([[PIZZAS[0], 0.22], [PIZZAS[1], 0.34], [PIZZAS[2], 0.2], [PIZZAS[3], 0.24]]);
  const extras = chooseExtras(p.id, sizeIdx);
  const extraPrice = extras.reduce((s, t) => s + TOPPING_BY_ID.get(t).prices[sizeIdx], 0);

  return {
    kind: "pizza",
    productId: p.id,
    sizeIdx,
    sizeKey: size,
    extras,
    qty: 1,
    unitPrice: r2(p.sizes[sizeIdx].price + extraPrice),
    name: p.name,
    config: {
      sizeIdx,
      crustIdx: 0,
      sauceIdx: 2,
      toppings: Object.fromEntries(extras.map((t) => [TOPPING_BY_ID.get(t).name.en, { whole: 1, left: 0, right: 0 }])),
      removed: {},
      ingredients: p.recipe.map((t) => TOPPING_BY_ID.get(t).name.en),
    },
  };
}

function makeSimpleLine(productId, qty = 1) {
  const p = PRODUCT_BY_ID.get(productId);
  return {
    kind: "product",
    productId,
    sizeKey: null,
    extras: [],
    qty,
    unitPrice: r2(p.price),
    name: p.name,
    config: {},
  };
}

function makeCoffeeLine() {
  const productId = wpick([["drink-drip", 0.4], ["drink-latte", 0.3], ["drink-cold-brew", 0.18], ["drink-hot-chocolate", 0.12]]);
  const p = PRODUCT_BY_ID.get(productId);
  const size =
    productId === "drink-drip" ? wpick([["S", 0.5], ["M", 0.5]])
      : productId === "drink-latte" ? wpick([["S", 0.4], ["M", 0.6]])
        : p.sizes[0].key;
  const row = p.sizes.find((s) => s.key === size);
  return {
    kind: "product",
    productId,
    sizeKey: size,
    extras: [],
    qty: 1,
    unitPrice: r2(row.price),
    name: p.name,
    // DEVIATION from lib/order-pricing.ts, which writes `{}` for a plain
    // product because drinks had no sizes when it was written. Without the size
    // on the line there is no way to tell a 12 oz latte from a 16 oz one on the
    // receipt, in the report, or in the deduction.
    config: { sizeKey: size, oz: row.oz },
  };
}

const BURGER_MIX = [["side-classic-smash", 0.35], ["side-double-smash", 0.25], ["side-crispy-chicken", 0.25], ["side-veggie-burger", 0.15]];

/**
 * A basket. Archetypes, not random items: real orders are a burger and fries,
 * or two pies and knots, never one cookie and a cold brew and half a pizza.
 */
function buildBasket(daypart) {
  const lines = [];

  const archetype = daypart === "lunch"
    ? wpick([["coffee", 0.3], ["burger", 0.24], ["pizza", 0.3], ["dessert", 0.08], ["burgers-big", 0.08]])
    : daypart === "afternoon"
      ? wpick([["coffee", 0.4], ["dessert", 0.22], ["pizza", 0.18], ["burger", 0.2]])
      : wpick([["pizza-dinner", 0.4], ["family", 0.16], ["burgers-big", 0.22], ["pizza", 0.1], ["coffee", 0.06], ["dessert", 0.06]]);

  const addCoffee = (n) => { for (let i = 0; i < n; i++) lines.push(makeCoffeeLine()); };

  switch (archetype) {
    case "coffee":
      addCoffee(wpick([[1, 0.62], [2, 0.28], [3, 0.1]]));
      if (chance(0.35)) lines.push(makeSimpleLine("side-cookie"));
      if (chance(0.12)) lines.push(makeSimpleLine("side-cheesecake"));
      break;

    case "burger":
      lines.push(makeSimpleLine(wpick(BURGER_MIX)));
      if (chance(0.7)) lines.push(makeSimpleLine("side-fries"));
      if (chance(0.3)) addCoffee(1);
      if (chance(0.1)) lines.push(makeSimpleLine("side-cheesecake"));
      break;

    case "burgers-big": {
      const n = wpick([[1, 0.55], [2, 0.35], [3, 0.1]]);
      for (let i = 0; i < n; i++) lines.push(makeSimpleLine(wpick(BURGER_MIX)));
      if (chance(0.8)) lines.push(makeSimpleLine("side-fries", n > 1 ? 2 : 1));
      if (chance(0.25)) lines.push(makeSimpleLine("side-garlic-knots"));
      if (chance(0.2)) lines.push(makeSimpleLine("side-cookie"));
      if (chance(0.1)) lines.push(makeSimpleLine("side-cheesecake"));
      break;
    }

    case "pizza":
      lines.push(makePizzaLine(daypart));
      if (chance(0.2)) lines.push(makeSimpleLine("side-fries"));
      if (chance(0.25)) addCoffee(1);
      break;

    case "pizza-dinner": {
      const n = wpick([[1, 0.62], [2, 0.38]]);
      for (let i = 0; i < n; i++) lines.push(makePizzaLine(daypart));
      if (chance(0.45)) lines.push(makeSimpleLine("side-garlic-knots"));
      if (chance(0.25)) lines.push(makeSimpleLine("side-fries"));
      if (chance(0.26)) lines.push(makeSimpleLine("side-cheesecake", chance(0.3) ? 2 : 1));
      if (chance(0.12)) lines.push(makeSimpleLine("side-cookie"));
      break;
    }

    case "family": {
      const n = wpick([[2, 0.55], [3, 0.45]]);
      for (let i = 0; i < n; i++) lines.push(makePizzaLine("dinner"));
      if (chance(0.7)) lines.push(makeSimpleLine("side-garlic-knots"));
      if (chance(0.5)) lines.push(makeSimpleLine("side-fries", 2));
      if (chance(0.45)) lines.push(makeSimpleLine("side-cheesecake", wpick([[1, 0.4], [2, 0.6]])));
      if (chance(0.4)) lines.push(makeSimpleLine("side-cookie", 2));
      break;
    }

    case "dessert":
    default:
      if (chance(0.5)) lines.push(makeSimpleLine("side-cheesecake"));
      if (chance(0.45)) lines.push(makeSimpleLine("side-cookie"));
      addCoffee(1);
      break;
  }

  if (lines.length === 0) lines.push(makeSimpleLine("side-fries"));
  return lines;
}

// ── settings that pricing depends on ────────────────────────────────────────
const MIN_ORDER = 12;
const DELIVERY_FEE = 3.99;
const FREE_DELIVERY = 40;
const TAX_PERCENT = 8.125; // NY state + Orange County, on prepared food

// Tip presets and their weights. 8% of card customers leave nothing; the rest
// average 17.6%, which lands the overall card tip at about 16% as DEMO.md asks.
const TIP_PRESETS = [[0.12, 0.1], [0.15, 0.28], [0.18, 0.32], [0.2, 0.22], [0.25, 0.08]];

const N_MAX = 90; // ceiling on tickets in a day — the solver needs a fixed grid

/**
 * One ticket, wholly determined by which day it is and which ticket of that
 * day — never by how many tickets the day ended up having. Everything down to
 * `total` is drawn before anything that depends on the day's volume, which is
 * what makes the growth solver below able to price a day's takings for any
 * number of tickets without generating them twice differently.
 */
function makeOrder(d, k, n) {
  const outer = rng;
  // Nearby mulberry32 seeds start correlated; four throwaway draws separate them.
  rng = mulberry32((SEED ^ (d * 7919 + k * 104729)) >>> 0);
  for (let i = 0; i < 4; i++) rng();

  try {
    const hour = wpick(HOUR_WEIGHTS);
    const minute = randint(0, 59);
    const createdAt = at(d, hour, minute, randint(0, 59));
    const daypart = hour <= 14 ? "lunch" : hour <= 16 ? "afternoon" : "dinner";

    const lines = buildBasket(daypart);
    const subtotal = r2(lines.reduce((s, l) => s + l.unitPrice * l.qty, 0));

    // ── channel ──
    // A basket under the minimum order could not have been placed on the
    // website — the live checkout refuses it — so a coffee and a cookie is a
    // walk-in, not a web order. About one web attempt in five is small enough
    // to be redirected, which is why the web weight is set at 0.55 to land on
    // the 45 / 40 / 15 split DEMO.md asks for. (Measured, not guessed: the
    // first run set it at 0.47 and the mix came out 38 / 47 / 15.)
    let source = wpick([["web", 0.55], ["pos", 0.3], ["phone", 0.15]]);
    if (source === "web" && subtotal < MIN_ORDER) source = "pos";

    const fulfillmentType =
      source === "pos" ? wpick([["pickup", 0.62], ["dine_in", 0.38]])
        : source === "web" ? wpick([["delivery", 0.72], ["pickup", 0.28]])
          : wpick([["delivery", 0.85], ["pickup", 0.15]]);

    const isDelivery = fulfillmentType === "delivery";
    const deliveryFee = isDelivery && subtotal < FREE_DELIVERY ? DELIVERY_FEE : 0;

    // 0.7% of orders never happen. They are excluded from every metric the
    // dashboard shows, and — deliberately — they consume no stock: an order
    // voided before the kitchen starts costs nothing but the ticket.
    const cancelled = chance(0.007);

    // ── money ──
    // total is NET SALES: items plus the delivery fee. Sales tax is collected
    // for New York State and tips belong to the staff; folding either into
    // revenue would flatter food cost, labour cost and prime cost all at once,
    // which is exactly the sort of flattering that makes a demo worthless.
    // `paidAmount` is what the customer actually handed over.
    const total = r2(subtotal + deliveryFee);
    const tax = r2(total * (TAX_PERCENT / 100));

    const paymentMethod = wpick([["card", 0.7], ["cash", 0.3]]);
    const tip = paymentMethod === "card" && !chance(0.08) ? r2(subtotal * wpick(TIP_PRESETS)) : 0;
    const grand = r2(total + tax + tip);

    let paidAmount = grand;
    let changeGiven = 0;
    if (paymentMethod === "cash") {
      const tendered = Math.ceil(grand / 5) * 5;
      paidAmount = tendered;
      changeGiven = r2(tendered - grand);
    }

    const customer = chance(0.55) ? CUSTOMERS[Math.floor(rng() * CUSTOMERS.length)] : null;

    // ── who rang it in ──
    // Whoever the rota says is actually standing there: Trevor through the
    // lunch bump, Sam on the second till when the night is busy enough to open
    // it, and otherwise Danny, who rings in his own tickets at a shop this size.
    const onCounter = hour < 16 ? CASHIERS[0] : n >= 46 ? CASHIERS[1] : "emp-demo-danny";
    const posId = source === "pos" ? (n >= 46 && chance(0.35) ? POS_2 : POS_1) : null;

    const order = {
      id: null, // the caller numbers them, once the day's count is settled
      day: d,
      hour,
      source,
      orgId: ORG_ID,
      branchId: BRANCH_ID,
      posId,
      userId: customer?.id ?? null,
      createdByEmployee: source === "web" ? null : onCounter,
      subtotal,
      discountBreakdown: [],
      discountTotal: 0,
      deliveryFee,
      tax,
      tip,
      pointsRedeemed: 0,
      pointsValue: 0,
      total,
      pointsEarned: customer && !cancelled ? Math.floor(subtotal) : 0,
      fulfillmentType,
      address: isDelivery ? { text: customer?.address ?? `${randint(2, 240)} ${STREETS[randint(0, STREETS.length - 1)]}, Monroe NY 10950` } : null,
      tableNo: fulfillmentType === "dine_in" ? String(randint(1, 12)) : null,
      customerName: customer?.name ?? (source === "pos" ? null : `${FIRST[randint(0, FIRST.length - 1)]} ${LAST[randint(0, LAST.length - 1)]}`),
      customerPhone: customer?.phone ?? (source === "pos" ? null : `+1845555${String(randint(100, 195)).padStart(4, "0")}`),
      paymentMethod,
      paymentStatus: cancelled ? "refunded" : "paid",
      paidAmount: cancelled ? 0 : paidAmount,
      changeGiven: cancelled ? 0 : changeGiven,
      terminalId: paymentMethod === "card" && source === "pos" ? "PAX-A920-01" : null,
      txnRef: paymentMethod === "card" ? `AUTH${String(100000 + randint(0, 899999))}` : null,
      status: cancelled ? "cancelled" : "completed",
      driverId: isDelivery && !cancelled ? DRIVER : null,
      createdAt,
      clientRef: null,
      notes: null,
      lines,
      cancelled,
      isDelivery,
    };

    // ── delivery clock ──
    if (isDelivery && !cancelled) {
      const assigned = randint(5, 13);
      const pickup = assigned + randint(4, 10);
      // Most runs are quick. A small tail is left in on purpose — a delivery
      // history with no bad nights at all is the tell that the data is made up.
      // It is deliberately thin (about one order a week past forty-five
      // minutes) so that four in a single week reads as the spike it is.
      const run = chance(0.02) ? randint(22, 32) : randint(9, 20);
      order.assignedAt = new Date(createdAt.getTime() + assigned * 60_000);
      order.pickedUpAt = new Date(createdAt.getTime() + pickup * 60_000);
      order.deliveredAt = new Date(createdAt.getTime() + (pickup + run) * 60_000);
      order.driveMinutes = pickup + run;
    }

    order.statusHistory = cancelled
      ? [
          { status: "new", at: createdAt.toISOString(), by: source },
          { status: "cancelled", at: new Date(createdAt.getTime() + 4 * 60_000).toISOString(), by: "Maria Ortiz" },
        ]
      : [
          { status: "new", at: createdAt.toISOString(), by: source },
          { status: "confirmed", at: new Date(createdAt.getTime() + 2 * 60_000).toISOString(), by: onCounter },
          { status: "preparing", at: new Date(createdAt.getTime() + 5 * 60_000).toISOString(), by: "Danny Cruz" },
          { status: "ready", at: new Date(createdAt.getTime() + 14 * 60_000).toISOString(), by: "Danny Cruz" },
          { status: "completed", at: (order.deliveredAt ?? new Date(createdAt.getTime() + 18 * 60_000)).toISOString(), by: order.isDelivery ? "Victor Nunes" : onCounter },
        ];

    return order;
  } finally {
    rng = outer;
  }
}

// ── the growth line ─────────────────────────────────────────────────────────
//
// DEMO.md wants the last thirty days about 12% ahead of the thirty before.
// Two things make that harder than adding a slope:
//
//   · thirty days is four weeks plus two, so which two extra weekdays land in
//     each half swings the answer by several points — and which they are
//     depends on what day of the week the seed happens to be run;
//   · revenue is not order count. A thousand tickets carry enough spread in
//     basket size that even an exact 12% more tickets came out anywhere
//     between 7% and 15% more money, run to run.
//
// So price every possible ticket first, then solve. `TAKINGS[d][j]` is what
// day d's j-th ticket is worth; a prefix sum gives the day's revenue for any
// number of tickets, and a bisection finds the slope where the two windows
// stand exactly 12% apart. It costs one extra pass over a few thousand
// baskets and it makes the headline number true rather than approximately true.
const TAKINGS = Array.from({ length: DAYS }, (_, d) => {
  const row = [0];
  for (let k = 0; k < N_MAX; k++) {
    const o = makeOrder(d, k, BASE_ORDERS);
    row.push(row[k] + (o.cancelled ? 0 : o.total)); // cancelled tickets are not revenue
  }
  return row;
});

/** order counts for a given slope, normalised so BASE_ORDERS stays "an average day" */
function countsFor(slope) {
  const raw = DAY_SHAPE.map((s, d) => s * (1 + slope * d));
  const mean = raw.reduce((s, x) => s + x, 0) / DAYS;
  return raw.map((x) => Math.min(N_MAX, Math.max(8, Math.round(BASE_ORDERS * x / mean))));
}

function growthFor(slope) {
  const n = countsFor(slope);
  let prev = 0;
  let last = 0;
  for (let d = 30; d < 60; d++) prev += TAKINGS[d][n[d]];
  for (let d = 60; d < DAYS; d++) last += TAKINGS[d][n[d]];
  return prev > 0 ? last / prev : 1;
}

const TREND_K = (() => {
  let lo = 0;
  let hi = 0.03;
  if (growthFor(hi) < GROWTH) return hi; // shape alone cannot get there — take the most it can
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (growthFor(mid) < GROWTH) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
})();

const ORDERS_PER_DAY = countsFor(TREND_K);

// ── and now the ninety days themselves ──────────────────────────────────────

const orders = [];
const orderItems = [];
const dailyUsage = []; // [day] → Map(itemId → qty)
const perDayOrderCount = [];

let orderSeq = 0;
let itemSeq = 0;

for (let d = 0; d < DAYS; d++) {
  const n = ORDERS_PER_DAY[d];
  perDayOrderCount.push(n);

  const usage = new Map();
  dailyUsage.push(usage);

  for (let k = 0; k < n; k++) {
    const order = makeOrder(d, k, n);
    order.id = `ord-${String(++orderSeq).padStart(6, "0")}`;
    if (order.source === "pos") order.clientRef = `demo-${order.id}`;
    orders.push(order);

    for (const l of order.lines) {
      orderItems.push({
        id: `oi-${String(++itemSeq).padStart(7, "0")}`,
        orderId: order.id,
        kind: l.kind,
        productId: l.productId,
        comboId: null,
        name: l.name,
        config: l.config,
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: r2(l.unitPrice * l.qty),
      });
      if (!order.cancelled) consume(usage, l);
    }
  }
}

// ── the four late deliveries ────────────────────────────────────────────────
// A Friday when one driver covered a night that needed two. Chosen from the
// evening delivery runs of the last seven days, deterministically, and pushed
// past the 45-minute line — the rest of the week stays honest.
{
  const setMinutes = (o, minutes) => {
    o.deliveredAt = new Date(o.createdAt.getTime() + minutes * 60_000);
    o.driveMinutes = minutes;
    o.statusHistory[o.statusHistory.length - 1].at = o.deliveredAt.toISOString();
  };

  const lastWeekAll = orders.filter((o) => o.day >= DAYS - 7 && o.isDelivery && !o.cancelled);

  // First pull the week's own tail back under the line, so the count is exactly
  // four and not "four plus whatever the dice did".
  for (const o of lastWeekAll) if (o.driveMinutes > 45) setMinutes(o, randint(38, 44));

  const evening = lastWeekAll.filter((o) => o.hour >= 18).sort((a, b) => a.createdAt - b.createdAt);
  const extra = [7, 11, 16, 24]; // minutes over a 46-minute floor
  [0.17, 0.41, 0.63, 0.88].forEach((f, i) => {
    const o = evening[Math.floor(f * evening.length)];
    if (!o) return;
    setMinutes(o, 46 + extra[i]);
    o.notes = "Driver ran two stops out of order — customer called";
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// 11. THE STOCK TIMELINE
//
//     Now that the ninety days exist, we know what they ate. Par levels come
//     from measured usage, deliveries top up to par, and every movement — in
//     and out — is priced by the same moving average the app uses.
// ═════════════════════════════════════════════════════════════════════════════

const totalUsage = new Map();
for (const day of dailyUsage) {
  for (const [itemId, q] of day) totalUsage.set(itemId, (totalUsage.get(itemId) ?? 0) + q);
}

/** average usage per day, with 5% headroom for the waste booked below */
const avgDaily = new Map();
for (const s of STOCK_ITEMS) {
  const used = (totalUsage.get(s.id) ?? 0) / DAYS;
  avgDaily.set(s.id, used * 1.05);
}

/**
 * The worst `span` consecutive days this item ever saw.
 *
 * Par set off the *average* is not enough for anything sold in ones and twos:
 * onions go onto a pizza only when somebody asks for them, so a bad weekend can
 * eat two and a half times the mean and the shelf goes negative before Monday's
 * van. (It did, three runs out of seven.) A chef sets par by what a bad weekend
 * eats, not by an average, and so does this.
 */
function worstWindow(itemId, span) {
  let worst = 0;
  for (let d = 0; d + span <= DAYS; d++) {
    let s = 0;
    for (let k = d; k < d + span; k++) s += dailyUsage[k].get(itemId) ?? 0;
    if (s > worst) worst = s;
  }
  return worst;
}

const par = new Map(); // itemId → { min, target }
for (const s of STOCK_ITEMS) {
  const a = avgDaily.get(s.id) ?? 0;
  const fresh = s.cadence === F;
  const cover = fresh ? COVER.fresh : COVER.dry;
  const minCover = fresh ? MIN_COVER.fresh : MIN_COVER.dry;
  // Friday to Monday is three days of trade; weekly dry goods are seven. One
  // day of slack on top, then a third again for the delivery that arrives light.
  const peak = worstWindow(s.id, fresh ? 4 : 9) * 1.3;
  par.set(s.id, {
    min: r3(a * minCover),
    target: r3(Math.max(a * cover, peak)),
  });
}

// The item that must end up short. Cheese is the right one: it is the most
// expensive thing in the building, the most perishable, and the one whose
// absence closes a pizzeria.
const SHORT_ITEM = "si-mozzarella";
const SHORT_CLOSING_DAYS = 1.6; // days of cover left at the end of the window

/** which days does this item get delivered on? */
function deliveryDays(cadence) {
  const days = [];
  for (let d = 0; d < DAYS; d++) {
    const dow = dayDate(d).getDay();
    if (cadence === F ? dow === 1 || dow === 3 || dow === 5 : dow === 2) days.push(d);
  }
  return days;
}

const movements = [];
const levels = new Map(); // `${locationId}|${itemId}` → { qty, avgCost }
let moveSeq = 0;

function levelOf(locationId, itemId) {
  const key = `${locationId}|${itemId}`;
  let l = levels.get(key);
  if (!l) {
    l = { qty: 0, avgCost: null };
    levels.set(key, l);
  }
  return l;
}

/** receipt — mirrors applyReceiptCost(): moving average, rounded to 4 dp */
function receive(locationId, itemId, qty, unitCost, when, note) {
  if (qty <= 0) return;
  const l = levelOf(locationId, itemId);
  const before = l.qty;
  l.qty = r3(before + qty);
  const oldAvg = l.avgCost ?? 0;
  l.avgCost = r4(before <= 0 ? unitCost : (before * oldAvg + qty * unitCost) / l.qty);

  movements.push({
    id: `mv-${String(++moveSeq).padStart(7, "0")}`,
    locationId, itemId, type: "receipt",
    qty: r3(qty), balanceAfter: l.qty,
    unitCost: r4(unitCost), totalCost: r2(qty * unitCost),
    refType: "Purchase", refId: null, note, employeeId: "emp-demo-maria", at: when,
  });
}

/**
 * Anything leaving — mirrors applyOutgoingCost(): the current average is
 * written onto the movement and the average itself does not move. Note the
 * sign convention copied from the app: qty is negative, totalCost is positive
 * for sale/waste (lib/analytics.ts takes the absolute value), and signed for a
 * stock count, where a negative is a genuine shortage.
 */
function issue(locationId, itemId, qty, type, when, refType, refId, note, employeeId) {
  if (qty === 0) return;
  const l = levelOf(locationId, itemId);
  l.qty = r3(l.qty - qty);
  const cost = l.avgCost;

  movements.push({
    id: `mv-${String(++moveSeq).padStart(7, "0")}`,
    locationId, itemId, type,
    qty: r3(-qty), balanceAfter: l.qty,
    unitCost: cost == null ? null : r4(cost),
    totalCost: cost == null ? null : r2(qty * cost),
    refType, refId, note, employeeId: employeeId ?? null, at: when,
  });
}

// ── opening stock, day 0 at 07:00 ───────────────────────────────────────────
for (const s of STOCK_ITEMS) {
  const t = par.get(s.id).target;
  if (t > 0) receive(LOC_BRANCH, s.id, r3(t), purchasePrice(s, 0), at(0, 7, 0), "Opening stock");
}

// ── the back store ──────────────────────────────────────────────────────────
// A basement shelf, not a distribution centre: two bulk deliveries of four days'
// cover each. It exists for two reasons — it is where lib/costing.ts reads the
// average cost that prices the menu, and it gives the replenishment screen
// somewhere to suggest moving cheese from when the kitchen runs short.
for (const s of STOCK_ITEMS) {
  const a = avgDaily.get(s.id) ?? 0;
  if (a <= 0) continue;
  for (const d of [1, 45]) {
    receive(LOC_WAREHOUSE, s.id, r3(a * 4), purchasePrice(s, d), at(d, 6, 30), "Bulk delivery to back store");
  }
}

// ── the deliveries, day by day, interleaved with what gets sold ─────────────
const deliverySchedule = new Map(); // day → [itemId]
for (const s of STOCK_ITEMS) {
  for (const d of deliveryDays(s.cadence)) {
    const list = deliverySchedule.get(d) ?? [];
    list.push(s.id);
    deliverySchedule.set(d, list);
  }
}

/** how much of `itemId` is still to be consumed from day `from` onwards */
function usageFrom(itemId, from) {
  let t = 0;
  for (let d = from; d < DAYS; d++) t += dailyUsage[d].get(itemId) ?? 0;
  return t;
}

/**
 * From which delivery does the cheese run short?
 *
 * Naively, cutting only the *last* delivery does nothing: at that point the
 * kitchen is still holding most of a par and would coast to the end above the
 * minimum. (It did exactly that on the first run — the low-stock alert never
 * fired.) The order has to be cut early enough that the remaining trade eats
 * the difference.
 *
 * Every delivery tops up to par, so the balance the morning of delivery d is
 * `par − usage since the delivery before it`. Walk the calendar and take the
 * last delivery where that balance is still less than everything left to sell
 * plus the closing stock we want: short-ship there, and the deliveries after
 * it have nothing left to ask for. Nothing goes negative, because the receipt
 * is sized off usage that is already known.
 */
function shortShipFrom(itemId, closingDays) {
  const days = deliveryDays(STOCK_BY_ID.get(itemId).cadence);
  const target = par.get(itemId).target;
  const closing = (avgDaily.get(itemId) ?? 0) * closingDays;
  let cutoff = days[days.length - 1];
  let prev = 0;
  for (const d of days) {
    let since = 0;
    for (let k = prev; k < d; k++) since += dailyUsage[k].get(itemId) ?? 0;
    if (target - since < usageFrom(itemId, d) + closing) cutoff = d;
    prev = d;
  }
  return cutoff;
}

const SHORT_FROM = shortShipFrom(SHORT_ITEM, SHORT_CLOSING_DAYS);

const salesByOrder = new Map(); // orderId → Map(itemId → qty)
for (const o of orders) {
  if (o.cancelled) continue;
  const acc = new Map();
  for (const l of o.lines) consume(acc, l);
  salesByOrder.set(o.id, acc);
}

const ordersByDay = new Map();
for (const o of orders) {
  const list = ordersByDay.get(o.day) ?? [];
  list.push(o);
  ordersByDay.set(o.day, list);
}
for (const list of ordersByDay.values()) list.sort((a, b) => a.createdAt - b.createdAt);

for (let d = 0; d < DAYS; d++) {
  // ── 08:00, the van ──
  for (const itemId of deliverySchedule.get(d) ?? []) {
    const s = STOCK_BY_ID.get(itemId);
    const l = levelOf(LOC_BRANCH, itemId);
    let qty = r3(par.get(itemId).target - l.qty);

    const short = itemId === SHORT_ITEM && d >= SHORT_FROM;
    if (short) {
      // The one deliberate stock decision in the file — and it is a stock
      // decision, not a number: the supplier had a cheese shortage and the
      // orders from here on were cut to what he had. Sized off usage that is
      // already known, so the balance never goes negative, and the kitchen
      // finishes the window under par with about a day and a half of cover.
      qty = r3(Math.max(0, usageFrom(itemId, d) + (avgDaily.get(itemId) ?? 0) * SHORT_CLOSING_DAYS - l.qty));
    }

    if (qty > 0.0005) {
      receive(LOC_BRANCH, itemId, qty, purchasePrice(s, d), at(d, 8, 0),
        short ? "Short shipment — supplier out of stock" : "Delivery");
    }
  }

  // ── trading ──
  for (const o of ordersByDay.get(d) ?? []) {
    const used = salesByOrder.get(o.id);
    if (!used) continue;
    for (const [itemId, qty] of used) {
      if (qty <= 0) continue;
      issue(LOC_BRANCH, itemId, r3(qty), "sale", o.createdAt, "Order", o.id, `Order ${o.id}`, o.createdByEmployee);
    }
  }

  const dow = dayDate(d).getDay();

  // ── Sunday night: what got thrown out ──
  // 1.5% of the week's fresh usage. It is a separate line on the dashboard, not
  // part of cost of goods, because a restaurant that cannot tell waste from
  // consumption cannot fix either.
  if (dow === 0) {
    for (const s of STOCK_ITEMS) {
      if (s.cadence !== F) continue;
      let week = 0;
      for (let k = Math.max(0, d - 6); k <= d; k++) week += dailyUsage[k].get(s.id) ?? 0;
      const w = r3(week * 0.015);
      const l = levelOf(LOC_BRANCH, s.id);
      if (w > 0.0005 && l.qty - w > 0) {
        issue(LOC_BRANCH, s.id, w, "waste", at(d, 22, 10), "Waste", null, "End-of-week check — spoilage", "emp-demo-danny");
      }
    }
  }

  // ── month end: the count, and the gap it finds ──
  if (d === 29 || d === 59 || d === 88) {
    for (const s of STOCK_ITEMS) {
      if (s.category === "packaging") continue;
      let month = 0;
      for (let k = Math.max(0, d - 29); k <= d; k++) month += dailyUsage[k].get(s.id) ?? 0;
      const variance = r3(month * 0.008); // over-portioning, mostly
      const l = levelOf(LOC_BRANCH, s.id);
      if (variance > 0.0005 && l.qty - variance > 0) {
        issue(LOC_BRANCH, s.id, variance, "count_adjust", at(d, 23, 0), "StockCount", null, "Monthly count — shortfall", "emp-demo-maria");
      }
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 12. SHIFTS
// ═════════════════════════════════════════════════════════════════════════════

const shifts = [];
let shiftSeq = 0;
for (let d = 0; d < DAYS; d++) {
  const dow = dayDate(d).getDay();
  for (const [employeeId, sh, sm, eh, em, posId] of rotaFor(d, dow, perDayOrderCount[d])) {
    // a couple of minutes either side, because nobody clocks in on the hour
    const clockIn = at(d, sh, sm + randint(-4, 3));
    const clockOut = at(d, eh, em + randint(0, 9));
    shifts.push({
      id: `sh-${String(++shiftSeq).padStart(5, "0")}`,
      employeeId,
      branchId: BRANCH_ID,
      posId,
      clockIn,
      clockOut,
      breaks: [],
      durationMin: Math.round((clockOut - clockIn) / 60000),
      status: "closed",
      approvedBy: "emp-demo-maria",
      createdAt: clockIn,
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 13. WRITE
//     The world went in as one transaction. The ninety days cannot: a single
//     transaction holding ~120,000 rows would sit on a lock long enough to be
//     its own problem. Chunked inserts instead, in dependency order, and the
//     whole thing is re-runnable from scratch if it fails halfway.
// ═════════════════════════════════════════════════════════════════════════════

async function bulk(model, rows, label, size = 1000) {
  for (let i = 0; i < rows.length; i += size) {
    await model.createMany({ data: rows.slice(i, i + size) });
  }
  console.log(`  ✓ ${label}: ${rows.length.toLocaleString("en-US")}`);
}

async function writeTrading() {
  // customers, with their totals already known
  const stats = new Map(CUSTOMERS.map((c) => [c.id, { orders: 0, spent: 0, points: 0, last: null }]));
  for (const o of orders) {
    if (!o.userId || o.cancelled) continue;
    const s = stats.get(o.userId);
    s.orders++;
    s.spent = r2(s.spent + o.total);
    s.points += o.pointsEarned;
    if (!s.last || o.createdAt > s.last) s.last = o.createdAt;
  }

  await bulk(db.user, CUSTOMERS.map((c) => {
    const s = stats.get(c.id);
    return {
      id: c.id, name: c.name, phone: c.phone,
      loyaltyPoints: s.points, orderCount: s.orders, totalSpent: s.spent, lastOrderAt: s.last,
    };
  }), "customers");

  await bulk(db.address, CUSTOMERS.map((c, i) => ({
    id: `adr-${String(i + 1).padStart(3, "0")}`,
    userId: c.id, title: "Home", street: c.address, isDefault: true,
  })), "addresses");

  await bulk(db.order, orders.map((o) => ({
    id: o.id, source: o.source, orgId: o.orgId, branchId: o.branchId, posId: o.posId,
    userId: o.userId, createdByEmployee: o.createdByEmployee,
    subtotal: o.subtotal, discountBreakdown: o.discountBreakdown, discountTotal: o.discountTotal,
    deliveryFee: o.deliveryFee, tax: o.tax, tip: o.tip,
    pointsRedeemed: o.pointsRedeemed, pointsValue: o.pointsValue,
    total: o.total, pointsEarned: o.pointsEarned,
    fulfillmentType: o.fulfillmentType, address: o.address, tableNo: o.tableNo,
    customerName: o.customerName, customerPhone: o.customerPhone,
    paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus,
    paidAmount: o.paidAmount, changeGiven: o.changeGiven,
    terminalId: o.terminalId, txnRef: o.txnRef,
    status: o.status, statusHistory: o.statusHistory,
    driverId: o.driverId, assignedAt: o.assignedAt ?? null,
    pickedUpAt: o.pickedUpAt ?? null, deliveredAt: o.deliveredAt ?? null,
    notes: o.notes, createdAt: o.createdAt, updatedAt: o.deliveredAt ?? o.createdAt,
    clientRef: o.clientRef,
  })), "orders", 500);

  await bulk(db.orderItem, orderItems, "order items", 1000);

  await bulk(db.pointsEntry, orders
    .filter((o) => o.userId && !o.cancelled && o.pointsEarned > 0)
    .map((o) => ({
      userId: o.userId, type: "earn", points: o.pointsEarned,
      orderId: o.id, reason: `Order · $${o.subtotal.toFixed(2)}`, createdAt: o.createdAt,
    })), "loyalty entries", 1000);

  await bulk(db.shift, shifts, "shifts");

  await bulk(db.stockMovement, movements, "stock movements", 1000);

  // The level cache, written last, from the balances the journal produced —
  // never the other way round. min/target only on the kitchen: the back store
  // is the source of replenishment, not a thing that gets replenished.
  const levelRows = [];
  let levelSeq = 0;
  for (const [key, l] of levels) {
    const [locationId, itemId] = key.split("|");
    const p = par.get(itemId);
    levelRows.push({
      id: `lv-${String(++levelSeq).padStart(4, "0")}`,
      locationId, itemId,
      qty: r3(l.qty),
      minLevel: locationId === LOC_BRANCH ? p.min : null,
      targetLevel: locationId === LOC_BRANCH ? p.target : null,
      avgCost: l.avgCost == null ? null : r4(l.avgCost),
    });
  }
  await bulk(db.stockLevel, levelRows, "stock levels");
}

// ═════════════════════════════════════════════════════════════════════════════
// 14. SETTINGS
//     `Setting: org` is not written here. deploy/new-tenant.sh owns it.
// ═════════════════════════════════════════════════════════════════════════════

async function seedSettings() {
  const put = (key, value) => ({ key, value, updatedBy: "seed-demo" });

  await db.setting.createMany({
    data: [
      put("order", {
        minOrder: MIN_ORDER,
        deliveryFee: DELIVERY_FEE,
        freeDeliveryThreshold: FREE_DELIVERY,
        maxToppings: 8,
        currency: "USD",
      }),
      put("loyalty", { enabled: true, pointsPerGel: 1, redeemRate: 0.05, minRedeem: 100 }),
      // `rate` and `inclusive` are what app/admin/settings/actions.ts reads
      // today; `rates` and `rules` are the Wave-1 shape from
      // MIGRATION-WAVE-1.md, seeded now so the data is ready when the reads move.
      put("tax", {
        rate: TAX_PERCENT,
        inclusive: false,
        rates: [{ code: "ny-orange", label: { en: "NY State + Orange County" }, percent: TAX_PERCENT }],
        rules: { dine_in: "ny-orange", pickup: "ny-orange", delivery: "ny-orange" },
      }),
      put("tip", { enabled: true, presets: [15, 18, 20, 25], allowCustom: true, onDelivery: true, onPickup: true }),
      put("employeeDiscount", { enabled: true, value: 25, mode: "percent", appliesEverywhere: true }),
      put("discountRules", { stackable: false, excludeCombos: true, excludePromoProducts: true }),
      put("discountVerification", { mode: "manual" }),
      put("fixedCosts", FIXED_COSTS),
      put("menu.modifierLabel", { en: "Toppings", ka: "ტოპინგები" }),
      put("units.system", { system: "imperial" }),
      put("adminLanguage", { lang: "en" }),
      put("social", [
        { id: "facebook", label: "Facebook", href: "", enabled: true },
        { id: "instagram", label: "Instagram", href: "", enabled: true },
        { id: "tiktok", label: "TikTok", href: "", enabled: false },
        { id: "x", label: "X", href: "", enabled: false },
      ]),
    ],
  });

  console.log(`  ✓ settings: ${SETTING_KEYS.length} keys (Setting: org left alone)`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 15. VERIFICATION
//     Read back from the database, with the same queries lib/analytics.ts uses.
//     If these numbers are wrong, the demo is wrong, and it should say so here
//     rather than in front of a prospect.
// ═════════════════════════════════════════════════════════════════════════════

const money = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

function band(label, value, lo, hi, unit = "%") {
  const ok = value >= lo && value <= hi;
  return `${ok ? "✓" : "!"} ${label.padEnd(16)} ${String(value).padStart(8)}${unit}   target ${lo}–${hi}${unit}`;
}

async function reportWindow(from, to, days, label) {
  const [orderRows, moveRows, shiftRows, fixed] = await Promise.all([
    db.order.findMany({
      where: { createdAt: { gte: from, lte: to }, status: { not: "cancelled" } },
      select: { total: true, tip: true, tax: true, source: true, paymentMethod: true },
    }),
    db.stockMovement.findMany({
      where: { at: { gte: from, lte: to }, totalCost: { not: null } },
      select: { type: true, totalCost: true },
    }),
    db.shift.findMany({
      where: { clockIn: { gte: from, lte: to } },
      include: { employee: { select: { hourlyRate: true } } },
    }),
    db.setting.findUnique({ where: { key: "fixedCosts" } }),
  ]);

  const revenue = r2(orderRows.reduce((s, o) => s + Number(o.total), 0));
  const count = orderRows.length;
  const avgCheck = count ? r2(revenue / count) : 0;

  const sumType = (t) => r2(Math.abs(moveRows.filter((m) => m.type === t).reduce((s, m) => s + Number(m.totalCost), 0)));
  const cogs = sumType("sale");
  const waste = sumType("waste");

  let labour = 0;
  let hours = 0;
  for (const s of shiftRows) {
    const mins = s.durationMin ?? (s.clockOut ? Math.round((s.clockOut - s.clockIn) / 60000) : 0);
    hours += mins / 60;
    labour += (mins / 60) * Number(s.employee.hourlyRate ?? 0);
  }
  labour = r2(labour);

  const fv = fixed?.value ?? {};
  const monthly = Number(fv.rent ?? 0) + Number(fv.utilities ?? 0) + Number(fv.other ?? 0);
  const fixedForPeriod = r2((monthly / 30) * days);
  const net = r2(revenue - cogs - labour - fixedForPeriod);

  const tips = r2(orderRows.reduce((s, o) => s + Number(o.tip), 0));
  const cardOrders = orderRows.filter((o) => o.paymentMethod === "card");
  const share = (src) => pct(orderRows.filter((o) => o.source === src).length, count);

  console.log("");
  console.log(`  ── ${label} ──────────────────────────────────────────────`);
  console.log(`     revenue (net sales)   ${money(revenue)}`);
  console.log(`     orders                ${count.toLocaleString("en-US")}`);
  console.log(`     average check         ${money(avgCheck)}`);
  console.log(`     sales tax collected   ${money(r2(orderRows.reduce((s, o) => s + Number(o.tax), 0)))}   (not counted as revenue)`);
  console.log(`     tips to staff         ${money(tips)}   (not counted as revenue)`);
  console.log("");
  console.log(`     ${band("food cost", pct(cogs, revenue), 28, 33)}      ${money(cogs)}`);
  console.log(`     ${band("labour cost", pct(labour, revenue), 24, 30)}      ${money(labour)} · ${Math.round(hours)} h · ${shiftRows.length} shifts`);
  console.log(`     ${band("prime cost", pct(cogs + labour, revenue), 55, 62)}      ${money(r2(cogs + labour))}`);
  console.log(`     ${band("net profit", pct(net, revenue), 8, 11)}      ${money(net)}  after ${money(fixedForPeriod)} fixed`);
  console.log("");
  console.log(`     waste                 ${money(waste)}  (${pct(waste, revenue)}% of revenue — a separate line, not in food cost)`);
  console.log(`     channel mix           web ${share("web")}%  ·  pos ${share("pos")}%  ·  phone ${share("phone")}%      target 45 / 40 / 15`);
  console.log(`     payment mix           card ${pct(cardOrders.length, count)}%  ·  cash ${pct(count - cardOrders.length, count)}%   target 70 / 30`);
  console.log(`     tip on card orders    ${pct(tips, r2(cardOrders.reduce((s, o) => s + Number(o.total), 0)))}%                       target ~16%`);

  return { revenue, count, cogs, labour, net };
}

/**
 * The three things that must be visibly wrong. Recomputed here the way
 * lib/costing.ts computes them, from the warehouse average cost — so if the
 * costing screen and this block ever disagree, one of them is broken.
 */
async function problems() {
  const [rules, levelRows, productRows, itemRevenue] = await Promise.all([
    db.consumptionRule.findMany({
      where: { productId: { not: null } },
      select: { productId: true, itemId: true, qty: true, sizeKey: true },
    }),
    db.stockLevel.findMany({ select: { locationId: true, itemId: true, qty: true, minLevel: true, avgCost: true } }),
    db.product.findMany({ select: { id: true, name: true, price: true, sizes: { select: { key: true, price: true } } } }),
    db.orderItem.groupBy({
      by: ["productId"],
      where: { order: { status: { not: "cancelled" } } },
      _sum: { lineTotal: true, qty: true },
    }),
  ]);

  const cost = new Map();
  for (const l of levelRows) if (l.locationId === LOC_WAREHOUSE && l.avgCost != null) cost.set(l.itemId, Number(l.avgCost));

  const revById = new Map(itemRevenue.map((r) => [r.productId, Number(r._sum.lineTotal ?? 0)]));
  const productById = new Map(productRows.map((p) => [p.id, p]));

  // group exactly as computeMenuCosts() does: owner + size
  const groups = new Map();
  for (const r of rules) {
    const key = `${r.productId}|${r.sizeKey ?? ""}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  let worst = null;
  for (const [key, list] of groups) {
    const [productId, sizeKey] = key.split("|");
    const p = productById.get(productId);
    if (!p) continue;
    let c = 0;
    let missing = 0;
    for (const r of list) {
      const avg = cost.get(r.itemId);
      if (avg == null) missing++;
      else c += Number(r.qty) * avg;
    }
    if (missing > 0) continue;
    const price = sizeKey ? Number(p.sizes.find((s) => s.key === sizeKey)?.price ?? 0) : Number(p.price ?? 0);
    if (!price) continue;
    const marginPct = Math.round(((price - c) / price) * 1000) / 10;
    const revenue = revById.get(productId) ?? 0;
    if (!worst || marginPct < worst.marginPct) {
      worst = { productId, name: p.name?.en ?? productId, sizeKey: sizeKey || null, cost: r2(c), price, marginPct, revenue: r2(revenue) };
    }
  }

  const low = levelRows
    .filter((l) => l.locationId === LOC_BRANCH && l.minLevel != null && Number(l.qty) <= Number(l.minLevel))
    .map((l) => {
      const s = STOCK_BY_ID.get(l.itemId);
      const a = avgDaily.get(l.itemId) ?? 0;
      return {
        name: s?.name.en ?? l.itemId,
        qty: r3(Number(l.qty)),
        unit: s?.unit ?? "",
        min: r3(Number(l.minLevel)),
        cover: a > 0 ? Math.round((Number(l.qty) / a) * 10) / 10 : null,
      };
    })
    .sort((a, b) => (a.cover ?? 99) - (b.cover ?? 99));

  const weekAgo = new Date(TODAY.getTime() - 7 * 86400_000);
  const lateRows = await db.order.findMany({
    where: { fulfillmentType: "delivery", deliveredAt: { not: null }, createdAt: { gte: weekAgo } },
    select: { orderNo: true, createdAt: true, deliveredAt: true },
  });
  const late = lateRows
    .map((o) => ({ orderNo: o.orderNo, minutes: Math.round((o.deliveredAt - o.createdAt) / 60000) }))
    .filter((o) => o.minutes > 45)
    .sort((a, b) => b.minutes - a.minutes);

  console.log("");
  console.log("  ── the three things that are supposed to be wrong ──────────────────");
  if (worst) {
    console.log(`     losing product     ${worst.name}${worst.sizeKey ? ` (${worst.sizeKey})` : ""} — ${money(worst.price)} sells for ${money(worst.cost)} of ingredients`);
    console.log(`                        margin ${worst.marginPct}%  ·  ${money(worst.revenue)} of revenue over 90 days   ${worst.marginPct < 25 ? "✓ under 25%" : "! not under 25%"}`);
  } else {
    console.log("     losing product     ! could not be computed — no priced ingredients");
  }
  if (low.length) {
    const l = low[0];
    console.log(`     low stock          ${l.name}: ${l.qty} ${l.unit} against a par of ${l.min} — ${l.cover} days of cover   ${l.cover !== null && l.cover < 2 ? "✓ under two days" : "! not under two days"}`);
    if (low.length > 1) console.log(`                        (${low.length} items below par in total)`);
  } else {
    console.log("     low stock          ! nothing is below par");
  }
  console.log(`     late deliveries    ${late.length} over 45 minutes in the last seven days   ${late.length === 4 ? "✓" : "!"}`);
  for (const l of late.slice(0, 6)) console.log(`                        #${l.orderNo} — ${l.minutes} min`);
}

// ═════════════════════════════════════════════════════════════════════════════
// RUN
// ═════════════════════════════════════════════════════════════════════════════

const t0 = Date.now();

try {
  await wipe();
  await seedWorld();
  await seedSettings();
  console.log("");
  console.log("  writing ninety days …");
  await writeTrading();

  const from = at(0, 0, 0);
  const to = at(DAYS - 1, 23, 59, 59);

  await reportWindow(from, to, DAYS, "ninety days  (the seeded window — this is the one the targets are set against)");
  await reportWindow(at(DAYS - 30, 0, 0), to, 30, "last thirty days  (the dashboard's default view — the targets are set against the ninety, see the note below)");
  await problems();

  console.log("");
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  console.log("");
  console.log("  Note on the two windows above: with revenue growing 12% and fixed costs");
  console.log("  flat, net profit is necessarily higher on the recent thirty days than on");
  console.log("  the full ninety. Both cannot sit inside 8–11% at once. The ninety-day");
  console.log("  figure is the one DEMO.md's targets describe; the thirty-day figure is");
  console.log("  the growth showing up, which is the point.");
  console.log("");
  console.log("  Next, an admin login (a fresh address — do not reuse a staff email, or");
  console.log("  create-admin.mjs will promote that employee to super_admin):");
  console.log("");
  console.log("      node scripts/create-admin.mjs \"Demo Owner\" owner@demo.invalid \"<password>\"");
  console.log("");
} catch (e) {
  console.error("");
  console.error("  FAILED — nothing was left half-written inside a transaction, but the");
  console.error("  bulk trading rows may be partial. Re-run the script; it wipes first.");
  console.error("");
  console.error(e);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
