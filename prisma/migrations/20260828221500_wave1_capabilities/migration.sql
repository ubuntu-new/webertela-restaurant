-- Wave 1 — additive schema change.
--
-- Every statement here adds. Nothing is dropped, nothing is renamed, no column
-- changes type. Ronny's keeps running on the old fields the entire time; the
-- new ones sit beside them until the reads have moved over, which is a later
-- wave. That is what makes this safe to run against a live restaurant.
--
-- The enum extension lives in its own migration, because ALTER TYPE ... ADD
-- VALUE has rules about transactions that the rest of this does not.

-- ── Product: capabilities instead of a vertical-specific type ────────────
ALTER TABLE "Product" ADD COLUMN "hasSizes"     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "hasModifiers" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "splittable"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "hasVariants"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "sizeMeta"     JSONB;
ALTER TABLE "Product" ADD COLUMN "taxable"      BOOLEAN NOT NULL DEFAULT true;

-- ── ProductSize: per-size metadata replaces the pizza diameter ───────────
ALTER TABLE "ProductSize" ADD COLUMN "meta" JSONB;

-- ── Topping: constructor UI state stops being a domain field ─────────────
ALTER TABLE "Topping" ADD COLUMN "ui" JSONB;

-- ── Order: tip ───────────────────────────────────────────────────────────
ALTER TABLE "Order" ADD COLUMN "tip" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- ── DiscountKind: the table the enum becomes ─────────────────────────────
CREATE TABLE "DiscountKind" (
    "id"        TEXT         NOT NULL,
    "code"      TEXT         NOT NULL,
    "label"     JSONB        NOT NULL,
    "active"    BOOLEAN      NOT NULL DEFAULT true,
    "sortOrder" INTEGER      NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountKind_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiscountKind_code_key" ON "DiscountKind"("code");
CREATE INDEX "DiscountKind_active_sortOrder_idx" ON "DiscountKind"("active", "sortOrder");

-- Nullable on purpose: `Discount.type` is still the field the code reads, so
-- a row with no kind yet is a valid row, not a broken one.
ALTER TABLE "Discount" ADD COLUMN "kindId" TEXT;
CREATE INDEX "Discount_kindId_idx" ON "Discount"("kindId");

ALTER TABLE "Discount"
    ADD CONSTRAINT "Discount_kindId_fkey"
    FOREIGN KEY ("kindId") REFERENCES "DiscountKind"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
