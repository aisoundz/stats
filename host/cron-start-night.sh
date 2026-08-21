#!/usr/bin/env bash
# Start a game night from cron.
#
# WHY THIS WRAPPER EXISTS AND ISN'T JUST A CRONTAB LINE POINTING AT
# gamenight-start.sh: node is installed under nvm
# (~/.nvm/versions/node/vXX/bin/node), which is NOT on cron's PATH. A job
# that runs perfectly by hand does nothing at all at 4pm, silently, and the
# first sign is a room with no questions in it. PATH is set explicitly here
# and every run is logged, so "did it fire?" is answerable after the fact.

export PATH="/home/higherthan7/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/home/higherthan7"

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
export NIGHT_ID ESPN_EVENT RUN_MINUTES SPORT_PATH

LOG="$HOME/gamenight-logs/cron.log"
mkdir -p "$HOME/gamenight-logs"

{
  echo "======================================================"
  echo "cron fired at $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "night=$NIGHT_ID event=$ESPN_EVENT minutes=$RUN_MINUTES"
  echo "node: $(command -v node || echo 'NOT FOUND — this is the bug this wrapper exists to prevent')"
  echo "------------------------------------------------------"
  "$HOME/stats/host/gamenight-start.sh"
  echo "gamenight-start.sh exited $?"
} >> "$LOG" 2>&1
