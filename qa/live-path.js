#!/usr/bin/env node
/* =====================================================================
   THE LIVE PATH — would a round have opened, and at the right period?
   ---------------------------------------------------------------------
   Every slate log on disk stops at "plan published — the runner can take
   it from here". No slate room has ever opened a round, in any sport, so
   the code between a published plan and a scored round has only ever run
   against basketball.

   qa/bank-shadow.js proves the RESOLVERS against finished games. It does
   not touch the decision layer above them, and that layer is where the
   sport-specific danger lives: does `periodDone` know an inning has ended,
   does roundSlots map round 2 to inning 6 rather than period 2, does a
   round that opens actually resolve at the period it opened for.

   So this replays a FINISHED game through the runner's own functions —
   the real roundSlots, the real periodDone, the real resolveRound, loaded
   out of host/run.js and admin.html, not reimplemented — and asks of each
   round: would it have opened, at which period, and would it have scored.

   It cannot prove timing (a finished feed says every period is done). It
   proves the thing that timing would otherwise hide: the MAPPING. That is
   what would have made a baseball room open its first round at inning 1
   and grade it as if it were inning 3.

       node qa/live-path.js                       # all four leagues
       node qa/live-path.js --leagues mlb,nfl
       node qa/live-path.js --days 3
   ================================================================== */
const path = require('path');
const RUN  = require(path.join(__dirname, '..', 'host', 'run.js'));
const PUB  = require(path.join(__dirname, '..', 'host', 'publish.js'));

const ARG = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i+1] : d; };
const DAYS    = Number(ARG('days', 4));
const LEAGUES = ARG('leagues', 'wnba,mlb,nfl,mls').split(',').map(s => s.trim()).filter(Boolean);
const PER_LG  = Number(ARG('games', 3));

const PATHS = {
  wnba: { path:'basketball/wnba', sport:'basketball' },
  mlb:  { path:'baseball/mlb',    sport:'baseball'   },
  nfl:  { path:'football/nfl',    sport:'football'   },
  mls:  { path:'soccer/usa.1',    sport:'soccer'     },
  nhl:  { path:'hockey/nhl',      sport:'hockey'     }
};

let pass = 0, fail = 0; const bad = [];
const ok = (n, c, d) => { if (c) pass++; else { fail++; bad.push(n + (d ? '  — ' + d : '')); } };
const ymd = d => d.toISOString().slice(0,10).replace(/-/g,'');

(async () => {
  for (const lg of LEAGUES) {
    const L = PATHS[lg];
    if (!L) { console.log(`  ${lg}: unknown league`); continue; }

    /* The engine is per-sport: run.js reads SPORT_PATH at require time, so
       each league needs its own load or every resolver answers as
       basketball. That is the same family-vs-path distinction that muted
       every slate room. */
    process.env.SPORT_PATH = L.path;
    let AUTO;
    try { AUTO = RUN.loadShared(); }
    catch (e) { console.log(`  ${lg}: engine would not load — ${e.message}`); continue; }

    /* A plan exactly as publish.js would write one for a slate room. */
    process.env.SPORT = L.sport;
    process.env.NIGHT_ID = 'live-path-' + lg;
    /* THE PLAN IS BUILT PER GAME, WITH THAT GAME'S REAL TEAM NAMES, and
       this is not tidiness — it is the difference between measuring the
       question bank and measuring the harness.

       It used to set HOME_NICK='Home' / AWAY_NICK='Away' once and reuse
       the plan for every game. Every team-comparison question then had
       options ["Home","Away","Even"], and a resolver answers by mapping
       the winning TEAM back to one of the options it was given — no real
       team is called "Home", so every one of them returned null and was
       counted VOID. That produced "NFL Q4: 2/4 answered · 2 void" and the
       reasonable conclusion that the football bank was losing half its
       last round. It was not: the same resolvers answer "Bears" and
       "Rams" the moment they are handed the names the game actually uses.

       A suite that measures its own stub instead of the product is worse
       than no suite, because it generates work. */
    let K;
    try { K = PUB.loadConstants(); }
    catch (e) { console.log(`  ${lg}: constants would not load — ${e.message}`); continue; }
    const planFor = (g) => {
      process.env.HOME_NICK = g.homeNick; process.env.AWAY_NICK = g.awayNick;
      return PUB.buildPlan(K.NIGHTS, K.BANK, K.TEMPLATES);
    };
    let plan;
    try { process.env.HOME_NICK='Home'; process.env.AWAY_NICK='Away';
          plan = PUB.buildPlan(K.NIGHTS, K.BANK, K.TEMPLATES); }
    catch (e) { console.log(`  ${lg}: no plan — ${e.message}`); continue; }

    /* Finished games, most recent first. */
    let games = [];
    for (let back = 1; back <= DAYS && games.length < PER_LG; back++) {
      const day = new Date(Date.now() - back * 86400000);
      let board;
      try {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${L.path}/scoreboard?dates=${ymd(day)}`);
        board = await r.json();
      } catch (_) { continue; }
      for (const e of (board.events || [])) {
        if (games.length >= PER_LG) break;
        const c = (e.competitions || [])[0];
        if (!c || !(((c.status||{}).type||{}).completed)) continue;
        /* KEEP EACH GAME'S REAL TEAM NICKNAMES. See the plan note below —
           resolving a team question against placeholder options cannot
           work, so the plan has to be built per game, not once per league. */
        const cs = (c.competitors || []);
        const home = cs.find(x => x.homeAway === 'home') || cs[0] || {};
        const away = cs.find(x => x.homeAway === 'away') || cs[1] || {};
        games.push({ id: e.id, name: e.shortName,
                     homeNick: (home.team||{}).name || (home.team||{}).shortDisplayName || 'Home',
                     awayNick: (away.team||{}).name || (away.team||{}).shortDisplayName || 'Away' });
      }
    }
    if (!games.length) { console.log(`  ${lg.toUpperCase()}: no finished game in ${DAYS} days`); continue; }

    console.log(`\n  ${lg.toUpperCase()}  (${plan.rounds.length} rounds · ${games.length} game(s))`);

    for (const g of games) {
      try { plan = planFor(g); }
      catch (e) { ok(`livepath.${lg}.plan-builds`, false, `${g.name}: ${e.message}`); continue; }
      let sum;
      try { sum = await AUTO.fetchFeed(g.id, L.path); }
      catch (e) { ok(`livepath.${lg}.feed-loads`, false, `${g.name}: ${e.message}`); continue; }
      ok(`livepath.${lg}.feed-loads`, true);

      let slots;
      try { slots = RUN.roundSlots(AUTO, sum, plan); }
      catch (e) { ok(`livepath.${lg}.rounds-map`, false, `${g.name}: roundSlots threw — ${e.message}`); continue; }

      /* 1. every authored round gets a slot */
      ok(`livepath.${lg}.every-round-has-a-slot`,
         slots.filter(s => s.def).length >= plan.rounds.length,
         `${g.name}: ${slots.filter(s=>s.def).length} slot(s) for ${plan.rounds.length} round(s)`);

      const lines = [], reasons = [];
      let opened = 0, scored = 0;
      for (const sl of slots) {
        const R = sl.def; if (!R) continue;
        /* The runner's own choice of period — R.p from the published plan
           first, sl.per behind it. Getting this wrong is how a baseball
           round covering innings 3-6 gets graded at inning 2. */
        const period = (R.p != null && isFinite(R.p)) ? Number(R.p) : sl.per;

        let done = false;
        try { done = AUTO.periodDone(sum, period); } catch (_) {}
        if (done) opened++;

        /* `voided` is an ARRAY of reasons, and an empty array is TRUTHY.
           This used to hold it as `voided || 0` and then count it with
           String(voided).split(',').length — which is 1 for [] (String([])
           is "", and "".split(",") is [""]). So EVERY clean round in every
           league printed a phantom "1 void", and a reader would reasonably
           conclude the banks were leaking questions everywhere. Count the
           array. Splitting on commas was wrong twice over: a void reason
           can contain one. */
        let key = null, voided = [];
        try {
          const res = RUN.resolveRound(AUTO, R, sum, period, null);
          key = res.key; voided = Array.isArray(res.voided) ? res.voided : [];
          if (key && key.length) scored++;
        } catch (e) {
          ok(`livepath.${lg}.round-resolves`, false, `${g.name} ${R.tag}: threw — ${e.message}`);
          continue;
        }
        ok(`livepath.${lg}.round-resolves`, true);

        const answered = (key || []).filter(x => x != null && x !== '').length;
        voided.forEach(v => reasons.push(`${R.tag}: ${v}`));
        lines.push(`      ${String(R.tag).padEnd(8)} period ${String(period).padStart(2)}  `
          + `${answered}/${(R.qs||[]).length} answered`
          + (voided.length ? `  ·  ${voided.length} void` : ''));
      }
      console.log(`    ${g.name}`);
      lines.forEach(l => console.log(l));
      if (reasons.length) reasons.forEach(r => console.log(`         ${r}`));

      /* NOT A CHECK ON periodDone. On a completed feed `st.type.completed`
         short-circuits the gate to true for EVERY period — I confirmed it
         answers true for period 20 of a 9-inning game — so an assertion
         that "every round would open" here cannot fail, and a check that
         cannot fail is worse than no check because it reads as coverage.

         What CAN be checked from a finished feed is whether the mid-game
         gate has anything to fire on: baseball's reads an End-of-period
         marker out of the plays, and those markers either exist for every
         inning or the round would never open in a live game. Basketball
         and football gates read the status block instead, and soccer has
         no plays array at all, so for those this reports rather than
         asserts. The live gate is only really provable against a live
         game — that is what Thursday's rehearsal is for. */
      if (L.sport === 'baseball') {
        const ends = {};
        try {
          (sum.plays || []).forEach(x => {
            const pd = x.period || {};
            if (String(pd.type || '') === 'End') ends[pd.number] = true;
          });
        } catch (_) {}
        const want = slots.filter(s => s.def).map(sl => {
          const R = sl.def; return (R.p != null && isFinite(R.p)) ? Number(R.p) : sl.per;
        });
        /* THE LAST INNING OF A HOME WIN HAS NO MARKER, AND CANNOT.
           When the home side leads after the top of the ninth they do not
           bat: the inning that ends the game has no End row, and ESPN emits
           NO end-of-game play either — the feed simply stops. Verified on
           DET @ PIT (4-1) and MIA @ PHI (6-4), 18 Aug 2026: 35 and 25 plays
           in the ninth, halves seen ["Top"], and not one play type matching
           game / final / end-of anywhere in either feed.

           That is roughly half of all baseball games, so asserting a marker
           for the final round would go red on half the sport forever. And
           the gate is RIGHT on these feeds — periodDone(3,6,9) is
           true/true/true, because the header says the game is over, which
           is the only thing that ever could say so.

           So the final round is allowed to be marked by the game ending.
           Every EARLIER inning must still have its own row: those are the
           ones a live round depends on mid-game, and a gap there really
           would leave a round that never opens. */
        const lastRound = want.length ? Math.max(...want) : 0;
        const over = (() => { try { return sum.header.competitions[0].status.type.completed === true; }
                              catch (_) { return false; } })();
        const missing = want.filter(p => !ends[p] && !(p === lastRound && over));
        const excusedByFinal = want.filter(p => !ends[p] && p === lastRound && over);
        ok(`livepath.${lg}.the-gate-has-a-marker-for-every-round`,
           missing.length === 0,
           `${g.name}: no End-of-inning marker for period(s) ${missing.join(',')} — the round would never open in a live game`);
        if (excusedByFinal.length)
          console.log(`       ${g.name}: inning ${excusedByFinal.join(',')} has no End row — the home side never batted; the game ending is the marker`);
      }

      /* It must produce a key, or a round opens and never scores. */
      ok(`livepath.${lg}.every-round-would-score`,
         scored === slots.filter(s => s.def).length,
         `${g.name}: ${scored} of ${slots.filter(s=>s.def).length} round(s) produced a key`);

      /* 4. the periods must be DISTINCT and ascending — the baseball trap.
            Rounds mapping to 1,2,3 when the plan says 3,6,9 is the bug
            that grades the wrong innings and says nothing. */
      const pers = slots.filter(s => s.def).map(sl => {
        const R = sl.def;
        return (R.p != null && isFinite(R.p)) ? Number(R.p) : sl.per;
      });
      const ascending = pers.every((p, i) => i === 0 || p > pers[i-1]);
      ok(`livepath.${lg}.periods-ascend`, ascending, `${g.name}: periods ${pers.join(',')}`);
      if (plan.periods) {
        ok(`livepath.${lg}.periods-match-the-plan`,
           JSON.stringify(pers) === JSON.stringify(plan.periods.slice(0, pers.length)),
           `${g.name}: runner would use ${pers.join(',')}, the plan declares ${plan.periods.join(',')}`);
      }
    }
  }

  console.log('');
  bad.forEach(b => console.log('  FAIL  ' + b));
  console.log(`${fail ? 'RED' : 'GREEN'}   ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASHED: ' + e.message); process.exit(2); });
