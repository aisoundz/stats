#!/usr/bin/env node
/* =====================================================================
   EVERY LANE THE BOARD ADDS UP MUST BE A LANE THE RUNNER WRITES.
   ---------------------------------------------------------------------
   Found 26 Aug 2026 by reading runner logs, proven against live
   Firestore before a line was changed.

   host/run.js grades the caught lane server-side — that is the whole
   point of the block, and its own comment says "silently trusting the
   device again is exactly the thing being fixed". It corrected
   `players[uid].caughtPts` in memory, tally() folded it into row.pts,
   and then the write-back saved:

       pts, livePts, speed, roundsDone

   `caughtPts` was not in that list. So the stored lane kept whatever the
   phone last wrote, which for a server-graded catch is 0.

   That would be harmless if anything read `pts`. Nothing does. The
   client RECOMPOSES the total from the lanes —

       nightTotal(v) = livePts + predPts + catchPts + caughtPts

   — and readRoom() ranks the board on that, with its own comment
   "Ranked on the TOTAL, not on `pts`." So the board dropped exactly the
   points the runner had just awarded, and the runner re-detected the
   same correction every tick forever because nothing persisted it.

   MEASURED ON LIVE DATA, four nights, before the fix:

       08-25 por-dal  Hco1fKvC  pts=90  lanes=80  caughtPts=0   -10
       08-23 nyc-ne   8wvRQsmH  pts=10  lanes= 0  caughtPts=0   -10
       08-22 por-lafc Hco1fKvC  pts=85  lanes=80  caughtPts=0    -5
       08-21 nyj-pit  8wvRQsmH  pts=15  lanes=10  caughtPts=0    -5

   The lane survived ONLY when the device wrote it itself, so this hit
   precisely the players whose catches the server had to grade.

   THIS SUITE GUARDS THE CLASS, NOT THE INSTANCE. The defect is the
   seventh "one fact, many copies" in this codebase and the shape is
   always the same: two places describe one thing and drift. So rather
   than asserting "caughtPts appears in run.js", it derives BOTH lists
   from the source and asserts they agree — a fifth lane added to
   nightTotal() and forgotten in the runner fails here on the day it is
   written.

       node qa/lane-persist.js
       node qa/lane-persist.js --file index-test.html --admin-file admin-test.html
   ================================================================== */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

/* Named flags, not positional — argv[2] is already spoken for in the
   admin suites and a positional here broke four of them on 25 Aug. */
const arg = (flag, dflt) => { const a = process.argv.slice(2), i = a.indexOf(flag);
  return (i >= 0 && a[i + 1]) ? a[i + 1] : dflt; };
const PLAYER_FILE = arg('--file', 'index.html');
const ADMIN_FILE  = arg('--admin-file', 'admin.html');

const player = fs.readFileSync(path.join(ROOT, PLAYER_FILE), 'utf8');
const runner = fs.readFileSync(path.join(ROOT, 'host/run.js'), 'utf8');
const admin  = fs.readFileSync(path.join(ROOT, ADMIN_FILE), 'utf8');

/* ============ MEASURE CODE, NOT PROSE ===============================
   Every fix in this project ships with a long comment explaining it, and
   those comments NAME the identifiers they are about. So a plain search
   for "caughtSrv" matches the essay describing the fix and stays green
   after the fix itself is deleted — which is precisely what happened
   while this suite was being sabotage-tested: removing the preference
   from nightTotal() left the suite fully green because the word survived
   in the comment above it.

   Everything below is parsed from code with the comments removed. */
const decomment = (s) => String(s || '')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

let fail = 0;
const ok  = (id) => console.log(`  \x1b[32m✓\x1b[0m ${id}`);
const bad = (id, why) => { fail++; console.log(`  \x1b[31m✗ ${id}\x1b[0m — ${why}`); };
const check = (id, cond, why) => cond ? ok(id) : bad(id, why);

console.log('\n=== EVERY LANE THE BOARD ADDS UP, THE RUNNER WRITES ===   '
  + PLAYER_FILE + ' · ' + ADMIN_FILE);

/* ---------------------------------------------------------------------
   1. THE LANES THE CLIENT COMPOSES A TOTAL FROM.
   Sliced to nightTotal()'s body. An unanchored search over the whole
   file would match these names anywhere and pass vacuously, which is the
   false green this project has hit three times.
   ------------------------------------------------------------------ */
/* Anchored to the function's own export line, not a byte count. A fixed
   length is a guess that rots the moment somebody adds a comment — it did
   exactly that while this suite was being written, and every check below
   went red for a reason that had nothing to do with the code. */
const ni = player.indexOf('function nightTotal(');
const nEnd = player.indexOf('SB.nightTotal = nightTotal', ni);
const nBody = decomment((ni > 0 && nEnd > ni) ? player.slice(ni, nEnd) : '');
check('client.nightTotal-found', nBody.length > 0,
  'nightTotal() is not in ' + PLAYER_FILE + ' — every check below would pass vacuously');

/* The composed return is the line that matters: the `live +` sum. */
const retM = nBody.match(/return\s+live\s*\+[\s\S]*?;/);
check('client.nightTotal-composes-from-lanes', !!retM,
  'nightTotal() no longer returns a composed sum — this suite is measuring the wrong thing');

/* Read from the whole (anchored) function body, not just the return: a
   lane can reach the sum through a local, which is exactly how livePts
   and now caughtSrv are read. `pts` is excluded because it is the
   pre-lanes FALLBACK for old rows, not one of the lanes being summed. */
const LANES = Array.from(new Set(
  (nBody.match(/v\.([A-Za-z][A-Za-z0-9_]*)/g) || []).map(s => s.slice(2))
)).filter(l => l !== 'pts');

console.log('    lanes the board sums: ' + (LANES.join(', ') || '(none found)'));
check('client.found-more-than-one-lane', LANES.length >= 2,
  'only ' + LANES.length + ' lane(s) parsed out of nightTotal() — the parse is wrong, not the code');

/* ---------------------------------------------------------------------
   2. THE FIELDS THE RUNNER ACTUALLY PERSISTS.
   Sliced to the players/{uid} .set() call, for the same anchoring reason.
   ------------------------------------------------------------------ */
const si = runner.indexOf('nights/${NIGHT}/players/${uid}');
const sEnd = runner.indexOf('{ merge: true }', si);
const setBody = decomment((si > 0 && sEnd > si) ? runner.slice(si, sEnd) : '');
check('runner.player-write-found', setBody.length > 0,
  'could not locate the players/{uid} .set() in host/run.js');

/* Keys of the object literal. `\s*` after ^ matters: every key in this
   literal is indented, and without it `pts:` at the start of a line never
   matched — which read as "the runner stopped writing the total". The
   parser being wrong looks exactly like the code being wrong, so this
   suite proves its own parse at step 3 before asserting anything. */
const WRITTEN = Array.from(new Set(
  (setBody.match(/(?:^\s*|[{,]\s*)([A-Za-z][A-Za-z0-9_]*)\s*:/gm) || [])
    .map(s => s.replace(/[^A-Za-z0-9_]/g, ''))
));
console.log('    fields the runner writes: ' + (WRITTEN.join(', ') || '(none found)'));

/* ---------------------------------------------------------------------
   3. THE INVARIANT — AND IT IS NOT "the runner writes every lane".
   Two of the four lanes are CLIENT-owned on purpose. firestore.rules
   says so in as many words: "STILL CLIENT-REPORTED, HONESTLY: predPts
   and catchPts and caughtPts. Predictions settle on the phone and Caught
   It resolves there, so the server cannot derive them."

   So the honest invariant is about OWNERSHIP, not coverage: every lane
   the board sums must have exactly one writer, and any lane the SERVER
   grades must be published by the server under a name no client writes.
   That is what livePts already does and what caughtSrv now does too.
   ------------------------------------------------------------------ */
const CLIENT_OWNED = ['predPts', 'catchPts', 'caughtPts'];
const clientPush = (function(){
  const i = player.indexOf('SB.push = async function');
  const j = player.indexOf('lastSeen: F.serverTimestamp()', i);
  return decomment((i > 0 && j > i) ? player.slice(i, j) : '');
})();
check('client.push-found', clientPush.length > 0,
  'could not locate SB.push in ' + PLAYER_FILE + ' — ownership cannot be checked');

/* Prove the parse before trusting it: `pts` and `livePts` are certainly
   written by the runner, so if either is absent the regex is broken and
   every conclusion below is noise. */
check('parse.the-field-list-is-real',
  WRITTEN.includes('pts') && WRITTEN.includes('livePts'),
  'parsed [' + WRITTEN.join(', ') + '] out of the runner write — pts and livePts must both be there; the PARSER is wrong, not the code');

const serverLanes = LANES.filter(l => !CLIENT_OWNED.includes(l));
const missing = serverLanes.filter(l => !WRITTEN.includes(l));
check('invariant.every-server-owned-lane-is-persisted', missing.length === 0,
  'the board sums [' + missing.join(', ') + '] and the runner never writes '
  + (missing.length === 1 ? 'it' : 'them'));

/* And the total itself, because the archive and host/debrief.js read it. */
check('invariant.the-total-is-still-written', WRITTEN.includes('pts'),
  'pts is no longer written — the archive and debrief read it');

/* THE 26 AUG DEFECT, NAMED. The server grades a caught lane; it must
   publish it, and it must publish it somewhere no phone can overwrite. */
check('invariant.the-server-publishes-its-graded-caught-lane',
  WRITTEN.includes('caughtSrv'),
  'host/run.js grades the caught lane and does not publish it — the board '
  + 'recomposes from lanes and will drop every point the server awarded');

check('invariant.the-server-lane-is-not-one-a-client-writes',
  !clientPush.includes('caughtSrv'),
  'SB.push writes caughtSrv — two writers for one fact, and the phone wins '
  + 'the race mid-game, which is the bug this field exists to avoid');

check('invariant.the-client-still-owns-its-own-lanes',
  CLIENT_OWNED.every(l => clientPush.includes(l)) || clientPush.length === 0,
  'a client-owned lane stopped being pushed — a hostless room has no other source for it');

/* ---------------------------------------------------------------------
   4. AND THE VALUE IS THE CORRECTED ONE, NOT A ZERO.
   Writing the field is half the fix; writing tally()'s figure is the
   other half. `caughtSrv: 0` would satisfy every check above.
   ------------------------------------------------------------------ */
check('runner.caught-lane-is-written-from-the-tally-row',
  /caughtSrv\s*:\s*row\.caughtPts/.test(setBody),
  'caughtSrv is written from something other than row.caughtPts — the tally row is the corrected value');

/* ---------------------------------------------------------------------
   4b. AND THE CLIENT ACTUALLY PREFERS IT.
   The runner could publish caughtSrv forever and the board still drop it
   if nightTotal() never looks. This is the half that was missing for the
   whole class: the correct value existed and nothing read it.
   ------------------------------------------------------------------ */
check('client.nightTotal-prefers-the-server-graded-lane',
  /caughtSrv/.test(nBody),
  'nightTotal() never reads caughtSrv — the runner publishes a number nothing consumes');

check('client.nightTotal-still-falls-back-to-the-device-lane',
  /caughtPts/.test(nBody),
  'nightTotal() dropped the caughtPts fallback — a hostless room would score every catch as zero');

/* The server-side grading must still be the thing that produced it. */
check('runner.the-caught-lane-is-still-graded-server-side',
  /players\[uid\]\.caughtPts\s*=\s*r\.pts/.test(runner),
  'the server-side caught grading is gone — the lane would persist the device figure again');

/* ---------------------------------------------------------------------
   5. tally() REALLY RETURNS THE LANE, RUN NOT READ.
   The write above is `row.caughtPts`; if tally ever stops emitting it the
   runner would persist `undefined`, which Firestore rejects outright.
   ------------------------------------------------------------------ */
const START = '/* @host-shared:start', END = '/* @host-shared:end */';
const a = admin.indexOf(START), b = admin.indexOf(END);
check('admin.host-shared-block-found', a >= 0 && b > a,
  'the @host-shared sentinels are missing from ' + ADMIN_FILE);

if (a >= 0 && b > a) {
  const ctx = vm.createContext({ console, fetch: () => { throw new Error('no network'); } });
  vm.runInContext(admin.slice(a, b + END.length), ctx, { filename: 'host-shared' });
  const AUTO = ctx.AUTO;

  check('admin.tally-is-exported', AUTO && typeof AUTO.tally === 'function',
    'AUTO.tally is not exported from the shared block');

  if (AUTO && typeof AUTO.tally === 'function') {
    /* One player, one scored round they answered nothing in, and a caught
       lane of 25. The point is the LANE surviving tally, so live is 0. */
    const players = { u1: { predPts: 40, catchPts: 5, caughtPts: 25 } };
    const scored  = [{ id: 'r0', worth: 10, key: ['A'] }];
    const subs    = { r0: { u1: { picks: [null], banks: [0] } } };
    const t = AUTO.tally(scored, players, subs);
    const row = t.u1 || {};

    console.log('    tally row: pts=' + row.pts + '  live=' + row.live
      + '  predPts=' + row.predPts + '  catchPts=' + row.catchPts
      + '  caughtPts=' + row.caughtPts);

    check('tally.emits-the-caught-lane', typeof row.caughtPts === 'number',
      'row.caughtPts is ' + typeof row.caughtPts + ' — the runner would write undefined, which Firestore rejects');
    check('tally.carries-the-caught-value-through', row.caughtPts === 25,
      'caughtPts went in as 25 and came out as ' + row.caughtPts);
    check('tally.total-includes-the-caught-lane', row.pts === 70,
      'pts=' + row.pts + ', expected 70 (0 live + 40 pred + 5 catch + 25 caught)');

    /* THE WHOLE BUG, AS ONE ASSERTION: what the runner stores as the
       total must equal what the client will recompose from the lanes it
       stores. These are the two numbers that disagreed on four nights. */
    const composed = (row.live || 0) + (row.predPts || 0)
                   + (row.catchPts || 0) + (row.caughtPts || 0);
    check('tally.the-total-and-the-lanes-agree', row.pts === composed,
      'runner would store pts=' + row.pts + ' while the board recomposes '
      + composed + ' from the lanes — this is the 26 Aug divergence');
  }
}

console.log(fail
  ? `\n\x1b[31mRED\x1b[0m   ${fail} failed`
  : `\n\x1b[32mGREEN\x1b[0m  all checks pass`);
process.exit(fail ? 1 : 0);
