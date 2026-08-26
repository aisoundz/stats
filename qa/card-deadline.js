#!/usr/bin/env node
/* =====================================================================
   THE PRE-GAME CARD HAS A DEADLINE, AND `S.place` IS NOT IT.
   ---------------------------------------------------------------------
   Founder, on the live site, POR 68 DAL 84 with 4:03 left in the fourth:
   "all it takes is a refresh to get the game to refresh and you can
   reenter your picks." The screenshot is the PRE-GAME PREDICTION SHEET —
   "Make your picks", "Lock these in before tip-off", "Up to 600 pts",
   1/6 picked — open in the fourth quarter of a decided game. That card is
   600 of the night's 1,000 points, and filling it at 4:03 in the fourth
   means filling it knowing most of what happened.

   THE HOLE, reproduced against the shipped build by this file.
   startPredict() had two guards and this walks between them:

     nightIsOver()                  is phaseNow()==='final'. The game was
                                    LIVE, so it said nothing.
     GAME_SCREENS.indexOf(S.place)  S.place is LOCAL STATE. Every one of
                                    these deletes it: doSignOut ->
                                    freshStart('') -> clearSave() (the
                                    GN13 exploit — "log out and then pick
                                    the right people because they already
                                    know what happened"); checkResume()
                                    clearing a save from another night,
                                    and LS_KEY() is keyed on nightId so a
                                    room switch on a four-room night is
                                    enough; the first 60ms of every boot
                                    before auto-resume runs; any second
                                    device or private window.

   A lock whose key the app itself deletes is not a lock.

   WHAT IS ASSERTED. Not "the guard function returns the right boolean" —
   that would pass on a build where the deck opened anyway. Every check
   below drives startPredict() (or the two other doors) and reads whether
   #s-predict is the ACTIVE screen afterwards.

   THREE DOORS, because a guard on one is a guard on none:
     startPredict()  the button on the handle screen — the founder's route
     returnToGame()  the floating "back to your game" bar, which reads
                     S.place and reopens the deck from it
     doResume()      auto-resume, 60ms after every boot, with nobody's
                     finger on anything

   AND THE OTHER DIRECTION, which would be the worse bug: a stranger who
   arrives at half-time must still get a seat and still play the live
   rounds. Losing the card is correct. Losing the night is not.

   IT MUST GO RED ON index.html:

       node qa/card-deadline.js index.html         # expect RED
       node qa/card-deadline.js index-test.html    # expect GREEN
       node qa/card-deadline.js --sabotage         # expect RED

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

/* Undo the fix at the door the founder used. If this file still passes
   with the gate removed from startPredict(), it is not testing it. */
function sabotage(html){
  let h=html;
  const from=/  if\(predGateShut\(false\)\) return;\n/;
  if(!from.test(h)) throw new Error('sabotage could not find the startPredict gate — the shape of the fix changed and this file must be updated with it');
  h=h.replace(from,'  /* SABOTAGED: the deck opens whatever the phase says */\n');
  return h;
}

async function boot(){
  const b=await ENG.launch();
  const ctx=await b.newContext({viewport:{width:393,height:852}, deviceScaleFactor:1});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,160)));

  let html=fs.readFileSync(TARGET,'utf8');
  if(SABOTAGE) html=sabotage(html);
  const tmp=path.join(os.tmpdir(),'card-deadline-under-test-'+process.pid+'.html');
  fs.writeFileSync(tmp,html);

  await p.route('**/site.api.espn.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(F.LIVE)}));
  await p.route('**/assets.mailerlite.com/**', r=>r.fulfill({status:200,body:'{}'}));
  await p.goto('file://'+tmp,{waitUntil:'domcontentloaded'});
  await waitReady(p);

  /* FEED STATE IS PINNED BEFORE ANYTHING IS MEASURED. loadGameStats() is
     async and its `if(GS.ev!==ev){GS.ok=false;}` runs synchronously before
     the first await, so GS.ok flips true->false underneath a caller at
     whatever moment a file:// fetch gives up — and every decision in this
     file is taken off GS. The caller is removed rather than the flag set.

     The account is real as far as the app can tell: the verify gate is
     ahead of the guard under test and would otherwise be the thing that
     refuses, which would make a broken build look fixed. */
  await p.evaluate(()=>{
    try{ window.loadGameStats=async function(){ return null; }; }catch(_){}
    try{
      window.SB=window.SB||{};
      SB.verified=function(){ return true; };
      SB.me={email:'founder@example.com'};
      SB.enabled=true; SB.seated=function(){ return true; };
      SB.mySub=async function(){ return null; };
      SB.myScore=async function(){ return null; };
      SB.submit=async function(){ return true; };
    }catch(_){}
    /* joinNight() is stubbed to a promise that resolves true rather than
       removed, so the "did they still get a seat" check below is measuring
       whether the app ASKED for one — which is the thing that must not be
       skipped when the card is refused. */
    try{
      window.__joined=0;
      window.joinNight=async function(){ window.__joined++; return true; };
      window.ensureJoined=function(){ window.__joined++; };
    }catch(_){}
  });
  return {b,p,errs};
}

/* ---------------------------------------------------------------------
   THE STATE A REFRESH LEAVES BEHIND.

   `place:''` is the whole bug. It is not a contrivance — clearSave()
   writes exactly that, and so does every boot before auto-resume runs.
   ------------------------------------------------------------------ */
async function arrive(p, c){
  return p.evaluate((c)=>{
    /* The feed, about THIS room, in the state named. */
    GS.ok      = (c.feed!=='none');
    GS.ev      = (c.feed==='other') ? 'not-this-event' : String(GAME.espnEvent);
    GS.state   = (c.feed==='pre') ? 'pre' : (c.feed==='final' ? 'post' : 'in');
    GS.detail  = c.detail || '';
    GS.teams   = [{ab:'POR',name:'Portland',score:68},{ab:'DAL',name:'Dallas Wings',score:84}];
    PHASE      = {v:'', at:0, src:''};       // a reload wipes this too

    /* The tip time, which is the fact that survives a refresh. */
    if(c.tipMinsAway!=null) GAME.tipISO = new Date(Date.now()+c.tipMinsAway*60000).toISOString();
    if(c.noTip) GAME.tipISO = '';

    /* The deck's `.active` class outlives a case, because a door that
       REFUSES never calls go() — so a stale .active from the previous
       fixture would read as "the sheet opened" and make a broken build
       look fixed. Reset to the handle screen, which is where the button
       the founder pressed actually lives. */
    try{ go('name'); }catch(_){}
    S.mode='live'; S.name='Founder'; S.screen='name';
    S.place = (c.place!=null) ? c.place : '';     // THE BUG: a reload wipes it
    S.predChoices = {};
    if(c.hasCard){ try{ preds.forEach(function(pp,i){ if(i<2) S.predChoices[pp.id]='someone'; }); }catch(_){} }
    HR.doc=null; HR.started={}; HR.submitted={}; HR.scored={};
    try{ ledgerClear(); recomputeScore(); }catch(_){}
    window.__joined=0;

    var o={};
    try{ o.phase = phaseNow(); }catch(e){ o.phase='ERR'; }
    try{ o.windowOpen = (typeof predWindowOpen==='function') ? predWindowOpen() : 'NO-FN'; }catch(e){ o.windowOpen='ERR'; }

    var said=''; var real=window.toast; window.toast=function(m){ said=String(m||''); };
    try{
      if(c.door==='returnToGame')   returnToGame();
      else if(c.door==='doResume'){ resumeData=JSON.parse(JSON.stringify(S)); resumeData.place='predict'; doResume(); }
      else                          startPredict();
    }catch(e){ o.threw=String(e).slice(0,120); }
    window.toast=real;

    o.said   = said;
    o.screen = S.screen;
    o.deckOpen = !!document.querySelector('#s-predict.active');
    o.joined = window.__joined;
    return o;
  }, c);
}

/* ---------------------------------------------------------------------
   `deck` is whether the 600-point pre-game sheet may be filled in.
   ------------------------------------------------------------------ */
const CASES=[
  { key:'refresh-mid-game',
    name:'THE REPORT: mid-game, S.place wiped by a reload, no card yet',
    feed:'live', detail:'4:03 - 4th', tipMinsAway:-120, place:'',
    deck:false, seat:true, say:/closed at tip-off/i },

  { key:'refresh-mid-game-with-card',
    name:'...the same, but they DID lock a card before tip',
    feed:'live', detail:'4:03 - 4th', tipMinsAway:-120, place:'', hasCard:true,
    deck:false, seat:true, say:/locked in/i },

  { key:'signed-out-and-back',
    name:'the GN13 exploit: sign out mid-game, sign back in, S.place gone',
    feed:'live', detail:'2:10 - 3rd', tipMinsAway:-70, place:'',
    deck:false, seat:true },

  { key:'stale-place-predict',
    name:'a save left sitting on the card from before tip',
    feed:'live', detail:'4:03 - 4th', tipMinsAway:-120, place:'predict',
    deck:false, seat:true },

  { key:'game-final',
    name:'the game has finished',
    feed:'final', detail:'Final', tipMinsAway:-200, place:'',
    deck:false },

  /* THE OTHER DIRECTION, and it is the one that would be the worse bug. */
  { key:'before-tip',
    name:'twenty minutes before tip, feed says pre — the card is OPEN',
    feed:'pre', detail:'', tipMinsAway:20, place:'',
    deck:true, seat:true },

  { key:'before-tip-no-feed',
    name:'twenty minutes before tip with NO feed — the clock still says pre',
    feed:'none', tipMinsAway:20, place:'',
    deck:true, seat:true },

  { key:'feed-late-still-pre',
    name:'past the scheduled tip but the feed still says pre — a delayed start',
    feed:'pre', tipMinsAway:-15, place:'',
    deck:true, seat:true },

  { key:'feed-about-another-room',
    name:'the feed is describing the room they just left, and tip is 30 min away',
    feed:'other', tipMinsAway:30, place:'',
    deck:true, seat:true },

  /* THE UNKNOWN. No usable feed AND no parseable tip. Failing open here
     re-creates the whole hole; failing shut costs one tap, and the caller
     that reaches this leaves the button on screen. */
  { key:'unknown-phase',
    name:'no feed for this room and no tip time — nothing is known',
    feed:'none', noTip:true, place:'',
    /* `stay` — this branch deliberately does NOT navigate. The button
       that was just pressed is still under the player's thumb, so the
       recovery is one more tap once the feed lands, and moving them would
       take away the only way back to a card they may still be entitled
       to. */
    deck:false, seat:true, stay:'name', say:/checking whether/i },
];

(async()=>{
  console.log('\n=== THE CARD CLOSES AT TIP-OFF ===   '
    + path.basename(TARGET) + ' · ' + ENGNAME + (SABOTAGE?' · SABOTAGED':''));

  const {b,p,errs}=await boot();

  ok('guard.predWindowOpen-exists',
     await p.evaluate(()=>typeof predWindowOpen==='function'),
     'there is no predWindowOpen() in this build — the card is still gated on S.place alone');

  for(const c of CASES){
    const r=await arrive(p,c);
    console.log('\n  ' + c.name);
    console.log('    phase=' + r.phase + '  predWindowOpen=' + r.windowOpen
              + '  ->  deck ' + (r.deckOpen?'OPEN':'shut') + ', screen=' + r.screen
              + ', joined=' + r.joined);
    if(r.said) console.log('    says: "' + r.said + '"');
    if(r.threw) console.log('    THREW ' + r.threw);

    ok(c.key+'.the-600-point-sheet-is-'+(c.deck?'open':'shut'),
       r.deckOpen===c.deck,
       c.deck ? 'a legitimate pre-tip player was refused their own card'
              : 'the pre-game sheet opened with the phase at "' + r.phase + '"');

    /* Losing the card is correct; losing the night is not. This is the
       reason the gate sits BELOW ensureJoined() in startPredict(). */
    if(c.stay){
      ok(c.key+'.the-player-is-not-moved',
         r.screen===c.stay,
         'an unknown phase navigated the player to "' + r.screen + '" — the button they pressed is no longer on screen');
    }
    if(c.seat && !c.stay && c.door!=='doResume'){
      ok(c.key+'.they-are-still-in-the-night',
         r.joined>0,
         'the app never asked for a seat, so a player who arrived at half-time cannot play the live rounds either');
      ok(c.key+'.and-they-land-somewhere-they-can-play',
         ['predict','lobby','live','review','break','gametime'].indexOf(r.screen)>=0,
         'they were left on "' + r.screen + '"');
    }
    if(c.say){
      ok(c.key+'.and-they-are-told-why',
         c.say.test(r.said||''),
         'said "' + (r.said||'(nothing)') + '"');
    }
    ok(c.key+'.no-exception', !r.threw, r.threw||'');
  }

  /* ============ THE OTHER TWO DOORS ==================================
     returnToGame() and doResume() both end in `buildPred(); go('predict')`
     read off the same S.place. doResume() is the automatic one: it fires
     60ms after every boot with nobody's finger on anything. */
  console.log('\n  --- the other two doors into the deck ---');
  for(const door of ['returnToGame','doResume']){
    const r=await arrive(p,{door, feed:'live', detail:'4:03 - 4th',
                            tipMinsAway:-120, place:'predict'});
    console.log('    ' + door.padEnd(14) + ' with a save on "predict", mid-game  ->  deck '
              + (r.deckOpen?'OPEN':'shut') + ', screen=' + r.screen);
    if(r.said) console.log('        says: "' + r.said + '"');
    ok('door.'+door+'.does-not-reopen-the-sealed-card',
       r.deckOpen===false,
       door + '() served the pre-game sheet in the fourth quarter off a stale S.place');
    ok('door.'+door+'.still-lands-the-player-in-the-night',
       ['lobby','live','review','break','gametime'].indexOf(r.screen)>=0,
       door + '() left the player on "' + r.screen + '"');

    /* ...and the same door must still work before tip. A guard that shuts
       everything is not a fix. */
    const q=await arrive(p,{door, feed:'pre', tipMinsAway:25, place:'predict'});
    console.log('    ' + door.padEnd(14) + ' with the same save, 25 min BEFORE tip  ->  deck '
              + (q.deckOpen?'OPEN':'shut'));
    ok('door.'+door+'.still-opens-the-card-before-tip',
       q.deckOpen===true,
       door + '() refused a player who was legitimately still filling their card');
  }

  /* PRACTICE REPLAYS FOREVER, for the reason nightIsOver() gives: there is
     no real game behind a practice deck. */
  console.log('\n  --- practice ---');
  {
    const r=await p.evaluate(()=>{
      GS.ok=true; GS.ev=String(GAME.espnEvent); GS.state='post';
      PHASE={v:'final',at:Date.now(),src:'feed'};
      setMode('demo'); S.mode='demo'; S.name='Sam'; S.place=''; S.screen='name';
      var o={};
      try{ o.windowOpen=predWindowOpen(); }catch(e){ o.windowOpen='ERR'; }
      try{ startPredict(); }catch(e){ o.threw=String(e).slice(0,90); }
      o.deckOpen=!!document.querySelector('#s-predict.active');
      return o;
    });
    console.log('    practice, feed says final: predWindowOpen=' + r.windowOpen
              + '  deck ' + (r.deckOpen?'OPEN':'shut'));
    ok('practice.a-rehearsal-is-always-replayable',
       r.deckOpen===true,
       'practice was refused its own deck — predWindowOpen()=' + r.windowOpen);
  }

  await b.close();
  ok('no-page-errors', errs.length===0, errs.slice(0,3).join(' · '));

  const verdict = fail? 'RED' : 'GREEN';
  console.log(`\n${verdict}   ${pass} passed, ${fail} failed   [${path.basename(TARGET)} · ${ENGNAME}]`
              + (SABOTAGE?'   [SABOTAGED — red is the correct result]':''));
  bad.forEach(x=>console.log('   x '+x));
  if(SABOTAGE){ process.exit(fail?0:1); }
  process.exit(fail?1:0);

})().catch(e=>{ console.log('card-deadline.js could not run: '+(e&&e.stack||e)); process.exit(1); });
