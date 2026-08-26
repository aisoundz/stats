#!/usr/bin/env node
/* =====================================================================
   A STRANGER'S FIRST SCREEN HAS A WAY IN ON IT.
   ---------------------------------------------------------------------
   The founder is sending this link to his classmates. Thirteen humans
   have ever played this product and every one of them was him or one of
   his own devices, so tomorrow is the first outside traffic it has ever
   had, and the first screen is the whole of the first impression.

   MEASURED ON THE SHIPPED BUILD, 25 Aug, with three games on the slate —
   which is the state those classmates will actually meet:

       viewport        "Try it now" lands at     that is
       390 x 844       y = 964 – 1014            1.14 screens down
       360 x 640       y = 1015 – 1065           1.59 screens down
       1850 x 1050     y =  885 –  935           below the fold
       1440 x  788     y =  885 –  935           below the fold

   The tester's verdict was exact: "The practice card itself, once you
   scroll to it, is good. NOBODY REACHES IT." Above the fold a first-time
   visitor got a poster, a countdown to a game three hours away, and
   nothing they could do.

   WHAT THIS SUITE ASSERTS, and it is deliberately not "the element I
   added is where I put it": it looks for ANY visible control on the
   landing that starts a practice run — anything wired to startDemo() or
   heroPractice() — and requires that the topmost one is entirely above
   the fold, is big enough for a thumb, is a real focusable button so a
   keyboard and a television remote can reach it, and ACTUALLY OPENS the
   app when it is clicked. Rearranged differently tomorrow, this still
   asks the right question.

   AND THE HERO IS NOT ALLOWED TO BE THE PRICE. Deleting the poster would
   pass a fold check trivially and lose the one fact the front page exists
   for. So the same run demands the hero still names both teams, still
   carries its countdown, and is itself still on the first screen.

   WHAT IS CLAIMED: 640px of viewport height and up, at four widths, on
   two engines. 320x568 IS MEASURED AND PRINTED AND NOT CLAIMED — with a
   206px game rail and a 109px wordmark block above it, a poster and a
   control do not both fit in 568px, and rounding that up would be the
   kind of claim this directory exists to stop. Landscape is not claimed
   either: the viewport is ~390px tall and nothing rearranges out of that.

   IT MUST GO RED ON index.html:

       node qa/way-in.js index.html         # expect RED
       node qa/way-in.js index-test.html    # expect GREEN
       node qa/way-in.js --sabotage         # expect RED

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

/* Take the door out of the hero and leave the page exactly as it shipped:
   one practice control, in a card, a screen and a bit down. */
function sabotage(html){
  const door=/      <div class="mq-door strangers">\n[\s\S]*?\n      <\/div>\n/;
  if(!door.test(html)) throw new Error('sabotage could not find the .mq-door block — the fix changed shape and this file must be updated with it');
  return html.replace(door, '');
}

/* Tomorrow: Tempo at Storm at 7:00 PM PT, on a slate with other games, so
   the rail is up and costs what it really costs. A fixture with one game
   hides the rail and measures a page nobody will see tomorrow. */
const SETUP=`(function(){
  try{ window.loadGameStats=async function(){ return null; }; }catch(_){}
  try{ GS.ok=false; GS.ev=null; }catch(_){}
  var tip=new Date(Date.now()+3*3600*1000).toISOString();
  try{
    /* BOTH NAMINGS, because the rail reads g.away and the hero reads
       _hg.awayName — one fact, two field names, and a fixture that only
       carries one of them measures a hero that never repainted. */
    TONIGHT={nightId:'slate-2026-08-25-tor-sea',sport:'basketball',league:'wnba',
      away:'Tempo',home:'Storm',awayName:'Tempo',homeName:'Storm',
      awayAbbr:'TOR',homeAbbr:'SEA',
      awayColor:'#33476D',homeColor:'#2C5234',tipISO:tip};
  }catch(_){}
  try{ GAME.tipISO=tip; }catch(_){}
  try{
    SLATE.date='2026-08-25'; SLATE.loaded=true;
    SLATE.games=[
      {nightId:'slate-2026-08-25-lad-atl',league:'mlb',gn:30,gotn:true,away:'Dodgers',home:'Braves',
       awayAbbr:'LAD',homeAbbr:'ATL',awayColor:'#005A9C',homeColor:'#CE1141',tipISO:tip},
      {nightId:'slate-2026-08-25-tor-sea',league:'wnba',gn:19,away:'Tempo',home:'Storm',
       awayAbbr:'TOR',homeAbbr:'SEA',awayColor:'#33476D',homeColor:'#2C5234',tipISO:tip},
      {nightId:'slate-2026-08-25-chi-ind',league:'wnba',gn:20,away:'Sky',home:'Fever',
       awayAbbr:'CHI',homeAbbr:'IND',awayColor:'#418FDE',homeColor:'#FDBB30',tipISO:tip}];
    paintGameRail();
  }catch(_){}
  /* applySport() is what writes the fight card, the eyebrow and the chips
     off heroGame(). Setting TONIGHT and not calling it leaves the built-in
     fallback night on screen — which is a stale hero, not a repainted one,
     and asserting against it would be asserting against the fixture. */
  try{ applySport(); }catch(_){}
  try{ go('landing'); }catch(_){}
})`;

async function stage(w,h){
  const b=await ENG.launch();
  const ctx=await b.newContext({viewport:{width:w,height:h}, deviceScaleFactor:1});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,160)));

  let html=fs.readFileSync(TARGET,'utf8');
  if(SABOTAGE) html=sabotage(html);
  const tmp=path.join(os.tmpdir(),'way-in-under-test-'+process.pid+'.html');
  fs.writeFileSync(tmp,html);

  await p.route('**/site.api.espn.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(F.PRE)}));
  await p.route('**/assets.mailerlite.com/**', r=>r.fulfill({status:200,body:'{}'}));
  await p.goto('file://'+tmp,{waitUntil:'domcontentloaded'});
  await waitReady(p);
  await p.evaluate(SETUP+'()');
  await p.evaluate(async()=>{ try{ await paintHeroRibbon(); }catch(_){} });
  /* Fonts, then a settle for the countdown's own first tick. A rectangle
     read before the webfont swaps is a different rectangle, and the fold
     is measured in exactly those pixels. */
  try{ await p.evaluate(()=>document.fonts && document.fonts.ready); }catch(_){}
  await p.waitForTimeout(300);
  return {b,p,errs};
}

/* ANY control that starts practice, not "the one I added". */
const READ = ()=>{
  const doc=document.scrollingElement||document.documentElement;
  doc.scrollTop=0; window.scrollTo(0,0);
  const sec=document.getElementById('s-landing');
  const R=el=>{ const r=el.getBoundingClientRect();
    return {t:Math.round(r.top),b:Math.round(r.bottom),l:Math.round(r.left),
            r:Math.round(r.right),h:Math.round(r.height),w:Math.round(r.width)}; };
  const vis=el=>!!el && el.offsetParent!==null && el.getBoundingClientRect().height>4;

  const doors=[...sec.querySelectorAll('[onclick]')]
    .filter(el=>/startDemo|heroPractice/.test(el.getAttribute('onclick')||''))
    .filter(vis)
    .map(el=>Object.assign(R(el), {
      tag: el.tagName,
      text: (el.textContent||'').replace(/\s+/g,' ').trim(),
      disabled: !!el.disabled,
      focusable: el.tabIndex >= 0 || el.tagName==='BUTTON' || el.tagName==='A'
    }))
    .sort((a,b)=>a.t-b.t);

  const hero=document.getElementById('tonightCard');
  const clock=document.getElementById('heroRibbon');
  return {
    vw:innerWidth, vh:innerHeight,
    scrollable: Math.max(0, doc.scrollHeight-doc.clientHeight),
    rail: (function(){ const e=document.getElementById('gameRail');
      return (e && e.style.display!=='none') ? R(e) : null; })(),
    doors,
    /* The poster proper — the two names at 40px. The hero BOX also holds
       the tip line and the chips, which are fine print and are allowed
       below the fold on a short screen; the matchup is not. */
    vs: (function(){ const e=sec.querySelector('.mq-vs'); return vis(e)?R(e):null; })(),
    hero: hero ? Object.assign(R(hero), {
      text:(hero.innerText||'').replace(/\s+/g,' ').trim(),
      clockText: clock ? (clock.innerText||'').replace(/\s+/g,' ').trim() : '',
      clockShown: vis(clock)
    }) : null,
    /* The full flow must survive: five sports and its own button. */
    sports: document.querySelectorAll('#tryPick button').length,
    portalDoor: (function(){ const b=document.querySelector('#portalCard .tryGo');
      return b ? Object.assign(R(b),{text:(b.textContent||'').trim()}) : null; })()
  };
};

const SIZES=[
  {w:390, h:844,  claim:true,  why:'iPhone 14/15'},
  {w:393, h:852,  claim:true,  why:'iPhone 15 Pro'},
  {w:360, h:640,  claim:true,  why:'a small Android — the founder\'s second measurement'},
  {w:1440,h:788,  claim:true,  why:'a 1440x900 Mac after browser chrome'},
  {w:1850,h:1050, claim:true,  why:"the founder's own desktop"},
  {w:320, h:568,  claim:false, why:'iPhone SE 1 — measured, NOT claimed'}
];

(async()=>{
  console.log('\n=== A WAY IN ON THE FIRST SCREEN ===   '
    + path.basename(TARGET) + ' · ' + ENGNAME + (SABOTAGE?' · SABOTAGED':''));

  for(const s of SIZES){
    const key=s.w+'x'+s.h;
    const {b,p,errs}=await stage(s.w,s.h);
    const r=await p.evaluate(READ);

    const first=r.doors[0]||null;
    console.log('\n  ' + s.w + 'x' + s.h + '   (' + s.why + ')'
      + '   rail ' + (r.rail?r.rail.h:0) + 'px   hero ' + (r.hero?r.hero.t+'-'+r.hero.b:'?'));
    console.log('    ' + r.doors.length + ' practice control(s) on the landing; the first is '
      + (first ? ('"' + first.text + '" at y=' + first.t + '-' + first.b
                  + ' of ' + s.h + '  → ' + (first.b<=s.h ? 'ABOVE THE FOLD'
                     : (Math.round(first.b/s.h*100)/100) + ' screens down'))
               : 'NONE'));

    if(!s.claim){
      /* Printed, not asserted, and the reason is in the header. */
      await b.close();
      continue;
    }

    ok(key+'.there-is-a-way-in-on-the-landing-at-all',
       !!first, 'nothing on the landing starts a practice run');
    if(!first){ ok(key+'.no-page-errors', errs.length===0, errs.slice(0,2).join(' · ')); await b.close(); continue; }

    /* ---- THE WHOLE POINT ------------------------------------------ */
    ok(key+'.the-way-in-is-above-the-fold',
       first.b <= s.h,
       '"' + first.text + '" runs y=' + first.t + '-' + first.b + ' on a ' + s.h
       + 'px screen — ' + (Math.round(first.b/s.h*100)/100)
       + ' screens down, and a stranger who does not scroll never sees it');
    ok(key+'.and-not-half-on-it',
       first.t >= 0 && first.l >= 0 && first.r <= s.w,
       'the control runs x=' + first.l + '-' + first.r + ' in a ' + s.w + 'px window');

    /* ---- REACHABLE, NOT JUST VISIBLE ------------------------------ */
    ok(key+'.a-thumb-can-hit-it',
       first.h >= 44,
       'the control is ' + first.h + 'px tall; 44px is the floor for anything a thumb has to hit');
    ok(key+'.a-keyboard-or-a-remote-can-reach-it',
       first.focusable && !first.disabled && (first.tag==='BUTTON' || first.tag==='A'),
       'the control is a <' + first.tag.toLowerCase() + '>, focusable=' + first.focusable
       + ' — hover and tap are not the only input devices in a living room');

    /* ---- AND IT ACTUALLY OPENS THE APP ---------------------------- */
    const opened=await p.evaluate((sel)=>{
      const el=[...document.querySelectorAll('#s-landing [onclick]')]
        .filter(e=>/startDemo|heroPractice/.test(e.getAttribute('onclick')||''))
        .filter(e=>e.offsetParent!==null)
        .sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top)[0];
      if(!el) return {err:'gone'};
      el.click();
      const act=document.querySelector('.screen.active');
      return {screen: act?act.id:'', sport: (typeof SPORT_KEY!=='undefined')?SPORT_KEY:'?'};
    });
    ok(key+'.tapping-it-opens-the-app',
       opened.screen==='s-name',
       'tapping the first way in landed on "' + opened.screen + '" instead of the name screen — '
       + 'a button above the fold that does not open anything is worse than one below it');
    /* The hero is about tonight's game; the door under it must practise
       tonight's sport, not whatever the page happened to boot on. */
    ok(key+'.it-practises-the-sport-the-hero-is-about',
       opened.sport==='basketball',
       'it started a ' + opened.sport + ' practice run under a WNBA hero');

    /* ---- THE HERO IS NOT THE PRICE -------------------------------- */
    ok(key+'.the-hero-still-names-both-teams',
       !!r.hero && /Tempo/i.test(r.hero.text) && /Storm/i.test(r.hero.text),
       'the hero reads "' + (r.hero?r.hero.text.slice(0,90):'(gone)')
       + '" — the way in must not be paid for out of the Game of the Night');
    ok(key+'.the-hero-still-carries-its-countdown',
       !!r.hero && r.hero.clockShown && /\d/.test(r.hero.clockText),
       'the countdown reads "' + (r.hero?r.hero.clockText:'(gone)') + '"');
    /* THE MATCHUP, not the whole box. The tip line and the two chips sit
       below the way in and are fine print; on a 640px screen they fall
       under the fold and that is the right thing to spend. The two names
       at 40px are the page's only job and they do not get to. */
    ok(key+'.the-matchup-is-still-on-the-first-screen',
       !!r.vs && r.vs.b <= s.h,
       'the fight card runs ' + (r.vs?r.vs.t+'-'+r.vs.b:'(not rendered)') + ' on a ' + s.h + 'px screen');

    /* ---- AND THE LONG WAY IN IS STILL THERE ----------------------- */
    ok(key+'.the-full-chooser-still-offers-every-sport',
       r.sports>=5,
       'the practice card offers ' + r.sports + ' sports — the short door decides one sport for you, '
       + 'so the card that lets you pick a different one is the other half of it');
    ok(key+'.the-page-still-says-there-is-more-below',
       r.scrollable>0,
       'the landing does not scroll at all, so everything under the fold has no affordance');

    ok(key+'.no-page-errors', errs.length===0, errs.slice(0,2).join(' · '));
    await b.close();
  }

  /* ============ A MEMBER IS NOT A STRANGER ==========================
     qa.js already owns this rule for the landing as a whole
     (home.member-does-not). It is repeated here for one element because
     the cheapest way to put a control above the fold is to show it to
     everybody, and selling a practice round to somebody who has played
     forty of them is the regression that check exists for. */
  {
    const {b,p,errs}=await stage(390,844);
    const m=await p.evaluate(()=>{
      try{ __signIn(); }catch(_){}
      try{ renderPortal(); }catch(_){}
      document.body.classList.add('member');
      return [...document.querySelectorAll('#s-landing [onclick]')]
        .filter(e=>/heroPractice/.test(e.getAttribute('onclick')||''))
        .filter(e=>e.offsetParent!==null).length;
    });
    await b.close();
    ok('member.does-not-get-sold-the-practice-round', m===0,
       m + ' hero practice control(s) still visible to a signed-in member');
    ok('member.no-page-errors', errs.length===0, errs.slice(0,2).join(' · '));
  }

  const verdict = fail? 'RED' : 'GREEN';
  console.log(`\n${verdict}   ${pass} passed, ${fail} failed   [${path.basename(TARGET)} · ${ENGNAME}]`
              + (SABOTAGE?'   [SABOTAGED — red is the correct result]':''));
  bad.forEach(x=>console.log('   x '+x));
  if(SABOTAGE){ process.exit(fail?0:1); }
  process.exit(fail?1:0);

})().catch(e=>{ console.log('way-in.js could not run: '+(e&&e.stack||e)); process.exit(1); });
