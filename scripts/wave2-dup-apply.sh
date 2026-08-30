#!/usr/bin/env bash
#
# Wave 2 · duplicate protection — one command, on the server.
#
# Same shape as wave1-apply.sh, and the same rule that came out of the last
# deploy: **nothing restarts unless the build succeeded.** The 502 on the demo
# happened because a loop restarted the service whether or not `next build`
# had passed. The build is the only thing standing between a type error and a
# dead restaurant.
#
# Order matters here:
#   backup → prove the backup restores → migrate → check the two copies of the
#   normalisation agree → backfill → report → build → restart → read the log
#
# The parity check is before the backfill on purpose. If lib/name-key.ts and
# the .mjs have drifted, the backfill writes keys the app will never match, and
# every existing row silently stops being detected as a duplicate — a failure
# that looks exactly like success.
#
# Usage:  bash scripts/wave2-dup-apply.sh /srv/<instance>

set -euo pipefail

APP="${1:?usage: wave2-dup-apply.sh /srv/<instance>}"
cd "$APP"

UNIT="$(basename "$APP")"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/var/backups/pg"
mkdir -p "$BACKUP_DIR"

say() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

# ── 0. which database ────────────────────────────────────────────────────────
set -a; . ./.env; set +a
: "${DATABASE_URL:?DATABASE_URL is not set in $APP/.env}"
DB_NAME="$(printf '%s' "$DATABASE_URL" | sed -E 's#.*/([^/?]+).*#\1#')"
say "instance: $UNIT · database: $DB_NAME"

# ── 1. backup, and prove it restores ─────────────────────────────────────────
say "backing up"
DUMP="$BACKUP_DIR/${DB_NAME}-pre-wave2-${STAMP}.dump"
pg_dump --format=custom --file="$DUMP" "$DATABASE_URL"
ls -lh "$DUMP"

say "verifying the backup actually restores"
SCRATCH="verify_${DB_NAME}_${STAMP}"
createdb "$SCRATCH"
trap 'dropdb --if-exists "$SCRATCH" >/dev/null 2>&1 || true' EXIT
pg_restore --dbname="$SCRATCH" --no-owner --exit-on-error "$DUMP"
TABLES=$(psql -tAq -d "$SCRATCH" -c "select count(*) from information_schema.tables where table_schema='public'")
echo "restored $TABLES tables into $SCRATCH — backup is good"
dropdb "$SCRATCH"
trap - EXIT

# ── 2. migrate ───────────────────────────────────────────────────────────────
say "applying migrations"
npx prisma migrate deploy
npx prisma generate

say "checking for drift"
npx prisma migrate status

# ── 3. the two copies of the rule must agree ─────────────────────────────────
say "name-key parity"
node scripts/check-name-key-parity.mjs

# ── 4. backfill ──────────────────────────────────────────────────────────────
say "backfilling name keys"
node scripts/backfill-name-keys.mjs

say "verifying every named row has a key"
psql -d "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
select 'StockItem'  as tbl, count(*) filter (where "nameKey" is null) as missing, count(*) as total from "StockItem"  where "deletedAt" is null
union all select 'Product',    count(*) filter (where "nameKey" is null), count(*) from "Product"     where "deletedAt" is null
union all select 'Category',   count(*) filter (where "nameKey" is null), count(*) from "Category"    where "deletedAt" is null
union all select 'Topping',    count(*) filter (where "nameKey" is null), count(*) from "Topping"     where "deletedAt" is null
union all select 'Recipe',     count(*) filter (where "nameKey" is null), count(*) from "Recipe"      where "deletedAt" is null
union all select 'Employee',   count(*) filter (where "nameKey" is null), count(*) from "Employee"
union all select 'Supplier',   count(*) filter (where "nameKey" is null), count(*) from "Supplier"  where "deletedAt" is null;
SQL

say "barcode coverage"
psql -d "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
select
  count(*)                                    as items,
  count("barcode")                            as with_barcode,
  count("packSize")                           as with_pack_size,
  count("supplierCode")                       as with_supplier_code
from "StockItem" where "deletedAt" is null;
SQL
echo "(all zero is expected on the first run — these are the identifiers you fill in from now on)"

say "duplicates that already exist"
psql -d "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
select "nameKey", count(*) as copies
from "StockItem"
where "deletedAt" is null and "nameKey" is not null
group by "nameKey" having count(*) > 1
order by copies desc, "nameKey";
SQL
echo "(these are left alone — merge them from /admin/stock/duplicates)"

# ── 5. build — and only then restart ─────────────────────────────────────────
say "building"
if ! npm run build; then
  echo
  echo "BUILD FAILED. Nothing was restarted; the site is still serving the old code."
  echo "The database migration HAS been applied, and it is additive — the old code"
  echo "ignores the new columns, so the site is fine while you fix the build."
  exit 1
fi

say "restarting $UNIT"
systemctl restart "$UNIT"
sleep 3
systemctl --no-pager --lines=0 status "$UNIT" || true

say "health check"
PORT="$(grep -oP '(?<=^PORT=)\d+' .env || echo 3000)"
curl -sS -L -o /dev/null -w 'HTTP %{http_code} after %{num_redirects} redirect(s)\n' "http://127.0.0.1:${PORT}/admin" || true

say "recent log"
journalctl -u "$UNIT" -n 25 --no-pager

say "done"
echo "Try it: open the stock items page, add an item you already have, and watch"
echo "the field warn you before you press Create."
