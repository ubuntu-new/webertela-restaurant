#!/usr/bin/env bash
# Nightly PostgreSQL backup.
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

mkdir -p "$DEST"
chmod 700 "$DEST"

echo "=== $(date -Is) backup starting ==="

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

# Prune, but never leave the directory empty even if the clock is wrong.
find "$DEST" -name '*.dump' -mtime +"$KEEP_DAYS" -delete
find "$DEST" -name 'globals_*.sql' -mtime +"$KEEP_DAYS" -delete

echo "  kept: $(ls -1 "$DEST"/*.dump 2>/dev/null | wc -l) dumps, ${KEEP_DAYS} day window"

# Off-server copy. A backup on the same disk dies with the disk.
# Set PG_BACKUP_REMOTE to something like: u123456@u123456.your-storagebox.de:pg/
if [ -n "${PG_BACKUP_REMOTE:-}" ]; then
  rsync -a --delete "$DEST/" "$PG_BACKUP_REMOTE" && echo "  copied off-server"
else
  echo "  NOTE: PG_BACKUP_REMOTE not set — these files live only on this disk"
fi

echo "=== $(date -Is) done ==="
