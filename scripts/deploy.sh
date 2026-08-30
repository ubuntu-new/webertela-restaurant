#!/usr/bin/env bash
# The routine deploy. Build somewhere else, swap it in, and put it back if the
# site does not come up.
#
#   cd /srv/demo && git pull && bash scripts/deploy.sh /srv/demo
#
# ── Why this exists ──
#
# The demo went down for twenty minutes and the deploy script was the cause. Its
# build ran in place, so `next build` was overwriting `.next` while the live
# process was still reading from it. The script's own guard — "never restart on
# a failed build, the site keeps serving the old code" — was written to prevent
# an outage and instead guaranteed one: the old code is exactly what the failed
# build had just destroyed, so the site returned 502 until somebody noticed and
# rebuilt by hand. A safety measure that only fires when it is already too late
# is not a safety measure.
#
# So the build goes into `.next-build`, untouched by anything serving traffic.
# Only a build that finished is moved into place, the previous one is kept
# beside it, and if the site does not answer afterwards it is put straight back.
# The worst case is now a few seconds of restart rather than an outage lasting
# until someone opens a browser.
#
# This does not run migrations. A wave that changes the schema still goes
# through scripts/wave2-dup-apply.sh, which backs up and verifies the restore
# first.

set -uo pipefail

APP="${1:-$PWD}"
[ -d "$APP" ] || { echo "!! $APP does not exist"; exit 1; }
cd "$APP"

SERVICE="$(basename "$APP")"
BUILD_DIR=".next-build"
PREV_DIR=".next-previous"

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
warn() { printf '\033[33m   %s\033[0m\n' "$*"; }
die()  { printf '\n\033[31m!! %s\033[0m\n' "$*"; exit 1; }

[ -f package.json ] || die "not a Next project — wrong directory?"
[ -f .env ] || die "no .env in $APP"

PORT="$(grep -oP '(?<=^PORT=)\d+' .env || echo 3000)"

# Is this instance serving?
#
# `/api/health` is the real answer, but it has not always existed — a build made
# before it was added returns 404, and reading that as "down" made this script
# announce a healthy site as broken on its very first run. Worse, the same check
# runs after the restart, so on any release that does not include the endpoint
# it would have rolled back a deploy that worked perfectly.
#
# So: 200 is up, a connection failure or a 5xx is down, and a 404 means this
# build simply predates the endpoint — in which case the question becomes the
# weaker one the script can still answer, which is whether the server responds
# to anything at all.
was_up() {
  local code
  code="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/health" 2>/dev/null)"

  case "$code" in
    200) return 0 ;;
    404)
      local alt
      alt="$(curl -sS -m 5 -L -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/pos" 2>/dev/null)"
      [ -n "$alt" ] && [ "$alt" -lt 500 ] 2>/dev/null && return 0
      return 1
      ;;
    *) return 1 ;;
  esac
}

# Said once, so that "up" never quietly means "up as far as I could tell".
health_kind() {
  local code
  code="$(curl -sS -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/health" 2>/dev/null)"
  [ "$code" = "404" ] && echo "(this build has no /api/health — judged by whether it answers at all)"
}

say "before"
if was_up; then
  echo "   site is up on :$PORT $(health_kind)"
else
  warn "site is ALREADY down — this deploy is a repair, not a release"
fi
echo "   git: $(git rev-parse --short HEAD) $(git log -1 --format=%s | cut -c1-60)"

# The dirty-tree guard, and why three files are exempt.
#
# A guard that blocks its own instructions teaches people to work around the
# guard, and both exemptions here were earned that way. npm rewrites
# package-lock.json during the `npm install` this script performs. And **Next
# rewrites tsconfig.json during `next build`** — it adds its own compiler
# options on every run — so after the very first deploy the tree is dirty
# forever and no deploy can ever pass again.
DIRTY="$(git status --porcelain -- . ':!.npm' ':!package-lock.json' ':!tsconfig.json' 2>/dev/null)"
[ -n "$DIRTY" ] && { warn "uncommitted changes:"; printf '%s\n' "$DIRTY"; die "commit or stash first"; }

say "dependencies"
npm install --no-audit --no-fund || die "npm install failed"
npx prisma generate >/dev/null || die "prisma generate failed"

# Migrations are somebody else's job, but an un-applied one is worth knowing
# about before the new code goes live expecting it.
if ! npx prisma migrate status >/dev/null 2>&1; then
  warn "prisma migrate status is unhappy — if this release needs a migration, stop and use wave2-dup-apply.sh"
fi

say "type check"
npx tsc --noEmit || die "type errors above. Nothing was touched; the site is still serving."

say "lint (reports, does not gate)"
LINT="$(npm run lint 2>&1 || true)"
printf '%s\n' "$LINT" | sed -n '/^\.\//,$p'
echo "   $(printf '%s' "$LINT" | grep -c "  Error: " || true) errors, $(printf '%s' "$LINT" | grep -c "  Warning: " || true) warnings"

# ── build somewhere the running site cannot see ───────────────────────────────
say "building into $BUILD_DIR"
rm -rf "$BUILD_DIR"
if ! NEXT_DIST_DIR="$BUILD_DIR" npm run build; then
  rm -rf "$BUILD_DIR"
  die "BUILD FAILED — and this time that genuinely means nothing changed. The site is still serving the previous build."
fi

# A build that "succeeded" without a BUILD_ID did not succeed.
[ -f "$BUILD_DIR/BUILD_ID" ] || { rm -rf "$BUILD_DIR"; die "build produced no BUILD_ID — refusing to swap it in"; }

# ── swap ──────────────────────────────────────────────────────────────────────
say "swapping it in"
rm -rf "$PREV_DIR"
[ -d .next ] && mv .next "$PREV_DIR"
mv "$BUILD_DIR" .next
echo "   previous build kept in $PREV_DIR"

# The build ran as root, so .next belongs to root — but the service runs as its
# own user and Next writes a prerender cache there while serving. Without this
# the journal fills with EACCES on every cacheable page.
RUN_USER="$(systemctl show -p User --value "$SERVICE" 2>/dev/null || true)"
if [ -n "$RUN_USER" ] && [ "$RUN_USER" != "root" ]; then
  chown -R "$RUN_USER":"$RUN_USER" .next
  echo "   .next handed to $RUN_USER"
fi

say "restarting $SERVICE"
systemctl restart "$SERVICE"

# ── did it actually come up ───────────────────────────────────────────────────
say "waiting for it to answer"
ok=false
for i in $(seq 20); do
  sleep 1
  if was_up; then ok=true; echo "   answering after ${i}s"; break; fi
done

if $ok; then
  say "done"
  curl -sS -m 5 "http://127.0.0.1:${PORT}/api/health"; echo
  [ -n "$(health_kind)" ] && warn "no /api/health in this build — the watchdog cannot monitor it"
  echo "   $PREV_DIR is kept until the next deploy, in case you want it."
  exit 0
fi

# ── put it back ───────────────────────────────────────────────────────────────
#
# The whole reason for keeping the previous build. Rolling back automatically is
# right here because the alternative is a human discovering the outage later:
# the new build is available to look at afterwards, the site is not down while
# you look at it.
say "IT DID NOT COME UP — rolling back"
if [ -d "$PREV_DIR" ]; then
  rm -rf .next-failed
  mv .next .next-failed
  mv "$PREV_DIR" .next
  [ -n "$RUN_USER" ] && [ "$RUN_USER" != "root" ] && chown -R "$RUN_USER":"$RUN_USER" .next
  systemctl restart "$SERVICE"
  sleep 3
  if was_up; then
    printf '\n\033[33m   Rolled back. The site is up on the previous build.\033[0m\n'
    echo "   The build that failed is in .next-failed — look at it there."
  else
    printf '\n\033[31m   Rollback did not help either. Something outside the build is wrong.\033[0m\n'
  fi
else
  warn "no previous build to roll back to"
fi

echo
journalctl -u "$SERVICE" -n 40 --no-pager
exit 1
