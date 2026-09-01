#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v75_combo_patch.py — THE COMBO, PHASE A: the run is already counted, and
nothing on the round questions has ever been allowed to see it.

    python3 host/v75_combo_patch.py index-test.html

READ THIS BEFORE RUNNING IT. Phase A is PRESENTATION ONLY. It moves no
points, writes no ledger lane, and adds no field to S. If you came here to
add a combo MULTIPLIER, this is the wrong file — see THE HARD BOUNDARY at
the bottom of this header, and take it up with AUTO.tally in admin.html.

--------------------------------------------------------------------------
THE BUG THIS EXISTS TO FIX
--------------------------------------------------------------------------
In answer(), on a correct round question, the shipped file does this:

    /* THE BIGGER MOMENT. A round question is worth many times a Caught It
       ... and more again on a run, which is the behaviour the whole game
       is trying to grow. */
    try{ celebrate((Number(S.streak)||0) >= 3 ? 3 : 2); }catch(_){}

The comment is right about what it wants and wrong about what it reads.
`S.streak` is NIGHTS PLAYED. It is incremented exactly once, at the final
buzzer in showFinal(), and cleared in setMode(); qa/season.js states the
rule outright — "the streak must count nights, not rooms". So the biggest
celebration in the game is currently issued on LOYALTY, not on a run:

  · a player on their third game night gets the full confetti on their
    FIRST correct answer of the evening, before they have strung anything
    together at all;
  · a player on their first night can go eight straight and never once see
    it, because their nights-played counter is 0.

The reward is pointed at the wrong number. That is the whole of the bug.

--------------------------------------------------------------------------
AND THE RUN ALREADY EXISTS — WHICH IS WHY THIS PATCH IS SMALL
--------------------------------------------------------------------------
`streakNow()` has been in this file the whole time, immediately above
praise(), with its own note:

    /* How many correct in a row, counting backwards through the night
       rather than this round only — a run that carries across a quarter
       break is still a run, and is the one most worth naming. */

It derives the run from S.results, backwards, and stops at the first miss.
praise() and praiseSpoken() already read it: the reveal headline says
"THREE IN A ROW" and the voice says it out loud. So the run is counted, and
it is spoken, and the only two places it never reached are the celebration
and the screen.

THEREFORE THIS PATCH ADDS NO NEW STATE. Not S.combo, not a COMBO global,
not a second counter of the same fact. This codebase has been burned four
separate times by exactly that move — three season stores that disagreed,
S.seasonPts vs the statline, PCI living outside the room store, TONIGHT vs
GAME. A cached copy of streakNow() would be a fifth, and it would be the
one that drifts on a resume, because S.results is restored from the save
blob and a cached digit would not be.

The state already lives on S, in the one place progress lives: `S.results`.
save() persists it. setMode() clears it — `S.results = emptyRounds()` on the
same line that clears S.streak — so the run is cleared wherever progress is
cleared, by the existing single writer, with no second reset path added by
this patch. The room store carries it per room for free, because ROOMS
snapshots the whole of S and `results` is not in SESSION_KEYS.

--------------------------------------------------------------------------
WHERE THE RUN MOVES, AND WHERE IT HONESTLY CANNOT
--------------------------------------------------------------------------
Practice / solo: correctness is known the instant you answer. S.results is
pushed at the top of the reveal branch, so a paint right after that push
covers all three outcomes — right, wrong, and the clock running out (a
practice timeout arrives as answer(null), falls past the live branch, and
grades as a miss). One call site, three behaviours.

LIVE: the phone does not know whether you were right until the host's key
lands. That is not a limitation of this patch, it is the rule the whole
holdForHost()/applyHostedScore() apparatus exists to enforce — the app is
not allowed to state a fact about a real game it has not been told. So on a
real night the run is still frozen through the questions and moves at
confirmReview(), which is the one function in this file that fills
S.results, and which is reached from BOTH the practice tap-in grid and the
hosted score path. It lands in the reveal — the moment this file already
calls "the most addictive half-second of the night" — which is the right
place for it anyway.

confirmReview() is documented as idempotent for the ledger and this stays
true for the run, because the run is DERIVED. Scoring the same round twice
recomputes the same number instead of advancing a counter twice. Nothing
here needs an "already counted" guard, which is the second reason not to
cache it.

--------------------------------------------------------------------------
WHAT IS PORTED FROM v7.5, AND THE FOUR THINGS THAT ARE NOT
--------------------------------------------------------------------------
Ported: the interaction from bumpCombo() in v75/v75.html — a chip that
pulses up on the way up and visibly falls on the way down, because
"without a visible downside the upside goes flat".

NOT ported, 1: THE SIZES. v7.5 sets its arcade counters at 8.5 / 9 / 9.5 /
11px. The shipped ramp is [12,14,15,17,20,22,24,26,30,34,40,46,52] with a
12px floor, and qa.js fails on a fourteenth size or anything under it —
because 142 sub-12px sizes were "most of why the app read as amateur" on a
product read from a couch at arm's length. The chip is 12px with a 14px
digit. Both are on the ramp. This is interface-keeper's call and it has
already been made.

NOT ported, 2: THE RED. v7.5 paints the drop red. In this product red means
LIVE (The Arena Book: teal is YOU, blue is the ACT, red is LIVE, green is
CORRECT, gold is the CLOCK). A run is YOU, so the chip is teal; a broken run
goes DIM and slides down. The downside is still visible and red still means
the one thing it means.

NOT ported, 3: THE CAP AT 9. v7.5 caps at 9 because its number is a
MULTIPLIER and ×9 is a design ceiling. Ours is a count of answers in a row,
and a chip reading "9" over a genuine run of twelve is a false number on
screen — which is the one thing claims-desk exists to stop. Four rounds of
four questions tops out at sixteen; two digits fit. No cap.

NOT ported, 4: THE MULTIPLIER ITSELF. See below.

--------------------------------------------------------------------------
THE HARD BOUNDARY: THIS CHANGES NO POINTS
--------------------------------------------------------------------------
Live and round points are re-graded SERVER-SIDE from the submissions by
AUTO.tally, between the @host-shared sentinels in admin.html. If the phone
applied a combo multiplier to live points, the re-grade would overwrite it
and the phone would disagree with the board — that is B37, the night the
founder photographed his own phone reading 135 under a board reading 103.

A points multiplier has to be computed inside AUTO.tally, from the
submissions, so that both sides derive it from the same record. That is a
separate, later change and it is not this one. Phase A: the run shows, the
run drives the celebration's existing intensity, and S.pts is untouched.
No ledgerSet, no new SCORE_LANES entry, no S.pts anywhere in this file.

--------------------------------------------------------------------------
WHAT THIS DELIBERATELY LEAVES ALONE
--------------------------------------------------------------------------
· S.streak stays exactly what it is — nights played. Nothing here reads or
  writes it except the one celebrate() call that was reading it by mistake.
· The voice answer to "what's my streak" (`'You are on ' + st + ' in a
  row.'`, reading S.streak) has the SAME confusion and is NOT touched:
  qa/stats-answers.js pins that sentence to S.streak=3. Fixing it means
  changing the suite in the same commit, which is a separate decision and
  belongs to whoever owns that check.
· streakNow() itself is not modified. It stops a run at any falsy entry,
  which means a partially-graded round truncates rather than skips. That
  understates, never overstates, and it is the existing owner's behaviour.
· celebrate()'s levels are unchanged, and so is the round question's floor
  of 2 — a round question is worth many times a Caught It and still gets
  more than the in-play burst does. Only the INPUT changes.
"""
import io, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'index-test.html'

# --------------------------------------------------------------------------
# 1. THE CHIP
#    12px, 14px digit. Both on the ramp; nothing here is under the floor.
#    Teal because a run is YOU. Dim on the way down because red is LIVE.
#    Under 400px the words drop and it reads "🔥3" — which is exactly the
#    treatment Caught It's .cistreak already ships, so the two runs in this
#    product look like the same idea on the phone they are both read on.
# --------------------------------------------------------------------------
CSS = """  /* ============ THE RUN, WHERE YOU CAN SEE IT =====================
     streakNow() has counted this all night and only the reveal headline
     and the voice have ever been allowed to say it. This is the same
     number, held on screen, so a run is a thing you are protecting rather
     than a thing you are told about after the fact.

     Teal, because a run is YOU and teal means nothing else. Dim on the
     way down rather than v7.5's red, because red in this product means
     LIVE. It sits INSIDE .qmeta and beside #revPill, both of which are
     existing rows with room in them, so a visible run costs zero vertical
     pixels on a 390px phone. */
  .cmb{display:none;align-items:center;gap:5px;flex:0 0 auto;margin:0 6px;
    font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
    color:var(--teal);border:1px solid rgba(40,224,208,.34);
    background:rgba(40,224,208,.09);border-radius:var(--pill);
    padding:3px 9px;line-height:1.15;white-space:nowrap}
  .cmb .cmbN{font-family:var(--mono);font-variant-numeric:tabular-nums;
    font-size:14px;font-weight:900;letter-spacing:0}
  .cmb i{font-style:normal;font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.1em}
  .cmb.cold{color:var(--dim);border-color:var(--line2);background:transparent}
  .cmb.cold .cmbN, .cmb.cold i{color:var(--dim)}
  .cmb.up{animation:cmbUp .42s cubic-bezier(.16,1,.3,1)}
  .cmb.down{animation:cmbDown .5s ease}
  @keyframes cmbUp{0%{transform:scale(1)}38%{transform:scale(1.22)}100%{transform:scale(1)}}
  @keyframes cmbDown{0%{transform:translateY(-6px);opacity:.35}100%{transform:translateY(0);opacity:1}}
  /* The chip shares .qmeta with "Question 3 of 4" and "Worth 10 pts + ⚡".
     On the narrowest phone the words go and the number stays — the same
     call .cistreak already made for the Caught It run. */
  @media (max-width:400px){ .cmb i{display:none} }
  @media (prefers-reduced-motion: reduce){ .cmb.up,.cmb.down{animation:none} }
"""

CHIP = ('<span class="cmb" id="%s" style="display:none">'
        '\U0001F525<b class="cmbN">0</b><i>in a row</i></span>')

# --------------------------------------------------------------------------
# 2. THE WRITER
#    One function, no state. `was` is read off the node the paint is about
#    to change, so the animation direction needs nothing remembered
#    anywhere — and nothing to clear when a room, a mode or a night
#    changes. comboLevel() is the same expression celebrate() already had;
#    only what it reads is different.
# --------------------------------------------------------------------------
WRITER = """/* ============ THE RUN, ON SCREEN ====================================
   PHASE A: PRESENTATION ONLY. Nothing below writes a point, a lane or a
   field on S. Live and round points are re-graded server-side by
   AUTO.tally from the submissions; a multiplier applied on the phone
   would be overwritten by that re-grade and the two would disagree in
   front of the player (B37). A multiplier belongs inside AUTO.tally and
   is a separate change.

   NO NEW COUNTER. streakNow() is the owner of "how many in a row" and it
   derives from S.results, which save() persists and setMode() clears with
   the rest of progress. Caching that digit anywhere would be a second
   store of one fact, which is the failure this file has already paid for
   with three season totals that disagreed. So this reads the owner every
   time it paints, and the only thing it remembers is what the chip
   currently says — read straight off the node, because that is a fact
   about the DOM and not about the night. */
function comboPaint(){
  try{
    var now = 0; try{ now = Number(streakNow()) || 0; }catch(_){ now = 0; }
    var reduced = false; try{ reduced = celebReduced(); }catch(_){}
    clearTimeout(CMB_HIDE_T);
    var nodes = document.querySelectorAll('.cmb');
    for(var i=0;i<nodes.length;i++){
      var el = nodes[i], n = el.querySelector('.cmbN');
      if(!n) continue;
      var was = parseInt(String(n.textContent||''), 10);
      if(!isFinite(was)) was = now;              // first paint: no animation
      n.textContent = String(now);
      /* TWO IS A RUN; ONE IS AN ANSWER. A chip that reads "1 in a row"
         after every single correct answer is wallpaper, and wallpaper is
         what this file already decided a reward must never become. */
      el.classList.toggle('cold', now < 2);
      if(now >= 2){
        el.style.display = 'inline-flex';
      } else if(was >= 2){
        /* AND YOU HAVE TO SEE IT FALL. Hiding a broken run instantly is
           the same as never having shown it: the upside goes flat without
           a visible downside. So it stays up, reading what it now is, for
           long enough to register, and then it goes. */
        el.style.display = 'inline-flex';
      } else {
        el.style.display = 'none';
      }
      if(reduced || was === now) continue;
      el.classList.remove('up','down');
      void el.offsetWidth;                        // restart the animation
      el.classList.add(now > was ? 'up' : 'down');
    }
    if(now < 2){
      CMB_HIDE_T = setTimeout(function(){
        try{
          var l = document.querySelectorAll('.cmb');
          for(var j=0;j<l.length;j++){ l[j].style.display='none'; l[j].classList.remove('up','down'); }
        }catch(_){}
      }, 1200);
    }
  }catch(_){}
}
var CMB_HIDE_T = 0;
/* WHAT THE CELEBRATION SHOULD HAVE BEEN READING ALL ALONG.

   The expression is byte-for-byte the one that shipped — a round question
   never celebrates below level 2, because it is worth many times a Caught
   It and there are only a handful a night. What changes is the NUMBER it
   is handed. It was S.streak, which is nights played, so the full payoff
   fired on a third-night player's first correct answer and never once on
   a first-night player's eight-in-a-row. Loyalty was driving the reward
   the game uses to grow a run. */
function comboLevel(){
  var n = 0; try{ n = Number(streakNow()) || 0; }catch(_){}
  return n >= 3 ? 3 : 2;
}
try{ window.comboPaint = comboPaint; window.comboLevel = comboLevel; }catch(_){}
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

    # Idempotence. Two of these applied on top of each other would give the
    # page two chips with the same id and a comboPaint that walks both.
    if 'comboPaint' in s or 'class="cmb"' in s:
        sys.exit('ABORT: the combo is already present — patch is already applied')
    # And the whole thing is anchored to an owner that must still be here.
    if s.count('function streakNow(){\n') != 1:
        sys.exit('ABORT: streakNow() is not where this patch expects it — '
                 'the run counter this whole patch reads has moved or gone')

    # ---- 1. CSS, immediately after the row it decorates ----------------
    # .worth is the right-hand cell of .qmeta and the chip is its new
    # neighbour, so the rule lands beside the rule it sits next to rather
    # than in a block at the end where nobody looking at .qmeta will find it.
    sub("  .worth{font-size:12px;font-weight:800;color:var(--teal2)}\n",
        "  .worth{font-size:12px;font-weight:800;color:var(--teal2)}\n" + CSS,
        'css')

    # ---- 2a. the chip, in the question's eyebrow row -------------------
    # BETWEEN the two cells that are already there. .qmeta is
    # justify-content:space-between, so a third child costs no height and
    # the chip lands in the middle of a row the player is already reading.
    sub('          <span class="qn" id="qCount">Question 1 of 3</span>\n'
        '          <span class="worth" id="qWorth">Worth 1 pt</span>\n',
        '          <span class="qn" id="qCount">Question 1 of 3</span>\n'
        '          ' + (CHIP % 'cmbQ') + '\n'
        '          <span class="worth" id="qWorth">Worth 1 pt</span>\n',
        'markup-question')

    # ---- 2b. and beside the review pill --------------------------------
    # THIS IS THE ONE THAT MATTERS ON A REAL NIGHT. In live mode the phone
    # cannot know it was right until the host's key lands, so the run does
    # not move during the questions — it moves at confirmReview(), and the
    # player is standing on the review screen when it does. A chip that
    # only existed on the question screen would be a practice-mode feature.
    sub('<div class="center" style="margin-top:6px">'
        '<span class="pill" id="revPill">Score Q1</span></div>',
        '<div class="center" style="margin-top:6px">'
        '<span class="pill" id="revPill">Score Q1</span>'
        + (CHIP % 'cmbR') + '</div>',
        'markup-review')

    # ---- 3. the writer, directly beneath its owner ---------------------
    # streakNow() is immediately above praise(). Putting comboPaint() and
    # comboLevel() between them keeps the three readers of one number in
    # one place, which is the only reason this file has one number.
    sub('function praise(){\n', WRITER + 'function praise(){\n', 'writer')

    # ---- 4. paint when a question opens --------------------------------
    # So a run carried in from the previous quarter is on screen BEFORE the
    # answer, not announced after it. The anticipation is the point.
    sub("  document.getElementById('qCount').textContent=`Question ${S.ni+1} of ${nq()}`;\n",
        "  document.getElementById('qCount').textContent=`Question ${S.ni+1} of ${nq()}`;\n"
        "  /* The run the player is carrying INTO this question. v7.5's note: the\n"
        "     anticipation is worth more than the payout, so it is on screen before\n"
        "     the answer is locked, not after it is graded. */\n"
        "  try{ comboPaint(); }catch(_){}\n",
        'paint-on-open')

    # ---- 5. paint on the practice/solo grade ---------------------------
    # ONE call site, three outcomes. This line runs before the correct/wrong
    # branch splits, so right, wrong and a practice clock-out (which arrives
    # as answer(null) and grades as a miss) are all covered by it — and
    # streakNow() reads the push that just happened, exactly as praise()
    # two lines below it already does.
    sub("  S.results[S.qi].push(correct);\n",
        "  S.results[S.qi].push(correct);\n"
        "  /* The run, repainted off the answer that just landed. Before the\n"
        "     branch below, so a miss and a time-out drop it the same way a\n"
        "     right answer raises it — one writer, three outcomes. */\n"
        "  try{ comboPaint(); }catch(_){}\n",
        'paint-on-answer')

    # ---- 6. point the celebration at the run ---------------------------
    sub("    try{ celebrate((Number(S.streak)||0) >= 3 ? 3 : 2); }catch(_){}\n",
        "    /* IT WAS READING NIGHTS PLAYED. S.streak increments once, at the\n"
        "       final buzzer, and qa/season.js pins it to nights rather than\n"
        "       rooms — so the full payoff fired on a third-night player's FIRST\n"
        "       correct answer and never once on a first-night player's eight in\n"
        "       a row. Same two levels, same floor of 2; the number handed to it\n"
        "       is now the run this sentence has always claimed to describe. */\n"
        "    try{ celebrate(comboLevel()); }catch(_){}\n",
        'celebrate-reads-the-run')

    # ---- 7. paint on the live grade ------------------------------------
    # confirmReview() is the only thing in this file that fills S.results,
    # and applyHostedScore() calls it. Anchored on the flash that already
    # marks this moment, AFTER the forEach that fills the round, so the
    # paint sees the whole quarter rather than one question of it. It is
    # derived, so a round scored twice recomputes instead of double-counting.
    sub("  try{ flashEnergy(got>0?'hit':'miss', 2600); }catch(_){}\n",
        "  try{ flashEnergy(got>0?'hit':'miss', 2600); }catch(_){}\n"
        "  /* THE RUN, ON THE ONLY PATH A REAL NIGHT HAS. The phone is not\n"
        "     allowed to know it was right until the host's key lands, so on a\n"
        "     live night this is where the run moves — in the reveal, which is\n"
        "     the moment this screen already exists to make feel like something.\n"
        "     Derived from S.results, so scoring the same round twice repaints\n"
        "     the same number instead of advancing a counter twice. */\n"
        "  try{ comboPaint(); }catch(_){}\n",
        'paint-on-review')

    # ---- 8. and it says it in Spanish ----------------------------------
    # Two words of new English on screen. qa/spanish.js walks the visible
    # strings and reports what nobody has translated yet; a string that
    # ships without its entry is how coverage decays one patch at a time.
    # "seguidas" agrees with respuestas — answers — which is what is being
    # counted.
    sub('    "Streak":"Racha",\n',
        '    "Streak":"Racha",\n'
        '    "in a row":"seguidas",\n',
        'i18n')

    io.open(SRC, 'w', encoding='utf-8').write(s)
    print('v7.5 combo patch (Phase A — presentation only) applied to %s' % SRC)
    for d in done:
        print('   ok  %s' % d)
    print('\n   NO POINTS CHANGED. Re-read the header before adding a multiplier.')
    print('   Gate: node qa/qa.js  ·  node qa/celebrate.js  ·  node qa/payoff.js')
    print('         node qa/journey.js --engine webkit --phone')
    print('   Then measure .qmeta on a real phone at 390px — three cells now.')


if __name__ == '__main__':
    main()
