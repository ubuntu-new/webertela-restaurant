#!/usr/bin/env bash
# Notice the outage before the restaurant does.
#
# Until this existed, the first person to learn that the server was down was a
# customer, and the second was the owner, on the phone, during service. There
# was no health endpoint, no check, and no alert anywhere in the project. The
# cheapest possible fix for that is one machine asking every instance a
# question once a minute.
#
#   */1 * * * *  or the systemd timer alongside this file
#
# ── What it watches, and why each one ──
#
#   · **Every instance answers /api/health.** Not "is the process alive" —
#     `Restart=always` makes that nearly always true, including in a crash loop.
#     The endpoint proves it can reach its database, which is the failure that
#     otherwise looks healthy from outside and returns errors to every visitor.
#
#   · **Uptime going backwards.** A service restarting every few seconds passes
#     every individual health check it happens to be up for. The only way to see
#     it is to notice the uptime never grows.
#
#   · **Disk.** The classic silent killer, and this project got measurably more
#     exposed to it the day failed sign-ins started writing audit rows. Postgres
#     stops accepting writes on a full disk, and it stops for everyone at once.
#
#   · **Memory.** One Node process per tenant on a small VPS; the OOM killer
#     picks one and systemd restarts it into the same wall.
#
#   · **Backup freshness.** A backup schedule nobody checks is a backup that
#     stopped six weeks ago. This asks the only question that matters about it —
#     how old is the newest one.
#
# ── Alerting on change, not on state ──
#
# A monitor that shouts every minute for an hour gets muted, and a muted monitor
# is worse than none because it is *believed* to be watching. So a message is
# sent when something breaks and again when it recovers, and silence in between
# means the situation is unchanged rather than fine.

set -uo pipefail

ENV_FILE="/etc/webertela-watchdog.env"
STATE_DIR="/var/lib/webertela-watchdog"
INSTANCES_DIR="/srv"
BACKUP_DIR="/var/backups/pg"

DISK_WARN=85
DISK_CRIT=92
MEM_MIN_PCT=8
BACKUP_MAX_HOURS=36
# Two consecutive misses before shouting. One is a deploy restarting, a GC
# pause, or the timer landing mid-`systemctl restart` — all of which resolve
# themselves, and none of which are worth a phone buzzing at midnight.
FAILS_BEFORE_ALERT=2

[ -f "$ENV_FILE" ] && . "$ENV_FILE"
mkdir -p "$STATE_DIR"

# ── how a message gets out ────────────────────────────────────────────────────
#
# Telegram if it is configured, because a restaurant owner and a developer both
# already have it on their phone. Any other webhook otherwise. Neither
# configured means the message still reaches the journal, so nothing is lost —
# it simply has to be gone looking for.
notify() {
  local text="$1"
  logger -t webertela-watchdog -- "$text"

  if [ -n "${ALERT_TELEGRAM_TOKEN:-}" ] && [ -n "${ALERT_TELEGRAM_CHAT:-}" ]; then
    curl -sS -m 10 -o /dev/null \
      "https://api.telegram.org/bot${ALERT_TELEGRAM_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${ALERT_TELEGRAM_CHAT}" \
      --data-urlencode "text=${text}" || true
  fi

  if [ -n "${ALERT_WEBHOOK:-}" ]; then
    curl -sS -m 10 -o /dev/null -H 'Content-Type: application/json' \
      -d "$(printf '{"text":%s}' "$(printf '%s' "$text" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")" \
      "$ALERT_WEBHOOK" || true
  fi
}

# Say it once when it breaks, once when it mends, and nothing in between.
#   transition <key> <ok|bad> <message>
transition() {
  local key="$1" now="$2" msg="$3"
  local f="$STATE_DIR/$key"
  local was; was="$(cat "$f" 2>/dev/null || echo ok)"

  if [ "$now" != "$was" ]; then
    printf '%s' "$now" > "$f"
    if [ "$now" = "bad" ]; then notify "🔴 $msg"; else notify "🟢 $msg"; fi
  fi
}

HOST="$(hostname -s)"

# ── each instance ─────────────────────────────────────────────────────────────
for dir in "$INSTANCES_DIR"/*; do
  [ -d "$dir" ] || continue
  [ -f "$dir/.env" ] || continue
  slug="$(basename "$dir")"

  port="$(grep -oP '(?<=^PORT=)\d+' "$dir/.env" 2>/dev/null | head -1)"
  [ -n "$port" ] || continue

  body="$(curl -sS -m 8 "http://127.0.0.1:${port}/api/health" 2>/dev/null)"
  code="$(curl -sS -m 8 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/api/health" 2>/dev/null)"

  if [ "$code" = "200" ]; then
    rm -f "$STATE_DIR/fails-$slug"
    transition "health-$slug" ok "$HOST/$slug is answering again."

    # A process whose uptime keeps falling is restarting in a loop, and every
    # single check it answers looks perfect.
    up="$(printf '%s' "$body" | grep -oP '(?<="uptime":)\d+' | head -1)"
    prev="$(cat "$STATE_DIR/uptime-$slug" 2>/dev/null || echo 0)"
    [ -n "$up" ] && printf '%s' "$up" > "$STATE_DIR/uptime-$slug"
    if [ -n "$up" ] && [ "$up" -lt "$prev" ] && [ "$up" -lt 120 ]; then
      transition "loop-$slug" bad "$HOST/$slug restarted (up ${up}s, was ${prev}s). Crash loop?"
    else
      [ -n "$up" ] && [ "$up" -gt 600 ] && transition "loop-$slug" ok "$HOST/$slug has been stable for $((up / 60)) minutes."
    fi
  else
    n="$(cat "$STATE_DIR/fails-$slug" 2>/dev/null || echo 0)"
    n=$((n + 1))
    printf '%s' "$n" > "$STATE_DIR/fails-$slug"
    if [ "$n" -ge "$FAILS_BEFORE_ALERT" ]; then
      transition "health-$slug" bad "$HOST/$slug is DOWN — /api/health returned ${code:-nothing}. Customers cannot order online."
    fi
  fi
done

# ── the machine underneath ────────────────────────────────────────────────────
disk="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
if [ "${disk:-0}" -ge "$DISK_CRIT" ]; then
  transition disk bad "$HOST disk is ${disk}% full. Postgres stops accepting writes when it fills — every restaurant at once."
elif [ "${disk:-0}" -ge "$DISK_WARN" ]; then
  transition disk bad "$HOST disk is ${disk}% full."
else
  transition disk ok "$HOST disk is back to ${disk}%."
fi

mem_total="$(awk '/MemTotal/{print $2}' /proc/meminfo)"
mem_avail="$(awk '/MemAvailable/{print $2}' /proc/meminfo)"
mem_pct=$(( mem_avail * 100 / mem_total ))
if [ "$mem_pct" -lt "$MEM_MIN_PCT" ]; then
  transition mem bad "$HOST has ${mem_pct}% memory free. The OOM killer picks a restaurant at random next."
else
  transition mem ok "$HOST memory is back to ${mem_pct}% free."
fi

# ── the backups ───────────────────────────────────────────────────────────────
newest="$(find "$BACKUP_DIR" -name '*.dump' -mmin -$((BACKUP_MAX_HOURS * 60)) 2>/dev/null | head -1)"
if [ -z "$newest" ]; then
  transition backup bad "$HOST has no database backup newer than ${BACKUP_MAX_HOURS}h. A schedule nobody checks is a schedule that stopped."
else
  transition backup ok "$HOST backups are current again."
fi

exit 0
