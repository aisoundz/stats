/* ============================================================================
   qa/closed-round.js — YOU CANNOT ANSWER A ROUND THE HOST HAS PASSED

   22 Aug archive, slate-2026-08-22-nyg-mia:
     r1 closed 22:34:54 (when r2 opened) · SUB r1-local at 22:37:11, 2 of 4

   The player opened a finished round and answered it. Nothing he did could
   score. His own note the night before: "I could submit answers after the
   game ended."

   Why the app could not see it: the round listener is
   orderBy('seq','desc').limit(1) — one document, the newest. hostedDoc(1)
   returns null once r2 exists, so liveRoundBlocked() saw "no hosted round
   for index 1" and treated it as a hostless night, which is the case the
   built-in deck exists to cover.

   The rule now: the host's own index settles it. Anything before HR.doc.idx
   is finished. And the exceptions matter as much as the rule, so all four
   are asserted:

     · no host at all (HR.doc null)  → NOT blocked. A hostless night is
       played on the built-in deck; blocking it would end the night.
     · the round the host is on now  → NOT blocked. Obviously.
     · a round this phone already started or submitted → NOT blocked, or a
       player who is mid-round when the host advances loses their own work.
     · a past round this phone never saw → BLOCKED. This is the bug.
   ========================================================================== */
const { chromium } = require('playwright');
const path = require('path');
const F = require('./fixtures.js');
const { waitReady } = require('./ready.js');
const FILE = 'file://' + path.resolve(__dirname, '..', 'index-test.html');

let pass = 0, fail = 0; const bad = [];
const ok = (c, label, detail) => c ? pass++ : (fail++, bad.push(label + (detail ? '  — ' + detail : '')));

const CASES = [
  { name: 'past round, never seen by this phone', qi: 1, hostIdx: 2,
    started: false, hostDoc: true,  blocked: true  },
  { name: 'the round the host is on right now',   qi: 2, hostIdx: 2,
    started: false, hostDoc: true,  blocked: false },
  { name: 'past round this phone already started', qi: 1, hostIdx: 2,
    started: true,  hostDoc: true,  blocked: false },
  { name: 'no host at all (hostless night)',       qi: 1, hostIdx: null,
    started: false, hostDoc: false, blocked: false },
];

(async () => {
  console.log('\n=== CLOSED ROUND ===\n');
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

  for (const c of CASES) {
    const r = await page.evaluate((c) => {
      S.mode = 'live'; S.qi = 0; S.screen = 'lobby';
      HR.started = {}; HR.submitted = {}; HR.scored = {}; HR.held = {};
      HR.doc = c.hostDoc ? { id: 'r' + c.hostIdx, idx: c.hostIdx, state: 'live' } : null;
      if (c.started) HR.started['r' + c.qi] = true;

      const verdict = (typeof liveRoundBlocked === 'function') ? liveRoundBlocked(c.qi) : 'NO-FN';

      /* And the behaviour, not just the verdict: does startQuarter actually
         refuse to put the player on the question screen? A guard that
         returns a string and then opens the round anyway is not a guard. */
      const before = S.screen;
      let toasted = '';
      const realToast = window.toast;
      window.toast = function (m) { toasted = String(m || ''); };
      try { startQuarter(c.qi); } catch (_) {}
      window.toast = realToast;

      return { verdict, wentLive: S.screen === 'live', before, toasted };
    }, c);

    console.log('  ' + c.name.padEnd(40) + ' verdict=' + String(r.verdict));
    if (r.toasted) console.log('      says: "' + r.toasted + '"');

    ok(r.verdict !== 'NO-FN', c.name + ' · liveRoundBlocked exists');

    if (c.blocked) {
      ok(r.verdict === 'host-moved-on', c.name + ' · is refused', 'verdict ' + r.verdict);
      ok(!r.wentLive, c.name + ' · and the question screen never opens',
         'startQuarter opened the round anyway');
      ok(/cannot count|finished/i.test(r.toasted), c.name + ' · and the player is told why',
         'said "' + r.toasted + '"');
    } else {
      ok(r.verdict !== 'host-moved-on', c.name + ' · is NOT refused',
         'blocked a round that must stay open');
    }
  }

  await browser.close();
  console.log('');
  if (bad.length) { console.log('FAILURES:'); bad.forEach(b => console.log('  ✗ ' + b)); console.log(''); }
  if (pass === 0) { console.log('closed-round: RAN NOTHING\n'); process.exit(1); }
  console.log('closed-round: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
