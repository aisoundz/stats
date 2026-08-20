#!/usr/bin/env node
/* ============ MOVING BETWEEN GAMES ==================================
   Founder, 20 Aug 2026: "We should be able to move freely between games
   and see the scores — don't stop till you get that right and tested."

   Room-switching is the feature this product has broken most often and
   tested least. Everything below is a defect that reached a live game
   night, and every one of them looked fine from the Control Room:

   · The SPORT did not follow the room. `hydrateBuiltIn` was declared
     twice; the surviving copy never called setSport(). Walking from the
     soccer practice game into the WNBA flagship left a basketball room
     rendering the SOCCER watchlist, with MIA and AME on it — Inter Miami
     and Club América, who were not playing anybody that night.
   · The WATCHLIST kept the demo fixture's teams. hydrateNight rebuilt the
     groups and the pick sheet from the real night and never touched
     CATCHES.
   · The STATS TAB showed the room you left. Its 25-second cache was keyed
     on TIME alone and never on which game it held — and because the live
     score ribbon re-polls inside that window, the stale entry never aged
     out. Founder, standing in the flagship: "im currently in the lynx on
     the stats page and its on the tempo game stats."
   · The SCORE FEED followed you. `eventId` in the Control Room was
     resolved once and never cleared, so Auto live score wrote the old
     game's score into the new room, every twenty seconds, while the
     button still said ON.

   None of those is a hard bug. Every one is the same shape — a fact that
   did not follow the room — and none of them had a check.

   This drives the real functions the app uses, in a real browser, on the
   build being promoted.

   Usage:  node qa/switch.js [index-test.html] [--file index-test.html]
   Serves itself on an ephemeral port — no setup, nothing to remember.
   Exit 0 green, 1 red.                                                  */

const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));
const ROOT = path.join(__dirname, '..');
const { waitReady } = require('./ready.js');

/* ============ IT SERVES ITSELF ======================================
   The first version of this suite needed a static server somebody had
   started by hand on port 8765. It passed every time I ran it and ERRORED
   the moment qa/all.js ran it, because the gate does not know about a
   server I started in another terminal.

   A suite that depends on a step a human remembered is the same failure as
   a collector nobody starts. So it brings its own, on an ephemeral port.

   It needs http:// rather than file:// for one specific reason: the ticker
   fetches ESPN's scoreboard, and a page loaded from file:// has origin
   'null', which ESPN's CORS policy refuses. That refusal was once
   misdiagnosed in this project as "the machine has no network". */
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((q, r) => {
      let f = q.url.split('?')[0];
      if (f === '/') f = '/index-test.html';
      const p = path.join(ROOT, path.normalize(f).replace(/^(\.\.[\/\\])+/, ''));
      fs.readFile(p, (e, d) => {
        if (e) { r.writeHead(404); r.end('not found'); return; }
        r.writeHead(200, { 'Content-Type': /\.html$/.test(f) ? 'text/html' : 'application/octet-stream' });
        r.end(d);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

const argFile = (() => {
  const i = process.argv.indexOf('--file');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.argv.slice(2).find(a => /\.html$/.test(a) && a[0] !== '-') || 'index-test.html';
})();

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m\n      ' + detail); }
}

/* Two rooms, two SPORTS, because a switch inside one sport would not have
   caught any of the four defects above. */
const ROOM_A = {
  nightId: 'sw-a-basketball', espnEvent: '401857157', league: 'wnba', sport: 'basketball',
  away: 'Lynx', home: 'Valkyries', awayAbbr: 'MIN', homeAbbr: 'GS',
  awayName: 'Minnesota Lynx', homeName: 'Golden State Valkyries', tipISO: '2026-08-20T02:00Z'
};
const ROOM_B = {
  nightId: 'sw-b-soccer', espnEvent: '761734', league: 'mls', sport: 'soccer',
  away: 'LAFC', home: 'Rapids', awayAbbr: 'LAFC', homeAbbr: 'COL',
  awayName: 'LAFC', homeName: 'Colorado Rapids', tipISO: '2026-08-20T01:30Z'
};

(async () => {
  console.log('\n  MOVING BETWEEN GAMES — ' + argFile + '\n');
  const { srv, port } = await serve();
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 393, height: 852 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  /* BASENAME, because qa/all.js hands a TARGETABLE suite an ABSOLUTE
     path — argv.push(TARGET_ABS). Joining that onto the server root made
     http://127.0.0.1:PORT//home/higherthan7/stats/index-test.html, a 404,
     and the page had no app on it: the suite died in 2.3s inside the gate
     while passing four times out of four by hand. 'It passes when I run
     it' is the sentence that hides a real defect, so this is the defect. */
  const urlFile = path.basename(argFile);
  await pg.goto('http://127.0.0.1:' + port + '/' + urlFile, { waitUntil: 'domcontentloaded' });
  /* WAS waitForTimeout(1400) — a guess that boot had finished, and one that
     lost twice on 20 Aug while another gate was running. Both times this
     suite reported a real check RED and both times the product was fine.
     The app states its own readiness now. */
  await waitReady(pg);

  const r = await pg.evaluate(async ({ A, B }) => {
    const out = {};
    const cfgFor = g => ({
      game: { nightId: g.nightId, espnEvent: g.espnEvent, sport: g.sport,
              awayName: g.awayName, homeName: g.homeName,
              awayAbbr: g.awayAbbr, homeAbbr: g.homeAbbr, tipISO: g.tipISO },
      roster: { home: [], away: [] },
      preds: (SPORTS[g.sport] && SPORTS[g.sport].preds) || []
    });

    /* ============ TURN LEAN OFF TO SEE THE WATCHLIST AT ALL ===========
       This suite checks that the watchlist follows the room — that a WNBA
       room never renders soccer's card, and that the demo fixture's MIA/AME
       teams never reach a live room. Both are real invariants.

       But LEAN suppresses the watchlist entirely, and until 20 Aug it did so
       by emptying a SHARED array once at boot, for whichever sport happened
       to load first. So basketball came back empty and soccer did not — and
       this check asserted exactly that: `aCatches === 0 && bCatches > 0`.
       It was green because of the bug, and it went red the moment LEAN was
       fixed to apply to every sport.

       The invariant is about the BANK, not about the flag. So drive it with
       the feature ON, where the watchlist exists and the question "whose
       teams are on it?" can actually be asked. qa/practice.js owns the LEAN
       behaviour itself, in both directions. */
    try{ LEAN_ON = false; }catch(_){}
    /* setSport() early-returns when you ask for the sport you are already on,
       so flipping the flag alone leaves CATCHES holding the value LEAN gave
       it at boot. Move away and back — which is what a player does anyway —
       so the change actually takes. Deliberately NOT assigning CATCHES here:
       the harness must not do the app's job. */
    try{ setSport(B.sport); setSport(A.sport); }catch(_){}

    /* ---- land in room A ---- */
    setSport(A.sport);
    hydrateNight(cfgFor(A));
    out.aSport = SPORT_KEY;
    out.aEvent = GAME.espnEvent;
    out.aCatches = (typeof CATCHES !== 'undefined' ? CATCHES.length : -1);

    /* warm the Stats cache on room A, the way the live score ribbon does */
    GS.ok = true; GS.at = Date.now(); GS.ev = String(A.espnEvent);
    GS.raw = { __marker: 'ROOM_A' };
    out.aCacheEvent = GS.ev;

    /* ---- switch to room B ---- */
    setSport(B.sport);
    hydrateNight(cfgFor(B));
    out.bSport = SPORT_KEY;
    out.bEvent = GAME.espnEvent;
    out.bCatches = (typeof CATCHES !== 'undefined' ? CATCHES.length : -1);
    out.bCatchTeams = (typeof CATCHES !== 'undefined' ? CATCHES
      .filter(c => c && c.teams).map(c => (c.opts || []).join('/')) : []);
    out.bCatchAnswers = (typeof CATCHES !== 'undefined' ? CATCHES
      .filter(c => c && c.teams).map(c => c.answer) : []);

    /* ============ CALL THE FUNCTION, DO NOT RE-DERIVE IT ==============
       The first version of this check recomputed loadGameStats's own guard
       inside the test — `GS.ok && GS.ev === event && age < 25s` — and then
       asserted on its own arithmetic. Sabotaging the app's guard therefore
       changed nothing and the check stayed green: a suite measuring its own
       stub, written inside the suite that exists to stop that.

       So: call loadGameStats and watch what it does to GS. On a cache MISS
       the real implementation resets `GS.ok = false` before attempting a
       fetch; on a HIT it returns immediately with GS.ok still true and the
       previous payload intact. That difference is observable without any
       network, which is what makes it testable here. */
    out.beforeCall = { ok: GS.ok, ev: GS.ev, marker: GS.raw && GS.raw.__marker };
    try { await loadGameStats(); } catch (_) {}
    out.afterCall = { ok: GS.ok, ev: GS.ev, marker: GS.raw && GS.raw.__marker };
    /* served the stale entry == it never invalidated and still holds A */
    out.servedStale = (out.afterCall.ok === true && out.afterCall.ev === String(A.espnEvent));

    /* ---- the rail shows every game, with scores ---- */
    SLATE.date = '2026-08-19'; SLATE.loaded = true;
    SLATE.games = [A, B];
    TICK.by = {
      [A.espnEvent]: { state: 'in',  detail: '2:46 - 1st', as: '16', hs: '9' },
      [B.espnEvent]: { state: 'in',  detail: "31'",        as: '0',  hs: '1' }
    };
    TICK.at = Date.now();
    S.place = ''; paintGameRail();
    const rail = document.getElementById('gameRail');
    out.railChoosing = rail ? rail.innerText : '';
    out.railScoreLines = document.querySelectorAll('#gameRail .grScore').length;
    out.railH_choosing = rail ? Math.round(rail.getBoundingClientRect().height) : 0;

    /* ---- mid-question it must shrink and still show both ---- */
    S.place = 'live'; paintGameRail();
    out.railPlaying = rail ? rail.innerText : '';
    out.railChips = document.querySelectorAll('#gameRail .grChip').length;
    out.railH_playing = rail ? Math.round(rail.getBoundingClientRect().height) : 0;
    out.viewportH = window.innerHeight;
    return out;
  }, { A: ROOM_A, B: ROOM_B });

  /* ---- 1. the sport follows the room ---- */
  ok('switch.the-sport-follows-the-room',
     r.aSport === 'basketball' && r.bSport === 'soccer',
     `landed in ${r.aSport}, switched to ${r.bSport} — expected basketball then soccer. This is the hydrateBuiltIn defect: a WNBA room rendering a soccer watchlist.`);

  /* ---- 2. the night follows the room ---- */
  ok('switch.the-game-follows-the-room',
     String(r.bEvent) === String(ROOM_B.espnEvent),
     `GAME.espnEvent is ${r.bEvent} after switching to ${ROOM_B.espnEvent}`);

  /* ---- 3. the watchlist follows the room ---- */
  ok('switch.the-watchlist-belongs-to-this-sport',
     r.aCatches > 0 && r.bCatches > 0,
     `with LEAN off, basketball had ${r.aCatches} watchlist rows and soccer has ${r.bCatches} — ` +
     `both must be > 0. Every sport carries a bank now; a sport with an empty one means the ` +
     `switch did not bring its watchlist with it. (This used to demand basketball be 0, which ` +
     `was LEAN destroying the shared bank of whichever sport booted first.)`);

  const teamsWrong = (r.bCatchTeams || []).filter(t => !/LAFC/.test(t) || !/COL/.test(t));
  ok('switch.the-watchlist-uses-this-match-teams',
     (r.bCatchTeams || []).length > 0 && teamsWrong.length === 0,
     `rows still offering other teams: ${JSON.stringify(teamsWrong)} — the demo fixture is MIA/AME and must never reach a live room`);

  ok('switch.the-watchlist-carries-no-baked-answer',
     (r.bCatchAnswers || []).every(a => a === null || a === undefined),
     `baked answers survived the rebuild: ${JSON.stringify(r.bCatchAnswers)} — grading a real match against the practice fixture's winner is a guaranteed zero`);

  /* ---- 4. the Stats tab does not hand back the room you left ---- */
  ok('switch.the-stats-cache-is-keyed-on-the-game',
     r.servedStale === false,
     `loadGameStats served the room you LEFT: before the call GS held event ${r.beforeCall && r.beforeCall.ev} (${r.beforeCall && r.beforeCall.marker}), after it still holds ${r.afterCall && r.afterCall.ev} with ok=${r.afterCall && r.afterCall.ok}. The cache is keyed on time, not on which game it is of — and the live score ribbon re-polls inside the window, so the stale entry never ages out.`);

  /* ---- 5. the rail shows every game and its score ---- */
  ok('switch.every-game-is-on-the-rail-with-its-score',
     r.railScoreLines >= 2 && /16/.test(r.railChoosing) && /9/.test(r.railChoosing) && /1/.test(r.railChoosing),
     `${r.railScoreLines} score lines rendered; rail read: ${JSON.stringify(String(r.railChoosing).slice(0, 90))}`);

  /* ---- 6. mid-question it gets out of the way WITHOUT hiding a game ---- */
  ok('switch.mid-question-the-rail-shrinks',
     r.railH_playing > 0 && r.railH_playing <= Math.round(r.viewportH / 5),
     `rail is ${r.railH_playing}px of a ${r.viewportH}px viewport mid-question — a chooser above a live question`);

  ok('switch.mid-question-no-game-disappears',
     r.railChips >= 2,
     `only ${r.railChips} games on the strip mid-question — shrinking must not cost you the other scores`);

  ok('switch.no-page-errors', errs.length === 0, errs.slice(0, 2).join(' · '));

  console.log('\n  rail: ' + r.railH_choosing + 'px choosing → ' + r.railH_playing +
              'px mid-question (' + r.viewportH + 'px viewport), ' + r.railChips + ' games kept\n');
  console.log('  ' + (fail ? '\x1b[31mRED   ' + pass + ' passed, ' + fail + ' failed\x1b[0m'
                            : '\x1b[32mGREEN  ' + pass + ' passed, 0 failed\x1b[0m') + '\n');
  await b.close();
  try{ srv.close(); }catch(_){}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('could not run: ' + e.message); process.exit(1); });
