#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mlb_every_inning.py — BASEBALL ASKS AT THE END OF EVERY INNING.

    python3 host/mlb_every_inning.py index-test.html admin-test.html

FOUNDER'S RULE, 31 Aug 2026, given more than once:
    "We want questions in baseball at the end of every inning."
    "Ive said it multiple times."

He had. It was never written down, while the OPPOSITE sat in the skill file
twice ("Use 3 rounds (after the 3rd, 6th, 9th), not nine") — so every session
read that, built three rounds, and lost the instruction again. The skill is
corrected and the decision is in memory now; this is the code half.

WHY IT IS RIGHT. Dead time is what is driving him off his own product. Three
rounds put the first questions ~55 minutes after first pitch and then roughly
hourly. Nine rounds is a moment every ~20 minutes, in the break the sport
already has.

FOUR COPIES OF THE ROUND STRUCTURE MOVE TOGETHER OR NOT AT ALL:
    admin.html  TEMPLATES.baseball  tags / names / worth / periods / rounds
    admin.html  FAMILY.baseball     rounds:[3,6,9]
    index.html  SPORTS.baseball     names / tags
    admin.html  mlbSpan()           the span every resolver reads

mlbSpan IS THE ONE OWNER OF THE SPAN, which is what makes this tractable at
all: every span resolver reaches it through mlbInSpan, so one line moves all
of them together.

TWO RESOLVERS CHANGE MEANING, both handled on purpose:
  * mlbOneTwoThreeInning COMES BACK. The shadow test killed it for answering
    "Yes" eight times from eight — because over three innings it asked "was
    ANY of six half-innings 1-2-3?". Over one inning it is a real question.
  * mlbBusiestInning IS DROPPED. It cannot be asked of a single inning.

CUTOFFS ARE WHAT WOULD SILENTLY ROT. mlbRunsBand's [0,2,4] and
mlbStrikeoutsBand's [2,4,6] are three-inning shapes; asked of one inning they
answer "none"/"two or fewer" nearly every time — resolving perfectly while
being worth nothing to answer, which is exactly what bank-shadow exists to
catch. mlbExtraRunsBand and mlbExtraFirstScoringTeam were already written
single-inning for extra innings (tuned [0,1,2], reading mlbInInning), so they
are reused rather than re-derived. Only strikeouts needs a new band.

EVERY QUESTION CARRIES SPANISH. t_es/o_es are not optional here — the app has
a live Spanish mode and a question without them renders untranslated.

NOT TRUSTED UNTIL:  node qa/bank-shadow.js baseball 8
"""
import io, sys, re

IDX   = sys.argv[1] if len(sys.argv) > 1 else 'index-test.html'
ADMIN = sys.argv[2] if len(sys.argv) > 2 else 'admin-test.html'

EN = ['1st','2nd','3rd','4th','5th','6th','7th','8th','9th']
ES = ['1ra','2da','3ra','4ta','5ta','6ta','7ma','8va','9na']
# Early innings cheap, late innings pay — same shape as the 30/50/70 the
# three-round bank used, spread over nine and still totalling 150.
WORTH = [10, 10, 15, 15, 15, 20, 20, 20, 25]

def q_runs(i):
    return ("        { t: 'Runs in the %s, both teams — how many?', o: ['None','One','Two','Three or more'], r:'mlbExtraRunsBand',\n"
            "          t_es: 'Carreras en la %s, entre los dos equipos — ¿cuántas?', o_es: ['Ninguna','Una','Dos','Tres o más'] }"
            % (EN[i], ES[i]))

def q_123(i):
    return ("        { t: 'Did the %s go 1-2-3?', o: ['Yes','No'], r:'mlbOneTwoThreeInning',\n"
            "          t_es: '¿La %s fue 1-2-3?', o_es: ['Sí','No'] }" % (EN[i], ES[i]))

def q_ks(i):
    return ("        { t: 'Strikeouts in the %s, both staffs — how many?', o: ['None','One','Two','Three or more'], r:'mlbInningStrikeoutsBand',\n"
            "          t_es: 'Ponches en la %s, entre los dos cuerpos de pitcheo — ¿cuántos?', o_es: ['Ninguno','Uno','Dos','Tres o más'] }"
            % (EN[i], ES[i]))

def q_heat(i):
    return ("        { t: 'The fastest pitch of the %s — how hard?', o: ['93 or under','94 to 96','97 or 98','99 or more'], r:'mlbFastestPitchBand',\n"
            "          t_es: 'El lanzamiento más rápido de la %s — ¿a cuánto?', o_es: ['93 o menos','De 94 a 96','97 o 98','99 o más'] }"
            % (EN[i], ES[i]))

OT_ROUND = ("      [\n"
            "        { t: 'Who scores first this inning?', o: ['{HOME}','{AWAY}','Nobody scored'], r:'mlbExtraFirstScoringTeam',\n"
            "          t_es: '¿Quién anota primero en esta entrada?', o_es: ['{HOME}','{AWAY}','Nadie anotó'] },\n"
            "        { t: 'Runs this inning, both teams — how many?', o: ['None','One','Two','Three or more'], r:'mlbExtraRunsBand',\n"
            "          t_es: 'Carreras en esta entrada, entre los dos equipos — ¿cuántas?', o_es: ['Ninguna','Una','Dos','Tres o más'] }\n"
            "      ]")

def rounds_block():
    """Two questions an inning: runs always, then a rotating second so nine
       rounds do not read identically to somebody playing all of them."""
    second = [q_123, q_ks, q_heat]
    out = []
    for i in range(9):
        out.append("      [\n%s,\n%s\n      ]" % (q_runs(i), second[i % 3](i)))
    out.append(OT_ROUND)
    return ',\n'.join(out)

KS_RESOLVER = """
  /* STRIKEOUTS IN ONE INNING, not three. mlbStrikeoutsBand's [2,4,6] is
     correct for a three-inning span and wrong for a single inning, where it
     would answer "two or fewer" nearly every time — a question that resolves
     perfectly and is not worth asking, which is the exact failure
     qa/bank-shadow.js was built to catch. [0,1,2] is the single-inning
     shape, the same one mlbExtraRunsBand already uses. */
  R.mlbInningStrikeoutsBand = function(j, p, o){
    var n = mlbInInning(j, p).filter(mlbIsStrikeout).length;
    return band(n, [0,1,2], o);
  };
"""

def main():
    a = io.open(ADMIN, encoding='utf-8').read()
    i = io.open(IDX, encoding='utf-8').read()
    if 'mlbInningStrikeoutsBand' in a:
        sys.exit('ABORT: already applied')
    hits = []

    def sub(hay, old, new, tag):
        n = hay.count(old)
        if n != 1:
            sys.exit('ABORT %s: expected 1 match, found %d' % (tag, n))
        hits.append(tag)
        return hay.replace(old, new)

    # ---- 1. the span is one inning -----------------------------------
    a = sub(a, "  function mlbSpan(p){ var hi = Number(p)||0; return { lo: hi-2, hi: hi }; }",
        "  /* ONE INNING, NOT THREE. Reversed 31 Aug 2026 on the founder's rule\n"
        "     that baseball asks at the END OF EVERY INNING. This is the single\n"
        "     owner of the span — every mlb* resolver reaches it through\n"
        "     mlbInSpan — so this one line moves all of them together, and that\n"
        "     is the only reason the change is safe to make at all.\n"
        "     It also retires the old warning that period 10 read innings 8-10:\n"
        "     an extras period now reads exactly its own inning. */\n"
        "  function mlbSpan(p){ var hi = Number(p)||0; return { lo: hi, hi: hi }; }", 'mlbSpan')

    # ---- 2. the per-inning strikeout band ----------------------------
    a = sub(a, "  R.mlbMoreKsOrHits = function(j, p, o){",
            KS_RESOLVER + "\n  R.mlbMoreKsOrHits = function(j, p, o){", 'ks-resolver')

    # ---- 3. FAMILY, the second copy ----------------------------------
    a = sub(a, "done:mlbInningDone, rounds:[3,6,9] },",
               "done:mlbInningDone, rounds:[1,2,3,4,5,6,7,8,9] },", 'FAMILY')

    # ---- 4. the four lists -------------------------------------------
    a = sub(a,
        "    tags:   ['1st-3rd','4th-6th','7th-9th','OT'],\n"
        "    names:  ['Innings 1–3','Innings 4–6','Innings 7–9','Extra innings'],\n"
        "    worth:  [30,50,70,70],",
        "    tags:   ['1st','2nd','3rd','4th','5th','6th','7th','8th','9th','OT'],\n"
        "    names:  ['1st inning','2nd inning','3rd inning','4th inning','5th inning',\n"
        "             '6th inning','7th inning','8th inning','9th inning','Extra innings'],\n"
        "    worth:  [%s,70]," % ','.join(str(w) for w in WORTH), 'four-lists')

    a = sub(a, "    periods:[3,6,9,10],", "    periods:[1,2,3,4,5,6,7,8,9,10],", 'periods')

    # ---- 5. the questions themselves ---------------------------------
    start = a.index("    periods:[1,2,3,4,5,6,7,8,9,10],")
    rs = a.index("    rounds: [", start)
    # the rounds array ends at the line "    ]" that precedes the trailing comment
    end = a.index("\n    ]\n    /* THE EXTRA-INNINGS ROUND IS THE FOURTH ONE ABOVE.", rs)
    a = a[:rs] + "    rounds: [\n" + rounds_block() + a[end:]
    hits.append('rounds')

    # that trailing comment is now wrong in its first sentence
    a = sub(a, "    /* THE EXTRA-INNINGS ROUND IS THE FOURTH ONE ABOVE.",
               "    /* THE EXTRA-INNINGS ROUND IS THE TENTH ONE ABOVE, and it was the\n"
               "       fourth until 31 Aug 2026, when regulation went to nine rounds —\n"
               "       one per inning — on the founder's rule.\n"
               "       (kept for the reasoning, which still holds:)\n"
               "       THE EXTRA-INNINGS ROUND IS THE LAST ONE ABOVE.", 'ot-comment')

    # ---- 6. the player app's copy -------------------------------------
    i = sub(i, 'names:["Innings 1\\u20133","Innings 4\\u20136","Innings 7\\u20139"]',
               'names:["1st inning","2nd inning","3rd inning","4th inning","5th inning",'
               '"6th inning","7th inning","8th inning","9th inning"]', 'idx-names')
    i = sub(i, 'tags:["1st-3rd","4th-6th","7th-9th"]',
               'tags:["1st","2nd","3rd","4th","5th","6th","7th","8th","9th"]', 'idx-tags')

    io.open(ADMIN, 'w', encoding='utf-8').write(a)
    io.open(IDX,   'w', encoding='utf-8').write(i)
    print('baseball is per-inning now:', ', '.join(hits))
    print('NEXT, not optional:  node qa/bank-shadow.js baseball 8')

if __name__ == '__main__':
    main()
