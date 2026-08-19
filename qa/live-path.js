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
    process.env.HOME_NICK = 'Home'; process.env.AWAY_NICK = 'Away';
    let plan;
    try {
      const K = PUB.loadConstants();
      plan = PUB.buildPlan(K.NIGHTS, K.BANK, K.TEMPLATES);
    } catch (e) { console.log(`  ${lg}: no plan — ${e.message}`); continue; }

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
        games.push({ id: e.id, name: e.shortName });
      }
    }
    if (!games.length) { console.log(`  ${lg.toUpperCase()}: no finished game in ${DAYS} days`); continue; }

    console.log(`\n  ${lg.toUpperCase()}  (${plan.rounds.length} rounds · ${games.length} game(s))`);

    for (const g of games) {
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

      const lines = [];
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

        let key = null, voided = 0;
        try {
          const res = RUN.resolveRound(AUTO, R, sum, period, null);
          key = res.key; voided = (res.voided || 0);
          if (key && key.length) scored++;
        } catch (e) {
          ok(`livepath.${lg}.round-resolves`, false, `${g.name} ${R.tag}: threw — ${e.message}`);
          continue;
        }
        ok(`livepath.${lg}.round-resolves`, true);

        const answered = (key || []).filter(x => x != null && x !== '').length;
        lines.push(`      ${String(R.tag).padEnd(8)} period ${String(period).padStart(2)}  `
          + `${answered}/${(R.qs||[]).length} answered`
          + (voided ? `  ·  ${String(voided).split(',').length} void` : ''));
      }
      console.log(`    ${g.name}`);
      lines.forEach(l => console.log(l));

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
        const missing = want.filter(p => !ends[p]);
        ok(`livepath.${lg}.the-gate-has-a-marker-for-every-round`,
           missing.length === 0,
           `${g.name}: no End-of-inning marker for period(s) ${missing.join(',')} — the round would never open in a live game`);
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
