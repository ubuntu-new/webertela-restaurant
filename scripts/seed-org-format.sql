-- The organisation's own money and date format.
--
-- `lib/format.ts` falls back to en-US / USD, because every customer from here
-- on is American. Ronny's is not: it prices in lari and reads dates the
-- Georgian way, and it has been doing so since before this setting existed.
--
-- So the existing install gets its current behaviour written down explicitly,
-- rather than inheriting a default that would silently redenominate a live
-- restaurant overnight. Rule for the whole project: a new default must never
-- reach an existing customer by accident.
--
-- A new US instance simply has no row here and takes the fallback.

INSERT INTO "Setting" ("key", "value", "updatedAt")
VALUES (
  'org',
  '{"locale":"ka-GE","currency":"GEL","timeZone":"Asia/Tbilisi","country":"GE"}',
  NOW()
)
ON CONFLICT ("key") DO NOTHING;

SELECT "key", "value" FROM "Setting" WHERE "key" = 'org';
