#!/usr/bin/env bash
# Every tenant's database, every night, and off this machine.
#
# Backups existed before this — `wave2-dup-apply.sh` takes one before every
# migration, and it verifies the restore, which is the part most people skip.
# But those only happen when somebody deploys, and **they live on the same disk
# as the database they protect.** A dying host takes both. That is not a backup,
# it is a copy.
#
#   ./backup-nightly.sh          dump every instance, prune, ship if configured
#   ./backup-nightly.sh --check  say what it would do and prove it can reach the
#                                remote, without writing anything
#
# ── The off-host half is opt-in and says so ──
#
# `BACKUP_REMOTE` in /etc/webertela-watchdog.env is either an rclone target
# (`b2:webertela-backups`) or an scp one (`user@host:/srv/backups`). Unset, this
# still runs and still keeps local dumps — but it announces on every run that
# the copies are one disk failure from worthless, because a script that silently
# does half its job is how people end up believing they have backups.

set -uo pipefail

ENV_FILE="/etc/webertela-watchdog.env"
BACKUP_DIR="/var/backups/pg"
KEEP_DAYS=14
CHECK=false
[ "${1:-}" = "--check" ] && CHECK=true

[ -f "$ENV_FILE" ] && . "$ENV_FILE"
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%F_%H%M%S)"
HOST="$(hostname -s)"
failed=""
made=0
would=0

say() { printf '%s\n' "$*"; }

notify() {
  logger -t webertela-backup -- "$1"
  if [ -n "${ALERT_TELEGRAM_TOKEN:-}" ] && [ -n "${ALERT_TELEGRAM_CHAT:-}" ]; then
    curl -sS -m 10 -o /dev/null \
      "https://api.telegram.org/bot${ALERT_TELEGRAM_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${ALERT_TELEGRAM_CHAT}" \
      --data-urlencode "text=$1" || true
  fi
}

# ── one dump per instance ─────────────────────────────────────────────────────
#
# The database name is parsed out of each instance's own DATABASE_URL rather
# than guessed from the directory name, and Postgres is reached as the postgres
# user with a plain name — Prisma appends `?schema=public`, which libpq's own
# tools reject, and root is not a postgres role. Both of those cost a failed
# deploy to learn once already.
#
# ⚠️ Not every instance on this host is Postgres. The first run of this script
# announced it would `pg_dump 'prod.db'` for a tenant whose `DATABASE_URL` is a
# SQLite file — a command that fails every night forever, alerting every night
# forever, which is precisely how a monitor gets muted. So the scheme decides
# the tool, and a scheme neither tool understands is skipped out loud rather
# than attempted and reported as a failure.
for dir in /srv/*; do
  [ -d "$dir" ] || continue
  [ -f "$dir/.env" ] || continue
  slug="$(basename "$dir")"

  url="$(grep -oP '(?<=^DATABASE_URL=)["'"'"']?\K[^"'"'"']+' "$dir/.env" 2>/dev/null | head -1)"
  [ -n "$url" ] || { say "  $slug: no DATABASE_URL, skipped"; continue; }

  case "$url" in
    postgres://*|postgresql://*) kind=pg ;;
    file:*|sqlite:*)             kind=sqlite ;;
    *.db|*.sqlite|*.sqlite3)     kind=sqlite ;;
    *)                           kind=unknown ;;
  esac

  if [ "$kind" = "unknown" ]; then
    # Named, not silently ignored: an instance nobody is backing up is worth
    # one line a night until somebody decides that is on purpose.
    say "  $slug: DATABASE_URL is neither Postgres nor SQLite — NOT backed up"
    continue
  fi

  if [ "$kind" = "sqlite" ]; then
    # ⚠️ A relative SQLite path in Prisma is relative to **the schema file**, not
    # to the project root. `file:./prod.db` in `prisma/schema.prisma` means
    # `prisma/prod.db`. Resolving it against the app directory found nothing and
    # skipped a paying customer's only database, quietly, while reporting a
    # tidy-looking three-of-four.
    #
    # So both are tried, Prisma's convention first, and a miss says where it
    # looked rather than naming one guess as though it were the answer.
    rel="$(printf '%s' "$url" | sed -E 's#^(file:|sqlite:)(//)?##; s#\?.*$##')"
    case "$rel" in
      /*) path="$rel" ;;
      *)
        rel="${rel#./}"
        if   [ -f "$dir/prisma/$rel" ]; then path="$dir/prisma/$rel"
        elif [ -f "$dir/$rel" ];        then path="$dir/$rel"
        else path=""
        fi
        ;;
    esac

    if [ -z "$path" ] || [ ! -f "$path" ]; then
      say "  $slug: SQLite file not found — looked in $dir/prisma/ and $dir/ for '$rel'. NOT backed up."
      failed="$failed $slug(missing-db)"
      continue
    fi

    out="$BACKUP_DIR/${slug}_nightly_${STAMP}.sqlite"
    if $CHECK; then
      say "  $slug → would copy SQLite $path"
      would=$((would + 1))
      continue
    fi

    # `.backup` rather than `cp`: SQLite can be mid-write, and a copied file is
    # a torn one. This takes a consistent snapshot of a live database.
    if sqlite3 "$path" ".backup '$out'" 2>/dev/null; then
      made=$((made + 1))
      say "  $slug: $(du -h "$out" | cut -f1) (sqlite)"
    else
      failed="$failed $slug(sqlite)"
      rm -f "$out"
      say "  $slug: sqlite backup FAILED"
    fi
    continue
  fi

  dbname="$(printf '%s' "$url" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
  [ -n "$dbname" ] || { say "  $slug: could not read a database name"; continue; }

  out="$BACKUP_DIR/${dbname}_nightly_${STAMP}.dump"

  if $CHECK; then
    say "  $slug → would dump Postgres '$dbname'"
    would=$((would + 1))
    continue
  fi

  if sudo -u postgres pg_dump -Fc "$dbname" > "$out" 2>/dev/null; then
    size="$(stat -c %s "$out")"
    # A dump that "succeeded" at 200 bytes is an empty database or a silent
    # permissions failure. Either way it is not something to trust tomorrow.
    if [ "$size" -lt 5000 ]; then
      rm -f "$out"
      failed="$failed $slug(tiny)"
      say "  $slug: dump was only ${size} bytes — discarded"
    else
      made=$((made + 1))
      say "  $slug: $(du -h "$out" | cut -f1)"
    fi
  else
    failed="$failed $slug(pg_dump)"
    rm -f "$out"
    say "  $slug: pg_dump FAILED"
  fi
done

# ── off this machine ──────────────────────────────────────────────────────────
shipped="not configured"
if [ -n "${BACKUP_REMOTE:-}" ]; then
  if printf '%s' "$BACKUP_REMOTE" | grep -q ':/'; then
    # user@host:/path — plain scp, no extra software on either end
    if $CHECK; then
      shipped="would scp to $BACKUP_REMOTE"
      ssh -o BatchMode=yes -o ConnectTimeout=8 "${BACKUP_REMOTE%%:*}" true \
        && shipped="$shipped (reachable)" || shipped="$shipped (UNREACHABLE)"
    elif scp -q -o BatchMode=yes -o ConnectTimeout=15 \
        "$BACKUP_DIR"/*_nightly_"$STAMP".* "$BACKUP_REMOTE"/ 2>/dev/null; then
      shipped="copied to $BACKUP_REMOTE"
    else
      shipped="FAILED to reach $BACKUP_REMOTE"
      failed="$failed offsite"
    fi
  else
    # an rclone remote — object storage, versioned, cheap
    if $CHECK; then
      rclone lsd "$BACKUP_REMOTE" >/dev/null 2>&1 \
        && shipped="would rclone to $BACKUP_REMOTE (reachable)" \
        || shipped="would rclone to $BACKUP_REMOTE (UNREACHABLE)"
    elif rclone copy --include "*_nightly_${STAMP}.*" "$BACKUP_DIR" "$BACKUP_REMOTE" 2>/dev/null; then
      shipped="copied to $BACKUP_REMOTE"
    else
      shipped="FAILED to reach $BACKUP_REMOTE"
      failed="$failed offsite"
    fi
  fi
fi

# ── prune, but only what left the building ────────────────────────────────────
if ! $CHECK; then
  find "$BACKUP_DIR" \( -name '*_nightly_*.dump' -o -name '*_nightly_*.sqlite' \) -mtime +$KEEP_DAYS -delete 2>/dev/null
fi

say ""
if $CHECK; then
  say "$would would be backed up · offsite: $shipped"
else
  say "$made backed up · offsite: $shipped"
fi

if $CHECK; then
  [ -z "${BACKUP_REMOTE:-}" ] && say "
⚠ BACKUP_REMOTE is not set in $ENV_FILE, so every copy lives on the same disk
  as the databases. That protects against a bad migration and against nothing
  else — a dead host takes the originals and the backups together."
  exit 0
fi

if [ -n "$failed" ]; then
  notify "🔴 $HOST nightly backup had problems:$failed"
  exit 1
fi

if [ -z "${BACKUP_REMOTE:-}" ]; then
  notify "🟡 $HOST backed up $made database(s) — but only locally. Set BACKUP_REMOTE in $ENV_FILE."
fi

exit 0
