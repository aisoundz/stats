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

NIGHT_ID="${NIGHT_ID:-gn13-2026-08-19-min-gs}"
ESPN_EVENT="${ESPN_EVENT:-401857157}"
RUN_MINUTES="${RUN_MINUTES:-240}"
export NIGHT_ID ESPN_EVENT RUN_MINUTES

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
