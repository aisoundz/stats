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

# ============ NO DEFAULTS. THIS IS THE BROKEN-GLASS LAUNCHER =========
# These two lines used to read:
#     NIGHT_ID="${NIGHT_ID:-gn13-2026-08-19-min-gs}"
#     ESPN_EVENT="${ESPN_EVENT:-401857157}"
# and neither script set SPORT_PATH at all, so host/run.js fell back to its
# own default of basketball/wnba.
#
# This is the script somebody reaches for when a night is ALREADY going
# wrong, at 6pm, in a hurry. Run it bare and it would have quietly started
# a runner on a WNBA game from Wednesday 19 August — or, worse, tonight's
# baseball room against a basketball feed, which 404s and then sits up and
# mute for four hours saying nothing.
#
# A default that is a specific past game is not a default, it is a trap.
# Refuse, and say exactly where to find the right values.
_missing=""
[ -n "$NIGHT_ID" ]   || _missing="$_missing NIGHT_ID"
[ -n "$ESPN_EVENT" ] || _missing="$_missing ESPN_EVENT"
[ -n "$SPORT_PATH" ] || _missing="$_missing SPORT_PATH"
if [ -n "$_missing" ]; then
  echo "refusing to start — missing:$_missing" >&2
  echo "" >&2
  echo "  Tonight's rooms, with all three values, are in the pick file:" >&2
  echo "    cat ~/gamenight-logs/slate-pick-$(date +%F).txt" >&2
  echo "" >&2
  echo "  Or read them straight off the slate:" >&2
  echo "    node -e 'require(\"firebase-admin/app\")' # see host/SETUP.md" >&2
  echo "" >&2
  echo "  Example:" >&2
  echo "    NIGHT_ID=slate-$(date +%F)-nyj-pit ESPN_EVENT=401873288 \\" >&2
  echo "    SPORT_PATH=football/nfl $0" >&2
  echo "" >&2
  echo "  Normally you do not need this script at all: start-slate.sh runs" >&2
  echo "  every ten minutes and opens each room 30 minutes before its tip." >&2
  exit 2
fi
export SPORT_PATH
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
export NIGHT_ID ESPN_EVENT RUN_MINUTES SPORT_PATH
if [ "${SKIP_PUBLISH:-0}" != "1" ]; then
  echo "--- plan ---"
  # --if-missing: a plan that already exists is a SUCCESS here, not a failure.
  # Publishing early (to rehearse this exact command with hours to spare) must
  # not be the reason the night refuses to start.
  node host/publish.js --if-missing 2>&1 | tail -8 || {
    echo
    echo "Publish failed for a real reason — read the message above."
    echo "SKIP_PUBLISH=1 starts the runner anyway, but only if a plan already exists."
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
