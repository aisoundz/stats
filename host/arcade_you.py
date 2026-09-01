#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
arcade_you.py — YOUR SCORE, WHERE YOU CAN SEE IT WHILE YOU PLAY.

    python3 host/arcade_you.py index-test.html

FOUNDER, repeatedly: "I want to get points and stats and have fun and feel
it sticky." And: "the points and tokens is what make the game fun, people
want to make the most and be the highest scorer."

WHAT IS ACTUALLY MISSING. Grep the play screen for the player's own score
and you find nothing. #gtHead renders the GAME scoreboard — the two teams
and their runs — and body.qopen then sheds everything that is not that,
on purpose, because the board has a height budget on the smallest phone.
So a player answering a question can see what the TEAMS have scored and
cannot see what THEY have scored. The number the whole product is about is
the one number not on the screen.

WHY IT REACTS TO THE NUMBER INSTEAD OF HOOKING THE SCORING. The obvious
build is to call this from wherever points are awarded. That would mean a
new caller inside the scoring path, and this file's history is emphatic
about what happens next: ledgerServerFloor() collapsing four lanes into
one, pushScore() publishing before reading, recomputeScore()'s switch
being the ONE place that knows what a lane is. Nothing here is allowed
near that.

So paintYou() is a READER. It takes S.pts, compares it to the last value
it painted, and animates the difference. It has no opinion about where the
points came from, cannot double-count, cannot drop a lane, and if the
scoring changes underneath it it keeps working. The one risk of a reader —
that it misses a change nobody told it about — is handled by calling it
from renderGametime() (which already runs on every board repaint) and from
the stats:score event that recomputeScore() already dispatches when, and
only when, the total actually moved.

HEIGHT IS THE CONSTRAINT, NOT SPACE. The chip goes in the .ascore row
beside the live pill: one line, no new row, nothing pushed below the fold.
It is NOT added to .qmeta, which already carries the question count, the
combo chip and the worth, and is the row most likely to wrap on a small
phone.

TEAL, BECAUSE TEAL IS YOU. That colour means one thing in this product and
this is exactly that thing. 12px floor respected — the ramp is the shipped
design system and 142 sub-12px sizes were "most of why the app read as
amateur".

INJECTED, NOT TEMPLATED. renderGametime() writes head.innerHTML in two
branches — a practice board and a real one — with different content. Two
markup edits would be two copies of one fact, which is the disease this
codebase is named for. One function that ensures the node exists after
whichever branch ran is one writer.
"""
import io, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'index-test.html'

CSS = """  /* ============ YOUR SCORE, DURING PLAY — the arcade counter ========
     One line inside .ascore so the board gains no height while a question
     is open. Teal is YOU. Mono + tabular-nums so the digits do not shuffle
     the layout as the number grows from 40 to 400. */
  #ayou{display:inline-flex;align-items:baseline;gap:6px;margin-left:auto;
    font-family:var(--ui);font-size:12px;font-weight:700;letter-spacing:.16em;
    text-transform:uppercase;color:var(--dim);white-space:nowrap;position:relative}
  #ayou b{font-family:var(--mono);font-size:20px;font-weight:700;letter-spacing:-.01em;
    color:var(--teal);font-variant-numeric:tabular-nums;text-transform:none}
  /* THE GAIN. It flies off the number it came from, which is the whole
     point — a +40 that appears somewhere else is a notification, not a
     reward. 900ms, then it is gone and the counter holds the new total. */
  #ayouUp{position:absolute;right:0;top:-2px;font-family:var(--mono);font-size:15px;
    font-weight:700;color:var(--green);pointer-events:none;opacity:0;
    text-transform:none;letter-spacing:0}
  #ayouUp.go{animation:ayouFly .9s cubic-bezier(.22,.9,.3,1) forwards}
  @keyframes ayouFly{
    0%{opacity:0;transform:translateY(4px) scale(.9)}
    18%{opacity:1;transform:translateY(-6px) scale(1.12)}
    60%{opacity:1;transform:translateY(-16px) scale(1)}
    100%{opacity:0;transform:translateY(-26px) scale(1)}}
  #ayou.bump b{animation:ayouBump .5s ease-out}
  @keyframes ayouBump{0%{transform:scale(1)}30%{transform:scale(1.18)}100%{transform:scale(1)}}
  /* A PERSON WHO ASKED FOR LESS MOTION GETS THE NUMBER, NOT THE SHOW. */
  @media (prefers-reduced-motion:reduce){
    #ayouUp.go{animation:none;opacity:0}
    #ayou.bump b{animation:none}}

"""

WRITER = """
/* ============ THE ARCADE COUNTER — YOUR SCORE, WHILE YOU PLAY ========
   A READER, never a writer. It asks S.pts what the total is and animates
   the difference from the last value it painted. It is deliberately not
   wired into the scoring path: see host/arcade_you.py for why nothing new
   is allowed near ledgerSet/recomputeScore/pushScore.

   Practice is included on purpose. A rehearsal that does not show you a
   score does not rehearse the thing the game is about — and the practice
   board already announces itself as PRACTICE, so the number cannot be
   mistaken for a real one. */
var AYOU_LAST = null;
function paintYou(){
  try{
    var row = document.querySelector('#gtHead .ascore');
    if(!row) return;                       /* the pre-game board has none */
    var el = document.getElementById('ayou');
    if(!el){
      el = document.createElement('span');
      el.id = 'ayou';
      el.innerHTML = 'You <b id="ayouN">0</b><i id="ayouUp"></i>';
      row.appendChild(el);
    }
    var n = 0;
    try{ n = Math.max(0, Math.round(Number(S && S.pts) || 0)); }catch(_){ n = 0; }
    var b = document.getElementById('ayouN');
    if(!b) return;
    /* FIRST PAINT IS NOT A GAIN. Joining a room mid-night with 340 points
       already banked must not fire a +340 celebration — the player did not
       just earn it, they earned it twenty minutes ago. */
    var first = (AYOU_LAST === null);
    var gain  = first ? 0 : (n - AYOU_LAST);
    b.textContent = String(n);
    AYOU_LAST = n;
    if(gain > 0){
      var up = document.getElementById('ayouUp');
      if(up){
        up.textContent = '+' + gain;
        up.classList.remove('go');
        void up.offsetWidth;               /* restart the animation */
        up.classList.add('go');
      }
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
  }catch(_){}
}
/* The two moments the number can have moved: the board repainted, or
   recomputeScore() said the total changed. It dispatches stats:score only
   when the total ACTUALLY moved, so this cannot loop. */
try{ window.addEventListener('stats:score', function(){ paintYou(); }); }catch(_){}
"""


def main():
    s = io.open(SRC, encoding='utf-8').read()
    done = []

    # THE GUARD MUST NAME THE THING, NOT A FRAGMENT OF IT. The first
    # version tested `'ayou' in s` and refused to run on a clean file,
    # because "layout" contains "ayou". That is the same substring bug as
    # indexOf('NBA') matching inside "WNBA" — the oldest one in this repo,
    # and it appeared three times in one evening. Test the identifier.
    if '#ayou{' in s or 'id="ayou"' in s:
        sys.exit('ABORT: already applied')

    # 1. CSS, after the CLOSE of :root. Anchoring on a comment inside the
    #    block is how two patches this evening nested their rules and handed
    #    them :root specificity; one of them silently lost a font on iOS
    #    16.5-17.1. Assert the position.
    ri = s.index(':root{')
    close = s.index('\n  }\n', ri) + len('\n  }\n')
    s = s[:close] + '\n' + CSS + s[close:]
    if s.index('#ayou{') < close:
        sys.exit('ABORT css: the counter rules landed inside :root')
    done.append('css')

    # 2. the reader, defined immediately before renderGametime uses it
    anchor = 'function renderGametime(){'
    if s.count(anchor) != 1:
        sys.exit('ABORT writer: expected 1 renderGametime, found %d' % s.count(anchor))
    s = s.replace(anchor, WRITER + '\n' + anchor)
    done.append('writer')

    # 3. call it at the END of renderGametime — BRACE-MATCHED, not text-anchored.
    #    The first version anchored on "}\nfunction gtTeams(" on the assumption
    #    that gtTeams followed. It does not; a SHOT ZONES comment block does.
    #    The assert caught it instead of patching the wrong function, which is
    #    the entire reason these scripts assert. A text anchor encodes a guess
    #    about neighbouring code; brace-matching encodes the actual structure.
    i = s.index('function renderGametime(){')
    d = 0
    j = i + len('function renderGametime(')
    while j < len(s):
        if s[j] == '{':
            d += 1
        elif s[j] == '}':
            d -= 1
            if d == 0:
                break
        j += 1
    else:
        sys.exit('ABORT call: renderGametime has no closing brace')
    s = s[:j] + '  try{ paintYou(); }catch(_){}\n' + s[j:]
    done.append('call')

    io.open(SRC, 'w', encoding='utf-8').write(s)
    print('arcade counter applied to %s' % SRC)
    for d in done:
        print('   ok  %s' % d)


if __name__ == '__main__':
    main()
