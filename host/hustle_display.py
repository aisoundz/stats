#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
hustle_display.py — HUSTLE, ON THE SCREEN, AT THE ONE MOMENT IT IS EARNED.

    python3 host/hustle_display.py index-test.html

WHERE, AND WHY NOT THE STATS TAB.
The ledger is PER NIGHT — nights/{id}/hustle/{uid}. A season total would
cost one read per night against a 50,000/day tier, for a number that needs
a server-maintained aggregate to be honest. So the first display shows the
night, on the final screen, beside the rank and the percentile: a night
quantity in a night place. The season wallet comes with the aggregate, and
faking it by fanning out reads would be the kind of number nobody can
audit.

IT GOES IN THE STAT GRID, WHICH IS THE POINT.
The founder's rule: HUSTLE is a box-score stat, never a countable noun.
Not "4 hustles" — `HUSTLE 40`, the way a line reads REB 12. Putting it in
.statgrid next to two other stats is that rule expressed as layout rather
than as a comment somebody has to remember.

.statgrid becomes auto-fit rather than a hardcoded third column: it is
used in three places, and two tiles must still lay out as two.

"—" WHEN UNKNOWN, NEVER 0.
A balance that has not loaded and a balance of zero are different facts,
and this app already has the rule written for the pick sheet: an absent
player shows NOTHING, never 0.0. A rules deploy that had not happened, or
a night the runner never scored, must not read as "you earned nothing".

ONE READ, CACHED PER NIGHT. paintFinalTotals() is called on every
stats:score event while the final screen is up — the ending is repainted
whenever the score moves — so an uncached fetch here would be a read per
repaint.

IT CANNOT BREAK THE ENDING. Every path is caught and the tile simply stays
"—". The final screen is the payoff moment and it has been the smallest
thing on the screen once already; a currency that is not yet visible to
anyone must not be able to damage it.
"""
import io, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'index-test.html'


def main():
    s = io.open(SRC, encoding='utf-8').read()
    done = []

    if 'finalHustle' in s:
        sys.exit('ABORT: already applied')

    def sub(old, new, tag):
        nonlocal s
        n = s.count(old)
        if n != 1:
            sys.exit('ABORT %s: expected exactly 1 match, found %d' % (tag, n))
        s = s.replace(old, new)
        done.append(tag)

    # ---- 1. the grid takes a third tile without breaking the two-tile use
    sub("  .statgrid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:6px}",
        "  /* auto-fit, not a third column: .statgrid is used in three places and\n"
        "     two tiles must still lay out as two. */\n"
        "  .statgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));\n"
        "    gap:9px;margin-top:6px}\n"
        "  /* HUSTLE is gold because gold is what a number you KEEP looks like in\n"
        "     this app, and teal already means YOU. */\n"
        "  .stat.hus .v{color:var(--gold)}",
        'css')

    # ---- 2. the tile
    sub('        <div class="stat"><div class="v" id="finalPct">–</div><div class="k" id="finalPctK"></div></div>\n',
        '        <div class="stat"><div class="v" id="finalPct">–</div><div class="k" id="finalPctK"></div></div>\n'
        '        <!-- HUSTLE. A box-score stat, never a countable noun: the value is\n'
        '             a bare number under the label, the way REB 12 reads. "—" until\n'
        '             the ledger answers, because unknown and zero are not the same\n'
        '             fact — the same rule the pick sheet follows for an absent\n'
        '             player. -->\n'
        '        <div class="stat hus"><div class="v" id="finalHustle">—</div><div class="k">HUSTLE</div></div>\n',
        'tile')

    # ---- 3. the reader, alongside SB.feedFor which it is modelled on
    sub("  SB.watchCallIt = function (cb) {",
        """  /* ============ HUSTLE — read the night's balance ==================
     The ledger is written by the runner with the service account and is
     readable by anyone; firestore.rules bounds it as read:true /
     write:isOwner(), so nothing on a phone can put a number here.

     Cached per night: paintFinalTotals() runs on every stats:score event
     while the ending is up, and an uncached fetch would be a read a
     repaint. Returns null — never 0 — when it cannot answer, because the
     caller must be able to tell "no balance yet" from "earned nothing". */
  SB._husCache = {};
  SB.hustleFor = async function (nid) {
    if (!SB.enabled || !F || !db) return null;
    var id = String(nid || nightId || '');
    if (!id) return null;
    var who = ''; try { who = uid() || ''; } catch (_) { who = ''; }
    if (!who) return null;
    var k = id + '/' + who;
    var c = SB._husCache[k];
    if (c && (Date.now() - c.at) < 15000) return c.v;
    try {
      var snap = await F.getDoc(F.doc(db, 'nights', id, 'hustle', who));
      if (!snap || !snap.exists()) return null;
      var v = snap.data() || {};
      var n = (typeof v.h === 'number') ? v.h : null;
      SB._husCache[k] = { at: Date.now(), v: n };
      return n;
    } catch (e) { return null; }
  };

  SB.watchCallIt = function (cb) {""",
        'reader')

    # ---- 4. paint it when the ending is drawn
    anchor = 'function paintFinalTotals(ms){'
    if s.count(anchor) != 1:
        sys.exit('ABORT paint: expected 1 paintFinalTotals, found %d' % s.count(anchor))
    s = s.replace(anchor, anchor + """
  /* HUSTLE, fetched once and painted when it lands. Fire-and-forget on
     purpose: the ending must draw at full speed whether or not a currency
     nobody has been told about yet answers in time. Every failure leaves
     the tile at "—". */
  try{
    if(typeof SB !== 'undefined' && SB && typeof SB.hustleFor === 'function'){
      var _hid = ''; try{ _hid = (typeof GAME !== 'undefined' && GAME) ? (GAME.nightId || '') : ''; }catch(_){}
      Promise.resolve(SB.hustleFor(_hid)).then(function(h){
        try{
          var el = document.getElementById('finalHustle');
          if(el && typeof h === 'number') el.textContent = String(h);
        }catch(_){}
      }).catch(function(){});
    }
  }catch(_){}
""")
    done.append('paint')

    io.open(SRC, 'w', encoding='utf-8').write(s)
    print('HUSTLE display applied to %s' % SRC)
    for d in done:
        print('   ok  %s' % d)


if __name__ == '__main__':
    main()
