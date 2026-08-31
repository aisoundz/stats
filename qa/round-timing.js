#!/usr/bin/env node
/* ============================================================================
   qa/round-timing.js — WHAT A SCREEN PROMISES ABOUT TIMING MUST MATCH run.js

   31 Aug 2026. The founder sat down at kickoff for Arsenal at Aston Villa,
   watched nothing happen for forty-five minutes, and said "Everything is
   messed up right now" / "Why is it broken!!!!!!". Nothing was broken. The
   runner was healthy the whole time — feed publishing, Caught It firing. The
   first round was never due until half time.

   host/run.js opens a round only when AUTO.periodDone(sum, sl.per) is true:
   a round is ABOUT its period, so it cannot open until that period is OVER.

       1H  covers period 1  ->  opens at HALF TIME
       FT  covers period 2  ->  opens at FULL TIME

   The pre-tip waiting card said `roundTag(qi)+' opens when the game tips'` —
   the one moment a round is guaranteed NOT to open, in basketball's word, on
   a soccer match. Three surfaces carried a version of this and NOTHING
   GUARDED ANY OF THEM. This is that guard.

   WHAT IT PINS, across every sport with a bank:
     - the waiting card never promises a round at the START of the game
     - it names an ENDING (the period, or baseball's own ranged boundary)
     - it uses no other sport's word for the start of play

   It asserts the SHAPE of the promise, not one sport's sentence, so it does
   not go stale the day a word is rephrased.

   Usage:  node qa/round-timing.js [index-test.html]
           node qa/round-timing.js --sabotage
   ========================================================================== */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const SAB = process.argv.includes('--sabotage');
const argFile = (() => {
  const i = process.argv.indexOf('--file');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.argv.slice(2).find(a => /\.html$/.test(a) && a[0] !== '-') || 'index-test.html';
})();
const SRC = path.resolve(argFile);

/* The sabotage restores the ACTUAL line that shipped, not a nearby edit. */
const FIXED_ANCHOR = "        var nm0   = roundName(qi) || roundTag(qi);";
const BROKEN_LINE  = "        why = roundTag(qi)+' opens when the game tips';";

function target() {
  const src = fs.readFileSync(SRC, 'utf8');
  if (!SAB) return { dir: path.dirname(SRC), base: path.basename(SRC) };
  const i = src.indexOf(FIXED_ANCHOR);
  if (i < 0) { console.log('  SABOTAGE COULD NOT BE APPLIED — the fixed block is not in ' + SRC); process.exit(1); }
  const endMark = "(L.period || 'quarter') + ' ends');";
  const e = src.indexOf(endMark, i);
  if (e < 0) { console.log('  SABOTAGE FAILED — the fixed block has no end'); process.exit(1); }
  const out = src.slice(0, i) + BROKEN_LINE + src.slice(e + endMark.length);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'round-timing-'));
  fs.writeFileSync(path.join(dir, 'sabotaged.html'), out);
  console.log('  sabotage written to ' + path.join(dir, 'sabotaged.html'));
  return { dir, base: 'sabotaged.html' };
}
const T = target();

function serve(dir) {
  return new Promise(res => {
    const srv = http.createServer((rq, rs) => {
      fs.readFile(path.join(dir, decodeURIComponent(rq.url.split('?')[0])), (e, b) => {
        if (e) { rs.writeHead(404); rs.end('no'); return; }
        rs.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); rs.end(b);
      });
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

/* Every word any sport in this build uses for the start of play. A waiting
   card that contains one of these is promising the wrong moment. */
const START_WORDS = /\b(tips?|tip-?off|kicks? off|kick-?off|first pitch|puck drop|when the game starts?)\b/i;
/* ...and the shape of a correct promise: something ENDS. */
const END_WORDS   = /\b(ends?|after|final|full time|half time)\b/i;

(async () => {
  const { chromium } = require('playwright');
  const { srv, port } = await serve(T.dir);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  let pass = 0, fail = 0;
  const ok = (n, c, d) => { c ? (pass++, console.log('  ok   ' + n))
                              : (fail++, console.log('  FAIL ' + n + (d ? '   ' + d : ''))); };

  await page.goto(`http://127.0.0.1:${port}/${T.base}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.gtStartRow === 'function'
                                || typeof gtStartRow === 'function', { timeout: 25000 }).catch(() => {});

  /* Drive the PRE-TIP waiting card in every sport that has rounds. This is
     the state the founder was in: a live night, before the game starts. */
  const rows = await page.evaluate(() => {
    const out = [];
    const keys = Object.keys(SPORTS).filter(k => (SPORTS[k].rounds || []).length > 0);
    for (const k of keys) {
      try {
        if (!setSport(k)) continue;
        S.mode = 'live'; S.screen = 'lobby'; S.place = 'lobby'; S.qi = 0; S.nextQ = 0;
        /* pre-tip: no hosted round, and the phase clock says the game has
           not started — which is what liveRoundBlocked() calls 'not-started' */
        try { HR.doc = null; HR.started = {}; HR.submitted = {}; HR.held = {}; } catch (_) {}
        try { GAME.tipISO = new Date(Date.now() + 3 * 3600e3).toISOString(); } catch (_) {}
        try { GS.ok = false; GS.detail = ''; } catch (_) {}
        const blk = liveRoundBlocked(0);
        const html = gtStartRow();
        const d = document.createElement('div'); d.innerHTML = html;
        out.push({ sport: k, blocked: blk, text: (d.innerText || '').trim(),
                   round: roundName(0) });
      } catch (e) { out.push({ sport: k, err: String(e).slice(0, 90) }); }
    }
    return out;
  });

  ok('round-timing.the-pre-tip-card-renders-in-every-sport',
     rows.length >= 3 && rows.every(r => !r.err && r.text && r.text.length > 3),
     JSON.stringify(rows.map(r => r.err ? (r.sport + ':' + r.err) : (r.sport + ':' + r.text)).slice(0, 6)));

  for (const r of rows) {
    if (r.err) continue;
    ok(`round-timing.${r.sport}-does-not-promise-a-round-at-the-start-of-play`,
       !START_WORDS.test(r.text), `"${r.text}"`);
    ok(`round-timing.${r.sport}-names-the-ending-it-is-waiting-for`,
       END_WORDS.test(r.text), `"${r.text}"`);
    ok(`round-timing.${r.sport}-names-its-own-round`,
       !!r.round && r.text.toLowerCase().indexOf(String(r.round).toLowerCase().slice(0, 6)) >= 0,
       `round="${r.round}" text="${r.text}"`);
  }

  ok('round-timing.no-page-errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close(); srv.close();
  console.log('');
  if (SAB) {
    if (fail > 0) { console.log(`  SABOTAGE CAUGHT — ${fail} check(s) red with the old sentence restored.`); process.exit(0); }
    console.log('  NOT CAUGHT — everything passed with the bug back. This suite proves nothing.');
    process.exit(1);
  }
  console.log(fail === 0 ? `  GREEN  ${pass} passed, 0 failed   [${T.base}]`
                         : `  RED    ${pass} passed, ${fail} failed   [${T.base}]`);
  process.exit(fail === 0 ? 0 : 1);
})();
