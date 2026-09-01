#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cfb_path.py — COLLEGE FOOTBALL HAS NO FEED PATH, AND THURSDAY IS A CFB NIGHT.

    python3 host/cfb_path.py index-test.html

`cfb` appears ZERO times in index.html. host/leagues.js has had it since
the league table was written — path 'football/college-football' — but
SPORT_CFG in the player app never learned it, so sportCfg() falls to

    k = SPORT_CFG[fam] ? fam : (FAMILY_LEAGUE[fam] || 'wnba');

fam is 'football', FAMILY_LEAGUE.football is 'nfl', and a college event id
is not in the NFL's feed. Proven against Thursday's actual game,
Colorado at Georgia Tech, event 401856776:

    football/college-football  -> header ok, boxscore ok, 2 teams
    football/nfl               -> 404

A 404 means no header, which means `throw new Error('no feed')`. That is
not a thin Stats tab — phaseSync() never gets a phase either, so the room
loses its clock and its score ribbon. Thursday's second room would have
been a blackout.

EPL IS ADDED TOO, BUT IT IS NOT THE SAME BUG. epl also missing from
SPORT_CFG and also falls back — to mls, 'soccer/usa.1'. Tested against
Sunday's Arsenal at Aston Villa, event 401879295: BOTH paths return 200
with the right two teams, because ESPN's soccer summary resolves an event
id whatever league sits in the path. So Premier League rooms have been
reading the wrong path and getting the right answer by tolerance. That is
luck, not design — the scoreboard and season endpoints are not
necessarily as forgiving — so it is corrected here rather than left.

pre/live/box stay EMPTY on purpose, exactly as nfl/mlb/nhl/mls do. The
file's own rule: "comparable-stat rows and the box mapping are
deliberately EMPTY rather than guessed, because a football sheet has no
rebounds. Empty means the block hides itself." Inventing a stat CATEGORY
is the same sin as inventing a number, and this patch fixes a PATH.
"""
import io, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'index-test.html'

def main():
    s = io.open(SRC, encoding='utf-8').read()
    if "cfb:{" in s or "cfb:" in s.split('var SPORT_CFG={')[1].split('\n};')[0]:
        sys.exit('ABORT: cfb already in SPORT_CFG')

    old = "  mls:{ family:'soccer',   path:'soccer/usa.1',   unit:'goals', minutes:45, pre:[], live:[], box:{} }\n};"
    if s.count(old) != 1:
        sys.exit('ABORT: expected exactly 1 mls entry closing SPORT_CFG, found %d' % s.count(old))

    new = ("  mls:{ family:'soccer',   path:'soccer/usa.1',   unit:'goals', minutes:45, pre:[], live:[], box:{} },\n"
           "  /* ============ THE TWO LEAGUES THE APP HOSTED AND COULD NOT READ ===\n"
           "     host/leagues.js is the one owner of the league table and has had\n"
           "     both of these since it was written. SPORT_CFG never learned them,\n"
           "     so sportCfg() fell back by FAMILY: football -> nfl, soccer -> mls.\n"
           "\n"
           "     For cfb that is fatal. A college event id is not in the NFL feed —\n"
           "     event 401856776, Thursday's Colorado at Georgia Tech, returns 404\n"
           "     on football/nfl and a full summary on football/college-football.\n"
           "     No header means 'no feed', and phaseSync() loses the phase with\n"
           "     it, so the room loses its clock and its score ribbon, not just\n"
           "     the Stats tab.\n"
           "\n"
           "     For epl it was luck. Tested on event 401879295 (Arsenal at Aston\n"
           "     Villa): soccer/eng.1 and soccer/usa.1 BOTH return 200 with the\n"
           "     right two teams, because ESPN's soccer summary resolves an event\n"
           "     whatever league is in the path. Premier League rooms have been\n"
           "     getting the right answer from the wrong address. Corrected rather\n"
           "     than left, because the scoreboard and season endpoints are not\n"
           "     necessarily as forgiving.\n"
           "\n"
           "     pre/live/box stay EMPTY, as they are for every roadmap league:\n"
           "     empty hides the block, and inventing a stat CATEGORY is the same\n"
           "     sin as inventing a number. This fixes a PATH. */\n"
           "  cfb:{ family:'football', path:'football/college-football', unit:'pts',   minutes:15, pre:[], live:[], box:{} },\n"
           "  epl:{ family:'soccer',   path:'soccer/eng.1',              unit:'goals', minutes:45, pre:[], live:[], box:{} }\n"
           "};")
    s = s.replace(old, new)
    io.open(SRC, 'w', encoding='utf-8').write(s)
    print('cfb + epl added to SPORT_CFG in %s' % SRC)

if __name__ == '__main__':
    main()
