# v7.5 — the rebuilt app, 31 Aug 2026

    v75.html            the working prototype (source; footer reads DEVBUILD)
    DELIVERED-v75.html  the stamped copy the founder was reviewing (build 1641699)
    qa/chk*.js          144 checks across four suites
    qa/deliver.sh       ONLY way to ship it — stamps the build hash, refuses DEVBUILD
    qa/run-sabs.sh      sabotage runner; tells CRASHED apart from NOT CAUGHT
    qa/rates.json       measured event rates behind the watchlist pricing
    qa/leaders.js       league leaders pulled from core.api.espn.com

Run them:  cd ~/stats/v75/qa && node chk3.js ~/stats/v75/v75.html
Ship it:   cd ~/stats/v75/qa && ./deliver.sh      → ~/Downloads/STATS-GAMETIME-v75.html

THE BUILD STAMP EXISTS BECAUSE A CACHED FILE LOOKS EXACTLY LIKE A LIVE ONE.
Two rounds were spent on a bug that was already fixed. The footer and the ☰
menu both show the hash; if it does not match what you were told, the
browser is stale. Never plain-cp to Downloads — deliver.sh is the only path
and it aborts rather than ship the DEVBUILD placeholder.
