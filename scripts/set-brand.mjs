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

/**
 * Socials live under their own key, because the schema already said they do.
 *
 * Only http(s) is accepted — `lib/social.ts` drops anything else rather than
 * rendering it, and a settings row is exactly where a `javascript:` href would
 * sit waiting for a careless admin account.
 */
const SOCIALS = ['facebook', 'instagram', 'tiktok', 'twitter', 'youtube'];
const socialPatch = {};
for (const id of SOCIALS) {
  const v = arg(id);
  if (v === undefined) continue;
  if (v !== '' && !/^https?:\/\//i.test(v)) {
    console.error(`✗ --${id} must be an http(s) URL, got "${v}"`);
    process.exit(1);
  }
  socialPatch[id] = v;
}

if (!Object.keys(patch).length && !Object.keys(socialPatch).length) {
  console.error(`
Nothing to set.

  --tagline "Makes Life Better"
  --delivery "30–45 min"
  --rating 4.8
  --clear-rating      stop claiming a rating
  --clear-delivery    stop promising a delivery time

  --facebook  https://www.facebook.com/theirpage
  --instagram https://www.instagram.com/theirpage
  --tiktok    https://www.tiktok.com/@theirpage
  (pass "" to remove one)

⚠️ A rating belongs to customers, not to a settings file. Set one only if the
   restaurant genuinely has it and can point at where it came from.
`);
  process.exit(1);
}

if (Object.keys(socialPatch).length) {
  /**
   * ⚠️ Written as an ARRAY, because that is what the admin requires.
   *
   * `app/admin/settings/actions.ts:95` does:
   *
   *   const list = Array.isArray(current?.value) ? … : [];
   *   const next = list.map(...)
   *
   * An object-shaped row therefore makes the list empty, and the next time
   * anybody presses Save in the settings page every social link is deleted.
   * The first version of this script wrote an object and would have armed
   * exactly that.
   *
   * Entries are merged by id so an existing label or a disabled network is
   * preserved, and a href set to "" disables rather than removes — the address
   * is worth keeping when a restaurant just wants the button hidden.
   */
  const LABELS = {
    facebook: 'Facebook',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    twitter: 'X',
    youtube: 'YouTube',
  };

  const existing = await db.setting.findUnique({ where: { key: 'social' } });
  const list = Array.isArray(existing?.value) ? existing.value : [];
  const byId = new Map(list.map((x) => [String(x?.id ?? ''), x]));

  for (const [id, href] of Object.entries(socialPatch)) {
    const prev = byId.get(id) ?? {};
    byId.set(id, {
      id,
      label: String(prev.label ?? LABELS[id] ?? id),
      href,
      enabled: href !== '',
    });
  }

  const value = SOCIALS.filter((id) => byId.has(id)).map((id) => byId.get(id));

  await db.setting.upsert({
    where: { key: 'social' },
    update: { value },
    create: { key: 'social', value },
  });

  console.log('✓ social links updated');
  for (const [k, v] of Object.entries(socialPatch)) {
    console.log(`  ${k.padEnd(14)} ${v === '' ? '(hidden)' : v}`);
  }
  console.log();
}

// Only touched when there is something for it. Setting socials alone should not
// fail on a tenant whose `org` row does not exist yet.
if (Object.keys(patch).length) {
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
}

await db.$disconnect();
