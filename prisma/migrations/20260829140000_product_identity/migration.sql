-- Wave 2b · real product identity
--
-- A name is the weakest thing you can identify a product by, because it is the
-- one part a human types. This adds the identifiers that are not typed:
--
--   barcode       the GTIN printed by the manufacturer, stored zero-padded to 14
--                 so a UPC-A and the EAN-13 of the same can are one value
--   packSize/Unit what one purchased pack holds — the field that stops
--                 "Coca-Cola 330 ml" and "Coca-Cola 1.5 L" being reported as a
--                 duplicate of each other
--   supplier +    for everything with no barcode, which in a kitchen is most of
--   supplierCode  it: the same mill, the same order code, the same flour
--
-- Additive. Nullable columns, a new table nothing yet references, and unique
-- indexes that cannot fire on existing data because every existing row is NULL
-- in the new columns (Postgres treats NULLs as distinct in a unique index).

-- ── suppliers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Supplier" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "nameKey"   TEXT,
  "code"      TEXT,
  "phone"     TEXT,
  "email"     TEXT,
  "contact"   TEXT,
  "note"      TEXT,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_code_key"     ON "Supplier"("code");
CREATE INDEX        IF NOT EXISTS "Supplier_active_idx"   ON "Supplier"("active");
CREATE INDEX        IF NOT EXISTS "Supplier_deletedAt_idx" ON "Supplier"("deletedAt");
CREATE INDEX        IF NOT EXISTS "Supplier_nameKey_idx"  ON "Supplier"("nameKey");

-- ── stock items ──────────────────────────────────────────────────────────────
ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "barcode"      TEXT;
ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "packSize"     DECIMAL(14,3);
ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "packUnit"     "StockUnit";
ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "supplierId"   TEXT;
ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "supplierCode" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "StockItem_barcode_key" ON "StockItem"("barcode");
CREATE INDEX        IF NOT EXISTS "StockItem_supplierId_idx" ON "StockItem"("supplierId");

-- Two rows may share a supplier with no code, and two rows may share a code
-- across different suppliers. Only the pair is unique — and because NULLs never
-- collide in Postgres, every row that exists today is unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "StockItem_supplierId_supplierCode_key"
  ON "StockItem"("supplierId", "supplierCode");

DO $$
BEGIN
  ALTER TABLE "StockItem"
    ADD CONSTRAINT "StockItem_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── products ─────────────────────────────────────────────────────────────────
-- Only for things sold in the packaging they arrived in. Prepared food has no
-- barcode and never will.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "barcode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Product_barcode_key" ON "Product"("barcode");
