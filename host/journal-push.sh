#!/usr/bin/env bash
# Run the daily journal and land it on GitHub with nobody touching a
# keyboard. journal.js only ever wrote the file to disk — until 24 Aug that
# meant every entry sat uncommitted until someone remembered to push it by
# hand, which is exactly the kind of "looks like it's happening" gap the
# journal itself was built to catch. Now the write and the backup are one
# cron line.
#
# Founder: "this is our full record for our growth journey" — a record
# that only exists on this Jetson is not a record of anything if the box
# dies, so failing loudly here matters more than usual.
export PATH="/home/higherthan7/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin"
export HOME="/home/higherthan7"
cd "$HOME/stats" || { echo "cannot cd to $HOME/stats"; exit 1; }

# Journals YESTERDAY. A run at 05:45 of "today" would journal a day that
# has not happened yet — see the cron comment above this job.
DATE="${1:-$(date -d yesterday +%F)}"

node host/journal.js "$DATE" || { echo "journal.js failed for $DATE"; exit 1; }

FILE="journal/$DATE.md"
if [ ! -f "$FILE" ]; then
  echo "journal.js exited clean but $FILE does not exist — nothing to commit"
  exit 1
fi

if git diff --quiet -- "$FILE" && git diff --cached --quiet -- "$FILE" \
   && [ -z "$(git status --porcelain -- "$FILE")" ]; then
  echo "$FILE already committed and unchanged — nothing to do"
  exit 0
fi

git add "$FILE"
git commit -m "Journal: $DATE" || { echo "commit failed for $FILE"; exit 1; }

# Retry once — a push can lose a race against another job touching the
# branch (e.g. a QA or gate commit landing the same morning).
if ! git push origin main; then
  echo "push failed, retrying once after a pull --rebase"
  git pull --rebase origin main && git push origin main \
    || { echo "PUSH FAILED for $FILE — commit is local only, needs a human"; exit 1; }
fi

echo "journaled and pushed $DATE"
