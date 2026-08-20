#!/usr/bin/env node
/* ============ THE LANDING HERO MUST KNOW WHAT TONIGHT IS ==============
   Written 20 Aug 2026, from the founder opening statsgametime.com at 06:00
   and finding "No game tonight" printed over a slate with two games on it.

   THE DEFECT, in one sentence: host/marquee.js stamps `gotn` on the Game of
   the Night every single day, and nothing on the landing page ever read it.

   `flagship` and `gotn` were used for exactly two things, both cosmetic —
   ordering the rail and drawing a ★. Meanwhile `GAME` — the object the hero
   counts down from — was whatever night the app last hydrated, which on a
   fresh morning is YESTERDAY's, restored from the night-config cache. So
   heroState() read a tip that was fourteen hours gone, correctly concluded
   there was nothing to count down to, and said so.

   Two facts about tonight in one page, and neither knew about the other.
   That is the house disease and this is the check for it.

   WHY THIS SUITE DRIVES featureTonight() DIRECTLY rather than loading the
   page and waiting: the hydration lives at the tail of a Firestore call.
   Testing it through the network would mean stubbing Firestore, and the
   version of that test I would write is one that re-implements the pick
   rule in the harness — which passes whatever the app does. qa/switch.js
   shipped exactly that mistake this week. So the app exports the function
   and the suite calls the real one.

   Usage:  node qa/hero.js  [index-test.html]
   Exit 0 green, 1 red.                                                  */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const argFile = (() => {
  const i = process.argv.indexOf('--file');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  const pos = process.argv.slice(2).find(a => /\.html$/.test(a) && a[0] !== '-');
  return pos || 'index.html';
})();
/* all.js hands over an ABSOLUTE path; this server's root is the repo, so
   joining the two produced a 404 the first time qa/switch.js met the full
   gate. Basename it once, here. */
const TARGET = path.basename(argFile);

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

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m\n      ' + detail); }
}

/* Tonight's real slate, in the shape host/marquee.js actually writes it.
   NOTE `flagship` is true on BOTH and `gotn` on only the football game —
   that is not a contrivance, it is a verbatim copy of slate/2026-08-20, and
   it is the whole reason picking on `flagship` is wrong. */
const MLB = {
  nightId: 'slate-2026-08-20-wsh-tex', espnEvent: '401816609',
  tipISO: '2026-08-21T00:05Z', away: 'Nationals', home: 'Rangers',
  awayAbbr: 'WSH', homeAbbr: 'TEX', net: 'MLB.TV · FS1',
  flagship: true, sport: 'baseball', marquee: true, gotn: false
};
const NFL = {
  nightId: 'slate-2026-08-20-sf-lac', espnEvent: '401873285',
  tipISO: '2026-08-21T02:00Z', away: '49ers', home: 'Chargers',
  awayAbbr: 'SF', homeAbbr: 'LAC', net: 'NFL Net · CBS LA',
  flagship: true, sport: 'football', marquee: true, gotn: true
};

(async () => {
  const { chromium } = require('playwright');
  const { srv, port } = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  await page.goto(`http://127.0.0.1:${port}/${TARGET}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.featureTonight === 'function', { timeout: 15000 })
    .catch(() => {});

  const r = await page.evaluate(({ MLB, NFL }) => {
    const out = {};
    out.exported = (typeof window.featureTonight === 'function');
    if (!out.exported) return out;

    /* ---- 1. a fresh morning: GAME still holds YESTERDAY's night ---- */
    try { setSport('basketball'); } catch (_) {}
    GAME.nightId   = 'gn13-mystics-tempo';
    GAME.espnEvent = '401857157';
    GAME.tipISO    = '2026-08-19T23:30:00Z';   // last night
    S.place = '';
    SLATE.date = '2026-08-20'; SLATE.loaded = true;
    SLATE.games = [MLB, NFL];
    try { localStorage.clear(); } catch (_) {}

    out.beforeEvent = String(GAME.espnEvent);
    out.beforeTip   = String(GAME.tipISO);
    out.beforeHero  = (function(){ try { return heroState(); } catch (_) { return 'threw'; } })();

    out.featured    = featureTonight();
    out.afterEvent  = String(GAME.espnEvent);          // must NOT have moved
    out.afterSport  = SPORT_KEY;                       // must NOT have moved
    out.tonightEv   = String((window.TONIGHT||{}).espnEvent || '');
    out.tonightTip  = String((window.TONIGHT||{}).tipISO || '');
    out.heroGameEv  = String((heroGame()||{}).espnEvent || '');
    out.afterHero   = (function(){ try { return heroState(); } catch (_) { return 'threw'; } })();
    out.gsCleared   = (GS.ok === false);

    /* ---- 1b. THE WHOLE CARD MUST MEAN ONE GAME ----
       The first fix moved the clock and left everything around it, so the
       card read "TIPS IN 11:48:48" above "Final · TOR 82 - 93 WSH" under a
       headline saying WED · AUGUST 19. Paint it for real and read the DOM
       back: every line has to name tonight, and nothing may still name
       last night. */
    /* THE TEST DOES NOT PAINT. It used to call applySport() right here,
       which meant the harness was doing the app's job: featureTonight()
       changed TONIGHT and never repainted, the test painted for it, every
       check went green, and the founder's screen kept showing last night
       under tonight's countdown — three deploys running. If the app does
       not repaint, these checks must go red. */
    const txt = id => { const el = document.getElementById(id); return el ? (el.innerText || el.textContent || '') : '(missing)'; };
    out.card = {
      head:  txt('landingHead'),
      match: txt('landingMatch'),
      away:  txt('mqAway'),   home:  txt('mqHome'),
      tip:   txt('landingTip'),
      chip1: txt('landingChip1'), chip3: txt('landingChip3')
    };
    out.cardAll = Object.keys(out.card).map(k => out.card[k]).join(' | ');

    /* ---- 1c. EVERY SPORT CALLS THE START OF A GAME BY ITS OWN NAME ----
       host/build-slate.js mapped soccer and baseball and put everything
       else — including FOOTBALL — on "Tip-off", so the first live NFL night
       this product ever ran announced a basketball tip-off. Checked for
       ALL FIVE sports, not just the one that was reported: hockey had the
       identical bug sitting behind it, unreported only because no hockey
       night has run yet. */
    out.words = {};
    try {
      out.words.basketball = fixStartWord('Tip-off 7:00 PM ET · ABC', 'basketball');
      out.words.football   = fixStartWord('Tip-off 7:00 PM ET · NFL Net', 'football');
      out.words.baseball   = fixStartWord('Tip-off 7:00 PM ET · FS1', 'baseball');
      out.words.soccer     = fixStartWord('Tip-off 7:00 PM ET · Apple TV', 'soccer');
      out.words.hockey     = fixStartWord('Tip-off 7:00 PM ET · ESPN', 'hockey');
      /* and it must not maul a broadcaster that happens to contain the word */
      out.words.midline    = fixStartWord('Kickoff 7:00 PM ET · Kickoff FC Radio', 'football');
    } catch (e) { out.words.threw = String(e); }
    /* the marquee's own composed line carries the word too */
    try { out.tonightLine = tonightTipLine({tipISO: NFL.tipISO, sport: 'football', net: 'NFL Net'}); }
    catch (e) { out.tonightLine = 'threw: ' + e; }

    /* ---- 1d. NEVER ANOTHER GAME'S SCORE ----
       GS is one shared cache keyed on an event. Prime it with LAST NIGHT's
       WNBA game while the card is showing tonight's baseball room, exactly
       as it is on a real switch before loadGameStats has caught up, and
       demand the line says when the game starts rather than what happened
       somewhere else. */
    try { window.TONIGHT = null; TONIGHT = null; } catch (_) {}
    try { setSport('baseball'); } catch (_) {}
    GAME.nightId   = MLB.nightId;
    GAME.espnEvent = String(MLB.espnEvent);
    GAME.tip       = 'Tip-off 5:05 PM ET · FS1';
    /* GS.state is what phaseFromFeed() actually reads — 'post' is what makes
       phaseNow() say 'final' and send landingTipLine() down the score
       branch. Priming PHASE.v alone left the harness on 'pre', so the check
       passed on a build that has the bug: it was detecting the missing
       guard function rather than reproducing the defect. */
    GS.ok = true; GS.ev = '401857157'; GS.at = Date.now();      // last night
    GS.state = 'post';
    GS.teams = [{ab:'MIN', home:false, score:77}, {ab:'GS', home:true, score:66}];
    try { PHASE.v = 'final'; } catch (_) {}
    out.foreignLine = (function(){ try { return landingTipLine(); } catch (e) { return 'threw: ' + e; } })();
    out.gsGuard     = (function(){ try { return gsIsAbout(GAME); } catch (e) { return 'threw'; } })();
    try { PHASE.v = ''; GS.ok = false; GS.ev = null; GS.state = ''; GS.teams = []; } catch (_) {}

    /* ---- 2a. A STALE SAVED PLACE MUST NOT BLOCK TONIGHT ----
       THE CASE THAT SHIPPED BROKEN TWICE. S.place is persisted, so the one
       device that actually played last night wakes up with S.place='review'
       from a game that ended fourteen hours ago. The first guard refused to
       run whenever S.place was set, so on that device — the founder's, the
       only one that matters for this — the hero said "No game tonight" over
       a rail listing two games, while every headless check passed because a
       fresh profile has no saved place to be stale. */
    try { window.ACTIVE_ROOM = ''; } catch (_) {}
    GAME.nightId = 'gn13-mystics-tempo'; GAME.espnEvent = '401857157';
    S.place = 'review';                       // yesterday's, still on disk
    out.staleReturn = featureTonight();
    out.staleTonight = String((window.TONIGHT || {}).nightId || '');
    try { window.TONIGHT = null; TONIGHT = null; } catch (_) {}

    /* ---- 2b. but a player mid-question in a room that IS tonight's
       must be left completely alone ---- */
    GAME.nightId = MLB.nightId; GAME.espnEvent = String(MLB.espnEvent);
    S.place = 'live';
    out.inFlowReturn = featureTonight();
    out.inFlowEvent  = String(GAME.espnEvent);
    S.place = '';

    /* ---- 3. it must NOT override a room already on tonight's slate ---- */
    GAME.nightId = MLB.nightId; GAME.espnEvent = String(MLB.espnEvent);
    out.alreadyReturn = featureTonight();
    out.alreadyEvent  = String(GAME.espnEvent);

    /* ---- 4. no gotn anywhere: fall back to flagship, then to tip ---- */
    GAME.nightId = 'gn13-mystics-tempo'; GAME.espnEvent = '401857157';
    SLATE.games = [
      Object.assign({}, MLB, { gotn: false, flagship: false }),
      Object.assign({}, NFL, { gotn: false, flagship: false })
    ];
    out.noFlagFeatured = featureTonight();

    /* ---- 5. an empty slate must change nothing ---- */
    GAME.nightId = 'gn13-mystics-tempo'; GAME.espnEvent = '401857157';
    SLATE.games = [];
    out.emptyReturn = featureTonight();
    out.emptyEvent  = String(GAME.espnEvent);
    return out;
  }, { MLB, NFL });

  console.log('\n  HERO — the landing must feature tonight\'s Game of the Night\n');
  console.log('  judging ' + TARGET + '\n');

  ok('hero.the-function-is-exported', r.exported === true,
     'window.featureTonight is not a function — the app has no testable hydration point, ' +
     'so every check below would be measuring nothing.');

  if (r.exported) {
    ok('hero.features-the-game-of-the-night',
       r.featured === NFL.nightId,
       `featured "${r.featured}" — expected "${NFL.nightId}". Both games carry flagship:true ` +
       `and only the 7:00 football game carries gotn:true, so picking on flagship features the ` +
       `5:05 baseball game instead of the marquee.`);

    ok('hero.the-hero-points-at-tonights-game',
       r.tonightEv === NFL.espnEvent && r.heroGameEv === NFL.espnEvent,
       `TONIGHT.espnEvent is "${r.tonightEv}" and heroGame() reports "${r.heroGameEv}", both ` +
       `expected ${NFL.espnEvent}. heroGame() is the single reader the countdown, the state and ` +
       `the team line all share, so if it is wrong they disagree with each other.`);

    ok('hero.it-does-NOT-touch-the-room',
       r.afterEvent === '401857157',
       `GAME.espnEvent moved ${r.beforeEvent} → ${r.afterEvent}. Featuring tonight's game must ` +
       `leave GAME alone: it is the room the player is in, a different fact. The first version ` +
       `of this hydrated GAME and silently turned the whole app into football.`);

    ok('hero.stops-saying-no-game-tonight',
       r.beforeHero === 'rest' && r.afterHero !== 'rest',
       `heroState() was "${r.beforeHero}" and is now "${r.afterHero}". It must start at "rest" ` +
       `(that is the bug reproduced — yesterday's tip is long past) and must not still be "rest" ` +
       `afterwards, because "rest" is the literal "No game tonight" hero.`);

    ok('hero.it-does-NOT-change-the-sport',
       r.afterSport === 'basketball',
       `SPORT_KEY became "${r.afterSport}" after featuring a football game — it must stay ` +
       `"basketball". qa/voice-pick.js caught this: it opened the front door, asked for a player ` +
       `card and was handed "Total points, both teams?" because the marquee was NFL. Somebody who ` +
       `came to practice basketball must not be moved to football by what is on television.`);

    /* THERE IS NO stale-cache CHECK HERE, and that is a decision.
       One was written, and the sabotage run showed it could not fail:
       loadGameStats() already invalidates on an event change and
       qa/switch.js already proves it. Asserting it a second time here
       would be a check that can only ever be green. */
    ok('hero.the-whole-card-names-tonight',
       r.card && r.card.away === 'SF' && r.card.home === 'LAC' &&
       /49ers/.test(r.card.match) && /Chargers/.test(r.card.match),
       `the marquee card reads away="${r.card && r.card.away}" home="${r.card && r.card.home}" ` +
       `match="${r.card && r.card.match}" — expected SF / LAC / 49ers at Chargers. The clock is ` +
       `not the card; every line has to name the same game.`);

    ok('hero.the-card-carries-nothing-from-last-night',
       !/MIN|Lynx|Valkyries|Mystics|Tempo|TOR|WSH|August 19|Aug 19|Final/i.test(r.cardAll || ''),
       `something from last night survived on the card: ${JSON.stringify(r.cardAll)}. This is the ` +
       `check for the screenshot the founder sent — "TIPS IN 11:48:48" printed directly above ` +
       `"Final · TOR 82 - 93 WSH". A card that contradicts itself is worse than one that is ` +
       `uniformly stale.`);

    ok('hero.the-card-headline-says-tonight',
       /Aug/i.test(r.card && r.card.head || '') && /20/.test(r.card && r.card.head || ''),
       `the headline reads ${JSON.stringify(r.card && r.card.head)} — it must name tonight's date, ` +
       `built from the parsed tip instant (a 7pm Pacific kickoff is already tomorrow in UTC, so ` +
       `slicing the ISO string gives the wrong day).`);

    ok('hero.the-cadence-follows-the-featured-sport',
       !/quarter/i.test(r.card && r.card.chip3 || '') || (r.card.chip3||'').length > 0,
       `cadence chip reads ${JSON.stringify(r.card && r.card.chip3)}`);

    ok('hero.never-shows-another-games-score',
       r.gsGuard === false && !/77|66|MIN|\bGS\b|Final/.test(String(r.foreignLine)),
       `with the feed cache still holding last night's WNBA game, the baseball card's tip line ` +
       `read ${JSON.stringify(r.foreignLine)} (gsIsAbout=${r.gsGuard}). This is the founder's ` +
       `screenshot: "Final · MIN 77 - 66 GS" printed under NATIONALS @ RANGERS. A missing score ` +
       `is a gap; a wrong score is a lie.`);

    ok('hero.and-still-says-when-this-game-starts',
       /^First pitch/.test(String(r.foreignLine)),
       `it fell back to ${JSON.stringify(r.foreignLine)} — the fallback must be THIS game's start ` +
       `line, in baseball's own words, not an empty string.`);

    ok('hero.every-sport-names-its-own-start',
       r.words && /^Kickoff/.test(r.words.football) && /^Tip-off/.test(r.words.basketball) &&
       /^First pitch/.test(r.words.baseball) && /^Kickoff/.test(r.words.soccer) &&
       /^Puck drop/.test(r.words.hockey),
       `football="${r.words && r.words.football}" basketball="${r.words && r.words.basketball}" ` +
       `baseball="${r.words && r.words.baseball}" soccer="${r.words && r.words.soccer}" ` +
       `hockey="${r.words && r.words.hockey}". A football card that says "Tip-off" is telling a ` +
       `player about a sport they are not watching.`);

    ok('hero.fixing-the-word-does-not-maul-the-rest',
       r.words && r.words.midline === 'Kickoff 7:00 PM ET · Kickoff FC Radio',
       `got "${r.words && r.words.midline}" — only the LEADING word may be replaced; the times and ` +
       `the broadcast list are not ours to rewrite.`);

    ok('hero.the-marquee-line-carries-the-word-too',
       /^Kickoff/.test(r.tonightLine || ''),
       `the marquee's composed tip line reads "${r.tonightLine}" — it must open with the featured ` +
       `sport's own word, or the fix only covers rooms that were already hydrated.`);

    ok('hero.a-stale-saved-place-does-not-block-tonight',
       r.staleReturn === NFL.nightId && r.staleTonight === NFL.nightId,
       `with S.place="review" left over from last night's room it returned "${r.staleReturn}" and ` +
       `TONIGHT is "${r.staleTonight}" — both must be "${NFL.nightId}". S.place is PERSISTED, so ` +
       `treating "S.place is set" as "this person is mid-question" makes the fix inert on the one ` +
       `device that played last night. That shipped twice.`);

    ok('hero.never-moves-a-player-mid-game',
       r.inFlowReturn === '' && r.inFlowEvent === MLB.espnEvent,
       `mid-question in the baseball room — one of TONIGHT's — it returned "${r.inFlowReturn}" and ` +
       `left the event at ${r.inFlowEvent}. Somebody answering a question in a room that is on ` +
       `tonight's slate must be left completely alone.`);

    ok('hero.never-overrides-a-room-you-picked',
       r.alreadyReturn === '' && r.alreadyEvent === MLB.espnEvent,
       `GAME was already on ${MLB.nightId} — one of tonight's rooms — and this returned ` +
       `"${r.alreadyReturn}" leaving event ${r.alreadyEvent}. A player who chose the baseball room ` +
       `must not be yanked to the football one.`);

    ok('hero.still-picks-something-with-no-flags',
       r.noFlagFeatured === MLB.nightId,
       `with neither gotn nor flagship on any game it featured "${r.noFlagFeatured}", expected the ` +
       `earliest tip "${MLB.nightId}". A slate the marquee never stamped must still light the hero.`);

    ok('hero.an-empty-slate-changes-nothing',
       r.emptyReturn === '' && r.emptyEvent === '401857157',
       `an empty slate returned "${r.emptyReturn}" and set event ${r.emptyEvent} — it must leave ` +
       `GAME strictly alone so the genuine "No game tonight" still works.`);
  }

  ok('hero.no-page-errors', errs.length === 0, errs.join('\n      '));

  await browser.close(); srv.close();
  console.log('\n  ' + (fail ? '\x1b[31mRED   ' + pass + ' passed, ' + fail + ' failed\x1b[0m'
                             : '\x1b[32mGREEN  ' + pass + ' passed, 0 failed\x1b[0m') + '\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
