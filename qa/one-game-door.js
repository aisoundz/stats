#!/usr/bin/env node
/* ============================================================================
   qa/one-game-door.js — A ONE-GAME NIGHT MUST HAVE A WAY IN

   31 Aug 2026. The hero was fixed and the founder still could not play. The
   front page named Arsenal at Villa Park correctly and the button under it
   read "Pick a game above" — with nothing above to pick, because
   paintGameRail() hides itself below two games ("one game is not a choice",
   which is right) and tonight's slate had exactly one room. startLive()
   answered a tap with "Pick tonight's game above and the card opens with
   it." Two guards pointing at each other and a hidden element between them.

   Both messages read off GAME, which on a night whose sport is not the
   page's default is still the built-in fallback from 19 August. Same
   wrong-subject shape as the hero and the tip line, one control further on.

   WHAT THIS PINS, and none of it is a team name or a date:
     - with one game on the slate the rail stays hidden (the decision is
       deliberate and must not be "fixed" by showing a one-item chooser)
     - the primary button does NOT tell the player to pick from it
     - pressing that button lands them in tonight's room
     - the sport follows the room, because a tap is a choice

   THE SPORT POINT IS THE SUBTLE ONE. Earlier the same day, adopting the
   night's sport at BOOT took practice-score.js and pick-reach.js red and was
   reverted: somebody who opens the site to practise basketball must not be
   handed another sport because of what is on television. Here the player
   pressed a button that named the game. This suite asserts the sport moves
   ON THE TAP and those two suites still assert it does not move before one.

   Usage:  node qa/one-game-door.js [index-test.html]
           node qa/one-game-door.js --sabotage
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

/* The sabotage puts the ACTUAL regression back: the button wired straight to
   startLive() again, which is what left the one-game night with no door. */
const WIRED   = 'id="landingBtn" onclick="playTonight()"';
const UNWIRED = 'id="landingBtn" onclick="startLive()"';

function target() {
  const src = fs.readFileSync(SRC, 'utf8');
  if (!SAB) return { dir: path.dirname(SRC), base: path.basename(SRC) };
  if (src.indexOf(WIRED) < 0) {
    console.log('  SABOTAGE COULD NOT BE APPLIED — the button is not wired to playTonight() in ' + SRC);
    process.exit(1);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-game-door-'));
  fs.writeFileSync(path.join(dir, 'sabotaged.html'), src.replace(WIRED, UNWIRED));
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
  await page.waitForFunction(() => typeof window.featureTonight === 'function', { timeout: 25000 })
    .catch(() => {});

  /* ONE game, in a sport that is not the page's default, and a GAME still
     holding a night that is not on it — the exact shape of 31 Aug. */
  const setup = await page.evaluate(async () => {
    const isoIn = ms => new Date(Date.now() + ms).toISOString();
    try { SB.verified = function () { return true; }; } catch (_) {}
    GAME.nightId = 'gn13-not-tonight'; GAME.espnEvent = '';
    GAME.tipISO = new Date(Date.now() - 30 * 3600e3).toISOString();
    SLATE.date = 'qa'; SLATE.loaded = true;
    SLATE.games = [{
      nightId: 'slate-qa-one-game', espnEvent: '999999',
      tipISO: isoIn(-30 * 60e3), away: 'Away QA', home: 'Home QA',
      awayAbbr: 'AWY', homeAbbr: 'HOM', net: 'QA Net',
      flagship: true, sport: 'soccer', league: 'QA', marquee: true, gotn: true, gn: '99'
    }];
    /* GIVE THE ROOM A CONFIG TO BE FOUND IN. chooseGame() tries a live
       read, then this phone's cache, then the built-in night, and refuses
       if all three miss — which is correct behaviour and which a fake
       nightId would otherwise trip, turning a fixture gap into a red that
       looks like a product bug. Built from the sport's own objects so it
       is a shape hydrateNight() genuinely accepts. */
    try {
      const cfg = {
        game: Object.assign({}, SPORTS.soccer.game, {
          nightId: 'slate-qa-one-game', espnEvent: '999999',
          sport: 'soccer', tipISO: isoIn(-30 * 60e3) }),
        roster: SPORTS.soccer.roster,
        preds:  SPORTS.soccer.preds
      };
      localStorage.setItem('stats_night_cfg_slate-qa-one-game', JSON.stringify(cfg));
    } catch (_) {}
    try { featureTonight(); } catch (_) {}
    try { applySport(); } catch (_) {}
    try { paintSlate(); } catch (_) {}
    await new Promise(r => setTimeout(r, 300));
    const rail = document.getElementById('gameRail');
    const btn  = document.getElementById('landingBtn');
    return {
      slateN: (SLATE.games || []).length,
      railDisp: rail ? getComputedStyle(rail).display : 'ABSENT',
      btnTxt: btn ? btn.innerText.trim() : 'ABSENT',
      sportBefore: SPORT_KEY, gameBefore: GAME.nightId
    };
  });

  ok('one-game-door.one-game-keeps-the-rail-hidden',
     setup.slateN === 1 && setup.railDisp === 'none',
     'games=' + setup.slateN + ' rail=' + setup.railDisp);

  /* THE LIE. "above" may not appear on a screen with nothing above. */
  ok('one-game-door.the-button-does-not-point-at-a-hidden-rail',
     !/above/i.test(setup.btnTxt || ''),
     'button reads "' + setup.btnTxt + '"');

  ok('one-game-door.the-button-names-the-game-it-opens',
     /play/i.test(setup.btnTxt || '') && (setup.btnTxt || '').length > 4,
     'button reads "' + setup.btnTxt + '"');

  /* THE DOOR ITSELF. */
  await page.evaluate(() => { document.getElementById('landingBtn').click(); });
  await page.waitForTimeout(9000);   /* chooseGame bounds its live read at 4s */
  const after = await page.evaluate(() => {
    const q = f => { try { return f(); } catch (e) { return 'ERR'; } };
    return { game: q(() => GAME.nightId), sport: q(() => SPORT_KEY),
             active: q(() => (typeof ACTIVE_ROOM !== 'undefined' ? ACTIVE_ROOM : '')),
             screen: q(() => S.screen) };
  });

  ok('one-game-door.pressing-it-lands-in-tonights-room',
     after.game === 'slate-qa-one-game' || after.active === 'slate-qa-one-game',
     JSON.stringify(after));

  ok('one-game-door.the-sport-follows-the-room-on-a-tap',
     after.sport === 'soccer', 'sport=' + after.sport);

  ok('one-game-door.the-player-left-the-landing-screen',
     after.screen !== 'landing', 'screen=' + after.screen);

  ok('one-game-door.no-page-errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close(); srv.close();
  console.log('');
  if (SAB) {
    if (fail > 0) { console.log(`  SABOTAGE CAUGHT — ${fail} check(s) red with the button unwired.`); process.exit(0); }
    console.log('  NOT CAUGHT — everything passed with the bug restored. This suite proves nothing.');
    process.exit(1);
  }
  console.log(fail === 0 ? `  GREEN  ${pass} passed, 0 failed   [${T.base}]`
                         : `  RED    ${pass} passed, ${fail} failed   [${T.base}]`);
  process.exit(fail === 0 ? 0 : 1);
})();
