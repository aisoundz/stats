#!/usr/bin/env node
/* =====================================================================
   THE PICK SHEET ON A LAPTOP, AT THE SIZE THE FOUNDER ACTUALLY USES.
   ---------------------------------------------------------------------
   The two-column desktop deck shipped on the morning of 25 Aug and was
   measured good at 1850x1050. The founder then photographed it on his own
   machine and it was cut off three ways at once:

     · the roster grid sliced mid-row at the bottom
     · the "How many pts?" input — the field the card promises "+50 for
       the exact number" for — clipped
     · a yellow "Still need most points →" bar sitting over the content
       above the pinned Back / Next bar

   THE SIZE IS THE WHOLE POINT. The screenshot is 2880x1800, which is a
   Retina 2x of a 1440x900 Mac; subtract the menu bar, the tab strip and
   the address bar and the VIEWPORT IS 1440x788. 1850x1050 is 262 pixels
   taller, and the deck fits there. A layout proved at one size is proved
   at one size — the same lesson desk-reach.js was written for when a
   min-height:860px rule shipped having never been evaluated.

   WHAT WAS MEASURED ON THE SHIPPED BUILD AT 1440x788, scrollTop 0, in
   the exact state of the screenshot (nine names on the injury report, one
   pick made so #pdBar carries its second row):

       #gameRail            0 -  52
       .qmeta + h1 + sub   72 - 155      \
       #inactiveBar       163 - 276       |  371px of preamble
       "Your card" block  217 - 318      /
       .pdcard            400 - 1102        701px, 210px of it visible
       #pdBar             610 - 716        106px  \  172px, 21.8% of the
       #botnav            722 - 788         66px  /  window, over the card

       "How many pts?"    576 - 624        CLIPPED by the bar at 610
       nine roster options                 underneath the pinned bar
       fourteen more                       below the fold

   pdFitPin() IS NOT MIS-MEASURING. It ran, correctly found that the deck
   does not fit, and pinned the controls — which is all it was ever asked
   to do. Twenty-nine names cannot be made to fit in 788px however the
   columns are arranged, and forcing it would end in a scroller with a
   hidden bar, which is the failure the whole rail rebuild exists to stop.

   So the fix spends the height differently rather than pretending it can
   be recovered: the pinned bar goes to ONE row at desk width (1,440px
   wide with 920px of it empty was paying 50px for a second band), the
   header and the injury report sit side by side instead of stacked, and
   the three-row "Your card / N picked / dots" block becomes one line.

   WHAT THIS SUITE ASSERTS — rendered rectangles, at seven sizes:

     · the number field clears the pinned bar AT REST, which is the frame
       the founder photographed
     · the chrome budget at desk width
     · that the bar really is one row (measured as overlap, not as a class)
     · that at the bottom of the scroll every roster option is above the
       bar and none is off screen — nothing is unreachable
     · that nothing is hidden inside a scroller: the roster is a wrapping
       grid in page flow, and the page's own scrollbar is the affordance
     · AND THE PHONE IS UNCHANGED. A desk fix that moves the phone is a
       regression, so 393x852 and 390x844 are in the same file.

   KNOWN AND NOT FIXED: below about 610px of viewport height the number
   field is still under the bar at scrollTop 0. It is sticky, so it pins
   into view on any scroll, and every roster option is still reachable —
   but at 1280x600 the founder's specific symptom would still appear. The
   matrix therefore claims 640 and up, and says so rather than rounding.

   IT MUST GO RED ON index.html:

       node qa/desk-pick-fit.js index.html         # expect RED
       node qa/desk-pick-fit.js index-test.html    # expect GREEN
       node qa/desk-pick-fit.js --sabotage         # expect RED

   ENGINES. --firefox (default) and --chromium. WebKit crashes on this
   Jetson and is not claimed.
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

/* Undo the desk-width layout. If this file still passes with the grid and
   the one-row bar removed, it is measuring nothing. */
function sabotage(html){
  let h=html;
  const bar=/  body\.on-predict #s-predict\.active #pdBar\{\n    display:flex;align-items:center;justify-content:center;gap:20px;\n    padding-top:10px;padding-bottom:calc\(10px \+ env\(safe-area-inset-bottom,0px\)\)\}/;
  const grid=/  body\.on-predict #s-predict\.active\{\n    display:grid;\n    grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\);\n    column-gap:24px;align-items:start;align-content:start\}/;
  if(!bar.test(h)) throw new Error('sabotage could not find the one-row #pdBar rule — the fix changed shape and this file must be updated with it');
  if(!grid.test(h)) throw new Error('sabotage could not find the desk-width section grid — the fix changed shape and this file must be updated with it');
  h=h.replace(bar,  '  /* SABOTAGED: the bar goes back to two stacked bands */');
  h=h.replace(grid, '  /* SABOTAGED: the preamble goes back to a full-width stack */');
  return h;
}

/* ---------------------------------------------------------------------
   THE FOUNDER'S SCREEN, REBUILT.

   Every element in his screenshot that costs vertical space is put back:
   the score rail, the two-game chooser, the nine-name injury report, and
   ONE PICK MADE — which is what makes #pdBar render its second row. A
   fixture with zero picks measures a 56px bar and misses the whole of the
   third symptom.
   ------------------------------------------------------------------ */
async function stage(w,h){
  const b=await ENG.launch();
  const ctx=await b.newContext({viewport:{width:w,height:h}, deviceScaleFactor:1});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,160)));

  let html=fs.readFileSync(TARGET,'utf8');
  if(SABOTAGE) html=sabotage(html);
  const tmp=path.join(os.tmpdir(),'desk-pick-fit-under-test-'+process.pid+'.html');
  fs.writeFileSync(tmp,html);

  await p.route('**/site.api.espn.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(F.PRE)}));
  await p.route('**/assets.mailerlite.com/**', r=>r.fulfill({status:200,body:'{}'}));
  await p.goto('file://'+tmp,{waitUntil:'domcontentloaded'});
  await waitReady(p);

  await p.evaluate(()=>{
    /* GS.ok flips true->false inside loadGameStats before its first await,
       so geometry read across that boundary is a coin toss. Remove the
       caller and drive the injury report by hand instead. */
    try{ window.loadGameStats=async function(){ return null; }; }catch(_){}
    try{ GS.ok=false; GS.ev=null; }catch(_){}
    setMode('demo'); S.mode='demo'; S.name='Founder';
    /* One pick made — the "1 / 6 picked · 1 locked" of the screenshot, and
       the reason #pdBar has a second row at all. */
    try{ S.predChoices[preds[0].id] = String((preds[0].opts&&preds[0].opts[0]) || (roster.home&&roster.home[0]) || 'X'); }catch(_){}
    PD.i=1;                    // "Who scores the most points?" — his card
    buildPred(); go('predict');
    /* Nine names on the league injury report, as in the shot. */
    ['Christyn Williams','Haley Jones','Azzi Fudd','Aziaha James','Costanza Verona',
     'Serah Williams','Luisa Geiselsoder','Sarah Ashlee Barker','Sania Feagin']
      .forEach(function(n){ INACTIVE.add(n); });
    INACTIVE_NOTE=[...INACTIVE].map(function(n){ return n+' (Out)'; }).join(' · ');
    paintInactives();
    /* The score strip and the two-game chooser above the sheet. */
    try{
      SLATE.date='2026-08-25'; SLATE.loaded=true;
      SLATE.games=[{nightId:'slate-2026-08-25-lad-atl',awayAbbr:'LAD',homeAbbr:'ATL',star:true,
                    tipISO:'2026-08-25T23:00:00Z',espnEvent:'1'},
                   {nightId:GAME.nightId,awayAbbr:'POR',homeAbbr:'DAL',
                    tipISO:'2026-08-26T00:00:00Z',espnEvent:String(GAME.espnEvent)}];
      paintGameRail(); paintRail(true);
    }catch(_){}
    buildPred(); pdFitPin();
  });
  /* WAIT FOR THE FONTS, NOT FOR A NUMBER. Every assertion in this file is
     a rendered rectangle, and a rectangle measured before the webfont
     swaps is a different rectangle — which is exactly how a geometry suite
     produces one red run in ten under load and teaches everybody to re-run
     it. document.fonts.ready is the statement; the 350ms after it is the
     settle for pdFitPin's own debounced resize handler, not a guess at
     boot. See qa/ready.js for why this repo does not do boot guesses. */
  try{ await p.evaluate(()=>document.fonts && document.fonts.ready); }catch(_){}
  await p.waitForTimeout(350);
  /* And one more measured pass, because the fit test reserves padding from
     the bar's REAL height and the bar's height depends on the font. */
  try{ await p.evaluate(()=>{ try{ buildPred(); pdFitPin(); }catch(_){} }); }catch(_){}
  await p.waitForTimeout(120);
  return {b,p,errs};
}

const READ = (where)=>{
  const q=s=>document.querySelector(s);
  const R=el=>{ if(!el) return null; const r=el.getBoundingClientRect();
    return {t:Math.round(r.top),b:Math.round(r.bottom),l:Math.round(r.left),
            r:Math.round(r.right),h:Math.round(r.height),w:Math.round(r.width)}; };
  const doc=document.scrollingElement||document.documentElement;
  if(where==='bottom'){ doc.scrollTop=doc.scrollHeight; window.scrollTo(0,doc.scrollHeight); }
  else { doc.scrollTop=0; window.scrollTo(0,0); }

  const nav=q('#botnav'), bar=q('#pdBar');
  const navR=R(nav), barR=R(bar);
  const opts=[...document.querySelectorAll('.pdcard .pdopts .pdopt')].map(e=>{
    const r=e.getBoundingClientRect();
    return {n:(e.textContent||'').trim().slice(0,24), t:Math.round(r.top), b:Math.round(r.bottom)};
  });
  const floor = barR ? barR.t : (navR ? navR.t : innerHeight);
  const scrollerish = ['.pdcard .pdlist','.pdcard','#predCard','#s-predict'].map(sel=>{
    const el=q(sel); if(!el) return null;
    return {sel, over:getComputedStyle(el).overflowY,
            hidden: Math.max(0, el.scrollHeight - el.clientHeight)};
  }).filter(Boolean);

  return {
    vw:innerWidth, vh:innerHeight,
    scrollTop:Math.round(doc.scrollTop),
    scrollable:Math.max(0, doc.scrollHeight-doc.clientHeight),
    onPredict:document.body.classList.contains('on-predict'),
    nav:navR, bar:barR,
    navRow:R(q('#pdBar .pdnav')), lock:R(q('#pdBar .pdlock')),
    stick:R(q('.pdcard .pdstick')), side:R(q('.pdcard .pdside')),
    num:R(q('.pdcard .pdside input')),
    q:R(q('.pdcard .pdq')),
    card:R(q('.pdcard')), list:R(q('.pdcard .pdlist')),
    head:R(q('#predHead')), inact:R(q('#inactiveBar')),
    optCount:opts.length,
    underBar: opts.filter(o=> o.b>floor && o.t<(navR?navR.b:innerHeight)).map(o=>o.n),
    offScreen: opts.filter(o=> o.b>innerHeight).map(o=>o.n),
    scrollerish,
    /* The computed values the two layouts are actually made of. Read
       rather than inferred: `body.on-predict` is written by go() at every
       width — it only says WHICH SCREEN is up — so it is the media query,
       not the class, that decides, and the class is not evidence. */
    css:{
      section: q('#s-predict') ? getComputedStyle(q('#s-predict')).display : null,
      bar:     q('#pdBar')     ? getComputedStyle(q('#pdBar')).display     : null,
      side:    q('.pdcard .pdside') ? getComputedStyle(q('.pdcard .pdside')).display : null,
      list:    q('.pdcard .pdlist') ? getComputedStyle(q('.pdcard .pdlist')).display : null,
      card:    q('#predCard')  ? getComputedStyle(q('#predCard')).display  : null
    }
  };
};

/* Six desk sizes. 1440x788 is the founder's, to the pixel. 1366x660 is a
   1366x768 laptop — the commonest there is — with Chrome's chrome gone. */
const DESKS=[
  {w:1440,h:788,  why:"the founder's own window"},
  {w:1366,h:660,  why:'a 1366x768 laptop after browser chrome'},
  {w:1280,h:640,  why:'a small laptop window'},
  {w:1512,h:850,  why:'a 14-inch MacBook Pro'},
  {w:1920,h:1080, why:'an external monitor'},
  {w:1120,h:700,  why:'the breakpoint itself'},
];
const PHONES=[{w:393,h:852},{w:390,h:844}];

(async()=>{
  console.log('\n=== THE PICK SHEET ON A LAPTOP ===   '
    + path.basename(TARGET) + ' · ' + ENGNAME + (SABOTAGE?' · SABOTAGED':''));

  for(const d of DESKS){
    const {b,p,errs}=await stage(d.w,d.h);
    const top=await p.evaluate(READ,'top');
    const bot=await p.evaluate(READ,'bottom');
    await b.close();

    const chrome = (top.bar?top.bar.h:0) + (top.nav?top.nav.h:0);
    const key = 'desk'+d.w+'x'+d.h;
    console.log('\n  ' + d.w + 'x' + d.h + '   (' + d.why + ')');
    console.log('    chrome ' + chrome + 'px = ' + Math.round(chrome/d.h*100) + '% of the window'
              + '   bar ' + (top.bar?top.bar.h:'?') + 'px, nav ' + (top.nav?top.nav.h:'?') + 'px');
    console.log('    at rest:  question ' + (top.q?top.q.t+'-'+top.q.b:'?')
              + '   "How many pts?" ' + (top.num?top.num.t+'-'+top.num.b:'MISSING')
              + '   bar top ' + (top.bar?top.bar.t:'?'));
    console.log('    at rest:  ' + top.underBar.length + ' options under the bar, '
              + top.offScreen.length + ' below the fold, of ' + top.optCount);
    console.log('    scrolled: ' + bot.underBar.length + ' under the bar, '
              + bot.offScreen.length + ' below the fold');

    ok(key+'.the-two-column-deck-is-on',
       top.css.side==='block' && top.css.list==='block' && !!top.stick && !!top.side,
       'the deck wrappers compute as ' + top.css.side + '/' + top.css.list
       + ' — the wide layout is not applying at ' + d.w + 'px');
    ok(key+'.the-preamble-is-a-grid-not-a-stack',
       top.css.section==='grid',
       '#s-predict computes as ' + top.css.section + ', so the header and the injury report are still stacked');
    ok(key+'.the-header-and-the-injury-report-share-a-row',
       !!top.head && !!top.inact && top.inact.t < top.head.b && top.inact.l > top.head.l,
       top.head && top.inact
         ? ('the injury report sits at ' + top.inact.t + '-' + top.inact.b + ' x' + top.inact.l
            + ', below the headline at ' + top.head.t + '-' + top.head.b + ' x' + top.head.l)
         : 'the headline or the injury report was not found');

    /* SYMPTOM TWO, and the one he named: the field the card promises "+50
       for the exact number" for. Measured at rest, which is the frame a
       refresh into the sheet produces and the frame he photographed. */
    ok(key+'.the-exact-number-field-clears-the-pinned-bar-at-rest',
       !!top.num && !!top.bar && top.num.b <= top.bar.t,
       top.num && top.bar
         ? ('"How many pts?" ends at y=' + top.num.b + ' and the bar starts at y=' + top.bar.t
            + ' — clipped by ' + (top.num.b-top.bar.t) + 'px')
         : 'the field or the bar was not found at all');

    /* And the question it belongs to. A number field with no question above
       it is not an improvement. */
    ok(key+'.the-question-is-on-screen-at-rest',
       !!top.q && top.q.t>=0 && top.q.b<= (top.bar?top.bar.t:d.h),
       top.q ? ('the question sits at ' + top.q.t + '-' + top.q.b
                + ' against a floor of ' + (top.bar?top.bar.t:d.h)) : 'no question element');

    /* SYMPTOM THREE. Measured as geometry — the nav row and the lock button
       overlapping vertically means they are on one line — rather than by
       reading a class, which would pass on a build that set the class and
       laid nothing out. */
    ok(key+'.the-action-bar-is-one-row-not-two',
       !!top.navRow && !!top.lock && top.lock.t < top.navRow.b && top.lock.b > top.navRow.t,
       top.navRow && top.lock
         ? ('the "Still need…" button sits at ' + top.lock.t + '-' + top.lock.b
            + ', stacked under the Back/Next row at ' + top.navRow.t + '-' + top.navRow.b)
         : 'the bar did not render both of its controls');

    /* WHAT DOES IT COST. 172px of a 788px window was 21.8%. */
    ok(key+'.the-chrome-budget',
       chrome <= 140,
       chrome + 'px of fixed bars over the card — ' + Math.round(chrome/d.h*100) + '% of the window');

    /* SYMPTOM ONE, at the end of the scroll. "Sliced mid-row" is tolerable
       mid-scroll on a list longer than any window; what is NOT tolerable is
       a name you can never bring out from under the bar. */
    ok(key+'.every-roster-option-is-reachable-above-the-bar',
       bot.underBar.length===0 && bot.offScreen.length===0,
       'scrolled to the bottom, ' + bot.underBar.length + ' options are still under the bar and '
       + bot.offScreen.length + ' are still below the fold: ' + bot.underBar.concat(bot.offScreen).slice(0,3).join(', '));

    /* NOTHING IS HIDDEN INSIDE A SCROLLER. The roster is a wrapping grid in
       page flow and the page's own scrollbar is the affordance — this is
       the rail's rule, and a fix that met the geometry by clipping the list
       into a box with its bar removed would be the old bug in a new place. */
    const boxed = top.scrollerish.filter(s=>s.hidden>4);
    ok(key+'.the-roster-is-not-inside-a-hidden-scroller',
       boxed.length===0,
       boxed.map(s=>s.sel+' hides '+s.hidden+'px behind overflow-y:'+s.over).join(' · '));
    ok(key+'.and-the-page-itself-says-there-is-more',
       top.scrollable>0,
       'the page does not scroll at all, so content below the fold has no affordance');

    ok(key+'.no-page-errors', errs.length===0, errs.slice(0,2).join(' · '));
  }

  /* ============ AND THE PHONE DOES NOT MOVE ==========================
     The desk rules live behind min-width:1120px and the wrappers they use
     are the section's existing children, so below the breakpoint nothing
     should have changed. Asserted rather than assumed: this is the check
     that fails if a desk fix is paid for out of the phone. */
  console.log('\n  --- the phone is not paying for the desk ---');
  for(const ph of PHONES){
    const {b,p,errs}=await stage(ph.w,ph.h);
    const r=await p.evaluate(READ,'top');
    await b.close();
    const key='phone'+ph.w+'x'+ph.h;
    console.log('    ' + ph.w + 'x' + ph.h + '   on-predict=' + r.onPredict
              + '  bar ' + (r.bar?r.bar.h:'?') + 'px'
              + '  injury box ' + (r.inact?r.inact.h:'?') + 'px'
              + '  card top ' + (r.card?r.card.t:'?'));

    /* Not `body.on-predict` — go() writes that at every width, it only
       names the screen. The media query is what decides, so the computed
       values are what is read. */
    ok(key+'.the-preamble-is-still-a-stack',
       r.css.section==='flex',
       '#s-predict computes as ' + r.css.section + ' on a ' + ph.w + 'px phone');
    ok(key+'.the-action-bar-is-still-a-block',
       r.css.bar==='block',
       '#pdBar computes as ' + r.css.bar + ' on a ' + ph.w + 'px phone');
    /* The bar is TWO rows on a phone, deliberately — there is no
       horizontal room for one. The desk rule must not have leaked. */
    ok(key+'.the-action-bar-is-still-two-rows',
       !!r.navRow && !!r.lock && r.lock.t >= r.navRow.b - 2,
       'the lock button is on the same line as Back/Next on a phone');
    ok(key+'.the-injury-report-is-still-full-width',
       !!r.inact && !!r.card && r.inact.w >= ph.w - 40,
       'the injury report is ' + (r.inact?r.inact.w:'?') + 'px wide in a ' + ph.w + 'px phone');
    /* `display:contents` is the phone's answer for both wrappers: on a
       phone these divs do not exist and their children are laid out by the
       card exactly as they were before the desk layout was written. */
    ok(key+'.the-deck-wrappers-do-not-exist-on-a-phone',
       r.css.side==='contents' && r.css.list==='contents',
       'the deck wrappers compute as ' + r.css.side + '/' + r.css.list + ' on a phone instead of contents');
    ok(key+'.the-card-header-is-still-a-block',
       r.css.card==='block',
       '#predCard computes as ' + r.css.card + ' on a phone, so "Your card / picked / dots" has been folded onto one line');
    ok(key+'.no-page-errors', errs.length===0, errs.slice(0,2).join(' · '));
  }

  const verdict = fail? 'RED' : 'GREEN';
  console.log(`\n${verdict}   ${pass} passed, ${fail} failed   [${path.basename(TARGET)} · ${ENGNAME}]`
              + (SABOTAGE?'   [SABOTAGED — red is the correct result]':''));
  bad.forEach(x=>console.log('   x '+x));
  if(SABOTAGE){ process.exit(fail?0:1); }
  process.exit(fail?1:0);

})().catch(e=>{ console.log('desk-pick-fit.js could not run: '+(e&&e.stack||e)); process.exit(1); });
