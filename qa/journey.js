#!/usr/bin/env node
/* =====================================================================
   THE JOURNEY — one person, two games, doing what a person does.
   ---------------------------------------------------------------------
   Founder, testing GN13 the night before:

     "when I go to one game to input the information, I dont have the
      ability to go to other game and put in my info"
     "when you sign in the app gets stuck and you cant move between games"

   Every other suite here tests a PART. qa/slate.js proves the precedence
   logic, voice-pick proves the grammar, live-smoke proves the deploy — and
   all three were green while a person could not do the one thing the
   product is for. A part that works is not a path that works.

   So this drives the whole path, in order, the way a human does it:

     land → pick game A → enter picks → switch to B → enter picks
          → switch back to A → ARE MY PICKS STILL THERE?

   and asserts at every step. It runs against a local file OR the live
   site, because "works on my machine" is exactly the gap that keeps
   catching us.

     node qa/journey.js                              # index-test.html
     node qa/journey.js --url https://statsgametime.com/
     node qa/journey.js --headed                     # watch it
   ================================================================== */
const PW=require('playwright'); const path=require('path');
const { waitReady } = require('./ready.js');
const F=require('./fixtures.js');
const ARG=(k,d)=>{const i=process.argv.indexOf('--'+k); return i>=0?process.argv[i+1]:d;};
const URL_=ARG('url', 'file://'+path.resolve(__dirname,'..','index-test.html'));
const LIVE=/^https?:/.test(URL_);
const HEADED=process.argv.includes('--headed');
/* WEBKIT IS NOT OPTIONAL HERE. The switching bug the founder hit on his
   phone passed in every Chromium run, including Chromium's own iPhone
   emulation, and failed only in WebKit — a tap inside a horizontally
   scrollable strip does not reliably become a click there. A path suite
   that only ever runs one engine would ship that class of bug again. */
const ENGINE=ARG('engine','chromium');
const BROWSER=PW[ENGINE]; if(!BROWSER){ console.error('unknown engine: '+ENGINE); process.exit(2); }
const PHONE=process.argv.includes('--phone');

let pass=0, fail=0; const bad=[], trace=[];
/* THE RAIL MUST NOT LIE. The tile marked aria-current is the app telling
   the player which room they are standing in; GAME.nightId is which room
   the app is actually holding. When a config read failed, the first version
   moved the highlight anyway and left GAME behind — a rail saying Lynx over
   a screen full of Mystics. That is B26 wearing a new coat, so it is
   asserted after EVERY step of the path, not once at the end. */
const railAgrees=(s)=>{
  const cur=(s.tiles||[]).filter(t=>t.current).map(t=>t.id);
  if(cur.length>1) return {ok:false, why:cur.length+' tiles marked current: '+cur.join(', ')};
  if(!s.night) return {ok:true};
  if(!cur.length) return {ok:false, why:'in '+s.night+' but no tile is marked current'};
  return cur[0]===s.night
    ? {ok:true}
    : {ok:false, why:'rail says '+cur[0]+', app is holding '+s.night};
};
const railOk=(where,s)=>{ const r=railAgrees(s);
  ok('journey.the-rail-never-lies-about-where-you-are ('+where+')', r.ok, r.why); };

/* THE NETWORK LAYER MUST MOVE WITH THE PLAYER. SB binds a night for reads
   and writes; it used to bind once and never rebind, which was invisible
   while switching reloaded the page and became a live bug the moment it
   did not — board, submissions and minutes all filed under the room the
   player had left. Only asserted when Firestore is actually up: a local
   run cuts the data channel on purpose, and SB is then correctly bound to
   nothing at all. */
/* SB.enabled TRUE WITH SB.room() NULL IS ITS OWN BUG, and it has a name:
   B27, where sign-in looked healthy while nightId stayed null forever and
   every room op silently failed or queued. This check used to report that
   state as "SB is in null, the app is in jrn-a" — which reads like a
   switching bug and is actually the network layer claiming to be up while
   bound to nothing. Seen under gate load 19 Aug; green 3/3 standalone, so
   it is a race that only widens when the machine is busy — which is
   exactly what a slow phone is. Named separately so the next person does
   not chase the wrong thing. */
const sbOk=(where,s)=>{ if(!s.sbEnabled) return;
  if(s.sbRoom==null){
    ok('journey.the-network-layer-is-never-up-but-roomless ('+where+')', false,
       'SB.enabled is true while SB.room() is null — B27 shape: the app is in '
       +s.night+' and the network layer is bound to nothing, so a submission '
       +'has nowhere to go. Under load, i.e. what a slow phone is.');
    return;
  }
  ok('journey.the-network-layer-follows-you ('+where+')', s.sbRoom===s.night,
     'SB is in '+s.sbRoom+', the app is in '+s.night); };

const ok=(n,c,d)=>{ if(c){pass++; trace.push('  ok   '+n);} else {fail++; bad.push(n+(d?'  — '+d:'')); trace.push('  FAIL '+n);} };
const cb=()=> (URL_.includes('?')?'&':'?')+'cb='+Date.now();

/* Two games, in the shape the slate really has. On a live run the real
   slate is used instead — faking it there would test the fake. */
const FAKE_SLATE=[
  {nightId:'jrn-a', league:'wnba', sport:'basketball', away:'Tempo', home:'Mystics', awayAbbr:'TOR', homeAbbr:'WSH',
   awayColor:'#33476D', homeColor:'#e03a3e', tipISO:'2026-08-19T23:30Z'},
  {nightId:'jrn-b', league:'wnba', sport:'basketball', away:'Lynx', home:'Valkyries', awayAbbr:'MIN', homeAbbr:'GS',
   awayColor:'#266092', homeColor:'#b38fcf', tipISO:'2026-08-20T02:00Z', flagship:true}
];

(async()=>{
  const b=await BROWSER.launch({headless:!HEADED});
  const ctx=await b.newContext(PHONE
    ? Object.assign({}, PW.devices['iPhone 13'], {hasTouch:true})
    : {viewport:{width:393,height:852}});
  const p=await ctx.newPage();
  /* WebKit refuses a fetch() of a file:// URL outright, so the build
     self-check — which asks the server for its own bytes and is meaningful
     only over http — reports a CORS error on every local WebKit run. That
     is the harness, not the product: drop it locally, keep it on --url. */
  const errs=[]; p.on('pageerror',e=>{ const m=String(e);
    if(!LIVE && /Fetch API cannot load file:/.test(m)) return;
    errs.push(m); });
  if(!LIVE) await p.route('**/site.api.espn.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(F.PRE)}));

  /* A LOCAL RUN MUST NOT RACE THE REAL SLATE. The Jetson has a network, so
     the page really did reach Firestore, really did read tomorrow's slate,
     and repainted the rail out from under a click that was already in
     flight — the suite failed on a build where switching worked. Cut the
     data channel so a local run tests the seeded two games and nothing
     else. A --url run keeps the real one, which is the point of it. */
  if(!LIVE) await p.route(/firestore\.googleapis\.com|firebaseio\.com/, r=>r.abort());

  const state=()=>p.evaluate(()=>({
    screen:(typeof S!=='undefined')?S.screen:null,
    night:(window.GAME||{}).nightId,
    home:(window.GAME||{}).homeName,
    picks:(typeof S!=='undefined')?Object.keys(S.predChoices||{}).filter(k=>!/_num$/.test(k)).length:0,
    sbRoom:(()=>{ try{ return (window.SB&&SB.room)?SB.room():undefined; }catch(_){ return undefined; } })(),
    sbEnabled:(()=>{ try{ return !!(window.SB&&SB.enabled); }catch(_){ return false; } })(),
    tiles:[...document.querySelectorAll('#gameRail [data-slate]')].map(t=>({
      id:t.getAttribute('data-slate'), current:t.getAttribute('aria-current')==='true'})),
    railVisible:(()=>{const e=document.getElementById('gameRail');
      if(!e) return false; const r=e.getBoundingClientRect();
      return getComputedStyle(e).display!=='none' && r.bottom>0 && r.top<window.innerHeight;})()
  }));

  /* A room a phone can actually ENTER. In production build-slate.js writes
     schedule/{nightId} for every game on the slate, so a tile always has a
     config behind it. Seeding only SLATE.games faked the shelf and not the
     room, and then asserted the player could walk in — which is why this
     suite failed against a build where switching genuinely worked. Stub
     what production guarantees; test what production does. */
  const cfgFor=(g)=>({
    game:{nightId:g.nightId, espnEvent:'40185'+g.nightId.length, sport:'basketball',
          awayName:g.away, homeName:g.home, awayAbbr:g.awayAbbr, homeAbbr:g.homeAbbr,
          awayColor:g.awayColor, homeColor:g.homeColor, tipISO:g.tipISO},
    roster:{home:[g.home+' One', g.home+' Two'], away:[g.away+' One', g.away+' Two']},
    preds:[{id:'winner', q:'Who takes it?', label:'Winner', base:100,
            opts:[g.away, g.home], answer:g.home},
           {id:'margin', q:'How close?', label:'Margin', base:100,
            opts:['1-5','6-12','13+'], answer:'6-12'}]
  });

  /* THE FLAGSHIP IS ON THE RAIL TOO, and it is the one room whose config
     is NOT in schedule/{nightId} — a human wrote it into index.html and
     publish.js is told to leave it alone. So it is the room most likely to
     be unreachable, and it was: measured live, out of gn13 fine, back into
     gn13 never. Adding it here means the path this suite drives includes
     the game the whole night is named after. */
  const seed=async()=>{ if(LIVE) return;
    await p.evaluate((games)=>{
      /* THE BUILT-IN night, not the CURRENT one. Reading GAME.nightId here
         meant that after the first switch this re-added the room we were
         already in and the flagship silently never made it onto the rail —
         so the check failed for the wrong reason and would have sent me
         hunting a bug in the app. */
      const built = (window.BUILTIN_NIGHT||{}).id;
      const all = games.slice();
      if(built && !all.some(g=>g.nightId===built))
        all.push({nightId:built, league:'wnba', sport:'basketball',
                  away:'Home Built', home:'In Night', awayAbbr:'BLT', homeAbbr:'INN',
                  awayColor:'#266092', homeColor:'#b38fcf', tipISO:'2026-08-20T02:00Z'});
      window.SLATE.games=all; window.SLATE.loaded=true;
      window.SLATE.date='2026-08-19'; paintGameRail();
    }, FAKE_SLATE); };

  const seedConfigs=async()=>{ if(LIVE) return;
    await p.evaluate((cfgs)=>{ cfgs.forEach(c=>{
      try{ localStorage.setItem('stats_night_cfg_'+c.game.nightId, JSON.stringify(c)); }catch(_){}
    }); }, FAKE_SLATE.map(cfgFor)); };

  await p.goto(URL_+cb(),{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>typeof window.paintGameRail==='function',{timeout:20000});
  await waitReady(p);   /* was await p.waitForTimeout(LIVE?5000:1800); — a guess at boot */
  await seedConfigs();
  await seed();

  /* ---- 1. two games are offered, and the rail is reachable ---------- */
  let s=await state();
  ok('journey.two-games-are-offered', s.tiles.length>=2, `${s.tiles.length} tile(s)`);
  ok('journey.the-rail-is-on-screen', s.railVisible===true, 'the rail is not visible on the landing');
  const A=s.tiles.find(t=>!t.current) || s.tiles[0];
  const B=s.tiles.find(t=>t.id!==A.id);
  if(!A||!B){ console.log('  cannot run without two games'); await b.close(); process.exit(2); }

  /* ---- 2. choose game A -------------------------------------------- */
  await p.click(`[data-slate="${A.id}"]`);
  await p.waitForTimeout(LIVE?4500:2200);
  s=await state();
  ok('journey.choosing-a-game-lands-you-in-it', s.night===A.id,
     `asked for ${A.id}, GAME.nightId is ${s.night}`);
  railOk('first choice', s);
  sbOk('first choice', s);

  /* ---- 3. open the pick sheet and enter picks ----------------------- */
  await seed();
  const entered=await p.evaluate(async()=>{
    try{
      startDemo(); S.name='QA';
      try{ await loadGameStats(true); }catch(e){}
      startPredict(); await new Promise(r=>setTimeout(r,700));
      const o=document.querySelectorAll('#predCard .pdopt'); if(!o.length) return {err:'no options'};
      o[0].click(); await new Promise(r=>setTimeout(r,400));
      return {picks:Object.keys(S.predChoices||{}).filter(k=>!/_num$/.test(k)).length, screen:S.screen,
              choices:JSON.stringify(S.predChoices||{})};
    }catch(e){ return {err:String(e.message)}; }
  });
  ok('journey.the-pick-sheet-opens', !entered.err && entered.screen==='predict', entered.err||`screen=${entered.screen}`);
  ok('journey.a-pick-is-recorded', (entered.picks||0)>=1, `${entered.picks} pick(s)`);

  /* ---- 4. THE RAIL IS STILL REACHABLE MID-PICK ----------------------
     WHAT "REACHABLE" MEANS CHANGED ON 21 AUG, AND NOT BY WEAKENING IT.

     This asserted the rail was IN THE VIEWPORT, which was free while the
     rail was `position:sticky` — it followed the player everywhere. That
     stickiness is what put a 130px chooser on top of a live question and
     failed qa/chrome.js at 17 of 28 scroll positions on an iPhone SE, so
     the rail is static now and sits at the top of the screen instead.

     The bug this check remembers is REAL and must stay covered: "the way
     to the other game disappeared once picking started." So the claim is
     still that a player can get there — it is the route that changed,
     from "it is already under your eyes" to "scroll up and it is the
     first thing on the page."

     That is not the same trade as the horizontal strip. A sideways scroll
     inside a nested box is an ASSUMPTION about the device — a wheel
     cannot do it, a remote cannot. Scrolling the page vertically is how
     you read the page at all; every device that can show this screen can
     do it. So: scroll to the top of the screen the player is actually on,
     and demand the rail be there, with its tiles, ready to tap. */
  const reach = await p.evaluate(async()=>{
    const app=document.getElementById('app');
    if(app) app.scrollTop=0;
    window.scrollTo(0,0);
    await new Promise(r=>setTimeout(r,120));
    const e=document.getElementById('gameRail');
    if(!e) return {ok:false, why:'no rail element'};
    const r=e.getBoundingClientRect();
    return {
      ok: getComputedStyle(e).display!=='none' && r.height>0
          && r.bottom>0 && r.top<window.innerHeight,
      tiles: e.querySelectorAll('[data-slate]').length,
      top: Math.round(r.top), h: Math.round(r.height)
    };
  });
  ok('journey.you-can-still-reach-the-rail-while-picking',
     reach.ok===true && reach.tiles>=2,
     `scrolled to the top mid-pick and the rail was not there (top=${reach.top} h=${reach.h} tiles=${reach.tiles}) `+
     `— the way to the other game disappeared once picking started, which is the reported bug`);

  /* ---- 5. switch to game B ----------------------------------------- */
  await p.click(`[data-slate="${B.id}"]`);
  await p.waitForTimeout(LIVE?4500:2200);
  await seed();
  s=await state();
  ok('journey.switching-mid-pick-actually-switches', s.night===B.id,
     `asked for ${B.id}, GAME.nightId is ${s.night}`);
  railOk('in B', s);
  sbOk('in B', s);
  ok('journey.the-other-game-starts-clean', s.picks===0,
     `${s.picks} pick(s) carried into the other room`);

  /* ---- 6. pick in B ------------------------------------------------- */
  const enteredB=await p.evaluate(async()=>{
    try{
      startDemo(); S.name='QA';
      try{ await loadGameStats(true); }catch(e){}
      startPredict(); await new Promise(r=>setTimeout(r,700));
      /* A DIFFERENT OPTION FROM THE ONE ROOM A CHOSE. Picking the same one
         made the come-back check pass even with the room store ripped out:
         if nothing is ever restored, A's card simply never left, and a
         count of 1 looks identical to a card that came home. Two rooms must
         hold two DISTINGUISHABLE cards or this path proves nothing. */
      const o=document.querySelectorAll('#predCard .pdopt'); if(!o.length) return {err:'no options'};
      o[o.length>1?1:0].click(); await new Promise(r=>setTimeout(r,400));
      return {picks:Object.keys(S.predChoices||{}).filter(k=>!/_num$/.test(k)).length,
              choices:JSON.stringify(S.predChoices||{})};
    }catch(e){ return {err:String(e.message)}; }
  });
  ok('journey.you-can-pick-in-the-second-game', (enteredB.picks||0)>=1,
     enteredB.err||`${enteredB.picks} pick(s) — this is the reported bug`);

  /* ---- 7. back to A. IS MY CARD STILL THERE? ------------------------ */
  await p.click(`[data-slate="${A.id}"]`);
  await p.waitForTimeout(LIVE?4500:2200);
  await seed();
  s=await state();
  ok('journey.you-can-get-back-to-the-first-game', s.night===A.id,
     `asked for ${A.id}, GAME.nightId is ${s.night}`);
  railOk('back in A', s);
  sbOk('back in A', s);
  /* THE ONE THE FOUNDER ASKED FOR: walk back in, is the card still there.
     This used to read localStorage — but save() deliberately writes nothing
     in practice mode, so it was asserting a disk write that correctly never
     happens and saying nothing about what the player sees. The room store
     holds a card in MEMORY; the visible card is the guarantee. Disk is a
     separate promise, checked separately below for a live room. */
  const backA=await p.evaluate(()=>JSON.stringify(S.predChoices||{}));
  ok('journey.the-room-you-left-kept-your-card',
     (s.picks||0)>=1 && backA===entered.choices,
     `back in ${A.id} with ${s.picks} pick(s); expected ${entered.choices}, got ${backA}`);
  ok('journey.the-two-rooms-held-different-cards', entered.choices!==enteredB.choices,
     'both rooms recorded the same answer — this path cannot tell a restore from a leak');

  /* And for a real (live) room, the card must also survive a reload, which
     is a different mechanism — per-night localStorage, not the store. */
  const kept=await p.evaluate((id)=>{
    try{
      const was=S.mode; S.mode='live'; save(); S.mode=was;
      const raw=localStorage.getItem('stats_gamenight_v1_basketball_'+id);
      if(!raw) return {saved:false};
      const v=JSON.parse(raw);
      return {saved:true, nid:v.nid,
              picks:Object.keys(v.predChoices||{}).filter(k=>!/_num$/.test(k)).length};
    }catch(e){ return {saved:false, err:String(e.message)}; }
  }, A.id);
  ok('journey.a-live-room-saves-under-its-own-night',
     kept.saved===true && kept.nid===A.id && (kept.picks||0)>=1,
     kept.err||`saved=${kept.saved} nid=${kept.nid} picks=${kept.picks} — a reload would lose it`);

  ok('journey.no-page-errors-anywhere', errs.length===0, errs.slice(0,2).join(' | '));

  /* ---- 8. and back into the night this build was born knowing ------- */
  if(!LIVE){
    const built = await p.evaluate(()=>(window.BUILTIN_NIGHT||{}).id||null);
    if(built){
      await p.evaluate(id=>chooseGame(null,null,id), built);
      await p.waitForTimeout(1200);
      await seed();
      const bs = await state();
      ok('journey.you-can-walk-back-into-the-flagship', bs.night===built,
         `asked for the built-in night ${built}, the app is holding ${bs.night} — its config is in this file, not in schedule/, so nothing can load it and the guard correctly refuses; it has to be restorable from what we already hold`);
      railOk('flagship', bs);
    } else {
      ok('journey.you-can-walk-back-into-the-flagship', false,
         'BUILTIN_NIGHT is not exposed — the built-in config is not captured before hydration overwrites it');
    }
  }

  /* ---- 8b. A CONFIG READ THAT NEVER RETURNS -------------------------
     Measured on the LIVE site 19 Aug: tapping the other game worked on two
     runs in five, and every failure was the same shape — chooseGame was
     entered and never came back. Firestore's getDoc carries no timeout, so
     a stalled read left the await pending forever: the pick remembered,
     the room never opened, nothing logged, the player tapping a tile that
     did nothing until they reloaded. That is the founder's original
     complaint and it survived the room store, because the room store was
     never the thing that hung.

     This is the check that would have caught it. Nothing in chooseGame may
     wait without a bound. */
  if(!LIVE){
    const hung = await p.evaluate(async(aid)=>{
      const realLoad = window.loadNightConfig;
      const realDB = window.__SB_DB, realFS = window.__SB_FS;
      window.__SB_DB = window.__SB_DB || {}; window.__SB_FS = window.__SB_FS || {};
      window.loadNightConfig = function(){ return new Promise(function(){}); };   // never settles
      /* RACE THE CALL ITSELF, or a regression hangs this suite instead of
         failing it — which is how a gate stops being run at all. Sabotage
         proved that: with the await unbounded, this check sat forever. */
      const t0 = Date.now();
      let ok = null, threw = null, hung = false;
      try{
        ok = await Promise.race([
          chooseGame(null, null, aid),
          new Promise(function(res){ setTimeout(function(){ hung = true; res('HUNG'); }, 9000); })
        ]);
      }catch(e){ threw = String(e.message); }
      const out = { ok, threw, hung, ms: Date.now()-t0, night:(window.GAME||{}).nightId };
      window.loadNightConfig = realLoad; window.__SB_DB = realDB; window.__SB_FS = realFS;
      return out;
    }, A.id);
    ok('journey.a-dead-config-read-does-not-hang-the-tap',
       hung.hung !== true && hung.ms < 8000 && hung.threw === null,
       `chooseGame took ${hung.ms}ms against a read that never settles${hung.threw?' and threw '+hung.threw:''} — an unbounded await is a tap that does nothing, forever, with nothing logged`);
    ok('journey.a-dead-config-read-still-lands-the-room',
       hung.night === A.id,
       `the app ended up in ${hung.night} — with the cached config on this phone it must still get into ${A.id}`);
  }

  /* ---- 9. AND ANOTHER SPORT IS STILL THE SAME PAGE ------------------
     The weekend is WNBA, MLB and NFL rooms on one rail. Tapping the
     ballgame used to set ?game= and nothing else: hydrateNight correctly
     refused to lay a baseball config over a basketball page, and the
     player sat on the WNBA night WHILE THE RUNNER HOSTED THE BALLGAME.
     Every answer graded against a game they were not being shown.

     What has to move is not just the night. It is how many rounds there
     are, what the card is worth, what this phone saves under, and what the
     app CALLS the start of a game — a baseball night that says "tip-off"
     is a basketball app wearing a hat. */
  if(!LIVE){
    const cross = await p.evaluate(async()=>{
      const before = {sport:SPORT_KEY, start:(L&&L.start)||null};
      window.__SAME_DOCUMENT = 'yes';
      window.SLATE.games = window.SLATE.games.concat([{
        nightId:'jrn-mlb', league:'mlb', sport:'baseball', away:'Jays', home:'Yankees',
        awayAbbr:'TOR', homeAbbr:'NYY', awayColor:'#134A8E', homeColor:'#0C2340'}]);
      paintGameRail();
      localStorage.setItem('stats_night_cfg_jrn-mlb', JSON.stringify({
        game:{nightId:'jrn-mlb', espnEvent:'401816628', sport:'baseball',
              awayName:'Jays', homeName:'Yankees', awayAbbr:'TOR', homeAbbr:'NYY'},
        roster:{home:['NYY One','NYY Two'], away:['TOR One','TOR Two']},
        preds:[{id:'w', q:'Who takes it?', label:'Winner', base:100, opts:['Jays','Yankees'], answer:'Yankees'},
               {id:'r', q:'How many runs?', label:'Runs', base:100, opts:['0-5','6+'], answer:'6+'}]}));
      const ok = await chooseGame(null,null,'jrn-mlb');
      await new Promise(r=>setTimeout(r,400));
      return { ok, before,
        sport:SPORT_KEY, night:(window.GAME||{}).nightId, rounds:NR,
        worth:PRED_MAX, cardIs:preds.length*100, lsBase:LS_BASE,
        start:(L&&L.start)||null, same:window.__SAME_DOCUMENT||null,
        url:location.search };
    });
    ok('journey.a-game-in-another-sport-opens', cross.night==='jrn-mlb' && cross.sport==='baseball',
       `asked for a baseball room; the app is in ${cross.sport} holding ${cross.night}`);
    ok('journey.the-sport-swap-does-not-reload', cross.same==='yes',
       'the page reloaded to change sport — the room store made switching games a swap and the sport must move the same way');
    /* NINE, NOT THREE. Reversed 31 Aug 2026 on the founder's rule that
       baseball asks at the END OF EVERY INNING. This check read ===3 and
       would have gone red on any correct implementation of that rule — the
       same shape as pretip.the-button-says-so demanding the word "tips".
       NR is what the overtime guard measures "past regulation" against, so
       a wrong number here is not cosmetic: at 3, a live night pushing the
       4th through the 9th has every one of those rounds dropped as an
       unnamed overtime and no player ever sees them. */
    ok('journey.the-round-count-follows-the-sport', cross.rounds===9,
       `baseball plays 9 rounds, one an inning; the app thinks there are ${cross.rounds}`);
    ok('journey.the-card-is-worth-what-it-pays', cross.worth===cross.cardIs,
       `the sheet promises ${cross.worth} over a card that pays ${cross.cardIs} — a total worked out from the sport we LEFT`);
    ok('journey.the-words-follow-the-sport', cross.start==='first pitch',
       `a baseball night calls its start "${cross.start}" — that vocabulary belongs to ${cross.before.sport}`);
    ok('journey.the-save-key-follows-the-sport', /baseball/.test(cross.lsBase||''),
       `saves would land under ${cross.lsBase}, so a baseball card would be restored into a basketball night`);
    ok('journey.the-link-names-the-sport', /sport=baseball/.test(cross.url) && /game=jrn-mlb/.test(cross.url),
       `the URL is "${cross.url}" — a shared link has to open on the right sport`);

    /* THE WEEKEND, IN ONE PATH: a card in the ballgame, a card in the
       basketball game, and walking between them. The room store already
       proves this within one sport; a sport swap tears down more (round
       count, card worth, save key) and is where it would break. */
    const both = await p.evaluate(async(aid)=>{
      const n = () => Object.keys(S.predChoices||{}).filter(k=>!/_num$/.test(k)).length;
      S.sport = 'hockey';                    // what the PERSON told us their sport is
      const o = {};
      startDemo(); S.name='QA';
      try{ await loadGameStats(true); }catch(e){}
      startPredict(); await new Promise(r=>setTimeout(r,600));
      const opt = document.querySelector('#predCard .pdopt'); if(opt) opt.click();
      await new Promise(r=>setTimeout(r,300));
      o.mlbPicks = n();
      await chooseGame(null,null,aid); await new Promise(r=>setTimeout(r,500));
      o.backSport = SPORT_KEY; o.backNight = (window.GAME||{}).nightId; o.backPicks = n();
      await chooseGame(null,null,'jrn-mlb'); await new Promise(r=>setTimeout(r,500));
      o.mlbAgainSport = SPORT_KEY; o.mlbAgainPicks = n();
      o.favourite = S.sport;
      return o;
    }, A.id);
    ok('journey.a-card-in-each-sport-survives-the-other',
       both.mlbPicks>=1 && both.mlbAgainPicks>=1,
       `picked ${both.mlbPicks} in the ballgame, came back to ${both.mlbAgainPicks} — a room's card must survive a sport change`);
    ok('journey.coming-back-brings-the-sport-with-you',
       both.backSport==='basketball' && both.backNight===A.id && both.mlbAgainSport==='baseball',
       `back in ${A.id} the app was in ${both.backSport}, then the ballgame was ${both.mlbAgainSport}`);
    ok('journey.the-room-does-not-overwrite-your-favourite-sport',
       both.favourite==='hockey',
       `the player told us "hockey" and after moving through baseball and basketball rooms their profile says "${both.favourite}" — the room's sport and the person's sport are different facts and must not share a field`);
  }

  await b.close();
  if(process.argv.includes('--trace')) trace.forEach(t=>console.log(t));
  bad.forEach(x=>console.log('  FAIL  '+x));
  console.log((fail?'RED':'GREEN')+'   '+pass+' passed, '+fail+' failed   ['+ENGINE+(PHONE?'/iPhone':'')+']   ('+(LIVE?'LIVE ':'')+URL_.replace(/\?.*/,'')+')');
  process.exit(fail?1:0);
})().catch(e=>{ console.error('JOURNEY CRASHED:', e.message); process.exit(2); });
