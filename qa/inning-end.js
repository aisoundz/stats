/* ============================================================================
   qa/inning-end.js — A QUESTION AT THE END OF EVERY INNING

   Anis, 22 Aug: "For baseball we should do question at the end of every
   [inning]." Baseball's scoring rounds cover innings 1-3, 4-6 and 7-9, so
   between them sit forty-minute stretches with nothing to answer — most of
   the game.

   Three things have to hold, and each one, broken, makes the feature worse
   than not having it:

     1. THE QUESTION IS ABOUT THE INNING THAT ENDED. At the moment the
        period turns, the new inning contains no plays. A question built
        against it is a question about nothing.

     2. THE ANSWER IS RIGHT. Runs are read off the running score line, not
        counted from scoring plays — one play can drive in several. Checked
        here against every inning of a real 604-play game, computed a second
        and independent way.

     3. IT IS NOT SILENCED BY THE EARLY-GAME RAMP. `allowed` grows with the
        period so a game cannot spend its budget in the first quarter. That
        is right for ordinary questions and wrong here: it would mute exactly
        the early innings this exists to cover. The per-game CAP must still
        bind, or a long extra-innings game could run away.

   The builder is pure and lives in the @host-shared block, so it is loaded
   the same way host/run.js loads it — through a bare vm sandbox, not a
   browser. If that block stops loading, this suite says so first.
   ========================================================================== */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0; const bad = [];
const ok = (c, label, detail) => c ? pass++ : (fail++, bad.push(label + (detail ? '  — ' + detail : '')));

console.log('\n=== INNING END ===\n');

/* ---- load the shared engine exactly as the runner does ---------------- */
const src = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const S = '/* @host-shared:start', E = '/* @host-shared:end */';
const a = src.indexOf(S), b = src.indexOf(E);
if (a < 0 || b < 0) { console.error('FAIL: no @host-shared sentinels in admin.html'); process.exit(1); }
const ctx = vm.createContext({ console, fetch: () => { throw new Error('no net'); } });
vm.runInContext(src.slice(a, b + E.length), ctx, { filename: 'host-shared' });
const C = ctx.AUTO && ctx.AUTO.CI;

ok(!!C, 'the @host-shared block loads');
ok(typeof (C && C.buildInningEnd) === 'function', 'buildInningEnd exists');
ok(typeof (C && C.ordinal) === 'function', 'ordinal exists');
if (!C || !C.buildInningEnd) { console.error('cannot continue'); process.exit(1); }

/* ---- ordinals, including the teens ------------------------------------ */
const ordCases = [[1,'1st'],[2,'2nd'],[3,'3rd'],[4,'4th'],[11,'11th'],[12,'12th'],
                  [13,'13th'],[21,'21st'],[22,'22nd'],[23,'23rd'],[111,'111th']];
const ordBad = ordCases.filter(([n, w]) => C.ordinal(n) !== w);
ok(ordBad.length === 0, 'ordinals are right, including 11th/12th/13th',
   ordBad.map(([n, w]) => n + '→' + C.ordinal(n) + ' want ' + w).join(', '));

/* ---- the answer, against a real game ---------------------------------- */
const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/multisport/mlb.json'), 'utf8'));
const plays = j.plays || [];
ok(plays.length > 300, 'the MLB fixture has a full game of plays', plays.length + ' plays');

/* Independent truth: the high-water score line per inning, differenced.
   Deliberately NOT the same expression the builder uses. */
const high = {};
plays.forEach(p => {
  const n = p.period && Number(p.period.number); if (!n) return;
  const t = (Number(p.awayScore) || 0) + (Number(p.homeScore) || 0);
  if (high[n] == null || t > high[n]) high[n] = t;
});
const innings = Object.keys(high).map(Number).sort((x, y) => x - y);
let prev = 0; const truth = {};
innings.forEach(n => { truth[n] = high[n] - prev; prev = high[n]; });

const T = { awayAbbr: 'ARI', homeAbbr: 'ATL' };
let agree = 0, disagree = [];
innings.forEach(n => {
  const q = C.buildInningEnd('baseball', plays, T, n, {});
  if (!q) { disagree.push(n + ': no question built'); return; }
  const want = truth[n];
  const expect = want === 0 ? '0' : want === 1 ? '1' : want === 2 ? '2' : '3';
  if (q.ans === expect) agree++; else disagree.push(n + ': got ' + q.ans + ' want ' + expect);
  /* and the prompt must name the inning that ENDED */
  if (q.prompt.indexOf(C.ordinal(n)) < 0) disagree.push(n + ': prompt does not name the ' + C.ordinal(n));
  if (Number(q.per) !== n) disagree.push(n + ': per is ' + q.per);
});
console.log('  ' + innings.length + ' innings in the fixture, ' + agree + ' answers agree with the score line');
ok(innings.length >= 9, 'the fixture covers a full game', innings.length + ' innings');
ok(disagree.length === 0, 'every inning is answered correctly and named correctly',
   disagree.slice(0, 4).join(' · '));

/* ---- A PLAY CAN DRIVE IN MORE THAN ONE RUN ---------------------------
   The real fixture cannot see this: with the answer banded 0/1/2/3+, a
   run of one-run scoring plays gives the same answer whether you count
   RUNS or count PLAYS. A mutation that counted scoring plays passed all
   ten innings of it.

   A two-run homer separates them: one scoring play, two runs. This is the
   whole reason the builder reads the score line instead of counting. */
const homer = [
  { period:{number:5}, sequenceNumber:1, awayScore:0, homeScore:0, summaryType:'N' },
  { period:{number:6}, sequenceNumber:2, awayScore:0, homeScore:0, summaryType:'N' },
  /* one play, two runs in */
  { period:{number:6}, sequenceNumber:3, awayScore:0, homeScore:2, summaryType:'N', scoringPlay:true },
  { period:{number:6}, sequenceNumber:4, awayScore:0, homeScore:2, summaryType:'N' }
];
const hq = C.buildInningEnd('baseball', homer, T, 6, {});
ok(!!hq, 'the two-run-homer fixture builds');
if (hq) {
  ok(hq.ans === '2', 'a single play that drives in two runs answers TWO',
     'answered ' + hq.ans + ' — this is counting scoring PLAYS, not runs');
  ok(/2 runs in the 6th/.test(hq.atext || ''), 'and says so when it resolves', hq.atext);
}

/* A grand slam: still one play, four runs, and the top band. */
const slam = [
  { period:{number:2}, sequenceNumber:1, awayScore:1, homeScore:0, summaryType:'N' },
  { period:{number:3}, sequenceNumber:2, awayScore:1, homeScore:0, summaryType:'N' },
  { period:{number:3}, sequenceNumber:3, awayScore:5, homeScore:0, summaryType:'N', scoringPlay:true }
];
const sq = C.buildInningEnd('baseball', slam, T, 3, {});
ok(sq && sq.ans === '3', 'four runs on one play answers THREE OR MORE',
   sq ? 'answered ' + sq.ans : 'built nothing');

/* ---- it must NOT answer about an inning with no plays ----------------- */
const empty = C.buildInningEnd('baseball', plays, T, 99, {});
ok(empty === null, 'an inning with no plays produces no question',
   'built a question about an inning that never happened');

/* ---- and never for another sport -------------------------------------- */
ok(C.buildInningEnd('football', plays, T, 2, {}) === null,
   'it is baseball only');

/* ---- the lock window is the long one ---------------------------------- */
const q4 = C.buildInningEnd('baseball', plays, T, 4, {});
ok(!!q4, 'a mid-game inning builds');
if (q4) {
  ok(C.lockMsFor(q4.kind) === 20000,
     'it gets the 20-second window a spoken answer needs',
     'kind ' + q4.kind + ' → ' + C.lockMsFor(q4.kind) + 'ms');
  ok(Array.isArray(q4.options) && q4.options.length === 4,
     'four options', JSON.stringify(q4.options));
  ok(q4.qid && /^ci_\d+_end_/.test(q4.qid), 'the qid marks it as an inning end', q4.qid);
}

/* ---- qids are unique across innings ----------------------------------- */
const ids = innings.map(n => (C.buildInningEnd('baseball', plays, T, n, {}) || {}).qid).filter(Boolean);
ok(new Set(ids).size === ids.length, 'every inning gets its own qid',
   ids.length + ' built, ' + new Set(ids).size + ' distinct');

/* ---- THE RUNNER SIDE: the ramp must not mute early innings ------------
   UPDATED 23 Aug. This originally asserted inning-end shared the ordinary
   perGameCap ("askedTotal < perGameCap") rather than the ramp. That was
   itself a bug of the same shape, caught on a real 9-inning game: two
   ordinary at-bat questions shared that pool, it ran dry after 12
   questions, and the 9th inning got nothing for the last 85 minutes of a
   live room. Inning-end now has its OWN counter (inningEndCount) against
   its own generous backstop (INNING_END_CAP), never the shared pool.
   Full coverage, including a sabotage-proven check of the exact guard
   shape, lives in qa/inning-end-budget.js — this assertion now only
   confirms the two pools stay genuinely separate. */
const run = fs.readFileSync(path.join(ROOT, 'host/run.js'), 'utf8');
ok(/inningEndCount\s*<\s*INNING_END_CAP/.test(run),
   'an inning-end question is budgeted against its OWN counter, not the shared one',
   'the shared-pool bug from 23 Aug would be back');
ok(!/inningEnded\s*!=\s*null[\s\S]{0,80}askedTotal\s*<\s*perGameCap/.test(run),
   'and no longer shares askedTotal/perGameCap with ordinary questions',
   'a shared-budget expression reappeared');
ok(/buildInningEnd\(/.test(run), 'the runner actually calls buildInningEnd');
/* Passed the inning that ENDED — not `per`, which at the turn is the new
   inning and contains no plays yet. A mutation to `per` left every other
   check in this file green. */
ok(/buildInningEnd\(\s*sportFam\s*,\s*cplays\s*,\s*T\s*,\s*inningEnded\s*,/.test(run),
   'and passes it the inning that ENDED, not the one starting',
   'passing `per` asks about an inning with no plays in it yet');
ok(/ciLastPer/.test(run), 'the runner tracks the period so it can see the turn');
ok(/if\(!q\)\{[\s\S]{0,400}AUTO\.CI\.build\(/.test(run),
   'it falls back to an ordinary question rather than going silent',
   'the fallback structure changed shape — check it still exists');
/* And the fallback must survive the new builder THROWING, not just
   returning null. Sharing one try/catch meant an exception in
   buildInningEnd jumped past the ordinary builder entirely and the
   moment produced nothing — new code dragging proven code down with it,
   silently. */
ok(/buildInningEnd\([\s\S]{0,120}catch\s*\(e\)[\s\S]{0,160}q\s*=\s*null/.test(run),
   'a throw in the inning-end builder falls back instead of losing the moment',
   'the two builders share a catch, so an exception in the new one skips the old one');

console.log('');
if (bad.length) { console.log('FAILURES:'); bad.forEach(x => console.log('  ✗ ' + x)); console.log(''); }
if (pass === 0) { console.log('inning-end: RAN NOTHING\n'); process.exit(1); }
console.log('inning-end: ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
