#!/usr/bin/env node
/* =====================================================================
   THE LAST ROUND OF THE NIGHT MUST BE REACHABLE.
   ---------------------------------------------------------------------
   THREE NIGHTS, THREE SPORTS, THE SAME THIRTY SECONDS:

     23 Aug  WNBA  IND@CHI   Final -> Q4 opened        34s later
     25 Aug  WNBA  POR@DAL   Final -> Q4 opened        32s later
     25 Aug  MLB   LAD@ATL   Final -> "7th-9th" opened 34s later

   That is one runner poll cycle, so the last round essentially ALWAYS
   opens after the feed has flipped to final. It is not an edge case, it
   is the shape of every game — and the round it removes is the most
   valuable one on the card: Q4 is 40 of a basketball night's round
   points, and tonight's baseball plan is 30 / 50 / 70, so the
   unreachable round is 70 of 150, forty-seven per cent.

   THE 25 AUG RUNNER LOG, which is the fixture this file is built on:

       01:49:18  score  78 - 96  Final
       01:49:19  hold   the game is over but not every quarter is
                        scored — staying up
       01:49:50  push   Q4 is live on every phone
       01:56:07  key    Q4 scored

   THE HOST SIDE IS CORRECT AND IS NOT UNDER TEST HERE. It saw Final,
   refused to quit, opened Q4 and scored it six minutes later. The round
   genuinely existed and was answerable.

   WHAT THE PLAYER APP DID. On the founder's phone at the same moment the
   HOME tab showed a red "🔴 Q4 is open — tap to answer" banner — correct,
   because it reads the round document — and tapping through to GAMETIME
   showed the ending: "This game finished 96 to 78, Dallas Wings. You
   finished on 149 points in this room", with a "See your result card"
   button and no Q4 anywhere. Two surfaces, two sources, one of them
   guarded.

   THE CAUSE, MEASURED RATHER THAN ASSUMED. nightIsOver() was
   `phaseNow()==='final'` and nothing else. nightRoundsOutstanding() —
   written on 23 Aug after the FIRST occurrence, and correct: this suite
   measures it returning true on the 25 Aug fixture against the shipped
   build — had exactly one caller, finishNightFromFeed(), which is the
   SETTLE decision. Every RENDER decision answered the question itself:

     gtGameOver()    painted the ending over the Gametime tab, so the
                     "🔴 Quarter 4 is LIVE — answer now" button that
                     gtStartRow() was correctly producing never reached
                     the DOM. Verified on the shipped build below: with
                     Q4 live, gtStartRow() returns the red button AND the
                     rendered tab shows the finished sentence instead.
     lockPicks()     returned false, so a player who did reach Q4 would
                     have had their answers silently dropped. "Q4 took
                     none from anybody."

   THE FIX IS ONE OWNER, not a second guard: nightIsOver() consults
   nightRoundsOutstanding() and hostedRoundIsLive(), so all three callers
   inherit it and cannot disagree, and finishNightFromFeed()'s own call
   becomes belt and braces.

   NOT A GRACE PERIOD. 34s once, 32s twice more; a delay is a guess that
   will be wrong on the next game.

   WHAT THIS SUITE ASSERTS, and why it is not a copy test:

     · the DECIDER agrees with the rounds, not with the feed
     · the RENDERED Gametime tab does not carry the ending while a round
       is outstanding, and does carry the answer button when one is live
     · lockPicks() ACCEPTS the last round in that window
     · a genuinely finished night still reaches its ending — this is the
       direction that would be a worse bug, so it is checked in four
       different shapes
     · the 45-minute abandonment valve still releases a player whose
       runner died, so a night can never fail to end
     · and the two totals on those two surfaces agree

   FIXTURE DISCIPLINE. qa/not-final-yet.js's own history is the warning:
   its first version left the newest round state:'live' whenever it was
   unscored, so hostedRoundIsLive() caught every case and the new guard
   was never once exercised while the suite stayed green. The headline
   case here is therefore the real night — the PREVIOUS round SCORED, the
   last round NOT YET EXISTING — where hostedRoundIsLive() is measured
   FALSE and only nightRoundsOutstanding() can save the player. That is
   asserted explicitly, so this file cannot go green off the wrong guard.

   IT MUST GO RED ON index.html, which reproduces all of it:

       node qa/fourth-quarter.js index.html         # expect RED
       node qa/fourth-quarter.js index-test.html    # expect GREEN
       node qa/fourth-quarter.js --sabotage         # expect RED

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

/* Undo the fix, precisely: nightIsOver() goes back to the feed alone. If
   this file still passes with the guard removed it is not testing it. */
function sabotage(html){
  let h=html;
  const from = /    try\{ if\(typeof hostedRoundIsLive === 'function' && hostedRoundIsLive\(\)\) return false; \}catch\(_\)\{\}\n    try\{ if\(typeof nightRoundsOutstanding === 'function' && nightRoundsOutstanding\(\)\) return false; \}catch\(_\)\{\}\n    return true;/;
  if(!from.test(h)) throw new Error('sabotage could not find the nightIsOver guard — the shape of the fix changed and this file must be updated with it');
  h=h.replace(from, '    return true;   /* SABOTAGED: the feed alone decides again */');
  return h;
}

async function boot(){
  const b=await ENG.launch();
  const ctx=await b.newContext({viewport:{width:393,height:852}, deviceScaleFactor:1});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,160)));

  let html=fs.readFileSync(TARGET,'utf8');
  if(SABOTAGE) html=sabotage(html);
  const tmp=path.join(os.tmpdir(),'fourth-quarter-under-test-'+process.pid+'.html');
  fs.writeFileSync(tmp,html);

  /* The feed is served POST for every request, and loadGameStats is then
     removed outright. GS.ok flips true->false inside loadGameStats before
     its first await, so anything measured across that boundary is a coin
     toss — the whole point of this suite is a decision taken off GS. */
  await p.route('**/site.api.espn.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(F.POST)}));
  await p.route('**/assets.mailerlite.com/**', r=>r.fulfill({status:200,body:'{}'}));
  await p.goto('file://'+tmp,{waitUntil:'domcontentloaded'});
  await waitReady(p);
  await p.evaluate(()=>{ try{ window.loadGameStats=async function(){return null;}; }catch(_){} });
  return {b,p,errs};
}

/* ---------------------------------------------------------------------
   THE NIGHT, AS THE PLAYER'S PHONE HELD IT AT 01:49:18.

   `doc` is the newest round document — the ONLY one the listener holds,
   because the watch is orderBy(seq,desc).limit(1). `scored` is the set of
   round ids whose key has come back. Between them that is everything the
   client knows about rounds, and it is what the guard has to work from.
   ------------------------------------------------------------------ */
async function night(p, c){
  return p.evaluate((c)=>{
    GS.ok=true; GS.ev=String(GAME.espnEvent); GS.state=(c.feed||'post'); GS.detail=c.detail||'Final';
    GS.teams=[{ab:'POR',name:'Portland',score:78},{ab:'DAL',name:'Dallas Wings',score:96}];
    PHASE={v:(c.feed==='in'?'live':'final'), at:Date.now(), src:'feed'};
    S.mode='live'; S.name='Founder'; S.screen='gametime'; S.qi=3; S.nextQ=3;
    S.predChoices={}; FINALISED=false;
    HR.doc=null; HR.started={}; HR.submitted={}; HR.scored={}; HR.held={}; HR.heldQs={};
    if(c.doc) HR.doc={id:c.doc.id, idx:c.doc.idx, state:c.doc.state,
                      seq: Date.now() - (c.doc.agoMin||1)*60*1000, questions:[]};
    (c.scored||[]).forEach(function(id){ HR.scored[id]=true; });

    /* ============ THE PHONE THAT WAS LOCKED THROUGH THE BREAK ========
       roomListenersStop('pagehide') nulls HR.doc, and on iOS `pagehide`
       is what fires when the screen locks or the player switches apps —
       which is precisely what somebody watching the game on television
       does during a quarter break. On return, pageshow re-arms the
       listener, but HR.doc stays null until the first snapshot lands.

       So "HR.doc is null" has TWO meanings and the guard could not tell
       them apart: a night with no host at all, and a night whose host we
       simply have not heard from for two seconds. `everHad`/`lostAt` are
       what separate them. Setting them here rather than driving a real
       pagehide keeps the fixture about the GUARD; roomListenersStop's own
       bookkeeping is asserted separately at the bottom of this file. */
    try{ HR.everHad = !!c.hadDoc; }catch(_){}
    try{ HR.lostAt  = (c.lostMin==null) ? 0 : (Date.now() - c.lostMin*60*1000); }catch(_){}

    /* The board's own row for this player, so shownTotal() has a server
       figure to prefer and the two-surfaces check has something to
       disagree about. 149 on the server, 154 in the local preview — the
       exact pair measured on 25 Aug. */
    try{ lastStand=[{me:true, name:S.name, total:149, pts:149}]; }catch(_){}
    try{ ledgerClear(); ledgerSet('r0',154,0,'live'); recomputeScore(); }catch(_){}

    var o={};
    try{ o.over            = nightIsOver(); }catch(e){ o.over='ERR'; }
    try{ o.roundsOut       = nightRoundsOutstanding(); }catch(e){ o.roundsOut='ERR'; }
    try{ o.roundLive       = hostedRoundIsLive(); }catch(e){ o.roundLive='ERR'; }
    try{ o.phase           = phaseNow(); }catch(e){ o.phase='ERR'; }
    try{ o.startRow        = (gtStartRow()||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim(); }catch(e){ o.startRow='ERR'; }

    /* lockPicks() with the backend stubbed, so the ONLY thing that can
       refuse is the guard under test. Without this the SB gate refuses
       every time and the check reads green on a broken build. */
    try{ window.SB=window.SB||{}; SB.enabled=true; SB.submit=async function(){return true;}; }catch(_){}
    try{ LOCKED['r'+(NR-1)]=false; S.liveAnswers[NR-1]=[{choice:'A'}]; }catch(_){}
    try{ o.lockLast = lockPicks(NR-1); }catch(e){ o.lockLast='ERR'; }
    try{ LOCKED['r'+(NR-1)]=false; }catch(_){}

    /* THE RENDERED TAB, not the return value of a helper. The bug the
       founder saw was a composition: gtStartRow() was producing the right
       button and gtGameOver() was painted over the top of it. */
    try{ renderGametime(); }catch(e){ o.renderErr=String(e).slice(0,100); }
    var t=''; try{ t=((document.getElementById('s-gametime')||{}).textContent||'').replace(/\s+/g,' '); }catch(_){}
    o.tabEnding   = /finished \d+ to \d+/.test(t) || /See your result card/.test(t);
    o.tabAnswer   = /answer now/i.test(t) || /is LIVE/.test(t);
    o.tabTotal    = (function(){ var m=t.match(/You finished on (\d+) point/); return m?Number(m[1]):null; })();

    /* And the strip above it, painted the way the app paints it. */
    try{ paintRail(true); }catch(_){}
    var rail=''; try{ rail=(document.getElementById('railMe')||{}).textContent||''; }catch(_){}
    o.railTotal = (function(){ var m=rail.match(/(\d+)\s*pts/); return m?Number(m[1]):null; })();
    return o;
  }, c);
}

/* ---------------------------------------------------------------------
   THE CASES. `over` is what nightIsOver() must say.
   ------------------------------------------------------------------ */
const CASES=[
  { key:'race-before-push',
    name:'25 Aug: previous round SCORED, last round NOT YET PUSHED, feed Final',
    doc:{id:'r2',idx:2,state:'scored',agoMin:6}, scored:['r2'],
    over:false, ending:false,
    /* THE POINT OF THIS CASE. hostedRoundIsLive() cannot see this — no
       round IS live, the previous one was scored minutes ago and the last
       one does not exist yet. Only nightRoundsOutstanding() can, and this
       is the shape all three real nights had. */
    roundLive:false, roundsOut:true },

  { key:'race-round-open',
    name:'the last round is LIVE and unscored, feed Final',
    doc:{id:'r3',idx:3,state:'live',agoMin:1}, scored:['r2'],
    over:false, ending:false, answer:true,
    roundLive:true, roundsOut:true },

  { key:'truly-over',
    name:'the last round is SCORED, feed Final — a night that really ended',
    doc:{id:'r3',idx:3,state:'scored',agoMin:2}, scored:['r2','r3'],
    over:true, ending:true,
    roundLive:false, roundsOut:false },

  { key:'runner-died',
    name:'the runner vanished 60 minutes ago with rounds still to come',
    doc:{id:'r2',idx:2,state:'scored',agoMin:60}, scored:['r2'],
    over:true, ending:true,
    roundLive:false, roundsOut:false },

  { key:'runner-died-mid-round',
    name:'the runner vanished 90 minutes ago with a round still OPEN',
    doc:{id:'r3',idx:3,state:'live',agoMin:90}, scored:['r2'],
    over:true, ending:true,
    roundLive:false, roundsOut:false },

  { key:'no-host',
    name:'no host at all, feed Final — a hostless night still ends',
    doc:null, scored:[], hadDoc:false,
    over:true, ending:true,
    roundLive:false, roundsOut:false },

  /* ============ THE SMARTPHONE CASES ================================
     Founder, 26 Aug: "the last 2 days of basketball the 4th quarter has
     not fired. We've had problems on the smart phone."

     Both of those nights predate the 25 Aug guard, so the buzzer race
     explains them. These two cases are about the hole the guard still
     has, which is phone-shaped and survives it:

       Q3 ends · the player locks the phone and watches the break on TV
       pagehide -> roomListenersStop -> HR.doc = null
       the game ends while the phone is asleep · the feed flips to final
       the player picks the phone back up
       pageshow re-arms the listener — but no snapshot has landed yet
       ANY render in that window asks nightIsOver()

     With HR.doc null the guard had no evidence and returned false, so
     the app decided the night was over and painted the ending — with Q4
     live on the server and its own listener about to say so. On a laptop
     that never sleeps this window essentially never opens, which is why
     it reads as "a problem on the smart phone".

     The valve stays: a doc lost an hour ago is a host that has gone, and
     the player must still be able to reach their ending. */
  { key:'phone-woke-up',
    name:'phone was locked through the break: doc dropped 4s ago, feed Final',
    doc:null, scored:['r2'], hadDoc:true, lostMin:0.07,
    over:false, ending:false,
    roundLive:false, roundsOut:true },

  { key:'phone-woke-up-late',
    name:'the doc was lost 60 minutes ago — that is a host that has gone',
    doc:null, scored:['r2'], hadDoc:true, lostMin:60,
    over:true, ending:true,
    roundLive:false, roundsOut:false },

  { key:'still-playing',
    name:'the game is still LIVE and the last round is open',
    feed:'in', detail:'4:03 - 4th',
    doc:{id:'r3',idx:3,state:'live',agoMin:1}, scored:['r2'],
    over:false, ending:false, answer:true,
    roundLive:true, roundsOut:true },
];

(async()=>{
  console.log('\n=== THE LAST ROUND MUST BE REACHABLE ===   '
    + path.basename(TARGET) + ' · ' + ENGNAME + (SABOTAGE?' · SABOTAGED':''));

  const {b,p,errs}=await boot();

  for(const c of CASES){
    const r=await night(p,c);
    console.log('\n  ' + c.name);
    console.log('    phase=' + r.phase
              + '  roundsOutstanding=' + r.roundsOut
              + '  hostedRoundIsLive=' + r.roundLive
              + '  nightIsOver=' + r.over);
    console.log('    tab: ending=' + r.tabEnding + '  answer-button=' + r.tabAnswer
              + '   lockPicks(last)=' + r.lockLast);
    if(r.startRow) console.log('    gtStartRow: "' + r.startRow.slice(0,72) + '"');
    if(r.renderErr) console.log('    RENDER ERROR ' + r.renderErr);

    /* The two helpers must be measured, not assumed — this is how the
       fixture is proved to exercise the guard it claims to. */
    ok(c.key+'.hostedRoundIsLive-is-what-the-fixture-says',
       r.roundLive===c.roundLive,
       'hostedRoundIsLive()=' + r.roundLive + ', fixture says ' + c.roundLive);
    ok(c.key+'.roundsOutstanding-is-what-the-fixture-says',
       r.roundsOut===c.roundsOut,
       'nightRoundsOutstanding()=' + r.roundsOut + ', fixture says ' + c.roundsOut);

    /* THE DECIDER. */
    ok(c.key+'.nightIsOver-agrees-with-the-rounds-not-the-feed',
       r.over===c.over,
       'nightIsOver()=' + r.over + ' with phase=' + r.phase
       + ' and rounds outstanding=' + r.roundsOut);

    /* THE RENDER. This is the surface the founder photographed. */
    ok(c.key+'.the-gametime-tab-'+(c.ending?'shows':'does-not-show')+'-the-ending',
       r.tabEnding===c.ending,
       c.ending ? 'the night is genuinely over and the tab never says so'
                : 'the tab is showing "finished"/"See your result card" while a round is outstanding');

    if(c.answer){
      ok(c.key+'.the-open-round-is-on-the-screen',
         r.tabAnswer===true,
         'gtStartRow() produced "' + String(r.startRow).slice(0,50) + '" and the tab does not carry it');
    }

    /* THE SUBMISSION. A button that renders and drops the answer is
       worse than no button. */
    ok(c.key+'.lockPicks-'+(c.over?'refuses':'accepts')+'-the-last-round',
       r.lockLast === !c.over,
       c.over ? 'answers were accepted for a night that is genuinely over'
              : 'lockPicks() refused the last round — the player answers and nothing reaches the host');

    ok(c.key+'.no-render-error', !r.renderErr, r.renderErr||'');
  }

  /* ============ FOUR SURFACES, TWO ANSWERS =============================
     25 Aug, one player, one room, one moment: score strip 154, Board
     TONIGHT 149, Board night-by-night 154, final card 149. shownTotal()
     is the file's own owner of "the number to show a player" and its rule
     is written down — the server's row wins whenever there is one, S.pts
     is a preview. The strip and the banking read reached past it.

     Asserted as AGREEMENT between two rendered surfaces rather than as a
     literal, so a build that computes a different number politely still
     goes red. */
  console.log('\n  --- the strip and the card two inches below it ---');
  {
    const r=await night(p, CASES.find(c=>c.key==='truly-over'));
    console.log('    score strip: ' + r.railTotal + ' pts   ·   final card: '
                + r.tabTotal + ' points in this room');
    ok('totals.both-surfaces-produced-a-number',
       r.railTotal!=null && r.tabTotal!=null,
       'strip=' + r.railTotal + ' card=' + r.tabTotal);
    ok('totals.the-strip-and-the-card-agree',
       r.railTotal===r.tabTotal,
       'the score strip says ' + r.railTotal + ' and the card two inches below it says ' + r.tabTotal);
    ok('totals.and-the-number-is-the-servers',
       r.railTotal===149,
       'the confirmed figure is 149; this build shows ' + r.railTotal
       + ' (154 is the local preview S.pts)');
  }

  /* ============ AND THE NIGHT CAN ALWAYS END ==========================
     The direction that would be the worse bug. Blocking on "rounds still
     to come" must never leave a player unable to reach their own result,
     so the valve is walked across the boundary rather than sampled once.
     45 minutes is the constant in both helpers. */
  console.log('\n  --- the abandonment valve, across the boundary ---');
  for(const mins of [5, 30, 44, 46, 90, 240]){
    const r=await night(p, {doc:{id:'r2',idx:2,state:'scored',agoMin:mins}, scored:['r2']});
    const shouldEnd = mins>45;
    console.log('    a runner last seen ' + String(mins).padStart(3) + ' min ago  ->  nightIsOver='
                + r.over + '   tab-ending=' + r.tabEnding);
    ok('valve.'+mins+'min.night-'+(shouldEnd?'ends':'stays-open'),
       r.over===shouldEnd,
       'nightIsOver()=' + r.over + ' ' + mins + ' minutes after the last round document');
    ok('valve.'+mins+'min.the-tab-follows-the-decider',
       r.tabEnding===r.over,
       'the decider says ' + r.over + ' and the rendered tab says ' + r.tabEnding);
  }

  /* PRACTICE IS UNTOUCHED. nightIsOver() returns false in demo before it
     looks at anything, and a rehearsal must still reach its ending. */
  console.log('\n  --- practice ---');
  {
    const r=await p.evaluate(()=>{
      GS.ok=true; GS.ev=String(GAME.espnEvent); GS.state='post';
      PHASE={v:'final',at:Date.now(),src:'feed'};
      S.mode='demo'; S.screen='gametime';
      HR.doc={id:'r2',idx:2,state:'scored',seq:Date.now()-60000}; HR.scored={r2:true};
      var o={};
      try{ o.over=nightIsOver(); }catch(e){ o.over='ERR'; }
      try{ o.roundsOut=nightRoundsOutstanding(); }catch(e){ o.roundsOut='ERR'; }
      return o;
    });
    console.log('    practice: nightIsOver=' + r.over + '  roundsOutstanding=' + r.roundsOut);
    ok('practice.the-guard-does-not-touch-a-rehearsal',
       r.over===false && r.roundsOut===false,
       'nightIsOver()=' + r.over + ' roundsOutstanding=' + r.roundsOut + ' in demo mode');
  }

  /* ============ THE WIRING, NOT THE FIXTURE ===========================
     Every case above SETS HR.everHad/HR.lostAt by hand, so all of them
     would still pass if roomListenersStop() never wrote them — the guard
     would be right and nothing would ever feed it. That is precisely the
     "the correct function existed and nothing called it" shape this
     codebase keeps producing, so the real bookkeeping is asserted here
     against the actual functions.

     onHostedRound() is driven with a genuine round document rather than
     assigning HR.doc, because setting everHad is ITS job. */
  console.log('\n  --- the bookkeeping roomListenersStop actually writes ---');
  {
    const r=await p.evaluate(()=>{
      var o={};
      S.mode='live';
      HR.doc=null; HR.everHad=false; HR.lostAt=0; HR.scored={};
      /* a real pushed round, through the real handler */
      try{ onHostedRound({id:'r2', idx:2, state:'scored', seq:Date.now()-60000,
                          tag:'Q3', name:'Quarter 3', worth:30, questions:[]}); }catch(e){ o.pushErr=String(e).slice(0,80); }
      o.everHadAfterPush = HR.everHad;
      o.docAfterPush     = !!HR.doc;

      /* the phone locks */
      try{ roomListenersStop('pagehide'); }catch(e){ o.stopErr=String(e).slice(0,80); }
      o.docAfterHide     = !!HR.doc;
      o.everHadAfterHide = HR.everHad;
      o.lostAtSet        = (Number(HR.lostAt) > 0);
      o.lostAtRecent     = (Date.now() - Number(HR.lostAt)) < 5000;

      /* and the same teardown for a ROOM SWITCH must forget instead */
      HR.doc=null; HR.everHad=true; HR.lostAt=Date.now();
      try{ roomListenersStop('switch'); }catch(_){}
      o.everHadAfterSwitch = HR.everHad;
      o.lostAtAfterSwitch  = Number(HR.lostAt);
      return o;
    });
    console.log('    after a pushed round : everHad=' + r.everHadAfterPush + '  doc=' + r.docAfterPush);
    console.log('    after pagehide       : doc=' + r.docAfterHide + '  everHad=' + r.everHadAfterHide
                + '  lostAt set=' + r.lostAtSet);
    console.log('    after a room switch  : everHad=' + r.everHadAfterSwitch
                + '  lostAt=' + r.lostAtAfterSwitch);
    if(r.pushErr) console.log('    PUSH ERROR ' + r.pushErr);
    if(r.stopErr) console.log('    STOP ERROR ' + r.stopErr);

    ok('wiring.a-pushed-round-records-that-this-room-has-a-host',
       r.everHadAfterPush===true && r.docAfterPush===true,
       'onHostedRound() left everHad=' + r.everHadAfterPush + ' doc=' + r.docAfterPush);
    ok('wiring.pagehide-drops-the-doc',
       r.docAfterHide===false,
       'roomListenersStop kept HR.doc');
    ok('wiring.pagehide-remembers-we-had-one',
       r.everHadAfterHide===true,
       'everHad=' + r.everHadAfterHide + ' after pagehide — the guard will read this as a hostless night');
    ok('wiring.pagehide-stamps-when-we-lost-it',
       r.lostAtSet===true && r.lostAtRecent===true,
       'lostAt was not stamped with a recent time');
    ok('wiring.a-room-switch-forgets-the-previous-rooms-host',
       r.everHadAfterSwitch===false && r.lostAtAfterSwitch===0,
       'everHad=' + r.everHadAfterSwitch + ' lostAt=' + r.lostAtAfterSwitch
       + ' — the room the player LEFT would block the new room from ending');
  }

  await b.close();
  ok('no-page-errors', errs.length===0, errs.slice(0,3).join(' · '));

  const verdict = fail? 'RED' : 'GREEN';
  console.log(`\n${verdict}   ${pass} passed, ${fail} failed   [${path.basename(TARGET)} · ${ENGNAME}]`
              + (SABOTAGE?'   [SABOTAGED — red is the correct result]':''));
  bad.forEach(x=>console.log('   x '+x));
  if(SABOTAGE){ process.exit(fail?0:1); }
  process.exit(fail?1:0);

})().catch(e=>{ console.log('fourth-quarter.js could not run: '+(e&&e.stack||e)); process.exit(1); });
