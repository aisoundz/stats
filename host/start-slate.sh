#!/usr/bin/env bash
# =====================================================================
# START EVERY GAME ON THE SLATE.
# ---------------------------------------------------------------------
# gamenight-start.sh starts ONE room, the flagship, the one with the email
# behind it. This starts all the others: it builds a night for every game
# the league is playing, publishes each a bank from the template, and puts
# a runner on each one.
#
# It never touches the flagship. build-slate.js refuses to build a game
# that a hand-written night in admin.html already claims, so the flagship
# is started by its own cron line, at its own time, exactly as before.
#
# THE NEVER-TWO-RUNNERS INVARIANT. run.js holds a lease per night, so two
# runners on one room is already survivable — but survivable is not the
# same as intended, and two node processes fighting over a lease is a
# confusing thing to debug at tip-off. flock makes it impossible per night.
#
# TWO MODES, BECAUSE A SLATE IS NOT ONE MOMENT.
#
#   --build   Build every night for the date and publish its bank. Run once,
#             in the morning. Cheap: a handful of writes.
#   (default) Start runners for games tipping SOON, and only those. Run
#             every half hour from cron. flock makes a second start of the
#             same room impossible, so running it too often is free.
#
# WHY NOT START EVERYTHING AT ONCE. Games on a slate tip hours apart. A
# four o'clock start for a ten o'clock game is six hours of a process, a
# lease and a feed poll for a game that has not begun.
#
#   DATE=2026-08-19 host/start-slate.sh --build      # morning: build + publish
#   host/start-slate.sh                              # every 30m: start what is due
#   LEAGUE=mlb host/start-slate.sh --build           # sport two
#
# COST. Slate rooms tick at 30s rather than 20s, start 30 minutes before
# their own tip, and stand down if nobody has joined in the 60 minutes
# AFTER tip. An empty room that runs four hours costs the same as a full
# one, and most slate rooms in beta will be empty.
# =====================================================================
export PATH="/home/higherthan7/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/home/higherthan7"
cd "$HOME/stats" || exit 1

MODE="start"
[ "$1" = "--build" ] && MODE="build"
[ "$1" = "--dry" ]   && MODE="dry"

DATE="${DATE:-$(date +%F)}"
LEAGUE="${LEAGUE:-wnba}"
RUN_MINUTES="${RUN_MINUTES:-240}"
TICK_MS="${TICK_MS:-30000}"
IDLE_EXIT_MIN="${IDLE_EXIT_MIN:-60}"
LEAD_MIN="${LEAD_MIN:-30}"      # start a room this long before its own tip
KEY="$HOME/.secrets/stats-firebase-admin.json"
LOGDIR="$HOME/gamenight-logs"
mkdir -p "$LOGDIR"

echo "=== slate $LEAGUE $DATE  mode=$MODE  ($(date '+%F %T %Z')) ==="

[ -f "$KEY" ] || { echo "FATAL: no service account at $KEY"; exit 1; }
export FIREBASE_SERVICE_ACCOUNT="$(cat "$KEY")"

# ---- 1. build every night that is not already claimed ----------------
MANIFEST="$LOGDIR/slate-$LEAGUE-$DATE.tsv"

if [ "$MODE" = "build" ] || [ "$MODE" = "dry" ]; then
  BUILDFLAG=""; [ "$MODE" = "build" ] && BUILDFLAG="--apply"
  if ! DATE="$DATE" LEAGUE="$LEAGUE" node host/build-slate.js $BUILDFLAG --manifest > "$MANIFEST"; then
    echo "FATAL: build-slate failed"; exit 1
  fi
  GAMES=$(wc -l < "$MANIFEST")
  echo "--- $GAMES game(s) built into the manifest ---"
  [ "$MODE" = "dry" ] && { echo "dry run — nothing written, nothing started"; cut -f1 "$MANIFEST" | sed 's/^/    /'; exit 0; }

  # Publish each bank now, in the morning, so a failure is found in daylight
  # rather than four minutes before a tip nobody is watching.
  while IFS=$'\t' read -r NIGHT_ID ESPN_EVENT HOME_NICK AWAY_NICK TIP SPORT; do
    [ -n "$NIGHT_ID" ] || continue
    if NIGHT_ID="$NIGHT_ID" HOME_NICK="$HOME_NICK" AWAY_NICK="$AWAY_NICK" \
       ESPN_EVENT="$ESPN_EVENT" SPORT="$SPORT" \
       node host/publish.js --if-missing >> "$LOGDIR/$NIGHT_ID.log" 2>&1; then
      echo "  BANK $NIGHT_ID"
    else
      echo "  FAIL $NIGHT_ID — its bank would not publish (see $LOGDIR/$NIGHT_ID.log)"
    fi
  done < "$MANIFEST"
  echo "--- built; runners start from the half-hourly cron line ---"
  exit 0
fi

# ---- start mode: only what is due ------------------------------------
[ -f "$MANIFEST" ] || { echo "no manifest for $DATE — run --build first"; exit 0; }
GAMES=$(wc -l < "$MANIFEST")
echo "--- $GAMES game(s) in tonight's manifest ---"
[ "$GAMES" -gt 0 ] || exit 0
NOW_EPOCH=$(date +%s)

# ---- 2. publish a plan and start a runner for each --------------------
while IFS=$'\t' read -r NIGHT_ID ESPN_EVENT HOME_NICK AWAY_NICK TIP SPORT; do
  [ -n "$NIGHT_ID" ] || continue
  LOG="$LOGDIR/$NIGHT_ID.log"

  # Is this game due? A room opens LEAD_MIN before its own tip and not before.
  TIP_EPOCH=$(date -d "$TIP" +%s 2>/dev/null || echo 0)
  if [ "$TIP_EPOCH" -gt 0 ]; then
    DUE=$(( TIP_EPOCH - LEAD_MIN * 60 ))
    if [ "$NOW_EPOCH" -lt "$DUE" ]; then
      MINS=$(( (DUE - NOW_EPOCH) / 60 ))
      echo "  WAIT $NIGHT_ID — due in ${MINS}m (tip $TIP)"
      continue
    fi
    # A game whose window has long closed is not started at all.
    if [ "$NOW_EPOCH" -gt $(( TIP_EPOCH + RUN_MINUTES * 60 )) ]; then
      echo "  PAST $NIGHT_ID — its window closed"
      continue
    fi
  fi

  # --if-missing: a plan somebody already published outranks the template.
  if ! NIGHT_ID="$NIGHT_ID" HOME_NICK="$HOME_NICK" AWAY_NICK="$AWAY_NICK" \
       ESPN_EVENT="$ESPN_EVENT" SPORT="$SPORT" \
       node host/publish.js --if-missing >> "$LOG" 2>&1; then
    echo "  SKIP $NIGHT_ID — its plan would not publish (see $LOG)"
    continue
  fi

  # One runner per night, enforced by the filesystem rather than by memory.
  (
    flock -n 9 || { echo "  SKIP $NIGHT_ID — a runner already holds its lock"; exit 0; }
    NIGHT_ID="$NIGHT_ID" ESPN_EVENT="$ESPN_EVENT" SPORT_PATH="$SPORT" TIP_ISO="$TIP" \
    RUN_MINUTES="$RUN_MINUTES" TICK_MS="$TICK_MS" IDLE_EXIT_MIN="$IDLE_EXIT_MIN" \
    FIREBASE_SERVICE_ACCOUNT="$FIREBASE_SERVICE_ACCOUNT" \
    nohup node host/run.js >> "$LOG" 2>&1 &
    echo "  RUN  $NIGHT_ID  pid $!  tick ${TICK_MS}ms  stands down after ${IDLE_EXIT_MIN}m empty  → $LOG"
    # Hold the lock for the runner's lifetime.
    wait $!
  ) 9> "$LOGDIR/$NIGHT_ID.lock" &

  sleep 2   # stagger, so N runners do not all hit the feed on the same second
done < "$MANIFEST"

echo "--- slate started; flagship (if any) runs from its own cron line ---"
