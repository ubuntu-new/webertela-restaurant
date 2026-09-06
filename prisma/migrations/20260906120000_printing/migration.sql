-- ბეჭდვა: ორი პრინტერი ფილიალში, და რიგი მათ შორის.
--
-- სრულად დანამატია. არსებულ არცერთ სვეტს არ ეხება, არაფერს შლის, და ცარიელ
-- ბაზაზეც და სავსეზეც ერთნაირად ჯდება. ორჯერ გაშვება უვნებელია — ყველგან
-- IF NOT EXISTS.

-- ── ტიპები ──────────────────────────────────────────────────────────────────
-- Postgres-ს `CREATE TYPE IF NOT EXISTS` არ აქვს, ამიტომ DO-ბლოკი. ეს არის
-- განსხვავება „უკვე არსებობს, კარგია" და „მიგრაცია ჩავარდა" შორის.
DO $$ BEGIN
  CREATE TYPE "PrinterRole" AS ENUM ('till', 'kitchen');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PrintJobKind" AS ENUM ('receipt', 'kitchen', 'drawer', 'test');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PrintJobStatus" AS ENUM ('pending', 'claimed', 'done', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── პრინტერი ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Printer" (
  "id"        TEXT NOT NULL,
  "orgId"     TEXT NOT NULL,
  "branchId"  TEXT NOT NULL,
  "role"      "PrinterRole" NOT NULL,
  "name"      TEXT NOT NULL,

  -- null სანამ რკინა არ დამონტაჟდება. რიგი და გადახედვა მანამდეც მუშაობს.
  "host"      TEXT,
  "port"      INTEGER NOT NULL DEFAULT 9100,
  "columns"   INTEGER NOT NULL DEFAULT 48,
  "hasDrawer" BOOLEAN NOT NULL DEFAULT false,

  "active"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Printer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Printer_branchId_role_active_idx"
  ON "Printer" ("branchId", "role", "active");

-- ── ბეჭდვის დავალება ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PrintJob" (
  "id"        TEXT NOT NULL,
  "orgId"     TEXT NOT NULL,
  "branchId"  TEXT NOT NULL,
  "printerId" TEXT,
  "orderId"   TEXT,

  "kind"   "PrintJobKind" NOT NULL,
  "status" "PrintJobStatus" NOT NULL DEFAULT 'pending',

  -- სნეპშოტი და არა მითითება: ჩეკი იმის ჩანაწერია, რაც მოხდა. იხ. schema.prisma.
  "doc" JSONB NOT NULL,

  "copies"   INTEGER NOT NULL DEFAULT 1,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error"    TEXT,

  "requestedBy" TEXT,
  "reprintOf"   TEXT,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "doneAt"    TIMESTAMP(3),

  CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- აგენტი ამ ინდექსით იღებს რიგს — ფილიალი, სტატუსი, თარიღი.
CREATE INDEX IF NOT EXISTS "PrintJob_branchId_status_createdAt_idx"
  ON "PrintJob" ("branchId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "PrintJob_orderId_idx" ON "PrintJob" ("orderId");
CREATE INDEX IF NOT EXISTS "PrintJob_printerId_status_idx"
  ON "PrintJob" ("printerId", "status");

-- ── კავშირები ───────────────────────────────────────────────────────────────
-- ფილიალის წაშლა პრინტერსაც შლის: პრინტერი მის გარეშე არ არსებობს.
DO $$ BEGIN
  ALTER TABLE "Printer"
    ADD CONSTRAINT "Printer_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- პრინტერის ან შეკვეთის წაშლა დავალებას **არ** შლის, მხოლოდ კავშირს წყვეტს.
-- დაბეჭდილი ჩეკის ჩანაწერი იმიტომ არ ქრება, რომ პრინტერი შეიცვალა.
DO $$ BEGIN
  ALTER TABLE "PrintJob"
    ADD CONSTRAINT "PrintJob_printerId_fkey"
    FOREIGN KEY ("printerId") REFERENCES "Printer" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PrintJob"
    ADD CONSTRAINT "PrintJob_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
