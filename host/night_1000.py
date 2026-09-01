#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
night_1000.py — EVERY GAME IS WORTH 1,000 POINTS.

    python3 host/night_1000.py index-test.html admin-test.html

FOUNDER'S RULE, 31 Aug 2026:
    "we should find a way to make every game a potential of 1000 points"
    "the points and tokens is what make the game fun, people want to make
     the most and be the highest scorer"

THE ARITHMETIC. The prediction sheet is 600 in every sport already, so the
live rounds must total 400 in every sport whatever cadence it has:

    sport       rounds x questions   worth (per QUESTION)          live
    basketball    4 x 4              10,20,30,40                    400  ok
    football      4 x 4              10,20,30,40                    400  ok
    soccer        2 x 4              40,60                          400  ok (hosted)
    hockey        3 x 4              15,30,45  ->  20,30,50    360 -> 400
    baseball      9 x 2              20..50    ->  10,10,15,15,20,25,30,35,40
                                                              600 -> 400

WHY BASEBALL'S NEW SHAPE RISES STEEPLY. 10,10,15,15,20,25,30,35,40 pays
20,20,30,30,40,50,60,70,80 per inning — the ninth is worth four times the
first, which is exactly basketball's Q1:Q4 ratio. A flat spread would make
innings one to four pointless to sit through, and dead time is the thing
driving people off this product.

OVERTIME IS NOT INSIDE THE 1,000 AND MUST NOT BE. A night that goes to
extras is worth more than one that does not; the 1,000 is a REGULATION
ceiling. Basketball, football and baseball independently landed on OT
paying 120 (3x40, 3x40, 2x60) and that convention is now asserted by
qa/night-ceiling.js rather than left to coincidence. Nothing here changes
an OT weight.

THE COPIES THAT MOVE TOGETHER — and there are more than the last change
found. `roundWorth(i) = HOSTW[i] != null ? HOSTW[i] : SPORT.worth[i]`, so:

    admin.html  TEMPLATES.<fam>.worth   what a HOSTED night pays
    index.html  SPORTS.<fam>.worth      what PRACTICE pays (the fallback)
    index.html  <fam>.ruleLive/step3    what the player is TOLD it pays

Miss the third and the game pays one number while the rules screen states
another. Soccer is living proof: its rules screen says a question is worth
"3 pts each" while a hosted night pays 40. That is not a rounding error,
it is a different number by an order of magnitude, and it has been on the
screen since soccer shipped.

SOCCER'S PRACTICE BANK GETS A FOURTH QUESTION PER ROUND, mirroring the
hosted bank's shape (4+4, not 3+3). The two added questions are modelled
on hosted questions that already exist and already resolve — no new
question is invented here, because a practice question that behaves
differently from the hosted one teaches the wrong game.

NOT TRUSTED UNTIL:  node qa/night-ceiling.js --file index-test.html --admin-file admin-test.html
"""
import io, sys

IDX   = sys.argv[1] if len(sys.argv) > 1 else 'index-test.html'
ADMIN = sys.argv[2] if len(sys.argv) > 2 else 'admin-test.html'

BASEBALL_NEW = '10,10,15,15,20,25,30,35,40'
HOCKEY_NEW   = '20,30,50'

SOC_Q1 = ("""    {t:"Who had more shots in the first half?", o:["Inter Miami","Club América","Level"], a:"Inter Miami",
     t_es:"¿Quién remató más en el primer tiempo?", o_es:["Inter Miami","Club América","Iguales"]}""")
SOC_Q2 = ("""    {t:"Who kept more of the ball over the match?", o:["Inter Miami","Club América","Even split"], a:"Club América",
     t_es:"¿Quién mantuvo más la pelota en el partido?", o_es:["Inter Miami","Club América","Repartida"]}""")


def main():
    i = io.open(IDX, encoding='utf-8').read()
    a = io.open(ADMIN, encoding='utf-8').read()
    done = []

    def sub(hay, old, new, tag):
        n = hay.count(old)
        if n != 1:
            sys.exit('ABORT %s: expected exactly 1 match, found %d' % (tag, n))
        done.append(tag)
        return hay.replace(old, new)

    if 'worth:  [20,30,50]' in a or "worth:[20,30,50]" in i:
        sys.exit('ABORT: already applied')

    # ---- 1. hosted: the two sports that cannot pay 400 ----------------
    a = sub(a, "    worth:  [15,30,45],", "    worth:  [%s]," % HOCKEY_NEW, 'admin-hockey')
    a = sub(a, "    worth:  [20,20,30,30,30,40,40,40,50,60],",
               "    worth:  [%s,60]," % BASEBALL_NEW, 'admin-baseball')

    # ---- 2. practice: the same numbers, or practice teaches a lie ------
    i = sub(i, "worth:[15,30,45],", "worth:[%s]," % HOCKEY_NEW, 'index-hockey')
    i = sub(i, "worth:[20,20,30,30,30,40,40,40,50],",
               "worth:[%s]," % BASEBALL_NEW, 'index-baseball')
    i = sub(i, "worth:[30,50],", "worth:[40,60],", 'index-soccer')

    # ---- 3. soccer practice gets the hosted bank's SHAPE ---------------
    i = sub(i,
        '     t_es:"¿Cuántos minutos de tiempo añadido al final del primer tiempo?", o_es:["1","2","3","4+"]}\n  ]},',
        '     t_es:"¿Cuántos minutos de tiempo añadido al final del primer tiempo?", o_es:["1","2","3","4+"]},\n'
        + SOC_Q1 + '\n  ]},', 'soccer-q4-first')
    i = sub(i,
        '     t_es:"¿Cuántos minutos de tiempo añadido al final del partido?", o_es:["1–2","3–4","5–6","7+"]}\n  ]}',
        '     t_es:"¿Cuántos minutos de tiempo añadido al final del partido?", o_es:["1–2","3–4","5–6","7+"]},\n'
        + SOC_Q2 + '\n  ]}', 'soccer-q4-second')

    # ---- 4. THE COPY. The half that gets forgotten. --------------------
    i = sub(i, "Three rounds, one an intermission, four questions each, worth 15, 30 and 45 points.",
               "Three rounds, one an intermission, four questions each, worth 20, 30 and 50 points.",
               'hockey-ruleLive')
    i = sub(i, "Two question rounds only — halftime (3 pts each) and full time (5 pts each).",
               "Two question rounds only — halftime (40 pts each) and full time (60 pts each).",
               'soccer-step3')
    i = sub(i, "At halftime, 3 questions about the first 45 (3 pts each). At the final whistle, 3 questions about the whole match (5 pts each).",
               "At halftime, 4 questions about the first 45 (40 pts each). At the final whistle, 4 questions about the whole match (60 pts each).",
               'soccer-ruleLive')

    io.open(IDX,   'w', encoding='utf-8').write(i)
    io.open(ADMIN, 'w', encoding='utf-8').write(a)
    print('every game is 1,000 now:', ', '.join(done))
    print('NEXT, not optional:')
    print('  node qa/night-ceiling.js --file %s --admin-file %s' % (IDX, ADMIN))


if __name__ == '__main__':
    main()
