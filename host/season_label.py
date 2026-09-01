#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
season_label.py — "HITS 1093" IS NOT SOMETHING THAT HAPPENED TONIGHT.

    python3 host/season_label.py index-test.html

Verified against tonight's real feed, DET @ MIN (401816766, state "pre"):
boxscore.teams[].statistics is Batting/Pitching/Fielding, and the values
are SEASON accumulations — Games Played 137, Hits 1093, Strikeouts 1175.
Every one of the seven ST_BARS.baseball labels resolves against them, so
the pregame Head to head renders in full, styled exactly like the in-game
one.

Basketball dodges this by accident: its pregame labels are "Points Per
Game" and "Rebounds Per Game", so only two rows collide. BASEBALL'S
PREGAME LABELS ARE BYTE-IDENTICAL TO ITS IN-GAME ONES, so the whole card
comes through wearing tonight's clothes.

Tonight three MLB rooms open at 4:40, 6:38 and 7:10 PT. The first thing a
baseball player sees on the Stats tab is "Hits 1093 – 1042" under a screen
that otherwise means TONIGHT. This product's own rule for that screen is
"nothing typed, nothing invented" — and a true number under a false
timeframe breaks it just as surely as an invented one. It is the same
defect class as the season-points tile that read "Season pts 38" over a
percentage: the number was right and the word above it described something
else.

THE CHEAPEST HONEST FIX IS A LABEL, NOT A REMOVAL. The season head-to-head
is genuinely useful before a game — it is scouting, which is what the tab
promises pregame. It just has to say so. One line, only in the pre phase,
and the in-game card is untouched.
"""
import io, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'index-test.html'

def main():
    s = io.open(SRC, encoding='utf-8').read()
    done = []

    # 1. the subtitle style, beside the header it qualifies
    old_css = ".stHd{font-size:12px;letter-spacing:.14em;color:var(--teal);font-weight:800;margin-bottom:10px}"
    if s.count(old_css) != 1:
        sys.exit('ABORT css: expected 1 .stHd rule, found %d' % s.count(old_css))
    s = s.replace(old_css,
        ".stHd{font-size:12px;letter-spacing:.14em;color:var(--teal);font-weight:800;margin-bottom:10px}\n"
        "/* Said once, under the header, only before the game. A true number under\n"
        "   a false timeframe is as wrong as an invented one. */\n"
        ".stHd.sub{color:var(--dim);letter-spacing:.06em;font-weight:700;font-size:12px;\n"
        "  margin-top:-6px;margin-bottom:10px;text-transform:none}")
    done.append('css')

    # 2. the label itself
    old = ("    return '<div class=\"card h2h\">'\n"
           "      + '<div class=\"stHd\">Head to head</div>'")
    if s.count(old) != 1:
        sys.exit('ABORT label: expected 1 head-to-head header, found %d' % s.count(old))
    new = ("    /* BEFORE THE GAME THESE ARE SEASON TOTALS. Verified on tonight's\n"
           "       DET @ MIN feed: Hits 1093, Games Played 137 — real numbers,\n"
           "       rendered identically to in-game ones. Say which they are. */\n"
           "    var _pre = false;\n"
           "    try{ _pre = (phaseNow() === 'pre'); }catch(_){ _pre = false; }\n"
           "    return '<div class=\"card h2h\">'\n"
           "      + '<div class=\"stHd\">Head to head</div>'\n"
           "      + (_pre ? '<div class=\"stHd sub\">Season so far \\u2014 tonight\\u2019s numbers start at first pitch</div>' : '')")
    s = s.replace(old, new)
    done.append('label')

    io.open(SRC, 'w', encoding='utf-8').write(s)
    print('season label applied to %s' % SRC)
    for d in done:
        print('   ok  %s' % d)

if __name__ == '__main__':
    main()
