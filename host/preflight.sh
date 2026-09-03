#!/usr/bin/env bash
# Wraps host/preflight.js for cron: supplies the service account the same
# way start-slate.sh does, and SAYS SO LOUDLY on a NO-GO. A preflight that
# only writes to a log is the green workflow problem again — nothing
# watches it. Non-zero exit is the signal; the log is the detail.
set -u
# CRON DOES NOT GIVE YOU A LOGIN SHELL. Under `env -i` this file died on
# "HOME: unbound variable" and still exited 0 — a preflight that silently
# does nothing is worse than none, because its silence reads as GO.
# Found by testing with env -i rather than by running it from a terminal
# that had everything already set.
: "${HOME:=/home/higherthan7}"
export HOME
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin"
KEY="$HOME/.secrets/stats-firebase-admin.json"
LOG="$HOME/gamenight-logs/preflight.log"
[ -f "$KEY" ] || { echo "FATAL: no service account at $KEY" | tee -a "$LOG"; exit 1; }
export FIREBASE_SERVICE_ACCOUNT="$(cat "$KEY")"
NODE="$HOME/.nvm/versions/node/v20.20.2/bin/node"
[ -x "$NODE" ] || NODE="$(command -v node)"
OUT="$("$NODE" "$HOME/stats/host/preflight.js" "$@" 2>&1)"; RC=$?
{ echo "=== preflight $(date '+%F %T %Z') rc=$RC ==="; echo "$OUT"; } >> "$LOG"
if [ "$RC" -ne 0 ]; then
  echo "$OUT" | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^──|FAIL|NO-GO"
fi
exit $RC
