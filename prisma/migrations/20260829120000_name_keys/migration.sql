-- Wave 2 · duplicate protection
--
-- Adds a normalised comparison key beside every name a human types, so the
-- software can find "mozzarella " before it becomes a second mozzarella.
--
-- Purely additive: nullable columns and plain indexes. Nothing is dropped, no
-- table is rewritten, no unique constraint is imposed — a deliberate duplicate
-- ("Egg" the ingredient and "Eggs" the tray) must still be possible, and the
-- decision belongs to the person, not the schema. The database makes the
-- question cheap to ask; lib/dup.ts asks it.
--
-- The column is left NULL here. Backfilling it in SQL would need Postgres to
-- reproduce the exact Unicode normalisation in lib/name-key.ts, and two
-- implementations of the same rule drift. scripts/backfill-name-keys.mjs runs
-- straight after this and fills them with the real function.

ALTER TABLE "Branch"      ADD COLUMN IF NOT EXISTS "nameKey" TEXT;
ALTER TABLE "Category"    ADD COLUMN IF NOT EXISTS "nameKey" TEXT;
ALTER TABLE "Subcategory" ADD COLUMN IF NOT EXISTS "nameKey" TEXT;
ALTER TABLE "Product"     ADD COLUMN IF NOT EXISTS "nameKey" TEXT;
ALTER TABLE "Topping"     ADD COLUMN IF NOT EXISTS "nameKey" TEXT;
ALTER TABLE "Combo"       ADD COLUMN IF NOT EXISTS "nameKey" TEXT;
ALTER TABLE "Discount"    ADD COLUMN IF NOT EXISTS "nameKey" TEXT;
ALTER TABLE "Employee"    ADD COLUMN IF NOT EXISTS "nameKey" TEXT;
ALTER TABLE "StockItem"   ADD COLUMN IF NOT EXISTS "nameKey" TEXT;
ALTER TABLE "Recipe"      ADD COLUMN IF NOT EXISTS "nameKey" TEXT;

CREATE INDEX IF NOT EXISTS "Branch_nameKey_idx"      ON "Branch"("nameKey");
CREATE INDEX IF NOT EXISTS "Category_nameKey_idx"    ON "Category"("nameKey");
CREATE INDEX IF NOT EXISTS "Subcategory_nameKey_idx" ON "Subcategory"("nameKey");
CREATE INDEX IF NOT EXISTS "Product_nameKey_idx"     ON "Product"("nameKey");
CREATE INDEX IF NOT EXISTS "Topping_nameKey_idx"     ON "Topping"("nameKey");
CREATE INDEX IF NOT EXISTS "Combo_nameKey_idx"       ON "Combo"("nameKey");
CREATE INDEX IF NOT EXISTS "Discount_nameKey_idx"    ON "Discount"("nameKey");
CREATE INDEX IF NOT EXISTS "Employee_nameKey_idx"    ON "Employee"("nameKey");
CREATE INDEX IF NOT EXISTS "StockItem_nameKey_idx"   ON "StockItem"("nameKey");
CREATE INDEX IF NOT EXISTS "Recipe_nameKey_idx"      ON "Recipe"("nameKey");
