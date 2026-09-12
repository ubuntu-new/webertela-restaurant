#!/usr/bin/env node
/**
 * The About page, in the restaurant's own words.
 *
 * ── Why it is a file and not a flag ──
 *
 * An About page is paragraphs. A command line is a single line, and every
 * separator that could join paragraphs — a comma, a pipe, a backslash-n — will
 * one day appear inside the prose and split it in the wrong place. That already
 * happened once today with a meta description, which arrived in the database
 * shattered into fragments used as language keys.
 *
 * So the text comes from a file, where paragraphs are blank lines and nothing
 * needs escaping.
 *
 *   node scripts/set-about.mjs --lang en \
 *     --heading "Life tastes better here." --file about-en.txt
 *
 *   node scripts/set-about.mjs --lang ka \
 *     --heading "ცხოვრება აქ უკეთეს გემოს იძენს." --file about-ka.txt
 *
 * `--clear --lang en` removes it. A restaurant with no About page shows no
 * About section and no tab pointing at one, which is the correct thing to show
 * for a business that has not written about itself yet.
 */

import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 || i === process.argv.length - 1 ? undefined : process.argv[i + 1];
}

const lang = arg('lang') ?? 'en';
const clear = process.argv.includes('--clear');
const heading = arg('heading');
const file = arg('file');

if (!/^[a-z]{2}$/.test(lang)) {
  console.error(`✗ --lang must be a two-letter code, got "${lang}"`);
  process.exit(1);
}

if (!clear && !file) {
  console.error(`
  node scripts/set-about.mjs --lang en --heading "..." --file about-en.txt
  node scripts/set-about.mjs --lang en --clear

⚠️ The body comes from a file. Paragraphs are blank lines; nothing is escaped.
`);
  process.exit(1);
}

let body = '';
if (!clear) {
  try {
    body = readFileSync(file, 'utf8').trim();
  } catch (e) {
    console.error(`✗ could not read ${file}: ${e.message}`);
    process.exit(1);
  }
  if (!body) {
    console.error(`✗ ${file} is empty. Use --clear if you meant to remove the About page.`);
    process.exit(1);
  }
}

const row = await db.setting.findUnique({ where: { key: 'org' } });
if (!row) {
  console.error('✗ there is no `org` setting yet — run scripts/create-org.mjs first');
  process.exit(1);
}

const current = row.value ?? {};

// Read whatever is stored, so setting one language never erases the other. A
// plain string from an older shape is treated as the English one.
const asMap = (v) =>
  typeof v === 'string' ? { en: v } : v && typeof v === 'object' ? { ...v } : {};

const headings = asMap(current.aboutHeading);
const bodies = asMap(current.aboutBody);

if (clear) {
  delete headings[lang];
  delete bodies[lang];
} else {
  if (heading !== undefined) headings[lang] = heading;
  bodies[lang] = body;
}

const value = { ...current, aboutHeading: headings, aboutBody: bodies };
await db.setting.update({ where: { key: 'org' }, data: { value } });

if (clear) {
  console.log(`✓ About page removed for "${lang}"\n`);
} else {
  const paras = body.split(/\n\s*\n/).filter((p) => p.trim()).length;
  console.log(`
✓ About page saved for "${lang}"

  heading    ${headings[lang] ?? '(none)'}
  paragraphs ${paras}
  first line ${body.split('\n')[0].slice(0, 70)}…
`);
}

await db.$disconnect();
