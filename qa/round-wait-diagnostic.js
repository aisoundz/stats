/* ============================================================================
   qa/round-wait-diagnostic.js — A NUMBER FOR NEXT TIME

   23 Aug: a device showed "Innings 1-3 open after the 3rd" while the game
   was in the middle of the 4th, and Firestore confirmed round 0 had opened
   nine minutes earlier. roomNextRound()/hostedDoc() read correctly on a
   static trace — the remaining suspect is a round-watch listener that
   looks attached (HR.unsub set, SB.roundWatchOk true) but has quietly
   stopped receiving Firestore pushes, which nothing detects today.

   Diagnosing that properly needs the feed's current period as a number,
   and the client only has that as free text (GS.detail) — not a fix to
   guess at overnight. This is the cheap, safe half: SB.lastRoundWatchAt
   already existed and was never read. It is recorded now at the exact
   moment a player is shown the "waiting" screen, rate-limited so a
   repaint every tick cannot spam it. Next occurrence, the question "was
   the listener actually stale" is one number in the trk stream instead of
   an hour of reconstructing Firestore timestamps by hand.
   ========================================================================== */
const { chromium } = require('playwright');
const path = require('path');
const F = require('./fixtures.js');
const { waitReady } = require('./ready.js');
const FILE = 'file://' + path.resolve(__dirname, '..', 'index-test.html');

let pass = 0, fail = 0; const bad = [];
const ok = (c, label, detail) => c ? pass++ : (fail++, bad.push(label + (detail ? '  — ' + detail : '')));

(async () => {
  console.log('\n=== ROUND WAIT DIAGNOSTIC ===\n');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  await page.route('**/site.api.espn.com/**', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(F.PRE) }));
  await page.route('**/assets.mailerlite.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await page.goto(FILE, { waitUntil: 'domcontentloaded' });
  await waitReady(page);

  const r = await page.evaluate(() => {
    const seen = [];
    const realTrk = window.trk;
    window.trk = function (name, props) { seen.push({ name, props }); };
    S.mode = 'live'; S.screen = 'gametime'; GT_WAIT_LOGGED = null;
    HR.doc = null; HR.started = {}; HR.submitted = {}; HR.held = {};
    SB.lastRoundWatchAt = Date.now() - 543000; // the 23 Aug shape: looks alive, is 9 minutes stale
    SB.roundWatchOk = true; SB.enabled = true;
    gtStartRow();
    gtStartRow();                    // same qi, immediately again
    const afterRepeat = seen.length;
    GT_WAIT_LOGGED = null;            // simulate advancing to a DIFFERENT round
    HR.doc = null;
    gtStartRow();
    window.trk = realTrk;
    return { seen, afterRepeat };
  });

  console.log('  events: ' + JSON.stringify(r.seen.map(e => e.name + ' ' + JSON.stringify(e.props))));

  ok(r.seen.length >= 1, 'the wait screen logs a diagnostic event', 'nothing was logged at all');
  ok(r.afterRepeat === 1, 'repainting the SAME round does not log again',
     'logged ' + r.afterRepeat + ' times for one round — this would spam the trk stream every tick');
  const ev = r.seen[0] || {};
  ok(ev.name === 'round_wait_shown', 'the event is named round_wait_shown', 'got ' + ev.name);
  ok(ev.props && typeof ev.props.sinceListenerMs === 'number' && ev.props.sinceListenerMs > 500000,
     'it carries how long since the listener last actually fired',
     'sinceListenerMs = ' + (ev.props && ev.props.sinceListenerMs) + ' — this is the whole point of the diagnostic');
  ok(ev.props && ev.props.roundWatchOk === true,
     'and it carries whether the listener LOOKS healthy — the zombie case looks healthy',
     'roundWatchOk missing or wrong — cannot distinguish "genuinely dead" from "quietly stale"');
  ok(r.seen.length === 2, 'a genuinely different round DOES get its own log line',
     'only ' + r.seen.length + ' event(s) total — the rate limit is keyed too broadly');

  await browser.close();
  console.log('');
  if (bad.length) { console.log('FAILURES:'); bad.forEach(b => console.log('  ✗ ' + b)); console.log(''); }
  if (pass === 0) { console.log('round-wait-diagnostic: RAN NOTHING\n'); process.exit(1); }
  console.log('round-wait-diagnostic: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
