#!/usr/bin/env node
/* THE MARQUEE FOLLOWS THE CLOCK
   ------------------------------------------------------------------
   Founder, 20 Aug 2026, looking at the live front door at 4pm while the
   5:05 baseball room was the next thing to open: the hero was counting down
   to the 7:00 football game. "Yes that should be the case, it should always
   be in order."

   The old rule ranked gotn, then flagship, then earliest tip, so the star
   decided the countdown. On a four-room Saturday running 10:00 to 7:30 that
   pins the marquee to one game for nine and a half hours: somebody opening
   the site at noon is counted down to something six hours away while the
   room they could actually join goes unmentioned.

   Every case below FAILS against that old rule, which is the only reason
   this file is worth running. The first one returns the starred late game
   instead of the early one, and the rest fall over in the same way.

   Usage: node qa/marquee-order.js [index-test.html]                     */

const { chromium } = require('playwright');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TARGET = process.argv.slice(2).find(a => /\.html$/.test(a) && a[0] !== '-') || 'index.html';

let PASS = 0, FAIL = 0;
const ok = (id, cond, why) => {
  if (cond) { PASS++; console.log(`  \x1b[32m✓\x1b[0m ${id}`); }
  else { FAIL++; console.log(`  \x1b[31m✗ ${id}\x1b[0m — ${why}`); }
};

(async () => {
  console.log(`\n  MARQUEE ORDER — is the hero the game that is on, or next?\n`);
  console.log(`  judging ${path.basename(TARGET)}\n`);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e.message || e)));
  await p.goto('file://' + path.join(ROOT, path.basename(TARGET)), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STATS_READY === true, { timeout: 60000 }).catch(() => {});

  const r = await p.evaluate(() => {
    const iso = ms => new Date(Date.now() + ms).toISOString();
    const mk = (id, off, extra) => Object.assign(
      { nightId: id, away: 'A', home: 'B', sport: 'basketball', league: 'wnba', tipISO: iso(off) }, extra || {});
    /* the marquee must not be suppressed by a room the walker is "in" */
    try { ACTIVE_ROOM = ''; GAME = {}; } catch (_) {}
    const pick = () => { TONIGHT = null; try { featureTonight(); } catch (e) { return 'THREW: ' + e.message; }
                         return TONIGHT && TONIGHT.nightId; };
    const out = {};
    SLATE.games = [mk('late', 4 * 3600e3, { gotn: true }), mk('soon', 3600e3), mk('mid', 2 * 3600e3)];
    out.earliest = pick();
    SLATE.games = [mk('live', -30 * 60e3), mk('next', 2 * 3600e3, { gotn: true })];
    out.live = pick();
    SLATE.games = [mk('early', -3 * 3600e3), mk('later', -20 * 60e3)];
    out.recent = pick();
    SLATE.games = [mk('first', -9 * 3600e3), mk('last', -6 * 3600e3)];
    out.done = pick();
    SLATE.games = [mk('plain', 90 * 60e3), mk('starred', 90 * 60e3, { gotn: true })];
    out.tie = pick();
    return out;
  });

  ok('marquee.takes-the-next-to-tip-not-the-star', r.earliest === 'soon',
     `featured "${r.earliest}" with three games ahead; the 1-hour-away game must win over the starred 4-hour-away one`);
  ok('marquee.a-live-game-outranks-the-star', r.live === 'live',
     `featured "${r.live}"; a game already in progress is what somebody can actually join`);
  ok('marquee.two-live-takes-the-most-recent-start', r.recent === 'later',
     `featured "${r.recent}"; with two under way the rail has just moved to the newer one`);
  ok('marquee.after-everything-ends-it-holds-the-last', r.done === 'last',
     `featured "${r.done}"; once the night is over the page reads as a result, not a countdown to nothing`);
  ok('marquee.same-minute-is-broken-by-the-star', r.tie === 'starred',
     `featured "${r.tie}"; the Game of the Night still wins a genuine tie`);
  ok('marquee.no-page-errors', errs.length === 0, `errors: ${errs.slice(0, 2).join(' | ')}`);

  await b.close();
  console.log(`\n  ${FAIL ? '\x1b[31mRED' : '\x1b[32mGREEN'}  ${PASS} passed, ${FAIL} failed\x1b[0m\n`);
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.log('  \x1b[31mSUITE CRASHED\x1b[0m ' + (e && e.message)); process.exit(1); });
