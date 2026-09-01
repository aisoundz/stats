#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tape_card.py — THE TAPE, ON HOME. One question a day, no game required.

    python3 host/tape_card.py index-test.html

Every other surface in this product needs a live game. The Tape needs
yesterday — it is the transferable mechanic from the Fliff read, recorded
30 Aug: "a reason to open the app when no game is on. We have never had
one."

host/tape.js publishes tape/{date}: one question from a game the 06:20
backtest already resolved, its real options out of the bank, and the true
answer. This is the card that reads it.

IT NEVER PAYS POINTS AND NEVER TOUCHES THE BOARD. Every Tape question is
about a finished game and can be looked up in ten seconds. Paying Points
for it would put a lookup on the same table as a person watching live,
which is the one thing this product sells. The reward is the STREAK, and
the streak counts DAYS PLAYED, not days right — the same rule the season
stat line already follows.

BELOW THE WAY IN, LIKE THE SCHEDULE. A stranger's first job is to press
Play. The Tape is for the person who came back on a Tuesday with nothing
on, and it can wait its turn on the page.

ONE READ. tape/{date} is a single document, cached for the session. A
missing document hides the card completely — on a day the picker did not
run, a player sees the page they had before, not an error.

ANSWERED ONCE A DAY, AND THE ANSWER STICKS. Stored per date in
localStorage, so a refresh cannot farm the streak and cannot re-ask a
question the player has already seen. That is the same reason
recordStatLine() dedupes by night id.
"""
import io, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'index-test.html'

CSS = """  /* ============ THE TAPE — one question a day ======================
     Browse content, below the way in, same as the schedule. Gold because
     it is a thing you KEEP (a streak), and teal already means you. */
  #tapeCard{margin-top:16px}
  #tapeCard .tpHd{display:flex;justify-content:space-between;align-items:baseline;
    gap:12px;margin:0 0 4px}
  #tapeCard .tpHd h2{font-size:17px;margin:0}
  #tapeCard .tpStreak{font-family:var(--ui);font-size:12px;font-weight:700;
    letter-spacing:.1em;color:var(--gold);white-space:nowrap}
  #tapeCard .tpFrom{font-family:var(--ui);font-size:12px;color:var(--dim);
    letter-spacing:.02em;margin:0 0 12px}
  #tapeCard .tpQ{font-size:16px;font-weight:700;color:var(--ink);margin:0 0 12px;
    line-height:1.35}
  #tapeCard .tpOpts{display:flex;flex-direction:column;gap:8px}
  #tapeCard .tpO{display:block;width:100%;text-align:left;padding:12px 14px;
    border-radius:12px;border:1px solid var(--line2);background:var(--card2);
    color:var(--body);font-size:15px;font-weight:600;cursor:pointer}
  #tapeCard .tpO:hover{border-color:var(--line2)}
  #tapeCard .tpO.right{border-color:rgba(46,230,166,.55);color:var(--green)}
  #tapeCard .tpO.wrong{border-color:rgba(255,77,94,.5);color:var(--red)}
  #tapeCard .tpO[disabled]{cursor:default;opacity:.75}
  #tapeCard .tpO.right[disabled],#tapeCard .tpO.wrong[disabled]{opacity:1}
  #tapeCard .tpAfter{font-size:14px;color:var(--muted);margin:12px 0 0}

"""

MARKUP = """
    <!-- ============ THE TAPE ========================================
         One question a day, from a game that finished. The only surface
         in this product that does not need a live game — see
         host/tape_card.py. Hidden until tape/{date} actually loads, so a
         day the picker did not run costs a player nothing. -->
    <div class="card" id="tapeCard" style="display:none;margin-top:16px">
      <div class="tpHd">
        <h2>The Tape</h2>
        <span class="tpStreak" id="tapeStreak"></span>
      </div>
      <p class="tpFrom" id="tapeFrom"></p>
      <p class="tpQ" id="tapeQ"></p>
      <div class="tpOpts" id="tapeOpts"></div>
      <p class="tpAfter" id="tapeAfter" style="display:none"></p>
    </div>
"""

WRITER = r"""
/* ============ THE TAPE — one question a day ==========================
   Reads tape/{date}, a single document published each morning by
   host/tape.js from the backtest archive. No live game required, which is
   the whole point: every other surface here needs one.

   IT NEVER PAYS POINTS AND NEVER TOUCHES THE BOARD. The question is about
   a finished game and can be looked up. The reward is the streak, and the
   streak counts DAYS PLAYED, not days right. */
var TAPE = null, TAPE_KEY = 'stats_tape_';

function tapeToday(){
  try{
    return new Intl.DateTimeFormat('en-CA', { timeZone:'America/Los_Angeles',
      year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  }catch(_){ return new Date().toISOString().slice(0,10); }
}
function tapeSaved(d){ try{ return JSON.parse(localStorage.getItem(TAPE_KEY+d)||'null'); }catch(_){ return null; } }
function tapeSave(d,v){ try{ localStorage.setItem(TAPE_KEY+d, JSON.stringify(v)); }catch(_){} }

/* DAYS PLAYED, NOT DAYS RIGHT. Walks back from today while a day has an
   answer stored. A wrong answer keeps the streak — showing up is the
   thing being counted. */
function tapeStreak(){
  var n=0;
  try{
    var d=new Date();
    for(var i=0;i<400;i++){
      var key=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',
        year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
      if(!tapeSaved(key)) break;
      n++; d=new Date(d.getTime()-86400000);
    }
  }catch(_){}
  return n;
}

function tapeRender(){
  try{
    var card=document.getElementById('tapeCard');
    if(!card || !TAPE || !TAPE.q || !Array.isArray(TAPE.options) || !TAPE.options.length) return;
    var day=TAPE.date || tapeToday();
    var had=tapeSaved(day);

    set('tapeFrom', (TAPE.game ? (TAPE.game + (TAPE.score ? ('  ' + TAPE.score) : '')) : '')
      + (TAPE.from ? ('  ·  ' + TAPE.from) : '')
      + (TAPE.tag ? ('  ·  ' + TAPE.tag) : ''));
    set('tapeQ', TAPE.q);

    var n=tapeStreak();
    set('tapeStreak', n>0 ? (n + ' day' + (n===1?'':'s') + ' in a row') : '');

    var box=document.getElementById('tapeOpts');
    if(box){
      box.innerHTML='';
      TAPE.options.forEach(function(o){
        var b=document.createElement('button');
        b.className='tpO'; b.type='button'; b.textContent=o;
        if(had){
          b.disabled=true;
          if(o===TAPE.answer) b.className='tpO right';
          else if(o===had.said) b.className='tpO wrong';
        } else {
          b.onclick=function(){ tapeAnswer(o); };
        }
        box.appendChild(b);
      });
    }
    var after=document.getElementById('tapeAfter');
    if(after){
      if(had){
        after.style.display='';
        after.textContent = (had.said===TAPE.answer)
          ? 'Right. Come back tomorrow to keep the run going.'
          : ('It was “' + TAPE.answer + '”. The run counts days you showed up, not days you were right.');
      } else { after.style.display='none'; after.textContent=''; }
    }
    card.style.display='';
  }catch(_){}
}

function tapeAnswer(said){
  try{
    if(!TAPE) return;
    var day=TAPE.date || tapeToday();
    if(tapeSaved(day)) return;                 /* once a day, and it sticks */
    tapeSave(day, { said: said, at: Date.now() });
    try{ trk('tape_answer', { right: said===TAPE.answer ? 1 : 0 }); }catch(_){}
    tapeRender();
  }catch(_){}
}

function tapeLoad(){
  try{
    if(TAPE) return;
    if(typeof SB==='undefined' || !SB || typeof SB.tapeFor!=='function') return;
    Promise.resolve(SB.tapeFor(tapeToday())).then(function(t){
      if(!t) return;                           /* no document — stay hidden */
      TAPE=t; tapeRender();
    }).catch(function(){});
  }catch(_){}
}
"""

READER = """  /* ============ THE TAPE — one document, once a session =============
     tape/{date} is published each morning by host/tape.js. A missing
     document is a normal day (the picker had nothing, or has not run) and
     must leave the card hidden rather than surface an error. */
  SB.tapeFor = async function (day) {
    if (!SB.enabled || !F || !db) return null;
    var d = String(day || '');
    if (!d) return null;
    if (SB._tape && SB._tape.d === d) return SB._tape.v;
    try {
      var snap = await F.getDoc(F.doc(db, 'tape', d));
      var v = (snap && snap.exists()) ? (snap.data() || null) : null;
      SB._tape = { d: d, v: v };
      return v;
    } catch (e) { return null; }
  };

"""


def main():
    s = io.open(SRC, encoding='utf-8').read()
    done = []
    if 'tapeCard' in s:
        sys.exit('ABORT: already applied')

    def sub(old, new, tag):
        nonlocal s
        n = s.count(old)
        if n != 1:
            sys.exit('ABORT %s: expected exactly 1 match, found %d' % (tag, n))
        s = s.replace(old, new)
        done.append(tag)

    # 1. CSS after the close of :root, asserted
    ri = s.index(':root{')
    close = s.index('\n  }\n', ri) + len('\n  }\n')
    s = s[:close] + '\n' + CSS + s[close:]
    if s.index('#tapeCard{') < close:
        sys.exit('ABORT css: the tape rules landed inside :root')
    done.append('css')

    # 2. markup, after the schedule card — browse content, below the way in
    anchor = '      <button class="btn ghost" id="schedMore" style="display:none">Show every day</button>\n    </div>\n'
    if s.count(anchor) != 1:
        sys.exit('ABORT markup: could not find the end of the schedule card')
    s = s.replace(anchor, anchor + MARKUP)
    done.append('markup')

    # 3. the reader, beside the other SB readers
    sub("  SB.watchCallIt = function (cb) {", READER + "  SB.watchCallIt = function (cb) {", 'reader')

    # 4. the card
    sub('function renderGametime(){', WRITER + '\nfunction renderGametime(){', 'writer')

    # 5. load it where the landing paints
    sub("  try{ paintInvite(); }catch(_){}\n",
        "  try{ paintInvite(); }catch(_){}\n  try{ tapeLoad(); }catch(_){}\n", 'boot')

    io.open(SRC, 'w', encoding='utf-8').write(s)
    print('tape card applied to %s' % SRC)
    for d in done:
        print('   ok  %s' % d)


if __name__ == '__main__':
    main()
