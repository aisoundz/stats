/* ============ qa/nav-escape.js =======================================
   CAN YOU ALWAYS LEAVE THE SCREEN YOU ARE ON?

   Founder, 21 Aug: "Then after I go to the stats page I cant go back to
   the game time page it gets stuck."

   navGo() renders and navigates. Three of its five branches rendered
   FIRST, so a render that threw meant go() never ran: the catch swallowed
   the error, paintNav lit the tab you tapped, and the screen stayed where
   it was. The nav said one thing, the screen said another, and tapping
   again re-ran the same throwing render.

   Twenty lines below those branches sat a comment asserting the opposite
   — "go() fires BEFORE the render in every branch" — which is why nobody
   caught it by reading.

   So this does not read. It BREAKS a render on purpose and demands the
   player can still get out. A tab whose body cannot draw is a bad screen;
   a tab you cannot leave is a broken app, and only the second one is
   worth a game night.
   ================================================================== */
const {chromium}=require('playwright');
const path=require('path');
const { waitReady } = require('./ready.js');
const FILE='file://'+path.join(__dirname,'..','index-test.html');
let pass=0, fail=0;
const ok =(n)=>{pass++; console.log('  ok   '+n);};
const bad=(n,d)=>{fail++; console.log('  FAIL '+n+(d?'\n         '+d:''));};

(async()=>{
  const b=await chromium.launch();
  const p=await b.newPage({viewport:{width:393,height:852}});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e&&e.message||e)));
  await p.goto(FILE, { waitUntil: 'domcontentloaded' });
  /* waitReady(), not a fixed sleep. qa/stats-page.js slept 1300ms for
     boot and, on a loaded machine, called into an app that was not
     there yet — its catch swallowed the ReferenceError and a whole
     sport section was skipped behind one red line, differently on
     every run. A guess at boot is a guess at coverage. */
  await waitReady(p);

  /* Become a player: practice unlocks the tabs, same as B14 intends. */
  await p.evaluate(()=>{ startDemo(); S.name='QA'; startPredict(); });
  await p.waitForTimeout(600);
  await p.evaluate(()=>{ try{ startQuarter(0); }catch(_){} });
  await p.waitForTimeout(600);

  const at = () => p.evaluate(()=>{
    const a=document.querySelector('.screen.active');
    return { dom:a?a.id:'(none)', screen:(typeof S!=='undefined'?S.screen:'') };
  });

  /* ---- 1. the ordinary round trip ---------------------------------- */
  /* The four tabs that exist. `crew` and `me` are in NAV_RETIRED — the
     nav is Home · Stats · Gametime · Board and those two words spell the
     product, so a check that expects a fifth tab to open is testing a
     screen the design deliberately removed. */
  for(const [tab, want] of [['stats','s-stats'],['gametime','s-gametime'],
                            ['board','s-board'],['gametime','s-gametime'],
                            ['home','s-landing'],['gametime','s-gametime']]){
    await p.evaluate(t=>navGo(t), tab);
    await p.waitForTimeout(350);
    const s=await at();
    if(s.dom===want) ok('navGo('+tab+') lands on '+want);
    else bad('navGo('+tab+') lands on '+want, 'it is showing '+s.dom);
  }

  /* ---- 2. THE ONE THAT MATTERS ------------------------------------- */
  /* Break each body in turn and demand the tab still opens. Each render
     is restored afterwards so one broken tab cannot mask the next. */
  for(const [tab, fn, want] of [['gametime','renderGametime','s-gametime'],
                                ['board','renderBoard','s-board'],
                                ['stats','renderStats','s-stats']]){
    await p.evaluate(t=>navGo(t), 'stats');          // start somewhere else
    await p.waitForTimeout(250);
    if(tab==='stats'){ await p.evaluate(()=>navGo('gametime')); await p.waitForTimeout(250); }
    const broke = await p.evaluate(f=>{
      window.__orig = window[f];
      window[f] = function(){ throw new Error('deliberate: '+f+' cannot draw'); };
      return typeof window.__orig === 'function';
    }, fn);
    if(!broke){ bad(fn+' could be replaced', fn+' is not reachable on window — the probe could not run'); continue; }
    await p.evaluate(t=>{ try{ navGo(t); }catch(_){} }, tab);
    await p.waitForTimeout(400);
    const s=await at();
    if(s.dom===want) ok('you can still reach '+tab+' when '+fn+'() throws');
    else bad('you can still reach '+tab+' when '+fn+'() throws',
             'the render threw and the screen stayed on '+s.dom+' — this is the reported bug');
    await p.evaluate(f=>{ window[f]=window.__orig; }, fn);
    await p.waitForTimeout(150);
  }

  /* ---- 3. and the nav must not claim a tab it did not open ---------- */
  await p.evaluate(()=>{ window.__o2=window.renderBoard; window.renderBoard=function(){ throw new Error('deliberate'); }; });
  await p.evaluate(()=>navGo('board'));
  await p.waitForTimeout(400);
  const agree = await p.evaluate(()=>{
    const a=document.querySelector('.screen.active');
    const lit=document.querySelector('#botnav [data-nav].on') || document.querySelector('#botnav [data-nav][aria-current="true"]');
    return { dom:a?a.id:'', lit: lit?lit.getAttribute('data-nav'):'(none)' };
  });
  if(agree.dom==='s-board') ok('the highlighted tab and the visible screen agree');
  else bad('the highlighted tab and the visible screen agree',
           'nav says '+agree.lit+', screen is '+agree.dom);
  await p.evaluate(()=>{ window.renderBoard=window.__o2; });

  console.log('\n  page errors during the run: '+(errs.length?errs.length:'none')+' (deliberate throws are caught, not thrown to the page)');
  console.log('  '+pass+' passed, '+fail+' failed');
  await b.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.log('  FATAL '+e.message); process.exit(1); });
