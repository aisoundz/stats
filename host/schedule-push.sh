#!/bin/bash
# schedule-push.sh — rebuild the two-week schedule and PUBLISH it.
#
# WHY IT PUSHES, AND WHY BUILDING ALONE WOULD BE A NO-OP.
# schedule.json is served from GitHub Pages. A cron that only writes the
# file leaves it sitting on this Jetson while every player reads whatever
# was last pushed — a schedule menu that is silently a week stale, which is
# worse than no schedule menu at all. Same reasoning, and the same shape,
# as host/journal-push.sh: build, commit, push, and say so.
#
# IT RUNS AFTER THE SLATE BUILD. start-slate.sh --build is 03:00; this is
# 03:20. Running it first would publish yesterday's picks.
#
# NO CHANGE MEANS NO COMMIT. Most days the next fortnight is identical to
# yesterday's next fortnight minus one day, and a daily empty commit would
# bury the real history.
set -u

# ============ CRON HAS ALMOST NO PATH ================================
# The first live run of this script, 03:20 on 1 Sept 2026, failed with
#
#     schedule-push.sh: line 22: node: command not found
#     build-schedule.js failed
#
# node lives under nvm here, not in /usr/bin, and cron does not source a
# profile. The schedule would have silently never updated — the menu would
# have gone stale a day at a time while every manual run of this script
# worked perfectly, because a login shell has the PATH and cron does not.
#
# host/journal-push.sh has set this line since it was written. Copied
# verbatim rather than invented differently: one fact, one pattern.
export PATH="/home/higherthan7/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/home/higherthan7"

cd "$HOME/stats" || { echo "cannot cd to $HOME/stats"; exit 1; }

FILE="schedule.json"

node host/build-schedule.js --quiet || { echo "build-schedule.js failed"; exit 1; }

if [ ! -f "$FILE" ]; then
  echo "build-schedule.js exited clean but $FILE does not exist — nothing to publish"
  exit 1
fi

if [ -z "$(git status --porcelain -- "$FILE")" ]; then
  echo "schedule unchanged — nothing to publish"
  exit 0
fi

git add "$FILE"
git commit -q -m "Schedule: $(date +%F)" || { echo "commit failed for $FILE"; exit 1; }

# Retry once. This shares a branch with journal-push.sh and the slate jobs,
# so losing a push race is expected rather than exceptional.
if ! git push -q origin main; then
  echo "push failed, retrying once after a pull --rebase"
  git pull --rebase -q origin main && git push -q origin main \
    || { echo "PUSH FAILED for $FILE — the commit is local only and needs a human"; exit 1; }
fi

echo "schedule rebuilt and published $(date +%F)"
