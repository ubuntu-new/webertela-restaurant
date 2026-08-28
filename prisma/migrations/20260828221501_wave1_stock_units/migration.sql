-- Wave 1, part two — imperial stock units.
--
-- Separate from the main migration on purpose. ALTER TYPE ... ADD VALUE has
-- historically been forbidden inside a transaction block, and Prisma wraps each
-- migration file in one. PostgreSQL 12+ permits it as long as the new value is
-- not *used* in the same transaction — which it is not here — but keeping it in
-- its own file means a failure here cannot roll back the columns and the table
-- that the previous migration created.
--
-- Purely additive: g, kg, ml, l and pcs are untouched, so nothing existing
-- changes meaning. `Setting: units.system` decides what the UI offers first.

ALTER TYPE "StockUnit" ADD VALUE IF NOT EXISTS 'oz';
ALTER TYPE "StockUnit" ADD VALUE IF NOT EXISTS 'lb';
ALTER TYPE "StockUnit" ADD VALUE IF NOT EXISTS 'floz';
ALTER TYPE "StockUnit" ADD VALUE IF NOT EXISTS 'gal';
ALTER TYPE "StockUnit" ADD VALUE IF NOT EXISTS 'each';
