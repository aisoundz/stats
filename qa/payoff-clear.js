#!/usr/bin/env node
/* =====================================================================
   NOTHING IS DRAWN ACROSS THE REWARD MOMENT.
   ---------------------------------------------------------------------
   Founder, 25 Aug 2026: on every correct answer, on every quarter, the
   confetti fires, "+10" and the new total go big and green — and "See the
   leaderboard →" is painted straight across the bottom half of that
   panel. THIS ONE and YOUR POINTS render under the tab bar, and the
   button runs off the right edge as well.

   MEASURED ON THE SHIPPED BUILD at 360x640, driving a real correct answer
   through the real answer():

       .reveal                542 – 646
       .payoff                582 – 631      the +10 and the running total
       THIS ONE / YOUR POINTS 616 – 631
       #nextBtn               514 – 564      fixed, over both numbers
       #botnav                574 – 640      and the labels under the bar
       #nextBtn horizontally   14 – 374      in a 360px window

   THIS IS THE SECOND TIME THIS FIGHT HAS BEEN HAD. On 18 Aug the payoff
   was 12px — the floor of the type ramp — beside a 40px scoreboard the
   player could already see on their television, and qa/payoff.js was
   written to keep it the biggest thing on the screen. It is 46px now and
   it was losing the same fight to a button. payoff.js asks "is it big and
   is the total on screen"; this file asks the other half: IS ANYTHING ON
   TOP OF IT.

   THREE CAUSES, all of them measured rather than reasoned:

     1. `.btn` sets width:100%, and 100% of a fixed element's containing
        block is the whole viewport — so with left:14px also set, the
        browser honoured the left and ignored the right:14px that was in
        the rule the whole time. 14px off the right edge on every phone
        narrow enough to pin the button.
     2. liveFitPin() decides whether to pin ONCE, at the instant the
        button is shown, and asks only whether the BUTTON clears the tab
        bar. The reveal did not exist when it was written, and the panel
        is the last thing in the flow the pinned button floats over.
     3. The nudge under answer() measured the last ANSWER OPTION against
        the button and nothing else. The panel renders below the options.

   WHAT THIS SUITE ASSERTS, at four sizes, after the beat has settled:

     · no part of the reward panel is under the pinned button
     · no part of it is under the tab bar
     · the button itself is inside the window and above the tab bar
     · the payoff is still the biggest text in the reveal, and the total
       still counts — because a fix that moved the button by shrinking
       the number would pass every check above and lose the argument
     · and the MISS panel is not covered either. Being told you got it
       wrong, from behind a button, is the same bug wearing a worse mood.

   ON TIMING, which is most of why this file is careful. `.screen` carries
   `animation:fade`, whose keyframes include a transform — and an ancestor
   with a transform becomes the containing block for `position:fixed`, so
   for as long as that animation runs the pinned button is fixed to the
   SECTION and every rect read in that window is a lie (measured: y=963
   instead of y=514). The stage therefore lets the screen settle, and
   waits on document.fonts.ready, before it answers anything.

   IT MUST GO RED ON index.html:

       node qa/payoff-clear.js index.html         # expect RED
       node qa/payoff-clear.js index-test.html    # expect GREEN
       node qa/payoff-clear.js --sabotage         # expect RED

   ENGINES. --firefox (default) and --chromium. WebKit crashes on this
   Jetson and is not claimed; neither is any real device.
   ================================================================== */
const PW=require('playwright');
const path=require('path'), fs=require('fs'), os=require('os');
const F=require('./fixtures.js');
const {waitReady}=require('./ready.js');

const ARG=process.argv.slice(2);
const TARGET=path.resolve(ARG.find(a=>/\.html$/.test(a)) || path.join(__dirname,'..','index-test.html'));
const SABOTAGE=ARG.includes('--sabotage');
const ENGNAME=ARG.includes('--chromium')?'chromium':'firefox';
const ENG=PW[ENGNAME];

let pass=0, fail=0; const bad=[];
const ok=(n,c,d)=>{ if(c) pass++; else { fail++; bad.push(n+(d?'  — '+d:'')); } };

/* Put all three causes back. If this file still passes with the width
   restored to 100%, the sweep deleted and the panel left out of the
   measurement, it is measuring nothing. */
function sabotage(html){
  let h=html;
  const width=/#nextBtn\{position:fixed;left:14px;right:14px;width:auto;bottom:/;
  const sweep=/  try\{ revealClearSweep\(\); \}catch\(_\)\{\}/;
  if(!width.test(h)) throw new Error('sabotage could not find the width:auto on #nextBtn — the fix changed shape and this file must be updated with it');
  if(!sweep.test(h)) throw new Error('sabotage could not find the revealClearSweep() call in answer() — the fix changed shape and this file must be updated with it');
  h=h.replace(width, '#nextBtn{position:fixed;left:14px;right:14px;bottom:');
  h=h.replace(sweep, '  /* SABOTAGED: the panel is no longer lifted clear of the pinned button */');
  return h;
}

/* Drive the REAL answer(), on the REAL question bank, exactly as
   qa/payoff.js does — building the reveal markup by hand would measure
   this file's idea of the payoff rather than the app's. */
async function stage(w,h,correct){
  const b=await ENG.launch();
  const ctx=await b.newContext({viewport:{width:w,height:h}, deviceScaleFactor:1});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,160)));

  let html=fs.readFileSync(TARGET,'utf8');
  if(SABOTAGE) html=sabotage(html);
  const tmp=path.join(os.tmpdir(),'payoff-clear-under-test-'+process.pid+'.html');
  fs.writeFileSync(tmp,html);

  await p.route('**/site.api.espn.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(F.LIVE)}));
  await p.route('**/assets.mailerlite.com/**', r=>r.fulfill({status:200,body:'{}'}));
  await p.goto('file://'+tmp,{waitUntil:'domcontentloaded'});
  await waitReady(p);

  await p.evaluate(()=>{
    /* GS.ok flips true→false inside loadGameStats before its first await,
       so anything measured across that boundary is a coin toss. */
    try{ window.loadGameStats=async function(){ return null; }; }catch(_){}
    try{ GS.ok=false; GS.ev=null; }catch(_){}
    /* 'live' is the screen a question and its reveal actually live on;
       'play' is not a place, which is a mistake three suites made before
       this one. */
    S.mode='practice'; S.place='live'; S.qi=0; S.ni=0; S.answered=false; S.results=[[]];
    try{ go('gametime'); }catch(_){}
    document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
    document.getElementById('s-gametime').classList.add('active');
    const gtr=document.getElementById('gtReview'); if(gtr) gtr.style.display='none';
    const qp=document.getElementById('gtQuestion'); if(qp) qp.style.display='block';
    /* THE TAB BAR IS UP. NAV_HIDE_ON is ['tally'], so a player answering a
       quarter question has the four tabs on screen — which is the state in
       the founder's screenshot and the reason "THIS ONE / YOUR POINTS"
       ended up underneath them. */
    const nav=document.getElementById('botnav'); if(nav) nav.style.display='block';
    document.body.classList.add('hasnav');
  });

  /* FONTS, THEN THE SCREEN'S OWN FADE. Both move the numbers this suite
     is about, and the fade does something worse than move them: while it
     runs, an ancestor transform makes position:fixed resolve against the
     section instead of the viewport. */
  try{ await p.evaluate(()=>document.fonts && document.fonts.ready); }catch(_){}
  await p.waitForTimeout(700);

  const drove = await p.evaluate((correct)=>{
    const q = rounds[S.qi].q[S.ni];
    const right = q.a;
    const opts=document.getElementById('qOpts');
    opts.innerHTML=(q.o||[]).map(o=>
      `<button class="opt" data-l="${String(o).replace(/"/g,'&quot;')}"><span class="mk"></span>${o}</button>`).join('');
    const pick = correct ? right : (q.o||[]).filter(o=>String(o)!==String(right))[0];
    if(pick==null) return {err:'the bank offered no wrong answer to pick'};
    const btn=opts.querySelector('.opt[data-l="'+String(pick).replace(/"/g,'\\"')+'"]')
              || opts.querySelector('.opt');
    try{ answer(pick, btn); }catch(e){ return {err:'answer() threw: '+(e&&e.message)}; }
    return {ok:true, pick:String(pick), right:String(right)};
  }, correct);

  /* WAIT FOR THE SCREEN TO STOP MOVING, NOT FOR A NUMBER.
     A flat 1600ms passed on an idle box and went red inside the full gate
     on 25 Aug, where the answered options finished taking their marks at
     about 1.3s and the panel was still 47px behind the button when the
     stopwatch ran out. That is the exact failure qa/ready.js was written
     to delete — nineteen suites each guessing how long boot takes — and
     writing another guess into a new file would be repeating it.

     So it polls the two things this suite measures, the panel's box and
     the page's scroll, and goes when they have been unchanged for a
     STRETCH rather than for an instant.

     TEN SAMPLES, NOT THREE, and the difference is a real trace rather
     than a taste. Instrumented on 25 Aug at 393x852:

         t+355ms  the button is still static, below the panel — no overlap
         t+535ms  it flips to pinned, the panel still clears it
         t+777ms  the answered options finish and the panel grows 53px
                  into the button — and the same pass scrolls it clear
         t+1055ms clear, and nothing moves again

     Between the sweep's checks NOTHING MOVES, so "unchanged three times"
     is satisfied at t+360ms, inside a window where the screen has simply
     not got there yet. Ten samples at 120ms is 1.2s of quiet, which is
     longer than any gap in the settle — so it cannot mistake a pause for
     an ending.

     AND IT MEASURES THE INSTANT THE QUIET RUN ENDS. An earlier draft
     waited a further 400ms "for the count to finish", and that blind wait
     was itself a source of red runs: traced at 100ms resolution, the
     screen passes through a ~100ms transient at about t+640ms — the
     answered options grow, the panel lands on the button (or the static
     button dips under the tab bar), and the next pass of the app's sweep
     puts it right. Waiting a fixed beat AFTER a settle can land exactly
     there and photograph a frame that is already being fixed. The count
     changes a number's text, not its box, so there was nothing to wait
     for anyway.

     The 9s is a CEILING, not a wait: if the screen never settles, the
     suite measures whatever it has and reports that rather than hanging. */
  await p.waitForFunction(()=>{
    const rev=document.querySelector('#revealBox .reveal');
    const d=document.scrollingElement||document.documentElement;
    const nb=document.getElementById('nextBtn');
    const now = (rev ? Math.round(rev.getBoundingClientRect().top)+':'
                     + Math.round(rev.getBoundingClientRect().bottom) : 'none')
              + ':' + (nb ? Math.round(nb.getBoundingClientRect().top) : '?')
              + ':' + Math.round(d.scrollTop);
    window.__pcSame = (window.__pcLast===now) ? (window.__pcSame||0)+1 : 0;
    window.__pcLast = now;
    return window.__pcSame >= 10;
  }, {timeout:9000, polling:120}).catch(()=>{});
  return {b,p,errs,drove};
}

const READ = ()=>{
  const R=el=>{ if(!el) return null; const r=el.getBoundingClientRect();
    return {t:Math.round(r.top),b:Math.round(r.bottom),l:Math.round(r.left),
            r:Math.round(r.right),h:Math.round(r.height),w:Math.round(r.width)}; };
  const q=s=>document.querySelector(s);
  const nb=document.getElementById('nextBtn');
  const nav=document.getElementById('botnav');
  const rev=q('#revealBox .reveal');
  const px=el=>el?parseFloat(getComputedStyle(el).fontSize):0;
  const payoffN=[...document.querySelectorAll('#revealBox .payoff .pn')].map(px);
  const others=rev ? [...rev.querySelectorAll('*')]
      .filter(el=>!el.closest('.payoff') && el.textContent.trim() && !el.children.length)
      .map(px) : [];
  /* WHAT IS ACTUALLY ON TOP. Geometry says two boxes overlap; hit-testing
     says which one the eye — and the finger — gets. Both are read, because
     a z-index change could satisfy one and not the other. */
  const hitAt=(el)=>{
    if(!el) return null;
    const r=el.getBoundingClientRect();
    const x=Math.round(r.left+r.width/2), y=Math.round(r.top+r.height/2);
    if(y<0||y>=innerHeight) return 'offscreen';
    const hit=document.elementFromPoint(x,y);
    if(!hit) return 'nothing';
    if(el===hit||el.contains(hit)||hit.contains(el)) return 'itself';
    return (hit.id||hit.tagName+'.'+String(hit.className||'').split(' ')[0]);
  };
  return {
    vw:innerWidth, vh:innerHeight,
    kind: rev ? (rev.classList.contains('good')?'good':'bad') : null,
    reveal:R(rev),
    payoff:R(q('#revealBox .payoff')),
    labels:[...document.querySelectorAll('#revealBox .payoff .pl')].map(R),
    total:R(document.getElementById('revNow')),
    totalText:(document.getElementById('revNow')||{}).textContent||null,
    nextBtn:R(nb), nextText:nb?(nb.textContent||'').trim():null,
    nextPos: nb?getComputedStyle(nb).position:null,
    nav: (nav && getComputedStyle(nav).display!=='none') ? R(nav) : null,
    payoffMax: Math.max(0,...payoffN),
    revealMax: Math.max(0,...others),
    hitPayoff: hitAt(q('#revealBox .payoff .pn')),
    hitLabel:  hitAt(q('#revealBox .payoff .pt .pl')),
    hitLine:   hitAt(q('#revealBox .reveal .r1')) || hitAt(q('#revealBox .reveal .r2'))
  };
};

const SIZES=[
  {w:390, h:844, why:'iPhone 14/15'},
  {w:393, h:852, why:'iPhone 15 Pro'},
  {w:360, h:640, why:"a small Android — the founder's measurement"},
  {w:1440,h:788, why:'a 1440x900 Mac after browser chrome'}
];

async function measure(s, correct){
  const key=s.w+'x'+s.h+(correct?'.correct':'.miss');
  const {b,p,errs,drove}=await stage(s.w,s.h,correct);
  if(drove && drove.err){ await b.close(); ok(key+'.the-answer-went-through', false, drove.err); return; }
  const r=await p.evaluate(READ);
  await b.close();

  console.log('\n  ' + s.w + 'x' + s.h + '  ' + (correct?'CORRECT':'MISS') + '   (' + s.why + ')');
  console.log('    panel   ' + (r.reveal?r.reveal.t+' – '+r.reveal.b:'MISSING')
            + '   payoff ' + (r.payoff?r.payoff.t+' – '+r.payoff.b:'—')
            + '   labels ' + (r.labels[0]?r.labels[0].t+' – '+r.labels[0].b:'—'));
  console.log('    button  ' + (r.nextBtn?r.nextBtn.t+' – '+r.nextBtn.b:'—')
            + ' (' + r.nextPos + ', x ' + (r.nextBtn?r.nextBtn.l+'–'+r.nextBtn.r:'?') + ' of ' + s.w + ')'
            + '   tab bar ' + (r.nav?r.nav.t:'hidden')
            + '   "' + (r.nextText||'') + '"');
  console.log('    on top of the payoff: ' + r.hitPayoff + ' · of its label: ' + r.hitLabel);

  ok(key+'.the-panel-rendered-at-all', !!r.reveal && r.reveal.h>10,
     'no reveal panel was rendered by answer()');
  if(!r.reveal) { ok(key+'.no-page-errors', errs.length===0, errs.slice(0,2).join(' · ')); return; }

  /* ---- THE FOUNDER'S SENTENCE ------------------------------------- */
  ok(key+'.the-button-is-not-drawn-across-the-panel',
     !r.nextBtn || r.reveal.b <= r.nextBtn.t,
     'the panel runs ' + r.reveal.t + '–' + r.reveal.b + ' and the button starts at '
     + (r.nextBtn?r.nextBtn.t:'?') + ' — ' + Math.max(0, r.reveal.b-(r.nextBtn?r.nextBtn.t:0))
     + 'px of the reward moment is behind "' + (r.nextText||'') + '"');
  ok(key+'.the-panel-is-not-under-the-tab-bar',
     !r.nav || r.reveal.b <= r.nav.t,
     'the panel runs to y=' + r.reveal.b + ' and the tab bar starts at ' + (r.nav?r.nav.t:'?'));

  /* THE PAYOFF BLOCK EXISTS ONLY ON THE CORRECT PATH. A miss renders one
     sentence and no numbers, by design — so asserting against a .payoff
     that was never drawn would be a check that passes green on a build
     where the reward moment has been deleted outright. */
  if(correct){
    ok(key+'.the-payoff-numbers-are-not-under-the-tab-bar',
       !!r.payoff && (!r.nav || r.payoff.b <= r.nav.t),
       'the payoff runs to y=' + (r.payoff?r.payoff.b:'(not rendered)')
       + ' and the tab bar starts at ' + (r.nav?r.nav.t:'?'));
    ok(key+'.this-one-and-your-points-are-legible',
       r.labels.length>0 && r.labels.every(l=>l && l.t>=0 && l.b<=s.h
         && (!r.nav || l.b<=r.nav.t) && (!r.nextBtn || l.b<=r.nextBtn.t)),
       'the two labels sit at ' + r.labels.map(l=>l?l.t+'–'+l.b:'?').join(', ')
       + ' against a button at ' + (r.nextBtn?r.nextBtn.t:'?') + ' and a tab bar at ' + (r.nav?r.nav.t:'?'));
  }

  /* HIT-TESTING, not only rectangles. Two boxes that do not overlap
     cannot be on top of each other, but a stacking context could put
     something else there — so ask the browser what is actually at the
     middle of the thing the player came for. */
  const hitWhat = correct ? r.hitPayoff : r.hitLine;
  ok(key+'.nothing-is-painted-over-what-the-panel-says',
     hitWhat==='itself',
     'the pixel in the middle of ' + (correct?'the payoff number':'the result line')
     + ' belongs to "' + hitWhat + '"');
  if(correct){
    ok(key+'.nothing-is-painted-over-its-label',
       r.hitLabel==='itself',
       'the pixel in the middle of YOUR POINTS belongs to "' + r.hitLabel + '"');
  }

  /* ---- AND THE BUTTON ITSELF IS WHERE IT SHOULD BE ---------------- */
  ok(key+'.the-button-is-inside-the-window',
     !!r.nextBtn && r.nextBtn.l>=0 && r.nextBtn.r<=s.w,
     'the button runs x=' + (r.nextBtn?r.nextBtn.l+'–'+r.nextBtn.r:'?')
     + ' in a ' + s.w + 'px window — ' + (r.nextBtn?Math.max(0,r.nextBtn.r-s.w):0) + 'px off the right edge');
  ok(key+'.the-button-is-above-the-tab-bar',
     !!r.nextBtn && (!r.nav || r.nextBtn.b <= r.nav.t),
     'the button runs to y=' + (r.nextBtn?r.nextBtn.b:'?') + ' and the tab bar starts at ' + (r.nav?r.nav.t:'?'));
  ok(key+'.the-button-is-on-screen-without-scrolling',
     !!r.nextBtn && r.nextBtn.t>=0 && r.nextBtn.b<=s.h,
     'the button runs ' + (r.nextBtn?r.nextBtn.t+'–'+r.nextBtn.b:'?') + ' on a ' + s.h + 'px screen');

  /* ---- THE FIX MUST NOT BE PAID FOR OUT OF THE NUMBER ------------- */
  if(correct){
    /* 40px is the size of the team scores it competes with — the ones the
       player can already see on their television. At 360px and under the
       app deliberately steps down one place on the ramp, to 34, and that
       decision predates this file; the floor moves with it rather than
       failing a build for following a rule. */
    const floor = (s.w<=360) ? 34 : 40;
    ok(key+'.the-payoff-is-still-the-biggest-text-in-the-panel',
       r.payoffMax > r.revealMax && r.payoffMax >= floor,
       'the payoff renders at ' + r.payoffMax + 'px against ' + r.revealMax
       + 'px for the largest other text in the reveal, on a floor of ' + floor
       + 'px — moving a button by shrinking the number is losing the same argument twice');
    ok(key+'.the-total-is-really-there',
       r.total && /^\d+$/.test(String(r.totalText||'').trim()),
       'the running total reads ' + JSON.stringify(r.totalText));
  }

  ok(key+'.no-page-errors', errs.length===0, errs.slice(0,2).join(' · '));
}

(async()=>{
  console.log('\n=== NOTHING IS DRAWN ACROSS THE REWARD MOMENT ===   '
    + path.basename(TARGET) + ' · ' + ENGNAME + (SABOTAGE?' · SABOTAGED':''));

  for(const s of SIZES) await measure(s, true);
  /* The miss panel is shorter, so it clears more easily — which is exactly
     why it is worth one size rather than four. */
  await measure(SIZES[2], false);

  const verdict = fail? 'RED' : 'GREEN';
  console.log(`\n${verdict}   ${pass} passed, ${fail} failed   [${path.basename(TARGET)} · ${ENGNAME}]`
              + (SABOTAGE?'   [SABOTAGED — red is the correct result]':''));
  bad.forEach(x=>console.log('   x '+x));
  if(SABOTAGE){ process.exit(fail?0:1); }
  process.exit(fail?1:0);

})().catch(e=>{ console.log('payoff-clear.js could not run: '+(e&&e.stack||e)); process.exit(1); });
