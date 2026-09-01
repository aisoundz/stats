#!/usr/bin/env node
/* ============================================================================
   qa/hero-live.js — A GAME THAT HAS STARTED IS NOT "NO GAME TONIGHT"

   31 Aug 2026, Arsenal at Aston Villa, twenty-three minutes after kickoff.
   The front page of the product read "No game tonight" while the room was
   up and host/run.js was hosting it — and the matchup, the game number and
   the chips were all HIDDEN underneath that sentence, because the card
   carried `mq-rest`.

   THE MECHANISM, measured on the deployed build rather than reasoned about:

     1. At boot, before the slate lands, the hero paints from the built-in
        night baked into the file (gn13-2026-08-19-min-gs, twelve days old).
        Correctly judged over, so it paints 'rest' and sets `mq-rest`.
     2. The slate arrives, featureTonight() sets TONIGHT correctly and DOES
        call paintHeroRibbon() again.
     3. paintHeroRibbon() reached `if(!isFinite(ms) || ms <= 0){ hide; return; }`
        and returned WITHOUT calling put(). put() is the only writer of
        `mq-rest`, so the stale state was never cleared.

   WHY qa/hero.js DID NOT CATCH IT, which is the reusable part. That suite
   owns a check literally named `hero.stops-saying-no-game-tonight`, and it
   was green through this. Its line 96 reads

       const TIP_DAY = (Date.parse(laTip(17,0)) <= Date.now()+30*60000) ? 1 : 0;

   — it rolls its fixtures to TOMORROW whenever the tip has passed, to stop
   the countdown assertions going flaky in the evening. That is reasonable
   for what it asserts and it means the suite can NEVER produce the one
   state this bug lives in: a marquee whose tip is already behind us. A
   check that engineers its way around a state cannot guard that state, and
   the name of the check promised a guarantee its fixtures could not reach.

   SO THIS SUITE ASSERTS THE STATE, NOT THE TEAMS. It never mentions ARS,
   AVL or Game Night #48 — those are one evening's values and would go
   stale by Tuesday. The invariant is: once a featured game's tip has
   passed and it is still inside REST_AFTER_MS, the card must not be in the
   rest state and the matchup must be on screen.

   Usage:  node qa/hero-live.js [index-test.html]
           node qa/hero-live.js --sabotage      # restores the bug, expects RED
   ========================================================================== */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const SAB = process.argv.includes('--sabotage');
const argFile = (() => {
  const i = process.argv.indexOf('--file');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  const pos = process.argv.slice(2).find(a => /\.html$/.test(a) && a[0] !== '-');
  return pos || 'index-test.html';
})();
const SRC = path.resolve(argFile);

/* THE FIXED LINE AND THE BROKEN ONE. The sabotage puts the original back —
   the actual regression, not a convenient nearby edit — so a green run
   under sabotage means this suite is not aimed at the bug it names. */
const FIXED_HEAD = "    if(!isFinite(ms)){ el.style.display = 'none'; return; }";
const BROKEN     = "    if(!isFinite(ms) || ms <= 0){ el.style.display = 'none'; return; }";

/* A MUTATED FILE NEVER TOUCHES THE REPO. The gate fingerprints its target,
   and a suite that rewrites the build under it makes every other suite's
   verdict meaningless. The copy goes to the scratchpad and THAT path is
   what gets served. */
function buildTarget() {
  const src = fs.readFileSync(SRC, 'utf8');
  if (!SAB) return { file: SRC, dir: path.dirname(SRC), base: path.basename(SRC) };

  if (src.indexOf(FIXED_HEAD) < 0) {
    console.log('  SABOTAGE COULD NOT BE APPLIED — the fixed line is not in ' + SRC);
    console.log('  This suite would have proved nothing, so it fails instead.');
    process.exit(1);
  }
  /* Put the whole ms<=0 branch back the way it was: the old combined guard,
     and the live-now block it replaced removed. */
  let out = src.replace(FIXED_HEAD, BROKEN);
  const startMark = "    if(ms <= 0){";
  const endMark   = "      return;\n    }\n";
  const s = out.indexOf(startMark);
  if (s < 0) { console.log('  SABOTAGE FAILED — the ms<=0 block is missing'); process.exit(1); }
  const e = out.indexOf(endMark, s);
  if (e < 0) { console.log('  SABOTAGE FAILED — the ms<=0 block has no end'); process.exit(1); }
  out = out.slice(0, s) + out.slice(e + endMark.length);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-live-sab-'));
  const base = 'sabotaged.html';
  fs.writeFileSync(path.join(dir, base), out);
  console.log('  sabotage written to ' + path.join(dir, base));
  return { file: path.join(dir, base), dir, base };
}

const T = buildTarget();

function serve(dir) {
  return new Promise(res => {
    const srv = http.createServer((rq, rs) => {
      const f = path.join(dir, decodeURIComponent(rq.url.split('?')[0]));
      fs.readFile(f, (e, b) => {
        if (e) { rs.writeHead(404); rs.end('nope'); return; }
        rs.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        rs.end(b);
      });
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port }));
  });
}

(async () => {
  const { chromium } = require('playwright');
  const { waitReady } = require(path.join(__dirname,'ready.js'));
  const { srv, port } = await serve(T.dir);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  let pass = 0, fail = 0;
  const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { fail++; console.log('  FAIL ' + name + (detail ? ('   ' + detail) : '')); }
  };

  await page.goto(`http://127.0.0.1:${port}/${T.base}`, { waitUntil: 'domcontentloaded' });
  /* WAIT ON THE APP'S OWN STATEMENT, NOT ON A SYMBOL EXISTING.
     This waited for `typeof window.featureTonight === 'function'` and
     swallowed the timeout with .catch(()=>{}) — both of the exact mistakes
     qa/ready.js was written to end. A function is defined thousands of
     lines before boot finishes, so under gate load this suite ran its
     checks against a half-built page: GREEN standalone, RED in the gate,
     and failing in 1780ms instead of ~10s because it never waited at all.
     I then blamed concurrency twice. waitReady() throws rather than
     continuing, which is the point — a boot failure must not be reported
     as a defect in the feature under test. */
  await waitReady(page);

  /* PROVE THE PRECONDITION FIRST. If the rest state does not actually
     paint, the rest of this suite is asserting nothing — that is how a
     check goes green over the bug it was written for. */
  const pre = await page.evaluate(async () => {
    TONIGHT = null;
    GAME.tipISO = new Date(Date.now() - 30 * 3600e3).toISOString();  // last night
    GAME.espnEvent = '';                       // no feed, so no live/final branch
    try { await paintHeroRibbon(); } catch (e) { return { err: String(e) }; }
    const c = document.getElementById('tonightCard');
    const r = document.getElementById('heroRibbon');
    return { card: c ? c.className : '', rib: r ? r.className : '', txt: r ? r.innerText : '' };
  });
  ok('hero-live.the-rest-state-really-does-paint',
     /mq-rest/.test(pre.card || '') && /No game tonight/i.test(pre.txt || ''),
     'precondition not reproduced: ' + JSON.stringify(pre));

  /* NOW TONIGHT'S GAME KICKS OFF. Thirty minutes ago — past its tip and
     comfortably inside REST_AFTER_MS (six hours), which is the window in
     which somebody opens the app in order to play. */
  const after = await page.evaluate(async () => {
    const isoIn = ms => new Date(Date.now() + ms).toISOString();
    SLATE.games = [{
      nightId: 'slate-qa-hero-live', espnEvent: '',
      tipISO: isoIn(-30 * 60e3), away: 'Away QA', home: 'Home QA',
      awayAbbr: 'AWY', homeAbbr: 'HOM', net: 'QA Net',
      flagship: true, sport: 'soccer', league: 'QA', marquee: true, gotn: true, gn: '99'
    }];
    SLATE.loaded = true;
      /* HOLD THE FIXTURE. loadSlate() may still be in flight from boot, and
         when it lands it rewrites SLATE.games from the REAL slate — where
         tonight's game is hours past its tip and correctly reads 'rest'.
         That is what this suite then reported as a product failure.
         It only ever passed because it used to run BEFORE the clobber:
         waiting properly on STATS_READY made the race reliable instead of
         removing it, which is the honest way round. Same fix qa/i18n.js
         needed for the rail an hour earlier. */
      try{ window.loadSlate = async function(){ return; }; }catch(_){}
      try{ window.__QA_SLATE_FIXTURE = SLATE.games; }catch(_){}
    try { featureTonight(); } catch (e) { return { err: String(e) }; }
    await new Promise(r => setTimeout(r, 400));
    try { await paintHeroRibbon(); } catch (e) {}
    const c  = document.getElementById('tonightCard');
    const r  = document.getElementById('heroRibbon');
    const vs = document.querySelector('.mq-vs');
    const hd = document.getElementById('landingHead');
    return {
      card:    c ? c.className : '',
      rib:     r ? r.className : '',
      ribTxt:  r ? r.innerText : '',
      vsDisp:  vs ? getComputedStyle(vs).display : 'ABSENT',
      vsH:     vs ? Math.round(vs.getBoundingClientRect().height) : 0,
      headTxt: hd ? hd.innerText.trim() : '',
      headDisp: hd ? getComputedStyle(hd).display : 'ABSENT',
      tonightSet: !!(window.TONIGHT && TONIGHT.tipISO)
    };
  });

  ok('hero-live.the-marquee-took-the-started-game',
     after.tonightSet === true, JSON.stringify(after));

  /* THE FOUR INVARIANTS. None of them names a team, a number or a date. */
  ok('hero-live.the-card-is-not-left-in-the-rest-state',
     !/mq-rest/.test(after.card || ''),
     'card="' + after.card + '"');

  ok('hero-live.the-ribbon-does-not-say-no-game-tonight',
     !/No game tonight/i.test(after.ribTxt || ''),
     'ribbon="' + (after.ribTxt || '').replace(/\n/g, ' / ') + '"');

  ok('hero-live.the-matchup-is-on-screen',
     after.vsDisp !== 'none' && after.vsH > 0,
     'display=' + after.vsDisp + ' height=' + after.vsH);

  ok('hero-live.the-game-number-is-on-screen',
     after.headDisp !== 'none' && (after.headTxt || '').length > 0,
     'display=' + after.headDisp + ' text="' + after.headTxt + '"');

  ok('hero-live.no-page-errors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  srv.close();

  console.log('');
  if (SAB) {
    if (fail > 0) {
      console.log(`  SABOTAGE CAUGHT — ${fail} check(s) went red with the bug restored.`);
      process.exit(0);
    }
    console.log('  NOT CAUGHT — every check passed with the bug put back. This suite proves nothing.');
    process.exit(1);
  }
  console.log(fail === 0 ? `  GREEN  ${pass} passed, 0 failed   [${T.base}]`
                         : `  RED    ${pass} passed, ${fail} failed   [${T.base}]`);
  process.exit(fail === 0 ? 0 : 1);
})();
