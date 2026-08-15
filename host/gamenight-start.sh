#!/usr/bin/env bash
# STATS GAMETIME — Layer 3 runner launcher (Jetson)
#
# Start this at ~T-45 (7:15 PM ET). It bakes in tonight's values so nothing
# gets mistyped under time pressure, and it enforces the one invariant that
# matters: never two runners against the same night.
#
# Usage:  ./gamenight-start.sh
# Watch:  tail -f ~/gamenight-logs/<nightId>.log
# Stop:   kill $(cat ~/gamenight-logs/runner.pid)

set -euo pipefail

NIGHT_ID="${NIGHT_ID:-gn10-2026-08-15-min-lv}"
ESPN_EVENT="${ESPN_EVENT:-401857147}"
RUN_MINUTES="${RUN_MINUTES:-240}"

KEY="$HOME/.secrets/stats-firebase-admin.json"
REPO="${STATS_REPO:-$HOME/stats}"
LOGDIR="$HOME/gamenight-logs"
PIDFILE="$LOGDIR/runner.pid"

mkdir -p "$LOGDIR"

# --- invariant: exactly one runner ------------------------------------
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "REFUSING TO START: a runner is already live (pid $(cat "$PIDFILE"))."
  echo "Two runners against one night race on AUTO.tally and post conflicting keys."
  echo "Kill it first:  kill \$(cat $PIDFILE)"
  exit 1
fi
rm -f "$PIDFILE"

# --- preconditions ----------------------------------------------------
[ -f "$KEY" ] || { echo "FATAL: service account key not found at $KEY"; exit 1; }
python3 -c "import json,sys; json.load(open('$KEY'))" 2>/dev/null \
  || { echo "FATAL: $KEY is not valid JSON"; exit 1; }

cd "$REPO"
node -e "require('firebase-admin')" || { echo "FATAL: firebase-admin will not load"; exit 1; }

LOG="$LOGDIR/$NIGHT_ID.log"
echo "night   : $NIGHT_ID"
echo "event   : $ESPN_EVENT"
echo "minutes : $RUN_MINUTES"
echo "log     : $LOG"
echo

# --- launch, detached so an SSH drop cannot kill it -------------------
export FIREBASE_SERVICE_ACCOUNT="$(cat "$KEY")"
export NIGHT_ID ESPN_EVENT RUN_MINUTES

setsid nohup node host/run.js >> "$LOG" 2>&1 < /dev/null &
echo $! > "$PIDFILE"

sleep 4
echo "--- first seconds of log ---"
cat "$LOG"
echo "---"
if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "RUNNER LIVE (pid $(cat "$PIDFILE")). Watch it:  tail -f $LOG"
else
  echo "RUNNER DIED ON STARTUP — read the log above."
  rm -f "$PIDFILE"
  exit 1
fi
