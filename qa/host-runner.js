#!/usr/bin/env node
/* =====================================================================
   The runner's end-of-night sequence.
   ---------------------------------------------------------------------
   Added 17 Aug 2026 after debriefing Game Night #11 from its own archive.
   John Smalls finished the night on 320 points and the board showed him
   165. Nothing crashed and nothing was logged; he simply lost a whole
   prediction card — 155 points — to a twenty-second race.

   The sequence matters and each step is here for a reason a night paid for:

     buzzer -> score -> WAIT for the phones to settle -> score again
            -> archive -> exit

   `pts` is a stored total whose inputs keep moving after it is written:
   predPts, catchPts and caughtPts settle on the DEVICE, because the server
   cannot derive them. So the pass at the buzzer is a snapshot of numbers
   that are still changing, and any player whose card settles in the seconds
   after it keeps the stale total forever — the runner has already exited.

   Verified against GN11's real archive: the tally is idempotent, so the
   second pass cannot double anybody, and it recomputes Smalls to 320.

       node qa/host-runner.js
   ================================================================== */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'host/run.js'), 'utf8');

let fail = 0;
const ok = id => console.log(`  \x1b[32m✓\x1b[0m ${id}`);
const bad = (id, why) => { fail++; console.log(`  \x1b[31m✗ ${id}\x1b[0m — ${why}`); };
const check = (id, cond, why) => cond ? ok(id) : bad(id, why);

/* Slice to the buzzer branch. Asserting on the whole file would pass on a
   match anywhere — the same unanchored-search false green that has caught
   this project three times. */
const bi = src.indexOf('final buzzer, every quarter scored');
const branch = bi > 0 ? src.slice(Math.max(0, bi - 4000), bi + 200) : '';

console.log('\nthe end-of-night sequence');
check('runner.buzzer-branch-found', branch.length > 0,
  'could not locate the final-buzzer branch — the checks below would pass vacuously');

if (branch) {
  check('runner.settles-before-the-last-score',
    /SETTLE_MS/.test(branch) && /setTimeout\(r, SETTLE_MS\)/.test(branch),
    'no settle wait before the final scoring pass — a card that settles after the buzzer pass is lost');

  check('runner.settle-is-configurable',
    /process\.env\.SETTLE_MS/.test(branch),
    'SETTLE_MS is hardcoded; a night that needs a longer settle has no way to ask for one');

  /* ORDER IS THE WHOLE POINT. Score, wait, score, THEN archive — an archive
     written before the second pass records the stale totals, which is what
     GN11's archive did and why the loss was invisible until it was
     recomputed by hand. */
  const iScore1 = branch.indexOf('scoreRoom');
  const iWait = branch.indexOf('SETTLE_MS');
  const iScore2 = branch.indexOf('scoreRoom', iWait);
  const iArchive = branch.indexOf("archiveNight");
  check('runner.order-is-score-wait-score-archive',
    iScore1 > 0 && iWait > iScore1 && iScore2 > iWait && iArchive > iScore2,
    `order came out score@${iScore1} wait@${iWait} score@${iScore2} archive@${iArchive} — the archive must be last or it records stale totals`);

  check('runner.two-scoring-passes-at-the-buzzer',
    (branch.match(/await scoreRoom\(/g) || []).length >= 2,
    'only one scoring pass at the buzzer — the late-settling card has nothing to catch it');

  check('runner.says-what-it-is-waiting-for',
    /waiting .*settle/i.test(branch),
    'the runner waits ninety seconds in silence; a log that goes quiet at the buzzer reads as a crash');
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
