#!/usr/bin/env node
/* =====================================================================
   THE REWARD MOMENT MUST NOT BE THE SMALLEST THING ON THE SCREEN.
   ---------------------------------------------------------------------
   MEASURED 18 Aug 2026 on a 390x844 phone, at the instant a player got a
   question right:

     "✓ CORRECT · +10 pts"   12px   — the FLOOR of the type ramp
     the two team scores     40px   — already visible on their television
     their own points        52px   — at y=919, BELOW THE FOLD

   The number that changed because of what they just did was the least
   prominent thing in front of them, and their own total was off-screen.
   Sixteen times a night, against four round summaries.

   This suite asserts the three things that were measured wrong, in a
   REAL browser at a REAL phone size, because every one of them is a
   question about rendered geometry and none of them can be answered by
   reading the source:

     1. the payoff is the biggest text in the reveal, not the smallest
     2. the player's own total is ABOVE THE FOLD when it changes
     3. the number MOVES — it counts, it does not snap

   It is written to fail in both directions: shrinking the payoff must go
   red, and so must removing the count. Run --sabotage to prove that.

       node qa/payoff.js [index-test.html]
       node qa/payoff.js --sabotage
   ================================================================== */
const {chromium}=require('playwright');
const path=require('path'), fs=require('fs');
const TARGET=path.resolve(process.argv.find(a=>/\.html$/.test(a)) || path.join(__dirname,'..','index-test.html'));
const SABOTAGE=process.argv.includes('--sabotage');

let pass=0, fail=0; const bad=[];
const ok=(n,c,d)=>{ if(c) pass++; else { fail++; bad.push(n+(d?'  — '+d:'')); } };

/* A phone, not a desktop. The whole finding was about the fold. */
const PHONE={width:390, height:844};

(async()=>{
  const b=await chromium.launch();
  const p=await b.newPage({viewport:PHONE, deviceScaleFactor:3});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,120)));

  let html=fs.readFileSync(TARGET,'utf8');
  if(SABOTAGE){
    /* Put the old, broken hierarchy back: the payoff at the ramp floor and
       the total snapping instead of counting. Every check below must go
       red, or the check is decoration. */
    html=html.replace(/\.payoff \.pn\{font-size:46px/, '.payoff .pn{font-size:12px');
    html=html.replace(/try\{ countTo\('revNow', wasPts, S\.pts, 900\); \}catch\(e\)\{\}/,
                      "try{ document.getElementById('revNow').textContent=S.pts; }catch(e){}");
  }
  const tmp=path.join(require('os').tmpdir(),'payoff-under-test.html');
  fs.writeFileSync(tmp, html);
  await p.goto('file://'+tmp);
  await p.waitForFunction(()=>typeof window.countTo==='function',{timeout:15000});

  /* Drive a real correct answer through the real render path. Building the
     markup by hand would test the test. */
  /* DRIVE THE REAL answer(), NOT A COPY OF ITS MARKUP.
     The first version of this suite built the reveal HTML itself and then
     asserted things about it — which measured the SUITE's idea of the
     payoff, not the app's. It passed the count-sabotage happily, because
     the app's countTo call was never on the path. A check that cannot see
     the code it is protecting is decoration with a green tick on it. */
  const shot=await p.evaluate(async()=>{
    /* PRACTICE, NOT LIVE — and this is a real property of the product, not
       a convenience. In a live room an answer is a CHANGEABLE PICK: the
       app says "changed your mind? nothing's final until you hit the
       button below" and grades nothing, because revealing whether you were
       right before the question settles would let one player tell the
       others. The payoff block therefore renders on the GRADED path, which
       is what practice reaches directly and what a live room reaches after
       the lock. Same code, same markup, one step earlier. */
    /* DO NOT FAKE S.pts. Points are RECOMPUTED from the ledger, never
       accumulated (the rule from Game Night #6, and the reason six code
       paths could not corrupt a score). Setting S.pts=310 by hand and then
       answering made ledgerSet recompute it to 10 — so the payoff counted
       310 DOWN to 10 and the suite happily called that "the total moves".
       Let the app own its own number and the count is real. */
    S.mode='practice'; S.place='play'; S.qi=0; S.ni=0; S.answered=false;
    S.results=[[]];
    try{ go('gametime'); }catch(_){}
    document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
    document.getElementById('s-gametime').classList.add('active');
    const gtr=document.getElementById('gtReview'); if(gtr) gtr.style.display='none';
    /* #gtQuestion holds the question, the options and the reveal, and is
       display:none until a round opens — the state a player is NOT in at
       the moment this suite is about. A .screen without .active, or a
       hidden panel, has no layout box: every rect reads 0x0 at y=0, which
       looks exactly like "below the fold" when the truth is "not
       rendered". The first run of this suite reported a fold failure that
       did not exist for precisely that reason. */
    const qp=document.getElementById('gtQuestion'); if(qp) qp.style.display='block';

    /* USE THE APP'S OWN QUESTION, and answer it CORRECTLY.
       Injecting `window.rounds` did nothing: `rounds` is a module-scoped
       `let` that setSport() reassigns, so the assignment created an
       unrelated global and answer() went on grading against the real
       practice bank — marking the injected answer wrong and rendering the
       miss branch. Reading the real question is better anyway: it proves
       the payoff renders for a question the product actually ships. */
    const q = rounds[S.qi].q[S.ni];
    const right = q.a;
    const opts=document.getElementById('qOpts');
    opts.innerHTML=(q.o||[]).map(o=>
      `<button class="opt" data-l="${String(o).replace(/"/g,'&quot;')}"><span class="mk"></span>${o}</button>`).join('');
    const btn=opts.querySelector('.opt[data-l="'+String(right).replace(/"/g,'\\"')+'"]')
              || opts.querySelector('.opt');

    const box=document.getElementById('revealBox');
    if(!box) return {err:'no revealBox'};

    const before=S.pts;
    try{ answer(right, btn); }catch(e){ return {err:'answer() threw: '+(e&&e.message)}; }

    const now=()=>{ const el=document.getElementById('revNow'); return el?el.textContent:null; };
    const first=now();
    if(first===null) return {err:'answer() did not render the payoff block (#revNow missing). reveal was: '+box.innerHTML.replace(/\s+/g,' ').slice(0,300)};
    /* Sample mid-flight: a number that MOVES is between the two; a number
       that snapped is already at its final value on the first frame. */
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const mid=now();
    await new Promise(r=>setTimeout(r,1400));
    const end=now();

    const px=el=>el?parseFloat(getComputedStyle(el).fontSize):0;
    const rev=box.querySelector('.reveal');
    if(!rev) return {err:'no .reveal rendered'};
    const payoffN=[...box.querySelectorAll('.payoff .pn')].map(px);
    const others=[...rev.querySelectorAll('*')]
      .filter(el=>!el.closest('.payoff') && el.textContent.trim() && !el.children.length)
      .map(px);
    const t=document.getElementById('revNow').getBoundingClientRect();
    const r1=rev.querySelector('.r1');
    return { first, mid, end, before, after:S.pts,
             payoffMax: Math.max(0,...payoffN),
             revealMax: Math.max(0,...others),
             totalTop: t.top, totalBottom: t.bottom,
             viewportH: window.innerHeight,
             praise: r1?r1.textContent.trim():'' };
  });

  if(shot.err){ console.log('could not render: '+shot.err); process.exit(1); }

  /* ---- 1. THE PAYOFF IS THE BIGGEST THING IN ITS OWN BLOCK ---------- */
  ok('payoff.is-not-the-smallest-thing',
     shot.payoffMax > shot.revealMax,
     `payoff ${shot.payoffMax}px vs largest other text in the reveal ${shot.revealMax}px`);
  /* And big in absolute terms, not merely bigger than a label. The team
     scores — which the player can already see on television — are 40px. */
  ok('payoff.is-bigger-than-the-scoreboard-it-competes-with',
     shot.payoffMax >= 40,
     `payoff is ${shot.payoffMax}px; the team scores it sits under are 40px`);

  /* ---- 2. THEIR OWN TOTAL IS ON THE SCREEN WHEN IT CHANGES ---------- */
  ok('payoff.your-total-is-above-the-fold',
     shot.totalBottom > 0 && shot.totalBottom <= shot.viewportH,
     `total sits at y=${Math.round(shot.totalTop)}..${Math.round(shot.totalBottom)} in a ${shot.viewportH}px viewport — the player has to scroll to watch their own score move`);

  /* ---- 3. THE NUMBER MOVES ------------------------------------------ */
  ok('payoff.the-total-counts-rather-than-snapping',
     shot.mid !== shot.end,
     `first=${shot.first} mid=${shot.mid} end=${shot.end} — the total was already at its final value on the first frame`);
  ok('payoff.the-total-arrives-at-the-right-number',
     shot.end === String(shot.after),
     `ended on ${shot.end}, but the player's real total is ${shot.after}`);
  ok('payoff.the-total-starts-from-where-they-were',
     shot.first === String(shot.before),
     `started on ${shot.first}, but they were on ${shot.before} — it counted from the answer to the answer`);

  /* ---- 4. AND IT SAYS THEY WERE WATCHING ---------------------------- */
  ok('payoff.says-they-were-watching-not-lucky',
     /SAW|CALLED|WATCHING|CAUGHT|EYES|ROW|STRAIGHT/.test(shot.praise),
     `the line was "${shot.praise}"`);
  ok('payoff.no-sportsbook-vocabulary',
     !/\b(cash|payout|action|odds|wager|bet|lock it in|that's a lock)\b/i.test(shot.praise),
     `"${shot.praise}" reads like a sportsbook, which is the one thing this moment may not do`);

  ok('payoff.no-page-errors', errs.length===0, errs.slice(0,2).join(' · '));

  await b.close();
  const verdict = fail? 'RED' : 'GREEN';
  console.log(`\n${verdict}   ${pass} passed, ${fail} failed${SABOTAGE?'   [SABOTAGED — red is the correct result]':''}   [${path.basename(TARGET)}]`);
  bad.forEach(x=>console.log('   x '+x));
  /* Under --sabotage the meanings inverts: passing is the failure. */
  if(SABOTAGE){ process.exit(fail?0:1); }
  process.exit(fail?1:0);
})();
