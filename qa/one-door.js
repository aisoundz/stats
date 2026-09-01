#!/usr/bin/env node
/* =====================================================================
   ONE WAY IN READS AS "THE BUTTON". EXACTLY ONE.
   ---------------------------------------------------------------------
   Founder, 26 Aug, looking at the home screen: "We don't need 2 try it
   out. It's redundant."

   He was right, and the shipped build is the evidence. index.html has
   TWO full-width teal buttons on the landing that call the same practice
   flow:

       y ≈  480   "Try a practice round"   .btn.tryGo.mq-try   heroPractice()
       y ≈ 1560   "Try it now"             .btn.tryGo          startDemo()

   Same fill, same width, same weight, same destination, about 1,100px
   apart on a 390x844 phone, each under its own version of the same
   pitch. A page with two identical calls to action does not have a
   strong call to action; it has a stranger deciding which of two
   identical things is the real one.

   WHAT THIS SUITE ASSERTS, and it is deliberately not "the class I
   removed is gone": it finds every VISIBLE control on the landing that
   starts a practice run — anything wired to startDemo() or
   heroPractice() — and asks how each one is PAINTED. A control counts as
   PRIMARY if it is filled: a solid background (alpha ≥ .5) or a
   gradient. Ghost buttons, outlines and text links are not.

       · exactly ONE primary practice control exists
       · it is the TOPMOST one — the invitation is at the top of the
         page, not buried under it
       · every other practice control is demoted on paint, not just on
         wording: unfilled AND smaller type than the primary
       · no two practice controls carry the same label
       · the demoted one still WORKS — real button, 44px, opens the app

   AND THE CHOOSER SURVIVES. The cheapest way to have one door is to
   delete the other one, which would also delete the only route to four
   of the five leagues. So the same run requires the sport chooser to
   still offer every sport it can practise, and requires it not to launch
   a game on a tap: somebody thumbing along the pills to see what is on
   offer must not be thrown into a round by the act of looking.

   IT MUST GO RED ON index.html:

       node qa/one-door.js index.html         # expect RED (2 primaries)
       node qa/one-door.js index-test.html    # expect GREEN
       node qa/one-door.js --sabotage         # expect RED

   --sabotage re-tealises the demoted button, which is the exact
   regression this file exists to catch.

   ENGINES. --firefox (default) and --chromium. WebKit crashes on this
   Jetson and is not claimed; no real device is claimed either.
   ================================================================== */
const PW=require('playwright');
const path=require('path'), fs=require('fs'), os=require('os');
const F=require('./fixtures.js');
const {waitReady}=require('./ready.js');

const ARG=process.argv.slice(2);
const TARGET=path.resolve(ARG.find(a=>/\.html$/.test(a)) || path.join(__dirname,'..','index-test.html'));
const SABOTAGE=ARG.includes('--sabotage');
const ENGNAME=(ARG.includes('--chromium') || ARG[ARG.indexOf('--engine')+1]==='chromium')?'chromium':'firefox';
const ENG=PW[ENGNAME];

let pass=0, fail=0; const bad=[];
const ok=(n,c,d)=>{ if(c) pass++; else { fail++; bad.push(n+(d?'  — '+d:'')); } };

/* Put the second teal button back exactly as it shipped. If the demoted
   control is ever renamed this throws rather than silently passing. */
function sabotage(html){
  const m=/<button class="btn ghost sm" id="tryAltBtn"/;
  if(!m.test(html)) throw new Error('sabotage could not find the demoted practice button — the fix changed shape and this file must be updated with it');
  return html.replace(m, '<button class="btn tryGo" id="tryAltBtn"');
}

/* The same night way-in.js measures: three games on the slate, a WNBA
   hero three hours out. A one-game fixture hides the rail and measures a
   page nobody meets. */
const SETUP=`(function(){
  try{ window.loadGameStats=async function(){ return null; }; }catch(_){}
  try{ GS.ok=false; GS.ev=null; }catch(_){}
  var tip=new Date(Date.now()+3*3600*1000).toISOString();
  try{
    TONIGHT={nightId:'slate-2026-08-25-tor-sea',sport:'basketball',league:'wnba',
      away:'Tempo',home:'Storm',awayName:'Tempo',homeName:'Storm',
      awayAbbr:'TOR',homeAbbr:'SEA',
      awayColor:'#33476D',homeColor:'#2C5234',tipISO:tip};
  }catch(_){}
  try{ GAME.tipISO=tip; }catch(_){}
  try{
    SLATE.date='2026-08-25'; SLATE.loaded=true;
    try{ window.loadSlate=async function(){ return; }; }catch(_){}  /* pin the fixture: a late loadSlate() rewrites SLATE.games and the check then grades the live slate. Four suites hit this on 31 Aug. */
    SLATE.games=[
      {nightId:'slate-2026-08-25-lad-atl',league:'mlb',gn:30,gotn:true,away:'Dodgers',home:'Braves',
       awayAbbr:'LAD',homeAbbr:'ATL',awayColor:'#005A9C',homeColor:'#CE1141',tipISO:tip},
      {nightId:'slate-2026-08-25-tor-sea',league:'wnba',gn:19,away:'Tempo',home:'Storm',
       awayAbbr:'TOR',homeAbbr:'SEA',awayColor:'#33476D',homeColor:'#2C5234',tipISO:tip},
      {nightId:'slate-2026-08-25-chi-ind',league:'wnba',gn:20,away:'Sky',home:'Fever',
       awayAbbr:'CHI',homeAbbr:'IND',awayColor:'#418FDE',homeColor:'#FDBB30',tipISO:tip}];
    paintGameRail();
  }catch(_){}
  try{ applySport(); }catch(_){}
  try{ renderPortal(); }catch(_){}
  try{ paintTryPick(); }catch(_){}
  try{ go('landing'); }catch(_){}
})`;

async function stage(w,h){
  const b=await ENG.launch();
  const ctx=await b.newContext({viewport:{width:w,height:h}, deviceScaleFactor:1});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,160)));

  let html=fs.readFileSync(TARGET,'utf8');
  if(SABOTAGE) html=sabotage(html);
  const tmp=path.join(os.tmpdir(),'one-door-under-test-'+process.pid+'.html');
  fs.writeFileSync(tmp,html);

  await p.route('**/site.api.espn.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(F.PRE)}));
  await p.route('**/assets.mailerlite.com/**', r=>r.fulfill({status:200,body:'{}'}));
  await p.goto('file://'+tmp,{waitUntil:'domcontentloaded'});
  await waitReady(p);
  await p.evaluate(SETUP+'()');
  await p.evaluate(async()=>{ try{ await paintHeroRibbon(); }catch(_){} });
  try{ await p.evaluate(()=>document.fonts && document.fonts.ready); }catch(_){}
  await p.waitForTimeout(300);
  return {b,p,errs};
}

/* HOW IT IS PAINTED, not what it is called. A control is PRIMARY when it
   is filled — a solid background or a gradient. That is the property the
   eye sorts on from six feet away, and it is the property both of the
   shipped buttons shared. */
const READ = ()=>{
  const doc=document.scrollingElement||document.documentElement;
  doc.scrollTop=0; window.scrollTo(0,0);
  const sec=document.getElementById('s-landing');
  const R=el=>{ const r=el.getBoundingClientRect();
    return {t:Math.round(r.top),b:Math.round(r.bottom),l:Math.round(r.left),
            r:Math.round(r.right),h:Math.round(r.height),w:Math.round(r.width)}; };
  const vis=el=>!!el && el.offsetParent!==null && el.getBoundingClientRect().height>4;

  const filled=cs=>{
    if(/gradient/i.test(cs.backgroundImage||'')) return true;
    const m=String(cs.backgroundColor||'').match(/rgba?\(([^)]+)\)/i);
    if(!m) return false;
    const p=m[1].split(',').map(x=>parseFloat(x));
    const a=(p.length<4)?1:p[3];
    return a>=0.5;
  };

  const doors=[...sec.querySelectorAll('[onclick]')]
    .filter(el=>/startDemo|heroPractice/.test(el.getAttribute('onclick')||''))
    .filter(vis)
    .map(el=>{ const cs=getComputedStyle(el);
      return Object.assign(R(el), {
        tag: el.tagName,
        text: (el.textContent||'').replace(/\s+/g,' ').trim(),
        primary: filled(cs),
        fontPx: Math.round(parseFloat(cs.fontSize)||0),
        weight: String(cs.fontWeight||''),
        bg: cs.backgroundColor,
        bgImg: /gradient/i.test(cs.backgroundImage||'') ? 'gradient' : 'none',
        disabled: !!el.disabled,
        focusable: el.tabIndex >= 0 || el.tagName==='BUTTON' || el.tagName==='A'
      }); })
    .sort((a,b)=>a.t-b.t);

  return {
    vw:innerWidth, vh:innerHeight, doors,
    sports: document.querySelectorAll('#tryPick button').length,
    /* The card must still SAY what it is for. */
    cardText: (function(){ const c=document.getElementById('portalCard');
      return c ? (c.innerText||'').replace(/\s+/g,' ').trim() : ''; })()
  };
};

const SIZES=[
  {w:390, h:844,  why:'iPhone 14/15'},
  {w:360, h:640,  why:'a small Android'},
  {w:1440,h:788,  why:'a 1440x900 Mac after browser chrome'}
];

(async()=>{
  console.log('\n=== ONE PRIMARY WAY IN ===   '
    + path.basename(TARGET) + ' · ' + ENGNAME + (SABOTAGE?' · SABOTAGED':''));

  for(const s of SIZES){
    const key=s.w+'x'+s.h;
    const {b,p,errs}=await stage(s.w,s.h);
    const r=await p.evaluate(READ);

    console.log('\n  ' + s.w + 'x' + s.h + '   (' + s.why + ')');
    r.doors.forEach(d=>console.log('    ' + (d.primary?'PRIMARY ':'demoted ')
      + '"' + d.text + '"  y=' + d.t + '-' + d.b + '  ' + d.w + 'x' + d.h
      + '  ' + d.fontPx + 'px/' + d.weight + '  bg=' + d.bg + ' ' + d.bgImg));

    const prim=r.doors.filter(d=>d.primary);
    const rest=r.doors.filter(d=>!d.primary);

    ok(key+'.exactly-one-primary-practice-action',
       prim.length===1,
       prim.length + ' filled practice buttons on one screen — '
       + prim.map(d=>'"'+d.text+'" at y='+d.t).join(' and ')
       + '. Two identical calls to action is not two chances to convert, '
       + 'it is a stranger choosing which one is real');

    ok(key+'.the-primary-is-the-topmost-one',
       r.doors.length>0 && r.doors[0].primary,
       'the topmost practice control is "' + (r.doors[0]?r.doors[0].text:'(none)')
       + '" and it is not the filled one — the invitation is below something '
       + 'quieter that does the same job');

    ok(key+'.the-others-are-demoted-on-paint',
       rest.every(d=>!d.primary && prim.length===1 && d.fontPx < prim[0].fontPx),
       rest.map(d=>'"'+d.text+'" is '+d.fontPx+'px vs the primary\'s '
         +(prim[0]?prim[0].fontPx:'?')+'px').join(' · ')
       || 'no secondary control to compare');

    ok(key+'.no-two-doors-say-the-same-thing',
       new Set(r.doors.map(d=>d.text.toLowerCase())).size === r.doors.length,
       'two practice controls read "' + r.doors.map(d=>d.text).join('" / "') + '"');

    /* A demoted control that nobody can hit is not a demotion, it is a
       deletion with extra steps. */
    rest.forEach((d,i)=>{
      ok(key+'.secondary-'+i+'-is-still-a-real-target',
         d.h>=44 && d.focusable && !d.disabled && (d.tag==='BUTTON'||d.tag==='A'),
         '"'+d.text+'" is '+d.h+'px tall, <'+d.tag.toLowerCase()+'>, focusable='+d.focusable);
    });

    /* ---- AND THE OTHER FOUR LEAGUES ARE STILL REACHABLE ----------- */
    ok(key+'.the-chooser-still-offers-every-sport',
       r.sports>=5,
       'the practice card offers ' + r.sports + ' sports — the one door decides '
       + 'ONE sport for you, so the chooser is the other half of it and cannot '
       + 'be what gets deleted to make the screen tidy');

    ok(key+'.the-card-says-what-it-is-for',
       /sport/i.test(r.cardText),
       'the practice card never mentions a sport, so nothing tells a baseball '
       + 'fan that this is where they go');

    ok(key+'.no-page-errors', errs.length===0, errs.slice(0,2).join(' · '));
    await b.close();
  }

  /* ============ A PILL IS A CHOICE, NOT A TRAPDOOR ==================
     If picking a sport launched the round, someone thumbing the five
     pills to see what is offered would be dropped into a game they did
     not ask for. Tapping one must select and stay put. */
  {
    const {b,p,errs}=await stage(390,844);
    const after=await p.evaluate(()=>{
      const pills=[...document.querySelectorAll('#tryPick button')];
      const last=pills[pills.length-1];
      if(!last) return {err:'no pills'};
      const label=(last.textContent||'').trim();
      last.click();
      const act=document.querySelector('.screen.active');
      /* paintTryPick() rebuilds the row on every pick, so the node that
         was clicked is detached by the time this reads back. Ask the
         REPAINTED row which pill is lit, by label. */
      const now=[...document.querySelectorAll('#tryPick button')]
        .filter(e=>(e.textContent||'').trim()===label)[0];
      return {screen: act?act.id:'', label,
              on: !!now && now.classList.contains('on'),
              sport:(typeof SPORT_KEY!=='undefined')?SPORT_KEY:'?'};
    });
    ok('pill.selecting-a-sport-does-not-launch-a-game',
       after.screen==='s-landing',
       'tapping the "' + after.label + '" pill navigated to "' + after.screen
       + '" — browsing what is on offer must not start a round');
    ok('pill.selecting-a-sport-visibly-selects-it',
       after.on===true,
       'the "' + after.label + '" pill does not light up when tapped, so the '
       + 'button underneath it has no visible subject');

    /* ...and the demoted button finishes the sentence the pill started. */
    const opened=await p.evaluate(()=>{
      const el=[...document.querySelectorAll('#portalCard [onclick]')]
        .filter(e=>/startDemo|heroPractice/.test(e.getAttribute('onclick')||''))
        .filter(e=>e.offsetParent!==null)[0];
      if(!el) return {err:'gone'};
      el.click();
      const act=document.querySelector('.screen.active');
      return {screen: act?act.id:'', sport:(typeof SPORT_KEY!=='undefined')?SPORT_KEY:'?'};
    });
    ok('secondary.still-starts-the-practice-run',
       opened.screen==='s-name',
       'the demoted button landed on "' + opened.screen + '" instead of the name screen');
    ok('secondary.starts-the-sport-that-was-picked',
       opened.sport===undefined ? false : opened.sport===after.sport,
       'picked ' + after.sport + ' and started ' + opened.sport
       + ' — a chooser that does not govern the button is decoration');
    ok('pill.no-page-errors', errs.length===0, errs.slice(0,2).join(' · '));
    await b.close();
  }

  const verdict = fail? 'RED' : 'GREEN';
  console.log(`\n${verdict}   ${pass} passed, ${fail} failed   [${path.basename(TARGET)} · ${ENGNAME}]`
              + (SABOTAGE?'   [SABOTAGED — red is the correct result]':''));
  bad.forEach(x=>console.log('   x '+x));
  if(SABOTAGE){ process.exit(fail?0:1); }
  process.exit(fail?1:0);

})().catch(e=>{ console.log('one-door.js could not run: '+(e&&e.stack||e)); process.exit(1); });
