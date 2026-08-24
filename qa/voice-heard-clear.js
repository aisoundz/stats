/* ============================================================================
   qa/voice-heard-clear.js — A STALE "HEARD" LINE MUST NOT OUTLIVE THE QUESTION

   24 Aug, from real screenshots: the same heard: "..." debug text — ambient
   TV dialogue, misrecognised — sat on screen UNCHANGED across two entirely
   different questions (Question 2 of 4, then Question 3 of 4), with two
   different manually-tapped answers made in between. V.lastHeard was
   written once by the speech recogniser and never cleared anywhere, so a
   mishear from three questions ago looked identical to a mishear on THIS
   question — which is exactly the confusion that first read as a possible
   scoring-integrity bug before the screenshots proved it was cosmetic.

   Drives the real loadQuestion() across a question transition and reads
   what the voice bar actually renders, not a reimplementation.
   ========================================================================== */
const { chromium } = require('playwright');
const path = require('path');
const F = require('./fixtures.js');
const { waitReady } = require('./ready.js');
const FILE = 'file://' + path.resolve(__dirname, '..', 'index-test.html');

let pass = 0, fail = 0; const bad = [];
const ok = (c, label, detail) => c ? pass++ : (fail++, bad.push(label + (detail ? '  — ' + detail : '')));

(async () => {
  console.log('\n=== VOICE HEARD LINE CLEARS ===\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.route('**/site.api.espn.com/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(F.PRE) }));
  await page.route('**/assets.mailerlite.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);

  const r = await page.evaluate(() => {
    S.mode = 'demo'; S.qi = 2; S.ni = 0;
    try { VX.on = true; VX.mount(); } catch (_) {}

    /* Question 2: the recogniser hears TV noise, exactly the reported
       phrase, and it renders on screen — sanity-checking the SETUP, not
       the fix, before touching anything. */
    VX.lastHeard = "that and that's why you don't have insurance company";
    try { loadQuestion(); } catch (_) {}
    /* loadQuestion() itself would have cleared this — so set it back
       AFTER, to capture what a real recognition event during Q2 would
       have looked like, before moving to Q3. */
    VX.lastHeard = "that and that's why you don't have insurance company";
    try { VX.paint(); } catch (_) {}
    const barQ2 = document.getElementById('vxBar');
    const q2HasHeard = !!(barQ2 && /insurance/.test(barQ2.textContent || ''));

    /* Move to the next question WITHOUT any new speech event — the exact
       shape of the bug: nothing was said, the old text just sat there. */
    S.ni = 1;
    try { loadQuestion(); } catch (_) {}
    const barQ3 = document.getElementById('vxBar');
    const q3Text = barQ3 ? (barQ3.textContent || '') : '';
    const q3StillHasStale = /insurance/.test(q3Text);

    return { q2HasHeard, q3StillHasStale, lastHeardAfter: VX.lastHeard, q3Text: q3Text.slice(0, 120) };
  });

  console.log('  Q2, a real heard-phrase renders : ' + r.q2HasHeard);
  console.log('  Q3, V.lastHeard after transition: ' + JSON.stringify(r.lastHeardAfter));
  console.log('  Q3, stale text still on screen  : ' + r.q3StillHasStale);

  ok(r.q2HasHeard, 'the heard line renders at all when there really is one (setup sanity check)',
     'if this fails the test below proves nothing');
  ok(r.lastHeardAfter === '' || r.lastHeardAfter == null,
     'V.lastHeard is cleared by loadQuestion()', 'still ' + JSON.stringify(r.lastHeardAfter));
  ok(!r.q3StillHasStale, 'the stale heard line is gone from the new question',
     'Q3 still shows: ' + r.q3Text);

  await browser.close();
  console.log('');
  if (bad.length) { console.log('FAILURES:'); bad.forEach(b => console.log('  ✗ ' + b)); console.log(''); }
  if (pass === 0) { console.log('voice-heard-clear: RAN NOTHING\n'); process.exit(1); }
  console.log('voice-heard-clear: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
