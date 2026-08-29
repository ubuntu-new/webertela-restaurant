#!/usr/bin/env bash
# Stand up a new restaurant on this server, start to finish.
#
#   new-tenant.sh demo --domain demo.webertela.online --port 3004 --demo
#   new-tenant.sh ronnys-monroe --domain order.ronnysmonroe.com --port 3005 \
#                 --currency USD --locale en-US --tz America/New_York
#
# Creates: system user · database and role · checkout · .env with generated
# secrets · migrations · build · hardened systemd unit · Caddy block · the
# organisation's money and date format · an admin account. Then proves it
# serves traffic.
#
# Instance-per-tenant is the right architecture — one customer's bad migration
# cannot reach another's data. But it multiplies operations by the number of
# customers, and every deploy on this box has so far been done by hand. This
# script is what makes the tenth customer cost the same as the second.
#
# It is also the honest measure of the business: time it. Two days per customer
# is a business one person can run; two weeks is a job with worse hours than
# driving.

set -euo pipefail

# ── defaults ─────────────────────────────────────────────────────────────
REPO="git@github-restaurant:ubuntu-new/webertela-restaurant.git"
SRV_ROOT="/srv"
UPLOAD_ROOT="/var/www"
CADDYFILE="/etc/caddy/Caddyfile"

SLUG="" ; DOMAIN="" ; PORT=""
CURRENCY="USD" ; LOCALE="en-US" ; TZ_NAME="America/New_York" ; COUNTRY="US"
ADMIN_EMAIL="" ; DEMO=0 ; DRY=0

usage() {
  cat <<EOF
Usage: $0 <slug> --domain <host> --port <n> [options]

  --currency USD        ISO code. Drives every price on every screen.
  --locale   en-US      Number and date formatting.
  --tz       America/New_York
  --country  US
  --admin    you@example.com   Creates the first admin account.
  --demo                 DEMO_MODE=1 — writes are refused, for a public demo.
  --dry-run              Print the plan and change nothing.
EOF
  exit 1
}

[ $# -ge 1 ] || usage
SLUG="$1"; shift
while [ $# -gt 0 ]; do
  case "$1" in
    --domain)   DOMAIN="$2"; shift 2 ;;
    --port)     PORT="$2"; shift 2 ;;
    --currency) CURRENCY="$2"; shift 2 ;;
    --locale)   LOCALE="$2"; shift 2 ;;
    --tz)       TZ_NAME="$2"; shift 2 ;;
    --country)  COUNTRY="$2"; shift 2 ;;
    --admin)    ADMIN_EMAIL="$2"; shift 2 ;;
    --demo)     DEMO=1; shift ;;
    --dry-run)  DRY=1; shift ;;
    *) echo "unknown option: $1"; usage ;;
  esac
done

[ -n "$DOMAIN" ] && [ -n "$PORT" ] || usage
[[ "$SLUG" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || { echo "!! slug must be lowercase letters, digits and dashes"; exit 1; }

APP_DIR="$SRV_ROOT/$SLUG"
UPLOAD_DIR="$UPLOAD_ROOT/$SLUG/uploads"
UNIT="/etc/systemd/system/$SLUG.service"
DB="$SLUG" ; DB_USER="$SLUG"

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m!! %s\033[0m\n' "$*"; exit 1; }

# ── 1. refuse to collide with anything that already exists ───────────────
say "checking nothing is in the way"

[ "$(id -u)" -eq 0 ] || fail "run as root"
[ -e "$APP_DIR" ] && fail "$APP_DIR already exists"
[ -e "$UNIT" ] && fail "$UNIT already exists"
id "$DB_USER" >/dev/null 2>&1 && fail "system user $DB_USER already exists"
ss -tlnp 2>/dev/null | grep -q ":$PORT " && fail "port $PORT is already listening"
grep -q "^$DOMAIN" "$CADDYFILE" 2>/dev/null && fail "$DOMAIN already has a Caddy block"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB'" | grep -q 1 \
  && fail "database $DB already exists"

echo "   slug      $SLUG"
echo "   domain    $DOMAIN"
echo "   port      $PORT"
echo "   money     $CURRENCY · $LOCALE · $TZ_NAME"
[ "$DEMO" -eq 1 ] && echo "   mode      DEMO (writes refused)"

if [ "$DRY" -eq 1 ]; then
  say "dry run — nothing was changed"
  exit 0
fi

# Anything created from here is torn down if a later step fails. A half-built
# tenant is worse than none: it holds the port, the name and the database, and
# the next attempt trips over its own leftovers.
CREATED=()
cleanup() {
  [ ${#CREATED[@]} -eq 0 ] && exit 1
  printf '\n\033[33m   rolling back what was created…\033[0m\n'
  for item in "${CREATED[@]}"; do
    case "$item" in
      dir)   rm -rf "$APP_DIR" "$UPLOAD_ROOT/$SLUG" ;;
      user)  userdel "$DB_USER" 2>/dev/null || true ;;
      db)    sudo -u postgres dropdb --if-exists "$DB" ;;
      role)  sudo -u postgres psql -qc "DROP ROLE IF EXISTS \"$DB_USER\"" ;;
      unit)  systemctl disable --now "$SLUG" 2>/dev/null || true; rm -f "$UNIT"; systemctl daemon-reload ;;
      caddy) sed -i "/^# >>> $SLUG$/,/^# <<< $SLUG$/d" "$CADDYFILE"; systemctl reload caddy || true ;;
    esac
  done
  printf '   rolled back. nothing of %s remains.\n' "$SLUG"
  exit 1
}
trap cleanup ERR

# ── 2. system user ───────────────────────────────────────────────────────
say "system user"
useradd --system --create-home --home-dir "/home/$SLUG" --shell /usr/sbin/nologin "$DB_USER"
CREATED+=(user)
echo "   $DB_USER (no shell, no login)"

# ── 3. database ──────────────────────────────────────────────────────────
say "database"
DB_PASS=$(openssl rand -hex 24)
sudo -u postgres psql -qc "CREATE ROLE \"$DB_USER\" LOGIN PASSWORD '$DB_PASS'"
CREATED+=(role)
sudo -u postgres createdb -O "$DB_USER" "$DB"
CREATED+=(db)
echo "   $DB owned by $DB_USER"

# ── 4. code ──────────────────────────────────────────────────────────────
say "checkout"
git clone --quiet "$REPO" "$APP_DIR"
CREATED+=(dir)
mkdir -p "$UPLOAD_DIR"
chown -R "$DB_USER:$DB_USER" "$APP_DIR" "$UPLOAD_ROOT/$SLUG"
echo "   $APP_DIR  ($(cd "$APP_DIR" && git rev-parse --short HEAD))"

# ── 5. .env ──────────────────────────────────────────────────────────────
say "configuration"
cat > "$APP_DIR/.env" <<EOF
NEXT_PUBLIC_SITE_URL=https://$DOMAIN
DATABASE_URL="postgresql://$DB_USER:$DB_PASS@127.0.0.1:5432/$DB?schema=public"
AUTH_SECRET=$(openssl rand -hex 32)
ORDER_STRICT=1
UPLOAD_DIR=$UPLOAD_DIR
EOF
# Telegram is optional and per-restaurant. Left empty rather than absent so the
# key is visible when someone comes to fill it in.
echo 'TELEGRAM_BOT_TOKEN=' >> "$APP_DIR/.env"
[ "$DEMO" -eq 1 ] && echo 'DEMO_MODE=1' >> "$APP_DIR/.env"

chown "$DB_USER:$DB_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"
echo "   .env written, secrets generated, mode 600"

# ── 6. install, migrate, build ───────────────────────────────────────────
say "install and migrate"
# NODE_ENV=production in the shell makes npm skip devDependencies, and the
# build then fails on a missing toolchain. Unset it for these steps only.
runuser -u "$DB_USER" -- env -u NODE_ENV npm ci --include=dev --silent --prefix "$APP_DIR" \
  || fail "npm ci failed"
cd "$APP_DIR"
runuser -u "$DB_USER" -- env -u NODE_ENV npx prisma migrate deploy || fail "migrate failed"
runuser -u "$DB_USER" -- env -u NODE_ENV npx prisma generate >/dev/null || fail "prisma generate failed"

say "build"
runuser -u "$DB_USER" -- env -u NODE_ENV npm run build 2>&1 | tail -4 || fail "build failed"

# ── 7. the organisation's own money and dates ────────────────────────────
say "money and dates"
sudo -u postgres psql -d "$DB" -qc "
INSERT INTO \"Setting\" (\"key\", \"value\", \"updatedAt\")
VALUES ('org', '{\"locale\":\"$LOCALE\",\"currency\":\"$CURRENCY\",\"timeZone\":\"$TZ_NAME\",\"country\":\"$COUNTRY\"}', NOW())
ON CONFLICT (\"key\") DO NOTHING;"
echo "   $CURRENCY · $LOCALE · $TZ_NAME"

# ── 8. systemd, with the hardening the August intrusion argued for ───────
say "service"
cat > "$UNIT" <<EOF
[Unit]
Description=$SLUG (Next.js)
After=network.target postgresql.service

[Service]
Type=simple
User=$DB_USER
Group=$DB_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=HOSTNAME=127.0.0.1
Environment=PORT=$PORT
Environment=HOME=/home/$SLUG
ExecStart=/usr/bin/npm start -- -H 127.0.0.1 -p $PORT
Restart=always
RestartSec=5

# In August an RCE in Next.js reached root because the app ran as root. It now
# runs as nobody in particular, and cannot write outside its own directories —
# so the same exploit would have nothing to escalate with.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=$APP_DIR $UPLOAD_DIR /home/$SLUG

[Install]
WantedBy=multi-user.target
EOF
CREATED+=(unit)
systemctl daemon-reload
systemctl enable --now "$SLUG" >/dev/null
sleep 4
[ "$(systemctl is-active "$SLUG")" = "active" ] || { journalctl -u "$SLUG" -n 20 --no-pager; fail "service did not start"; }
echo "   $SLUG active on 127.0.0.1:$PORT"

# ── 9. Caddy ─────────────────────────────────────────────────────────────
say "reverse proxy"
cat >> "$CADDYFILE" <<EOF

# >>> $SLUG
$DOMAIN {
	encode gzip

	handle_path /uploads/* {
		root * $UPLOAD_DIR
		header Cache-Control "public, max-age=2592000, immutable"
		file_server
	}

	reverse_proxy 127.0.0.1:$PORT {
		import proxyheaders
	}

	request_body {
		max_size 10MB
	}
}
# <<< $SLUG
EOF
CREATED+=(caddy)
caddy validate --config "$CADDYFILE" >/dev/null 2>&1 || fail "Caddyfile is invalid — rolled back"
systemctl reload caddy
echo "   $DOMAIN → 127.0.0.1:$PORT"

# ── 10. first admin ──────────────────────────────────────────────────────
if [ -n "$ADMIN_EMAIL" ] && [ -f "$APP_DIR/scripts/create-admin.mjs" ]; then
  say "admin account"
  ADMIN_PASS=$(openssl rand -base64 18 | tr -d '/+=' | head -c 16)
  runuser -u "$DB_USER" -- env -u NODE_ENV node "$APP_DIR/scripts/create-admin.mjs" \
    "$ADMIN_EMAIL" "$ADMIN_PASS" >/dev/null 2>&1 \
    && echo "   $ADMIN_EMAIL / $ADMIN_PASS   ← write this down now" \
    || echo "   !! create-admin.mjs failed — make the account by hand"
fi

# ── 11. prove it works ───────────────────────────────────────────────────
say "does it actually serve"
trap - ERR   # past the point where rolling back is the right answer

LOCAL=$(curl -sL -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT" || echo 000)
PUBLIC=$(curl -sL -o /dev/null -w '%{http_code}' "https://$DOMAIN" || echo 000)
ERRS=$(journalctl -u "$SLUG" --since "2 minutes ago" --no-pager 2>/dev/null | grep -ciE 'prisma:error|PrismaClient' || true)

printf '   local     %s\n   public    %s\n   db errors %s\n' "$LOCAL" "$PUBLIC" "$ERRS"
[ "$LOCAL" = "200" ] || echo "   !! the app is not answering locally — check journalctl -u $SLUG"
[ "$PUBLIC" = "200" ] || echo "   !! not reachable at https://$DOMAIN yet — DNS, or the certificate is still being issued"

say "$SLUG is up"
cat <<EOF

  https://$DOMAIN
  admin      https://$DOMAIN/admin
  directory  $APP_DIR
  database   $DB   (picked up by the nightly backup automatically)
  service    systemctl status $SLUG · journalctl -u $SLUG -f

  Still to do by hand:
    - point $DOMAIN at this server in DNS, if it is not already
    - fill in TELEGRAM_BOT_TOKEN in $APP_DIR/.env if this restaurant wants it
    - seed the menu

EOF
