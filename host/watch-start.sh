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
# HOW OFTEN IT SAMPLES, AND WHY IT IS NOT 60 ANY MORE.
# On 19 Aug this ran at --every 60 across four rooms and cost roughly as
# much as a whole runner — about 37 Firestore reads a minute — for one line
# of log. Five minutes still catches a stopped runner well inside the window
# where somebody can act on it, at a fifth of the cost.
# The cron line asked for --every 300 and this script ignored it: the value
# was hard-coded on the node line below, so the flag was decoration. Now it
# is read, with EVERY= as an env override too.
EVERY=300
while [ $# -gt 0 ]; do
  case "$1" in
    --every) EVERY="${2:-300}"; shift 2 ;;
    --every=*) EVERY="${1#*=}"; shift ;;
    *) shift ;;
  esac
done
EVERY="${WATCH_EVERY:-$EVERY}"
case "$EVERY" in ''|*[!0-9]*) EVERY=300 ;; esac
LOG="$HOME/gamenight-logs/watch-$DATE.log"
mkdir -p "$HOME/gamenight-logs"
# One watcher a night. flock makes a second start impossible.
(
  flock -n 9 || { echo "a watcher is already running for $DATE"; exit 0; }
  echo "=== watcher up $(date '+%F %T %Z') · $DATE · ${MINUTES}m · every ${EVERY}s ===" >> "$LOG"
  timeout $((MINUTES*60)) node host/watch-night.js --date "$DATE" --every "$EVERY" >> "$LOG" 2>&1
  echo "=== watcher down $(date '+%F %T %Z') ===" >> "$LOG"
) 9> "$HOME/gamenight-logs/watch-$DATE.lock" &
echo "watcher started · $LOG"
