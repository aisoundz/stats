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

# --- publish the plan if nobody has ----------------------------------
# host/run.js refuses to start without it, and that refusal is the feature.
# publish.js reads the bank out of admin.html rather than carrying its own
# copy, and it will NOT overwrite a plan the Control Room already wrote —
# that one may contain host edits living in a browser's localStorage that
# nothing here can see. So: publish only into silence.
export FIREBASE_SERVICE_ACCOUNT="$(cat "$KEY")"
export NIGHT_ID ESPN_EVENT RUN_MINUTES
if [ "${SKIP_PUBLISH:-0}" != "1" ]; then
  echo "--- plan ---"
  node host/publish.js 2>&1 | tail -8 || {
    echo
    echo "Publish did not succeed. If it says a plan already exists, that is fine —"
    echo "the Control Room's version wins. Re-run with SKIP_PUBLISH=1 to go anyway."
    exit 1
  }
  echo
fi

LOG="$LOGDIR/$NIGHT_ID.log"
echo "night   : $NIGHT_ID"
echo "event   : $ESPN_EVENT"
echo "minutes : $RUN_MINUTES"
echo "log     : $LOG"
echo

# --- launch, detached so an SSH drop cannot kill it -------------------
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
