# The journal

One file per day, generated from things that are already true — the commit history, the
slate in Firestore, and the game-night logs. Not from anybody's recollection.

    node host/journal.js              # today
    node host/journal.js 2026-08-19   # a specific day
    node host/journal.js --force      # regenerate a day that already has a file

**It never overwrites a day that already exists unless you pass `--force`**, because the
"Notes" section at the bottom is written by hand and the machine has no business deleting it.
Everything above that line is regenerated; everything below it is yours.

## Why it lives in the repo

Because the repo is on GitHub, and the reason the founder asked for a journal was
*"in case anything ever happens here"* — meaning the Jetson. A journal that only exists on the
machine it documents is not a backup of anything. Google Drive holds the reading copy;
git holds the history, versioned, on somebody else's disk.

`STATS GAMETIME — The Timeline` in Drive is the narrative version: phases, decisions and the
honest numbers. This folder is the day-by-day record underneath it.
