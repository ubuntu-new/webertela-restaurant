#!/usr/bin/env bash
# Wave 2 — duplicate protection and product identity. One command, start to
# finish, on any instance.
#
#   cd /srv/demo && git pull && bash scripts/wave2-dup-apply.sh /srv/demo
#
# Built on wave1-apply.sh, which is the version that actually ran on this
# server. Two things were learned there and are kept here:
#
#   1. **Postgres is reached as the postgres user, by database name.** The first
#      draft of this script passed Prisma's DATABASE_URL straight to pg_dump and
#      it stopped on "invalid URI query parameter: schema" — Prisma appends
#      ?schema=public, which libpq's own tools reject. And root is not a
#      postgres role on this box, so `createdb` as root would have failed next.
#      `sudo -u postgres` with a plain database name avoids both.
#
#   2. **Nothing restarts unless the build succeeded.** The demo went down once
#      because a deploy loop restarted the service whether or not `next build`
#      had passed.
#
# Everything it applies is additive — new nullable columns, new indexes, one new
# table. The running code ignores all of it, so the site keeps serving
# throughout and a failed build is an inconvenience rather than an outage.
#
# Safe to run twice: Prisma records migrations and skips them, and the backfill
# recomputes every key and writes only what changed.

set -euo pipefail

APP="${1:-$PWD}"
[ -d "$APP" ] || { echo "!! $APP does not exist"; exit 1; }
cd "$APP"

SERVICE="$(basename "$APP")"
BACKUP_DIR="/var/backups/pg"
STAMP=$(date +%F_%H%M%S)

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
warn() { printf '\033[33m   %s\033[0m\n' "$*"; }

fail() {
  printf '\n\033[31m!! %s\033[0m\n' "$*"
  if [ -n "${BACKUP:-}" ] && [ -f "${BACKUP:-}" ]; then
    printf '   restore with:\n'
    printf '     systemctl stop %s\n' "$SERVICE"
    printf '     sudo -u postgres dropdb %s\n' "$DB"
    printf '     sudo -u postgres createdb -O %s %s\n' "$DB_USER" "$DB"
    printf '     sudo -u postgres pg_restore -d %s --no-owner < %s\n' "$DB" "$BACKUP"
    printf '     systemctl start %s\n' "$SERVICE"
  fi
  exit 1
}

# ── 0. preconditions ─────────────────────────────────────────────────────────
say "checking the ground before touching anything"

[ -f prisma/schema.prisma ] || fail "not a Prisma project — wrong directory?"
[ -f .env ] || fail "no .env in $APP"

grep -q 'nameKey' prisma/schema.prisma \
  || fail "schema.prisma has no nameKey field — did 'git pull' run?"
grep -q 'model Supplier' prisma/schema.prisma \
  || fail "schema.prisma has no Supplier model — the pull is incomplete"
[ -f scripts/backfill-name-keys.mjs ] || fail "scripts/backfill-name-keys.mjs is missing"

# A dirty tree means someone edited the server directly. Migrating on top of
# uncommitted work is how changes get lost — geotaxi had three weeks of it.
if [ -n "$(git status --porcelain -- . ':!.npm' 2>/dev/null)" ]; then
  warn "uncommitted changes in the working tree:"
  git status --short -- . ':!.npm'
  printf '\n   Commit or stash them first — then run this again.\n'
  exit 1
fi

# The database name and owner come out of DATABASE_URL, but the URL itself is
# never handed to a postgres client: Prisma's ?schema=public is not a libpq URI
# parameter. Only Prisma gets the URL; psql gets the name.
set -a; . ./.env; set +a
: "${DATABASE_URL:?DATABASE_URL is not set in $APP/.env}"
DB="$(printf '%s' "$DATABASE_URL"      | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
DB_USER="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[^:]+://([^:@/]+).*#\1#')"
[ -n "$DB" ] || fail "could not read a database name out of DATABASE_URL"

BACKUP="$BACKUP_DIR/${DB}_pre-wave2_$STAMP.dump"

echo "   instance: $SERVICE"
echo "   git:      $(git rev-parse --short HEAD) $(git log -1 --format=%s | cut -c1-60)"
echo "   database: $DB (owner $DB_USER)"

# ── 1. backup, and prove it restores ─────────────────────────────────────────
say "backup"

mkdir -p "$BACKUP_DIR"
sudo -u postgres pg_dump -Fc "$DB" > "$BACKUP" || fail "pg_dump failed"
SIZE=$(stat -c %s "$BACKUP")
[ "$SIZE" -gt 5000 ] || fail "backup is only $SIZE bytes — that is not a real dump"
echo "   $BACKUP  ($(du -h "$BACKUP" | cut -f1))"

# A backup nobody has restored is a hope, not a backup, and the moment to find
# that out is now — not after the migration.
say "verifying the backup actually restores"
CHECK_DB="${DB}_restore_check"
sudo -u postgres dropdb --if-exists "$CHECK_DB"
sudo -u postgres createdb "$CHECK_DB"
if ! sudo -u postgres pg_restore -d "$CHECK_DB" --no-owner --no-privileges < "$BACKUP" 2>/dev/null; then
  echo "   (pg_restore reported ignorable errors — checking the data instead)"
fi
ROWS=$(sudo -u postgres psql -d "$CHECK_DB" -tAc \
  "SELECT COALESCE(SUM(n_live_tup), 0) FROM pg_stat_user_tables;")
sudo -u postgres dropdb "$CHECK_DB"
[ "${ROWS:-0}" -gt 0 ] || fail "the restored copy is empty — do not migrate on this backup"
echo "   restored $ROWS rows into a scratch database, then dropped it"

# ── 2. migrate ───────────────────────────────────────────────────────────────
say "applying migrations"

npx prisma migrate deploy \
  || fail "migrate deploy failed — the database is unchanged or partly changed"
npx prisma generate || fail "prisma generate failed"

say "checking for drift"
npx prisma migrate status || warn "migrate status reported something — read it above"

# ── 3. the two copies of the normalisation rule must agree ───────────────────
# lib/name-key.ts (TypeScript, used by the app) and backfill-name-keys.mjs
# (plain Node, used here) hold the same rule twice. If they drift, the backfill
# writes keys the app can never match and every existing row silently stops
# being detected — a failure that looks exactly like success.
say "name-key parity"
node scripts/check-name-key-parity.mjs || fail "the two copies of the rule have diverged"

# ── 4. backfill ──────────────────────────────────────────────────────────────
say "backfilling name keys"
node scripts/backfill-name-keys.mjs || fail "backfill failed"

say "every named row should now have a key"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 <<'SQL'
select 'StockItem'  as tbl, count(*) filter (where "nameKey" is null) as missing, count(*) as total from "StockItem"  where "deletedAt" is null
union all select 'Product',    count(*) filter (where "nameKey" is null), count(*) from "Product"     where "deletedAt" is null
union all select 'Category',   count(*) filter (where "nameKey" is null), count(*) from "Category"    where "deletedAt" is null
union all select 'Topping',    count(*) filter (where "nameKey" is null), count(*) from "Topping"     where "deletedAt" is null
union all select 'Recipe',     count(*) filter (where "nameKey" is null), count(*) from "Recipe"      where "deletedAt" is null
union all select 'Employee',   count(*) filter (where "nameKey" is null), count(*) from "Employee"
union all select 'Supplier',   count(*) filter (where "nameKey" is null), count(*) from "Supplier"    where "deletedAt" is null;
SQL

say "how much identity the stock actually carries"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 <<'SQL'
select
  count(*)                as items,
  count("barcode")        as with_barcode,
  count("packSize")       as with_pack_size,
  count("supplierCode")   as with_supplier_code
from "StockItem" where "deletedAt" is null;
SQL
echo "   (all zero is expected on the first run — these are what you fill in from now on)"

say "duplicates that already exist"
sudo -u postgres psql -d "$DB" -v ON_ERROR_STOP=1 <<'SQL'
select "nameKey", count(*) as copies
from "StockItem"
where "deletedAt" is null and "nameKey" is not null
group by "nameKey" having count(*) > 1
order by copies desc, "nameKey";
SQL
echo "   (left alone on purpose — merge them from /admin/stock/duplicates)"

# ── 5. build — and only then restart ─────────────────────────────────────────
say "building"
if ! npm run build; then
  printf '\n\033[31m!! BUILD FAILED\033[0m\n'
  echo "   Nothing was restarted; the site is still serving the old code."
  echo "   The migration HAS been applied, and it is additive — the running code"
  echo "   ignores the new columns, so the site is fine while this is fixed."
  exit 1
fi

say "restarting $SERVICE"
systemctl restart "$SERVICE"
sleep 3
systemctl --no-pager --lines=0 status "$SERVICE" || true

say "health check"
# 307 is the locale redirect, so redirects are followed rather than counted as
# a failure — an earlier version of this reported a healthy site as broken.
PORT="$(grep -oP '(?<=^PORT=)\d+' .env || echo 3000)"
curl -sS -L -o /dev/null -w '   HTTP %{http_code} after %{num_redirects} redirect(s)\n' \
  "http://127.0.0.1:${PORT}/admin" || warn "curl could not reach the site"

say "recent log"
journalctl -u "$SERVICE" -n 25 --no-pager

say "done"
echo "   Try it: open /admin/stock/items, add an item you already have, and watch"
echo "   the field warn you before you press Create."
