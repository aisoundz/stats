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
const sbOk=(where,s)=>{ if(!s.sbEnabled) return;
  ok('journey.the-network-layer-follows-you ('+where+')', s.sbRoom===s.night,
     'SB is in '+s.sbRoom+', the app is in '+s.night); };

const ok=(n,c,d)=>{ if(c){pass++; trace.push('  ok   '+n);} else {fail++; bad.push(n+(d?'  — '+d:'')); trace.push('  FAIL '+n);} };
const cb=()=> (URL_.includes('?')?'&':'?')+'cb='+Date.now();

/* Two games, in the shape the slate really has. On a live run the real
   slate is used instead — faking it there would test the fake. */
const FAKE_SLATE=[
  {nightId:'jrn-a', league:'wnba', away:'Tempo', home:'Mystics', awayAbbr:'TOR', homeAbbr:'WSH',
   awayColor:'#33476D', homeColor:'#e03a3e', tipISO:'2026-08-19T23:30Z'},
  {nightId:'jrn-b', league:'wnba', away:'Lynx', home:'Valkyries', awayAbbr:'MIN', homeAbbr:'GS',
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
  await p.waitForTimeout(LIVE?5000:1800);
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

  /* ---- 4. THE RAIL IS STILL REACHABLE MID-PICK ---------------------- */
  s=await state();
  ok('journey.you-can-still-reach-the-rail-while-picking', s.railVisible===true,
     'the way to the other game disappeared once picking started — this is the reported bug');

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

  await b.close();
  if(process.argv.includes('--trace')) trace.forEach(t=>console.log(t));
  bad.forEach(x=>console.log('  FAIL  '+x));
  console.log((fail?'RED':'GREEN')+'   '+pass+' passed, '+fail+' failed   ['+ENGINE+(PHONE?'/iPhone':'')+']   ('+(LIVE?'LIVE ':'')+URL_.replace(/\?.*/,'')+')');
  process.exit(fail?1:0);
})().catch(e=>{ console.error('JOURNEY CRASHED:', e.message); process.exit(2); });
