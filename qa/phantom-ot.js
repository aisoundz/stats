#!/usr/bin/env node
/* ============ AN OVERTIME NOBODY PLAYED =============================
   Nationals at Rangers, 20 August 2026, ended in nine innings. At
   02:30:29.048Z the runner opened the 7th-9th round. At 02:30:29.285Z —
   237 milliseconds later — it opened a second round worth 70 points,
   tagged OT, named "Extra innings", and one player answered it. Seventy
   points is a third of that night's regulation total (30+50+70), awarded
   for innings that do not exist.

   The founder wrote it down the same night: "It said extra innings is
   live when extra innings was not live for baseball."

   A guard for exactly this had been written the night before, and it
   could never fire. The overtime slot was only created for periods
   `per <= AUTO.maxPeriodIn(sum)`, and the guard then refused any slot
   with `per > playedTo`, where `playedTo` was AUTO.maxPeriodIn(sum). The
   same number on both sides. It was not a weak check, it was a check
   that asserted 10 <= 10 and could not be false — which is worse than no
   check, because the absence of a guard is visible and a vacuous one
   reads as a solved problem.

   The cause is that maxPeriodIn takes the HIGHER of the header's
   status.period and the plays' own period numbers. status.period is a
   scoreboard field and it can read past the last period actually played.
   When it does, the slot loop manufactures an overtime out of it.

   So this suite drives the REAL roundSlots() from host/run.js against
   feeds where the scoreboard and the plays DISAGREE, which is the one
   condition the old guard could not represent.

   Usage: node qa/phantom-ot.js
*/
const path = require('path');
const { loadShared, roundSlots } = require(path.join(__dirname, '..', 'host', 'run.js'));

let pass = 0, fail = 0;
function ok(name, cond, detail){
  if(cond){ pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m\n      ' + (detail || '')); }
}

/* A baseball summary in the shape AUTO reads: MLB plays carry
   period.number = the inning. `upTo` innings of real plays, and a
   scoreboard that claims `says`. */
function mlbSummary(upTo, says){
  const plays = [];
  for(let i = 1; i <= upTo; i++)
    for(let k = 0; k < 6; k++)
      plays.push({ id: 'p' + i + '-' + k, period: { number: i }, text: 'a pitch' });
  return {
    header: { competitions: [ {
      status: { period: says, type: { completed: true, name: 'STATUS_FINAL' } },
      competitors: [
        { homeAway:'home', team:{ abbreviation:'TEX', displayName:'Rangers' }, score:'2' },
        { homeAway:'away', team:{ abbreviation:'WSH', displayName:'Nationals' }, score:'0' } ]
    } ], league: { slug: 'mlb', name: 'Major League Baseball' } },
    /* sportOf() reads meta.gp_topic FIRST and header.league.slug second.
       The first version of this fixture set neither, so familyOf() fell
       through to its 'basketball' default — otFrom 5 instead of 10 — and
       the suite reported overtime rounds for innings 5 through 9. That was
       the fixture lying, not the runner; but it is exactly what a real feed
       missing gp_topic would have done, which is why sportOf now knows
       every league by slug too. Both fields are set here deliberately. */
    meta: { gp_topic: 'gp-baseball-mlb-401816609' },
    plays
  };
}
/* The plan as host/publish.js writes it for a baseball night: three
   rounds over nine innings, plus ONE authored overtime template. */
const PLAN = {
  rounds: [
    /* Nine rounds now, but this suite is about OT SLOT SUPPRESSION, not the
       regulation shape — three entries still exercise it and mapping them
       onto innings 1-3 is honest about what they are. Tags updated so the
       fixture stops describing a retired structure. */
    { tag:'1st', name:'1st inning', worth:20, qs:[{t:'q',o:['a','b']}] },
    { tag:'2nd', name:'2nd inning', worth:20, qs:[{t:'q',o:['a','b']}] },
    { tag:'3rd', name:'3rd inning', worth:30, qs:[{t:'q',o:['a','b']}] }
  ],
  ot: { worth:70, qs:[{t:'Extra innings q',o:['a','b']}] }
};

console.log('\n  PHANTOM OVERTIME — a round for innings nobody played\n');

const AUTO = loadShared();
const otSlots = s => s.filter(x => x.ot > 0 && !!x.def);

/* ---- 1. THE BUG, REPRODUCED ----------------------------------------
   Nine innings of plays, a scoreboard claiming the tenth. */
{
  const slots = roundSlots(AUTO, mlbSummary(9, 10), PLAN);
  ok('phantom-ot.a-scoreboard-past-the-plays-opens-no-overtime',
     otSlots(slots).length === 0,
     `the feed has plays through the 9th and status.period = 10, and roundSlots produced ` +
     `${otSlots(slots).length} overtime round(s): ` +
     JSON.stringify(otSlots(slots).map(x => ({per:x.per, tag:x.def && x.def.tag, worth:x.def && x.def.worth}))) +
     `. This is 20 Aug exactly — a 70-point "Extra innings" round in a nine-inning game.`);

  ok('phantom-ot.and-the-three-real-rounds-survive',
     slots.filter(x => !!x.def).length === 3,
     `the three authored rounds must be untouched; got ` +
     JSON.stringify(slots.filter(x => !!x.def).map(x => x.def.tag)) +
     `. A fix that suppresses the phantom by suppressing everything is not a fix.`);
}

/* ---- 2. A REAL EXTRA INNING MUST STILL PAY -------------------------
   The whole risk of the fix above is that it silences genuine overtime.
   Ten innings of real plays: the tenth is real and must open. */
{
  const slots = roundSlots(AUTO, mlbSummary(10, 10), PLAN);
  ok('phantom-ot.a-real-extra-inning-still-opens',
     otSlots(slots).length === 1 && otSlots(slots)[0].per === 10,
     `with pitches actually thrown in the 10th, exactly one overtime round must open for ` +
     `period 10; got ` + JSON.stringify(otSlots(slots).map(x => x.per)) +
     `. Refusing to pay a real extra inning is the same failure wearing the other face.`);

  ok('phantom-ot.the-real-one-is-worth-what-the-template-says',
     (otSlots(slots)[0] || {}).def && otSlots(slots)[0].def.worth === 70,
     `the authored template says 70; got ${JSON.stringify((otSlots(slots)[0]||{}).def)}`);
}

/* ---- 3. TWO EXTRA INNINGS, TWO ROUNDS ------------------------------ */
{
  const slots = roundSlots(AUTO, mlbSummary(11, 11), PLAN);
  ok('phantom-ot.two-played-extra-innings-open-two-rounds',
     otSlots(slots).length === 2,
     `eleven innings played must give two overtime rounds; got ` +
     JSON.stringify(otSlots(slots).map(x => x.per)));
}

/* ---- 4. THE SCOREBOARD RUNNING FAR AHEAD ---------------------------
   Not a one-period overshoot but a wild one, which is what a stuck or
   mis-parsed status field looks like. Nothing may open. */
{
  const slots = roundSlots(AUTO, mlbSummary(9, 14), PLAN);
  ok('phantom-ot.a-wildly-wrong-scoreboard-opens-nothing',
     otSlots(slots).length === 0,
     `status.period = 14 against nine innings of plays produced ` +
     `${otSlots(slots).length} overtime round(s) — one per imagined inning is how a single bad ` +
     `field becomes five rounds nobody can answer.`);
}

/* ---- 5. THE GUARD IS NO LONGER VACUOUS -----------------------------
   The property that failed on 20 Aug, asserted directly: the two numbers
   the runner compares must be able to disagree. */
{
  const sum = mlbSummary(9, 10);
  const byPlays  = AUTO.playedPeriodMax(sum);
  const byEither = AUTO.maxPeriodIn(sum);
  ok('phantom-ot.the-two-signals-can-disagree',
     byPlays === 9 && byEither === 10,
     `playedPeriodMax=${byPlays} and maxPeriodIn=${byEither}. The guard compares a slot's period ` +
     `against playedTo; if playedTo comes from the same call that created the slot, the ` +
     `comparison is 10 <= 10 and can never be false. These must be independent readings.`);
}

console.log('\n  ' + (fail ? '\x1b[31mRED' : '\x1b[32mGREEN') + '  ' + pass + ' passed, ' + fail + ' failed\x1b[0m\n');
process.exit(fail ? 1 : 0);
