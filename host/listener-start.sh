#!/usr/bin/env bash
# ============ WATCH THE CEILING, EVERY NIGHT, WITHOUT BEING ASKED ======
# GN13 died on a listener concurrency ceiling at 21% of the read tier. The
# watcher that would have seen it coming existed, but it was started BY
# HAND, and on 19 Aug nobody started it. On 20 Aug it was scheduled as a
# one-off crontab line naming that one date — which is the same disease
# the Control Room had: a fact about "every night" written down as a fact
# about one night, needing a human to re-type it before the next one.
#
# This is the launcher that makes it a standing habit. It takes its date
# from the clock, holds a per-day flock so a second start is impossible,
# and bounds itself with `timeout` so a wedged watcher cannot outlive the
# night and start sampling into tomorrow.
#
# Read-only. It samples rooms and the Cloud Monitoring listener metric; it
# never writes to a room.
export PATH="/home/higherthan7/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/home/higherthan7"
cd "$HOME/stats" || exit 1

KEY="$HOME/.secrets/stats-firebase-admin.json"
[ -f "$KEY" ] || { echo "no service account at $KEY"; exit 1; }

DATE="$(TZ=America/Los_Angeles date +%F)"
UNTIL="${UNTIL:-23:30}"
EVERY="${EVERY:-300}"
while [ $# -gt 0 ]; do
  case "$1" in
    --every) EVERY="${2:-300}"; shift 2 ;;
    --every=*) EVERY="${1#*=}"; shift ;;
    --until) UNTIL="${2:-23:30}"; shift 2 ;;
    --until=*) UNTIL="${1#*=}"; shift ;;
    *) shift ;;
  esac
done
case "$EVERY" in ''|*[!0-9]*) EVERY=300 ;; esac

LOG="$HOME/gamenight-logs/listeners-$DATE.log"
mkdir -p "$HOME/gamenight-logs"

# Hard stop at the UNTIL time plus a few minutes, so the process cannot
# outlive the night even if its own clock check never fires.
NOW_S=$(date +%s)
END_S=$(date -d "today $UNTIL" +%s 2>/dev/null || echo $((NOW_S + 30600)))
[ "$END_S" -le "$NOW_S" ] && END_S=$((NOW_S + 600))
BUDGET=$(( END_S - NOW_S + 300 ))

(
  flock -n 9 || { echo "a listener watch is already running for $DATE"; exit 0; }
  timeout "$BUDGET" node host/listener-watch.js --until "$UNTIL" --every "$EVERY" >> "$LOG" 2>&1
  echo "=== listener watch down $(TZ=America/Los_Angeles date '+%F %T %Z') ===" >> "$LOG"
) 9> "$HOME/gamenight-logs/listeners-$DATE.lock" &
echo "listener watch started · $LOG · every ${EVERY}s until $UNTIL"
