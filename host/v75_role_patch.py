#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v75_role_patch.py — STEP 2 OF THE v7.5 PORT: the hero says WHICH game it is.

    python3 host/v75_role_patch.py index-test.html

WHY THIS ONE FIRST, AHEAD OF THE PRETTIER PARTS OF THE HERO.

31 Aug 2026 cost a whole afternoon to one confusion: the featured game and
the room you are in are TWO facts, and the live hero has never been able to
say which of the two it is showing. TONIGHT held Arsenal at Villa Park while
GAME still held a night from 19 August, and every control on the page read
one or the other with nothing on screen to tell them apart.

v7.5 solved this in its first line. hero(g, id, role) labels itself:

    YOUR ROOM   ·   GAME OF THE NIGHT   ·   ON TONIGHT'S SLATE

That is not decoration. It is the distinction that broke this product today,
printed where a person can see it — and it makes the difference between "the
app is showing me the wrong game" and "the app is showing me tonight's
headline, and my room is elsewhere".

THE SIZES ARE NOT PORTED, AND THAT IS A DECISION WORTH ARGUING WITH.
v7.5 sets this label at 9.5px and its sub-line at 8.5px. The shipped ramp has
a 12px floor, recorded in qa.js because 142 sub-12px sizes were "most of why
the app read as amateur" on a product read from a couch at arm's length. So
the label lands at 12px with .19em tracking and uppercase — which does the
same "this is a label, not content" job that the tiny size was doing, and can
still be read from a sofa. If the founder wants v7.5's exact scale, that is
his call to make deliberately; it is not one to smuggle in inside a patch.

EVERY EXISTING ID SURVIVES. Nothing is removed or renamed — a removed id
turns its writer into a silent no-op, which is the oldest failure mode in
this file. This adds two nodes and one writer, and reads only from owners
that already exist: heroGame(), ACTIVE_ROOM, GAME.nightId, slateGame().
"""
import io, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'index-test.html'

CSS = """  /* ============ WHICH GAME IS THIS — v7.5's role line ==============
     Ported from v75 hero(). 12px, not its 9.5px: the floor is the shipped
     rule and uppercase + wide tracking already reads as a label. Teal only
     when it is YOUR room, because teal means you and nothing else. */
  #mqRole{display:flex;justify-content:space-between;align-items:center;gap:10px;
    font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:.19em;
    text-transform:uppercase;color:var(--muted);margin:0 0 6px;white-space:nowrap}
  #mqRole.mine #mqRoleTxt{color:var(--teal)}
  #mqRole #mqStateTxt{color:var(--dim);letter-spacing:.15em;font-weight:400}

"""

MARKUP = ('      <p id="mqRole" style="display:none">'
          '<span id="mqRoleTxt"></span><span id="mqStateTxt"></span></p>\n')

WRITER = """  /* ============ AND THE HERO SAYS WHICH GAME IT IS =================
     The one thing 31 Aug proved this card could not do. heroGame() already
     decides WHICH game is on the hero; this only reports that decision, so
     there is no second opinion to drift. Reads ACTIVE_ROOM first because
     that is the room this app decided you are in — GAME.nightId only
     changes when hydration succeeds, which is exactly the case that failed
     today. */
  (function(){
    var role='', mine=false, st='';
    try{
      var here='';
      try{ here = (typeof ACTIVE_ROOM!=='undefined' && ACTIVE_ROOM) || (GAME&&GAME.nightId) || ''; }catch(_){}
      var hid = _hg && _hg.nightId;
      /* THE FLAGS LIVE ON THE SLATE ROW, NOT ON TONIGHT. TONIGHT is a HERO,
         not a night: it carries the ids, the tip, the league and the four
         team strings and nothing else. Asking _hg.gotn asked an object that
         never had the field, so a game of the night reported itself as
         merely on the slate. */
      var _row = null;
      try{ if(hid && typeof slateGame==='function') _row = slateGame(hid); }catch(_){}
      if(hid && here && hid===here){ role='Your room'; mine=true; }
      else if(_row && (_row.gotn || _row.marquee || _row.flagship)) role='Game of the night';
      else if(_row) role='On tonight\\u2019s slate';
      /* The state chip is the phase, in this sport's own words, and it says
         nothing at all rather than guessing when the clock cannot answer. */
      try{
        var hs = (typeof heroState==='function') ? heroState() : '';
        st = hs==='live' ? 'Live' : hs==='final' ? (L&&L.End ? L.End : 'Final') : '';
      }catch(_){ st=''; }
    }catch(_){ role=''; }
    set('mqRoleTxt', role);
    set('mqStateTxt', st);
    try{
      var _rl=document.getElementById('mqRole');
      if(_rl){ _rl.classList.toggle('mine', mine); _rl.style.display = role ? 'flex' : 'none'; }
    }catch(_){}
  })();
"""

def main():
    s = io.open(SRC, encoding='utf-8').read()
    done = []

    def sub(old, new, tag):
        nonlocal s
        n = s.count(old)
        if n != 1:
            sys.exit('ABORT %s: expected exactly 1 match, found %d' % (tag, n))
        s = s.replace(old, new)
        done.append(tag)

    if 'mqRole' in s:
        sys.exit('ABORT: mqRole already present — patch is already applied')

    # 1. CSS, AFTER the close of :root. The first version anchored on the
    #    hairline comment, which lives INSIDE the declaration block — the
    #    identical mistake v75_type_patch.py made the same evening, and it
    #    nests the rule and hands it :root specificity for free.
    ri = s.index(':root{')
    close = s.index('\n  }\n', ri) + len('\n  }\n')
    s = s[:close] + '\n' + CSS + s[close:]
    if s.index('#mqRole{') < close:
        sys.exit('ABORT css: the role rule landed inside :root')
    done.append('css')

    # 2. markup, immediately above the eyebrow it qualifies
    sub('      <h2 id="landingHead">Game Night</h2>\n',
        MARKUP + '      <h2 id="landingHead">Game Night</h2>\n', 'markup')

    # 3. the writer, right after _hg/_marquee are computed in applySport()
    sub("  var _hg = heroGame();\n  var _marquee = (_hg !== GAME);\n",
        "  var _hg = heroGame();\n  var _marquee = (_hg !== GAME);\n" + WRITER, 'writer')

    io.open(SRC, 'w', encoding='utf-8').write(s)
    print('v7.5 role patch applied to %s' % SRC)
    for d in done:
        print('   ok  %s' % d)

if __name__ == '__main__':
    main()
