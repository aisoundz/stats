#!/usr/bin/env node
/* =====================================================================
   Does every question in every bank actually resolve?
   ---------------------------------------------------------------------
   A question is not finished when it reads well. It is finished when it has
   been run through its named resolver against a real finished game and
   produced one of its own options.

   The failure this prevents is Game Night #9: sixteen questions published
   with nothing behind them, every quarter opening onto something nobody
   could score. The runner will not invent an answer — correctly — so an
   unresolvable question is a round that sits there.

   Three ways a line can be wrong, and all three are checked:
     1. the resolver does not exist               -> the round stalls
     2. it exists but returns null on a real game -> the round voids
     3. it returns a string that is not in its own option list -> refused

   A little silence is healthy: a resolver that refuses is doing its job.
   A bank that is mostly silent is a round that mostly voids, which pays
   and costs nobody and makes the night feel broken. The floor below is
   deliberately a floor, not a target.

       node qa/host-banks.js [fixtures-dir]
   ================================================================== */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
/* THIS SUITE USED TO LOOK OUTSIDE THE REPO — at
   ~/.claude/skills/stats-gametime/references/multisport/ — and skip with
   exit 0 when it was not there. On this machine the skill happens to be
   installed, so it ran and looked healthy. On a fresh clone, on CI, or from
   any other checkout path, the suite that proves EVERY QUESTION IN EVERY
   BANK resolves to one of its own options reported success while executing
   nothing. A test whose inputs live somewhere the repo does not control is
   a test that passes for reasons unrelated to the code.
   Both inputs are in the repo now, and their absence is a failure. */
/* argv MINUS the --file pair. Without this, passing `--file admin-test.html`
   makes argv[2] the literal string "--file" and the fixtures directory below
   resolves to nonsense — the suite then fails for a reason that has nothing
   to do with the banks. Caught by a negative control, not by reading. */
const ADMIN_ARGV = (function(){ const a = process.argv.slice(2), i = a.indexOf('--file');
  if(i >= 0) a.splice(i, a[i + 1] ? 2 : 1); return a; })();
const DIR = ADMIN_ARGV[0] || path.join(ROOT, 'references', 'multisport');
const BANKS_FILE = path.join(ROOT, 'references', 'multisport', 'question-banks.js');

/* ============ THIS FILE MUST NOT GOVERN A NIGHT =====================
   references/multisport/question-banks.js still carries a THREE-round MLB
   cadence, and the founder's rule since 31 Aug is a question EVERY inning.
   It cannot change live grading — a hosted night's rounds come from
   admin.html TEMPLATES and a practice run from index.html SPORTS — but
   that is only true for as long as nothing in host/ requires it. The day
   something does, a superseded cadence starts deciding real rounds, which
   is how this decision came to be argued twice already. */
(function(){
  const hostDir = path.join(ROOT, 'host');
  let readers = [];
  try {
    readers = fs.readdirSync(hostDir)
      .filter(f => f.endsWith('.js'))
      .filter(f => /require\([^)]*question-banks/.test(fs.readFileSync(path.join(hostDir, f), 'utf8')));
  } catch (_) {}
  if (readers.length) {
    console.log('  FAIL  host/ now requires question-banks.js: ' + readers.join(', '));
    console.log('        That file carries a superseded three-round MLB cadence.');
    process.exit(1);
  }
  console.log('  ok    nothing in host/ requires question-banks.js — it cannot govern a night');
})();

if (!fs.existsSync(DIR)) {
  console.log('NO FIXTURES at ' + DIR);
  console.log('  run:  node references/multisport/fetch.js');
  console.log('  (a check that cannot run has not passed)');
  process.exit(1);
}
if (!fs.existsSync(BANKS_FILE)) {
  console.log('NO question-banks.js at ' + BANKS_FILE + ' — cannot check any bank');
  process.exit(1);
}
const { BANKS, fillTeams } = require(BANKS_FILE);

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
const AUTO = ctx.AUTO;

/* Which period each round asks about. Baseball's rounds span three innings
   and are named for the LAST of them, which is why this is a table rather
   than an index+1. Getting it wrong here would resolve every question
   against the wrong part of the game and still look fine. */
/* THE ROUND -> PERIOD MAP BELONGS TO THE BANK, NOT TO THIS FILE. This was
   `const PERIODS = { mlb:[3,6,9], ... }`, a hardcoded second copy. When
   baseball moved to one round per inning the copy went stale, this suite
   kept handing period 3 to resolvers that now read a single inning, and
   it STAYED GREEN — band() never returns null, so `answered` never drops
   and the floor was still met while every "through three" question was
   quietly being resolved over the 3rd alone. A suite that cannot go red
   when the thing it grades changes underneath it is not a check.
   A bank that spans periods declares `periods`; everything else is
   index+1, which is what those leagues have always been. */
const periodsFor = (league, bank, ri) =>
  (bank && Array.isArray(bank.periods) && bank.periods[ri] != null)
    ? bank.periods[ri] : (ri + 1);
const FIXTURE = { mlb: 'mlb.json', nfl: 'nfl.json', nhl: 'nhl.json', mls: 'mls.json' };

let answered = 0, silent = 0, missing = 0, illegal = 0, threw = 0;
const problems = [];

for (const league of Object.keys(BANKS)) {
  const f = path.join(DIR, FIXTURE[league]);
  if (!fs.existsSync(f)) { console.log(`\n${league.toUpperCase()}: fixture absent, skipped`); continue; }
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const cs = j.header.competitions[0].competitors;
  const home = cs.find(c => c.homeAway === 'home').team.displayName;
  const away = cs.find(c => c.homeAway === 'away').team.displayName;
  const bank = fillTeams(BANKS[league], home, away);

  console.log(`\n${league.toUpperCase()}  ${away} @ ${home}`);
  let lAns = 0, lSil = 0;

  bank.rounds.forEach((round, ri) => {
    const period = periodsFor(league, BANKS[league], ri);   // the RAW bank — fillTeams may not carry the field
    console.log(`  ${bank.tags[ri]} (period ${period}, worth ${bank.worth[ri]})`);
    round.forEach(q => {
      const fn = AUTO.R[q.r];
      if (typeof fn !== 'function') {
        missing++; problems.push(`${league} ${bank.tags[ri]}: no resolver named "${q.r}"`);
        console.log(`    \x1b[31m✗\x1b[0m ${q.t}  [${q.r}] NO SUCH RESOLVER`);
        return;
      }
      let v, err = null;
      try { v = fn(j, period, q.o); } catch (e) { err = e.message; }
      if (err) {
        threw++; problems.push(`${league} ${bank.tags[ri]} [${q.r}] threw: ${err}`);
        console.log(`    \x1b[31m✗\x1b[0m ${q.t}  [${q.r}] THREW ${err}`);
      } else if (v === null || v === undefined) {
        silent++; lSil++;
        console.log(`    \x1b[33m~\x1b[0m ${q.t}  [${q.r}] refused — would void`);
      } else if (q.o.indexOf(v) < 0) {
        illegal++; problems.push(`${league} ${bank.tags[ri]} [${q.r}] answered "${v}", not one of its own options`);
        console.log(`    \x1b[31m✗\x1b[0m ${q.t}  [${q.r}] ILLEGAL "${v}"`);
      } else {
        answered++; lAns++;
        console.log(`    \x1b[32m✓\x1b[0m ${q.t}  →  \x1b[1m${v}\x1b[0m`);
      }
    });
  });
  const total = lAns + lSil;
  const pct = total ? Math.round(100 * lAns / total) : 0;
  console.log(`  → ${lAns} of ${total} answered (${pct}%)`);
  if (pct < 60) problems.push(`${league}: only ${pct}% of the bank resolves on a real game — that round would mostly void`);
}

/* A DROP IN COVERAGE MUST FAIL, NOT JUST PRINT.
   Sabotaging tieOpt down to /tie/ alone took this from 50 answered to 48 —
   two questions silently became voids — and the run still exited zero,
   because refusals are legitimate on their own and both leagues stayed
   above the percentage floor. A refusal is fine; LOSING one that used to
   answer is a regression, and it is invisible unless the number is pinned.
   Raise EXPECT when questions are added; never lower it to make a run
   pass. */
const EXPECT = Number(process.argv.find(a => /^--expect=/.test(a))?.split('=')[1] || 50);
if (answered < EXPECT)
  problems.push(`coverage dropped: ${answered} questions answer, expected at least ${EXPECT} — a resolver got narrower or a fixture changed`);

console.log(`\n${'─'.repeat(58)}`);
console.log(`answered ${answered}   refused ${silent}   MISSING ${missing}   ILLEGAL ${illegal}   THREW ${threw}   (floor ${EXPECT})`);
if (problems.length) { console.log('\nproblems:'); problems.forEach(p => console.log('  • ' + p)); }
else console.log('every question in every bank resolves to one of its own options.');
process.exit(missing + illegal + threw + problems.length ? 1 : 0);
