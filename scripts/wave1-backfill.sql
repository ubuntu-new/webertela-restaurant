-- Wave 1 backfill — Ronny's data expressed both ways.
--
-- After this every product carries the capability flags that describe it *and*
-- the old `type` that used to. Nothing reads the new fields yet, so this cannot
-- change behaviour; it only turns the later read migration into a rename rather
-- than a rewrite.
--
-- Safe to run twice: every statement either has a WHERE that skips
-- already-migrated rows, or ON CONFLICT DO NOTHING.

BEGIN;

-- ── 1. capabilities from the old enum ────────────────────────────────────
-- Read this as a claim about the menu, not a translation table: a pizza has
-- sizes, takes toppings and can be split in half; sticks and plain items take
-- modifiers; a drink comes in sizes; merch has variants.

UPDATE "Product" SET "hasSizes" = true, "hasModifiers" = true, "splittable" = true
 WHERE "type" = 'pizza';

UPDATE "Product" SET "hasModifiers" = true
 WHERE "type" IN ('sticks', 'item');

UPDATE "Product" SET "hasSizes" = true
 WHERE "type" = 'drink';

UPDATE "Product" SET "hasVariants" = true
 WHERE "type" = 'merch';

-- ── 2. capabilities from the data itself ─────────────────────────────────
-- The enum is what someone typed; these are what is actually true. A product
-- with rows in ProductSize has sizes whatever its type claims.

UPDATE "Product" p SET "hasSizes" = true
 WHERE p."hasSizes" = false
   AND EXISTS (SELECT 1 FROM "ProductSize" s WHERE s."productId" = p."id");

UPDATE "Product" p SET "hasVariants" = true
 WHERE p."hasVariants" = false
   AND p."variants" IS NOT NULL
   AND jsonb_typeof(p."variants") = 'array'
   AND jsonb_array_length(p."variants") > 0;

UPDATE "Product" p SET "hasModifiers" = true
 WHERE p."hasModifiers" = false
   AND EXISTS (SELECT 1 FROM "ProductTopping" t WHERE t."productId" = p."id");

-- ── 3. ProductSize.cm → meta ─────────────────────────────────────────────
UPDATE "ProductSize"
   SET "meta" = jsonb_build_object('cm', "cm")
 WHERE "cm" IS NOT NULL AND "meta" IS NULL;

-- ── 4. Topping.dots → ui ─────────────────────────────────────────────────
UPDATE "Topping"
   SET "ui" = jsonb_build_object('dots', to_jsonb("dots"))
 WHERE "ui" IS NULL;

-- ── 5. DiscountType → DiscountKind rows ──────────────────────────────────
-- Seeded with the six existing values so Ronny's is unchanged. The point is
-- what comes next: an owner adds "first responder" as a row, not a release.

INSERT INTO "DiscountKind" ("id", "code", "label", "sortOrder")
VALUES
  (gen_random_uuid()::text, 'student',    '{"en":"Student","ka":"სტუდენტი"}',        10),
  (gen_random_uuid()::text, 'diplomatic', '{"en":"Diplomatic","ka":"დიპლომატიური"}', 20),
  (gen_random_uuid()::text, 'employee',   '{"en":"Employee","ka":"თანამშრომელი"}',   30),
  (gen_random_uuid()::text, 'loyalty',    '{"en":"Loyalty","ka":"ლოიალობა"}',        40),
  (gen_random_uuid()::text, 'promo',      '{"en":"Promo","ka":"აქცია"}',             50),
  (gen_random_uuid()::text, 'custom',     '{"en":"Custom","ka":"სხვა"}',             60)
ON CONFLICT ("code") DO NOTHING;

UPDATE "Discount" d
   SET "kindId" = k."id"
  FROM "DiscountKind" k
 WHERE k."code" = d."type"::text
   AND d."kindId" IS NULL;

-- ── 6. settings ──────────────────────────────────────────────────────────
-- `Topping` keeps its name in the database; only the word the customer reads
-- becomes configuration. That is the discipline line for the whole product:
-- change what is shown, not what the schema calls it.

INSERT INTO "Setting" ("key", "value", "updatedAt")
VALUES
  ('menu.modifierLabel', '{"en":"Toppings","ka":"დანამატები"}',             NOW()),
  ('units.system',       '"metric"',                                        NOW()),
  ('tax.rates',          '[]',                                              NOW()),
  ('tax.rules',          '{"dine_in":null,"pickup":null,"delivery":null}',  NOW()),
  ('tip.enabled',        'false',                                           NOW()),
  ('tip.presets',        '[15,18,20]',                                      NOW())
ON CONFLICT ("key") DO NOTHING;

COMMIT;
