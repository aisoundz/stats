#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
schedule_menu.py — THE NEXT TWO WEEKS, ON THE PAGE.

    python3 host/schedule_menu.py index-test.html

FOUNDER, 31 Aug 2026: "We should also have our schedule for the next two
weeks in our menu so people know what games are coming as well."

WHERE IT GOES, AND WHY THAT IS NOT ARBITRARY.
After #portalCard, which holds "Try a practice round". qa/way-in.js failed
this very evening because a label ABOVE that control pushed it from y=583
to y=605 on a 360x640 Android — below the fold, where a stranger who does
not scroll never presses it. The schedule is browse content: somebody
reading it has already decided to look around. It goes BELOW the way in and
can never compete with it.

NO FIFTH TAB. Home, Stats, Gametime, Board — the middle two spell the
product and there are four of them. The schedule lives on Home.

IT COSTS ZERO FIRESTORE READS. schedule.json is a static file on the same
origin, written by host/build-schedule.js from the pick files. Fourteen
days read from Firestore on every page load would be fourteen reads against
a 50,000/day free tier, for a list that changes once a morning. See the
standing "conserve resources" rule.

FOUR THINGS IT REFUSES TO DO, each of which is a bug this product has
already shipped once:

  * IT NEVER LISTS A GAME NOBODY HOSTS. build-schedule.js iterates the PICK
    FILE and looks each nightId up in the manifest, so an unhosted game
    cannot reach this file. The renderer adds no second opinion.
  * IT NEVER SAYS "TONIGHT". The file is static and may be read hours after
    it was written; a baked-in "tonight" is the stale-tonight failure the
    email voice rules already forbid. Every relative word is computed here,
    from the reader's own clock.
  * IT NEVER SHOWS THE GAME NIGHT NUMBER. Those integers are incoherent
    past 3 Sept — one file counts 48/49/50, the next restarts at 1, another
    has none. A number on screen is a claim. Until the meaning is settled
    it is not displayed.
  * IT NEVER INVENTS A DAY. A date with no pick file is UNBUILT, which is a
    different fact from a day with no games, and it says so.

DEGRADES TO NOTHING. If schedule.json is missing, stale or malformed the
card stays hidden. A schedule section showing an error is worse than no
schedule section: the page still works, and the person came to play.
"""
import io, sys, re

SRC = sys.argv[1] if len(sys.argv) > 1 else 'index-test.html'

CSS = """  /* ============ THE NEXT TWO WEEKS ==================================
     Browse content, below the way in. Rows, not cards: fourteen cards is a
     scroll nobody finishes, and the question a person has here is "what
     day" and "who", in that order. */
  #schedCard{margin-top:16px}
  #schedCard .schHead{display:flex;justify-content:space-between;align-items:baseline;
    gap:12px;margin:0 0 12px}
  #schedCard .schHead h2{font-size:17px;margin:0}
  #schedCard .schSub{font-family:var(--ui);font-size:12px;color:var(--dim);
    letter-spacing:.02em;white-space:nowrap}
  .schDay{display:grid;grid-template-columns:78px minmax(0,1fr);gap:12px;
    padding:10px 0;border-top:1px solid var(--line)}
  .schDay:first-of-type{border-top:0}
  .schDay .schWhen{font-family:var(--ui);font-size:12px;font-weight:700;
    letter-spacing:.1em;text-transform:uppercase;color:var(--muted);padding-top:2px}
  .schDay.today .schWhen{color:var(--teal)}
  .schGames{display:flex;flex-direction:column;gap:7px;min-width:0}
  .schG{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;min-width:0}
  .schG .schT{font-size:14px;color:var(--body);min-width:0;overflow-wrap:anywhere}
  .schG .schL{font-family:var(--ui);font-size:12px;font-weight:700;letter-spacing:.09em;
    text-transform:uppercase;color:var(--dim);flex:none}
  .schG .schTime{font-family:var(--mono);font-size:12px;color:var(--muted);
    font-variant-numeric:tabular-nums;flex:none}
  /* The main event is marked, not shouted. One mark, the same teal that
     means YOU everywhere else would be wrong here -- gold is the points
     colour and this is the game worth the most attention. */
  .schG.main .schT{color:var(--ink);font-weight:600}
  .schG.main .schStar{color:var(--gold);flex:none;font-size:12px}
  .schNone{font-size:13.5px;color:var(--dim)}
  #schedMore{margin-top:12px;width:100%}

"""

MARKUP = """
    <!-- ============ THE NEXT TWO WEEKS ==============================
         Founder, 31 Aug: "We should also have our schedule for the next
         two weeks in our menu so people know what games are coming."
         Below the way in on purpose -- see host/schedule_menu.py. Hidden
         until schedule.json actually loads, so a missing file costs a
         person nothing. -->
    <div class="card" id="schedCard" style="display:none;margin-top:16px">
      <div class="schHead">
        <h2>What's coming</h2>
        <span class="schSub" id="schedSub"></span>
      </div>
      <div id="schedList"></div>
      <button class="btn ghost" id="schedMore" style="display:none">Show all 14 days</button>
    </div>
"""

WRITER = r"""
/* ============ THE NEXT TWO WEEKS =====================================
   Reads schedule.json, a static file on this origin written each morning
   by host/build-schedule.js. Zero Firestore reads: fourteen days on every
   page load would spend fourteen reads of a 50,000/day tier on a list that
   changes once a day.

   Every relative word ("Today", "Tomorrow") is computed from the READER'S
   clock, never baked into the file. A static asset opened six hours later
   that still says "tonight" is the stale-tonight bug, and this product has
   shipped it before. */
var SCHED = null, SCHED_ALL = false;

function schedDayKeyPT(d){
  /* The product's day is a Pacific day -- the founder is in Anaheim and
     every pick file is named for a PT date. Deriving "today" from the
     device's own timezone would put a player in London a day ahead of the
     slate. */
  try{
    return new Intl.DateTimeFormat('en-CA', { timeZone:'America/Los_Angeles',
      year:'numeric', month:'2-digit', day:'2-digit' }).format(d);
  }catch(_){
    return d.toISOString().slice(0,10);
  }
}

function schedRender(){
  try{
    var card = document.getElementById('schedCard');
    var list = document.getElementById('schedList');
    if(!card || !list || !SCHED || !SCHED.days) return;
    var todayKey = schedDayKeyPT(new Date());

    /* A day that has already happened is not "coming". Dropped by DATE
       STRING, not by parsing a tip time -- a game in progress still belongs
       to today, and comparing timestamps would make the row vanish
       mid-match. */
    var days = SCHED.days.filter(function(d){ return String(d.date) >= todayKey; });
    if(!days.length){ card.style.display='none'; return; }

    var shown = SCHED_ALL ? days : days.slice(0, 5);
    var html = '';
    shown.forEach(function(d){
      var isToday = (String(d.date) === todayKey);
      var when;
      if(isToday) when = 'Today';
      else {
        /* "Tomorrow" is computed, never stored. */
        var t = new Date(); t.setDate(t.getDate() + 1);
        when = (String(d.date) === schedDayKeyPT(t)) ? 'Tomorrow'
             : String(d.label || d.date).replace(/,.*$/, '') + ' ' + String(d.date).slice(8);
      }
      html += '<div class="schDay' + (isToday ? ' today' : '') + '">'
            +   '<div class="schWhen">' + esc(when) + '</div>'
            +   '<div class="schGames">';
      var g = (d.games || []);
      if(!g.length){
        /* THREE STATES, NEVER MERGED. "Not announced yet" and "no games"
           are different facts and a person can act on the difference. */
        html += '<div class="schNone">'
              + (d.status === 'unbuilt' ? 'Not announced yet' : 'No rooms this day')
              + '</div>';
      } else {
        g.forEach(function(x){
          var main = !!(x.mainEvent || x.featured);
          html += '<div class="schG' + (main ? ' main' : '') + '">'
                + (x.mainEvent ? '<span class="schStar">★</span>' : '')
                + '<span class="schL">' + esc(String(x.leagueLabel || x.league || '')) + '</span>'
                + '<span class="schT">' + esc(String(x.matchup || '')) + '</span>'
                + '<span class="schTime">' + esc(String(x.tipPT || '')) + '</span>'
                + '</div>';
        });
      }
      html += '</div></div>';
    });
    list.innerHTML = html;

    var sub = document.getElementById('schedSub');
    if(sub){
      var n = days.reduce(function(a,d){ return a + ((d.games||[]).length); }, 0);
      sub.textContent = n ? (n + ' game' + (n===1?'':'s') + ' scheduled') : '';
    }
    var more = document.getElementById('schedMore');
    if(more){
      more.style.display = (days.length > 5 && !SCHED_ALL) ? '' : 'none';
      more.textContent = 'Show all ' + days.length + ' days';
    }
    card.style.display = '';
  }catch(_){}
}

function schedLoad(){
  try{
    /* Cache-busted on the build stamp: a person on yesterday's cached page
       would otherwise read yesterday's schedule and never know. */
    var v = '';
    try{ v = '?v=' + encodeURIComponent(BUILD || ''); }catch(_){}
    fetch('schedule.json' + v, { cache:'no-cache' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if(!j || !j.days || !j.days.length) return;   /* stay hidden */
        SCHED = j;
        schedRender();
      })
      .catch(function(){ /* stay hidden -- the page still works */ });
  }catch(_){}
}
try{
  document.addEventListener('click', function(e){
    var b = e.target && e.target.closest && e.target.closest('#schedMore');
    if(!b) return;
    SCHED_ALL = true; schedRender();
  });
}catch(_){}
"""


def main():
    s = io.open(SRC, encoding='utf-8').read()
    done = []

    if 'schedCard' in s:
        sys.exit('ABORT: already applied')

    # ---- 1. CSS, after the CLOSE of :root, asserted ----------------------
    ri = s.index(':root{')
    close = s.index('\n  }\n', ri) + len('\n  }\n')
    s = s[:close] + '\n' + CSS + s[close:]
    if s.index('#schedCard{') < close:
        sys.exit('ABORT css: the schedule rules landed inside :root')
    done.append('css')

    # ---- 2. markup, AFTER the portalCard div closes ----------------------
    #    Tag-matched, not text-anchored: portalCard is ~90 lines of nested
    #    markup and comments, and a text anchor would encode a guess about
    #    whatever happens to sit at its end today. An anchor that drifts is
    #    how a patch silently lands in the wrong place.
    i = s.index('<div class="card" id="portalCard"')
    depth, j = 0, i
    while j < len(s):
        if s.startswith('<div', j):
            depth += 1; j += 4; continue
        if s.startswith('</div>', j):
            depth -= 1; j += 6
            if depth == 0:
                break
            continue
        j += 1
    else:
        sys.exit('ABORT markup: portalCard never closes')
    s = s[:j] + '\n' + MARKUP + s[j:]
    done.append('markup')

    # ---- 3. the reader ---------------------------------------------------
    anchor = 'function renderGametime(){'
    if s.count(anchor) != 1:
        sys.exit('ABORT writer: expected 1 renderGametime, found %d' % s.count(anchor))
    s = s.replace(anchor, WRITER + '\n' + anchor)
    done.append('writer')

    # ---- 4. load it once, where the landing is already painted -----------
    boot = "  try{ paintYou(); }catch(_){}\n"
    if s.count(boot) != 1:
        sys.exit('ABORT boot: expected the arcade counter call exactly once, found %d'
                 % s.count(boot))
    s = s.replace(boot, boot + "  try{ if(!SCHED) schedLoad(); }catch(_){}\n")
    done.append('boot')

    io.open(SRC, 'w', encoding='utf-8').write(s)
    print('schedule menu applied to %s' % SRC)
    for d in done:
        print('   ok  %s' % d)


if __name__ == '__main__':
    main()
