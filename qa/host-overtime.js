#!/usr/bin/env node

/* ============ AN OVERTIME WITH PITCHES IN IT =========================
   These fixtures used to raise status.period and stop there, which
   describes a scoreboard rather than a game. As of 21 Aug the runner
   refuses to open an overtime round for a period the PLAYS do not reach,
   because on 20 Aug a scoreboard reading past the ninth inning produced a
   70-point "Extra innings" round in a game that ended in regulation.

   So a fixture that means "this game went to double overtime" now has to
   say so the way a real feed says it: with plays in that period. Raising
   the number alone is the bug, not the setup. */
function playedThrough(j, upTo, per){
  var list = Array.isArray(j.plays) ? j.plays : (j.plays = []);
  for(var p = per; p <= upTo; p++)
    for(var k = 0; k < 3; k++)
      list.push({ id: 'fx-' + p + '-' + k, period: { number: p }, text: 'a play in period ' + p });
  return j;
}
/* =====================================================================
   Every overtime period gets its own round — does it?
   ---------------------------------------------------------------------
   Founder's call 17 Aug 2026, extending the GN11 decision to all six
   sports. Overtime was structurally invisible to the runner's round loop
   for eleven game nights, and the failure was silent: the scoreboard said
   "OT in progress" while there was nothing to answer.

   Checks the tag a player would SEE (a "Q1" over a hockey overtime is a
   screen that lies), the round plan the runner walks, and the overtime
   price. Real feeds where available, synthetic period numbers for the
   overtimes no cached fixture happens to contain.

       node qa/host-overtime.js /path/to/fixtures
   ================================================================== */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
/* DEFAULT TO THE FIXTURES IN THE REPO, AND SAY SO WHEN THEY ARE MISSING.
   This used to be `|| ''` followed by a silent `process.exit(0)`, so for
   the whole life of this file it printed "no fixtures dir — skipping" and
   returned SUCCESS. Every gate run counted it as a pass. The suite that
   checks 84 resolvers and every overtime path had never once executed, and
   nothing anywhere said so out loud — the exit code said the opposite.
   Now: the repo's own fixtures are the default, and their absence is a
   FAILURE, because "I could not check" and "I checked and it is fine" are
   not the same sentence. */
const DEFAULT_FIX = path.join(ROOT, 'references', 'multisport');
/* argv MINUS the --file pair. Without this, passing `--file admin-test.html`
   makes argv[2] the literal string "--file" and the fixtures directory below
   resolves to nonsense — the suite then fails for a reason that has nothing
   to do with the banks. Caught by a negative control, not by reading. */
const ADMIN_ARGV = (function(){ const a = process.argv.slice(2), i = a.indexOf('--file');
  if(i >= 0) a.splice(i, a[i + 1] ? 2 : 1); return a; })();
const DIR = ADMIN_ARGV[0] || process.env.SPORT_FIXTURES || DEFAULT_FIX;
/* EVERY FIXTURE, NOT JUST THE FOLDER. Requiring only the directory was
   half a fix: deleting nfl.json alone took qa/host-resolvers.js from 65
   checks to 27 and it still printed a green verdict, because each league
   block quietly prints "absent — skipped" and moves on. A fixture set that
   can lose a file and stay green is the same disease as a suite that can
   lose its whole directory and stay green — just quieter. */
const NEED = ['wnba.json','nba.json','mlb.json','nfl.json','nhl.json','mls.json'];
if (!fs.existsSync(DIR)) {
  console.log('NO FIXTURES at ' + DIR);
  console.log('  run:  node references/multisport/fetch.js');
  console.log('  (reporting this as a FAILURE — a check that cannot run has not passed)');
  process.exit(1);
}
{
  const missing = NEED.filter(f => !fs.existsSync(path.join(DIR, f)));
  if (missing.length) {
    console.log('INCOMPLETE FIXTURES at ' + DIR);
    missing.forEach(f => console.log('  missing: ' + f + '   (its checks would be skipped, not failed)'));
    console.log('  run:  node references/multisport/fetch.js');
    process.exit(1);
  }
}

/* WHICH BUILD THIS GRADES. Defaults to admin.html — what host/run.js
   actually reads — so running this suite by hand is unchanged. qa/all.js
   passes `--file admin-test.html` during a gate, so the gate grades what is
   about to ship instead of what already shipped. Same flag and shape as
   host-block.js, which already did this correctly.

   Before this, SIX admin suites hardcoded admin.html, so the full gate
   silently graded the OLD banks: a bank change could pass a green gate
   having never once been read by it. Found 25 Aug. Named flag, not
   positional, because argv[2] is already spoken for in these suites. */
const ADMIN_FILE = (function(){ const a = process.argv.slice(2), i = a.indexOf('--file');
  return (i >= 0 && a[i + 1]) ? a[i + 1] : 'admin.html'; })();
const src = fs.readFileSync(path.join(ROOT, ADMIN_FILE), 'utf8');
const S = '/* @host-shared:start', E = '/* @host-shared:end */';
const ctx = vm.createContext({ console, fetch: () => { throw new Error('no net'); } });
vm.runInContext(src.slice(src.indexOf(S), src.indexOf(E) + E.length), ctx, { filename: 'hs' });
const A = ctx.AUTO;

let fail = 0;
const ok = id => console.log(`  \x1b[32m✓\x1b[0m ${id}`);
const bad = (id, why) => { fail++; console.log(`  \x1b[31m✗ ${id}\x1b[0m — ${why}`); };
const eq = (id, got, want) => got === want ? ok(id) : bad(id, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
const same = (id, got, want) => JSON.stringify(got) === JSON.stringify(want) ? ok(id) : bad(id, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
const load = f => { const p = path.join(DIR, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };

/* ---- the tag a player sees, per sport ------------------------------- */
console.log('\nthe tag on the card');
const tagCases = [
  ['wnba.json', 1, 'Q1'], ['wnba.json', 4, 'Q4'], ['wnba.json', 5, 'OT'], ['wnba.json', 6, 'OT2'], ['wnba.json', 7, 'OT3'],
  ['nba.json',  4, 'Q4'], ['nba.json',  5, 'OT'],
  ['nfl.json',  4, 'Q4'], ['nfl.json',  5, 'OT'],
  ['nhl.json',  1, '1st'], ['nhl.json', 3, '3rd'], ['nhl.json', 4, 'OT'], ['nhl.json', 5, 'OT2'],
  ['mlb.json',  3, '1st-3rd'], ['mlb.json', 6, '4th-6th'], ['mlb.json', 9, '7th-9th'],
  ['mlb.json', 10, 'OT'], ['mlb.json', 11, 'OT2'],
  ['mls.json',  1, '1H'], ['mls.json', 2, 'FT'],
];
for (const [f, p, want] of tagCases) {
  const j = load(f);
  if (!j) { console.log(`  – ${f} absent`); continue; }
  eq(`tag.${f.replace('.json','')}.p${p}`, A.roundTagFor(j, p), want);
}

/* ---- overtime is counted from the right period, per sport ----------- */
console.log('\novertime starts where the sport says, not at 5');
for (const [f, reg, firstOT] of [['wnba.json',4,5], ['nba.json',4,5], ['nfl.json',4,5], ['nhl.json',3,4], ['mlb.json',9,10]]) {
  const j = load(f); if (!j) { console.log(`  – ${f} absent`); continue; }
  eq(`ot.${f.replace('.json','')}.regulation-is-${reg}`, A.regulationPeriods(j), reg);
  eq(`ot.${f.replace('.json','')}.p${reg}-is-not-overtime`, A.otIndexOf(j, reg), 0);
  eq(`ot.${f.replace('.json','')}.p${firstOT}-is-first-overtime`, A.otIndexOf(j, firstOT), 1);
}
{
  const j = load('mls.json');
  if (j) {
    /* MLS regular season plays no extra time. A sport with otFrom 0 must
       never report an overtime, or the runner would look for a template
       that should not exist. */
    eq('ot.mls.never-has-overtime', A.otIndexOf(j, 3), 0);
    eq('ot.mls.wentToOvertime-false', A.wentToOvertime(j), false);
  }
}

/* ---- the round plan the runner walks ------------------------------- */
console.log('\nthe round plan grows with the game');
{
  const w = load('wnba.json');
  if (w) {
    same('plan.basketball.regulation', A.roundPeriodsFor(w, 4), [1,2,3,4]);
    same('plan.basketball.one-ot',     A.roundPeriodsFor(w, 5), [1,2,3,4,5]);
    same('plan.basketball.triple-ot',  A.roundPeriodsFor(w, 7), [1,2,3,4,5,6,7]);
  }
  const m = load('mlb.json');
  if (m) {
    /* Baseball's rounds are the 3rd, 6th and 9th — NOT one per inning. Extra
       innings then get one round each, which is the founder's call applied
       to a sport whose regulation rounds already span three periods. */
    same('plan.baseball.regulation',   A.roundPeriodsFor(m, 9),  [3,6,9]);
    same('plan.baseball.tenth-inning', A.roundPeriodsFor(m, 10), [3,6,9,10]);
    same('plan.baseball.twelfth',      A.roundPeriodsFor(m, 12), [3,6,9,10,11,12]);
  }
  const h = load('nhl.json');
  if (h) {
    same('plan.hockey.regulation', A.roundPeriodsFor(h, 3), [1,2,3]);
    same('plan.hockey.one-ot',     A.roundPeriodsFor(h, 4), [1,2,3,4]);
  }
  const s = load('mls.json');
  if (s) same('plan.soccer.two-rounds-and-no-more', A.roundPeriodsFor(s, 5), [1,2]);
}

/* ---- real feeds: the games that actually went past regulation ------- */
console.log('\nreal games that went past regulation');
{
  const h = load('nhl.json');
  if (h) {
    /* DERIVE THE EXPECTATION FROM THE FIXTURE, DO NOT PIN IT TO ONE GAME.
       These three lines used to hardcode "period 4" and "[1,2,3,4]", i.e.
       single overtime. The fixture is whatever finished NHL overtime game
       the fetcher found, and the first one that happened to be a DOUBLE
       overtime turned all three red while the code was right — a plan of
       [1,2,3,4,5] is the correct answer for a game that played five
       periods. A test that fails when the input gets MORE interesting is a
       test that teaches you to swap the input, which is the opposite of
       what it is for. What must hold for any overtime game: it reached at
       least the first overtime, the plan is every period from 1 to the
       last with no gaps, and each overtime period is tagged as one. */
    const mx = A.maxPeriodIn(h);
    const REG_NHL = 3;
    eq('real.nhl.reached-overtime', mx > REG_NHL, true);
    eq('real.nhl.wentToOvertime', A.wentToOvertime(h), true);
    const wantPlan = Array.from({length: mx}, (_, i) => i + 1);
    same('real.nhl.plan-covers-every-period', A.roundPeriodsFor(h, mx), wantPlan);
    eq('real.nhl.ot-round-is-tagged-OT', A.roundTagFor(h, 4), 'OT');
    /* A second overtime, when the fixture has one, must not be tagged "OT"
       as well — two rounds with the same name is the GN11 shape. */
    if (mx >= 5) eq('real.nhl.second-ot-is-tagged-OT2', A.roundTagFor(h, 5), 'OT2');
    /* And the gate must agree that the OT period finished, or a round would
       open and never close. This is the "End of OT" row, which carries no
       digit and is invisible to the basketball regex. */
    eq('real.nhl.ot-period-reads-done', A.periodDone(h, mx), true);
  }
  /* Football's plays are nested in drives, so maxPeriodIn has to go through
     feedPlays() — a naive j.plays read finds nothing and would report period
     0, which would silently mean "no rounds at all". */
  const n = load('nfl.json');
  if (n) eq('real.nfl.maxPeriod-sees-through-drives', A.maxPeriodIn(n) >= 4, true);
}

/* ---- what an overtime round is worth ------------------------------- */
console.log('\novertime price continues the regulation ramp');
{
  const w = load('wnba.json');
  if (w) {
    eq('worth.ot-continues-10-20-30-40', A.otWorthFor(w, 5, [10,20,30,40]), 50);
    eq('worth.ot2-one-step-further',     A.otWorthFor(w, 6, [10,20,30,40]), 60);
    eq('worth.regulation-has-no-ot-price', A.otWorthFor(w, 4, [10,20,30,40]), null);
    /* A flat regulation ramp has no step to continue; fall back to the last
       value rather than returning 0, which would make overtime free. */
    eq('worth.flat-ramp-does-not-make-ot-free', A.otWorthFor(w, 5, [25,25]), 50);
    eq('worth.no-ramp-given-still-prices-it', A.otWorthFor(w, 5, []) > 0, true);
  }
  const m = load('mlb.json');
  if (m) eq('worth.baseball.tenth-inning-priced', A.otWorthFor(m, 10, [30,50,70]) > 70, true);
}


/* =====================================================================
   The RUNNER's own round list — exercising run.js's roundSlots(), not a
   copy of it. run.js exports it precisely so this test cannot drift from
   the thing it tests.
   ================================================================== */
const { roundSlots } = require(path.join(ROOT, 'host/run.js'));

console.log('\nthe runner walks a round list that grows');
{
  const w = load('wnba.json');
  if (w) {
    const plan4 = { rounds: [ {tag:'Q1',name:'Quarter 1',worth:10,qs:[{t:'a',o:['x']}]},
                              {tag:'Q2',name:'Quarter 2',worth:20,qs:[{t:'a',o:['x']}]},
                              {tag:'Q3',name:'Quarter 3',worth:30,qs:[{t:'a',o:['x']}]},
                              {tag:'Q4',name:'Quarter 4',worth:40,qs:[{t:'a',o:['x']}]} ] };
    /* THE WNBA FIXTURE IS GAME NIGHT 11, WHICH WENT TO OVERTIME — and that
       is the whole point, so it gets asserted rather than worked around.
       GN11 is the night that exposed this gap: it ran fully unattended
       through an overtime that had no round behind it. The same feed now
       produces a fifth slot tagged OT. The first version of this test
       expected four slots and failed; the expectation was wrong, not the
       code. */
    eq('runner.gn11-really-went-to-overtime', A.wentToOvertime(w), true);
    const gn11 = roundSlots(A, w, Object.assign({ ot: { qs: [{t:'q',o:['x']}] } }, plan4));
    eq('runner.gn11-now-has-a-fifth-round', gn11.length, 5);
    eq('runner.gn11-fifth-round-is-tagged-OT', gn11[4].def.tag, 'OT');
    eq('runner.gn11-fifth-round-is-overtime-1', gn11[4].ot, 1);

    /* Regulation only, forced to period 4: four slots, each its own period. */
    const regFeed = JSON.parse(JSON.stringify(w));
    regFeed.plays = (w.plays || []).filter(p => Number((p.period || {}).number) <= 4);
    regFeed.header.competitions[0].status = { period: 4, type: { completed: true } };
    const reg = roundSlots(A, regFeed, plan4);
    eq('runner.regulation-slot-count', reg.length, 4);
    same('runner.regulation-periods', reg.map(s => s.per), [1,2,3,4]);
    eq('runner.regulation-has-no-ot', reg.every(s => s.ot === 0), true);

    /* Overtime with NO template: the slot still exists, so the runner can
       see it and complain, but it carries no questions and must never be
       opened. A missing slot would be a silent skip. */
    const otFeed = JSON.parse(JSON.stringify(w));
    otFeed.header.competitions[0].status = { period: 6, type: { completed: true } };
    playedThrough(otFeed, 6, 5);         // two overtimes, both with plays in them
    const noTpl = roundSlots(A, otFeed, plan4);
    eq('runner.two-overtimes-appear-as-slots', noTpl.length, 6);
    eq('runner.ot-without-a-template-has-no-questions', noTpl[4].def, null);
    eq('runner.ot-slot-knows-which-overtime-it-is', noTpl[5].ot, 2);

    /* Overtime WITH a template: instantiated per period, tagged OT / OT2,
       and priced by continuing the regulation ramp. */
    const withTpl = roundSlots(A, otFeed, Object.assign({ ot: { qs: [{t:'q',o:['x','y']}] } }, plan4));
    eq('runner.ot1-is-tagged-OT',  withTpl[4].def.tag, 'OT');
    eq('runner.ot2-is-tagged-OT2', withTpl[5].def.tag, 'OT2');
    eq('runner.ot1-priced-past-Q4', withTpl[4].def.worth, 50);
    eq('runner.ot2-priced-past-OT1', withTpl[5].def.worth, 60);
    eq('runner.ot-reuses-the-published-questions', withTpl[4].def.qs.length, 1);
    /* An authored worth in the template always beats the computed ramp. */
    const authored = roundSlots(A, otFeed, Object.assign({ ot: { worth: 15, qs: [{t:'q',o:['x']}] } }, plan4));
    eq('runner.authored-ot-worth-wins', authored[4].def.worth, 15);
  }

  /* BASEBALL IS THE ONE THAT CAUGHT A REAL BUG. The loop used to call the
     gate with `i + 1`, so round 0 asked whether the FIRST inning was over.
     Baseball's rounds are the 3rd, 6th and 9th. */
  const m = load('mlb.json');
  if (m) {
    const plan3 = { rounds: [ {tag:'1st-3rd',worth:30,qs:[{t:'a',o:['x']}]},
                              {tag:'4th-6th',worth:50,qs:[{t:'a',o:['x']}]},
                              {tag:'7th-9th',worth:70,qs:[{t:'a',o:['x']}]} ] };
    /* CLAMP TO NINE FIRST. This check is about the REGULATION mapping —
       three rounds landing on the 3rd, 6th and 9th — and the fixture is now
       deliberately an extra-innings game (a regulation feed cannot exercise
       an overtime path at all). Against a tenth inning the correct answer
       becomes [3,6,9,10], which is the extras feature working, so asserting
       [3,6,9] on the raw feed tested the fixture rather than the mapping.
       Same technique the WNBA regulation case above already uses. */
    const reg9 = JSON.parse(JSON.stringify(m));
    /* THE PLAYS TOO, NOT JUST THE STATUS. maxPeriodIn reads the plays, so a
       status clamped to 9 over a feed still carrying tenth-inning plays
       still produced a tenth round — the clamp looked applied and was not.
       The WNBA regulation case above filters both for exactly this reason. */
    reg9.plays = (m.plays || []).filter(p => Number((p.period || {}).number) <= 9);
    reg9.header.competitions[0].status = { period: 9, type: { completed: true } };
    const bs = roundSlots(A, reg9, plan3);
    same('runner.baseball-rounds-map-to-innings-3-6-9', bs.map(s => s.per), [3,6,9]);
    /* And the extra innings the fixture really has DO grow the plan — the
       other half of the same fact, asserted on the unclamped feed. */
    const bx = roundSlots(A, m, Object.assign({ ot: { qs: [{t:'q',o:['x']}] } }, plan3));
    eq('runner.real-extra-innings-grow-the-plan', bx.length > 3, true);
    const ext = JSON.parse(JSON.stringify(m));
    ext.header.competitions[0].status = { period: 11, type: { completed: true } };
    playedThrough(ext, 11, 10);          // two extra innings that were actually played
    const be = roundSlots(A, ext, Object.assign({ ot: { qs: [{t:'q',o:['x']}] } }, plan3));
    same('runner.eleven-innings-adds-two-rounds', be.map(s => s.per), [3,6,9,10,11]);
    eq('runner.tenth-inning-tagged-OT', be[3].def.tag, 'OT');
  }

  /* AUTHORED OVERTIME AND THE TEMPLATE MUST NOT BOTH FIRE.
     A night config may list five tags (Q1..Q4, OT), which the existing Write
     tab renders and publishPlan publishes as rounds[4] on period 5. The
     template used to append a SECOND round for period 5 — same overtime,
     two rounds, both scoring, paid twice. Authored wins; the template fills
     only the periods nothing covers. */
  if (w) {
    const q = [{t:'a',o:['x']}];
    const plan5 = { rounds: [ {tag:'Q1',worth:10,qs:q}, {tag:'Q2',worth:20,qs:q},
                              {tag:'Q3',worth:30,qs:q}, {tag:'Q4',worth:40,qs:q},
                              {tag:'OT',worth:50,qs:q} ], ot: { qs: q } };
    const five = roundSlots(A, w, plan5);
    eq('runner.authored-ot-is-not-duplicated', five.length, 5);
    same('runner.authored-ot-periods', five.map(s => s.per), [1,2,3,4,5]);
    eq('runner.authored-ot-keeps-its-own-worth', five[4].def.worth, 50);
    /* ...and a SECOND overtime still gets one from the template. */
    const ot2 = JSON.parse(JSON.stringify(w));
    ot2.header.competitions[0].status = { period: 6, type: { completed: true } };
    playedThrough(ot2, 6, 5);
    const six = roundSlots(A, ot2, plan5);
    eq('runner.template-fills-only-the-gap', six.length, 6);
    eq('runner.gap-filled-round-is-OT2', six[5].def.tag, 'OT2');
  }

  /* Soccer must never grow a third round however the feed reads. */
  const s = load('mls.json');
  if (s) {
    const plan2 = { rounds: [ {tag:'1H',worth:30,qs:[{t:'a',o:['x']}]},
                              {tag:'FT',worth:50,qs:[{t:'a',o:['x']}]} ] };
    const sf = JSON.parse(JSON.stringify(s));
    sf.header.competitions[0].status = { period: 4, type: { completed: true } };
    eq('runner.soccer-never-grows-a-third-round', roundSlots(A, sf, plan2).length, 2);
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
