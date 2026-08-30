#!/usr/bin/env node
/**
 * Fill `nameKey` on every named row, using the same function the application
 * uses. Two implementations of one rule drift, so there is only one — this
 * script imports it rather than reproducing it in SQL.
 *
 * Idempotent: re-running it recomputes every key and writes only the ones that
 * changed. Safe to run after a rename, after an import, or twice by accident.
 *
 * Usage:  node scripts/backfill-name-keys.mjs [--report]
 *         --report  also lists the duplicates it finds, and changes nothing else
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const REPORT = process.argv.includes("--report");

// ── the same normalisation as lib/name-key.ts ────────────────────────────────
// Kept in sync by test: scripts/check-name-key-parity.mjs
function nameKey(input) {
  return String(input ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function keyOf(name) {
  if (name && typeof name === "object" && !Array.isArray(name)) {
    return nameKey(String(name.en ?? "") || String(name.ka ?? ""));
  }
  return nameKey(name);
}

function display(name) {
  if (name && typeof name === "object" && !Array.isArray(name)) {
    return String(name.en ?? "") || String(name.ka ?? "");
  }
  return String(name ?? "");
}

const MODELS = [
  "branch",
  "category",
  "subcategory",
  "product",
  "topping",
  "combo",
  "discount",
  "employee",
  "stockItem",
  "recipe",
  "supplier",
];

let totalWritten = 0;
let totalDupes = 0;

for (const model of MODELS) {
  const rows = await db[model].findMany({ select: { id: true, name: true, nameKey: true } });

  let written = 0;
  const seen = new Map(); // key → first row that had it

  for (const r of rows) {
    // The app writes "" for a name with no letters in it (nameKey("") === "").
    // Writing null here instead would leave the column holding two different
    // spellings of "no key" — both falsy, both guarded for, and both a trap for
    // whoever next writes a query against it.
    const key = keyOf(r.name);

    if (key !== r.nameKey && !REPORT) {
      await db[model].update({ where: { id: r.id }, data: { nameKey: key } });
      written++;
    } else if (key !== r.nameKey) {
      written++;
    }

    if (key) {
      const first = seen.get(key);
      if (first) {
        totalDupes++;
        if (REPORT) {
          console.log(`  ⚠ ${model}: "${display(r.name)}" (${r.id}) duplicates "${display(first.name)}" (${first.id})`);
        }
      } else {
        seen.set(key, r);
      }
    }
  }

  totalWritten += written;
  console.log(`${REPORT ? "checked" : "updated"} ${model}: ${written}/${rows.length}`);
}

console.log(
  REPORT
    ? `\n${totalWritten} keys would change · ${totalDupes} existing duplicates found`
    : `\n${totalWritten} keys written · ${totalDupes} existing duplicates found`,
);

if (totalDupes > 0 && !REPORT) {
  console.log("Existing duplicates are left alone — merge them from /admin/stock/duplicates.");
}

await db.$disconnect();
