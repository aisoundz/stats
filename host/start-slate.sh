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
#   MAX_ROOMS   most rooms live AT ONCE, across all leagues  (start small)
#
# A league in LEAGUES but not RUN_LEAGUES is fully built, kept OFF the
# player's rail (see build-slate.js), and simply not
# played. Its rooms exist, its questions are published, and switching it on
# is one word in a cron line — not a deploy.
# ONE DEFINITION, SOURCED BEFORE THE DEFAULTS. host/leagues.env holds which
# leagues are built and which are hosted, so the two cron lines cannot
# disagree with each other any more — see that file for what went wrong.
# The environment still wins: values already set are left alone, so a hand
# run or a one-off cron override behaves exactly as it did.
if [ -f "$(dirname "$0")/leagues.env" ]; then
  _ENV_LEAGUES="$LEAGUES"; _ENV_RUN="$RUN_LEAGUES"; _ENV_CAP="$MAX_ROOMS"
  . "$(dirname "$0")/leagues.env"
  [ -n "$_ENV_LEAGUES" ] && LEAGUES="$_ENV_LEAGUES"
  [ -n "$_ENV_RUN" ]     && RUN_LEAGUES="$_ENV_RUN"
  [ -n "$_ENV_CAP" ]     && MAX_ROOMS="$_ENV_CAP"
fi
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
    # RUN_LEAGUES GOES TO THE BUILDER TOO, and this is the fix for the
    # warning this script has been printing at the bottom of every run:
    # a league that is built but not run must still get its schedule docs
    # (the backtest reads them) and must NOT go on the player's rail. The
    # builder needs to know which leagues are hosted to make that split,
    # and there must be exactly one answer to that question.
    if DATE="$DATE" LEAGUE="$LG" RUN_LEAGUES="$RUN_LEAGUES" node host/build-slate.js $BUILDFLAG --manifest > "$MANIFEST"; then
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
  # ---- 3. AND EVERY DAY GETS A GAME OF THE NIGHT -----------------------
  # Founder, 19 Aug: "I love how we have a game of the night and we number
  # it. Please dont stop that — lets pick a main game for everyday."
  #
  # It used to require a hand-written night in admin.html, so it only
  # happened on days somebody typed one, and Thursday had none. This runs at
  # the end of every morning build and picks from the day's REAL slate using
  # his rule in his order — national television first, then SoCal, then the
  # hour it starts. One per league, best overall is the Game of the Night.
  #
  # --auto leaves a hand-written marquee file alone; it only ever fills a
  # gap. It runs LAST because it needs every league already built, and it
  # re-stamps slate/{DATE} because the loop above rewrote those entries from
  # the ESPN probe — a marquee that lives only in a file appears for one day
  # and then quietly stops.
  if node host/marquee.js "$DATE" --apply --auto --quiet; then :; else
    echo "  (no marquee set for $DATE — see above; the night still runs)"
  fi

  echo "--- built; runners start from the half-hourly cron line ---"
  exit 0
fi

# ---- start mode: only what is due ------------------------------------
# SELF-HEAL, BECAUSE A MISSED BUILD USED TO COST A WHOLE DAY IN SILENCE.
# 18 Aug: the morning build cron was installed after its own 8:10 slot, so no
# manifest existed. This line then printed "run --build first" and exited 0 —
# twenty times, every half hour from 13:00 to 22:30, while four WNBA games and
# fifteen MLB games went by with no room for any of them. Nothing was broken;
# nothing tried. A starter that finds no manifest must BUILD one, not narrate
# its absence. The flock makes the half-hourly cron safe against itself: a
# build takes minutes, the ticks are 30 apart, but a slow feed must not start
# a second builder on top of the first.
if [ ! -f "$ALL" ]; then
  echo "no manifest for $DATE — building one now (self-heal)"
  if flock -n 8; then
    LEAGUES="$LEAGUES" "$0" --build || echo "  self-heal build failed; see above"
  else
    echo "  another build is already running; skipping this tick"
    exit 0
  fi 8>"$LOGDIR/heal-$DATE.lock"
fi
[ -f "$ALL" ] || { echo "still no manifest for $DATE after the self-heal — giving up this tick"; exit 0; }
GAMES=$(wc -l < "$ALL")
echo "--- $GAMES game(s) in tonight's manifest ---"
[ "$GAMES" -gt 0 ] || exit 0
NOW_EPOCH=$(date +%s)

# ============ THE PICK FILE HAS TO GOVERN WHAT STARTS, NOT ONLY =======
# ============ WHAT IS OFFERED ========================================
# MEASURED 19 Aug, four hours before a game night, and it would have taken
# the night down in silence.
#
# host/pick-slate.sh does two things: it TRIMS this manifest to the rooms
# somebody named, and it writes slate-pick-{DATE}.txt as the durable record.
# build-slate.js reads that file, so the RAIL survives the 08:10 rebuild.
# The manifest does not: `: > "$ALL"` at the top of build mode rewrites it
# from scratch, every league, every game. So after 08:10 the pick governed
# the rail and NOTHING governed the starter.
#
# Tonight that meant: the rail offered tor-wsh, lafc-col and sj-la, and at
# 16:00 PT eight rooms went due in the same minute. The first three in
# manifest order — a WNBA game and two MLS matches nobody had picked —
# would have taken all three slots, and LAFC (18:00) and SJ @ LA (19:00),
# the two rooms the whole evening was built around, would have been refused
# with CAP and never opened a round. Two rooms hosted that are not on the
# rail, and two rooms on the rail that are not hosted, both at once.
#
# So the pick file is read HERE too, and it wins over RUN_LEAGUES exactly as
# it does in build-slate.js — one fact, read the same way by both halves.
PICKFILE="$LOGDIR/slate-pick-$DATE.txt"
PICKED=""
if [ -s "$PICKFILE" ]; then
  PICKED="$(tr -d '\r' < "$PICKFILE" | grep . || true)"
fi
if [ -n "$PICKED" ]; then
  NPICK=$(printf '%s\n' "$PICKED" | grep -c .)
  echo "--- pick file: $NPICK room(s) hand-picked for $DATE — nothing else is started ---"
  # A PICK THAT MATCHES NOTHING IS A NIGHT WITH NO ROOMS, and the failure
  # is silent otherwise: every line reads "not picked" and the slate simply
  # never starts. It happens for one boring reason — a game moved or was
  # postponed, so the id built this morning is not the id in the file.
  HITS=0
  while IFS=$'\t' read -r _lg NID _rest; do
    [ -n "$NID" ] || continue
    printf '%s\n' "$PICKED" | grep -qxF "$NID" && HITS=$((HITS+1))
  done < "$ALL"
  if [ "$HITS" -eq 0 ]; then
    echo "!!! THE PICK FILE MATCHES NO ROOM IN TODAY'S MANIFEST."
    echo "!!! $PICKFILE names ids that were not built today — a game probably moved."
    echo "!!! NOTHING WILL START. Fix the ids or delete the file to fall back to RUN_LEAGUES."
  elif [ "$HITS" -lt "$NPICK" ]; then
    echo "!!! only $HITS of $NPICK picked room(s) exist in today's manifest — check $PICKFILE"
  fi
fi

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
# AND THE EXCLUSION LIST WAS THE WRONG SHAPE. It named `watch-*` — the one
# non-room lock that had already caused this — and let every future one
# through. MEASURED 19 Aug: host/snapshot.js holds snapshot.lock for the
# whole MLS match day (started 10:00, still held at 11:37), so it was being
# counted as a room and MAX_ROOMS=3 was really 2. SJ @ LA, the last room of
# the night to come due, would have been refused with CAP by a half-time
# box-score collector.
#
# So the test is POSITIVE now: a room lock is named after a nightId, and a
# nightId begins `slate-` or `gn`. Anything else in this directory is not a
# room, whatever it is called and whenever somebody adds it.
live_rooms(){
  local n=0 f b
  for f in "$LOGDIR"/*.lock; do
    [ -e "$f" ] || continue
    b="$(basename "$f" .lock)"
    case "$b" in slate-*|gn*) ;; *) continue ;; esac
    if ! flock -n "$f" true 2>/dev/null; then n=$((n+1)); fi
  done
  echo "$n"
}

# ============ THE REAL GATE IS LISTENERS, NOT A ROOM COUNT ============
# Reversed 24 Aug. MAX_ROOMS used to be the thing that decided how many
# rooms could run — a number a person picked and then had to remember to
# raise by hand every time the business grew (2 -> 3 -> 4, and the next
# raise would have been someone editing leagues.env again). But the only
# night this project has ever lost — 19 Aug, GN13 — was never a room-count
# problem. It was CONCURRENT SNAPSHOT LISTENERS crossing ~78, and that
# number does not know or care how many rooms produced it.
#
# So: ask for the real number before starting each room, and refuse only
# if it is already at/above 55 — the SAME alert threshold host/listeners.js
# prints and host/read-alert.js pages on. Growth is automatic from here —
# a 5th, 6th, 10th room is fine for as long as real usage says it's fine,
# and MAX_ROOMS (now 0 by default — see leagues.env) stays only as a
# manual override for a night somebody wants a hard room-count ceiling
# regardless of listener headroom.
#
# Read ONCE per pass, not once per candidate room — the API's own
# aggregation window is 5 minutes, so asking it three times in the same
# ten-minute tick buys nothing but latency. FAILS OPEN: if the read
# errors or times out, that is said out loud and rooms start anyway — a
# monitoring call that can silently cancel a real game night on its own
# hiccup would be a worse failure than the thing it exists to prevent,
# and the read-alert email still watches independently of this check.
LISTEN_ALERT=55
LISTEN_NOW="$(timeout 15 node host/listeners.js --now 2>/dev/null)"
case "$LISTEN_NOW" in
  ''|*[!0-9]*)
    echo "--- listeners: could not read the live count — the listener gate is BLIND this pass, starting rooms anyway (read-alert email still watches) ---"
    LISTEN_NOW=""
    ;;
  *) : ;;
esac

echo "--- running: [$RUN_LEAGUES]  $(live_rooms) room(s) already up${LISTEN_NOW:+, $LISTEN_NOW listener(s) now (alert at $LISTEN_ALERT)}${MAX_ROOMS:+, room-count override $MAX_ROOMS} ---"
[ "$IDLE_EXIT_MIN" = "0" ] && echo "--- stand-down OFF: rooms stay up for late arrivals ---"
STARTED_COUNT=""   # one char per started room, per league, counted with ${#}
OFFERED_UNHOSTED=""   # rooms the PLAYER is offered that nobody is hosting
NOT_PICKED=0          # rooms in the manifest that the pick file leaves out

# ============ THE FEATURED GAME NEVER LOSES ITS SLOT ==================
# MAX_ROOMS is a global cap and this loop walks the manifest in order, so
# whichever rooms come due first spend it. That is fine for an ordinary room
# and wrong for the Game of the Night: it is the one with the email behind
# it, it is starred on every phone, and it must never be the room that gets
# "CAP  ... cap is 3" because three earlier games happened to tip first.
#
# So the featured rooms are moved to the front of the manifest for this
# pass. Order only — nothing is added, nothing is dropped, and a featured
# game that is not yet due still WAITs like anything else.
MARQF="$LOGDIR/slate-marquee-$DATE.txt"
ORDER="$ALL"
if [ -s "$MARQF" ]; then
  FEAT="$(grep -v '^#' "$MARQF" | tr -d '\r' | grep . || true)"
  if [ -n "$FEAT" ]; then
    ORDER="$LOGDIR/.slate-order-$DATE.tsv"
    : > "$ORDER"
    while IFS=$'\t' read -r _lg NID _rest; do
      [ -n "$NID" ] || continue
      printf '%s\n' "$FEAT" | grep -qxF "$NID" && grep -P "^[^\t]*\t\Q$NID\E\t" "$ALL" >> "$ORDER" 2>/dev/null
    done < "$ALL"
    while IFS=$'\t' read -r _lg NID _rest; do
      [ -n "$NID" ] || continue
      printf '%s\n' "$FEAT" | grep -qxF "$NID" || grep -P "^[^\t]*\t\Q$NID\E\t" "$ALL" >> "$ORDER" 2>/dev/null
    done < "$ALL"
    if [ -s "$ORDER" ]; then
      echo "--- featured first: $(printf '%s\n' "$FEAT" | grep -c .) room(s) ahead of the queue for the cap ---"
    else
      ORDER="$ALL"
    fi
  fi
fi

# ---- 2. publish a plan and start a runner for each --------------------
while IFS=$'\t' read -r LG NIGHT_ID ESPN_EVENT HOME_NICK AWAY_NICK TIP SPORT SPATH; do
  [ -n "$NIGHT_ID" ] || continue
  LOG="$LOGDIR/$NIGHT_ID.log"

  # HAND-PICKED, AND THE PICK WINS OVER EVERYTHING BELOW IT. A room named
  # in the pick file starts even if its league is not in RUN_LEAGUES —
  # somebody chose it on purpose, which is a stronger statement than a
  # league-wide switch. A room not named in it does not start at all.
  if [ -n "$PICKED" ] && ! printf '%s\n' "$PICKED" | grep -qxF "$NIGHT_ID"; then
    NOT_PICKED=$((NOT_PICKED+1))
    continue
  fi

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

  # Start small, and only DUE games spend a cap — see the note above the
  # due check. A room skipped for a cap is SAID OUT LOUD: a silent
  # truncation reads as "we covered everything" when we did not.
  #
  # THE REAL GATE: measured listeners, read once above this loop. A room
  # already at the alert threshold does not get another one piled on top
  # of it, whatever room number this would be.
  if [ -n "$LISTEN_NOW" ] && [ "$LISTEN_NOW" -ge "$LISTEN_ALERT" ]; then
    echo "  CAP  $NIGHT_ID — $LISTEN_NOW concurrent listener(s), at/above the $LISTEN_ALERT alert threshold — not starting another room"
    continue
  fi
  # THE MANUAL OVERRIDE: off (0) by default. Only bites if somebody set a
  # real number in leagues.env or the environment for this run.
  if [ "$MAX_ROOMS" -gt 0 ]; then
    RUNNING=$(live_rooms)
    if [ "$RUNNING" -ge "$MAX_ROOMS" ]; then
      echo "  CAP  $NIGHT_ID — $RUNNING room(s) already up, room-count override is $MAX_ROOMS"
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
done < "$ORDER"

# ---- 3. WHAT THE PLAYER IS OFFERED vs WHAT WE ARE HOSTING ------------
# The rail is built from slate/{date}, which carries every game that was
# BUILT. The runners come from RUN_LEAGUES and MAX_ROOMS. When those two
# numbers disagree, the difference is rooms a person can walk into and sit
# in all night. Nothing else in this system compares them, so it is said
# here, every run, out loud.
# WITH A PICK FILE THE TWO NUMBERS COME FROM THE SAME LIST BY CONSTRUCTION,
# and the old sum would have printed a fifteen-room warning about a night
# that is deliberately three rooms — a false alarm every half hour teaches
# people to stop reading the real one.
if [ -n "$PICKED" ]; then
  echo "--- picked: $NPICK   ·   left out of the manifest by the pick: $NOT_PICKED   ·   cap: ${MAX_ROOMS:-none} ---"
  echo "--- slate started; flagship (if any) runs from its own cron line ---"
  exit 0
fi
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
