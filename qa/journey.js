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
const {chromium}=require('playwright'); const path=require('path');
const F=require('./fixtures.js');
const ARG=(k,d)=>{const i=process.argv.indexOf('--'+k); return i>=0?process.argv[i+1]:d;};
const URL_=ARG('url', 'file://'+path.resolve(__dirname,'..','index-test.html'));
const LIVE=/^https?:/.test(URL_);
const HEADED=process.argv.includes('--headed');

let pass=0, fail=0; const bad=[], trace=[];
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
  const b=await chromium.launch({headless:!HEADED});
  const ctx=await b.newContext({viewport:{width:393,height:852}});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  if(!LIVE) await p.route('**/site.api.espn.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(F.PRE)}));

  const state=()=>p.evaluate(()=>({
    screen:(typeof S!=='undefined')?S.screen:null,
    night:(window.GAME||{}).nightId,
    home:(window.GAME||{}).homeName,
    picks:(typeof S!=='undefined')?Object.keys(S.predChoices||{}).filter(k=>!/_num$/.test(k)).length:0,
    tiles:[...document.querySelectorAll('#gameRail [data-slate]')].map(t=>({
      id:t.getAttribute('data-slate'), current:t.getAttribute('aria-current')==='true'})),
    railVisible:(()=>{const e=document.getElementById('gameRail');
      if(!e) return false; const r=e.getBoundingClientRect();
      return getComputedStyle(e).display!=='none' && r.bottom>0 && r.top<window.innerHeight;})()
  }));

  const seed=async()=>{ if(LIVE) return;
    await p.evaluate((games)=>{ window.SLATE.games=games; window.SLATE.loaded=true;
      window.SLATE.date='2026-08-19'; paintGameRail(); }, FAKE_SLATE); };

  await p.goto(URL_+cb(),{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>typeof window.paintGameRail==='function',{timeout:20000});
  await p.waitForTimeout(LIVE?5000:1800);
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

  /* ---- 3. open the pick sheet and enter picks ----------------------- */
  await seed();
  const entered=await p.evaluate(async()=>{
    try{
      startDemo(); S.name='QA';
      try{ await loadGameStats(true); }catch(e){}
      startPredict(); await new Promise(r=>setTimeout(r,700));
      const o=document.querySelector('#predCard .pdopt'); if(!o) return {err:'no options'};
      o.click(); await new Promise(r=>setTimeout(r,400));
      return {picks:Object.keys(S.predChoices||{}).filter(k=>!/_num$/.test(k)).length, screen:S.screen};
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
  ok('journey.the-other-game-starts-clean', s.picks===0,
     `${s.picks} pick(s) carried into the other room`);

  /* ---- 6. pick in B ------------------------------------------------- */
  const enteredB=await p.evaluate(async()=>{
    try{
      startDemo(); S.name='QA';
      try{ await loadGameStats(true); }catch(e){}
      startPredict(); await new Promise(r=>setTimeout(r,700));
      const o=document.querySelector('#predCard .pdopt'); if(!o) return {err:'no options'};
      o.click(); await new Promise(r=>setTimeout(r,400));
      return {picks:Object.keys(S.predChoices||{}).filter(k=>!/_num$/.test(k)).length};
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
  const kept=await p.evaluate((id)=>{
    const raw=localStorage.getItem('stats_gamenight_v1_basketball_'+id);
    if(!raw) return {saved:false};
    try{ const v=JSON.parse(raw);
      return {saved:true, nid:v.nid, picks:Object.keys(v.predChoices||{}).filter(k=>!/_num$/.test(k)).length}; }
    catch(e){ return {saved:false, err:'unparseable'}; }
  }, A.id);
  ok('journey.the-room-you-left-kept-your-card', kept.saved===true && (kept.picks||0)>=1,
     `save for ${A.id}: ${JSON.stringify(kept)} — leaving a room must not lose the card`);

  ok('journey.no-page-errors-anywhere', errs.length===0, errs.slice(0,2).join(' | '));

  await b.close();
  if(process.argv.includes('--trace')) trace.forEach(t=>console.log(t));
  bad.forEach(x=>console.log('  FAIL  '+x));
  console.log((fail?'RED':'GREEN')+'   '+pass+' passed, '+fail+' failed   ('+(LIVE?'LIVE ':'')+URL_.replace(/\?.*/,'')+')');
  process.exit(fail?1:0);
})().catch(e=>{ console.error('JOURNEY CRASHED:', e.message); process.exit(2); });
