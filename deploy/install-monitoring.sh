#!/usr/bin/env bash
# Put the watchdog and the nightly backup in place. Safe to run again.
#
#   sudo bash deploy/install-monitoring.sh
#
# Installs two systemd timers and one config file, then proves both scripts run
# before it claims anything. Nothing here touches an instance, a database, or a
# running service — the worst it can do is create files.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="/etc/webertela-watchdog.env"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

[ "$(id -u)" = "0" ] || { echo "!! run this with sudo"; exit 1; }

say "installing the scripts"
install -m 755 "$HERE/watchdog.sh"       /usr/local/bin/webertela-watchdog
install -m 755 "$HERE/backup-nightly.sh" /usr/local/bin/webertela-backup
echo "   /usr/local/bin/webertela-watchdog"
echo "   /usr/local/bin/webertela-backup"

# ── where the alert goes ──────────────────────────────────────────────────────
#
# Written once and never overwritten: it holds a bot token, and a re-run of an
# installer must not quietly wipe the thing that makes the alerts arrive.
if [ ! -f "$ENV_FILE" ]; then
  say "writing $ENV_FILE"
  cat > "$ENV_FILE" <<'ENV'
# Where an alert goes. Fill at least one of these in, or the only record of an
# outage is `journalctl -t webertela-watchdog` — which nobody reads at 19:00 on
# a Friday, which is the entire point of having alerts.
#
# Telegram is the practical choice: both you and a restaurant owner already have
# it on a phone that makes a noise.
#   1. message @BotFather, /newbot, copy the token
#   2. message your new bot once, then open
#      https://api.telegram.org/bot<TOKEN>/getUpdates and copy "chat":{"id":...}
ALERT_TELEGRAM_TOKEN=
ALERT_TELEGRAM_CHAT=

# Anything that accepts {"text": "..."} — Slack, Mattermost, Discord (+/slack).
ALERT_WEBHOOK=

# Where the nightly backup is copied so that a dead host does not take the
# backups with the databases. Either form works:
#   rclone remote      b2:webertela-backups
#   ssh destination    backups@other-host:/srv/webertela
# Left empty, backups still run — and still live on the disk they are meant to
# protect, which the script will keep telling you.
BACKUP_REMOTE=
ENV
  chmod 600 "$ENV_FILE"
  echo "   created — fill it in, it is empty on purpose"
else
  echo "   $ENV_FILE exists, left alone"
fi

# ── the timers ────────────────────────────────────────────────────────────────
say "systemd units"

cat > /etc/systemd/system/webertela-watchdog.service <<'UNIT'
[Unit]
Description=webertela — is every instance actually serving
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/webertela-watchdog
# Reads /srv/*/.env and talks to systemd's journal, so it runs as root. It
# writes nowhere but its own state directory and makes no outbound request
# except the alert itself.
User=root
Nice=10
UNIT

cat > /etc/systemd/system/webertela-watchdog.timer <<'UNIT'
[Unit]
Description=Ask every minute, because an outage found by a customer is found too late

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
# Without this, every timer on the box fires on the same second forever.
RandomizedDelaySec=10s
AccuracySec=5s

[Install]
WantedBy=timers.target
UNIT

cat > /etc/systemd/system/webertela-backup.service <<'UNIT'
[Unit]
Description=webertela — nightly database backup, off this machine
After=network-online.target postgresql.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/webertela-backup
User=root
Nice=15
IOSchedulingClass=idle
UNIT

cat > /etc/systemd/system/webertela-backup.timer <<'UNIT'
[Unit]
Description=Nightly, at an hour when no restaurant is trading

[Timer]
# 04:10 local. Late enough that a kitchen closing at 02:00 has finished writing,
# early enough to be long done before anyone opens.
OnCalendar=*-*-* 04:10:00
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now webertela-watchdog.timer >/dev/null
systemctl enable --now webertela-backup.timer   >/dev/null
echo "   watchdog: every minute"
echo "   backup:   04:10 nightly"

# ── prove it, rather than claim it ────────────────────────────────────────────
say "running the watchdog once"
/usr/local/bin/webertela-watchdog && echo "   exit 0"

say "asking the backup what it would do (nothing is written)"
/usr/local/bin/webertela-backup --check

say "next runs"
systemctl list-timers 'webertela-*' --no-pager || true

say "done"
echo "   Fill in $ENV_FILE, then test the alert path for real:"
echo "     systemctl stop demo && sleep 150 && systemctl start demo"
echo "   Two minutes of silence then a message means it works. No message means"
echo "   it does not, and better to learn that now than during service."
