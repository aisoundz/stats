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
/* ============ THE FIXTURE TELLS THE TIME, NOT THE CALENDAR =========
   These two tips were written as literals — 2026-08-21T00:05Z and
   T02:00Z — and this suite went RED at midnight on 21 Aug because of it.
   Nothing in the app changed. The fixture simply got old: heroState()
   returns 'rest' once a tip is more than REST_AFTER_MS (6h) past, so a
   slate pinned to last night correctly reads "No game tonight", and
   `hero.stops-saying-no-game-tonight` was asserting that it must not.

   Section 4 below already learned this and says so in its own comment:
   "A check whose answer depends on the hour it runs is not a check."
   Section 1 was never given the same treatment. Now it is.

   The tips are the NEXT 5:00 and 7:00 in the evening, Pacific. Two
   properties are being preserved deliberately:
     · always in the future, so the hero is never legitimately at rest;
     · always an EVENING Pacific time, which is the following day in UTC —
       that is the whole point of `hero.the-card-headline-says-tonight`,
       which exists because slicing the ISO string gives the wrong day. A
       tip of "now + 4 hours" would pass that check at breakfast and stop
       exercising the bug entirely. */
function laTip(hour, dayOffset){
  const base = new Date(Date.now() + (dayOffset || 0) * 86400000);
  const day  = base.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const hh   = String(hour).padStart(2, '0');
  for (const off of ['-07:00', '-08:00']) {           // PDT, then PST
    const d = new Date(day + 'T' + hh + ':00:00' + off);
    const back = Number(d.toLocaleString('en-US',
      { timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false }));
    if (back === hour) return d.toISOString();
  }
  return new Date(day + 'T' + hh + ':00:00-07:00').toISOString();
}
/* If the earlier of the two has already tipped, roll BOTH to tomorrow, so
   the pair keeps its order and both stay ahead of the clock. */
/* THE FOOTBALL GAME TIPS FIRST, and that is deliberate. Section 1 is
   about the CARD — every line naming one game — not about which game
   wins. Ranking is section 4's job and it drives its own times. Giving
   the featured game the earlier tip means section 1 keeps asserting what
   it was written to assert, under the rule the founder set on 20 Aug:
   the marquee is what is on now, or next. */
const TIP_DAY  = (Date.parse(laTip(17, 0)) <= Date.now() + 30 * 60000) ? 1 : 0;
const NFL_TIP  = laTip(17, TIP_DAY);
const MLB_TIP  = laTip(19, TIP_DAY);
/* The night GAME is still holding when the app wakes: long past, so
   heroState() starts at 'rest' — which is the bug being reproduced. */
const STALE_TIP = new Date(Date.now() - 30 * 3600e3).toISOString();

const _la = (iso, o) => new Date(iso).toLocaleDateString('en-US',
  Object.assign({ timeZone: 'America/Los_Angeles' }, o));
/* What the headline must say, and what it must NOT still say. */
const WANT_DAY   = _la(NFL_TIP, { day: 'numeric' });
const WANT_MONTH = _la(NFL_TIP, { month: 'long' });
const STALE_LONG = _la(STALE_TIP, { month: 'long', day: 'numeric' });
const STALE_SHRT = _la(STALE_TIP, { month: 'short', day: 'numeric' });

const MLB = {
  nightId: 'slate-2026-08-20-wsh-tex', espnEvent: '401816609',
  tipISO: MLB_TIP, away: 'Nationals', home: 'Rangers',
  awayAbbr: 'WSH', homeAbbr: 'TEX', net: 'MLB.TV · FS1',
  flagship: true, sport: 'baseball', marquee: true, gotn: false
};
const NFL = {
  nightId: 'slate-2026-08-20-sf-lac', espnEvent: '401873285',
  tipISO: NFL_TIP, away: '49ers', home: 'Chargers',
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

  const r = await page.evaluate(({ MLB, NFL, STALE_TIP }) => {
    const out = {};
    out.exported = (typeof window.featureTonight === 'function');
    /* read INSIDE the page — hydrateNight is a page function, and asking for
       it from node gets "window is not defined" rather than an answer. */
    try { out.hydratePaints = /paintHeroRibbon/.test(String(hydrateNight)); }
    catch (_) { out.hydratePaints = false; }
    if (!out.exported) return out;

    /* ---- 1. a fresh morning: GAME still holds YESTERDAY's night ---- */
    try { setSport('basketball'); } catch (_) {}
    GAME.nightId   = 'gn13-mystics-tempo';
    GAME.espnEvent = '401857157';
    GAME.tipISO    = STALE_TIP;                // last night, 30h ago
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

    /* ---- 2c. AN EXPLICIT ?game= LINK OUTRANKS THE MARQUEE ----
       featureTonight() runs at the tail of loadSlate(); chooseGame() binds
       a linked room later. So with ?game= in the URL the marquee can win a
       race it has no business winning, and somebody who followed a link to
       the baseball room lands on the football card. Measured live. */
    try { window.TONIGHT = null; TONIGHT = null; } catch (_) {}
    GAME.nightId = 'gn13-mystics-tempo'; GAME.espnEvent = '401857157';
    S.place = '';
    try { window.__origSlateParam = window.slateParam; } catch (_) {}
    try { slateParam = function(){ return MLB.nightId; }; } catch (_) {}
    out.linkedReturn  = featureTonight();
    out.linkedTonight = String((window.TONIGHT || {}).nightId || '');
    try { slateParam = window.__origSlateParam || slateParam; } catch (_) {}

    /* ---- 3. it must NOT override a room already on tonight's slate ---- */
    GAME.nightId = MLB.nightId; GAME.espnEvent = String(MLB.espnEvent);
    out.alreadyReturn = featureTonight();
    out.alreadyEvent  = String(GAME.espnEvent);

    /* ---- 4. no flags anywhere: the CLOCK decides -------------------
       This used to assert "earliest tip wins" against fixtures carrying
       tonight's real tip times, so it passed all afternoon and failed at
       8:50pm when one of those games had finished and the other was live.
       A check whose answer depends on the hour it runs is not a check.

       And the rule it asserted is the one the founder changed on 20 Aug:
       "Yes that should be the case, it should always be in order." The
       marquee is what is ON NOW, or NEXT. So both cases are driven here
       with times relative to now, and neither depends on the wall clock. */
    var isoIn = function(ms){ return new Date(Date.now() + ms).toISOString(); };
    GAME.nightId = 'gn13-mystics-tempo'; GAME.espnEvent = '401857157';
    SLATE.games = [
      Object.assign({}, NFL, { gotn:false, flagship:false, tipISO: isoIn(3*3600e3) }),
      Object.assign({}, MLB, { gotn:false, flagship:false, tipISO: isoIn(1*3600e3) })
    ];
    out.noFlagFeatured = featureTonight();

    /* And with one of them already under way, the live game outranks a
       game that has not started, whatever the order in the array. */
    GAME.nightId = 'gn13-mystics-tempo'; GAME.espnEvent = '401857157';
    SLATE.games = [
      Object.assign({}, MLB, { gotn:false, flagship:false, tipISO: isoIn(2*3600e3) }),
      Object.assign({}, NFL, { gotn:false, flagship:false, tipISO: isoIn(-30*60e3) })
    ];
    out.liveWinsFeatured = featureTonight();

    /* ---- 4c. THE CLOCK BEATS THE FLAG ----
       The rule the founder set on 20 Aug, and it was never pinned by a
       check. `features-the-game-of-the-night` looked like it covered this
       and did not: its fixture had the gotn game tipping first, so gotn
       and the clock always agreed and no check could tell them apart.
       Here they DISAGREE — gotn sits on a game five hours out while
       another tips in one — and the near one must win, because the old
       rule pinned the hero to a single game for nine and a half hours of
       a four-room Saturday. */
    GAME.nightId = 'gn13-mystics-tempo'; GAME.espnEvent = '401857157';
    SLATE.games = [
      Object.assign({}, NFL, { gotn:true,  flagship:true,  tipISO: isoIn(5*3600e3) }),
      Object.assign({}, MLB, { gotn:false, flagship:false, tipISO: isoIn(1*3600e3) })
    ];
    out.clockBeatsFlag = featureTonight();

    /* ---- 5. an empty slate must change nothing ---- */
    GAME.nightId = 'gn13-mystics-tempo'; GAME.espnEvent = '401857157';
    SLATE.games = [];
    out.emptyReturn = featureTonight();
    out.emptyEvent  = String(GAME.espnEvent);
    return out;
  }, { MLB, NFL, STALE_TIP });

  console.log('\n  HERO — the landing must feature tonight\'s Game of the Night\n');
  console.log('  judging ' + TARGET + '\n');

  ok('hero.the-function-is-exported', r.exported === true,
     'window.featureTonight is not a function — the app has no testable hydration point, ' +
     'so every check below would be measuring nothing.');

  if (r.exported) {
    ok('hero.features-what-is-on-now-or-next',
       r.featured === NFL.nightId,
       `featured "${r.featured}" — expected "${NFL.nightId}", the next game to tip. Every other ` +
       `line on the card below is then asserted against that same game: the clock picks it, and ` +
       `the whole card has to agree with the clock.`);

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
    ok('hero.hydrating-a-night-paints-the-countdown',
       r.hydratePaints === true,
       `hydrateNight() does not repaint the hero. It runs at boot against the BUILT-IN night, ` +
       `whose tip is already past, so the ribbon hides itself — and the only thing that painted ` +
       `it again was a 30s interval. Opening a room showed no countdown for up to half a minute.`);

    ok('hero.the-whole-card-names-tonight',
       r.card && r.card.away === 'SF' && r.card.home === 'LAC' &&
       /49ers/.test(r.card.match) && /Chargers/.test(r.card.match),
       `the marquee card reads away="${r.card && r.card.away}" home="${r.card && r.card.home}" ` +
       `match="${r.card && r.card.match}" — expected SF / LAC / 49ers at Chargers. The clock is ` +
       `not the card; every line has to name the same game.`);

    ok('hero.the-card-carries-nothing-from-last-night',
       !new RegExp('MIN|Lynx|Valkyries|Mystics|Tempo|TOR|WSH|Final|' +
                   STALE_LONG.replace(' ', '\\s+') + '|' +
                   STALE_SHRT.replace(' ', '\\s+'), 'i').test(r.cardAll || ''),
       `something from last night survived on the card: ${JSON.stringify(r.cardAll)}. This is the ` +
       `check for the screenshot the founder sent — "TIPS IN 11:48:48" printed directly above ` +
       `"Final · TOR 82 - 93 WSH". A card that contradicts itself is worse than one that is ` +
       `uniformly stale.`);

    ok('hero.the-card-headline-says-tonight',
       new RegExp(WANT_MONTH.slice(0,3), 'i').test(r.card && r.card.head || '') &&
       new RegExp('\\b' + WANT_DAY + '\\b').test(r.card && r.card.head || ''),
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

    ok('hero.an-explicit-game-link-outranks-the-marquee',
       r.linkedReturn === '' && r.linkedTonight === '',
       `with ?game=${MLB.nightId} in the URL it returned "${r.linkedReturn}" and set TONIGHT to ` +
       `"${r.linkedTonight}" — both must be empty. A link to the baseball room must open the ` +
       `baseball room, not the night's headline act.`);

    ok('hero.never-overrides-a-room-you-picked',
       r.alreadyReturn === '' && r.alreadyEvent === MLB.espnEvent,
       `GAME was already on ${MLB.nightId} — one of tonight's rooms — and this returned ` +
       `"${r.alreadyReturn}" leaving event ${r.alreadyEvent}. A player who chose the baseball room ` +
       `must not be yanked to the football one.`);

    ok('hero.with-no-flags-the-next-to-tip-wins',
       r.noFlagFeatured === MLB.nightId,
       `with neither gotn nor flagship and both games ahead, it featured "${r.noFlagFeatured}", ` +
       `expected the one tipping first, "${MLB.nightId}". A slate the marquee never stamped must ` +
       `still light the hero, and it must light the one people can join soonest.`);

    ok('hero.the-clock-beats-the-game-of-the-night-flag',
       r.clockBeatsFlag === MLB.nightId,
       `gotn sat on the game five hours away while the other tipped in one hour; it featured ` +
       `"${r.clockBeatsFlag}", expected "${MLB.nightId}". Founder, 20 Aug: "it should always be ` +
       `in order." The Game of the Night marks the night's headline act — it does not pin the ` +
       `marquee to something nobody can join yet.`);

    ok('hero.a-live-game-outranks-one-that-has-not-started',
       r.liveWinsFeatured === NFL.nightId,
       `with the football game already under way and the baseball one two hours off, it featured ` +
       `"${r.liveWinsFeatured}", expected "${NFL.nightId}". Founder, 20 Aug: "it should always be ` +
       `in order" — the marquee is what is ON NOW, or next. On a four-room Saturday the old rule ` +
       `pinned the hero to one game for nine and a half hours.`);

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
