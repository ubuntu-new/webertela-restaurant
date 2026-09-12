#!/usr/bin/env node
/**
 * What a restaurant says about itself, moved out of the code and into its row.
 *
 * ── Why this script exists ──
 *
 * The tagline, the delivery time and the rating used to be literals in the
 * components, so every tenant displayed Ronny's. Removing them was correct and
 * it takes them away from Ronny's too — their header loses "Makes Life Better",
 * their trust bar loses "30–45 min" and "4.8".
 *
 * That is a real regression for a live restaurant, and it is fixed by putting
 * their own values where they belong rather than by leaving them compiled into
 * software sold to other people.
 *
 *   node scripts/set-brand.mjs --tagline "Makes Life Better" \
 *                              --delivery "30–45 min" --rating 4.8
 *
 * Any flag left out is left alone. `--clear-rating` removes one, for a
 * restaurant that would rather not claim a number it cannot evidence.
 */

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || i === process.argv.length - 1 ? undefined : process.argv[i + 1];
}

const patch = {};
if (arg('tagline') !== undefined) patch.tagline = arg('tagline');
if (arg('delivery') !== undefined) patch.deliveryTime = arg('delivery');
if (arg('rating') !== undefined) patch.rating = arg('rating');
if (process.argv.includes('--clear-rating')) patch.rating = '';
if (process.argv.includes('--clear-delivery')) patch.deliveryTime = '';

if (!Object.keys(patch).length) {
  console.error(`
Nothing to set.

  --tagline "Makes Life Better"
  --delivery "30–45 min"
  --rating 4.8
  --clear-rating      stop claiming a rating
  --clear-delivery    stop promising a delivery time

⚠️ A rating belongs to customers, not to a settings file. Set one only if the
   restaurant genuinely has it and can point at where it came from.
`);
  process.exit(1);
}

const row = await db.setting.findUnique({ where: { key: 'org' } });
if (!row) {
  console.error(
    '✗ there is no `org` setting yet — run scripts/create-org.mjs first, it creates one',
  );
  process.exit(1);
}

// Merged, not replaced: this row also holds locale, currency, timeZone and
// country, and overwriting it would set the restaurant back to dollars.
const value = { ...(row.value ?? {}), ...patch };

await db.setting.update({ where: { key: 'org' }, data: { value } });

console.log('✓ brand updated\n');
for (const [k, v] of Object.entries(patch)) {
  console.log(`  ${k.padEnd(14)} ${v === '' ? '(hidden)' : v}`);
}
console.log();

await db.$disconnect();
