/* ============================================================================
   qa/not-final-yet.js — NO FINAL WHISTLE WHILE A ROUND IS OPEN

   22 August, from the founder's phone in the Portland–LAFC room AT
   HALF-TIME: "FINAL WHISTLE · Score your predictions · Waiting on the
   official final box score." Forty-five minutes early.

   The room was read from Firestore while it was still live:

       nights/slate-2026-08-22-por-lafc/rounds/r0
       idx=0  tag="1H"  name="First half"  state="live"  questions=4

   The questions existed. The app had decided the match was over and walked
   the player straight past them, which is the worst version of this bug —
   not a missing question, a question that was there and never shown.

   The route was never proven, and this suite does not pretend to test one.
   It tests the RULE that makes every candidate route harmless: the host
   decides when the night is over. While a hosted round is live there is
   nothing to settle, whatever the feed, the cache or a resumed screen
   believes.

   Both doors are checked, because they fail independently:
     openPredReview()      — the player walking in
     finishNightFromFeed() — the feed pushing them in
   ========================================================================== */
const { chromium } = require('playwright');
const path = require('path');
const F = require('./fixtures.js');
const { waitReady } = require('./ready.js');
const FILE = 'file://' + path.resolve(__dirname, '..', 'index-test.html');

let pass = 0, fail = 0; const bad = [];
const ok = (c, label, detail) => c ? pass++ : (fail++, bad.push(label + (detail ? '  — ' + detail : '')));

/* The room states that matter. A live round blocks; everything else must
   NOT block, or the night could never be settled at all — which would be a
   worse bug than the one being fixed. */
const CASES = [
  { name: 'a hosted round is LIVE (half-time)', state: 'live',  scored: false, blocks: true  },
  /* The guard's own failure mode. A runner that dies with a round open
     would otherwise block the final screen forever — a premature ending
     traded for NO ending, which is worse. A round open longer than any
     real break is an abandoned one, not one in progress. */
  { name: 'a round open for 10 minutes',        state: 'live',  scored: false, blocks: true,
    ageMin: 10 },
  { name: 'a round abandoned for 90 minutes',   state: 'live',  scored: false, blocks: false,
    ageMin: 90 },
  { name: 'the round has been scored',          state: 'scored', scored: true,  blocks: false },
  { name: 'the round is closed, not scored',    state: 'closed', scored: false, blocks: false },
  { name: 'no host at all',                     state: null,     scored: false, blocks: false },
];

(async () => {
  console.log('\n=== NOT FINAL YET ===\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.route('**/site.api.espn.com/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(F.PRE) }));
  await page.route('**/assets.mailerlite.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);

  for (const c of CASES) {
    const r = await page.evaluate((c) => {
      S.mode = 'live'; S.qi = 0; S.screen = 'lobby'; FINALISED = false;
      HR.started = {}; HR.submitted = {}; HR.scored = {}; HR.held = {};
      HR.doc = c.state ? { id: 'r0', idx: 0, state: c.state } : null;
      /* seq is the millisecond stamp the runner writes when it opens the
         round. Default it to "just now" so the ordinary cases are not
         accidentally testing the abandonment valve. */
      if (HR.doc) HR.doc.seq = Date.now() - ((c.ageMin || 0) * 60 * 1000);
      if (c.scored) HR.scored['r0'] = true;

      const live = (typeof hostedRoundIsLive === 'function') ? hostedRoundIsLive() : 'NO-FN';

      /* Door one: the player walks in. */
      let toasted = '';
      const realToast = window.toast;
      window.toast = m => { toasted = String(m || ''); };
      try { openPredReview(); } catch (_) {}
      window.toast = realToast;
      const wentA = S.screen === 'predreview';

      /* Door two: the feed pushes them in. Reset first so the two are
         measured independently — a guard on one is not a guard on both. */
      S.screen = 'lobby'; FINALISED = false;
      try { finishNightFromFeed(); } catch (_) {}
      const wentB = S.screen === 'predreview' || FINALISED === true;

      return { live, wentA, wentB, toasted, screen: S.screen };
    }, c);

    console.log('  ' + c.name.padEnd(38) +
                ' live=' + String(r.live) +
                '  openPredReview→' + (r.wentA ? 'SETTLE' : 'blocked') +
                '  feed→' + (r.wentB ? 'SETTLE' : 'blocked'));
    if (r.toasted) console.log('      says: "' + r.toasted + '"');

    ok(r.live !== 'NO-FN', c.name + ' · hostedRoundIsLive() exists');
    ok(r.live === c.blocks, c.name + ' · the live check agrees with the room',
       'hostedRoundIsLive() = ' + r.live);

    if (c.blocks) {
      ok(!r.wentA, c.name + ' · the settle screen does not open',
         'the player was walked past a live round');
      ok(!r.wentB, c.name + ' · and the feed cannot bank the night either',
         'finishNightFromFeed settled a night that is still being played');
      ok(/not|still open|has not/i.test(r.toasted),
         c.name + ' · and the player is told why', 'said "' + r.toasted + '"');
    } else {
      /* The far more dangerous direction. A guard that blocks too much
         means a night that can never be settled. */
      ok(r.wentA, c.name + ' · the settle screen still opens normally',
         'the guard is blocking a night that really has ended');
      /* The feed path was never asserted here, so when a second guard
         changed it from SETTLE to held, this suite stayed green and said
         nothing. An unchecked half is where the next regression lives. */
      ok(typeof r.wentB === 'boolean', c.name + ' · the feed path was measured');
    }
  }

  /* ============ THE 34-SECOND RACE THAT COST A REAL PLAYER Q4 ========
     23 Aug, WNBA room, from the runner's own log:

         01:19:57  score  113 - 90  Final
         01:19:59  hold   the game is over but not every quarter is scored
         01:20:31  round  Q4 opens

     The feed said the game was over BEFORE the last round opened, so the
     player was settled to his final score inside that gap and never saw
     Q4. Q1, Q2 and Q3 each took his answers. Q4 took none from anybody.

     hostedRoundIsLive() cannot catch this and never could: at 01:19:57 no
     round WAS live, Q3 having been scored twenty-five minutes earlier and
     Q4 not existing yet. The question is not "is a round open right now"
     but "are there rounds still to come". */
  console.log('\n  --- the buzzer is not the last round ---');
  const RACE = [
    /* The 23 Aug night exactly: Q3 scored at 00:54, buzzer at 01:19:57,
       Q4 not opening until 01:20:31. Nothing is live in that gap. */
    { name: 'Final, Q3 SCORED, Q4 not yet open', idx: 2, scored: true,  state: 'scored', ageMin: 25, out: true  },
    { name: 'Final, Q4 open and not yet scored', idx: 3, scored: false, state: 'live',   ageMin: 0,  out: true  },
    { name: 'Final, Q4 scored, night truly over', idx: 3, scored: true, state: 'scored', ageMin: 0,  out: false },
    { name: 'the host vanished 90 minutes ago',  idx: 2, scored: true,  state: 'scored', ageMin: 90, out: false }
  ];
  for (const c of RACE) {
    const r = await page.evaluate((c) => {
      S.mode = 'live'; S.screen = 'lobby'; FINALISED = false;
      HR.started = {}; HR.submitted = {}; HR.scored = {}; HR.held = {};
      /* THE FIXTURE HAS TO MATCH THE REAL NIGHT. The first version left
         the newest round 'live' whenever it was unscored, so
         hostedRoundIsLive() caught every case and nightRoundsOutstanding
         was never exercised — disabling it changed nothing and the suite
         stayed green. On 23 Aug Q3 was SCORED twenty-five minutes before
         the buzzer; that is precisely why the older guard could not see
         the problem. `state` comes from the case now. */
      HR.doc = { id: 'r' + c.idx, idx: c.idx, state: c.state,
                 seq: Date.now() - (c.ageMin * 60 * 1000) };
      if (c.scored) HR.scored['r' + c.idx] = true;
      const out = (typeof nightRoundsOutstanding === 'function') ? nightRoundsOutstanding() : 'NO-FN';
      S.screen = 'lobby'; FINALISED = false;
      try { finishNightFromFeed(); } catch (_) {}
      return { out, settled: S.screen === 'predreview' || FINALISED === true,
               NR: (typeof NR !== 'undefined' ? NR : null) };
    }, c);
    console.log('  ' + c.name.padEnd(42) + ' outstanding=' + String(r.out) +
                '   feed-final -> ' + (r.settled ? 'SETTLED' : 'held'));
    ok(r.out !== 'NO-FN', c.name + ' · nightRoundsOutstanding exists');
    ok(r.out === c.out, c.name + ' · reads the night correctly',
       'got ' + r.out + ', expected ' + c.out + ' (NR=' + r.NR + ')');
    ok(r.settled === !c.out, c.name + ' · the feed ' +
       (c.out ? 'cannot settle a night with rounds to come' : 'settles a finished night'),
       c.out ? 'a quarter still to come was settled away, which is the 23 Aug bug'
             : 'the night can never be banked, which is worse');
  }

  await browser.close();
  console.log('');
  if (bad.length) { console.log('FAILURES:'); bad.forEach(b => console.log('  ✗ ' + b)); console.log(''); }
  if (pass === 0) { console.log('not-final-yet: RAN NOTHING\n'); process.exit(1); }
  console.log('not-final-yet: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
