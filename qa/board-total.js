/* ============================================================================
   qa/board-total.js — ONE PLAYER, ONE NUMBER, EVERY SCREEN

   23 Aug: "the points didn't add up in all the pages. In one page Dan the
   fan has 480 and another page he has 190."

   Two listeners fed the same client cache (lastStand), and only one of them
   composed the true total. SB.top() -> readRoom() -> nightTotal(v):
   livePts + predPts + catchPts + caughtPts. SB.watchBoard() read raw `pts`
   off the document and nothing else. renderBoard() shows `.total` when
   present, falls back to `.pts` when not — so whichever listener wrote
   most recently decided which number a player saw. `pts` is a legacy field
   a runner writes only at its own scoring passes; catchPts and caughtPts
   are written directly by a player's own device the moment they happen, so
   between runner passes the two genuinely drift.

   This asserts SOURCE (both listeners must compose the same way) and BOTH
   DIRECTIONS of a real drift case: a device that has earned Caught It
   points more recently than the runner's last scoring pass.
   ========================================================================== */
const { chromium } = require('playwright');
const path = require('path');
const F = require('./fixtures.js');
const { waitReady } = require('./ready.js');
const FILE = 'file://' + path.resolve(__dirname, '..', 'index-test.html');

let pass = 0, fail = 0; const bad = [];
const ok = (c, label, detail) => c ? pass++ : (fail++, bad.push(label + (detail ? '  — ' + detail : '')));

(async () => {
  console.log('\n=== BOARD TOTAL ===\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.route('**/site.api.espn.com/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(F.PRE) }));
  await page.route('**/assets.mailerlite.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);

  const r = await page.evaluate(() => {
    /* The exact drifted-document shape: the runner last wrote pts=190
       (an early scoring pass, before Caught It points landed), while the
       lanes underneath have since moved to 480 via the player's own
       device — livePts 160 + predPts 200 + catchPts 90 + caughtPts 30. */
    const v = { name: 'Danthefan', color: '#28e0d0', pts: 190,
                livePts: 160, predPts: 200, catchPts: 90, caughtPts: 30, speed: 40 };
    const trueTotal = 160 + 200 + 90 + 30; // 480

    const watchBoardSrc = String(SB.watchBoard);
    const usesNightTotal = /total:\s*nightTotal\(v\)/.test(watchBoardSrc);
    const sortsOnTotal = /b\.total\s*-\s*a\.total/.test(watchBoardSrc);
    const stillHasRawPts = /pts:\s*Number\(v\.pts\)/.test(watchBoardSrc); // legacy field kept for reference, fine

    /* Drive nightTotal() the same way readRoom() does. */
    const composed = SB.nightTotal(v);

    return { trueTotal, composed, usesNightTotal, sortsOnTotal, stillHasRawPts, rawPts: v.pts };
  });

  console.log('  legacy pts field       = ' + r.rawPts);
  console.log('  true composed total    = ' + r.trueTotal);
  console.log('  SB.nightTotal(v)       = ' + r.composed);
  console.log('  watchBoard uses nightTotal()  : ' + r.usesNightTotal);
  console.log('  watchBoard sorts on total      : ' + r.sortsOnTotal);

  ok(r.rawPts !== r.trueTotal, 'the fixture genuinely drifts (legacy pts != true total)',
     'both are ' + r.rawPts + ' — this case proves nothing');
  ok(r.composed === r.trueTotal, 'SB.nightTotal() composes the correct total',
     'got ' + r.composed + ', expected ' + r.trueTotal);
  ok(r.usesNightTotal, 'SB.watchBoard() composes with nightTotal(), same as SB.top()/readRoom()',
     'watchBoard still reads only the legacy pts field — the two-numbers bug is still live');
  ok(r.sortsOnTotal, 'SB.watchBoard() ranks players by the SAME number it displays',
     'sorting by raw pts while displaying total could rank players out of order with their own shown scores');

  /* End to end: drive the real listener callback shape through renderBoard
     and read what actually prints for this exact drifted player. */
  const rendered = await page.evaluate(() => {
    S.mode = 'live';
    const v = { name: 'Danthefan', color: '#28e0d0', pts: 190,
                livePts: 160, predPts: 200, catchPts: 90, caughtPts: 30, speed: 40 };
    const row = { uid: 'test-dan', name: v.name, color: v.color,
                   pts: Number(v.pts) || 0, total: SB.nightTotal(v), speed: v.speed, me: false };
    try { boardTake([row]); } catch (_) {}
    try { go('board'); renderBoard(); } catch (_) {}
    const el = document.getElementById('bdBody');
    const text = el ? el.textContent : '';
    return { hasTrue: /480/.test(text), hasStale: /190(?!\d)/.test(text) && !/480/.test(text) };
  });
  console.log('  rendered board shows 480 (correct) : ' + rendered.hasTrue);
  ok(rendered.hasTrue, 'the Board screen shows the composed total for a drifted player',
     'the rendered board does not show 480 — still showing something else');
  ok(!rendered.hasStale, 'the Board screen does NOT show the stale legacy number instead',
     'the board fell back to 190, the exact bug reported');

  await browser.close();
  console.log('');
  if (bad.length) { console.log('FAILURES:'); bad.forEach(b => console.log('  ✗ ' + b)); console.log(''); }
  if (pass === 0) { console.log('board-total: RAN NOTHING\n'); process.exit(1); }
  console.log('board-total: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
