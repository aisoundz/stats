#!/usr/bin/env bash
# Start the night watcher and leave it running through both games.
# Written for GN13 — the first night with more than one room — and useful
# every night after. Read-only: it samples rooms, it never writes to one.
export PATH="/home/higherthan7/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/home/higherthan7"
cd "$HOME/stats" || exit 1
KEY="$HOME/.secrets/stats-firebase-admin.json"
[ -f "$KEY" ] || { echo "no service account at $KEY"; exit 1; }
export FIREBASE_SERVICE_ACCOUNT="$(cat "$KEY")"
DATE="${DATE:-$(date +%F)}"
MINUTES="${MINUTES:-390}"           # ~6.5h: covers a 4:30 tip through a 7:00 game
# HOW OFTEN IT SAMPLES, AND WHY IT IS NOT 60 ANY MORE.
# On 19 Aug this ran at --every 60 across four rooms and cost roughly as
# much as a whole runner — about 37 Firestore reads a minute — for one line
# of log. Five minutes still catches a stopped runner well inside the window
# where somebody can act on it, at a fifth of the cost.
# The cron line asked for --every 300 and this script ignored it: the value
# was hard-coded on the node line below, so the flag was decoration. Now it
# is read, with EVERY= as an env override too.
EVERY=300
while [ $# -gt 0 ]; do
  case "$1" in
    --every) EVERY="${2:-300}"; shift 2 ;;
    --every=*) EVERY="${1#*=}"; shift ;;
    *) shift ;;
  esac
done
EVERY="${WATCH_EVERY:-$EVERY}"
case "$EVERY" in ''|*[!0-9]*) EVERY=300 ;; esac

# ============ START WHEN THE NIGHT DOES, NOT AT A FIXED HOUR ==========
# These watchers were a hand-typed cron line per game night until 21 Aug,
# then a standing job at a fixed afternoon hour. Both are wrong for the
# same reason: the slate decides when a night begins, not the clock.
#
# Saturday 22 August makes it concrete — the first room is a 1:00 PM
# kickoff, and a watcher that starts at 3:20 misses the entire game it
# exists to watch. That is worse than no watcher, because the log exists
# and looks like coverage.
#
# So: cron fires this often, and the script decides. It starts only inside
# a window before the FIRST tip on today's slate, and says nothing on a day
# with no games. flock upstream makes a second start impossible, so firing
# often is free.
FIRST_TIP="$(node -e '
  const {initializeApp,cert}=require("firebase-admin/app");
  const {getFirestore}=require("firebase-admin/firestore");
  initializeApp({credential:cert(require(process.env.HOME+"/.secrets/stats-firebase-admin.json"))});
  (async()=>{
    const d=new Date().toLocaleDateString("en-CA",{timeZone:"America/Los_Angeles"});
    const s=await getFirestore().doc("slate/"+d).get();
    const g=((s.data()||{}).games)||[];
    const t=g.map(x=>Date.parse(x.tipISO||"")).filter(n=>!isNaN(n)).sort((a,b)=>a-b)[0];
    process.stdout.write(t?String(Math.floor(t/1000)):"");
  })().catch(()=>process.stdout.write(""));
' 2>/dev/null)"

if [ -z "$FIRST_TIP" ]; then
  echo "no games on today's slate — not starting"; exit 0
fi
NOW_EPOCH=$(date +%s)
LEAD=$(( FIRST_TIP - NOW_EPOCH ))
# More than 50 minutes early: not yet. Cron will come back.
if [ "$LEAD" -gt 3000 ]; then
  exit 0
fi
# More than 8 hours after the first tip: the night is done.
if [ "$LEAD" -lt -28800 ]; then
  exit 0
fi

LOG="$HOME/gamenight-logs/watch-$DATE.log"
mkdir -p "$HOME/gamenight-logs"
# One watcher a night. flock makes a second start impossible.
(
  flock -n 9 || { echo "a watcher is already running for $DATE"; exit 0; }
  echo "=== watcher up $(date '+%F %T %Z') · $DATE · ${MINUTES}m · every ${EVERY}s ===" >> "$LOG"
  timeout $((MINUTES*60)) node host/watch-night.js --date "$DATE" --every "$EVERY" >> "$LOG" 2>&1
  echo "=== watcher down $(date '+%F %T %Z') ===" >> "$LOG"
) 9> "$HOME/gamenight-logs/watch-$DATE.lock" &
echo "watcher started · $LOG"
