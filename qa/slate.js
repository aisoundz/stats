#!/usr/bin/env node
/* =====================================================================
   THE SLATE — every game gets a room, and the player picks one.
   ---------------------------------------------------------------------
   WHAT IS STUBBED HERE AND WHY IT IS ALLOWED. qa/voice.js taught this
   codebase an expensive lesson: stubbing the thing under test proves
   nothing. So read this carefully — the thing under test here is the
   PRECEDENCE LOGIC (does a player's choice outrank the promoted game, is
   a stale pick forgotten) and the PAINTER. Firestore is the transport
   underneath it, and a transport may be faked. Nothing below stubs
   loadSlate, chooseGame, paintSlate or hydrateNight; every one of those is
   the real function out of the real file.

     node qa/slate.js [index-test.html]
   ================================================================== */
const {chromium}=require('playwright'); const path=require('path');
const TARGET=path.resolve(process.argv[2]||path.join(__dirname,'..','index-test.html'));

let pass=0, fail=0; const bad=[];
const ok=(n,c,d)=>{ if(c) pass++; else { fail++; bad.push(n+(d?'  — '+d:'')); } };

/* A slate exactly as build-slate.js writes it. */
const SLATE_DOC = {
  date:'2026-08-19', league:'wnba', sport:'basketball',
  games:[
    { nightId:'slate-2026-08-19-tor-wsh', espnEvent:'401857156', tipISO:'2026-08-19T23:30Z',
      away:'Tempo', home:'Mystics', awayAbbr:'TOR', homeAbbr:'WSH',
      awayColor:'#33476D', homeColor:'#e03a3e', venue:'CareFirst Arena', net:'TSN · MNMT', flagship:false },
    { nightId:'gn13-2026-08-19-min-gs', espnEvent:'401857157', tipISO:'2026-08-20T02:00Z',
      away:'Lynx', home:'Valkyries', awayAbbr:'MIN', homeAbbr:'GS',
      awayColor:'#266092', homeColor:'#b38fcf', venue:'Chase Center', net:'USA Net', flagship:true }
  ],
  flagship:['gn13-2026-08-19-min-gs']
};
const nightCfg = (id, away, home) => ({
  game:{ nightId:id, espnEvent:'999', awayName:away, homeName:home,
         awayAbbr:'AAA', homeAbbr:'HHH' },
  roster:{ home:['H One','H Two'], away:['A One','A Two'] },
  preds:[{ id:'winner', q:'Who takes it?', label:'Winner', base:100, opts:[away,home], answer:home }]
});

/* The fake transport: doc() records a path, getDoc() answers from a map. */
const FAKE = `(function(store){
  window.__reads=[];
  window.__F = {
    doc:function(_db){ return {path:[].slice.call(arguments,1).join('/')}; },
    getDoc:async function(ref){
      window.__reads.push(ref.path);
      var d = store[ref.path];
      return { exists:function(){ return !!d; }, data:function(){ return d; } };
    }
  };
})`;

(async()=>{
  const b=await chromium.launch();

  async function boot(store){
    const p=await b.newPage();
    const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
    await p.goto('file://'+TARGET);
    await p.waitForFunction(()=>typeof window.loadSlate==='function', {timeout:15000});
    await p.evaluate(`(${FAKE})(${JSON.stringify(store)})`);
    return {p, errs};
  }

  const STORE = {
    'slate/current': { date:'2026-08-19', league:'wnba' },
    'slate/2026-08-19': SLATE_DOC,
    'schedule/current': { nightId:'gn13-2026-08-19-min-gs' },
    'schedule/gn13-2026-08-19-min-gs': nightCfg('gn13-2026-08-19-min-gs','Lynx','Valkyries'),
    'schedule/slate-2026-08-19-tor-wsh': nightCfg('slate-2026-08-19-tor-wsh','Tempo','Mystics')
  };

  /* ---- 1. the slate loads and the picker appears -------------------- */
  {
    const {p,errs}=await boot(STORE);
    const r=await p.evaluate(async()=>{
      localStorage.removeItem('stats_slate_pick_v1');
      const loaded=await window.loadSlate({}, window.__F);
      window.paintSlate();
      const el=document.getElementById('slateCard');
      return { loaded, games:window.SLATE.games.length, date:window.SLATE.date,
               shown:el.style.display!=='none',
               rows:[...el.querySelectorAll('[data-slate]')].map(x=>x.getAttribute('data-slate')),
               stars:el.querySelectorAll('.slateStar').length,
               text:el.textContent.replace(/\s+/g,' ').trim() };
    });
    ok('slate.loads-tonights-games', r.loaded && r.games===2 && r.date==='2026-08-19',
       `loaded=${r.loaded} games=${r.games} date=${r.date}`);
    ok('slate.picker-is-shown-when-there-is-a-choice', r.shown, 'the picker stayed hidden');
    ok('slate.offers-every-game', r.rows.length===2 &&
       r.rows.includes('slate-2026-08-19-tor-wsh') && r.rows.includes('gn13-2026-08-19-min-gs'),
       JSON.stringify(r.rows));
    /* THE ONE THAT MATTERS MOST FOR THE EMAIL. */
    ok('slate.the-flagship-is-in-the-picker', r.rows.includes('gn13-2026-08-19-min-gs') && r.stars===1,
       `stars=${r.stars} rows=${JSON.stringify(r.rows)}`);
    ok('slate.names-the-teams-a-person-would-recognise',
       /Tempo at Mystics/.test(r.text) && /Lynx at Valkyries/.test(r.text), r.text.slice(0,120));
    ok('slate.no-page-errors', errs.length===0, errs.join(' / '));
    await p.close();
  }

  /* ---- 2. one game is not a choice ---------------------------------- */
  {
    const one=JSON.parse(JSON.stringify(SLATE_DOC)); one.games=[SLATE_DOC.games[0]];
    const {p}=await boot(Object.assign({}, STORE, {'slate/2026-08-19':one}));
    const r=await p.evaluate(async()=>{
      localStorage.removeItem('stats_slate_pick_v1');
      await window.loadSlate({}, window.__F); window.paintSlate();
      const el=document.getElementById('slateCard');
      return { shown:el.style.display!=='none', html:el.innerHTML.length };
    });
    ok('slate.one-game-shows-no-picker', !r.shown && r.html===0,
       `shown=${r.shown} html=${r.html} — a question with one answer is not a question`);
    await p.close();
  }

  /* ---- 3. precedence: a choice outranks the promoted game ----------- */
  {
    const {p}=await boot(STORE);
    const r=await p.evaluate(async()=>{
      localStorage.removeItem('stats_slate_pick_v1');
      await window.loadSlate({}, window.__F);
      window.__reads=[];
      const a=await window.loadNightConfig({}, window.__F);   // no pick → pointer
      const pointed=window.GAME.nightId, readA=window.__reads.slice();
      await window.chooseGame({}, window.__F, 'slate-2026-08-19-tor-wsh');
      const chosen=window.GAME.nightId, home=window.GAME.homeName;
      return { a, pointed, readA, chosen, home,
               remembered:localStorage.getItem('stats_slate_pick_v1') };
    });
    ok('slate.with-no-choice-the-pointer-wins', r.a===true && r.pointed==='gn13-2026-08-19-min-gs',
       `landed on ${r.pointed}`);
    ok('slate.reads-the-pointer-when-nothing-is-chosen', r.readA.includes('schedule/current'),
       JSON.stringify(r.readA));
    ok('slate.a-choice-switches-the-room', r.chosen==='slate-2026-08-19-tor-wsh' && r.home==='Mystics',
       `after choosing, GAME is ${r.chosen} / ${r.home}`);
    ok('slate.a-choice-is-remembered', r.remembered==='slate-2026-08-19-tor-wsh', r.remembered);
    await p.close();
  }

  /* ---- 4. the choice survives a reload, and outranks the pointer ---- */
  {
    const {p}=await boot(STORE);
    const r=await p.evaluate(async()=>{
      localStorage.setItem('stats_slate_pick_v1','slate-2026-08-19-tor-wsh');
      await window.loadSlate({}, window.__F);
      window.__reads=[];
      await window.loadNightConfig({}, window.__F);
      return { night:window.GAME.nightId, reads:window.__reads.slice() };
    });
    ok('slate.a-remembered-choice-survives-a-reload', r.night==='slate-2026-08-19-tor-wsh',
       `booted into ${r.night}`);
    ok('slate.a-choice-does-not-even-read-the-pointer', !r.reads.includes('schedule/current'),
       `still read ${JSON.stringify(r.reads)} — the promoted game must not override what they are watching`);
    await p.close();
  }

  /* ---- 5. LAST NIGHT'S CHOICE MUST NOT SURVIVE ---------------------- */
  {
    const {p}=await boot(STORE);
    const r=await p.evaluate(async()=>{
      localStorage.setItem('stats_slate_pick_v1','slate-2026-08-18-chi-sea');  // yesterday
      await window.loadSlate({}, window.__F);
      const forgotten=localStorage.getItem('stats_slate_pick_v1');
      window.__reads=[];
      await window.loadNightConfig({}, window.__F);
      return { forgotten, night:window.GAME.nightId };
    });
    ok('slate.a-stale-choice-is-forgotten', r.forgotten===null, `still remembered ${r.forgotten}`);
    ok('slate.a-stale-choice-falls-back-to-the-pointer', r.night==='gn13-2026-08-19-min-gs',
       `booted into ${r.night} — last night's room`);
    await p.close();
  }

  /* ---- 6. a game not on the slate is refused ------------------------ */
  {
    const {p}=await boot(STORE);
    const r=await p.evaluate(async()=>{
      localStorage.removeItem('stats_slate_pick_v1');
      await window.loadSlate({}, window.__F);
      await window.loadNightConfig({}, window.__F);
      const before=window.GAME.nightId;
      const got=await window.chooseGame({}, window.__F, 'slate-2026-08-19-not-a-game');
      return { got, before, after:window.GAME.nightId,
               remembered:localStorage.getItem('stats_slate_pick_v1') };
    });
    ok('slate.refuses-a-game-that-is-not-on-tonights-slate',
       r.got===false && r.after===r.before && r.remembered===null,
       `returned ${r.got}, moved ${r.before}→${r.after}, remembered ${r.remembered}`);
    await p.close();
  }

  /* ---- 7. no slate at all = the product as it has always been ------- */
  {
    const {p,errs}=await boot({ 'schedule/current':{nightId:'gn13-2026-08-19-min-gs'},
                                'schedule/gn13-2026-08-19-min-gs':nightCfg('gn13-2026-08-19-min-gs','Lynx','Valkyries') });
    const r=await p.evaluate(async()=>{
      localStorage.removeItem('stats_slate_pick_v1');
      const loaded=await window.loadSlate({}, window.__F);
      window.paintSlate();
      const okc=await window.loadNightConfig({}, window.__F);
      return { loaded, okc, night:window.GAME.nightId,
               shown:document.getElementById('slateCard').style.display!=='none' };
    });
    ok('slate.no-slate-is-not-an-error', r.loaded===false && r.okc===true &&
       r.night==='gn13-2026-08-19-min-gs' && !r.shown,
       `loaded=${r.loaded} night=${r.night} picker shown=${r.shown}`);
    ok('slate.no-slate-no-page-errors', errs.length===0, errs.join(' / '));
    await p.close();
  }

  await b.close();
  bad.forEach(x=>console.log('  FAIL  '+x));
  console.log((fail?'RED':'GREEN')+'   '+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(2); });
