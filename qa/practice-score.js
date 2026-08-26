#!/usr/bin/env node
/* ============================================================================
   qa/practice-score.js — PRACTICE MUST NOT PRINT THE ANSWER ABOVE THE QUESTION

   26 Aug 2026, measured on the live site. In practice the board read:

       20–24 before Q1's questions      41–48 at Q2
       63–72 at Q3                      88–97 at Q4

   Those are the END-of-quarter scores. The questions underneath are about
   that quarter. So "Who led at halftime?" was asked with 41–48 printed two
   inches above it, and a Q3 question could be answered by subtracting two
   scoreboards. The scoreboard sits inside #gtSticky directly above
   #gtQuestion — it is not somewhere else on the page, it is the line above.

   This is the documented FREE POINT defect ("a question the on-screen
   scoreboard can answer is not a question") living in the one mode a
   stranger meets first and the one the founder demos on. It teaches a
   first-time player that watching is optional, which is the opposite of
   the thing the product is named after.

   The fix is WHEN, not WHAT: the practice board shows the game as it stood
   going INTO the period being asked about, and catches up the moment that
   period is scored. So this suite plays a whole practice game the way a
   person does — clicking real options, real Next, real Continue — and
   after every step asks two questions:

       is the answer to this round printed above this round's questions?
       did the board catch up once the round was scored?

   It also checks the flow it is standing on: four rounds, no account, and
   a final screen at the end of it.

   Usage:  node qa/practice-score.js [index-test.html] [--engine firefox|chromium]
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

/* What is actually painted at the top of the Gametime screen right now. */
const SNAP = () => {
  const head = document.getElementById('gtHead');
  const pill = head && head.querySelector('.alive');
  const qt = document.getElementById('qText');
  const nums = [...(head ? head.querySelectorAll('.n') : [])]
    .map(e => Number(String(e.textContent || '').replace(/[^0-9-]/g, '')));
  const vis = el => !!(el && el.getClientRects().length);
  return {
    screen: S.screen, qi: S.qi, ni: S.ni,
    away: nums[0] == null ? null : nums[0], home: nums[1] == null ? null : nums[1],
    pill: pill ? (pill.textContent || '').trim() : '',
    headText: head ? (head.innerText || '').replace(/\s+/g, ' ').trim() : '',
    q: qt ? (qt.textContent || '') : '',
    qVisible: vis(qt),
    headRect: head ? head.getBoundingClientRect().toJSON() : null,
    qRect: qt ? qt.getBoundingClientRect().toJSON() : null
  };
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
  await page.addScriptTag({ content: 'window.__snap = ' + SNAP.toString() });

  console.log('\n  PRACTICE — is the answer printed above the question? — ' + TARGET + '  [' + ENGINE + ']\n');

  /* The simulated game's own scoreline, read from the build rather than
     typed in here: rounds[i].home/away is the score AT THE END of round i,
     which is exactly the fact that must not be on screen while round i is
     being asked. */
  const game = await page.evaluate(() => {
    /* Practice, with no account — the door a stranger comes through. */
    setMode('demo'); S.name = 'QA';
    return {
      n: liveRounds(),
      tags: Array.from({ length: liveRounds() }, (_, i) => roundTag(i)),
      ends: Array.from({ length: liveRounds() }, (_, i) => ({ home: rounds[i].home, away: rounds[i].away })),
      signedIn: !!(window.SB && SB.verified && SB.verified())
    };
  });
  ok('practice-score.no-account-is-needed-to-practise',
     game.signedIn === false && game.n >= 2,
     `signed in: ${game.signedIn}, rounds: ${game.n}`);

  const expected = i => (i === 0 ? { home: 0, away: 0 } : game.ends[i - 1]);
  let reachedFinal = false;

  for (let i = 0; i < game.n; i++) {
    /* startQuarter(i) is the function the Start button's onclick calls —
       the same entry point, one call earlier. Everything after it is real
       clicks on real controls. */
    await page.evaluate(r => startQuarter(r), i);
    await page.waitForTimeout(450);          // the .screen fade carries a transform
    const open = await page.evaluate(() => window.__snap());
    const tag = game.tags[i], end = game.ends[i], want = expected(i);

    ok(`practice-score.${tag}-does-not-print-its-own-result-above-its-questions`,
       !(open.away === end.away && open.home === end.home),
       `board reads ${open.away}–${open.home} while asking "${open.q.slice(0, 60)}" — that IS the ${tag} result. Free point.`);
    ok(`practice-score.${tag}-shows-the-score-going-into-the-period`,
       open.away === want.away && open.home === want.home,
       `board reads ${open.away}–${open.home}, expected ${want.away}–${want.home} (the score when ${tag} began)`);
    ok(`practice-score.${tag}-says-what-the-score-is-as-of`,
       /BEFORE/i.test(open.pill) && open.pill.indexOf(tag) >= 0,
       `pill reads "${open.pill}" — a board a period behind the questions has to say so, or it reads as a wrong score.`);
    ok(`practice-score.${tag}-question-sits-under-the-board-and-is-visible`,
       open.qVisible && open.qRect && open.headRect
         && open.qRect.top >= open.headRect.bottom - 1
         && open.qRect.bottom <= 852,
       `question rect ${JSON.stringify(open.qRect)} vs board ${JSON.stringify(open.headRect)} — this is the geometry that makes the board part of the question.`);

    /* Answer the whole round with real clicks. */
    for (let k = 0; k < 12; k++) {
      const opt = await page.$('#qOpts .opt');
      if (!opt || !(await opt.isVisible())) break;
      await opt.click();
      await page.waitForTimeout(220);
      const nb = await page.$('#nextBtn');
      if (!nb || !(await nb.isVisible())) break;
      await nb.click();
      await page.waitForTimeout(320);
      const scr = await page.evaluate(() => S.screen);
      if (scr === 'break' || scr === 'final' || scr === 'predreview') break;
    }

    const done = await page.evaluate(() => { try { renderGametime(); } catch (_) {} return window.__snap(); });
    ok(`practice-score.${tag}-the-board-catches-up-once-the-round-is-scored`,
       done.away === end.away && done.home === end.home,
       `after scoring ${tag} the board reads ${done.away}–${done.home}, expected ${end.away}–${end.home}. The score IS the reveal; it has to arrive.`);

    if (done.screen === 'final') { reachedFinal = true; break; }
    const bb = await page.$('#breakBtn');
    if (bb && await bb.isVisible()) { await bb.click(); await page.waitForTimeout(450); }
  }

  /* ---- A SECOND PRACTICE RUN IS SOMEBODY'S FIRST IMPRESSION TOO -----
     setMode() returns early when the mode has not changed, so pressing
     Practice again after a finished run inherits the finished run's
     results. The board must still refuse to print the answer. */
  await page.evaluate(() => { startDemo(); S.name = 'QA'; startQuarter(0); });
  await page.waitForTimeout(500);
  const replay = await page.evaluate(() => window.__snap());
  ok('practice-score.a-replayed-practice-run-does-not-print-the-answer-either',
     !(replay.away === game.ends[0].away && replay.home === game.ends[0].home),
     `second run: board reads ${replay.away}–${replay.home} above "${replay.q.slice(0, 50)}", and ${game.ends[0].away}–${game.ends[0].home} IS the ${game.tags[0]} result`);

  /* ---- THE ONE THE FOUNDER NAMED ------------------------------------
     On a fresh page, because this is the sentence a stranger meets: the
     halftime question, and the halftime score. */
  await page.goto(`http://127.0.0.1:${port}/${TARGET}`, { waitUntil: 'domcontentloaded' });
  await waitReady(page);
  await page.addScriptTag({ content: 'window.__snap = ' + SNAP.toString() });
  const half = await page.evaluate(() => {
    setMode('demo'); S.name = 'QA';
    let at = -1, txt = '';
    for (let i = 0; i < liveRounds(); i++) {
      const q = (rounds[i].q || []).find(x => /halftime|half.time|at the half/i.test(x.t || ''));
      if (q) { at = i; txt = q.t; break; }
    }
    if (at < 0) return { skip: true };
    startQuarter(at);
    const head = document.getElementById('gtHead');
    return { skip: false, at, txt,
             screenText: (document.getElementById('s-gametime').innerText || '').replace(/\s+/g, ' '),
             ends: { home: rounds[at].home, away: rounds[at].away },
             headText: head ? head.innerText.replace(/\s+/g, ' ') : '' };
  });
  await page.waitForTimeout(400);
  if (half.skip) {
    ok('practice-score.the-halftime-question-is-not-answerable-from-the-board', false,
       'no halftime question found in the practice bank — this suite is checking the wrong sport');
  } else {
    const shown = await page.evaluate(() => window.__snap());
    ok('practice-score.the-halftime-question-is-not-answerable-from-the-board',
       !(shown.home === half.ends.home && shown.away === half.ends.away),
       `"${half.txt}" asked with ${shown.away}–${shown.home} on the board, and the halftime score is ${half.ends.away}–${half.ends.home}. The scoreboard answers the question.`);
    ok('practice-score.the-halftime-score-is-nowhere-on-the-screen-that-asks-for-it',
       !new RegExp('\\b' + half.ends.home + '\\b').test(shown.headText)
         && !new RegExp('\\b' + half.ends.away + '\\b').test(shown.headText),
       `board text "${shown.headText}" contains ${half.ends.away}/${half.ends.home}`);
  }

  /* ---- THE FLOW IT STANDS ON ---------------------------------------- */
  ok('practice-score.a-practice-game-still-reaches-the-final-screen',
     reachedFinal, 'playing every round through never landed on the final screen — the practice flow is broken, which is a worse bug than the one being fixed');

  /* ---- 320px, because the board grew a line ------------------------- */
  await page.setViewportSize({ width: 320, height: 640 });
  await page.evaluate(() => { setMode('demo'); S.name = 'QA'; startQuarter(0); });
  await page.waitForTimeout(600);
  const fit = await page.evaluate(() => {
    const card = document.querySelector('#gtHead .card');
    if (!card) return { bad: ['no board'], docW: 0, winW: 1 };
    const cr = card.getBoundingClientRect();
    const bad = [];
    [...card.querySelectorAll('*')].forEach(el => {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      if (r.right > cr.right + 1 || r.left < cr.left - 1)
        bad.push((el.className || el.tagName) + ' ' + Math.round(r.left) + '→' + Math.round(r.right));
    });
    const cap = [...card.querySelectorAll('.acap')].map(e => Number(getComputedStyle(e).fontSize.replace('px', '')));
    return { bad, cap, docW: document.documentElement.scrollWidth, winW: innerWidth };
  });
  ok('practice-score.the-practice-board-fits-a-320px-phone',
     fit.bad.length === 0, fit.bad.slice(0, 4).join(' ; '));
  ok('practice-score.the-board-does-not-push-the-page-sideways-at-320px',
     fit.docW <= fit.winW + 1, `document ${fit.docW}px in a ${fit.winW}px window`);
  ok('practice-score.the-caption-respects-the-12px-floor',
     (fit.cap || []).length > 0 && fit.cap.every(s => s >= 12),
     `caption sizes ${JSON.stringify(fit.cap)} — the ramp's floor is 12px`);

  ok('practice-score.no-page-errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close(); srv.close();
  console.log(`\n  ${fail ? '\x1b[31mRED' : '\x1b[32mGREEN'}\x1b[0m   ${pass} passed, ${fail} failed   [${TARGET} · ${ENGINE}]\n`);
  process.exit(fail ? 1 : 0);
})();
