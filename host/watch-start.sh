#!/usr/bin/env bash
# Start the night watcher and leave it running through both games.
# Written for GN13 — the first night with more than one room — and useful
# every night after. Read-only: it samples rooms, it never writes to one.
export PATH="/home/higherthan7/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/home/higherthan7"
cd "$HOME/stats" || exit 1
KEY="$HOME/.secrets/stats-firebase-admin.json"
[ -f "$KEY" ] || { echo "no service account at $KEY"; exit 1; }
export FIREBASE_SERVICE_ACCOUNT="$(cat "$KEY")"
DATE="${DATE:-$(date +%F)}"
MINUTES="${MINUTES:-390}"           # ~6.5h: covers a 4:30 tip through a 7:00 game
LOG="$HOME/gamenight-logs/watch-$DATE.log"
mkdir -p "$HOME/gamenight-logs"
# One watcher a night. flock makes a second start impossible.
(
  flock -n 9 || { echo "a watcher is already running for $DATE"; exit 0; }
  echo "=== watcher up $(date '+%F %T %Z') · $DATE · ${MINUTES}m ===" >> "$LOG"
  timeout $((MINUTES*60)) node host/watch-night.js --date "$DATE" --every 60 >> "$LOG" 2>&1
  echo "=== watcher down $(date '+%F %T %Z') ===" >> "$LOG"
) 9> "$HOME/gamenight-logs/watch-$DATE.lock" &
echo "watcher started · $LOG"
