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
#   DATE=2026-08-19 host/start-slate.sh --build          # morning: build + publish
#   host/start-slate.sh                                  # every 30m: start what is due
#   LEAGUES="wnba nfl mlb" host/start-slate.sh --build    # several sports, one day
#
# LEAGUES IS PLURAL ON PURPOSE. From September this box runs basketball and
# football and baseball on the same evening, and they share ONE slate
# document per date — because "which game are you watching?" is a question
# across sports, not within one. build-slate.js merges rather than
# overwrites, so the order these run in does not matter.
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
# ============ BUILDING AND RUNNING ARE TWO DIFFERENT DECISIONS ========
# Founder, 18 Aug: "baseball we can do all games and turn it on when we want
# to. This will not be on till we turn it all the way on."
#
# BUILDING a night is a handful of Firestore writes and costs essentially
# nothing, so build everything that is in season — the schedule docs and the
# banks are then already there, checked, and visible in the picker the day
# somebody decides to switch a league on.
#
# RUNNING a night is a node process, a lease and a feed poll every thirty
# seconds for four hours. That is the thing to be careful with, and it is
# the thing this switch controls.
#
#   LEAGUES     which leagues get schedule docs and banks   (build it all)
#   RUN_LEAGUES which leagues actually get runners          (turn it on)
#   MAX_ROOMS   most rooms to start per league per day      (start small)
#
# A league in LEAGUES but not RUN_LEAGUES is fully built and simply not
# played. Its rooms exist, its questions are published, and switching it on
# is one word in a cron line — not a deploy.
LEAGUES="${LEAGUES:-${LEAGUE:-wnba}}"
RUN_LEAGUES="${RUN_LEAGUES:-$LEAGUES}"
MAX_ROOMS="${MAX_ROOMS:-0}"        # 0 = no cap
RUN_MINUTES="${RUN_MINUTES:-240}"
TICK_MS="${TICK_MS:-30000}"
# 0 = never stand down. While we are testing with real people in the rooms
# this must stay OFF: a room that stood itself down at 5:30 because nobody
# had arrived yet is a room a tester walks into at 5:35 and finds dead —
# the plan published, the doc there, and no host to open a single round.
# Turn it back on (60) when slates run unattended at scale, which is the
# only situation it was ever for.
IDLE_EXIT_MIN="${IDLE_EXIT_MIN:-0}"
LEAD_MIN="${LEAD_MIN:-30}"      # start a room this long before its own tip
KEY="$HOME/.secrets/stats-firebase-admin.json"
LOGDIR="$HOME/gamenight-logs"
mkdir -p "$LOGDIR"

echo "=== slate [$LEAGUES] $DATE  mode=$MODE  ($(date '+%F %T %Z')) ==="

[ -f "$KEY" ] || { echo "FATAL: no service account at $KEY"; exit 1; }
export FIREBASE_SERVICE_ACCOUNT="$(cat "$KEY")"

# ---- 1. build every night that is not already claimed ----------------
ALL="$LOGDIR/slate-all-$DATE.tsv"

if [ "$MODE" = "build" ] || [ "$MODE" = "dry" ]; then
  BUILDFLAG=""; [ "$MODE" = "build" ] && BUILDFLAG="--apply"
  : > "$ALL"
  for LG in $LEAGUES; do
    MANIFEST="$LOGDIR/slate-$LG-$DATE.tsv"
    # A league with no games today is NOT a failure — most leagues are out
    # of season most of the time, and a hard exit there would stop every
    # league listed after it.
    if DATE="$DATE" LEAGUE="$LG" node host/build-slate.js $BUILDFLAG --manifest > "$MANIFEST"; then
      # Tag every manifest row with its league so the start pass can tell
      # which switch applies to it.
      sed "s/^/$LG\t/" "$MANIFEST" >> "$ALL"
      echo "--- $LG: $(wc -l < "$MANIFEST") game(s) built ---"
    else
      echo "--- $LG: nothing to build today ---"
      : > "$MANIFEST"
    fi
  done
  GAMES=$(wc -l < "$ALL")
  echo "--- $GAMES game(s) built in total ---"
  [ "$MODE" = "dry" ] && { echo "dry run — nothing written, nothing started"; cut -f1 "$ALL" | sed 's/^/    /'; exit 0; }

  # Publish each bank now, in the morning, so a failure is found in daylight
  # rather than four minutes before a tip nobody is watching.
  while IFS=$'\t' read -r LG NIGHT_ID ESPN_EVENT HOME_NICK AWAY_NICK TIP SPORT SPATH; do
    [ -n "$NIGHT_ID" ] || continue
    if NIGHT_ID="$NIGHT_ID" HOME_NICK="$HOME_NICK" AWAY_NICK="$AWAY_NICK" \
       ESPN_EVENT="$ESPN_EVENT" SPORT="$SPORT" \
       node host/publish.js --if-missing >> "$LOGDIR/$NIGHT_ID.log" 2>&1; then
      echo "  BANK $NIGHT_ID"
    else
      echo "  FAIL $NIGHT_ID — its bank would not publish (see $LOGDIR/$NIGHT_ID.log)"
    fi
  done < "$ALL"
  echo "--- built; runners start from the half-hourly cron line ---"
  exit 0
fi

# ---- start mode: only what is due ------------------------------------
[ -f "$ALL" ] || { echo "no manifest for $DATE — run --build first"; exit 0; }
GAMES=$(wc -l < "$ALL")
echo "--- $GAMES game(s) in tonight's manifest ---"
[ "$GAMES" -gt 0 ] || exit 0
NOW_EPOCH=$(date +%s)

# COUNT ROOMS THAT ARE ACTUALLY UP, NOT LOCK FILES THAT EXIST.
# `9> file` creates the lock file and it stays on disk forever after the
# runner exits, so counting files would have read one dead room as one live
# one — and after a week of nights the cap would have silently blocked
# every new room while reporting that it was full. A lock is only meaningful
# while something HOLDS it, so ask: flock -n fails exactly when it is held.
# pgrep is not usable here — a pattern matching "run.js" also matches the
# shell running the check, which is how this was miscounted the first time.
# A ROOM, NOT EVERYTHING THAT HOLDS A LOCK. host/watch-start.sh keeps
# watch-$DATE.lock in this same directory and holds it for six and a half
# hours, so the watchdog was being counted as a room: switch the watcher on
# with MAX_ROOMS=2 and the slate silently got ONE room, blaming a cap that
# was never reached. The watcher watches rooms; it is not one.
live_rooms(){
  local n=0 f
  for f in "$LOGDIR"/*.lock; do
    [ -e "$f" ] || continue
    case "$(basename "$f")" in watch-*) continue ;; esac
    if ! flock -n "$f" true 2>/dev/null; then n=$((n+1)); fi
  done
  echo "$n"
}

echo "--- running: [$RUN_LEAGUES]  $(live_rooms) room(s) already up${MAX_ROOMS:+, cap $MAX_ROOMS} ---"
[ "$IDLE_EXIT_MIN" = "0" ] && echo "--- stand-down OFF: rooms stay up for late arrivals ---"
STARTED_COUNT=""   # one char per started room, per league, counted with ${#}
OFFERED_UNHOSTED=""   # rooms the PLAYER is offered that nobody is hosting

# ---- 2. publish a plan and start a runner for each --------------------
while IFS=$'\t' read -r LG NIGHT_ID ESPN_EVENT HOME_NICK AWAY_NICK TIP SPORT SPATH; do
  [ -n "$NIGHT_ID" ] || continue
  LOG="$LOGDIR/$NIGHT_ID.log"

  # BUILT BUT NOT SWITCHED ON — and no longer silent. The room, its
  # questions and its schedule doc all exist, so build-slate has OFFERED it
  # in slate/{date} and the rail on every phone shows it. Nobody is hosting
  # it. A player taps it, joins, and waits all night for a round that has
  # no runner to open it — which looks exactly like a room where nothing
  # has happened yet. That is the same "up and mute" failure as the feed
  # 404, arriving through a different door: this time we built the door.
  #
  # Measured 18 Aug: slate/2026-08-22 already offers 13 rooms while
  # MAX_ROOMS is 2. Eleven of them would be mute.
  case " $RUN_LEAGUES " in
    *" $LG "*) ;;
    *) OFFERED_UNHOSTED="$OFFERED_UNHOSTED$LG "; continue ;;
  esac

  # IS THIS GAME DUE — asked BEFORE the cap, and the order is the point. A
  # room opens LEAD_MIN before its own tip and not before. Charging the cap
  # first meant a game hours away was refused with "CAP" and the slot it
  # was refused for belonged to a room that had not started either. On a
  # Saturday where preseason football runs at midday and the WNBA tips in
  # the evening, that is how the only league that has ever run a real night
  # gets zero rooms.
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

  # Start small, and only DUE games spend the cap — see the note above the
  # due check. A room skipped for the cap is SAID OUT LOUD: a silent
  # truncation reads as "we covered everything" when we did not.
  if [ "$MAX_ROOMS" -gt 0 ]; then
    RUNNING=$(live_rooms)
    if [ "$RUNNING" -ge "$MAX_ROOMS" ]; then
      echo "  CAP  $NIGHT_ID — $RUNNING room(s) already up, cap is $MAX_ROOMS"
      continue
    fi
  fi

  # A MANIFEST WITHOUT A FEED PATH CANNOT HOST A ROOM. `basketball` is a
  # family and `basketball/wnba` is a path; handing the runner the family
  # 404s every fetch, and run.js answers a 404 by logging once and sleeping
  # — so the room stays published and NO ROUND EVER OPENS, for four hours,
  # in silence. A manifest built before this column existed has an empty
  # $SPATH, and defaulting it back to the family would quietly recreate
  # exactly that. Refuse the room and say why: a skipped room that names
  # its reason is worth ten rooms that are up and mute.
  if [ -z "$SPATH" ]; then
    echo "  SKIP $NIGHT_ID — no feed path in the manifest (built before the path column). Re-run --build."
    continue
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
    NIGHT_ID="$NIGHT_ID" ESPN_EVENT="$ESPN_EVENT" SPORT_PATH="$SPATH" TIP_ISO="$TIP" \
    RUN_MINUTES="$RUN_MINUTES" TICK_MS="$TICK_MS" IDLE_EXIT_MIN="$IDLE_EXIT_MIN" \
    FIREBASE_SERVICE_ACCOUNT="$FIREBASE_SERVICE_ACCOUNT" \
    nohup node host/run.js >> "$LOG" 2>&1 &
    echo "  RUN  $NIGHT_ID  pid $!  tick ${TICK_MS}ms  stands down after ${IDLE_EXIT_MIN}m empty  → $LOG"
    # Hold the lock for the runner's lifetime.
    wait $!
  ) 9> "$LOGDIR/$NIGHT_ID.lock" &

  sleep 2   # stagger, so N runners do not all hit the feed on the same second
done < "$ALL"

# ---- 3. WHAT THE PLAYER IS OFFERED vs WHAT WE ARE HOSTING ------------
# The rail is built from slate/{date}, which carries every game that was
# BUILT. The runners come from RUN_LEAGUES and MAX_ROOMS. When those two
# numbers disagree, the difference is rooms a person can walk into and sit
# in all night. Nothing else in this system compares them, so it is said
# here, every run, out loud.
OFFERED=$(wc -l < "$ALL" 2>/dev/null || echo 0)
HOSTABLE=0
while IFS=$'\t' read -r LG _rest; do
  [ -n "$LG" ] || continue
  case " $RUN_LEAGUES " in *" $LG "*) HOSTABLE=$((HOSTABLE+1)) ;; esac
done < "$ALL"
echo "--- offered on the rail: $OFFERED   ·   in a hosted league: $HOSTABLE   ·   cap: ${MAX_ROOMS:-none} ---"
if [ "$OFFERED" -gt "$HOSTABLE" ]; then
  echo "!!! $((OFFERED - HOSTABLE)) room(s) are OFFERED TO PLAYERS AND HOSTED BY NOBODY."
  echo "!!! leagues built but not run:$(printf '%s' " $OFFERED_UNHOSTED" | tr -s ' ')"
  echo "!!! build only what you host (LEAGUES == RUN_LEAGUES), or a player taps one of these"
  echo "!!! and waits all night for a round nothing will open."
fi

echo "--- slate started; flagship (if any) runs from its own cron line ---"
