-- Cash reconciliation: know what should be in the drawer.
--
-- Every statement here is additive — new nullable columns and one new table.
-- The running code ignores all of it, so the site keeps serving throughout and
-- this can be applied before the release that uses it.
--
-- The one idea worth carrying: a *counted* number and a *configured* number are
-- not the same thing, and only the counted one may enter the arithmetic. A
-- drawer set up as 200 that actually held 180 would otherwise report a 20
-- shortfall tonight and blame the wrong shift for yesterday's mistake.

-- What a branch usually starts a drawer with. A suggestion for the field, not
-- an input to any sum.
ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "openingFloat" DECIMAL(10,2);

-- What was actually counted, at each end of a shift. NULL means nobody counted,
-- which is a different fact from zero and must never be displayed as one.
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "openingCash" DECIMAL(10,2);
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "closingCash" DECIMAL(10,2);
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "cashNote"    TEXT;

-- The cash that crossed the counter.
--
-- `paidAmount` and `changeGiven` have existed since 20260808180109_init and
-- nothing has ever read or written either of them. Adding new columns beside
-- them was the first attempt and it was wrong twice over — Prisma rejects the
-- duplicate field outright, and a second column for the same fact is a second
-- answer waiting to disagree.
--
-- They only need to stop lying. `NOT NULL DEFAULT 0` cannot express "nobody
-- recorded this", and a drawer count told that a sale took zero cash reports a
-- shortfall that never happened.
ALTER TABLE "Order" ALTER COLUMN "paidAmount"  DROP NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "paidAmount"  DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "changeGiven" DROP NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "changeGiven" DROP DEFAULT;

-- Every row written before today has 0 in both, which now means "zero cash
-- taken" rather than "unknown". For a till sale that is false, so it is cleared
-- once — a bounded update over rows nobody has ever read.
UPDATE "Order" SET "paidAmount" = NULL  WHERE "paidAmount"  = 0;
UPDATE "Order" SET "changeGiven" = NULL WHERE "changeGiven" = 0;

-- Which shift rang it up. Without this a sale belongs to a day rather than to a
-- countable period, and a variance can never be narrowed to a person.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "shiftId" TEXT;
CREATE INDEX IF NOT EXISTS "Order_shiftId_idx" ON "Order"("shiftId");

DO $$ BEGIN
  ALTER TABLE "Order"
    ADD CONSTRAINT "Order_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Money into or out of the drawer that was not a sale.
--
-- Without it the arithmetic is wrong in the one direction that matters: a
-- manager pays a supplier forty in cash, and at midnight the drawer is forty
-- short with a cashier's name against it.
CREATE TABLE IF NOT EXISTS "CashMovement" (
  "id"         TEXT NOT NULL,
  "shiftId"    TEXT NOT NULL,
  "amount"     DECIMAL(10,2) NOT NULL,
  "reason"     TEXT NOT NULL,
  "employeeId" TEXT,
  "at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CashMovement_shiftId_idx" ON "CashMovement"("shiftId");

DO $$ BEGIN
  ALTER TABLE "CashMovement"
    ADD CONSTRAINT "CashMovement_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CashMovement"
    ADD CONSTRAINT "CashMovement_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
