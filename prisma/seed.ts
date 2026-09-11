// prisma/seed.ts
// მენიუს seed — წყარო: lib/data.ts
//
// ⚠️ მთავარი წესი: **admin-ის ცვლილებას არ ეხება.**
//   • ჩანაწერი არ არსებობს → იქმნება
//   • ჩანაწერი არსებობს    → ივსება მხოლოდ ცარიელი ველები
//   • ფასი/ფოტო/სახელი, რომელიც admin-ში შეიცვალა → ხელუხლებელი
//
// გაშვება:
//   npx tsx prisma/seed.ts          ← უსაფრთხო
//   npx tsx prisma/seed.ts --force  ← ყველაფრის დაბრუნება lib/data.ts-იდან

import { PrismaClient } from "@prisma/client";
// ⚠️ SEED_* და არა PIZZAS/TOPPINGS/...
//
// lib/data.ts-ში ცოცხალი ცვლადები ახლა ცარიელია და ბაზიდან ივსება. რონის
// მონაცემები იმავე ფაილში SEED_ პრეფიქსით ცხოვრობს და მხოლოდ აქ იკითხება.
// ეს განსხვავება იმისთვისაა, რომ ერთი რესტორნის მენიუ მეორის საიტზე ვეღარ
// მოხვდეს — ადრე ცარიელი ბაზა ნიშნავდა, რომ ბრაუზერამდე რონის მენიუ მიდიოდა.
import {
  SEED_PIZZAS as PIZZAS,
  SEED_TOPPINGS as TOPPINGS,
  SEED_PIZZA_PHOTOS as PIZZA_PHOTOS,
  SEED_TOPPING_PHOTOS as TOPPING_PHOTOS,
  SEED_POPULAR as POPULAR,
  SEED_EXTRAS as EXTRAS,
  SEED_SAUCES as SAUCES,
  SEED_DRINKS as DRINKS,
  SEED_LOCATIONS as LOCATIONS,
  SEED_COMBOS as COMBOS,
  MAX_TOPPINGS,
  MIN_ORDER,
  FREE_DELIVERY,
  DELIVERY_FEE,
} from "../lib/data";

const db = new PrismaClient();
const FORCE = process.argv.includes("--force");

let created = 0;
let filled = 0;
let kept = 0;

/** მხოლოდ ცარიელი ველები — არსებულს არ ვეხებით. */
function backfill(existing: Record<string, unknown>, desired: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(desired)) {
    if (v === null || v === undefined || v === "") continue;
    const cur = existing[k];
    const empty =
      cur === null || cur === undefined || cur === "" || (Array.isArray(cur) && cur.length === 0);
    if (empty) patch[k] = v;
  }
  return patch;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** create → backfill → (FORCE ? overwrite : skip) */
async function put(model: any, where: any, data: Record<string, unknown>) {
  const existing = await model.findUnique({ where });
  if (!existing) {
    await model.create({ data: { ...where, ...data } });
    created++;
    return;
  }
  if (FORCE) {
    await model.update({ where, data });
    filled++;
    return;
  }
  const patch = backfill(existing, data);
  if (!Object.keys(patch).length) {
    kept++;
    return;
  }
  await model.update({ where, data: patch });
  filled++;
}

const ORG_ID = "ronnys";
const SIZE_KEYS = ["S", "M", "XL"] as const;
const SIZE_CM = [20, 30, 45];

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const toppingId = (name: string) => `top-${slug(name)}`;
const refToId = (ref: string) => ref.replace(":", "-");
const i18n = (en: string, ka?: string | null) => ({ en, ka: ka || en });

const popularSet = new Set(POPULAR);

async function main() {
  console.log(
    FORCE
      ? "⚠️  FORCE — ყველაფერი lib/data.ts-იდან გადაიწერება\n"
      : "უსაფრთხო რეჟიმი — admin-ის ცვლილებებს არ ვეხები\n",
  );

  // ── 1) ორგანიზაცია ──────────────────────────────────────────
  await put(db.organization, { id: ORG_ID }, { name: i18n("Ronny's Pizza"), active: true });

  // ── 2) ბრანჩები + POS ტერმინალები ───────────────────────────
  for (const [i, loc] of LOCATIONS.entries()) {
    const branchId = `br-${loc.id}`;
    const code = `TBS-0${i + 1}`;
    const data = {
      orgId: ORG_ID,
      code,
      name: i18n(loc.branch, loc.branch_ka),
      address: i18n(loc.address, loc.address_ka),
      phone: loc.phone,
      hours: { display: i18n(loc.hours) },
      active: true,
      sortOrder: i,
    };
    await put(db.branch, { id: branchId }, data);

    for (const n of [1, 2]) {
      const posId = `${code}-POS-${n}`;
      await put(db.terminal, { posId }, {
        branchId,
        label: i18n(`POS ${n}`),
        active: true,
        hasCardTerminal: true,
      });
    }
  }

  // ── 3) settings — key/value ─────────────────────────────────
  const settings: Record<string, unknown> = {
    order: {
      minOrder: MIN_ORDER,
      deliveryFee: DELIVERY_FEE,
      freeDeliveryThreshold: FREE_DELIVERY,
      maxToppings: MAX_TOPPINGS,
      currency: "GEL",
    },
    loyalty: { enabled: true, pointsPerGel: 1, redeemRate: 0.1, minRedeem: 100 },
    employeeDiscount: { enabled: true, value: 30, mode: "percent", appliesEverywhere: true },
    discountRules: { stackable: false, excludeCombos: true, excludePromoProducts: true },
    discountVerification: { mode: "manual" },
    tax: { rate: 0, inclusive: true },
    social: [
      { id: "facebook", label: "Facebook", href: "", enabled: true },
      { id: "instagram", label: "Instagram", href: "", enabled: true },
      { id: "tiktok", label: "TikTok", href: "", enabled: true },
      { id: "x", label: "X", href: "", enabled: false },
    ],
  };
  for (const [key, value] of Object.entries(settings)) {
    const exists = await db.setting.findUnique({ where: { key } });
    if (!exists) {
      await db.setting.create({ data: { key, value: value as object, updatedBy: "seed" } });
      created++;
    } else if (FORCE) {
      await db.setting.update({ where: { key }, data: { value: value as object, updatedBy: "seed" } });
      filled++;
    } else kept++;
  }

  // ── 4) კატეგორიები ──────────────────────────────────────────
  const categories = [
    { id: "cat-pizza", name: i18n("Pizza", "პიცა"), icon: "🍕", sortOrder: 1 },
    { id: "cat-sides", name: i18n("Sides", "დამატებები"), icon: "🥖", sortOrder: 2 },
    { id: "cat-sauces", name: i18n("Sauces", "სოუსები"), icon: "🥫", sortOrder: 3 },
    { id: "cat-drinks", name: i18n("Drinks", "სასმელი"), icon: "🥤", sortOrder: 4 },
  ];
  for (const c of categories) {
    const { id, ...rest } = c;
    await put(db.category, { id }, { ...rest, type: "food", active: true });
  }

  // ── 5) ტოპინგები + ფასები ზომებზე ───────────────────────────
  for (const [i, t] of TOPPINGS.entries()) {
    const id = toppingId(t.name);
    const data = {
      name: i18n(t.name, t.name_ka),
      category: t.dots?.[0] ?? null,
      emoji: t.emoji ?? null,
      dots: t.dots ?? [],
      popular: popularSet.has(t.name),
      photo: TOPPING_PHOTOS[t.name] ?? null,
      recipeOnly: !!t.recipeOnly,
      active: true,
      sortOrder: i,
    };
    await put(db.topping, { id }, data);

    for (const [si, key] of SIZE_KEYS.entries()) {
      await put(db.toppingPrice, { toppingId_sizeKey: { toppingId: id, sizeKey: key } }, {
        toppingId: id,
        sizeKey: key,
        price: t.ps[si],
      });
    }
  }

  // ── 6) პიცები ───────────────────────────────────────────────
  for (const p of PIZZAS) {
    const id = `pizza-${p.id}`;
    const data = {
      name: i18n(p.name, p.name_ka),
      description: i18n(p.tagline, p.tagline_ka),
      categoryId: "cat-pizza",
      type: "pizza" as const,
      legacyId: p.id,
      emoji: p.emoji ?? null,
      isBYO: !!p.isBYO,
      photo: PIZZA_PHOTOS[p.id] ?? null,
      price: null,
      tier: p.tier,
      badge: p.badge ? i18n(p.badge, p.badge_ka) : undefined,
      discountable: true,
      active: true,
      sortOrder: p.id,
    };
    await put(db.product, { id }, data);

    for (const [si, key] of SIZE_KEYS.entries()) {
      await put(db.productSize, { productId_key: { productId: id, key } }, {
        productId: id,
        key,
        cm: SIZE_CM[si],
        price: p.sizes[si],
        sortOrder: si,
      });
    }

    // რეცეპტი — მხოლოდ თუ საერთოდ ცარიელია (admin-ის ინგრედიენტებს არ ვშლით)
    const hasIngs = await db.productTopping.count({ where: { productId: id } });
    if (hasIngs === 0) {
      for (const [ii, ing] of (p.ings ?? []).entries()) {
        const tid = toppingId(ing);
        if (!(await db.topping.findUnique({ where: { id: tid } }))) {
          console.warn(`  ⚠ ტოპინგი ვერ მოიძებნა: "${ing}" (${p.name})`);
          continue;
        }
        await db.productTopping.create({ data: { productId: id, toppingId: tid, sortOrder: ii } });
        created++;
      }
    }
  }

  // ── 7) sides / sauces / drinks ──────────────────────────────
  const simple = [
    { list: EXTRAS, prefix: "side", categoryId: "cat-sides", type: "sticks" as const },
    { list: SAUCES, prefix: "side", categoryId: "cat-sauces", type: "item" as const },
    { list: DRINKS, prefix: "drink", categoryId: "cat-drinks", type: "drink" as const },
  ];
  let simpleCount = 0;
  for (const group of simple) {
    for (const [i, it] of group.list.entries()) {
      const id = `${group.prefix}-${it.id}`;
      const data = {
        name: i18n(it.name, it.name_ka),
        description: i18n(it.desc, it.desc_ka),
        categoryId: group.categoryId,
        type: group.type,
        emoji: it.emoji ?? null,
        builder: it.builder ?? null,
        photo: it.photo ?? null,
        price: it.price,
        discountable: true,
        active: true,
        sortOrder: i,
      };
      await put(db.product, { id }, data);
      simpleCount++;
    }
  }

  // ── 8) კომბოები ─────────────────────────────────────────────
  for (const [ci, c] of COMBOS.entries()) {
    const data = {
      name: i18n(c.name, c.name_ka),
      description: i18n(c.desc, c.desc_ka),
      photo: c.photo ?? null,
      badge: c.badge ? i18n(c.badge, c.badge_ka) : undefined,
      pricingMode: c.pricing.mode,
      price: c.pricing.price ?? null,
      percent: c.pricing.percent ?? null,
      discountable: false,
      active: c.active !== false,
      sortOrder: ci,
    };
    await put(db.combo, { id: c.id }, data);

    for (const [si, s] of c.slots.entries()) {
      const slotId = `${c.id}-slot-${si}`;
      await put(db.comboSlot, { id: slotId }, {
        comboId: c.id,
        label: i18n(s.label, s.label_ka),
        mode: s.mode,
        sortOrder: si,
      });

      // სლოტის ვარიანტები — მხოლოდ თუ ცარიელია
      const hasOpts = await db.comboSlotOption.count({ where: { slotId } });
      if (hasOpts === 0) {
        for (const ref of s.options) {
          const productId = refToId(ref);
          if (!(await db.product.findUnique({ where: { id: productId } }))) {
            console.warn(`  ⚠ combo ref ვერ მოიძებნა: "${ref}" (${c.name})`);
            continue;
          }
          await db.comboSlotOption.create({ data: { slotId, productId } });
          created++;
        }
      }
    }
  }

  // ── 9) შეჯამება ─────────────────────────────────────────────
  const [branches, cats, prods, tops, combos, sets] = await Promise.all([
    db.branch.count(),
    db.category.count(),
    db.product.count(),
    db.topping.count(),
    db.combo.count(),
    db.setting.count(),
  ]);
  console.log("\n─────────── seed ───────────");
  console.log(`შეიქმნა     ${created}`);
  console.log(`შეივსო      ${filled}`);
  console.log(`ხელუხლებელი ${kept}`);
  console.log("─────────── ბაზა ───────────");
  console.log(`branches   ${branches}`);
  console.log(`categories ${cats}`);
  console.log(`products   ${prods}`);
  console.log(`toppings   ${tops}`);
  console.log(`combos     ${combos}`);
  console.log(`settings   ${sets}`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
