#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pick_voice_order.py — THE FIRST PICK CARD WAS NEVER READ ALOUD.

    python3 host/pick_voice_order.py index-test.html

    buildPred();go('predict');

go() is what sets S.screen. So when buildPred() calls VX.mount() and
VX.askPick(), S.screen still holds the PREVIOUS screen, and

    V.onPickCard = S.screen==='predict' && !!$('#predCard .pdopt')

is false. mount() takes the else branch and parks #vxBar inside
#gtQuestion, which is display:none, and askPick() returns early.

MEASURED with voice already ON, walking the real journey:

    arriving at the pick sheet   spoken: []          bar visible: false
    after one pick tap           spoken: [the card]  bar visible: true

So the first of six cards is silent, and the only way to recover the voice
is to TAP an option — eyes on the screen, hands on the phone, which is the
entire thing the feature exists to avoid. On the 600-point sheet.

WHY THE SUITE IS GREEN THROUGH IT. qa/voice-wiring.js has
`voice.the-pick-card-is-read-aloud` and
`voice.the-bar-follows-the-player-to-the-pick-sheet`, both passing,
because the harness calls buildPred() when the screen is ALREADY predict.
It sets up the state the bug removes — the fifth harness trap of this
shape in the file.

THE FIX IS THE ORDER, NOT THE PREDICATE. Loosening V.onPickCard to test
only for `#predCard .pdopt` would also work today and would rot: the card
keeps its markup after the deck moves on, so the predicate would start
answering true on screens the player has already left.

go() only swaps .active classes, resets scroll and sets S.screen — it
never reads the card — so building AFTER it is safe. It is also better:
a card built into a VISIBLE container measures itself correctly, where a
hidden one returns zeros to every getBoundingClientRect.
"""
import io, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'index-test.html'

def main():
    s = io.open(SRC, encoding='utf-8').read()
    old = "  buildPred();go('predict');"
    if s.count(old) != 1:
        sys.exit('ABORT: expected exactly 1 "buildPred();go(\'predict\');", found %d' % s.count(old))
    new = ("  /* ORDER MATTERS: go() sets S.screen, and V.onPickCard() reads it.\n"
           "     Built first, the voice bar was parked in a hidden container and the\n"
           "     first of six cards was never spoken — measured silent on arrival and\n"
           "     working only after a tap. See host/pick_voice_order.py. */\n"
           "  go('predict');buildPred();")
    io.open(SRC, 'w', encoding='utf-8').write(s.replace(old, new))
    print('pick-sheet order fixed in %s' % SRC)

if __name__ == '__main__':
    main()
