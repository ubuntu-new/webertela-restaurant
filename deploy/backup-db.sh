#!/usr/bin/env bash
# Nightly database backup — PostgreSQL and SQLite.
#
# Hetzner snapshots protect against the server dying. They do not protect
# against a bad migration dropping a table, or someone deleting the wrong rows
# in the admin panel — and restoring a snapshot rolls back every site on the
# box, not just the one that broke.
#
# This makes one restorable file per database instead.
#
# Install:  cp deploy/backup-db.sh /usr/local/bin/ && chmod +x /usr/local/bin/backup-db.sh
# Schedule: 30 3 * * * /usr/local/bin/backup-db.sh >> /var/log/pg-backup.log 2>&1

set -euo pipefail

DEST="${PG_BACKUP_DIR:-/var/backups/pg}"
KEEP_DAYS="${PG_BACKUP_KEEP:-14}"
STAMP=$(date +%F_%H%M)

# SQLite databases, space separated. geotaxi keeps its whole business here —
# bookings, drivers, customer accounts — in a single file that pg_dump has no
# idea exists. It went unbacked-up for months precisely because the nightly job
# only knew how to speak Postgres.
SQLITE_DBS="${SQLITE_DBS:-/srv/geotaxi-platform/prisma/prod.db}"

# Databases that live somewhere else — Neon, in our case. Listed as the .env
# files that hold their connection strings rather than as the strings
# themselves, so that rotating a password in one place rotates it everywhere and
# no credential is ever copied into this script or into cron.
REMOTE_ENVS="${REMOTE_ENVS:-/var/www/friendlymandriving/.env /srv/webertela/.env}"

# Ubuntu's pg_dump wrapper picks the version of the *local* cluster, which
# refuses to dump a newer server: Neon runs 18, the local one 16. Take the
# newest client actually installed.
PGDUMP=$(ls -1d /usr/lib/postgresql/*/bin/pg_dump 2>/dev/null | sort -V | tail -1)
PGDUMP="${PGDUMP:-pg_dump}"

mkdir -p "$DEST"
chmod 700 "$DEST"

echo "=== $(date -Is) backup starting ==="

# ----------------------------------------------------------------- PostgreSQL

# Roles and permissions live outside any single database. Without them a restore
# onto a fresh server has the data but nobody who is allowed to read it.
sudo -u postgres pg_dumpall --globals-only > "$DEST/globals_$STAMP.sql"
echo "  globals   $(du -h "$DEST/globals_$STAMP.sql" | cut -f1)"

# Every real database — templates and the empty maintenance db excluded.
DBS=$(sudo -u postgres psql -tAc \
  "SELECT datname FROM pg_database WHERE datistemplate = false AND datname <> 'postgres'")

for db in $DBS; do
  out="$DEST/${db}_$STAMP.dump"

  # -Fc is Postgres's custom format: compressed, and pg_restore can pull a
  # single table out of it. A plain .sql.gz forces all-or-nothing.
  sudo -u postgres pg_dump -Fc "$db" > "$out"

  size=$(stat -c %s "$out")
  if [ "$size" -lt 5000 ]; then
    echo "  !! $db dumped only ${size} bytes — that is too small to be real"
    exit 1
  fi
  echo "  $db  $(du -h "$out" | cut -f1)"
done

# ------------------------------------------------------------- remote (Neon)

# Neon's own history is short on the free plan, and it is a single account away
# from being lost entirely. These are friendlymandriving's real bookings and
# webertela's leads, so they get a copy that belongs to us.
for envfile in $REMOTE_ENVS; do
  app=$(basename "$(dirname "$envfile")")

  if [ ! -f "$envfile" ]; then
    echo "  !! $app: $envfile not found — skipping"
    continue
  fi

  # channel_binding=require is not understood by every client build and has
  # already cost us one evening. It adds nothing here: the connection is TLS
  # either way.
  url=$(grep -E '^DATABASE_URL=' "$envfile" | head -1 | cut -d= -f2- \
        | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//' -e 's/[?&]channel_binding=require//')

  case "$url" in
    postgresql://*|postgres://*) ;;
    *) echo "  -- $app: not a postgres URL — skipping"; continue ;;
  esac

  # Anything on this box is already covered by the loop above.
  case "$url" in
    *@127.0.0.1*|*@localhost*) echo "  -- $app: local, already dumped"; continue ;;
  esac

  out="$DEST/${app}_remote_$STAMP.dump"

  # Never let the URL reach the log — it carries the password.
  if ! "$PGDUMP" -Fc "$url" > "$out" 2>/tmp/backup-remote.err; then
    echo "  !! $app: pg_dump failed — $(head -1 /tmp/backup-remote.err)"
    rm -f "$out"
    exit 1
  fi

  size=$(stat -c %s "$out")
  if [ "$size" -lt 3000 ]; then
    echo "  !! $app dumped only ${size} bytes — that is too small to be real"
    exit 1
  fi
  echo "  $app (remote)  $(du -h "$out" | cut -f1)"
done
rm -f /tmp/backup-remote.err

# --------------------------------------------------------------------- SQLite

# `cp` on a live SQLite file can catch it mid-write and produce a database that
# opens fine and is quietly corrupt. `.backup` takes a consistent copy while the
# application keeps writing, which is the whole point of running this at 03:30
# rather than asking anyone to stop the site.
for src in $SQLITE_DBS; do
  name=$(basename "$(dirname "$(dirname "$src")")")   # /srv/geotaxi-platform/prisma/prod.db -> geotaxi-platform

  if [ ! -f "$src" ]; then
    echo "  !! $name: $src does not exist — skipping"
    continue
  fi

  out="$DEST/${name}_sqlite_$STAMP.db"

  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$src" ".backup '$out'"
    # A backup nobody has verified is a hope, not a backup. This reads every
    # page and fails loudly now rather than on the night it is needed.
    if ! sqlite3 "$out" 'PRAGMA integrity_check;' | grep -q '^ok$'; then
      echo "  !! $name: integrity check FAILED on the copy"
      exit 1
    fi
  else
    echo "  !! sqlite3 not installed — falling back to cp, copy may be inconsistent"
    echo "     install it with: apt-get install -y sqlite3"
    cp "$src" "$out"
  fi

  gzip -f "$out"
  echo "  $name (sqlite)  $(du -h "$out.gz" | cut -f1)"
done

# ---------------------------------------------------------------------- prune

# Prune, but never leave the directory empty even if the clock is wrong.
find "$DEST" -name '*.dump'        -mtime +"$KEEP_DAYS" -delete
find "$DEST" -name 'globals_*.sql' -mtime +"$KEEP_DAYS" -delete
find "$DEST" -name '*_sqlite_*.db.gz' -mtime +"$KEEP_DAYS" -delete

echo "  kept: $(ls -1 "$DEST"/*.dump 2>/dev/null | wc -l) pg dumps ($(ls -1 "$DEST"/*_remote_*.dump 2>/dev/null | wc -l) remote), $(ls -1 "$DEST"/*_sqlite_*.db.gz 2>/dev/null | wc -l) sqlite copies, ${KEEP_DAYS} day window"

# Off-server copy. A backup on the same disk dies with the disk.
# Set PG_BACKUP_REMOTE to something like: u123456@u123456.your-storagebox.de:pg/
if [ -n "${PG_BACKUP_REMOTE:-}" ]; then
  rsync -a --delete "$DEST/" "$PG_BACKUP_REMOTE" && echo "  copied off-server"
else
  echo "  NOTE: PG_BACKUP_REMOTE not set — these files live only on this disk"
fi

echo "=== $(date -Is) done ==="
