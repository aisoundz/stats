/* ============================================================================
   qa/sub-receipt.js — THE RECEIPT MUST MATCH WHAT ACTUALLY HAPPENED

   From the 22 August archive, room slate-2026-08-22-nyg-mia:

     round r1  opened 21:43:36, closed when r2 opened 22:34:54
     SUB   r1-local  Courtside  at 22:37:11  src=built-in  picks 2 of 4

   A player answered a round that had been closed for three minutes. The
   answers filed to 'r1-local', which is correct — a deck the host never
   served must never wear a hosted round's id, or it gets graded against a
   key it never saw (that is the 20 Aug "0 for 4 on questions I never saw"
   bug, and the guard that prevents it is working).

   What was NOT correct is what the player was told. subReceiptFor() was
   called with 'r1' while the write went to 'r1-local', so it asked for the
   status of a document nobody had written, got nothing, and hid itself.
   The player did the work and received no confirmation of any kind.

   Two things are asserted here, and they fail for different reasons:
     · the receipt is VISIBLE for a local filing   (it was hidden)
     · the receipt SAYS it will not score          (it must not claim
       "the host has them", which is the sentence shown for a real one)
   ========================================================================== */
const { chromium } = require('playwright');
const path = require('path');
const F = require('./fixtures.js');
const { waitReady } = require('./ready.js');
const FILE = 'file://' + path.resolve(__dirname, '..', 'index-test.html');

let pass = 0, fail = 0; const bad = [];
const ok = (c, label, detail) => c ? pass++ : (fail++, bad.push(label + (detail ? '  — ' + detail : '')));

(async () => {
  console.log('\n=== SUBMISSION RECEIPT ===\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.route('**/site.api.espn.com/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(F.PRE) }));
  await page.route('**/assets.mailerlite.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  /* waitReady(), not a guess at boot. It waits for the app's own
       STATS_READY flag and, when that never arrives, says plainly that
       this is a BOOT failure rather than a defect in the thing under
       test — which is the message qa/stats-page.js needed and did not
       have when it spent an evening skipping a sport per run. */
    await waitReady(page);

  /* Both filings, driven through the real lockPicks(). The only difference
     between them is HR.started — which is exactly the thing that decides
     whether a round can ever be scored. */
  const cases = [
    { name: 'hosted round (the host served it)', hosted: true,
      mustSay: /host has them/i,  mustNotSay: /will not score/i },
    { name: 'closed round (local filing)',        hosted: false,
      mustSay: /will not score/i, mustNotSay: /host has them/i },
  ];

  for (const c of cases) {
    const r = await page.evaluate((c) => {
      const rid = 'r1', idx = 1;

      /* A live room with a host on a LATER round — the exact shape of the
         22 Aug archive: the player is reaching back at r1 while the host
         has moved on to r2. */
      S.mode = 'live'; S.qi = idx; S.nextQ = idx;
      S.liveAnswers[idx] = [{ choice: 'a', bank: 0 }, { choice: 'b', bank: 0 },
                            { choice: '',  bank: 0 }, { choice: 'c', bank: 0 }];
      try { rounds[idx] = rounds[idx] || {}; rounds[idx].q = rounds[idx].q || [
        { t: 'q1', o: ['a', 'b'], a: 'a' }, { t: 'q2', o: ['a', 'b'], a: 'b' },
        { t: 'q3', o: ['a', 'b'], a: 'a' }, { t: 'q4', o: ['a', 'b'], a: 'c' }]; } catch (_) {}

      HR.doc = { id: 'r2', idx: 2, state: 'live' };
      HR.started = {}; HR.submitted = {}; HR.scored = {};
      if (c.hosted) HR.started[rid] = true;

      try { LOCKED[rid] = false; } catch (_) {}
      try { Object.keys(RCPT_LOCAL).forEach(k => delete RCPT_LOCAL[k]); } catch (_) {}

      /* Capture the write without performing it, and drive the receipt
         through the same states a real send goes through. */
      const wrote = [];
      const realSubmit = SB.submit;
      SB.submit = function (id, body) {
        wrote.push(id);
        try { SB.__mark && SB.__mark(id, 'saved'); } catch (_) {}
        return Promise.resolve(true);
      };
      SB.enabled = true;

      lockPicks(idx);
      SB.submit = realSubmit;

      /* Force the receipt to the 'saved' state for the id that was written,
         then paint. subStateOf is the app's own reader. */
      const written = wrote[0] || '';
      const prevStateOf = SB.subStateOf;
      SB.subStateOf = function (id) { return id === written ? 'saved' : ''; };
      try { paintSubReceipt(); } catch (_) {}
      SB.subStateOf = prevStateOf;

      const el = document.getElementById('subRcpt');
      const cs = el ? getComputedStyle(el) : null;
      return {
        written,
        visible: !!(el && cs && cs.display !== 'none' && el.style.display !== 'none'),
        text: el ? (el.textContent || '').trim() : '(no element)',
        flagged: (() => { try { return !!RCPT_LOCAL[written]; } catch (_) { return null; } })()
      };
    }, c);

    console.log('  ' + c.name);
    console.log('     wrote to : ' + (r.written || '(nothing)'));
    console.log('     receipt  : ' + (r.visible ? '"' + r.text + '"' : '(HIDDEN)'));

    ok(r.written === (c.hosted ? 'r1' : 'r1-local'),
       c.name + ' · files under the right id', 'wrote ' + r.written);

    ok(r.visible, c.name + ' · the player is shown a receipt at all',
       'the element was hidden — the player got no confirmation');

    ok(c.mustSay.test(r.text), c.name + ' · the receipt says the right thing',
       'expected ' + c.mustSay + ', got "' + r.text + '"');

    ok(!c.mustNotSay.test(r.text), c.name + ' · and not the wrong thing',
       'must not match ' + c.mustNotSay);
  }

  await browser.close();
  console.log('');
  if (bad.length) { console.log('FAILURES:'); bad.forEach(b => console.log('  ✗ ' + b)); console.log(''); }
  if (pass === 0) { console.log('sub-receipt: RAN NOTHING\n'); process.exit(1); }
  console.log('sub-receipt: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
