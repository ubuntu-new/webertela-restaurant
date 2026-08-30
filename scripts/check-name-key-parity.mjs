#!/usr/bin/env node
/**
 * The normalisation rule exists twice: once in lib/name-key.ts (TypeScript, used
 * by the app) and once in scripts/backfill-name-keys.mjs (plain Node, used by
 * the migration, which cannot import TypeScript).
 *
 * Two copies of one rule drift, and when this particular rule drifts the
 * backfill writes keys the application will never match — every existing row
 * silently stops being found as a duplicate. So the copies are compared here,
 * and the deploy script runs this before the backfill.
 *
 * Exit 0 = identical. Exit 1 = they have diverged; fix before deploying.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Pull the transformation steps out of a `nameKey` function body, whatever
 *  the surrounding syntax looks like. */
function steps(src, file) {
  const start = src.indexOf("function nameKey(");
  if (start < 0) throw new Error(`no nameKey() in ${file}`);
  const body = src.slice(start, src.indexOf("\n}", start));

  const found = body.match(/\.(normalize|replace|toLowerCase|trim)\([^\n]*/g);
  if (!found) throw new Error(`no transformation steps in ${file}`);

  // Ignore the argument plumbing that differs on purpose: the .mjs coerces with
  // String(input ?? "") because it reads untyped Json straight out of Postgres.
  return found.map((s) => s.trim());
}

const ts = steps(readFileSync(join(root, "lib/name-key.ts"), "utf8"), "lib/name-key.ts");
const mjs = steps(readFileSync(join(root, "scripts/backfill-name-keys.mjs"), "utf8"), "backfill-name-keys.mjs");

const same = ts.length === mjs.length && ts.every((s, i) => s === mjs[i]);

if (same) {
  console.log(`name-key parity OK — ${ts.length} identical steps`);
  process.exit(0);
}

console.error("name-key normalisation has DIVERGED:\n");
console.error("  lib/name-key.ts:");
ts.forEach((s) => console.error("    " + s));
console.error("\n  scripts/backfill-name-keys.mjs:");
mjs.forEach((s) => console.error("    " + s));
console.error("\nMake them identical before deploying, or the backfill writes keys the app cannot match.");
process.exit(1);
