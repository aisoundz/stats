#!/usr/bin/env node
/* =====================================================================
   RUN EVERY SUITE, IN ONE COMMAND, AND RETURN ONE VERDICT.
   ---------------------------------------------------------------------
   WHY THIS EXISTS. There are twenty-six suites in this directory and no
   file anywhere in the repo that runs them all. Each one is invoked by
   hand, from memory, which means the honest description of the gate is
   "whichever suites somebody remembered tonight". A suite nobody runs is
   not a safety net — it is a file that makes you feel like you have one.
   qa/voice-lang.js was written on 19 Aug and would have been the fourth
   suite in a row that only ever ran on the day it was written.

   It also fixes a subtler thing: qa.js reports "ALL 103 CHECKS PASS —
   safe to promote", and that sentence is only true about the checks IN
   qa.js. Promoting on it while host-resolvers.js is red is exactly the
   kind of confident-and-wrong the incident catalogue is full of.

   THE TIERS, because they are not the same kind of check.
     static   no browser, no network. The default. Always runnable.
     browser  drives a real Chromium; needs playwright installed.
     live     asks ESPN or Firestore. Real answers, real flakiness, and
              it fails when the sport is out of season rather than when
              the code is wrong — so it is never in the default run.

     node qa/all.js                 # static + browser  (the gate)
     node qa/all.js --static        # no browser needed
     node qa/all.js --live          # everything, including the network
     node qa/all.js --list          # what would run

   A suite that CRASHES is reported as a failure, not skipped. That is the
   whole point: the failure mode this file exists to stop is a red suite
   that nobody was looking at.
   ================================================================== */
const {spawnSync}=require('child_process');
const fs=require('fs'), path=require('path');
const DIR=__dirname;

const ARG=process.argv.slice(2);
const ONLY_STATIC=ARG.includes('--static');
const WITH_LIVE  =ARG.includes('--live');
const LIST       =ARG.includes('--list');
let STAMP_STUCK=false;
const QUICK      =ARG.includes('--quick');
/* WHICH BUILD IS THIS GATE JUDGING? One answer, handed to every suite that
   accepts one. Found 19 Aug and it is worse than untidy: voice-pick.js
   defaulted to index-test.html while voice.js, voice-wiring.js,
   board-order.js and voice-lang.js defaulted to index.html — so a single
   "the gate is green" was four suites reading the FILE BEING PROMOTED and
   the rest reading the file ALREADY LIVE. Half the gate was grading the
   old build, and the halves swap depending on which suite you ran. That is
   ONE FACT, MANY COPIES with the fact being "the build under test".

   index-test.html is the default because that is what qa.js checks and the
   rule is build-on-test-then-promote.  --file index.html re-runs the same
   suites against what is live, which is how you tell a NEW break from an
   inherited one. */
const fi=ARG.indexOf('--file');
const TARGET=fi>=0 && ARG[fi+1] ? ARG[fi+1] : 'index-test.html';
const TARGET_ABS=path.resolve(__dirname,'..',TARGET);
/* Only these accept a positional target; handing one to a suite that does
   not read argv[2] is harmless, but claiming it was targeted would not be. */
const TARGETABLE=new Set(['voice.js','voice-wiring.js','voice-pick.js','voice-lang.js',
  'board-order.js','payoff.js','slate.js','acceptance.js','host-sportsreg.js','localise.js','i18n.js','season.js',
  'devices.js','night-config.js','overtime.js','platforms.js','change-it.js','chrome.js','places.js','switch.js','hero.js','listeners.js','practice.js','spanish.js','marquee-order.js']);
/* Suites that read admin.html rather than the player file. The player half
   of the gate was split across two builds and fixed; the ADMIN half is
   split the same way and is NOT fixed — these seven read admin.html even
   when admin-test.html is the file being promoted, while qa.js reads
   admin-test.html. Named here so "green" is never read as broader than it
   is, rather than left to a filename regex to guess at. */
/* Player-side suites that genuinely ignore a passed target.
   THIS LIST WAS WRONG, and the comment above it claimed it had been
   verified by reading each file. It had not. devices.js, night-config.js
   and overtime.js all take process.argv[2] and merely DEFAULT to
   index.html — so 70+ checks, including all sixteen overtime checks on a
   night with a live OT bank, were grading the file ALREADY LIVE while the
   banner said "judging index-test.html". That is the same one-fact-many-
   copies bug this file was written to fix, half-fixed, with a comment
   asserting it was finished. Re-verified by reading argv handling in each:

     devices.js       process.argv[2] || 'index.html'                 TARGETABLE
     night-config.js  process.argv[2] || …/index.html                 TARGETABLE
     overtime.js      process.argv[2] || …/index.html                 TARGETABLE
     journey.js       ARG('url', …/index-test.html)  — no argv[2]     untargeted
     live-smoke.js    drives https://statsgametime.com/               by design */
const KNOWN_UNTARGETED=['journey.js','live-smoke.js'];
const ADMIN_READERS=['host-overtime.js','host-resolvers.js','host-sports.js','host-block.js',
                     'host-banks.js','host-publish-ot.js','bank-shadow.js'];

/* The tier of each suite, stated once. A suite added to the directory and
   not named here is REPORTED, not silently ignored — see the sweep below,
   which is the difference between a manifest and a lie. */
const TIER={
  'qa.js':            {tier:'browser', args:QUICK?['--quick']:[]},
  'acceptance.js':    {tier:'static'},
  'board-order.js':   {tier:'static'},
  /* NOT SUITES. Both end in module.exports and print nothing; node loads
     them and exits 0, so they can never fail. Tiered as 'lib' so they are
     neither run nor reported as untiered — "ALL 16 SUITES PASS" used to be
     14 suites and 2 module loads. */
  'fakebase.js':      {tier:'lib'},
  'ready.js':         {tier:'lib'},
  'fixtures.js':      {tier:'lib'},
  'host-banks.js':    {tier:'static'},
  'host-block.js':    {tier:'static'},
  'host-overtime.js': {tier:'static'},
  'host-publish-ot.js':{tier:'static'},
  'host-resolvers.js':{tier:'static'},
  'host-runner.js':   {tier:'static'},
  'host-sports.js':   {tier:'static'},
  'launcher.js':      {tier:'static'},
  'voice.js':         {tier:'static'},
  'voice-lang.js':    {tier:'static'},
  'feed-path.js':     {tier:'static'},   // static by default; --live asks ESPN
  /* STRUCTURAL, not behavioural. Every other suite in this gate asks "does
     it do the right thing"; this one asks "can this line ever run at all".
     It exists because on 19-20 Aug the same defect — a comparison against a
     state value that is not in GAME_SCREENS — was found in the app twice
     and in five suites, and every one of those files passed its own checks
     while the code under them had never executed. */
  'places.js':        {tier:'static'},
  /* Room-switching, end to end, in a real browser. Every check in it is a
     defect that reached a live game night, and all five were sabotage-
     tested on 20 Aug: break the sport swap, the watchlist rebuild, the
     baked answer, the stats cache key or the rail collapse, and it goes
     red naming which one. */
  'switch.js':        {tier:'browser'},
  'hero.js':          {tier:'browser'},
  'listeners.js':     {tier:'browser'},
  'practice.js':      {tier:'browser'},
  /* --max 0. The backlog went to zero on 20 Aug, and a reporting-only check
     is how it got to 76 in the first place: nothing was lying, nobody was
     counting. From here a single untranslated string on any screen a player
     can reach turns the gate red. Sabotage-tested by deleting one entry, and
     it failed naming the string, so this can actually fail. */
  'spanish.js':       {tier:'browser', args:['--max','0']},
  'marquee-order.js': {tier:'browser'},
  /* NODE ONLY, and that is the point: it drives the real host engine over
     the real recorded feed for all five leagues with no browser at all, so
     it can be run during a live game night on the machine that is hosting
     it. It is also the only suite in this file that has ever asked the
     host a question about a sport that is not basketball. */
  'night-per-sport.js': {tier:'static'},
  /* The 20 Aug phantom overtime: a 70-point round for innings nobody
     played, opened 237ms after the real final round, in a game that
     ended in regulation. Static because it drives the real roundSlots()
     against synthetic feeds where the scoreboard and the plays disagree,
     which is the one condition no archived feed reproduces. */
  'phantom-ot.js': {tier:'static'},
  /* Reads source, not a browser. Guards the shape of bug this repo produces
     more than any other: something that fails and tells nobody. */
  'silence.js':       {tier:'static'},
  'bank-shadow.js':   {tier:'static'},
  'devices.js':       {tier:'browser'},
  'host-sportsreg.js':{tier:'browser'},
  'live-smoke.js':    {tier:'browser'},
  'night-config.js':  {tier:'browser'},
  'overtime.js':      {tier:'browser'},
  'slate.js':         {tier:'browser'},
  'voice-pick.js':    {tier:'browser'},
  'voice-wiring.js':  {tier:'browser'},
  'payoff.js':        {tier:'browser'},
  'localise.js':      {tier:'browser'},
  'i18n.js':          {tier:'browser'},
  'season.js':        {tier:'browser'},
  'change-it.js':     {tier:'browser'},
  /* Three engines x 11 device profiles — the slowest suite by far, so it
     is browser-tier and runs in the full gate rather than --static. */
  'platforms.js':     {tier:'browser'},
  /* THE CHROME BUDGET. Browser-tier and in the default gate, because the
     bug it catches — 41% of an iPad given to three sticky bars that know
     nothing about each other — was live through 538 green checks. */
  'chrome.js':        {tier:'browser'},
  'claims.js':        {tier:'live'},
  /* THE ONLY SUITE THAT READS THE WORDS. Live-tier because a placeholder
     that only appears once the real slate is on the page is exactly the one
     that got through — "swap this", on two soccer cards, to the founder's
     phone. A stubbed backend cannot see it. */
  'screen-copy.js':   {tier:'live'},
  'journey.js':       {tier:'browser'},
  'live-path.js':     {tier:'live'},
};

/* NAME THE SUITES THAT EXIST BUT ARE NOT IN THE TABLE. A manifest that
   silently covers a subset is the same bug as a gate that runs a subset. */
const onDisk=fs.readdirSync(DIR).filter(f=>/\.js$/.test(f) && f!=='all.js').sort();
const unlisted=onDisk.filter(f=>!TIER[f]);
const missing =Object.keys(TIER).filter(f=>!onDisk.includes(f));

function wanted(f){
  const t=TIER[f].tier;
  if(t==='lib')     return false;          // a helper module, not a suite
  if(t==='live')    return WITH_LIVE;
  if(t==='browser') return !ONLY_STATIC;
  return true;
}
const run=onDisk.filter(f=>TIER[f] && wanted(f));

if(LIST){
  console.log('\nwould run '+run.length+' of '+onDisk.length+' suites, judging '+TARGET+':');
  run.forEach(f=>console.log('  '+TIER[f].tier.padEnd(8)+f));
  if(unlisted.length) console.log('\nNOT IN THE TABLE (never run): '+unlisted.join(', '));
  process.exit(0);
}

/* ---- A PROMOTION NO PHONE CAN DETECT --------------------------------
   index.html carries the build the player is running; the app compares the
   SERVED stamp against the LOADED one and only offers "↻ New version ready"
   when they differ. Promote a candidate whose stamp equals the live one and
   nobody with the page already open is ever told — half the room plays the
   old build all night, and nothing on any screen, in the Control Room, or
   in live-smoke can tell them apart. qa.js checks a stamp EXISTS, not that
   it MOVED, so the gate could not catch this. Now it can. */
function stampOf(f){
  try{ return (fs.readFileSync(path.resolve(__dirname,'..',f),'utf8')
                 .match(/const STATS_BUILD='([^']+)'/)||[])[1]||null; }catch(_){ return null; }
}
if(!LIST && TARGET==='index-test.html'){
  const cand=stampOf('index-test.html'), live=stampOf('index.html');
  if(cand && live && cand===live){
    console.log('\n  !! index-test.html and index.html both say '+cand);
    console.log('     Promoting now would ship a build no open phone can detect — the');
    console.log('     "new version ready" prompt only fires when the stamp MOVES.');
    console.log('     Bump STATS_BUILD before promoting.\n');
    STAMP_STUCK = true;
  }
}
console.log('\n=== EVERY SUITE ===  judging '+TARGET
  +(ONLY_STATIC?'   static only':WITH_LIVE?'   including live':'')+'\n');
if(!fs.existsSync(TARGET_ABS)){ console.log('  the file under test does not exist: '+TARGET_ABS); process.exit(1); }
/* Say which suites are NOT reading that file, so "green" is never read as
   broader than it is. */
/* SAY WHICH SUITES ARE NOT READING THE TARGET — from a LIST, not a regex
   over filenames. The regex version was wrong in both directions: it
   omitted acceptance.js and host-sportsreg.js (both of which really did
   hardcode index.html) and it named journey.js, which does not. A note
   about honesty that is itself guessing is worse than no note. */
const untargeted=run.filter(f=>!TARGETABLE.has(f) && !ADMIN_READERS.includes(f) && KNOWN_UNTARGETED.includes(f));
if(untargeted.length)
  console.log('  player-side suites reading their OWN default build, not '+TARGET+': '+untargeted.join(', '));
const adminRun=run.filter(f=>ADMIN_READERS.includes(f));
if(adminRun.length)
  console.log('  admin-side suites read admin.html (NOT admin-test.html): '+adminRun.join(', '));
if(untargeted.length||adminRun.length) console.log('');
if(missing.length)  console.log('  ! named in the table but not on disk: '+missing.join(', ')+'\n');
if(unlisted.length) console.log('  ! on disk but in no tier, so never run: '+unlisted.join(', ')+'\n');

const results=[];
for(const f of run){
  const t0=Date.now();
  const argv=[path.join(DIR,f), ...(TIER[f].args||[])];
  if(TARGETABLE.has(f)) argv.push(TARGET_ABS);
  const r=spawnSync('node',argv,{encoding:'utf8', timeout:20*60*1000, maxBuffer:64*1024*1024});
  const ms=Date.now()-t0;
  const out=(r.stdout||'')+(r.stderr||'');
  /* A timeout or a crash has no exit status; treat both as failure and say
     which, because "suite hung" and "suite failed" are different repairs. */
  const how = r.error && r.error.code==='ETIMEDOUT' ? 'TIMEOUT'
            : r.status===0 ? 'PASS'
            : (r.status==null ? 'CRASH' : 'FAIL');
  /* The last non-empty line is every suite's verdict line, by convention. */
  const line=(out.trim().split('\n').filter(x=>x.trim()).pop()||'').replace(/\x1b\[[0-9;]*m/g,'').trim();
  results.push({f, how, ms, line, out});
  const mark = how==='PASS' ? '  ok  ' : '  XX  ';
  console.log(mark+f.padEnd(20)+String(ms+'ms').padStart(8)+'   '+line.slice(0,90));
}

/* ---- COVERAGE DOES NOT SILENTLY SHRINK ------------------------------
   A suite that reports "GREEN 31 passed, 0 failed" where it used to report
   34 has not got better — it has quietly stopped running three checks, and
   every one of those is now unguarded while the line still says GREEN.
   Seen for real on 19 Aug: qa/journey.js reported 34 during one run and 31
   in the next, on identical source, differing only in how loaded the
   machine was. Nothing anywhere would have noticed.

   So the count is remembered. A DROP is reported as a failure; a rise
   updates the baseline, because adding checks is the thing we want. This
   is deliberately a floor and not an equality: suites legitimately gain
   checks, and a gate that goes red when you write a new test is a gate
   people stop running. */
/* KNOWN-VARIABLE SUITES, each for a stated reason. A floor on these would
   be noise, and a noisy gate is one people stop reading — but "we do not
   know why it moves" is not a reason, so anything added here has to come
   with one.

     journey.js     emits some assertions through railOk() at call sites
                    inside conditional blocks, so the total moves with which
                    branches a run takes: 34 idle, 31 under load, identical
                    source. A loaded machine getting LESS coverage is
                    backwards and worth fixing properly.
     live-smoke.js  drives the real https://statsgametime.com/ over the
                    network, so a check can go unrun because something was
                    unreachable rather than because the code changed. Seen
                    10 -> 8 -> 10 within minutes.

   Both should become deterministic and come off this list. Everything else
   is floored. This list should get SHORTER, not longer. */
const COUNT_UNSTABLE=new Set(['journey.js','live-smoke.js']);
const BASE_FILE=path.join(DIR,'.counts.json');
let base={}; try{ base=JSON.parse(fs.readFileSync(BASE_FILE,'utf8')); }catch(_){}
const shrunk=[];
for(const r of results){
  const m=r.line.match(/(\d+)\s+(?:passed|promise\(s\) held|voice grammar cases|checks?)/i)
        || r.line.match(/ALL\s+(\d+)\s+CHECKS/i)
        || r.line.match(/all\s+(\d+)\s+/i);
  if(!m) continue;
  const n=Number(m[1]);
  if(!isFinite(n) || n<=0) continue;
  r.count=n;
  if(COUNT_UNSTABLE.has(r.f)) continue;
  const was=base[r.f];
  if(r.how==='PASS'){
    if(typeof was==='number' && n<was) shrunk.push({f:r.f, was, now:n});
    if(typeof was!=='number' || n>was) base[r.f]=n;
  }
}
if(!process.argv.includes('--no-baseline')){
  try{ fs.writeFileSync(BASE_FILE, JSON.stringify(base,null,2)+'\n'); }catch(_){}
}

const bad=results.filter(r=>r.how!=='PASS');
console.log('\n'+'-'.repeat(62));
if(shrunk.length){
  console.log('COVERAGE SHRANK — these suites ran FEWER checks than they have before:');
  shrunk.forEach(x=>console.log('   ! '+x.f+'  '+x.was+' -> '+x.now+'   ('+(x.was-x.now)+' check(s) did not run; the line still said GREEN)'));
  console.log('');
}
if(!bad.length && !shrunk.length){
  console.log('ALL '+results.length+' SUITES PASS'+(ONLY_STATIC?'  (static only — browser suites not run)':''));
}else if(!bad.length){
  console.log('every suite passed, but coverage shrank — treat as RED until explained');
}else{
  console.log(bad.length+' of '+results.length+' SUITES RED — DO NOT PROMOTE');
  bad.forEach(r=>{
    console.log('\n--- '+r.f+'  ['+r.how+'] ---');
    /* Enough of the tail to act on, not the whole log. */
    console.log(r.out.replace(/\x1b\[[0-9;]*m/g,'').trim().split('\n').slice(-14).map(x=>'    '+x).join('\n'));
  });
}
/* A SUITE ON DISK IN NO TIER IS A FAILURE, NOT A FOOTNOTE.
   This file's own thesis is that a suite nobody runs is not a safety net.
   It then printed exactly that situation as a NOTE and exited 0 — so
   dropping a new, failing suite into qa/ and forgetting the tier entry
   produced a green run. The whole disease, reproduced inside the cure. */
if(unlisted.length){
  console.log('\nUNTIERED SUITES — on disk, in no tier, and therefore never run:');
  unlisted.forEach(f=>console.log('   ! '+f+'   (add it to TIER in qa/all.js)'));
  console.log('   a suite nobody runs is not a safety net; this is a failure, not a note.');
}
if(STAMP_STUCK) console.log('\nBUILD STAMP UNCHANGED — bump STATS_BUILD before promoting.');
process.exit((bad.length||shrunk.length||unlisted.length||STAMP_STUCK)?1:0);
