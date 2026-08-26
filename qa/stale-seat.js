#!/usr/bin/env node
/* =====================================================================
   NOBODY GETS SEATED IN A NIGHT THAT ENDED A WEEK AGO.
   ---------------------------------------------------------------------
   Found 26 Aug 2026 by counting player documents, not by reading code.

       nights/gn13-2026-08-19-min-gs/players   ->  83 seats
       every other room in the product's history ->  2 to 4

   76 of the 83 are named "player" — the default handle, never set — and
   they were still arriving: 29 on 22 Aug, 22 on the 23rd, 12 on the
   24th, 5 on the 25th, 2 on the morning of the 26th, for a WNBA game
   that finished on the 19th.

   gn13 is BB_GAME, the fallback night index.html ships with. When the
   slate read is slow, fails, or the visitor arrives on a cold cache,
   GAME is still that baked object — and joinNight() seated them into it.

   THE PREDICATE ALREADY EXISTED. bakedNightIsStale() was written 21 Aug
   ("a baked default is a clock that only goes backwards") and SIX
   display sites consult it: gnOf() refuses to print "#13", and the hero
   renders "Tonight's games are loading…". Neither nightKey() nor
   joinNight() asked. So the screen told the truth while the write path
   filed the visitor under a dead game — the same one-fact-many-copies
   shape as nightRoundsOutstanding() having a single caller.

   WHAT THIS SUITE ASSERTS, in both directions, because a guard that
   refuses everything is a worse bug than the one it fixes:

     a stale baked night   -> joinNight() refuses, no seat is written
     a fresh baked night   -> joins (someone opening before tip-off)
     a HYDRATED night      -> joins, however old — __baked is cleared by
                              hydrateNight(), and a real night the player
                              chose is theirs whatever its date
     practice              -> untouched

       node qa/stale-seat.js
       node qa/stale-seat.js index-test.html
   ================================================================== */
const fs=require('fs'), path=require('path'), os=require('os');
const ROOT=path.resolve(__dirname,'..');
const TARGET=process.argv[2] && !process.argv[2].startsWith('--')
  ? path.resolve(process.argv[2]) : path.join(ROOT,'index.html');
const ENG=(process.env.QA_ENGINE||'firefox');

let fail=0;
const ok=(id)=>console.log(`  \x1b[32m✓\x1b[0m ${id}`);
const bad=(id,why)=>{fail++;console.log(`  \x1b[31m✗ ${id}\x1b[0m — ${why}`);};
const check=(id,c,why)=>c?ok(id):bad(id,why);

(async()=>{
  const {firefox,chromium}=require('playwright');
  const ENGINE = ENG==='chromium' ? chromium : firefox;
  console.log('\n=== NOBODY IS SEATED IN A DEAD NIGHT ===   '
    + path.basename(TARGET) + ' · ' + ENG);

  const b=await ENGINE.launch();
  const p=await b.newPage();
  const errs=[];
  p.on('pageerror',e=>errs.push(String(e).slice(0,140)));

  /* The app must not reach the network for this. Every route is stubbed so
     the ONLY thing that can decide the outcome is the guard under test —
     an unstubbed slate read would hydrate a real night and the fixture
     would be measuring nothing. */
  await p.route('**/site.api.espn.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
  await p.route('**/assets.mailerlite.com/**', r=>r.fulfill({status:200,body:'{}'}));
  await p.route('**/*.googleapis.com/**', r=>r.abort());
  await p.route('**/*.firebaseio.com/**', r=>r.abort());

  const tmp=path.join(os.tmpdir(),'qa-stale-seat-'+process.pid+'.html');
  fs.copyFileSync(TARGET,tmp);
  await p.goto('file://'+tmp,{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>typeof window.joinNight==='function'
    || typeof window.bakedNightIsStale==='function', null, {timeout:20000}).catch(()=>{});

  /* --------------------------------------------------------------
     0. THE PREDICATE ITSELF, so a green run below cannot be green
        because bakedNightIsStale() has quietly stopped working.
     -------------------------------------------------------------- */
  const pred = await p.evaluate(()=>{
    const out={};
    const day=24*3600*1000;
    try{ out.exists = typeof bakedNightIsStale==='function'; }catch(_){ out.exists=false; }
    if(!out.exists) return out;
    try{ out.staleOld   = bakedNightIsStale({__baked:true, tipISO:new Date(Date.now()-7*day).toISOString()}); }catch(e){ out.staleOld='ERR'; }
    try{ out.staleFresh = bakedNightIsStale({__baked:true, tipISO:new Date(Date.now()+2*3600*1000).toISOString()}); }catch(e){ out.staleFresh='ERR'; }
    try{ out.staleHydr  = bakedNightIsStale({__baked:false, tipISO:new Date(Date.now()-7*day).toISOString()}); }catch(e){ out.staleHydr='ERR'; }
    /* THE PREDICATE THE GUARD ACTUALLY READS. Two builds shipped asking
       bakedNightIsStale() and both were inert, because the room that
       collects the seats is PUBLISHED, not baked. */
    try{ out.hasExpiredFn = (typeof nightHasExpired==='function'); }catch(_){ out.hasExpiredFn=false; }
    if(out.hasExpiredFn){
      try{ out.expOldPub   = nightHasExpired({tipISO:new Date(Date.now()-7*day).toISOString()}); }catch(e){ out.expOldPub='ERR'; }
      try{ out.expTonight  = nightHasExpired({tipISO:new Date(Date.now()+3*3600*1000).toISOString()}); }catch(e){ out.expTonight='ERR'; }
      try{ out.expJustDone = nightHasExpired({tipISO:new Date(Date.now()-2*3600*1000).toISOString()}); }catch(e){ out.expJustDone='ERR'; }
      try{ out.expNoDate   = nightHasExpired({}); }catch(e){ out.expNoDate='ERR'; }
    }
    return out;
  });
  console.log('    bakedNightIsStale: week-old-baked=' + pred.staleOld
            + '  pre-tip-baked=' + pred.staleFresh
            + '  week-old-hydrated=' + pred.staleHydr);
  check('predicate.exists', pred.exists===true,
    'bakedNightIsStale() is not on window — every check below is vacuous');
  check('predicate.a-week-old-baked-night-is-stale', pred.staleOld===true,
    'bakedNightIsStale() says a 7-day-old baked night is fine');
  check('predicate.a-night-that-has-not-tipped-is-not-stale', pred.staleFresh===false,
    'bakedNightIsStale() calls tonight stale — nobody could ever join');
  check('predicate.a-hydrated-night-is-never-stale', pred.staleHydr===false,
    'a real night the player chose was called stale because of its date');

  console.log('    nightHasExpired: week-old-published=' + pred.expOldPub
            + '  tips-in-3h=' + pred.expTonight
            + '  ended-2h-ago=' + pred.expJustDone
            + '  no-date=' + pred.expNoDate);
  check('expiry.the-guard-has-its-own-predicate', pred.hasExpiredFn===true,
    'nightHasExpired() is not on window — the join guard is reading bakedNightIsStale(), '
    + 'which is a question about the FALLBACK and is why two builds shipped inert');
  check('expiry.a-week-old-PUBLISHED-night-has-expired', pred.expOldPub===true,
    'a published night from a week ago is not reported as expired — this is the gn13 case');
  check('expiry.tonights-game-has-not-expired', pred.expTonight===false,
    'a game that tips in three hours was called expired — nobody could join tonight');
  check('expiry.a-game-that-just-ended-has-not-expired', pred.expJustDone===false,
    'a game that ended two hours ago was called expired — a player finishing their board is locked out');
  check('expiry.an-unreadable-date-does-NOT-lock-anyone-out', pred.expNoDate===false,
    'a night with no readable tip was treated as over — this guard must fail OPEN, '
    + 'unlike bakedNightIsStale(), because a wrong true here costs somebody a live game');

  /* --------------------------------------------------------------
     1. THE SEAT. joinNight() is driven with the backend stubbed so
        the ONLY refusal that can happen is the guard's. Without the
        stub SB.enabled is false and every case "passes" for the
        wrong reason — which is exactly the false green this repo
        has shipped before.
     -------------------------------------------------------------- */
  async function attempt(c){
    return p.evaluate(async (c)=>{
      const day=24*3600*1000;
      S.mode = c.mode || 'live';
      GAME = Object.assign({}, GAME, {
        nightId: c.nightId,
        tipISO: new Date(Date.now() - (c.agoDays||0)*day).toISOString()
      });
      if(c.baked) GAME.__baked = true; else delete GAME.__baked;

      /* A backend that says yes to everything. If a seat is refused from
         here it was refused by the code under test, not by plumbing. */
      let wrote=null;
      window.SB = window.SB || {};
      SB.enabled = true;
      SB.state   = 'on';
      SB.uid     = 'testuid1';
      SB.seatedFlag = false;
      SB.seated  = function(){ return SB.seatedFlag; };
      SB.join    = async function(o){ wrote = o; SB.seatedFlag = true; return true; };
      SB.myScore = async function(){ return null; };
      try{ window.hookRoomState = window.hookRoomState || function(){}; }catch(_){}

      let ret=null, err=null;
      try{ ret = await joinNight(); }catch(e){ err=String(e).slice(0,120); }
      return { ret: ret, seatWritten: !!wrote,
               seatNight: wrote ? wrote.nightId : null, err: err };
    }, c);
  }

  const CASES=[
    { key:'stale-baked',
      name:'the baked night is a week old — the gn13 case, exactly',
      nightId:'gn13-2026-08-19-min-gs', baked:true, agoDays:7,
      seat:false },
    { key:'fresh-baked',
      name:'the baked night has not tipped yet — somebody arriving early',
      nightId:'gn13-2026-08-19-min-gs', baked:true, agoDays:0,
      seat:true },
    /* ============ THIS CASE WAS DECIDED WRONG, AND gn13 PROVED IT ====
       It used to assert seat:true — "a REAL night, a week old, the
       player chose it, it is theirs". That reasoning assumed a hydrated
       night means a night somebody picked.

       gn13-2026-08-19-min-gs disproves it. It HAS a real published
       schedule doc, so the app hydrates it and clears __baked, and it is
       the night the app is holding at boot before anybody chooses
       anything. 76 seats named "player" arrived that way over the week
       after the game ended. A hydrated old night is exactly the case
       that has to be refused, not the exception to it. */
    { key:'hydrated-old',
      name:'a REAL published night, a week old — the gn13 case as it actually is',
      nightId:'gn13-2026-08-19-min-gs', baked:false, agoDays:7,
      seat:false },
    { key:'hydrated-tonight',
      name:'a real night, tonight — the ordinary case',
      nightId:'slate-2026-08-26-tor-sea', baked:false, agoDays:0,
      seat:true },
  ];

  for(const c of CASES){
    const r=await attempt(c);
    console.log('\n  ' + c.name);
    console.log('    joinNight()=' + r.ret + '   seat written=' + r.seatWritten
              + (r.seatNight ? ('  -> ' + r.seatNight) : '')
              + (r.err ? ('   THREW ' + r.err) : ''));
    check(c.key+'.'+(c.seat?'seats-the-player':'writes-no-seat'),
      r.seatWritten===c.seat,
      c.seat ? 'joinNight() refused a night it should have joined — the player cannot play at all'
             : 'a seat was written into ' + r.seatNight + ' — this is the 76-seat bug');
    if(!c.seat){
      check(c.key+'.reports-that-it-did-not-join',
        r.ret===false,
        'joinNight() returned ' + r.ret + ' without seating anybody — the retry loop will never try again');
    }
  }

  /* --------------------------------------------------------------
     1b. WHY THIS FILE NO LONGER ASKS ABOUT __baked AT ALL.

     Two builds shipped today trying to keep people out of gn13 by
     asking bakedNightIsStale(), and both were INERT. The reason is that
     `schedule/gn13-2026-08-19-min-gs` is a REAL published config in
     Firestore: the app hydrates it like any other night, clears __baked
     correctly, and holds it as the current night until somebody picks a
     room. It is not the fallback wearing a disguise. It is a published
     night that is a week old.

     A third attempt preserved __baked through hydrateBuiltIn(), which
     made this suite green and broke qa/stale-default.js's "hydrating a
     real night clears the flag" — a check that has been right since
     21 Aug. That change was reverted rather than argued with: once the
     guard asks nightHasExpired() the flag is not load-bearing for seats
     at all, and changing display behaviour hours before a live demo buys
     nothing.

     The expiry checks at the top of this file are what guard the seat.
     -------------------------------------------------------------- */

  /* --------------------------------------------------------------
     2. PRACTICE IS UNTOUCHED — AND THE CONTRACT LIVES IN
        ensureJoined(), NOT HERE.

        The first version of this block called joinNight() directly in
        demo mode and asserted no seat. That failed on the shipped
        build, and it was the TEST that was wrong: joinNight() has never
        looked at S.mode and does not claim to. The mode gate is
        ensureJoined()'s — `if(joinedNow() || S.mode !== 'live') return`
        — and it is the only thing that ever calls joinNight() on a
        rehearsal path. Asserting a contract against the function that
        does not own it is how a suite generates work instead of
        catching bugs, which this project has paid for once already.

        So drive the real entry point.
     -------------------------------------------------------------- */
  {
    const r=await p.evaluate(async ()=>{
      const day=24*3600*1000;
      S.mode='demo';
      GAME=Object.assign({},GAME,{nightId:'gn13-2026-08-19-min-gs',
        __baked:true, tipISO:new Date(Date.now()-7*day).toISOString()});
      let wrote=null;
      window.SB=window.SB||{};
      SB.enabled=true; SB.state='on'; SB.uid='testuid1'; SB.seatedFlag=false;
      SB.seated=function(){ return SB.seatedFlag; };
      SB.join=async function(o){ wrote=o; SB.seatedFlag=true; return true; };
      try{ ensureJoined(); }catch(e){ return {err:String(e).slice(0,120)}; }
      await new Promise(r=>setTimeout(r,300));
      return { seatWritten: !!wrote, seatNight: wrote?wrote.nightId:null };
    });
    console.log('\n  practice, with a stale baked night, through ensureJoined()');
    console.log('    seat written=' + r.seatWritten + (r.err?('   THREW '+r.err):''));
    check('practice.ensureJoined-does-not-seat-a-rehearsal',
      r.seatWritten===false,
      'practice wrote a seat into ' + r.seatNight);
  }

  await b.close();
  check('no-page-errors', errs.length===0, errs.slice(0,3).join(' · '));
  try{ fs.unlinkSync(tmp); }catch(_){}

  console.log(fail
    ? `\n\x1b[31mRED\x1b[0m   ${fail} failed   [${path.basename(TARGET)} · ${ENG}]`
    : `\n\x1b[32mGREEN\x1b[0m  all checks pass   [${path.basename(TARGET)} · ${ENG}]`);
  process.exit(fail?1:0);
})().catch(e=>{ console.error('SUITE CRASHED', e); process.exit(1); });
