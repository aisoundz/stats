/* ============================================================================
   qa/ci-clearance.js — THE CAUGHT IT CARD MUST NOT SIT ON ANYTHING

   The beta tester, playing on a 393pt phone, found the live-question card
   doing two things at once on the Stats tab:

     · the ☰ menu button (z-index 8700) cutting a 38x39 hole out of the
       card's top-right corner (z-index 8400) — exactly where the ✕ and
       the countdown are, so the two controls a person reaches for during
       a live question were the two the button ate;

     · the card itself lying over "Head to head" and the team labels.

   The second one has a mechanism already — ciFit() measures the card and
   feeds --cih to `body.ciopen .screen.active{padding-top}` — so this suite
   exists to prove that mechanism actually fires on every screen, not just
   the one it was written against. A push-down that works on Gametime and
   silently does nothing on Stats looks identical in the source.

   Both checks are geometric. They read rectangles off a rendered page and
   compare them; they cannot pass by reading a string.
   ========================================================================== */
const { chromium, webkit } = require('playwright');
const path = require('path');
const F = require('./fixtures.js');
const { waitReady } = require('./ready.js');
const FILE = 'file://' + path.resolve(__dirname, '..', 'index-test.html');

const VIEWPORTS = [
  { name: 'iPhone SE   375x667', w: 375, h: 667 },
  { name: 'iPhone 15   393x852', w: 393, h: 852 },
  { name: 'Pixel 7     412x915', w: 412, h: 915 },
];
/* 'landing' is the HOME TAB, and it is here because the card was BLOCKED
   on it until 25 Aug — chooseGame() lands every player on Home, so the
   ordinary way into a room was the one screen Caught It could not appear
   on. Note that 'home' below is not it: there is no #s-home, so go('home')
   falls through to a screen id the app does not own. Both stay: one is the
   real tab, the other is the unknown-screen case. */
const SCREENS = ['gametime', 'stats', 'board', 'home', 'landing'];

let pass = 0, fail = 0;
const bad = [];
function ok(cond, label, detail) {
  if (cond) { pass++; }
  else { fail++; bad.push(label + (detail ? '  — ' + detail : '')); }
}

async function run(engine, engineName) {
  const browser = await engine.launch();
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true
    });
    /* STUB THE NETWORK BEFORE NAVIGATING. Without these two routes WebKit
       does not merely fail a request — the page process dies, goto()
       reports "Page crashed", and the engine looks broken. It is not: it is
       a file:// page being told to reach the open internet. chrome.js has
       carried the same two lines since it was written. */
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

    for (const screen of SCREENS) {
      await page.evaluate((scr) => {
        /* Put the app on the screen under test, the way navGo would. */
        try { go(scr); } catch (_) { try { S.screen = scr; render(); } catch (_) {} }

        /* A real card: a real kind, real options, a real lock window. A
           card with no opensAt/locksMs renders a different, shorter body
           and would understate the height we are trying to clear. */
        const q = {
          qid: 'clr1', kind: 'saw-pitch', state: 'open',
          prompt: 'That last pitch — what was it?',
          options: [{ v: 'a', k: 'Fastball' }, { v: 'b', k: 'Breaking ball' },
                    { v: 'c', k: 'Changeup' }, { v: 'd', k: 'Something else' }],
          opensAt: { toMillis: () => Date.now() }, locksMs: 20000
        };
        try { PCI.muted = false; PCI.picked = {}; PCI.active = q; } catch (_) {}
        renderCiCard(q);
        try { ciFit(); } catch (_) {}
        return true;
      }, screen);

      /* SETTLE FIRST. The card enters on a .34s drop from translateY(-22px),
         so a rectangle read on the frame after render() is the animation,
         not the position. Measuring there reported a menu-button collision
         that does not exist once the card lands — and would have sent me
         chasing a layout bug in a keyframe. */
      await page.waitForTimeout(500);

      const r = await page.evaluate(() => {
        const card = document.getElementById('ciCard');
        if (!card || card.style.display === 'none') return { drew: false };

        const menu = document.getElementById('menuBtn');
        const cr = card.getBoundingClientRect();
        const mr = menu ? menu.getBoundingClientRect() : null;
        const menuShown = menu && getComputedStyle(menu).display !== 'none' && mr.height > 0;

        const hits = (a, b) => !(a.right <= b.left || a.left >= b.right ||
                                 a.bottom <= b.top || a.top >= b.bottom);

        /* What is the card lying on? Walk the visible text of the active
           screen and find anything whose box the card overlaps. We ask the
           SCREEN, not the body, so the fixed nav and the card itself are
           out of scope by construction. */
        const active = document.querySelector('.screen.active');
        const covered = [];
        if (active) {
          active.querySelectorAll('*').forEach(function (el) {
            if (card.contains(el)) return;
            const t = (el.textContent || '').trim();
            if (!t || t.length > 90) return;             // containers, not leaves
            if (el.children.length) return;               // leaves only
            const er = el.getBoundingClientRect();
            if (er.width < 4 || er.height < 4) return;
            if (er.bottom < 0 || er.top > innerHeight) return;   // off-screen
            if (getComputedStyle(el).visibility === 'hidden') return;
            if (hits(cr, er)) covered.push(t.slice(0, 40));
          });
        }

        return {
          drew: true,
          menuShown: !!menuShown,
          menuOverlap: menuShown ? hits(cr, mr) : false,
          cardTop: Math.round(cr.top), cardBottom: Math.round(cr.bottom),
          menuBottom: mr ? Math.round(mr.bottom) : -1,
          cih: getComputedStyle(document.documentElement).getPropertyValue('--cih').trim(),
          ciopen: document.body.classList.contains('ciopen'),
          covered: covered.slice(0, 4),
          coveredN: covered.length
        };
      }, screen);

      const tag = engineName + ' ' + vp.name + ' · ' + screen;
      ok(r.drew, tag + ' · card renders at all');
      if (!r.drew) continue;

      ok(!r.menuOverlap, tag + ' · card clears the ☰ button',
         r.menuOverlap ? 'card top ' + r.cardTop + ' is above menu bottom ' + r.menuBottom : '');

      ok(r.coveredN === 0, tag + ' · card covers no page content',
         r.coveredN ? r.coveredN + ' element(s): ' + JSON.stringify(r.covered) : '');

      ok(r.ciopen && r.cih && r.cih !== '0px',
         tag + ' · the page is pushed down by the card',
         'ciopen=' + r.ciopen + ' --cih=' + (r.cih || '(unset)'));
    }
    await page.close();
  }
  await browser.close();
}

(async () => {
  console.log('\n=== CAUGHT IT CLEARANCE ===\n');
  await run(chromium, 'chromium');
  /* WebKit, and the reason it is loaded a particular way. The default
     goto() waits for 'load' — every resource settled — and on WebKit this
     page never gets there, so the page is killed and the whole engine
     looked broken. chrome.js has always used 'domcontentloaded' for this
     exact reason. Reporting "webkit unavailable" would have quietly
     dropped iPhone coverage from a suite about a bug found on a phone. */
  await run(webkit, 'webkit  ');

  if (bad.length) { console.log('FAILURES:'); bad.forEach(b => console.log('  ✗ ' + b)); console.log(''); }
  console.log('ci-clearance: ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
