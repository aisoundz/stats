#!/usr/bin/env bash
# ============ WATCH THE CEILING, EVERY NIGHT, WITHOUT BEING ASKED ======
# GN13 died on a listener concurrency ceiling at 21% of the read tier. The
# watcher that would have seen it coming existed, but it was started BY
# HAND, and on 19 Aug nobody started it. On 20 Aug it was scheduled as a
# one-off crontab line naming that one date — which is the same disease
# the Control Room had: a fact about "every night" written down as a fact
# about one night, needing a human to re-type it before the next one.
#
# This is the launcher that makes it a standing habit. It takes its date
# from the clock, holds a per-day flock so a second start is impossible,
# and bounds itself with `timeout` so a wedged watcher cannot outlive the
# night and start sampling into tomorrow.
#
# Read-only. It samples rooms and the Cloud Monitoring listener metric; it
# never writes to a room.
export PATH="/home/higherthan7/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/home/higherthan7"
cd "$HOME/stats" || exit 1

KEY="$HOME/.secrets/stats-firebase-admin.json"
[ -f "$KEY" ] || { echo "no service account at $KEY"; exit 1; }

DATE="$(TZ=America/Los_Angeles date +%F)"
UNTIL="${UNTIL:-23:30}"
EVERY="${EVERY:-300}"
while [ $# -gt 0 ]; do
  case "$1" in
    --every) EVERY="${2:-300}"; shift 2 ;;
    --every=*) EVERY="${1#*=}"; shift ;;
    --until) UNTIL="${2:-23:30}"; shift 2 ;;
    --until=*) UNTIL="${1#*=}"; shift ;;
    *) shift ;;
  esac
done
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

LOG="$HOME/gamenight-logs/listeners-$DATE.log"
mkdir -p "$HOME/gamenight-logs"

# Hard stop at the UNTIL time plus a few minutes, so the process cannot
# outlive the night even if its own clock check never fires.
NOW_S=$(date +%s)
END_S=$(date -d "today $UNTIL" +%s 2>/dev/null || echo $((NOW_S + 30600)))
[ "$END_S" -le "$NOW_S" ] && END_S=$((NOW_S + 600))
BUDGET=$(( END_S - NOW_S + 300 ))

(
  flock -n 9 || { echo "a listener watch is already running for $DATE"; exit 0; }
  timeout "$BUDGET" node host/listener-watch.js --until "$UNTIL" --every "$EVERY" >> "$LOG" 2>&1
  echo "=== listener watch down $(TZ=America/Los_Angeles date '+%F %T %Z') ===" >> "$LOG"
) 9> "$HOME/gamenight-logs/listeners-$DATE.lock" &
echo "listener watch started · $LOG · every ${EVERY}s until $UNTIL"
