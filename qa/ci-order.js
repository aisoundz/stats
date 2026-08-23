/* ============================================================================
   qa/ci-order.js — THE EASY QUESTIONS GO LAST

   The AI beta tester was asked "Scoreboard check — who is ahead right now?"
   with the scoreboard on screen. He answered without looking up. A Caught
   It that can be answered by reading the thing next to it is a free point,
   and free points teach a player that watching is optional — which is the
   one thing this product sells.

   The rule this suite enforces is NOT "never ask it". Early in a quarter
   there is not enough play-by-play for ciQtrBank() to ask anything, and a
   silent Caught It is worse than an easy one. The rule is ORDER: every
   question that requires having watched comes first, and the pure score
   reads sit at the back where they are reached only if nothing else is.

   Both halves are asserted, because each one alone is satisfiable by a
   change that breaks the product:
     · glance questions last          — or the free point comes back
     · glance questions still present — or Caught It goes silent early on
   ========================================================================== */
const { chromium } = require('playwright');
const path = require('path');
const F = require('./fixtures.js');
const { waitReady } = require('./ready.js');
const FILE = 'file://' + path.resolve(__dirname, '..', 'index-test.html');

const GLANCE = ['ci-ahead', 'ci-margin'];

let pass = 0, fail = 0; const bad = [];
const ok = (c, label, detail) => c ? pass++ : (fail++, bad.push(label + (detail ? '  — ' + detail : '')));

(async () => {
  console.log('\n=== CAUGHT IT ORDER ===\n');
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

  /* Two states of the same game. THIN is a quarter that has barely
     started — the case the glance questions exist to cover. RICH has a
     full quarter of play-by-play behind it, which is when they must not
     be reached. */
  const scenarios = [
    { name: 'thin  (quarter just started)', plays: 3 },
    { name: 'rich  (a full quarter played)', plays: 40 },
  ];

  for (const sc of scenarios) {
    const r = await page.evaluate((sc) => {
      /* A believable in-game feed. Scores differ so the glance questions
         are generated at all; a tie suppresses them and the suite would
         pass on an empty set. */
      /* A team as the feed reader actually builds it. The first version of
         this fixture was a plain {ab, score} — ciLiveBank() calls
         A.stat(label) for the team-level questions, threw "A.stat is not a
         function", and the whole bank came back EMPTY. The suite then
         reported that no scoreboard question was ever offered, which is
         the result it was looking for, for entirely the wrong reason. A
         fixture that is missing a method the real object has does not test
         the code — it tests the catch block. */
      const mkTeam = (ab, name, score, m) => ({
        ab, name, score, m, home: ab === 'NYG', rec: '1-0',
        color: '#0b2265', alt: '#a71930',
        stat: function (k) { return this.m[k]; }
      });
      const A = mkTeam('NYG', 'New York Giants', 24, {
        'Field Goal %': '48.1', 'Three Point %': '39.0', 'Rebounds': '31',
        'Turnovers': '8', 'Assists': '17', 'Last Ten Games': '6-4' });
      const B = mkTeam('MIA', 'Miami Dolphins', 17, {
        'Field Goal %': '43.4', 'Three Point %': '31.2', 'Rebounds': '26',
        'Turnovers': '12', 'Assists': '11', 'Last Ten Games': '4-6' });
      const plays = [];
      for (let i = 0; i < sc.plays; i++) {
        plays.push({ period: 2, scoring: i % 3 === 0, value: i % 3 === 0 ? 3 : 0,
                     text: 'play ' + i, team: i % 2 ? 'NYG' : 'MIA',
                     clock: '10:00', athlete: (i % 2 ? 'A. Player' : 'B. Player') });
      }
      const box = {
        /* Keyed by the labels sportCfg().box actually names — PTS/REB/AST,
           not points/rebounds/assists. */
        'A. Player': { team: 'NYG', PTS: 18, REB: 4, AST: 2, STL: 1, BLK: 0 },
        'B. Player': { team: 'MIA', PTS: 11, REB: 7, AST: 5, STL: 2, BLK: 1 },
        'C. Player': { team: 'NYG', PTS:  6, REB: 1, AST: 1, STL: 0, BLK: 0 },
      };
      GS.ok = true; GS.teams = [A, B]; GS.plays = plays; GS.box = box;
      GS.state = 'in'; GS.period = 2; GS.clock = '10:00';

      let bank = [];
      try { bank = ciBank(); } catch (e) { return { err: String(e).slice(0, 120) }; }
      const ids = bank.map(x => x && x.qid).filter(Boolean);
      return { ids, n: ids.length, inGame: (typeof gsInGame === 'function') ? gsInGame() : null };
    }, sc);

    if (r.err) { ok(false, sc.name + ' · ciBank() threw', r.err); continue; }

    console.log('  ' + sc.name + '  →  ' + r.n + ' question(s)');
    console.log('     ' + JSON.stringify(r.ids));

    ok(r.n > 0, sc.name + ' · the bank is not empty',
       'nothing to ask means Caught It goes silent');

    const present = GLANCE.filter(g => r.ids.indexOf(g) >= 0);
    ok(present.length > 0, sc.name + ' · the score reads still exist as a fallback',
       'they were removed — early in a quarter there will be nothing to ask');

    /* The real assertion. Every glance question must sit behind every
       question that is not one. */
    const lastEarned = r.ids.reduce((acc, id, i) => GLANCE.indexOf(id) < 0 ? i : acc, -1);
    const firstGlance = r.ids.reduce((acc, id, i) => (acc < 0 && GLANCE.indexOf(id) >= 0) ? i : acc, -1);
    const earnedCount = r.ids.filter(id => GLANCE.indexOf(id) < 0).length;

    if (earnedCount === 0) {
      /* Legitimate in the thin case: nothing but glance questions exist.
         Say so out loud rather than counting it as a silent pass. */
      console.log('     (only score reads available — this is the case they exist for)');
      ok(true, sc.name + ' · order holds (nothing else was askable)');
    } else {
      ok(firstGlance > lastEarned,
         sc.name + ' · every score read sits behind every earned question',
         'first glance at ' + firstGlance + ', last earned at ' + lastEarned);
    }
  }

  /* And the specific thing he saw: with a full quarter behind it, the
     FIRST question offered must not be the scoreboard. */
  const first = await page.evaluate(() => { try { return (ciBank()[0] || {}).qid || null; } catch (_) { return null; } });
  ok(first && GLANCE.indexOf(first) < 0,
     'rich  · the first question offered is not a scoreboard read', 'got ' + first);

  await browser.close();
  console.log('');
  if (bad.length) { console.log('FAILURES:'); bad.forEach(b => console.log('  ✗ ' + b)); console.log(''); }
  if (pass === 0) { console.log('ci-order: RAN NOTHING\n'); process.exit(1); }
  console.log('ci-order: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
