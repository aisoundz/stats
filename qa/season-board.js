#!/usr/bin/env node
/* ============================================================================
   qa/season-board.js — THE SEASON THE BOARD PRINTS, MEASURED ON THE BOARD

   26 Aug 2026. The Board read:

       3455 TOTAL PTS   ·   18 NIGHTS   ·   740 BEST NIGHT

   and it was watched going 3301/17 → 3455/18 in nine minutes as a SECOND
   ROOM banked. Under this product's own rule — agreed 19 Aug, "every game
   night is worth up to 100, your best game that night is the one that
   counts" — 18 nights cannot exceed 1800 and one night cannot exceed 100.
   Every number on that card was impossible, and a player reading it was
   being shown a season nobody could have played.

   The rule was not missing. It was written, tested (qa/season.js, 12/0) and
   already rendering on the final screen, in lineTotals(). seasonStats() was
   a SECOND calculator keyed by `g.night` — the ROOM id — that summed raw
   points. Three surfaces read the wrong one.

   WHY THIS SUITE ASSERTS THE RENDERED CARD AND NOT THE FUNCTION. A test of
   seasonStats() would have gone green the whole time the Board printed
   3455, because the Board was reading a different function. The unit under
   test is the DOM: the digits inside .bdBig, the words inside .bdK beside
   them, and the arithmetic between them.

   Two invariants a stranger could check with a pencil:
       TOTAL ≤ 100 × NIGHTS          a night is worth at most one night
       BEST  ≤ 100                   and so is the best one
   Plus: the same season number on all three surfaces that print it, and
   the pre-rule nights the fold-in exists to protect still on the card.

   Usage:  node qa/season-board.js [index-test.html] [--engine firefox|chromium]
   Exit 0 green, 1 red.  RED on index.html — that is the point.
   ========================================================================== */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { waitReady } = require('./ready.js');

const argFile = (() => {
  const i = process.argv.indexOf('--file');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  const pos = process.argv.slice(2).find(a => /\.html$/.test(a) && a[0] !== '-');
  return pos || 'index-test.html';
})();
const TARGET = path.basename(argFile);
const ei = process.argv.indexOf('--engine');
const ENGINE = ei > 0 && process.argv[ei + 1] ? process.argv[ei + 1] : 'chromium';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m\n      ' + detail); }
};

function serve() {
  return new Promise(res => {
    const srv = http.createServer((rq, rs) => {
      const f = path.join(ROOT, decodeURIComponent(rq.url.split('?')[0]).replace(/^\/+/, ''));
      fs.readFile(f, (e, b) => {
        if (e) { rs.writeHead(404); rs.end('no'); return; }
        rs.writeHead(200, { 'Content-Type': /\.html$/.test(f) ? 'text/html' : 'text/plain' });
        rs.end(b);
      });
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

/* THE SEASON A REAL DEVICE COULD HAVE. Four rooms across two evenings —
   the 25th was played twice, which is the exact shape that walked the
   Board from 17 nights to 18 in nine minutes — plus one night that exists
   only in the retired store, which is what the fold-in is for.

   Under the rule: 25 Aug = best of 74% and 15.4% → 74. 24 Aug = best of
   60% and 30% → 60. Total 134 over 3 nights, best night 74.            */
const STATLINE = { v: 1, games: [
  { night: 'slate-2026-08-25-lad-atl', pts: 740, max: 1000, hits: 8, total: 12, speed: 20, awards: [], gn: 30 },
  { night: 'slate-2026-08-25-por-dal', pts: 154, max: 1000, hits: 3, total: 12, speed: 5,  awards: [], gn: 31 },
  { night: 'slate-2026-08-24-tb-det',  pts: 600, max: 1000, hits: 6, total: 12, speed: 9,  awards: [], gn: 28 },
  { night: 'slate-2026-08-24-atl-la',  pts: 300, max: 1000, hits: 4, total: 12, speed: 3,  awards: [], gn: 29 }
] };
const LEGACY = { nights: { 'gn6-2026-08-01-min-gs': { pts: 250, rank: 3, at: 1 } },
                 total: 250, played: 1, best: 250 };

/* Read the card the way a person does: find the label, take the number
   beside it. Deliberately matches on the QUANTITY (…PTS / NIGHTS / BEST…)
   rather than the exact wording, so a build that renames a label cannot
   dodge the arithmetic — and so this suite can judge the shipped build,
   whose label says TOTAL PTS, on the same terms.                        */
const READ_CARD = () => {
  const out = { total: null, nights: null, best: null, labels: [], lines: [], text: '' };
  const body = document.getElementById('bdBody');
  if (!body) return out;
  out.text = body.innerText || '';
  [...body.querySelectorAll('.bdK')].forEach(k => {
    const lab = (k.textContent || '').trim();
    const tile = k.parentElement;
    const big = tile && tile.querySelector('.bdBig');
    const n = big ? Number(String(big.textContent || '').replace(/[^0-9.-]/g, '')) : null;
    out.labels.push(lab);
    if (/NIGHTS/i.test(lab)) out.nights = n;
    else if (/BEST/i.test(lab)) out.best = n;
    else if (/PTS/i.test(lab)) out.total = n;
  });
  out.lines = [...body.querySelectorAll('.stLead')].map(r => (r.innerText || '').replace(/\s+/g, ' ').trim());
  return out;
};

(async () => {
  const pw = require('playwright');
  if (!pw[ENGINE]) { console.log('unknown engine ' + ENGINE); process.exit(1); }
  const { srv, port } = await serve();
  const browser = await pw[ENGINE].launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/${TARGET}`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);

  console.log('\n  YOUR SEASON, as rendered — ' + TARGET + '  [' + ENGINE + ']\n');

  await page.addScriptTag({ content: 'window.__readCard = ' + READ_CARD.toString() });

  const show = async (statline, legacy) => {
    await page.evaluate(([sl, lg]) => {
      localStorage.removeItem('stats_statline_v1');
      localStorage.removeItem('stats_season_v1');
      if (sl) localStorage.setItem('stats_statline_v1', JSON.stringify(sl));
      if (lg) localStorage.setItem('stats_season_v1', JSON.stringify(lg));
      S.mode = 'live';
      go('board');
      renderBoard();
    }, [statline, legacy]);
    /* .screen carries a fade whose keyframes include a transform, and while
       it runs every rect measured inside is wrong. Wait it out before
       anything geometric — the numbers are safe either way, the overflow
       check below is not. */
    await page.waitForTimeout(900);
    return page.evaluate(() => window.__readCard());
  };

  /* ---- 1. THE TWO INVARIANTS ---------------------------------------- */
  const c = await show(STATLINE, LEGACY);
  console.log('    card: ' + c.total + ' [' + c.labels.join(' | ') + '] ' + c.nights + ' nights, best ' + c.best + '\n');

  ok('season-board.total-cannot-exceed-100-a-night',
     c.total != null && c.nights != null && c.total <= 100 * c.nights,
     `the card printed ${c.total} over ${c.nights} nights — the rule caps that at ${100 * (c.nights || 0)}. A room was counted as a whole extra night.`);
  ok('season-board.best-night-cannot-exceed-100',
     c.best != null && c.best <= 100,
     `BEST NIGHT printed ${c.best}; a night is worth at most 100, so this is a raw room score under a label the season card cannot mean.`);
  ok('season-board.best-night-is-in-the-same-unit-as-the-total',
     c.best != null && c.total != null && c.best <= c.total,
     `best ${c.best} > total ${c.total} — the best night is one of the terms of the total, so it cannot be bigger than it. Two different quantities under two adjacent labels.`);

  /* ---- 2. THE RULE, ON THE RENDERED NUMBERS -------------------------- */
  ok('season-board.two-rooms-in-one-evening-are-one-night',
     c.nights === 3,
     `NIGHTS printed ${c.nights}. Four rooms across two evenings plus one folded-in night is 3 nights, not ${c.nights} — this is the 3301/17 → 3455/18 jump, rendered.`);
  ok('season-board.the-total-is-the-sum-of-the-night-scores',
     c.total === 134,
     `expected 74 (best of 74/15.4 on the 25th) + 60 (best of 60/30 on the 24th) + 0 (a night with no recorded ceiling) = 134, got ${c.total}`);
  ok('season-board.the-best-night-is-the-best-night-score',
     c.best === 74, `expected 74, got ${c.best}`);

  /* ---- 3. THE FOLD-IN IS NOT COLLATERAL ------------------------------
     Switching source without carrying the retired store across drops every
     pre-change night, and shortening a season somebody earned is the one
     thing a season record must never do. It has to survive BOTH ways: with
     a statline beside it, and as the only record on the device.          */
  ok('season-board.a-pre-rule-night-still-counts-as-a-night',
     c.lines.length === 3 && /250 pts/.test(c.text),
     `night lines: ${JSON.stringify(c.lines)} — the night that lives only in the retired store lost its line or its points.`);

  const onlyLegacy = await show(null, LEGACY);
  ok('season-board.the-retired-store-alone-still-makes-a-season',
     onlyLegacy.nights === 1 && /250 pts/.test(onlyLegacy.text),
     `nights=${onlyLegacy.nights}, card="${onlyLegacy.text.replace(/\n/g, ' ').slice(0, 160)}"`);
  ok('season-board.a-fold-in-night-cannot-inflate-the-capped-total',
     onlyLegacy.total != null && onlyLegacy.total <= 100 * (onlyLegacy.nights || 0),
     `${onlyLegacy.total} over ${onlyLegacy.nights} night — a row with no recorded ceiling was scored as if raw points were percentages.`);

  /* ---- 4. ONE FACT, EVERY SURFACE ------------------------------------
     The Board is not the only screen printing "your season": the signed-in
     member card on the front door and the Me tab print it too, from the
     same function. Six one-fact-many-copies bugs in two days; this is the
     check that stops the seventh.                                        */
  await show(STATLINE, LEGACY);
  const surfaces = await page.evaluate(() => {
    /* Both cards only exist for a signed-in member, so sign one in. The
       season numbers on them come entirely off the device — neither call
       costs a network read — so nothing else has to be faked. */
    try { SB.verified = function () { return true; }; SB.me = { email: 'qa@statsgametime.com' }; } catch (_) {}
    try { renderPortal(); } catch (_) {}
    try { renderMe(); } catch (_) {}
    /* Read a tile the way the eye does: find the label, take the number
       directly above it. */
    const tiles = (rootId) => {
      const root = document.getElementById(rootId); const out = {};
      if (!root) return out;
      [...root.querySelectorAll('div')].forEach(el => {
        const t = (el.textContent || '').trim();
        if (!/^(Season pts|Game nights)$/i.test(t)) return;
        const prev = el.previousElementSibling;
        if (!prev) return;
        out[t.toLowerCase()] = Number(String(prev.textContent || '').replace(/[^0-9.-]/g, ''));
      });
      return out;
    };
    /* The signed-in member card is the welcome strip; #portalCard is the
       signed-OUT door and is hidden the moment somebody is signed in. */
    return { portal: tiles('welcomeStrip'), me: tiles('meBody') };
  });
  const impossible = (t) => t == null || t['season pts'] == null || t['game nights'] == null
                            || t['season pts'] > 100 * t['game nights'];
  ok('season-board.the-member-card-cannot-print-an-impossible-season',
     !impossible(surfaces.portal),
     `front-door member card read ${JSON.stringify(surfaces.portal)} — it reads the same season store, and N nights cannot be worth more than 100N.`);
  ok('season-board.the-me-tab-cannot-print-an-impossible-season',
     !impossible(surfaces.me),
     `Me tab read ${JSON.stringify(surfaces.me)} — same store, same cap.`);
  /* THE FOURTH SURFACE IS THE FINAL SCREEN, and it is the one a player is
     looking at when the night is banked. It reads lineTotals() over the
     statline — which does NOT contain the folded-in pre-B10 nights — so a
     device carrying one finished a night being told it had played one
     fewer night than the Board said thirty seconds later. */
  const finalCard = await page.evaluate(() => {
    S.mode = 'live';
    try { renderStatLine(); } catch (_) {}
    const g = id => { const e = document.getElementById(id); return e ? Number(String(e.textContent || '').replace(/[^0-9.-]/g, '')) : null; };
    return { pts: g('slPts'), games: g('slGames') };
  });
  ok('season-board.the-final-screen-counts-the-same-nights-as-the-board',
     finalCard.games === c.nights && finalCard.pts === c.total,
     `final screen ${finalCard.pts} pts over ${finalCard.games} nights, Board ${c.total} over ${c.nights} — the same season, from two different lists of rows.`);

  ok('season-board.all-three-surfaces-print-the-same-season',
     surfaces.portal['season pts'] === c.total && surfaces.me['season pts'] === c.total
       && surfaces.portal['game nights'] === c.nights && surfaces.me['game nights'] === c.nights,
     `Board ${c.total}/${c.nights}, member card ${JSON.stringify(surfaces.portal)}, Me tab ${JSON.stringify(surfaces.me)} — one fact, three copies, and they used to be able to disagree.`);

  /* ---- 4b. A NIGHT YOU DID NOT PLAY IS NOT A NIGHT -------------------
     Found while chasing what looked like a flaky check and was not: open
     the app in live mode after the game has ended — which is what anybody
     who reads the email late does — and the phase clock reaches 'final',
     finishNightFromFeed() finds no locked card, and bankNight() wrote a
     ZERO-POINT row for tonight's id into the season store. Every night a
     device merely LOADED after the buzzer became a night on the record,
     and NIGHTS is a claim about what the person did.

     Driven through the real function rather than waiting on the phase
     clock, which is what made it look intermittent. */
  const before = await show(null, LEGACY);
  const phantom = await page.evaluate(() => {
    S.mode = 'live'; S.screen = 'lobby';
    try { FINALISED = false; } catch (_) {}
    /* Nobody has answered anything: no picks, no round answers, no catches. */
    S.predChoices = {}; S.catchChoices = {}; S.pts = 0;
    try { S.liveAnswers = emptyRounds(); S.results = emptyRounds(); } catch (_) {}
    try { finishNightFromFeed(); } catch (e) { return { err: String(e) }; }
    renderBoard();
    return { store: localStorage.getItem('stats_season_v1') };
  });
  await page.waitForTimeout(300);
  const afterBuzzer = await page.evaluate(() => window.__readCard());
  ok('season-board.opening-the-app-after-the-buzzer-does-not-add-a-night',
     afterBuzzer.nights === before.nights,
     `nights went ${before.nights} → ${afterBuzzer.nights} for a device that answered nothing. Season store: ${String(phantom.store).slice(0, 200)}`);

  /* ---- 5. A NEW DEVICE IS NOT A CRASH -------------------------------- */
  const fresh = await show(null, null);
  ok('season-board.a-device-with-no-season-says-so',
     fresh.total === 0 && fresh.nights === 0 && fresh.best === 0,
     `a brand new phone read ${fresh.total}/${fresh.nights}/${fresh.best}`);

  /* ---- 6. IT STILL FITS -----------------------------------------------
     320px, because the card grew a sentence and a second unit per line. */
  await page.setViewportSize({ width: 320, height: 640 });
  await show(STATLINE, LEGACY);
  const fit = await page.evaluate(() => {
    const body = document.getElementById('bdBody');
    const bad = [];
    [...body.querySelectorAll('.card')].forEach(card => {
      const cr = card.getBoundingClientRect();
      [...card.querySelectorAll('*')].forEach(el => {
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) return;
        if (r.right > cr.right + 1 || r.left < cr.left - 1) {
          bad.push((el.className || el.tagName) + ' ' + Math.round(r.left) + '→' + Math.round(r.right)
                   + ' vs card ' + Math.round(cr.left) + '→' + Math.round(cr.right));
        }
      });
    });
    return { bad, docW: document.documentElement.scrollWidth, winW: innerWidth };
  });
  ok('season-board.nothing-on-the-season-card-runs-off-a-320px-phone',
     fit.bad.length === 0, fit.bad.slice(0, 4).join(' ; '));
  ok('season-board.the-board-does-not-scroll-sideways-at-320px',
     fit.docW <= fit.winW + 1, `document ${fit.docW}px in a ${fit.winW}px window`);

  ok('season-board.no-page-errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close(); srv.close();
  console.log(`\n  ${fail ? '\x1b[31mRED' : '\x1b[32mGREEN'}\x1b[0m   ${pass} passed, ${fail} failed   [${TARGET} · ${ENGINE}]\n`);
  process.exit(fail ? 1 : 0);
})();
