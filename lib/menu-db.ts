import "server-only";
import { db } from "@/lib/db";
import type { MenuPayload } from "@/lib/data";

/**
 * ბაზა → `lib/data.ts`-ის ზუსტი ფორმატი.
 *
 * მიზანი: კომპონენტებმა არაფერი იცოდნენ ბაზაზე. `applyMenu()` ავსებს იმავე
 * მასივებს, რომლებსაც ისინი უკვე იმპორტავენ — ანუ არცერთი კომპონენტი არ იცვლება.
 */

type Json = unknown;

function txt(v: Json, lang: "en" | "ka"): string {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const en = String(o.en ?? "");
    const ka = String(o.ka ?? en);
    return lang === "ka" ? ka || en : en || ka;
  }
  return "";
}

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** ზომების ფასები [S, M, XL] — თუ რომელიმე აკლია, 0. */
function triple(rows: { key?: string; sizeKey?: string; price: unknown }[]): [number, number, number] {
  const pick = (k: string) => {
    const r = rows.find((x) => (x.key ?? x.sizeKey) === k);
    return r ? n(r.price) : 0;
  };
  return [pick("S"), pick("M"), pick("XL")];
}

export async function getMenu(): Promise<MenuPayload> {
  /* eslint-disable prefer-const */
  let [products, toppings, combos, branches, settings] = await Promise.all([
    db.product.findMany({
      where: { deletedAt: null, active: true },
      orderBy: [{ sortOrder: "asc" }],
      include: {
        category: true,
        sizes: { orderBy: { sortOrder: "asc" } },
        ingredients: { include: { topping: true }, orderBy: { sortOrder: "asc" } },
        promo: true,
        branchProducts: true,
      },
    }),
    db.topping.findMany({
      where: { deletedAt: null, active: true },
      orderBy: { sortOrder: "asc" },
      include: { prices: true },
    }),
    db.combo.findMany({
      where: { deletedAt: null, active: true },
      orderBy: { sortOrder: "asc" },
      include: {
        slots: {
          orderBy: { sortOrder: "asc" },
          include: { options: { include: { product: true } } },
        },
        branchCombos: true,
      },
    }),
    db.branch.findMany({ where: { deletedAt: null, active: true }, orderBy: { sortOrder: "asc" } }),
    db.setting.findMany(),
  ]);

  // ყველა აქტიურ ფილიალში გამორთული პროდუქტი საიტზე არ ჩანს.
  // (ფილიალის მიხედვით ფილტრაცია მაშინ ჩაირთვება, როცა საიტს ფილიალის არჩევა დაემატება)
  const branchCount = branches.length;
  const soldSomewhere = (p: { branchProducts: { available: boolean }[] }) => {
    if (branchCount === 0) return true;
    const off = p.branchProducts.filter((bp) => !bp.available).length;
    return off < branchCount;
  };
  products = products.filter(soldSomewhere);
  // იგივე წესი კომბოებზე — ყველგან გამორთული საიტზე არ ჩანს
  combos = combos.filter((c) => {
    if (branchCount === 0) return true;
    const off = c.branchCombos.filter((bc) => !bc.available).length;
    return off < branchCount;
  });

  const set = Object.fromEntries(settings.map((s) => [s.key, s.value])) as Record<string, Json>;
  const order = (set.order && typeof set.order === "object" ? set.order : {}) as Record<string, unknown>;

  // ── PIZZAS ──
  const pizzaRows = products.filter((p) => p.type === "pizza");
  const PIZZAS = pizzaRows.map((p) => ({
    id: p.legacyId ?? 0,
    tier: (p.tier === "house" ? "house" : "standard") as "standard" | "house",
    name: txt(p.name, "en"),
    name_ka: txt(p.name, "ka"),
    emoji: p.emoji ?? "🍕",
    badge: p.badge ? txt(p.badge, "en") || null : null,
    badge_ka: p.badge ? txt(p.badge, "ka") : undefined,
    tagline: txt(p.description, "en"),
    tagline_ka: txt(p.description, "ka"),
    sizes: triple(p.sizes) as [number, number, number],
    ings: p.ingredients.map((i) => txt(i.topping.name, "en")),
    isBYO: p.isBYO || undefined,
  }));

  const PIZZA_PHOTOS: Record<number, string> = {};
  for (const p of pizzaRows) {
    if (p.legacyId != null && p.photo) PIZZA_PHOTOS[p.legacyId] = p.photo;
  }

  // ── TOPPINGS ──
  const TOPPINGS = toppings.map((t) => ({
    name: txt(t.name, "en"),
    name_ka: txt(t.name, "ka"),
    emoji: t.emoji ?? "🍕",
    ps: triple(t.prices) as [number, number, number],
    dots: t.dots.length ? t.dots : t.category ? [t.category] : [],
    recipeOnly: t.recipeOnly || undefined,
  }));

  const TOPPING_PHOTOS: Record<string, string> = {};
  for (const t of toppings) {
    if (t.photo) TOPPING_PHOTOS[txt(t.name, "en")] = t.photo;
  }

  const POPULAR = toppings.filter((t) => t.popular).map((t) => txt(t.name, "en"));

  // ── EXTRAS / SAUCES / DRINKS ──
  const asItem = (p: (typeof products)[number]) => ({
    id: p.id.replace(/^(side|drink)-/, ""),
    name: txt(p.name, "en"),
    name_ka: txt(p.name, "ka"),
    price: n(p.price),
    desc: txt(p.description, "en"),
    desc_ka: txt(p.description, "ka"),
    emoji: p.emoji ?? "🍽️",
    builder: (p.builder as "sticks" | "cinsticks" | undefined) ?? undefined,
    photo: p.photo ?? undefined,
  });

  const EXTRAS = products.filter((p) => p.category.id === "cat-sides").map(asItem);
  const SAUCES = products.filter((p) => p.category.id === "cat-sauces").map(asItem);
  const DRINKS = products.filter((p) => p.category.id === "cat-drinks").map(asItem);

  // ── LOCATIONS ──
  const LOCATIONS = branches.map((b) => {
    const hours =
      b.hours && typeof b.hours === "object" && "display" in (b.hours as Record<string, unknown>)
        ? txt((b.hours as Record<string, unknown>).display, "en")
        : "";
    /**
     * ⚠️ The branch name and its address, and nothing else.
     *
     * This used to read:
     *
     *   `Ronny's Pizza ${name}, ${address}, Tbilisi`
     *
     * so the "directions" button on a Monroe restaurant's site opened Google
     * Maps searching for "Ronny's Pizza Main, 1 Test Street, Monroe, NY 10950,
     * Tbilisi" — a real address wrapped in another business's name and a city
     * eight thousand kilometres away. A customer pressing it did not get lost;
     * they got somebody else's pizzeria, which is worse.
     *
     * The address alone is what identifies a place on a map. Anything added to
     * it is a guess about the business, and the guess was baked in.
     */
    const label = `${txt(b.name, "en")}, ${txt(b.address, "en")}`;
    return {
      id: b.id.replace(/^br-/, ""),
      branch: txt(b.name, "en"),
      branch_ka: txt(b.name, "ka"),
      address: txt(b.address, "en"),
      address_ka: txt(b.address, "ka"),
      hours,
      phone: b.phone ?? "",
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`,
    };
  });

  // ── COMBOS ──
  // productId → ref ("pizza:1" | "drink:cola" | "side:sticks")
  const refOf = (p: { id: string; type: string; legacyId: number | null }) => {
    if (p.type === "pizza") return `pizza:${p.legacyId ?? 0}`;
    if (p.id.startsWith("drink-")) return `drink:${p.id.slice(6)}`;
    if (p.id.startsWith("side-")) return `side:${p.id.slice(5)}`;
    return `side:${p.id}`;
  };

  const COMBOS = combos.map((c) => ({
    id: c.id,
    name: txt(c.name, "en"),
    name_ka: txt(c.name, "ka"),
    desc: txt(c.description, "en"),
    desc_ka: txt(c.description, "ka"),
    photo: c.photo ?? undefined,
    pricing: {
      mode: c.pricingMode as "fixed" | "discount",
      price: c.price != null ? n(c.price) : undefined,
      percent: c.percent != null ? n(c.percent) : undefined,
    },
    badge: c.badge ? txt(c.badge, "en") : undefined,
    badge_ka: c.badge ? txt(c.badge, "ka") : undefined,
    active: c.active,
    slots: c.slots.map((s) => ({
      label: txt(s.label, "en"),
      label_ka: txt(s.label, "ka"),
      mode: s.mode as "fixed" | "choice",
      options: s.options
        .filter((o) => o.product.active && o.product.deletedAt === null)
        .map((o) => refOf(o.product)),
    })),
  }));

  return {
    PIZZAS,
    PIZZA_PHOTOS,
    TOPPINGS,
    TOPPING_PHOTOS,
    POPULAR,
    EXTRAS,
    SAUCES,
    DRINKS,
    LOCATIONS,
    COMBOS,
    MAX_TOPPINGS: Number(order.maxToppings ?? 6),
    MIN_ORDER: Number(order.minOrder ?? 25),
    FREE_DELIVERY: Number(order.freeDeliveryThreshold ?? 60),
    DELIVERY_FEE: Number(order.deliveryFee ?? 5.5),
  };
}
