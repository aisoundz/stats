#!/usr/bin/env node
/* =====================================================================
   Does periodDone still answer the SAME WAY for basketball, and correctly
   for baseball and soccer?
   ---------------------------------------------------------------------
   Added 17 Aug 2026 with the MLB/MLS resolvers. periodDone is the gate that
   decides when a round OPENS, so a regression here does not show up as a
   wrong answer — it shows up as a quarter that never opens, or one that
   opens before the quarter it is asking about has finished. Both cost a
   whole round, and neither throws.

   THE FIRST VERSION OF THIS FILE WAS A FALSE GREEN, and the story is worth
   keeping because it is the third time this trap has been walked into.
   Every per-sport check passed while the baseball gate was deliberately
   rewired to the BASKETBALL one. They passed because every gate starts with
   the same header shortcut — `status.type.completed` and `status.period > p`
   — and a cached payload from a finished game satisfies it. The header was
   answering every question; the sport-specific code underneath was never
   reached, so the checks could not tell the two apart.

   THE FIX, AND THE GENERAL RULE: to test a fallback, remove the thing in
   front of it. Every fixture below has `status` deleted, which forces the
   sport-specific path — baseball's explicit period.type==='End' row, soccer's
   Halftime keyEvent — to be the only thing that can produce an answer.

       node qa/host-sports.js /path/to/fixtures
   ================================================================== */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
/* Same silent-skip as qa/host-overtime.js and qa/host-resolvers.js had:
   no directory, exit ZERO, gate counts it green. It also pointed at
   references/multisport/multi.sh, a script that has never existed in this
   repo — so following the instruction could not have helped either. The
   fetcher that does exist is references/multisport/fetch.js. */
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
const START = '/* @host-shared:start', END = '/* @host-shared:end */';
const block = src.slice(src.indexOf(START), src.indexOf(END) + END.length);
const ctx = vm.createContext({ console, fetch: () => { throw new Error('no network'); } });
vm.runInContext(block, ctx, { filename: 'host-shared' });
const AUTO = ctx.AUTO;

let fail = 0;
const ok = (id) => console.log(`  \x1b[32m✓\x1b[0m ${id}`);
const bad = (id, why) => { fail++; console.log(`  \x1b[31m✗ ${id}\x1b[0m — ${why}`); };
const check = (id, cond, why) => cond ? ok(id) : bad(id, why);
const load = (f) => { const p = path.join(DIR, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const clone = (j) => JSON.parse(JSON.stringify(j));

/* Remove the header shortcut. Without this every check below passes for the
   wrong reason — see the note at the top of this file. */
function blind(j) {
  const c = clone(j);
  try { delete c.header.competitions[0].status; } catch (_) {}
  return c;
}

/* ---- the sport is read off the feed, not a config -------------------
   Tested per PATH, not just per outcome. The first version only asserted
   the answer, so knocking out the primary gp_topic read changed nothing —
   the league.slug fallback silently covered for it. Both are now exercised
   on their own, and so is the give-up case. */
console.log('\nsport detection');
const cases = [['wnba.json', 'basketball'], ['mlb.json', 'baseball'], ['mls.json', 'soccer']];
for (const [f, want] of cases) {
  const j = load(f);
  if (!j) { console.log(`  – ${f} absent, skipped`); continue; }
  check(`sport.${want}-from-gp-topic`, AUTO.sportOf(j) === want,
    `sportOf() said "${AUTO.sportOf(j)}", wanted "${want}"`);
  const noMeta = clone(j); delete noMeta.meta;
  check(`sport.${want}-still-read-from-league-slug`, AUTO.sportOf(noMeta) === want,
    `with meta removed sportOf() said "${AUTO.sportOf(noMeta)}" — the slug fallback is broken`);
}
{
  const j = load('mlb.json');
  if (j) {
    const nothing = clone(j); delete nothing.meta;
    try { delete nothing.header.league; } catch (_) {}
    check('sport.unknown-is-empty-not-a-guess', AUTO.sportOf(nothing) === '',
      `with no meta and no league sportOf() returned "${AUTO.sportOf(nothing)}" instead of ''`);
  }
}

/* ---- BASKETBALL MUST NOT HAVE MOVED. This is the GN12 guard. --------
   The old body is still in the file as bballPeriodDone. If the dispatcher
   ever answers differently from it on a basketball feed, the refactor
   changed behaviour and that is a regression whatever else is true.
   Run blind as well as intact, so the comparison covers the fallback path
   and not only the header. */
console.log('\nbasketball did not move (the guard on the night that is already scheduled)');
{
  const j = load('wnba.json');
  if (!j) console.log('  – wnba.json absent, skipped');
  else {
    for (const [label, feed] of [['intact', j], ['blind', blind(j)]]) {
      let same = true, detail = '';
      for (let p = 1; p <= 5; p++) {
        const a = AUTO.periodDone(feed, p), b = AUTO.bballPeriodDone(feed, p);
        if (a !== b) { same = false; detail += ` p${p}: dispatch=${a} old=${b}`; }
      }
      check(`host.basketball-gate-unchanged-${label}`, same, `they disagree —${detail}`);
    }
  }
}

/* ---- baseball: the explicit End row, with the header taken away ------ */
console.log('\nbaseball innings (header removed, so only the End row can answer)');
{
  const j = load('mlb.json');
  if (!j) console.log('  – mlb.json absent, skipped');
  else {
    const done = blind(j);
    check('host.mlb-finished-inning-is-done', AUTO.periodDone(done, 3) === true,
      'inning 3 read as not done with an End row present — period.type is not being read');

    const mid = blind(j);
    mid.plays = j.plays.filter(x => x.period.number < 3 || (x.period.number === 3 && x.period.type !== 'End'));
    check('host.mlb-inning-in-progress-is-not-done', AUTO.periodDone(mid, 3) === false,
      'an unfinished inning read as done — a round would open early');
    check('host.mlb-earlier-inning-still-done', AUTO.periodDone(mid, 2) === true,
      'a finished earlier inning read as not done — that round never opens');

    /* THE DISCRIMINATING CASE, and the first version of it was WRONG in a way
       worth recording. It asserted that the basketball gate must answer false
       on a baseball feed. It does not: baseball's End-Inning rows carry the
       text "End of the 3rd inning", which basketball's
       /end of (the )?(1st|2nd|3rd|4th|\d)/i matches exactly. The two gates
       genuinely agree on a real payload, so the assertion was asserting
       something false and failed on correct code.

       What is actually worth guarding is that mlbInningDone reads the FIELD
       (period.type==='End') and not the prose — because the prose is ESPN's
       to reword without telling anyone, and the field is the contract. So
       blank the text and keep the field: the baseball gate must still say
       done, and the basketball gate, having nothing left to match, must not.
       That is a difference that only exists if the routing is real. */
    const noProse = blind(j);
    noProse.plays = j.plays.map(x => Object.assign({}, x, { text: '' }));
    check('host.mlb-reads-the-end-field-not-the-prose',
      AUTO.periodDone(noProse, 3) === true && AUTO.bballPeriodDone(noProse, 3) === false,
      `with play text blanked dispatch=${AUTO.periodDone(noProse, 3)} bball=${AUTO.bballPeriodDone(noProse, 3)} — the baseball gate must survive on the field alone while the text-matching one cannot`);
  }
}

/* ---- soccer: no plays array at all, header taken away --------------- */
console.log('\nsoccer halves (header removed, so only keyEvents can answer)');
{
  const j = load('mls.json');
  if (!j) console.log('  – mls.json absent, skipped');
  else {
    check('host.mls-has-no-plays-array', (j.plays || []).length === 0,
      'this fixture HAS plays — the soccer resolvers assume none, re-probe before trusting them');

    const done = blind(j);
    check('host.mls-finished-half-is-done', AUTO.periodDone(done, 1) === true,
      'halftime read as not done with a Halftime event present');
    check('host.mls-full-time-is-done', AUTO.periodDone(done, 2) === true,
      'full time read as not done with an End Regular Time event present');

    const live = blind(j);
    live.keyEvents = j.keyEvents.filter(e => !/halftime|end regular time/i.test(e.type.text));
    check('host.mls-first-half-in-play-is-not-done', AUTO.periodDone(live, 1) === false,
      'a first half still being played read as done — the halftime round would open mid-half');

    /* Same discriminating shape as baseball. Soccer has no plays at all, so
       the basketball gate is structurally incapable of answering true here. */
    check('host.mls-is-not-answered-by-the-basketball-gate',
      AUTO.periodDone(done, 1) === true && AUTO.bballPeriodDone(done, 1) === false,
      `dispatch=${AUTO.periodDone(done, 1)} bball=${AUTO.bballPeriodDone(done, 1)} — these must differ`);
  }
}

/* ---- the wrong-sport trap that used to be silent -------------------- */
console.log('\nthe feed path is a parameter');
check('host.sum-url-honours-its-argument', AUTO.sumUrl('baseball/mlb').indexOf('/baseball/mlb/') > 0,
  'sumUrl() ignored its argument — this is the silent wrong-sport fetch');
check('host.sum-url-keeps-its-default', AUTO.sumUrl().indexOf('/basketball/wnba/') > 0,
  'sumUrl() lost its default — existing callers that pass nothing would break');

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
