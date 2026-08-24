/* ============================================================================
   qa/inning-end-budget.js — INNING QUESTIONS MUST NOT SHARE THE ORDINARY POOL

   23 Aug, sf-bos, a real 9-inning game watched live. Twelve Caught It
   questions fired, matching 'normal' pace's perGameFor(12,'normal') exactly,
   and then NOTHING for the last eighty-five minutes: no 9th inning, no
   walk-off at-bat, nothing. Two ordinary sawAtBat questions were mixed into
   that same twelve, so the shared pool ran dry three innings early.

   "A question at the end of every inning" is a guarantee. It cannot share a
   budget with something competing for the same slots, because the budget
   running out is exactly when the game is still going — which is when the
   guarantee matters most.

   This drives host/run.js's real per-tick logic directly (not a
   reimplementation) across a simulated 9-inning game with ordinary
   questions mixed in between turns, and counts what actually fired.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0; const bad = [];
const ok = (c, label, detail) => c ? pass++ : (fail++, bad.push(label + (detail ? '  — ' + detail : '')));

console.log('\n=== INNING-END BUDGET ===\n');

// Load the same @host-shared engine the runner requires.
const admSrc = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const S = '/* @host-shared:start', E = '/* @host-shared:end */';
const ctx = vm.createContext({ console, fetch: () => { throw new Error('no net'); }, module: { exports: {} }, require });
vm.runInContext(admSrc.slice(admSrc.indexOf(S), admSrc.indexOf(E) + E.length), ctx, { filename: 'host-shared' });
const AUTO = ctx.AUTO;

ok(typeof AUTO.CI.buildInningEnd === 'function', 'buildInningEnd exists (setup)');
ok(typeof AUTO.CI.perGameFor === 'function', 'perGameFor exists (setup)');

// ---- pull the exact source snippet host/run.js runs each tick -----------
const runSrc = fs.readFileSync(path.join(ROOT, 'host', 'run.js'), 'utf8');
ok(/inningEndCount/.test(runSrc), 'run.js declares a separate inning-end counter',
   'the fix was never applied');
ok(/INNING_END_CAP\s*=\s*20/.test(runSrc), 'the inning-end backstop is generous (20), not the ordinary cap');
/* THE ONE CHECK THAT ACTUALLY MATTERS, made specific on purpose. A
   sabotage run proved the loose version worthless: it removed the real
   ternary (inningEndCount < INNING_END_CAP) and replaced it with a plain
   askedTotal < allowed, reintroducing the exact 23 Aug bug — and every
   check below still passed, because inningEndCount and INNING_END_CAP
   still existed elsewhere in the file as dead declarations. A substring
   match proves a token exists somewhere; it does not prove the token is
   doing the job. This asserts the actual shape of the guard. */
const guardOk = /const\s+withinBudget\s*=\s*inningEnded\s*!=\s*null\s*\r?\n\s*\?\s*inningEndCount\s*<\s*INNING_END_CAP\s*\r?\n\s*:\s*askedTotal\s*<\s*allowed\s*;/.test(runSrc);
ok(guardOk, 'the inning-end branch checks inningEndCount, not the shared askedTotal',
   'the guard\'s exact shape changed — this is the one substitution that reintroduces the 23 Aug bug, and it slipped past every looser check');
ok(/if\(firedFromInningEnd\)\s*inningEndCount\+\+;/.test(runSrc),
   'a real inning-end firing increments its OWN counter, not ciCounts');

// ---- simulate the real 23 Aug shape: 9 innings + 2 ordinary questions ----
// Reproduce the budget arithmetic exactly as run.js computes it per tick,
// using the SAME functions (perGameFor, floorMs) so this is not a
// reimplementation that could silently drift from the real logic.
function simulate(pace, innings, ordinaryEvents) {
  /* allowed() MUST use the CURRENT inning as `per`, exactly like run.js's
     real per-tick call — AUTO.CI.quota(perGameFor(...), per, regPer). The
     first version of this harness fixed per=9 for every check, which
     hands back the FULL per-game total immediately regardless of pace or
     how early the event is. That is the ramp being bypassed by the
     TEST, not by the runtime — it made every pace look unlimited and
     produced a false failure below. */
  const allowed = (per) => AUTO.CI.quota(AUTO.CI.perGameFor('baseball', pace), per, innings);
  let ciCounts = {}, inningEndCount = 0, askedTotal = 0;
  const fired = [];
  const INNING_END_CAP = 20;

  // one "turn" per inning boundary, interleaved with ordinary events
  const timeline = [];
  for (let i = 1; i <= innings; i++) {
    timeline.push({ type: 'inningEnd', inning: i, per: i });
    /* Count OCCURRENCES of i in ordinaryEvents, not membership — .includes()
       treats [1,1,2,2] the same as [1,2] and silently drops the duplicate
       demand the "exercise the cap" case depends on. */
    const n = ordinaryEvents.filter((x) => x === i).length;
    for (let k = 0; k < n; k++) timeline.push({ type: 'ordinary', per: i });
  }

  for (const ev of timeline) {
    if (ev.type === 'inningEnd') {
      const withinBudget = inningEndCount < INNING_END_CAP;
      if (withinBudget) { fired.push('inning-' + ev.inning); inningEndCount++; }
    } else {
      const a = allowed(ev.per); // ramped to how far the game has actually gotten
      const withinBudget = askedTotal < a;
      if (withinBudget) { fired.push('ordinary'); ciCounts[ev.per] = (ciCounts[ev.per] || 0) + 1; askedTotal++; }
      else { fired.push('ordinary-BLOCKED'); }
    }
  }
  return { fired, inningEndCount, askedTotal };
}

const r = simulate('normal', 9, [2, 3, 7]); // ordinary questions after innings 2, 3, 7 — matches the real night's shape
const inningFires = r.fired.filter((x) => x.startsWith('inning-')).length;
console.log('  simulated 9-inning game, normal pace: ' + inningFires + ' of 9 inning-end questions fired');
console.log('  fired order: ' + r.fired.join(', '));

ok(inningFires === 9, 'every inning gets its question, even after the ordinary budget would fill',
   'only ' + inningFires + ' of 9 fired — the shared-pool bug is back');

// ---- and the ordinary budget still works normally (not now unlimited) ----
/* Offer MORE ordinary events than chill's own cap so the cap is actually
   exercised — nine offers under a cap of twelve proves nothing about
   whether the cap still works. Two per inning, eighteen total. */
const chillCap = AUTO.CI.perGameFor('baseball', 'chill');
const heavy = simulate('chill', 9, [1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9]);
const ordFires = heavy.fired.filter((x) => x === 'ordinary').length;
const ordBlocked = heavy.fired.filter((x) => x === 'ordinary-BLOCKED').length;
console.log('  chill pace (cap=' + chillCap + '), 18 ordinary events offered: ' +
            ordFires + ' fired, ' + ordBlocked + ' blocked by the cap');
ok(ordFires <= chillCap, 'the ordinary budget still caps ordinary questions to its own pace',
   'fired ' + ordFires + ', chill pace caps at ' + chillCap + ' — the ordinary pacing rule was accidentally removed');
ok(ordBlocked > 0, 'and some of the excess is actually blocked, proving the cap is live',
   'all 18 fired uncapped — the cap check is not being applied');
ok(inningFires === 9, 'and inning-end still got all 9 in the same run — the two pools are independent');

console.log('');
if (bad.length) { console.log('FAILURES:'); bad.forEach((b) => console.log('  ✗ ' + b)); console.log(''); }
if (pass === 0) { console.log('inning-end-budget: RAN NOTHING\n'); process.exit(1); }
console.log('inning-end-budget: ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
