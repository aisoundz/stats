#!/usr/bin/env node
/* =====================================================================
   COME, GO. THE QUESTION FINDS THE PLAYER.
   ---------------------------------------------------------------------
   26 Aug 2026, the first outside feedback session this product has had.
   The strongest note in it, and it is a direction rather than a bug:

     "I think it should be more less reading. The first question comes up,
      then you choose, you see the ticker ticking down, and that's it.
      Then the next one comes up instead of having to search."
     "We have to figure out a way for it to just COME, GO. COME, GO."
     "Here, it's more like, I GOTTA HUNT. I'M HUNTING AROUND."
     "Like an arcade game."

   And the room he wants it to work in: "if I'm sitting in a stadium, the
   kids running, my wife is talking about what happened at work, I need
   it to be as easy as a notification."

   WHAT WAS ACTUALLY WRONG, and it is one branch of one function.
   openHostedRound() already auto-starts a round when the player happens
   to be standing on the lobby. From ANY OTHER TAB it toasted "head back
   to the lobby" — it told him to walk. On a twenty-second clock, beside
   a television. That is the hunting.

   WHAT THIS SUITE PINS. Not just that it moves, but the four cases where
   it must NOT, because a screen that takes itself over is worse than one
   you have to find:

     home / stats / board  ->  TAKES the player into the round
     predict / predreview  ->  NEVER. A sealed card worth 600 of 1,000
                               points, mid-decision.
     live / review         ->  NEVER. Finish the round you are in.
     signed out            ->  NEVER. No seat, nowhere to land.
     practice              ->  NEVER.

   And the staleness case, which is the one that would bite in a real
   room: the move is on a 2.2s beat, and in 2.2 seconds a round can be
   scored, superseded, or answered on another device. Every condition is
   re-checked at the moment of the move, not at the moment of the
   decision.

       node qa/arcade.js
       node qa/arcade.js index-test.html
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
  console.log('\n=== COME, GO — THE QUESTION FINDS THE PLAYER ===   '
    + path.basename(TARGET) + ' · ' + ENG);

  const b=await ENGINE.launch();
  const p=await b.newPage({viewport:{width:390,height:844}});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await p.route('**/site.api.espn.com/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
  await p.route('**/assets.mailerlite.com/**',r=>r.fulfill({status:200,body:'{}'}));

  const tmp=path.join(os.tmpdir(),'qa-arcade-'+process.pid+'.html');
  fs.copyFileSync(TARGET,tmp);
  await p.goto('file://'+tmp,{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>window.STATS_READY===true,null,{timeout:25000}).catch(()=>{});

  /* A round arrives while the player is standing on `from`. Returns where
     they ended up. The wait is longer than the app's own 2.2s beat so a
     move that is merely SLOW is not reported as a move that never came. */
  async function roundArrives(from, opts){
    opts = opts || {};
    await p.evaluate((c)=>{
      S.mode = c.demo ? 'demo' : 'live';
      S.screen = c.from;
      /* a seat, unless the case is explicitly signed out */
      window.SB = window.SB || {};
      SB.enabled = true;
      SB.seated = function(){ return !c.signedOut; };
      SB.submit = async function(){ return true; };
      /* four rounds, none started */
      HR.started={}; HR.submitted={}; HR.scored={}; HR.held={};
      HR.pending=null; HR.doc=null;
      /* keep the harness off the network and off the real question flow:
         startQuarter is the thing under test's EFFECT, so record it. */
      window.__took = null;
      window.startQuarter = function(i){ window.__took = i; S.screen='live'; };
      try{ window.notify = function(){}; }catch(_){}
    }, { from, demo: !!opts.demo, signedOut: !!opts.signedOut });

    await p.evaluate(()=>{
      try{
        openHostedRound({ id:'r2', idx:2, state:'live', seq:Date.now(), questions:[] }, 2);
      }catch(e){ window.__err = String(e).slice(0,120); }
    });
    await p.waitForTimeout(3200);        // the app's beat is 2.2s
    return p.evaluate(()=>({ took: window.__took, screen: S.screen, err: window.__err||null }));
  }

  console.log('\n  a round opens while the player is somewhere else');
  for(const from of ['home','stats','board','gametime']){
    const r = await roundArrives(from);
    console.log(`     on "${from}"  ->  startQuarter(${r.took})  screen=${r.screen}`
      + (r.err ? '   THREW '+r.err : ''));
    check('takes.from-'+from, r.took===2,
      `a round opened while the player was on "${from}" and the app did not take them to it — '
      + 'this is the "head back to the lobby" toast, which is the hunting`);
  }

  console.log('\n  and the screens it must NEVER take over');
  const never = [
    ['predict',    {},               'the sealed card, worth 600 of 1,000 points, mid-decision'],
    ['predreview', {},               'the card review, same reason'],
    ['live',       {},               'they are answering a round already'],
    ['review',     {},               'they are reading a result already'],
    ['home',       {signedOut:true}, 'no seat — there is nowhere to land them'],
    ['home',       {demo:true},      'practice is a rehearsal and owns its own screen'],
  ];
  for(const [from, opts, why] of never){
    const r = await roundArrives(from, opts);
    const label = from + (opts.signedOut?' (signed out)':'') + (opts.demo?' (practice)':'');
    console.log(`     on "${label}"  ->  startQuarter(${r.took})`);
    check('never.'+from+(opts.signedOut?'-signedout':'')+(opts.demo?'-practice':''),
      r.took===null,
      `the app took the player off "${label}" — ${why}`);
  }

  /* ------------------------------------------------------------------
     THE STALENESS CASE. The move is on a 2.2s beat and a lot can happen
     in 2.2 seconds. Each of these changes the world DURING the beat and
     the move must be abandoned.
     ------------------------------------------------------------------ */
  console.log('\n  and it re-checks at the moment of the move, not the moment of the decision');
  async function racedBy(mutate, label){
    await p.evaluate(()=>{
      S.mode='live'; S.screen='home';
      window.SB=window.SB||{}; SB.enabled=true; SB.seated=function(){return true;};
      HR.started={}; HR.submitted={}; HR.scored={}; HR.pending=null;
      window.__took=null;
      window.startQuarter=function(i){ window.__took=i; S.screen='live'; };
      try{ window.notify=function(){}; }catch(_){}
      try{ openHostedRound({id:'r2',idx:2,state:'live',seq:Date.now(),questions:[]}, 2); }catch(_){}
    });
    await p.waitForTimeout(600);          // mid-beat
    await p.evaluate(mutate);
    await p.waitForTimeout(2800);         // past the beat
    const r = await p.evaluate(()=>({took:window.__took, screen:S.screen}));
    console.log(`     ${label}  ->  startQuarter(${r.took})`);
    return r;
  }

  let r;
  r = await racedBy(()=>{ HR.pending=null; }, 'the round is scored out from under them');
  check('race.scored-mid-beat', r.took===null,
    'the round was superseded during the 2.2s beat and the app moved anyway');

  r = await racedBy(()=>{ S.screen='predict'; }, 'they open their card mid-beat');
  check('race.opened-the-card-mid-beat', r.took===null,
    'the player opened the prediction card during the beat and was yanked off it');

  r = await racedBy(()=>{ HR.submitted['r2']=true; }, 'they answer on another device');
  check('race.answered-elsewhere-mid-beat', r.took===null,
    'the round was answered on another device during the beat and the app opened it again');

  await b.close();
  check('no-page-errors', errs.length===0, errs.slice(0,3).join(' · '));
  try{ fs.unlinkSync(tmp); }catch(_){}

  console.log(fail
    ? `\n\x1b[31mRED\x1b[0m   ${fail} failed   [${path.basename(TARGET)} · ${ENG}]`
    : `\n\x1b[32mGREEN\x1b[0m  all checks pass   [${path.basename(TARGET)} · ${ENG}]`);
  process.exit(fail?1:0);
})().catch(e=>{ console.error('SUITE CRASHED', e); process.exit(1); });
