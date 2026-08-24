/* ============================================================================
   qa/ci-missed-card.js — A MISSED CAUGHT IT CARD MUST NOT WAIT FOREVER

   23 Aug: "when the caught it question was done and I missed it it just
   stayed stuck on the screen." Confirmed in the code: the locked/unanswered
   branch of renderCiCard() never scheduled a hide of its own — it depended
   entirely on the server's 'resolved' write reaching this device and
   triggering a fresh render, which is a different branch and the only one
   that calls ciHideSoon(). A missed snapshot, a listener hiccup, or simply
   a slow resolve left the card frozen with disabled buttons and "the
   answer lands in a moment" forever.

   This intercepts the actual setTimeout calls ciHideSoon() makes — not a
   reimplementation — across three real states driven through the real
   renderCiCard(): still open, answered-and-waiting, and the bug's exact
   case, locked-and-missed.
   ========================================================================== */
const { chromium } = require('playwright');
const path = require('path');
const F = require('./fixtures.js');
const { waitReady } = require('./ready.js');
const FILE = 'file://' + path.resolve(__dirname, '..', 'index-test.html');

let pass = 0, fail = 0; const bad = [];
const ok = (c, label, detail) => c ? pass++ : (fail++, bad.push(label + (detail ? '  — ' + detail : '')));

(async () => {
  console.log('\n=== CAUGHT IT — MISSED CARD ===\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.route('**/site.api.espn.com/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(F.PRE) }));
  await page.route('**/assets.mailerlite.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);

  const cases = [
    { name: 'still open, not locked',        opensAgo: 1000,  answered: false, expectHide: null },
    { name: 'locked, ANSWERED (the normal receipt)', opensAgo: 25000, answered: true,  expectHide: 4000 },
    { name: 'locked, MISSED — the 23 Aug bug', opensAgo: 25000, answered: false, expectHide: 15000 },
  ];

  for (const c of cases) {
    const r = await page.evaluate((c) => {
      const q = {
        qid: 'miss-test-' + Math.random().toString(36).slice(2),
        kind: 'sawPitch', state: 'open',
        prompt: 'Test question', options: [{ v: 'a', k: 'A' }, { v: 'b', k: 'B' }],
        opensAt: { toMillis: () => Date.now() - c.opensAgo }, locksMs: 20000
      };
      try { PCI.muted = false; S.mode = 'live'; S.screen = 'gametime'; } catch (_) {}
      if (c.answered) { try { PCI.picked[q.qid] = 'a'; } catch (_) {} }
      try { ensureCiCard(); } catch (_) {}

      const seen = [];
      const realTimeout = window.setTimeout;
      window.setTimeout = function (fn, ms) { seen.push(ms); return realTimeout(fn, ms); };
      renderCiCard(q);
      window.setTimeout = realTimeout;

      const card = document.getElementById('ciCard');
      return {
        timeouts: seen,
        cardVisible: !!(card && card.style.display !== 'none'),
        cardText: card ? (card.textContent || '').slice(0, 80) : ''
      };
    }, c);

    console.log('  ' + c.name.padEnd(38) + ' setTimeout calls: ' + JSON.stringify(r.timeouts));

    if (c.expectHide == null) {
      ok(!r.timeouts.includes(4000) && !r.timeouts.includes(15000),
         c.name + ' · no hide is scheduled while the card is genuinely still live',
         'scheduled ' + JSON.stringify(r.timeouts));
    } else {
      ok(r.timeouts.includes(c.expectHide),
         c.name + ' · a hide is scheduled at ' + c.expectHide + 'ms',
         'got ' + JSON.stringify(r.timeouts) + ' — the card would sit there indefinitely');
    }
    ok(r.cardVisible, c.name + ' · the card is showing right now (this is about what happens NEXT, not now)');
  }

  /* The core regression, stated as one fact: the missed+locked case used to
     schedule NOTHING at all. */
  const missed = await page.evaluate(() => {
    S.mode = 'live'; S.screen = 'gametime';
    try { ensureCiCard(); } catch (_) {}
    const q = { qid: 'miss-fact-' + Math.random().toString(36).slice(2), kind: 'sawPitch', state: 'open',
      prompt: 'x', options: [{ v: 'a', k: 'A' }],
      opensAt: { toMillis: () => Date.now() - 25000 }, locksMs: 20000 };
    const seen = [];
    const real = window.setTimeout;
    window.setTimeout = function (fn, ms) { seen.push(ms); return real(fn, ms); };
    renderCiCard(q);
    window.setTimeout = real;
    return seen;
  });
  ok(missed.length > 0 && missed.some(ms => ms >= 5000),
     'a missed card schedules SOME eventual cleanup, not zero timers',
     'scheduled ' + JSON.stringify(missed) + ' — this is the exact "stayed stuck" state');

  await browser.close();
  console.log('');
  if (bad.length) { console.log('FAILURES:'); bad.forEach(b => console.log('  ✗ ' + b)); console.log(''); }
  if (pass === 0) { console.log('ci-missed-card: RAN NOTHING\n'); process.exit(1); }
  console.log('ci-missed-card: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
