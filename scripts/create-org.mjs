#!/usr/bin/env node
/**
 * The first rows a new restaurant needs to exist at all.
 *
 * ── Why this script had to be written ──
 *
 * `deploy/new-tenant.sh` provisions a tenant beautifully — user, database,
 * migrations, build, systemd, Caddy — and leaves the database completely empty.
 * The application does not survive that:
 *
 *   app/api/orders/route.ts:104   const org = await db.organization.findFirst();
 *                                 if (!org) return 500
 *   app/admin/branches/actions.ts const org = await db.organization.findFirst();
 *                                 if (!org) throw
 *
 * So every web order 500s, and the admin UI refuses to create the first branch
 * because creating a branch requires an organization that only a branch could
 * have created. `organization.create` existed in exactly one place in the whole
 * codebase — the demo seed, hardcoded to "Hudson Fire & Grind".
 *
 * A tenant was therefore born broken, with no supported way to un-break it.
 * This is that way.
 *
 * ── Usage ──
 *
 *   node scripts/create-org.mjs \
 *     --name "Hudson Fire & Grind" \
 *     --branch "Monroe" \
 *     --code MON-01 \
 *     --address "38 Millpond Parkway, Monroe, NY 10950" \
 *     --phone "+18455550100" \
 *     --tax-rate 8.125 \
 *     --currency USD \
 *     --pos 2
 *
 * `--tax-rate` is required and has no default. See below.
 */

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) return fallback;
  return process.argv[i + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

const NAME = arg('name');
const BRANCH = arg('branch');
const CODE = arg('code');
const ADDRESS = arg('address');
const PHONE = arg('phone') ?? null;
const CURRENCY = (arg('currency') ?? 'USD').toUpperCase();
const LOCALE = arg('locale') ?? 'en-US';
const TZ = arg('tz') ?? 'America/New_York';
const COUNTRY = (arg('country') ?? 'US').toUpperCase();
const POS = Number(arg('pos') ?? 1);
const LAT = arg('lat') ? Number(arg('lat')) : null;
const LNG = arg('lng') ? Number(arg('lng')) : null;

/**
 * ⚠️ Tax has no default, and that is the point.
 *
 * Ronny's seed sets `{ rate: 0, inclusive: true }`, which is correct for
 * Georgia and silently wrong for anyone in New York: the till would add no
 * sales tax and the owner would discover it from the state rather than from us.
 *
 * A default here would be a guess about somebody's tax liability. `0` is
 * accepted — plenty of places genuinely have no tax to add — but it has to be
 * typed, so that it is an answer rather than an omission.
 */
const TAX_RATE = arg('tax-rate');
const TAX_INCLUSIVE = flag('tax-inclusive');

/**
 * Delivery numbers default to zero meaning "not set up", and the script says so
 * at the end rather than leaving it to be discovered.
 *
 * Zero is a real and dangerous value here — a delivery fee of 0 gives every
 * customer free delivery — so it is reported loudly instead of assumed.
 */
const MIN_ORDER = Number(arg('min-order') ?? 0);
const DELIVERY_FEE = Number(arg('delivery-fee') ?? 0);
const FREE_DELIVERY = Number(arg('free-delivery') ?? 0);
const MAX_TOPPINGS = Number(arg('max-toppings') ?? 6);

if (!NAME) die('--name is required (the restaurant, e.g. "Hudson Fire & Grind")');
if (!BRANCH) die('--branch is required (the first location, e.g. "Monroe")');
if (!CODE) die('--code is required (branch code, e.g. MON-01 — it is globally unique)');
if (!ADDRESS) die('--address is required (it is printed on receipts)');
if (TAX_RATE === undefined) {
  die(`--tax-rate is required and has no default.

   It is the sales tax percentage this branch must add, e.g. 8.125 for
   Orange County NY. Pass --tax-rate 0 if there genuinely is none, and
   --tax-inclusive if the price on the menu already contains it.

   There is no default because a wrong one is invisible: the till simply
   charges the wrong amount, every day, and nobody notices until somebody
   official does.`);
}
if (!Number.isFinite(Number(TAX_RATE))) die(`--tax-rate must be a number, got "${TAX_RATE}"`);
if (!Number.isFinite(POS) || POS < 1) die('--pos must be at least 1');

/* ------------------------------------------------------------------ */

/** Every name column in this schema is Json `{ en, ka }`. */
const i18n = (en) => ({ en, ka: en });

/**
 * ⚠️ These four ids are load-bearing, not decorative.
 *
 * `lib/menu-db.ts` selects products by literal category id:
 *
 *   EXTRAS = products.filter(p => p.category.id === "cat-sides")
 *   SAUCES = products.filter(p => p.category.id === "cat-sauces")
 *   DRINKS = products.filter(p => p.category.id === "cat-drinks")
 *
 * A tenant whose categories were created through the admin UI would get cuid
 * ids, those filters would match nothing, and the owner would add products all
 * afternoon and see an empty menu with no error anywhere. So the four are
 * created here with the ids the code already expects.
 */
const CATEGORIES = [
  { id: 'cat-pizza', name: 'Pizza', sortOrder: 1 },
  { id: 'cat-sides', name: 'Sides', sortOrder: 2 },
  { id: 'cat-sauces', name: 'Sauces', sortOrder: 3 },
  { id: 'cat-drinks', name: 'Drinks', sortOrder: 4 },
];

async function main() {
  /**
   * ⚠️ Refuses rather than adding a second organization.
   *
   * The application reads the organization with `findFirst()` and no ordering.
   * With two rows, which one it picks is whatever the database feels like
   * returning — and it could differ between two queries in the same request.
   * One tenant, one organization.
   */
  const existing = await db.organization.findFirst();
  if (existing) {
    die(`this database already has an organization: "${JSON.stringify(existing.name)}" (${existing.id})

   The application finds it with findFirst() and no ordering, so a second one
   would make behaviour depend on row order. If this is a fresh tenant that
   somebody half-set-up, delete that row first and decide deliberately.`);
  }

  const org = await db.organization.create({
    data: { name: i18n(NAME), active: true },
  });

  const branch = await db.branch.create({
    data: {
      orgId: org.id,
      code: CODE,
      name: i18n(BRANCH),
      address: i18n(ADDRESS),
      phone: PHONE,
      lat: LAT,
      lng: LNG,
      active: true,
      sortOrder: 1,
      // openingFloat is deliberately left null. It is a suggestion for the
      // counting screen, and a number invented here would appear to the cashier
      // as though somebody had decided it.
    },
  });

  const terminals = [];
  for (let i = 1; i <= POS; i++) {
    terminals.push(
      await db.terminal.create({
        data: {
          branchId: branch.id,
          posId: `${CODE}-POS-${i}`,
          label: i18n(`Till ${i}`),
          active: true,
        },
      }),
    );
  }

  for (const c of CATEGORIES) {
    await db.category.upsert({
      where: { id: c.id },
      update: {},
      create: { id: c.id, name: i18n(c.name), sortOrder: c.sortOrder, active: true },
    });
  }

  /**
   * Settings.
   *
   * `org` may already exist — deploy/new-tenant.sh writes it from its
   * --currency/--locale/--tz/--country flags. Upsert rather than create, and
   * the values here are the same shape, so running both is safe either way.
   */
  const settings = [
    ['org', { locale: LOCALE, currency: CURRENCY, timeZone: TZ, country: COUNTRY }],
    [
      'order',
      {
        minOrder: MIN_ORDER,
        deliveryFee: DELIVERY_FEE,
        freeDeliveryThreshold: FREE_DELIVERY,
        maxToppings: MAX_TOPPINGS,
        currency: CURRENCY,
      },
    ],
    ['tax', { rate: Number(TAX_RATE), inclusive: TAX_INCLUSIVE }],
    // Off until somebody asks for them. Ronny's seed switches loyalty and a 30%
    // employee discount on by default, which is a decision about somebody
    // else's margin.
    ['loyalty', { enabled: false }],
    ['employeeDiscount', { enabled: false }],
  ];

  for (const [key, value] of settings) {
    await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }

  /* ---------------------------------------------------------------- */

  console.log(`
✓ ${NAME}

  organization   ${org.id}
  branch         ${branch.code}  ${BRANCH}
  address        ${ADDRESS}
  terminals      ${terminals.map((t) => t.posId).join(', ')}
  categories     ${CATEGORIES.map((c) => c.id).join(', ')}
  currency       ${CURRENCY}   locale ${LOCALE}   tz ${TZ}
  tax            ${Number(TAX_RATE)}%  ${TAX_INCLUSIVE ? '(already in the menu price)' : '(added at the till)'}
`);

  const notSetUp = [];
  if (!MIN_ORDER) notSetUp.push('minimum order');
  if (!DELIVERY_FEE) notSetUp.push('delivery fee');
  if (!FREE_DELIVERY) notSetUp.push('free-delivery threshold');

  if (notSetUp.length) {
    console.log(`  ⚠ left at zero, which means every delivery is free and has no minimum:
     ${notSetUp.join(', ')}
     Set them in the admin, or pass --min-order / --delivery-fee / --free-delivery.
`);
  }

  console.log(`  Next:
     node scripts/create-admin.mjs "Owner" owner@example.com "a long password"
     then sign in and add the menu. The storefront will say the menu is being
     set up until there are products — which is true, and better than showing
     somebody else's.
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
