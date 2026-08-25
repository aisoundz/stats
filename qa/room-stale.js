#!/usr/bin/env node
/* =====================================================================
   qa/room-stale.js — "YOUR ROOM TONIGHT" MUST AGREE WITH THE HEADER
   ---------------------------------------------------------------------
   Founder screenshot, 24 Aug, TB @ DET, Top 7th. One screen, one player,
   two numbers:

       header               35 pts · #2
       Your room tonight    Sam — 0 pts

   stRoomCard() was the last score surface still holding its own copy of
   the board instead of reading `lastStand`, the room-scoped cache that
   myRank(), liveRank(), shownTotal() and the YOUR NIGHT tile were all
   migrated onto. Two independent defects, and either one alone still
   prints a wrong number:

     1. IT FROZE. `ROOMSTAT.ok` was set true on the first successful
        fetch and NOTHING in the file ever set it back — no TTL, no
        invalidation, no reset when a round settled, no reset on a room
        switch. The card was a snapshot of whatever the board said the
        first time the Stats tab was opened that night. It was also never
        room-scoped, so it followed the player into the next room —
        roomListenersStop()'s own comment describes `lastStand` having
        had exactly this disease ("the points on the football switches
        between players", "I think my points decreased").
     2. IT READ THE WRONG FIELD. Six other readers of a board row take
        `Number(p.total != null ? p.total : p.pts) || 0`. This one took
        `p.pts` alone, so a row carrying `total` rendered 0 with
        PERFECTLY FRESH DATA. Fixing only the freshness would have left
        the card showing zeros.

   AND THE THING THE FIX MUST NOT BREAK. The `ROOMSTAT.ok` guard is
   load-bearing: loadRoomStat() returns an already-resolved promise on
   every early exit and stRoomCard() hangs a redraw on it, which once
   produced a MICROTASK CHAIN at ~2,400 redraws/sec. Microtasks drain
   before the browser does anything else, so no timer, no network
   callback, no tap and no repaint ever gets a turn again — the page
   looks completely normal and the session is over. It fires harder the
   better the feed is working. The invariant is:

       a promise that did no real work resolves FALSE,
       and renderStats() is only called when did === true.

   Seven levers, each pulled on its own in --sabotage so a regression names
   itself instead of producing one vague red line:

       live      stRoomCard() reads roomStand() (the live cache) first
       total     roomStatPts()'s house rule, total ?? pts
       scope     the render-side ROOMSTAT.night room check
       inflight  dropping a fetch that lands after a room switch
       okguard   the loadRoomStat() ok-guard (the microtask chain)
       didguard  the did===true gate on the redraw

       node qa/room-stale.js [index-test.html]
       node qa/room-stale.js --sabotage
   ================================================================== */
/* ENGINE. Defaults to chromium so the gate runs exactly as it did. The
   house note for this box prefers Firefox and qa/ is engine-sensitive —
   the SB.top stubbing and the window.renderStats reassignment this suite
   leans on are MEANT to be engine-neutral, and that is worth being able
   to prove rather than assume:
       node qa/room-stale.js --engine=firefox
   Named here rather than in a throwaway wrapper so the next person can
   re-run the same check instead of taking this run's word for it. */
const playwright = require('playwright');
const ENGINE_NAME = (process.argv.find(a => /^--engine=/.test(a)) || '--engine=chromium').split('=')[1];
const ENGINE = playwright[ENGINE_NAME];
if (!ENGINE) { console.log('room-stale: unknown --engine=' + ENGINE_NAME); process.exit(1); }
const path = require('path'), fs = require('fs'), os = require('os');
const { waitReady } = require('./ready.js');

const TARGET = path.resolve(process.argv.find(a => /\.html$/.test(a)) || path.join(__dirname, '..', 'index-test.html'));
const SABOTAGE = process.argv.includes('--sabotage');
const PHONE = { width: 393, height: 852 };

let pass = 0, fail = 0; const bad = [];
const ok = (label, c, detail) => { if (c) pass++; else { fail++; bad.push(label + (detail ? '  — ' + detail : '')); } };

/* One-line, uniquely-anchored levers — same convention as qa/round-lead.js
   and qa/change-it.js. If a pattern has moved, say so LOUDLY rather than
   sabotaging nothing and reporting a false green. */
const LEVERS = {
  live: {
    name: 'stRoomCard() reading the live room cache (roomStand()) first',
    from: 'try{ list = roomStand(); }catch(_){}',
    to:   'try{ list = null; }catch(_){}'
  },
  total: {
    name: 'roomStatPts() house rule (total ?? pts)',
    from: 'return Number(p && (p.total != null ? p.total : p.pts)) || 0;',
    to:   'return (p && typeof p.pts === \'number\') ? p.pts : 0;'
  },
  scope: {
    name: 'the ROOMSTAT.night room check on the cold-start fallback',
    from: 'if((!list || !list.length) && ROOMSTAT.ok && ROOMSTAT.night === roomStatNight()){',
    to:   'if((!list || !list.length) && ROOMSTAT.ok){'
  },
  inflight: {
    name: 'dropping a board fetch that lands after a room switch',
    from: 'if(roomStatNight() !== want) return false;',
    to:   'if(false) return false;'
  },
  okguard: {
    name: 'the loadRoomStat() ok-guard (the 2,400/sec microtask chain)',
    from: 'if(roomStatFresh()) return Promise.resolve(false);',
    to:   'if(false) return Promise.resolve(false);'
  },
  ttl: {
    name: 'the cold-start TTL (roomStatFresh()\'s clock)',
    from: '&& (Date.now() - (ROOMSTAT.at || 0)) < ROOMSTAT_TTL_MS;',
    to:   '&& true;'
  },
  didguard: {
    name: 'the did===true gate on the redraw',
    from: "loadRoomStat().then(function(did){ if(did && S.screen==='stats') renderStats(); })",
    to:   "loadRoomStat().then(function(did){ if(true && S.screen==='stats') renderStats(); })"
  }
};

function writeCandidate(leverKey) {
  let html = fs.readFileSync(TARGET, 'utf8');
  if (leverKey) {
    const L = LEVERS[leverKey];
    /* SPLIT/JOIN, NOT .replace(). String.replace() takes only the FIRST
       occurrence, and the did-guard now sits at two call sites — a lever
       that disabled one of two guards would be testing something nobody
       described. Replace every one, and say how many, so a lever that
       quietly widens its blast radius is visible in the log rather than
       inferred from a surprising result. */
    const hits = html.split(L.from).length - 1;
    if (!hits) {
      console.log('SABOTAGE DID NOT APPLY for "' + leverKey + '" (' + L.name + ') — the pattern moved; fix this suite');
      process.exit(4);
    }
    html = html.split(L.from).join(L.to);
    console.log('    lever ' + leverKey + ': ' + hits + ' site(s) — ' + L.name);
  }
  const tmp = path.join(os.tmpdir(), 'room-stale-' + (leverKey || 'real') + '.html');
  fs.writeFileSync(tmp, html);
  return tmp;
}

/* Fully offline. A live game night is running and reads are the constrained
   resource, so nothing here is allowed near Firestore or ESPN. */
async function open(b, file) {
  const p = await b.newPage({ viewport: PHONE });
  const errs = []; p.on('pageerror', e => errs.push(String((e && e.message) || e)));
  await p.route('**/site.api.espn.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await p.route('**/assets.mailerlite.com/**', r => r.fulfill({ status: 200, body: '{}' }));
  await p.route('**firestore.googleapis.com**', r => r.abort());
  await p.goto('file://' + file, { waitUntil: 'domcontentloaded' });
  await waitReady(p);
  await p.waitForFunction(() => typeof stRoomCard === 'function' && typeof loadRoomStat === 'function', { timeout: 15000 });
  return { p, errs };
}

/* ---------------------------------------------------------------------
   THE HARNESS PINS EVERY STATE THE FEATURE DOES NOT OWN.
   qa/round-lead.js came back red today on a race that belonged to the
   SUITE, not the product: GS.ok flipped true->false mid-render because
   loadGameStats() is async and knocks it over before its first await.
   So: no awaits between arranging state and reading the render, GS.ev is
   pinned so nothing re-enters, and SEA is marked done so the season
   loader (identical shape, separately guarded) cannot contribute redraws
   to the microtask probe.
   ------------------------------------------------------------------ */
const SETUP = function (board, room) {
  window.__board = board;
  S.mode = 'live';
  S.screen = 'stats';
  try { ACTIVE_ROOM = room; window.ACTIVE_ROOM = room; } catch (_) {}
  ROOMSTAT.ok = false; ROOMSTAT.loading = false; ROOMSTAT.list = null;
  if ('night' in ROOMSTAT) ROOMSTAT.night = '';
  try { lastStand = null; } catch (_) {}
  window.SB = window.SB || {};
  /* The server is the same for both readers, which is the real situation:
     SB.top() (the room poll) and the board listener see one board. */
  SB.top = function (n) { return Promise.resolve((window.__board || []).slice(0, n || 3)); };
  /* Pin the feed so renderStats reaches the in-game branch that contains
     stRoomCard at all — the pre-tip branch never calls it, and a probe
     that silently never runs the code under test is a false green. */
  GS.ok = true; GS.loading = false; GS.fails = 0; GS.ev = GS.ev || 'qa-pinned';
  SEA.ok = true; SEA.loading = false;
  window.phaseNow = function () { return 'live'; };   // harness only
  try { ST_RUNS = []; } catch (_) {}
  /* Read the TTL constant defensively so this suite can be pointed at the
     SHIPPED index.html — which has no such constant — and come back with a
     clean red instead of a crash. Being able to run the same checks against
     the currently-deployed build is how today's round-lead scare was
     settled: it says whether a surprising result belongs to the product or
     to the harness. */
  window.TTL = function () {
    return (typeof ROOMSTAT_TTL_MS !== 'undefined' && ROOMSTAT_TTL_MS) ? ROOMSTAT_TTL_MS : 0;
  };
};

/* Put a board into the LIVE cache the way the board listener does — and
   ONLY there. The server's copy (what SB.top() answers with) is set by
   SETUP and is deliberately left alone, because the whole bug is the two
   diverging: a live cache that has moved on while the frozen snapshot
   has not. */
const LIVE = function (board) {
  try { lastStand = board; } catch (_) {}
};


/* ---------------------------------------------------------------------
   THE REDRAW PROBE. Seeds ONE renderStats() and counts what follows.

   Bounded on purpose. An unbounded microtask chain never yields to
   setTimeout, so an unbounded probe would hang the evaluate instead of
   reporting a failure — the same way the bug hangs the app.

   It counts stRoomCard() as well as renderStats(), because the dangerous
   case is the one where the room board is EMPTY: the card has nothing to
   draw, so it asks again on every render, and it is precisely then that a
   loader which claims work it did not do never lets go. A probe that only
   checked "did the card text appear" would score that case as a pass by
   never running the code at all.
   ------------------------------------------------------------------ */
const PROBE = async function (board, room) {
  const seen = []; const oc = console.error;
  console.error = function () { seen.push(Array.prototype.join.call(arguments, ' ')); return oc.apply(console, arguments); };
  window.__setup(board, room);
  window.__live(null);                       // live cache empty: cold start
  window.__n = 0; window.__cards = 0;
  const orig = window.renderStats, origCard = window.stRoomCard;
  window.stRoomCard = function () { window.__cards++; return origCard.apply(this, arguments); };
  window.renderStats = function () { window.__n++; if (window.__n > 60) return; return orig.apply(this, arguments); };
  renderStats();
  await new Promise(r => setTimeout(r, 400));
  window.renderStats = orig; window.stRoomCard = origCard; console.error = oc;
  const el = document.getElementById('stBody');
  return {
    n: window.__n, cards: window.__cards,
    loop: seen.filter(s => /renderStats re-entered/.test(s)).length,
    text: el ? el.textContent : ''
  };
};

(async () => {
  console.log('\n=== ROOM STALE (' + ENGINE_NAME + ') ===\n');
  const b = await ENGINE.launch();

  /* ============ 1. THE FOUNDER SCREENSHOT, END TO END =============== */
  {
    const { p, errs } = await open(b, writeCandidate(null));
    const r = await p.evaluate(async ([setup, live]) => {
      const S_ = eval('(' + setup + ')'), L_ = eval('(' + live + ')');

      /* Cold start: the Stats tab is opened before the room poll has
         answered, so ROOMSTAT does its one job and fills from SB.top(). */
      S_([{ name: 'Sam', pts: 0, total: 0 }], 'night-A');
      L_(null);
      const first = stRoomCard();                 // '' — kicks the loader
      await new Promise(r => setTimeout(r, 60));  // let the cold start land
      const cold = stRoomCard();

      /* Sam scores. The board listener refreshes the live cache — this is
         the ONLY thing that happens in the real bug, and the card froze. */
      L_([{ name: 'Sam', pts: 35, total: 35 }]);
      const after = stRoomCard();

      /* And on the actual rendered screen, not just the returned string.
         No awaits between here and the read — see the harness note. */
      GS.ok = true; SEA.ok = true;
      renderStats();
      const el = document.getElementById('stBody');
      const txt = el ? el.textContent : '';
      const seg = (txt.match(/Your room tonight[\s\S]{0,120}/) || [''])[0];
      return { first: first, cold: cold, after: after, seg: seg };
    }, [SETUP.toString(), LIVE.toString()]);

    ok('cold start: the card fills from ROOMSTAT when the live cache is still empty',
       /Sam/.test(r.cold), 'card was: ' + JSON.stringify(r.cold.slice(0, 160)));
    ok('the card follows a score change in the live cache (35, not the frozen 0)',
       /Sam/.test(r.after) && /35 pts/.test(r.after) && !/0 pts/.test(r.after),
       'THE FOUNDER BUG: card still reads ' + JSON.stringify((r.after.match(/>(\d+) pts</) || [])[0] || r.after.slice(0, 160)));
    ok('the RENDERED "Your room tonight" card shows 35',
       /Sam/.test(r.seg) && /35 pts/.test(r.seg) && !/0 pts/.test(r.seg),
       'rendered: ' + JSON.stringify(r.seg));
    ok('no page errors (real build, founder case)', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 2. total WINS OVER pts ============================== */
  {
    const { p, errs } = await open(b, writeCandidate(null));
    const r = await p.evaluate(([setup, live]) => {
      const S_ = eval('(' + setup + ')'), L_ = eval('(' + live + ')');
      S_([], 'night-A');
      /* The three shapes a real board row comes in. `pts` is a legacy
         field a runner writes only at its own scoring passes; `total` is
         composed by nightTotal() and is the number every other surface
         shows. See qa/board-total.js. */
      L_([{ name: 'Ana', pts: 7, total: 42 },     // drifted: total is truth
          { name: 'Bo', total: 19 },              // total only, no pts at all
          { name: 'Cy', pts: 5, total: null }]);  // total absent -> pts
      const card = stRoomCard();
      const nums = (card.match(/>(\d+) pts</g) || []).map(s => s.replace(/\D/g, ''));
      return { card: card, nums: nums };
    }, [SETUP.toString(), LIVE.toString()]);

    ok('a drifted row renders total (42), not the legacy pts (7)',
       r.nums[0] === '42', 'rendered ' + JSON.stringify(r.nums));
    ok('a row carrying only total renders 19, not 0',
       r.nums[1] === '19', 'rendered ' + JSON.stringify(r.nums) + ' — a fresh row still printing 0 is the second half of the bug');
    ok('a row with no total falls back to pts (5)',
       r.nums[2] === '5', 'rendered ' + JSON.stringify(r.nums));
    ok('no page errors (real build, total-vs-pts)', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 3. ROOM SCOPING ===================================== */
  {
    const { p, errs } = await open(b, writeCandidate(null));
    const r = await p.evaluate(async ([setup, live]) => {
      const S_ = eval('(' + setup + ')'), L_ = eval('(' + live + ')');

      /* --- 3a. a cold-start snapshot must not follow the player out --- */
      S_([{ name: 'RoomAWinner', pts: 99, total: 99 }], 'night-A');
      L_(null);
      stRoomCard();
      await new Promise(r => setTimeout(r, 60));
      const inA = stRoomCard();

      /* The real switch path clears the live cache. Use the product's own
         function so this check is wired to the real invalidation rather
         than to a hand-nulled variable. */
      let stopped = false;
      try { roomListenersStop('switch'); stopped = true; } catch (_) {}
      try { ACTIVE_ROOM = 'night-B'; window.ACTIVE_ROOM = 'night-B'; } catch (_) {}
      window.__board = [{ name: 'RoomBPlayer', pts: 4, total: 4 }];
      const inB = stRoomCard();       // must be blank, never room A

      /* --- 3b. a fetch that lands AFTER a switch must be dropped ----- */
      S_([], 'night-A');
      L_(null);
      let release = null;
      SB.top = function () { return new Promise(res => { release = res; }); };
      const flight = loadRoomStat();                       // in flight, room A
      try { ACTIVE_ROOM = 'night-B'; window.ACTIVE_ROOM = 'night-B'; } catch (_) {}
      release([{ name: 'RoomAWinner', pts: 99, total: 99 }]);
      const did = await flight;
      const afterFlight = stRoomCard();

      return {
        stopped: stopped, inA: inA, inB: inB,
        did: did, afterFlight: afterFlight,
        stampedNight: ROOMSTAT.night, stampedList: JSON.stringify(ROOMSTAT.list)
      };
    }, [SETUP.toString(), LIVE.toString()]);

    ok('the switch went through the product\'s own roomListenersStop()', r.stopped === true);
    ok('room A shows room A', /RoomAWinner/.test(r.inA), 'card was ' + JSON.stringify(r.inA.slice(0, 160)));
    ok('after a room switch the card does NOT show the previous room\'s board',
       !/RoomAWinner/.test(r.inB),
       'ROOM BLEED: room B is painting room A — ' + JSON.stringify(r.inB.slice(0, 200)));
    ok('an in-flight fetch that lands after a switch resolves false (no work claimed)',
       r.did === false, 'loadRoomStat() resolved ' + JSON.stringify(r.did));
    ok('an in-flight fetch that lands after a switch is not filed under the new room',
       !/RoomAWinner/.test(r.afterFlight) && !/RoomAWinner/.test(r.stampedList || ''),
       'ROOMSTAT.night=' + JSON.stringify(r.stampedNight) + ' list=' + String(r.stampedList).slice(0, 160));
    ok('no page errors (real build, room scoping)', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 4. THE MICROTASK GUARD ============================== */
  {
    const { p, errs } = await open(b, writeCandidate(null));
    const r = await p.evaluate(async ([setup, live, probe]) => {
      const S_ = window.__setup = eval('(' + setup + ')');
      const L_ = window.__live = eval('(' + live + ')');
      const P_ = eval('(' + probe + ')');

      /* 4a. EVERY no-work path resolves false. Five early exits plus the
         post-switch drop; each one is a promise stRoomCard hangs a redraw
         on, and each one is a live freeze if it lies. */
      const paths = {};
      S_([{ name: 'Sam', pts: 1, total: 1 }], 'night-A');
      ROOMSTAT.loading = true;
      paths.loading = await loadRoomStat();
      ROOMSTAT.loading = false;

      const keepSB = window.SB;
      window.SB = null;  paths.noSB    = await loadRoomStat();
      window.SB = { };   paths.noTop   = await loadRoomStat();
      window.SB = keepSB;
      S.mode = 'practice'; paths.notLive = await loadRoomStat();
      S.mode = 'live';

      ROOMSTAT.ok = true; ROOMSTAT.night = (typeof ACTIVE_ROOM !== 'undefined' ? String(ACTIVE_ROOM || '') : '');
      ROOMSTAT.at = Date.now();                 // loaded a moment ago: inside the TTL
      paths.alreadyOk = await loadRoomStat();

      /* And the same board, PAST the TTL, is work worth doing again — or
         the switched-into room never moves. */
      ROOMSTAT.at = Date.now() - (TTL() + 1000);
      paths.expiredRefetch = await loadRoomStat();

      /* And the one path that DID work must say so, or the card never
         repaints after a cold start. */
      S_([{ name: 'Sam', pts: 1, total: 1 }], 'night-A');
      paths.realWork = await loadRoomStat();

      /* 4b. THE LOOP ITSELF, in both shapes.
         `full`  — the room has a board, so the card draws and stops.
         `empty` — the room board is empty, so the card has nothing to
                   draw and asks again on EVERY render. This is the shape
                   that spins, and it is a real state: a room nobody has
                   scored in yet, on the tab a player opens first. */
      const full = await P_([{ name: 'Sam', pts: 1, total: 1 }], 'night-A');
      const empty = await P_([], 'night-A');
      return { paths: paths, full: full, empty: empty };
    }, [SETUP.toString(), LIVE.toString(), PROBE.toString()]);

    Object.keys(r.paths).filter(k => k !== 'realWork' && k !== 'expiredRefetch').forEach(k => {
      ok('a no-work load resolves false: ' + k, r.paths[k] === false,
         'loadRoomStat() resolved ' + JSON.stringify(r.paths[k]) + ' on the "' + k + '" path — this is the freeze');
    });
    ok('a load that DID fetch resolves true', r.paths.realWork === true,
       'resolved ' + JSON.stringify(r.paths.realWork) + ' — the card would never repaint after a cold start');
    ok('a load past the TTL does real work and resolves true', r.paths.expiredRefetch === true,
       'resolved ' + JSON.stringify(r.paths.expiredRefetch) + ' — an expired fallback would never refresh');

    /* PROOF THE PROBE ENGAGED, before any conclusion is drawn from it. A
       renderStats that never reached stRoomCard would report a clean loop
       count on a sabotaged build too, and that is a false green. */
    ok('PROBE ENGAGED (board present): renderStats reached stRoomCard',
       r.full.cards >= 1, 'stRoomCard ran ' + r.full.cards + ' times — the loop numbers below prove nothing');
    ok('PROBE ENGAGED (board present): the card was actually drawn',
       /Your room tonight/.test(r.full.text), 'the card never appeared in #stBody');
    ok('PROBE ENGAGED (empty board): renderStats reached stRoomCard',
       r.empty.cards >= 1, 'stRoomCard ran ' + r.empty.cards + ' times');

    ok('board present: one seed render does not become a redraw loop',
       r.full.n <= 8, 'renderStats ran ' + r.full.n + ' times from a single call');
    ok('board present: the render_loop detector never fires', r.full.loop === 0,
       'renderStats re-entry reported ' + r.full.loop + ' time(s)');
    ok('EMPTY board: one seed render does not become a redraw loop',
       r.empty.n <= 8, 'renderStats ran ' + r.empty.n + ' times — this is the 2,400/sec microtask chain');
    ok('EMPTY board: the render_loop detector never fires', r.empty.loop === 0,
       'renderStats re-entry reported ' + r.empty.loop + ' time(s)');
    ok('EMPTY board: the card asks a bounded number of times',
       r.empty.cards <= 8, 'stRoomCard ran ' + r.empty.cards + ' times from one render');
    ok('no page errors (real build, microtask guard)', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ============ 5. THE COLD START HAS TO GET COLD AGAIN =============
     The one path the live cache does NOT cover: a player who switches
     rooms and stays on the Stats tab. roomListenersStop('switch') drops
     bdUnsub and nulls lastStand, and the only callers of boardRefresh()
     are the boot join, the Board tab, and a 15s interval gated on
     S.screen==='board'. So nothing re-attaches a board listener, the live
     cache stays null, and the cold-start fallback is the only thing
     drawing this card — which is exactly where "nothing ever set ok back"
     becomes the original bug again, one room over. */
  {
    const { p, errs } = await open(b, writeCandidate(null));
    const r = await p.evaluate(async ([setup, live]) => {
      const S_ = eval('(' + setup + ')'), L_ = eval('(' + live + ')');
      S_([{ name: 'Bo', pts: 0, total: 0 }], 'night-A');
      L_([{ name: 'Ann', pts: 5, total: 5 }]);      // room A, listener live
      let tops = 0;
      const src = SB.top;
      SB.top = function (n) { tops++; return src.call(this, n); };

      const inA = stRoomCard();
      try { roomListenersStop('switch'); } catch (_) {}
      try { ACTIVE_ROOM = 'night-B'; window.ACTIVE_ROOM = 'night-B'; } catch (_) {}
      const cause = {
        boardListener: (typeof bdUnsub === 'function'),
        liveCache: (typeof lastStand !== 'undefined' ? lastStand : 'undef')
      };

      stRoomCard(); await new Promise(r => setTimeout(r, 60));
      const coldB = stRoomCard();
      const topsAfterCold = tops;

      /* Bo scores 20. Nothing pushes it here — no listener — so the only
         way this card can ever move is the fallback expiring. */
      window.__board = [{ name: 'Bo', pts: 20, total: 20 }];

      /* WITHIN the window: hold, and do not storm the read tier. Twenty
         renders is a normal minute on a busy screen. */
      for (let i = 0; i < 20; i++) stRoomCard();
      await new Promise(r => setTimeout(r, 60));
      const inWindow = stRoomCard();
      const topsInWindow = tops - topsAfterCold;

      /* PAST the window. Backdated rather than waited, so the check tests
         the shipped constant instead of a harness override of it.

         AND BOUNDED. Asking from the branch that already HAS something to
         draw is a new edge on the microtask invariant: if the refetch did
         not re-stamp the clock, every redraw would find the fallback
         expired and ask again, which is the 2,400/sec chain wearing a
         different hat. Count it, with the same bound as the other probe. */
      const seen = []; const oc = console.error;
      console.error = function () { seen.push(Array.prototype.join.call(arguments, ' ')); return oc.apply(console, arguments); };
      window.__n = 0;
      const orig = window.renderStats;
      window.renderStats = function () { window.__n++; if (window.__n > 60) return; return orig.apply(this, arguments); };
      ROOMSTAT.at = Date.now() - (TTL() + 1000);
      renderStats();
      await new Promise(r => setTimeout(r, 400));
      window.renderStats = orig; console.error = oc;
      const past = stRoomCard();

      return {
        inA: inA, cause: cause, ttl: TTL(),
        coldB: (coldB.match(/>(\d+) pts</) || [])[1],
        inWindow: (inWindow.match(/>(\d+) pts</) || [])[1],
        past: (past.match(/>(\d+) pts</) || [])[1],
        topsInWindow: topsInWindow, blank: !/Bo/.test(inWindow),
        n: window.__n, loop: seen.filter(s => /renderStats re-entered/.test(s)).length,
        engaged: /Your room tonight/.test((document.getElementById('stBody') || {}).textContent || '')
      };
    }, [SETUP.toString(), LIVE.toString()]);

    ok('the cause is real: a switch leaves no board listener and an empty live cache',
       r.cause.boardListener === false && r.cause.liveCache === null,
       'listener=' + r.cause.boardListener + ' lastStand=' + JSON.stringify(r.cause.liveCache) +
       ' — if this changed, the TTL below may no longer be the thing keeping the card honest');
    ok('after a switch the new room\'s card cold-starts on its own board',
       r.coldB === '0', 'showed ' + JSON.stringify(r.coldB));
    ok('inside the TTL the card holds (an old true number beats a blank card)',
       r.blank === false, 'the card went blank while a refetch was pending');
    ok('inside the TTL twenty renders cost ZERO extra reads',
       r.topsInWindow === 0, 'SB.top() was called ' + r.topsInWindow + ' more times — a read storm on the free tier');
    ok('past the TTL the card catches up to the room (20, not the frozen 0)',
       r.past === '20', 'FROZEN: still showing ' + JSON.stringify(r.past) +
       ' — the cold-start fallback never gets cold again on this path');
    ok('the TTL is a sane cadence (>0 and no slower than the 90s room poll)',
       r.ttl > 0 && r.ttl <= 90000, 'ROOMSTAT_TTL_MS = ' + r.ttl);
    ok('PROBE ENGAGED (expired fallback): the card was drawn',
       r.engaged === true, 'the card never appeared — the loop numbers below prove nothing');
    ok('an expired fallback refetches WITHOUT looping',
       r.n <= 8, 'renderStats ran ' + r.n + ' times — asking from the has-something-to-draw branch is spinning');
    ok('expired fallback: the render_loop detector never fires', r.loop === 0,
       'renderStats re-entry reported ' + r.loop + ' time(s)');
    ok('no page errors (real build, cold-start TTL)', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ===================== SABOTAGE ==================================== */
  if (SABOTAGE) {
    console.log('\n  --- sabotage: each lever pulled on its own ---\n');

    /* LEVER live — the card stops reading the live cache. */
    {
      const { p } = await open(b, writeCandidate('live'));
      const r = await p.evaluate(async ([setup, live]) => {
        const S_ = eval('(' + setup + ')'), L_ = eval('(' + live + ')');
        S_([{ name: 'Sam', pts: 0, total: 0 }], 'night-A');
        L_(null);
        stRoomCard(); await new Promise(r => setTimeout(r, 60));
        L_([{ name: 'Sam', pts: 35, total: 35 }]);
        return stRoomCard();
      }, [SETUP.toString(), LIVE.toString()]);
      ok('SABOTAGE(live) reproduces the frozen card (Sam still on 0 while the room says 35)',
         /Sam/.test(r) && /0 pts/.test(r) && !/35 pts/.test(r),
         'expected the founder bug back; got ' + JSON.stringify(r.slice(0, 200)));
      await p.close();
    }

    /* LEVER total — the house rule reverts to pts-only. */
    {
      const { p } = await open(b, writeCandidate('total'));
      const r = await p.evaluate(([setup, live]) => {
        const S_ = eval('(' + setup + ')'), L_ = eval('(' + live + ')');
        S_([], 'night-A');
        L_([{ name: 'Ana', pts: 7, total: 42 }, { name: 'Bo', total: 19 }]);
        const card = stRoomCard();
        return (card.match(/>(\d+) pts</g) || []).map(s => s.replace(/\D/g, ''));
      }, [SETUP.toString(), LIVE.toString()]);
      ok('SABOTAGE(total) does render the legacy pts instead of the composed total',
         r[0] === '7', 'expected 7; got ' + JSON.stringify(r));
      ok('SABOTAGE(total) does render 0 for a fresh row that carries only total',
         r[1] === '0', 'expected 0; got ' + JSON.stringify(r));
      await p.close();
    }

    /* LEVER scope — the cold-start fallback stops asking which room. */
    {
      const { p } = await open(b, writeCandidate('scope'));
      const r = await p.evaluate(async ([setup, live]) => {
        const S_ = eval('(' + setup + ')'), L_ = eval('(' + live + ')');
        S_([{ name: 'RoomAWinner', pts: 99, total: 99 }], 'night-A');
        L_(null);
        stRoomCard(); await new Promise(r => setTimeout(r, 60));
        try { roomListenersStop('switch'); } catch (_) {}
        try { ACTIVE_ROOM = 'night-B'; window.ACTIVE_ROOM = 'night-B'; } catch (_) {}
        return stRoomCard();
      }, [SETUP.toString(), LIVE.toString()]);
      ok('SABOTAGE(scope) does paint the previous room\'s board in the new room',
         /RoomAWinner/.test(r), 'expected room bleed back; got ' + JSON.stringify(r.slice(0, 200)));
      await p.close();
    }

    /* LEVER inflight — a fetch that lands after a switch is kept. */
    {
      const { p } = await open(b, writeCandidate('inflight'));
      const r = await p.evaluate(async ([setup, live]) => {
        const S_ = eval('(' + setup + ')'), L_ = eval('(' + live + ')');
        S_([], 'night-A');
        L_(null);
        let release = null;
        SB.top = function () { return new Promise(res => { release = res; }); };
        const flight = loadRoomStat();
        try { ACTIVE_ROOM = 'night-B'; window.ACTIVE_ROOM = 'night-B'; } catch (_) {}
        release([{ name: 'RoomAWinner', pts: 99, total: 99 }]);
        const did = await flight;
        return { did: did, night: ROOMSTAT.night, card: stRoomCard() };
      }, [SETUP.toString(), LIVE.toString()]);
      ok('SABOTAGE(inflight) does file room A\'s board under room B',
         /RoomAWinner/.test(r.card) || r.night === 'night-A',
         'expected the late answer to be kept; got night=' + JSON.stringify(r.night) + ' card=' + JSON.stringify(String(r.card).slice(0, 160)));
      await p.close();
    }

    /* LEVER ttl — the cold-start fallback never gets cold again. */
    {
      const { p } = await open(b, writeCandidate('ttl'));
      const r = await p.evaluate(async ([setup, live]) => {
        const S_ = eval('(' + setup + ')'), L_ = eval('(' + live + ')');
        S_([{ name: 'Bo', pts: 0, total: 0 }], 'night-A');
        L_([{ name: 'Ann', pts: 5, total: 5 }]);
        stRoomCard();
        try { roomListenersStop('switch'); } catch (_) {}
        try { ACTIVE_ROOM = 'night-B'; window.ACTIVE_ROOM = 'night-B'; } catch (_) {}
        stRoomCard(); await new Promise(r => setTimeout(r, 60));
        window.__board = [{ name: 'Bo', pts: 20, total: 20 }];
        ROOMSTAT.at = Date.now() - (TTL() + 1000);
        stRoomCard(); await new Promise(r => setTimeout(r, 60));
        const card = stRoomCard();
        return (card.match(/>(\d+) pts</) || [])[1];
      }, [SETUP.toString(), LIVE.toString()]);
      ok('SABOTAGE(ttl) does freeze the switched-into room at its cold-start value',
         r === '0', 'expected the freeze back; card showed ' + JSON.stringify(r));
      await p.close();
    }

    /* LEVERS okguard and didguard — the microtask chain, restored.
       Both are driven on the EMPTY board, the state in which the card can
       never satisfy itself: a room nobody has scored in yet. */
    for (const lever of ['okguard', 'didguard']) {
      const { p } = await open(b, writeCandidate(lever));
      const r = await p.evaluate(async ([setup, live, probe]) => {
        window.__setup = eval('(' + setup + ')');
        window.__live = eval('(' + live + ')');
        return await eval('(' + probe + ')')([], 'night-A');
      }, [SETUP.toString(), LIVE.toString(), PROBE.toString()]);
      ok('SABOTAGE(' + lever + ') does produce the redraw loop',
         r.n > 8 || r.loop > 0,
         'renderStats ran ' + r.n + ' times, stRoomCard ' + r.cards + ', loop reported ' + r.loop + ' — expected the chain back');
      await p.close();
    }
  }

  await b.close();
  console.log('');
  if (bad.length) { console.log('FAILURES:'); bad.forEach(x => console.log('  ✗ ' + x)); console.log(''); }
  if (pass === 0) { console.log('room-stale: RAN NOTHING\n'); process.exit(1); }
  console.log('room-stale: ' + pass + ' passed, ' + fail + ' failed' + (SABOTAGE ? ' (sabotage mode)' : '') + '\n');
  process.exit(fail ? 1 : 0);
})();
