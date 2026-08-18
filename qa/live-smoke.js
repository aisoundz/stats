#!/usr/bin/env node
/* =====================================================================
   LIVE SMOKE — the real site, the real database, real outcomes.
   ---------------------------------------------------------------------
   WHY THIS EXISTS, AND IT IS THE MOST IMPORTANT COMMENT IN THE REPO.

   Three times in two days a feature was shipped, gated green, and dead on
   the live site:

     · the game rail          — `slate` had no security rule, every read
                                denied, picker never rendered
     · the Control Room slate — loadSlateRooms() used bare `F` and `db`,
                                which are FB.F and FB.db here. ReferenceError,
                                caught, returned false, silence
     · voice, twice           — the harness stubbed the speech engine, so
                                the suite could not observe the feature at all

   Every one passed every check we had. That is not bad luck, it is the
   shape of the pipeline: `--quick` reads source TEXT, the browser suites
   STUB Firestore because they are testing precedence logic, and the node
   tools use the Admin SDK which bypasses rules entirely. Nothing ran the
   real page against the real backend.

   AND THE FAILURES WERE ALL SILENT BY CONSTRUCTION — a catch block writing
   to console.error is invisible to everything except a human with devtools
   open at the right moment.

   So this suite has exactly one rule: NOTHING IS STUBBED. It loads
   statsgametime.com, lets the real code talk to the real Firestore, and
   asserts what a player would actually see. It is slow, it needs the
   network, and it is the only thing here that can prove a deploy works.

     node qa/live-smoke.js                    # production
     node qa/live-smoke.js --admin            # + the Control Room
     node qa/live-smoke.js --base https://statsgametime.com/index-test.html
   ================================================================== */
const {chromium}=require('playwright');
const ARG=(k,d)=>{const i=process.argv.indexOf('--'+k); return i>=0?process.argv[i+1]:d;};
const BASE=ARG('base','https://statsgametime.com/');
const ADMIN=process.argv.includes('--admin');
const CB=()=> (BASE.includes('?')?'&':'?')+'cb='+Date.now();

let pass=0, fail=0; const bad=[], notes=[];
const ok=(n,c,d)=>{ if(c) pass++; else { fail++; bad.push(n+(d?'  — '+d:'')); } };

(async()=>{
  const b=await chromium.launch();

  /* ---- 1. the player app ------------------------------------------- */
  {
    const p=await b.newPage({viewport:{width:393,height:852}});
    const errs=[], caught=[];
    p.on('pageerror',e=>errs.push(String(e)));
    /* A caught exception is the failure mode that keeps escaping. Collect
       console.error too, and treat the specific words that mean "a feature
       gave up quietly" as failures rather than noise. */
    p.on('console',m=>{ if(m.type()==='error') caught.push(m.text().slice(0,160)); });
    /* KNOW WHICH RESOURCE FAILED. "Failed to load resource: net::ERR_FAILED"
       carries no URL, so a text filter cannot tell ESPN's CORS block — which
       is expected, the runner fetches server-side — from our own backend
       being unreachable, which is not. Playwright knows the URL; ask it. */
    const deadReq=[];
    p.on('requestfailed', r=>{ deadReq.push(r.url()); });

    await p.goto(BASE+CB(),{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(6000);

    const s=await p.evaluate(()=>({
      build:(typeof STATS_BUILD!=='undefined')?STATS_BUILD:null,
      slateLoaded:(window.SLATE||{}).loaded,
      games:((window.SLATE||{}).games||[]).length,
      railShown:(()=>{const e=document.getElementById('gameRail'); return e?getComputedStyle(e).display!=='none':null;})(),
      tiles:[...document.querySelectorAll('#gameRail [data-slate]')].length,
      night:(window.GAME||{}).nightId,
      heroHome:(document.getElementById('mqHomeNick')||{}).textContent,
      arena:!!document.getElementById('arenaLight'),
      notify:!!document.getElementById('notifyEmail'),
      practiceOpen:(typeof tabsUnlocked==='function')
    }));

    ok('live.the-build-is-the-one-we-shipped', !!s.build, 'no STATS_BUILD on the page');
    ok('live.the-app-boots-without-throwing', errs.length===0, errs.slice(0,2).join(' | '));

    /* THE ONE THAT WOULD HAVE CAUGHT THE RAIL. A slate that loaded but is
       empty, or a rail that exists but never renders, is exactly what a
       denied security rule looks like from the outside. */
    if(s.games>=2){
      ok('live.the-rail-renders-when-there-is-a-choice', s.railShown===true,
         `SLATE has ${s.games} games and the rail is ${s.railShown?'shown':'hidden'}`);
      ok('live.every-game-is-a-tile', s.tiles===s.games, `${s.tiles} tiles for ${s.games} games`);
    } else {
      notes.push(`only ${s.games} game(s) on the slate — the rail is correctly hidden`);
    }
    ok('live.a-night-is-loaded', !!s.night, 'GAME.nightId is empty — hydration never landed');
    ok('live.the-hero-names-a-team', !!s.heroHome && s.heroHome.length>1, `hero reads "${s.heroHome}"`);
    ok('live.the-arena-light-is-present', s.arena===true, 'the landing lost its lamps');
    ok('live.you-can-ask-for-a-heads-up', s.notify===true, 'the notify-me field is gone');

    /* SILENCE IS THE ENEMY. These words in a console error mean a feature
       decided to fail quietly, which is the whole reason this file exists. */
    /* Two kinds of failed request are expected and neither means anything
       is broken:
         · ESPN blocks a browser fetch of the summary — the runner fetches
           it server-side, which is why the product works at all.
         · Firestore's realtime transport is a long-poll. Closing the page
           aborts the open channel, and Playwright reports that abort as a
           failed request. It is a teardown, not an outage. */
    const EXPECTED=/site\.api\.espn\.com|firestore\.googleapis\.com\/.*\/(Listen|Write)\/channel/i;
    const badReq = deadReq.filter(u=>!EXPECTED.test(u));
    const quiet = caught
      .filter(t=>/could not read|not defined|permission|insufficient|denied|is not a function/i.test(t))
      .filter(t=>!EXPECTED.test(t) && !/CORS/i.test(t));
    ok('live.nothing-gave-up-quietly', quiet.length===0, quiet.slice(0,2).join(' | '));
    ok('live.every-request-we-own-succeeded', badReq.length===0,
       badReq.slice(0,2).join(' | ') || '');
    if(deadReq.some(u=>EXPECTED.test(u)))
      notes.push('ESPN blocked the browser fetch (expected — the runner fetches server-side)');

    await p.close();
  }

  /* ---- 2. the Control Room ------------------------------------------ */
  if(ADMIN){
    const url=BASE.replace(/\/?$/,'/').replace(/index[^/]*$/,'')+(process.env.SMOKE_ADMIN||'admin-test.html');
    const p=await b.newPage({viewport:{width:1200,height:900}});
    const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
    await p.goto(url+CB(),{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(3500);
    const a=await p.evaluate(async()=>{
      const out={ tabs:[...document.querySelectorAll('nav button')].map(b=>b.textContent.trim()) };
      try{ out.loaded = await loadSlateRooms(); out.rooms = SLATE_ROOMS.map(r=>r.id); }
      catch(e){ out.threw = String(e.message).slice(0,120); }
      return out;
    });
    ok('live.control-room-boots', errs.length===0, errs.slice(0,2).join(' | '));
    ok('live.control-room-has-analytics', a.tabs.some(t=>/analytics/i.test(t)), a.tabs.join(' · '));
    /* THE ONE THAT WOULD HAVE CAUGHT THE PICKER. */
    ok('live.control-room-can-reach-every-room',
       !a.threw && a.loaded===true && (a.rooms||[]).length>=1,
       a.threw ? ('threw: '+a.threw) : `loadSlateRooms returned ${a.loaded}, rooms=${JSON.stringify(a.rooms)}`);
    await p.close();
  }

  await b.close();
  notes.forEach(n=>console.log('  note  '+n));
  bad.forEach(x=>console.log('  FAIL  '+x));
  console.log((fail?'RED':'GREEN')+'   '+pass+' passed, '+fail+' failed   ('+BASE+')');
  process.exit(fail?1:0);
})().catch(e=>{ console.error('SMOKE CRASHED:', e.message); process.exit(2); });
