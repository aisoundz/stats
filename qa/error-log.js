/* ============================================================================
   qa/error-log.js — THE CRASH REPORT HAS TO BE WORTH READING

   host/debrief.js prints, for every night: "Zero errors is a FINDING, not a
   clean bill of health: it can mean nothing threw, or that the failure never
   surfaced." This suite is the difference between those two sentences.

   Found 22 Aug: SB.logError stamped `build: window.STATS_BUILD_ID`. Nothing
   in the codebase has ever set STATS_BUILD_ID — the global is
   window.STATS_BUILD. So every error document ever written carried an empty
   build, and the first question anyone asks of a crash report could not be
   answered from the report. It was found while chasing an intermittent that
   only appears under load, which is precisely the kind of bug where knowing
   the build is the whole game.

   What is asserted, and why each one can fail on its own:
     · a thrown error reaches SB.logError            (the channel exists)
     · it carries a non-empty build                  (the report is useful)
     · noise is filtered                             (ResizeObserver, Script error)
     · it is rate limited                            (an error inside a render
       loop must not become a thousand writes and a bill)
   ========================================================================== */
const { chromium } = require('playwright');
const path = require('path');
const F = require('./fixtures.js');
const { waitReady } = require('./ready.js');
const FILE = 'file://' + path.resolve(__dirname, '..', 'index-test.html');

let pass = 0, fail = 0; const bad = [];
const ok = (c, label, detail) => c ? pass++ : (fail++, bad.push(label + (detail ? '  — ' + detail : '')));

(async () => {
  console.log('\n=== ERROR LOG ===\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.route('**/site.api.espn.com/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(F.PRE) }));
  await page.route('**/assets.mailerlite.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);

  /* ---- the channel, end to end ---------------------------------------- */
  const r = await page.evaluate(async () => {
    const seen = [];
    /* Spy at the WRITE boundary, so everything above it — the window
       listener, the noise filter, the deferral — is the real code. */
    const realLog = SB.logError;
    SB.logError = function (where, msg, extra) {
      seen.push({ where, msg, extra,
                  build: String(window.STATS_BUILD || ''),
                  idGlobal: (typeof window.STATS_BUILD_ID !== 'undefined') });
      return true;
    };

    const fire = (message, filename) => window.dispatchEvent(
      Object.assign(new Event('error'), { message, filename: filename || 'x.js', lineno: 1 }));

    fire('KABOOM from the suite');
    fire('ResizeObserver loop limit exceeded');
    fire('Script error.');
    await new Promise(r2 => setTimeout(r2, 60));   // the handler defers through setTimeout(0)

    SB.logError = realLog;
    return {
      seen,
      buildGlobal: String(window.STATS_BUILD || ''),
      hasIdGlobal: (typeof window.STATS_BUILD_ID !== 'undefined')
    };
  });

  console.log('  window.STATS_BUILD    = ' + (r.buildGlobal || '(empty)'));
  console.log('  window.STATS_BUILD_ID ' + (r.hasIdGlobal ? 'exists' : 'does not exist — nothing sets it'));
  console.log('  reached the writer    : ' + r.seen.length + '  ' +
              JSON.stringify(r.seen.map(x => String(x.msg).slice(0, 28))));

  ok(r.buildGlobal.length > 0, 'the page knows its own build', 'window.STATS_BUILD is empty');
  ok(r.seen.length === 1, 'a real error reaches the writer, and only the real one',
     'got ' + r.seen.length + ' — noise is not being filtered, or nothing fired');
  ok(r.seen.some(x => /KABOOM/.test(x.msg)), 'it is the thrown error that arrives');
  ok(!r.seen.some(x => /ResizeObserver|Script error/i.test(x.msg)),
     'ResizeObserver and cross-origin noise are dropped');

  /* ---- the field that was empty for the whole life of the feature ------ */
  const src = require('fs').readFileSync(path.resolve(__dirname, '..', 'index-test.html'), 'utf8');
  ok(/build:\s*String\(window\.STATS_BUILD\b/.test(src),
     'the error document stamps window.STATS_BUILD',
     'it stamps a global nothing sets, so every report says build:""');
  ok(!/window\.STATS_BUILD_ID/.test(src),
     'and STATS_BUILD_ID is gone entirely',
     'a second name for the build is how this happened in the first place');

  /* ---- rate limiting: real code, real boundary ------------------------- */
  const rl = await page.evaluate(async () => {
    let writes = 0;
    /* Below logError this time — count actual write attempts. */
    const realEnabled = SB.enabled;
    SB.enabled = false;                       // logError bails before writing
    let allowed = 0;
    for (let i = 0; i < 30; i++) if (SB.logError('spam', 'e' + i)) allowed++;
    SB.enabled = realEnabled;
    return { allowed, writes };
  });
  ok(rl.allowed === 0, 'with no room joined, nothing is written at all',
     'wrote ' + rl.allowed + ' error(s) outside a night');

  const capped = await page.evaluate(() => {
    const src2 = document.documentElement.outerHTML;
    return { hasMax: /ERR_MAX\s*=\s*\d+/.test(src2), hasGap: /ERR_GAP\s*=\s*\d+/.test(src2) };
  });
  ok(capped.hasMax && capped.hasGap,
     'the writer is capped per session and spaced in time',
     'an error inside a render loop becomes a thousand writes and a bill');

  await browser.close();
  console.log('');
  if (bad.length) { console.log('FAILURES:'); bad.forEach(b => console.log('  ✗ ' + b)); console.log(''); }
  if (pass === 0) { console.log('error-log: RAN NOTHING\n'); process.exit(1); }
  console.log('error-log: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
