#!/usr/bin/env bash
# Wave 1 — one command, start to finish.
#
#   cd /srv/ronnys-next && git pull && bash scripts/wave1-apply.sh
#
# Backs up, migrates, backfills, verifies, rebuilds, restarts, and checks the
# site is still serving. Stops at the first failure with the restore command
# printed, rather than continuing into a half-applied state.
#
# Everything it applies is additive: `type`, `cm`, `dots` and `DiscountType`
# are untouched, so the running code keeps working throughout. Nothing here
# needs the site to go down.
#
# Safe to run twice. The migrations are recorded by Prisma and skipped the
# second time; the backfill skips rows it has already touched.

set -euo pipefail

APP_DIR="/srv/ronnys-next"
APP_USER="ronnys"
SERVICE="ronnys"
DB="ronnys"
BACKUP_DIR="/var/backups/pg"
PORT="${RONNYS_PORT:-3001}"

STAMP=$(date +%F_%H%M%S)
BACKUP="$BACKUP_DIR/${DB}_pre-wave1_$STAMP.dump"

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() {
  printf '\n\033[31m!! %s\033[0m\n' "$*"
  printf '   restore with:\n'
  printf '     systemctl stop %s\n' "$SERVICE"
  printf '     sudo -u postgres dropdb %s && sudo -u postgres createdb -O %s %s\n' "$DB" "$APP_USER" "$DB"
  printf '     sudo -u postgres pg_restore -d %s --no-owner < %s\n' "$DB" "$BACKUP"
  printf '     systemctl start %s\n' "$SERVICE"
  exit 1
}

[ -d "$APP_DIR" ] || fail "$APP_DIR does not exist"
cd "$APP_DIR"

# ── 0. preconditions ─────────────────────────────────────────────────────
say "checking the ground before touching anything"

[ -f prisma/schema.prisma ] || fail "not a Prisma project — wrong directory?"
grep -q 'hasModifiers' prisma/schema.prisma \
  || fail "schema.prisma has no Wave 1 fields — did 'git pull' run?"
[ -f scripts/wave1-backfill.sql ] || fail "scripts/wave1-backfill.sql is missing"

# A dirty tree here means someone edited the server directly. Migrating on top
# of uncommitted work is how changes get lost — geotaxi had three weeks of it.
if [ -n "$(git status --porcelain -- . ':!.npm' 2>/dev/null)" ]; then
  printf '\n\033[33m   uncommitted changes in the working tree:\033[0m\n'
  git status --short -- . ':!.npm'
  printf '\n   Commit or stash them first — then run this again.\n'
  exit 1
fi

echo "   git:      $(git rev-parse --short HEAD) $(git log -1 --format=%s | cut -c1-60)"
echo "   database: $DB"

# ── 1. backup ────────────────────────────────────────────────────────────
say "backup"

mkdir -p "$BACKUP_DIR"
sudo -u postgres pg_dump -Fc "$DB" > "$BACKUP" || fail "pg_dump failed"
SIZE=$(stat -c %s "$BACKUP")
[ "$SIZE" -gt 5000 ] || fail "backup is only $SIZE bytes — that is not a real dump"
echo "   $BACKUP  ($(du -h "$BACKUP" | cut -f1))"

# Prove it restores. A backup nobody has restored is a hope, not a backup, and
# the moment to find that out is now — not after the migration.
say "verifying the backup actually restores"
sudo -u postgres dropdb --if-exists ronnys_restore_check
sudo -u postgres createdb ronnys_restore_check
if ! sudo -u postgres pg_restore -d ronnys_restore_check --no-owner --no-privileges < "$BACKUP" 2>/dev/null; then
  echo "   (pg_restore reported ignorable errors — checking the data instead)"
fi
ROWS=$(sudo -u postgres psql -d ronnys_restore_check -tAc \
  "SELECT COALESCE(SUM(n_live_tup), 0) FROM pg_stat_user_tables;")
sudo -u postgres dropdb ronnys_restore_check
[ "${ROWS:-0}" -gt 0 ] || fail "the restored copy is empty — do not migrate on this backup"
echo "   restored $ROWS rows into a scratch database, then dropped it"

# ── 2. migrate ───────────────────────────────────────────────────────────
say "applying migrations"

runuser -u "$APP_USER" -- env -u NODE_ENV npx prisma migrate deploy \
  || fail "migrate deploy failed — the database is unchanged or partly changed; restore"

runuser -u "$APP_USER" -- env -u NODE_ENV npx prisma migrate status | tail -3

# The migration SQL and schema.prisma are written by hand here, so they can
# disagree. Prisma will tell us now rather than on someone's next migrate dev.
say "checking schema.prisma and the database agree"
DRIFT=$(runuser -u "$APP_USER" -- env -u NODE_ENV npx prisma migrate diff \
          --from-schema-datasource prisma/schema.prisma \
          --to-schema-datamodel   prisma/schema.prisma \
          --script 2>/dev/null | grep -vcE '^\s*(--|$)' || true)
if [ "${DRIFT:-0}" -gt 0 ]; then
  printf '\033[33m   drift detected — the database does not match schema.prisma:\033[0m\n'
  runuser -u "$APP_USER" -- env -u NODE_ENV npx prisma migrate diff \
    --from-schema-datasource prisma/schema.prisma \
    --to-schema-datamodel   prisma/schema.prisma --script 2>/dev/null | head -20
  fail "fix the drift before backfilling"
fi
echo "   no drift"

# ── 3. backfill ──────────────────────────────────────────────────────────
say "backfill"

sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 -q -f scripts/wave1-backfill.sql \
  || fail "backfill failed — it runs in one transaction, so nothing was written"
echo "   done"

# ── 4. verify the data ───────────────────────────────────────────────────
say "what the data looks like now"

sudo -u postgres psql -d "$DB" -c '
SELECT "type",
       COUNT(*)                               AS products,
       COUNT(*) FILTER (WHERE "hasSizes")     AS sizes,
       COUNT(*) FILTER (WHERE "hasModifiers") AS modifiers,
       COUNT(*) FILTER (WHERE "splittable")   AS splittable,
       COUNT(*) FILTER (WHERE "hasVariants")  AS variants
  FROM "Product" GROUP BY "type" ORDER BY "type";'

sudo -u postgres psql -d "$DB" -c '
SELECT (SELECT COUNT(*) FROM "ProductSize" WHERE "cm" IS NOT NULL AND "meta" IS NULL)   AS sizes_missing_meta,
       (SELECT COUNT(*) FROM "Topping"     WHERE "ui" IS NULL)                          AS toppings_missing_ui,
       (SELECT COUNT(*) FROM "Discount"    WHERE "kindId" IS NULL AND "deletedAt" IS NULL) AS discounts_missing_kind,
       (SELECT COUNT(*) FROM "DiscountKind")                                            AS discount_kinds,
       (SELECT COUNT(*) FROM "Setting" WHERE "key" LIKE ANY (ARRAY['"'"'tax.%'"'"','"'"'tip.%'"'"','"'"'units.%'"'"','"'"'menu.%'"'"'])) AS settings_seeded;'

LEFTOVER=$(sudo -u postgres psql -d "$DB" -tAc '
SELECT (SELECT COUNT(*) FROM "ProductSize" WHERE "cm" IS NOT NULL AND "meta" IS NULL)
     + (SELECT COUNT(*) FROM "Topping"     WHERE "ui" IS NULL)
     + (SELECT COUNT(*) FROM "Discount"    WHERE "kindId" IS NULL AND "deletedAt" IS NULL);')
[ "${LEFTOVER:-1}" -eq 0 ] || fail "backfill left $LEFTOVER rows behind"
echo "   nothing left behind"

# ── 5. rebuild and restart ───────────────────────────────────────────────
say "regenerating the client and rebuilding"

# NODE_ENV=production in the shell makes npm skip devDependencies and the build
# then fails on a missing toolchain. Unset it for the build only.
runuser -u "$APP_USER" -- env -u NODE_ENV npx prisma generate >/dev/null \
  || fail "prisma generate failed"
runuser -u "$APP_USER" -- env -u NODE_ENV npm run build 2>&1 | tail -6 \
  || fail "build failed — the database is migrated but the app is not rebuilt"

systemctl restart "$SERVICE"
sleep 5

# ── 6. verify the app ────────────────────────────────────────────────────
say "is it actually working"

ACTIVE=$(systemctl is-active "$SERVICE" || true)
echo "   service:   $ACTIVE"
[ "$ACTIVE" = "active" ] || fail "$SERVICE did not come back up"

# Follow the redirect. `/` answers 307 and sends the browser on to /ka or /en —
# that is the locale middleware doing its job, not a failure. Checking for a
# bare 200 on `/` once reported a perfectly good migration as a broken one and
# printed the restore command under it, which is the worst possible false alarm.
CODE=$(curl -sL -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT" || echo 000)
echo "   http:      $CODE (after redirects)"

# A 200 is the weakest evidence there is — friendlymandriving served 200 all
# through a broken database password. Read the log too.
ERRS=$(journalctl -u "$SERVICE" --since "60 seconds ago" --no-pager 2>/dev/null \
       | grep -ciE 'prisma:error|PrismaClient|Unknown argument|does not exist' || true)
echo "   db errors: $ERRS"

if [ "$CODE" != "200" ] || [ "${ERRS:-0}" -gt 0 ]; then
  journalctl -u "$SERVICE" --since "60 seconds ago" --no-pager | tail -20
  fail "the app is not healthy after the migration"
fi

say "Wave 1 applied"
cat <<EOF

  Added, nothing removed:
    Product      hasSizes · hasModifiers · splittable · hasVariants · sizeMeta · taxable
    ProductSize  meta            (cm still there)
    Topping      ui              (dots still there)
    Order        tip
    DiscountKind + Discount.kindId  (DiscountType still there)
    StockUnit    oz lb floz gal each
    Setting      menu.modifierLabel · units.system · tax.rates · tax.rules · tip.*

  Backup: $BACKUP

  Next wave, not this one: move the reads off \`type\` (33 sites), off \`cm\`
  and off \`dots\` (38 sites), then drop the old columns. Search for the enum,
  not for the word "pizza" — some checks mean splittable, others mean hasSizes,
  and they are not the same test.

EOF
