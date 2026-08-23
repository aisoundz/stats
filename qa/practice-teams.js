/* ============================================================================
   qa/practice-teams.js — PRACTICE MUST ASK ABOUT THE ROOM YOU ARE IN

   The AI beta tester, in a Giants-Dolphins football room: pressed Practice
   and was asked which of "Denver Broncos" or "Atlanta Falcons" would score
   first. Those are the practice bank's own fixture teams, written into the
   option STRINGS when the bank was authored.

   Why it survived so long: hydrateNight() merges a real night INTO
   SPORTS[sport].game, so GAME.homeName correctly becomes "New York Giants"
   — but the question text is a separate array it never touches. The
   scoreboard and the questions were reading from two different games, and
   only the scoreboard was right.

   And why it could not be fixed by simply reading GAME at question time:
   after hydration there is nothing left to translate FROM. The fixture
   names only exist in the strings. So SPORT.__sample snapshots each sport's
   original team names at boot, before anything can hydrate over them, and
   fixSampleTeams() rewrites the strings at practice time.

   This suite drives that real path — setSport, then hydrate, then
   startDemo — and asserts on the strings a player would actually read.
   ========================================================================== */
const { chromium } = require('playwright');
const path = require('path');
const F = require('./fixtures.js');
const { waitReady } = require('./ready.js');
const FILE = 'file://' + path.resolve(__dirname, '..', 'index-test.html');

/* Each sport, the fixture names to hunt for, and a room to pretend we are
   in. The room teams are deliberately unlike the fixture in every way —
   different city, different nickname, different abbreviation — so a
   partial substitution cannot hide. */
const CASES = [
  { sport: 'football',   fixture: /Denver|Broncos|Atlanta|Falcons/,
    room: { homeName:'New York Giants', awayName:'Miami Dolphins',
            homeNick:'Giants', awayNick:'Dolphins', homeAbbr:'NYG', awayAbbr:'MIA' },
    roomRe: /Giants|Dolphins/ },
  { sport: 'baseball',   fixture: /Atlanta|Braves|Arizona|Diamondbacks/,
    room: { homeName:'Seattle Mariners', awayName:'Detroit Tigers',
            homeNick:'Mariners', awayNick:'Tigers', homeAbbr:'SEA', awayAbbr:'DET' },
    roomRe: /Mariners|Tigers/ },
  { sport: 'basketball', fixture: /Golden State|Valkyries|Minnesota|Lynx/,
    room: { homeName:'Phoenix Mercury', awayName:'Chicago Sky',
            homeNick:'Mercury', awayNick:'Sky', homeAbbr:'PHX', awayAbbr:'CHI' },
    roomRe: /Mercury|Sky/ },
];

let pass = 0, fail = 0; const bad = [];
const ok = (c, label, detail) => c ? pass++ : (fail++, bad.push(label + (detail ? '  — ' + detail : '')));

(async () => {
  console.log('\n=== PRACTICE TEAMS ===\n');
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
      const fixture = new RegExp(c.fixture.source);
      const roomRe  = new RegExp(c.roomRe.source);

      if (!setSport(c.sport)) return { skip: 'sport not present' };
      const sample = SPORT.__sample;

      /* Everything a player reads during practice: prompts, options, and
         the Spanish of both. Answers too — a stale answer string grades
         against a team that is not playing. */
      const harvest = () => {
        const out = [];
        (rounds || []).forEach(rd => (rd && rd.q || []).forEach(q => {
          if (!q) return;
          [q.t, q.t_es, q.a].forEach(v => { if (typeof v === 'string') out.push(v); });
          (q.o || []).forEach(o => out.push(String(o)));
          (q.o_es || []).forEach(o => out.push(String(o)));
        }));
        (preds || []).forEach(pd => {
          if (!pd) return;
          (pd.opts || []).forEach(o => out.push(String(o)));
          if (typeof pd.answer === 'string') out.push(pd.answer);
        });
        return out;
      };

      const before = harvest().filter(s => fixture.test(s));

      /* What hydrateNight() does when you walk into a real room. */
      Object.keys(c.room).forEach(k => { GAME[k] = c.room[k]; });

      startDemo();
      const after = harvest();
      const stale = after.filter(s => fixture.test(s));
      const fresh = after.filter(s => roomRe.test(s));

      startDemo();                                   /* twice */
      const twice = harvest().filter(s => roomRe.test(s));

      return {
        sampleCaptured: !!(sample && sample.home && sample.away),
        beforeN: before.length, staleN: stale.length, freshN: fresh.length,
        twiceN: twice.length,
        staleEg: stale.slice(0, 3), freshEg: fresh.slice(0, 2)
      };
    }, { sport: c.sport, fixture: { source: c.fixture.source },
         roomRe: { source: c.roomRe.source }, room: c.room });

    const tag = c.sport;
    if (r.skip) { ok(false, tag + ' · ' + r.skip); continue; }

    ok(r.sampleCaptured, tag + ' · the fixture names were snapshotted at boot',
       'without SPORT.__sample there is nothing to translate from');

    /* The suite is only meaningful if this bank ever named its fixture.
       If a bank stops hardcoding names, this check should be deleted
       deliberately, not left passing on an empty set. */
    ok(r.beforeN > 0, tag + ' · the bank does hardcode fixture names (else this suite proves nothing)',
       'found 0 — has the bank changed shape?');

    ok(r.staleN === 0, tag + ' · practice names no fixture team',
       r.staleN ? r.staleN + ' left: ' + JSON.stringify(r.staleEg) : '');

    ok(r.freshN > 0, tag + ' · practice names the room you are in',
       r.freshN ? '' : 'nothing mentions the room teams');

    ok(r.twiceN === r.freshN, tag + ' · running practice twice changes nothing',
       r.twiceN + ' vs ' + r.freshN);

    if (!r.skip) console.log('  ' + tag.padEnd(11) + r.beforeN + ' fixture strings → ' +
      r.staleN + ' stale, ' + r.freshN + ' now name the room  ' +
      (r.freshEg.length ? JSON.stringify(r.freshEg[0]) : ''));
  }

  await browser.close();
  console.log('');
  if (bad.length) { console.log('FAILURES:'); bad.forEach(b => console.log('  ✗ ' + b)); console.log(''); }
  if (pass === 0) { console.log('practice-teams: RAN NOTHING\n'); process.exit(1); }
  console.log('practice-teams: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
