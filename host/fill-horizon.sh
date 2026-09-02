#!/usr/bin/env bash
# =====================================================================
# KEEP THE NEXT TWO WEEKS PICKED, EVERY DAY.
# ---------------------------------------------------------------------
# 1 Sept 2026. The founder asked why Friday had no games. It had three —
# Liverpool at Ipswich on USA Network and two Apple TV baseball games —
# and nobody had ever picked them. The schedule card is built from
# ~/gamenight-logs/slate-pick-<DATE>.txt, and the only cron entries that
# had ever written one were two ONE-OFF scripts hard-dated to 28 and 31
# August:
#
#     20 8 28 8 *  pick-friday-28aug.sh
#     20 8 31 8 *  pick-monday-31aug.sh
#
# So exactly seven scattered days had picks and the other seven read "Not
# announced yet" — which the founder reasonably read as "we only do ESPN
# games". host/pick-national.js already does the job properly, against the
# one national-carriage list in host/leagues.js. It had simply never been
# scheduled.
#
# THIS IS CHEAP AFTER THE FIRST RUN. A manifest costs about two minutes
# and is built only when missing, so the steady state is ONE new day per
# night. The picks are re-derived every run, because a fixture that moves
# or a broadcast that changes should change the room.
#
# IT NEVER TOUCHES TODAY'S LIVE SLATE. start-slate.sh owns today at 03:00
# and this runs after it, only ever adding days that have no manifest.
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
LOGDIR="$HOME/gamenight-logs"
DAYS="${DAYS:-14}"
NODE="$HOME/.nvm/versions/node/v20.20.2/bin/node"
say(){ echo "$(date -Iseconds)  $*"; }

say "=== fill-horizon: next $DAYS day(s) ==="
built=0; picked=0
for i in $(seq 0 $((DAYS-1))); do
  D=$(date -d "+$i day" +%F)
  if [ ! -s "$LOGDIR/slate-all-$D.tsv" ]; then
    say "  $D  manifest missing — building"
    DATE="$D" bash host/start-slate.sh --build >/dev/null 2>&1
    [ -s "$LOGDIR/slate-all-$D.tsv" ] && built=$((built+1)) \
      || { say "  $D  BUILD FAILED — skipping, the day stays 'not announced'"; continue; }
  fi
  # Re-picked every run: a moved fixture or a changed broadcast should
  # change the room, and pick-national.js is deterministic for a day.
  if DATE="$D" $NODE host/pick-national.js --apply >/dev/null 2>&1; then
    picked=$((picked+1))
  else
    say "  $D  picker refused (usually: no nationally carried game). Left alone."
  fi
done
say "  built $built manifest(s), picked $picked day(s)"

# One schedule.json for the whole horizon, then publish it.
if $NODE host/build-schedule.js --apply 2>&1 | tail -3; then
  say "  schedule.json rebuilt"
fi
bash host/schedule-push.sh 2>&1 | tail -3
say "=== fill-horizon done ==="
