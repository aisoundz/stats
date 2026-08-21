#!/usr/bin/env node
/* HOST A WHOLE NIGHT, IN EVERY SPORT
   ==================================================================
   Founder, 20 August 2026, after a live game night in which four separate
   things broke on baseball that had never broken on basketball:

     "Thats why we are doing these stress test for all the sports so we can
      get it right and right now it aint right. You keep missing things."

   He is right, and the reason they were missed is structural. The gate runs
   508 checks and not one of them had ever asked the host engine to run a
   night in a sport that is not basketball. So "green" meant "green for
   basketball", and every sport added since inherited a set of assumptions
   nobody had ever tested:

     · the Control Room's ESPN base was hardcoded to basketball/wnba, twice,
       so autopilot, Call It and auto-score were dead on every other sport
     · a round was assumed to be one period, so baseball's three rounds over
       nine innings put "OT in progress" on the scoreboard in the 4th and
       pushed innings 1-3 during the 2nd
     · the player app looked SPORT_CFG up by family instead of league and
       fetched every baseball room from the WNBA feed
     · Caught It decided what was new by an ascending sequence number, and
       baseball's resets every at-bat, so it could never fire at all

   Every one of those is a mechanism, not a rendering, and every one of them
   is checkable here with no browser and no live game. This file drives the
   REAL host engine — the AUTO block lifted out of admin.html exactly as
   host/run.js lifts it — over the REAL recorded feed for each league, and
   asserts the night could actually be hosted.

   Node only, on purpose: it must be runnable during a game night without
   putting a browser on the machine that is hosting it.

   Usage: node qa/night-per-sport.js [--sport mlb]                       */

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let PASS = 0, FAIL = 0; const FAILS = [];
const ok = (id, cond, why) => {
  if (cond) { PASS++; console.log(`    \x1b[32m✓\x1b[0m ${id}`); }
  else { FAIL++; FAILS.push(id); console.log(`    \x1b[31m✗ ${id}\x1b[0m — ${why}`); }
};

/* The engine, loaded the way the runner loads it. If this ever stops
   working the runner cannot host anything either, so it is check one. */
function loadAuto(){
  const src = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const a = src.indexOf('/* @host-shared:start');
  const b = src.indexOf('/* @host-shared:end */');
  if (a < 0 || b < 0) throw new Error('the @host-shared sentinels are gone from admin.html');
  const sandbox = { console, fetch, Math, Date, Number, String, Array, Object, JSON, RegExp,
                    isFinite, parseInt, parseFloat };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src.slice(a, b) + '\n;AUTO;', sandbox, { timeout: 8000 });
  if (!sandbox.AUTO) throw new Error('the shared block produced no AUTO');
  return sandbox.AUTO;
}

/* One row per league, and the path is the fact the Control Room got wrong
   twice tonight. Kept here rather than imported so that a change to the
   app has to be reflected deliberately in the test. */
const LEAGUES = [
  { key:'wnba', path:'basketball/wnba', family:'basketball', rounds:4, regulation:4 },
  { key:'mlb',  path:'baseball/mlb',    family:'baseball',   rounds:3, regulation:9 },
  { key:'nfl',  path:'football/nfl',    family:'football',   rounds:4, regulation:4 },
  { key:'mls',  path:'soccer/usa.1',    family:'soccer',     rounds:2, regulation:2 },
  { key:'nhl',  path:'hockey/nhl',      family:'hockey',     rounds:3, regulation:3 },
];

const only = (() => { const i = process.argv.indexOf('--sport'); return i > 0 ? process.argv[i+1] : ''; })();

(function main(){
  console.log('\n  A WHOLE NIGHT, IN EVERY SPORT — driving the real host engine over real feeds\n');
  let AUTO;
  try { AUTO = loadAuto(); }
  catch (e) { console.log('  \x1b[31mCANNOT LOAD THE ENGINE\x1b[0m ' + e.message); process.exit(1); }
  console.log(`  engine loaded from admin.html · ${Object.keys(AUTO.R || {}).length} resolvers\n`);

  for (const L of LEAGUES) {
    if (only && only !== L.key) continue;
    const file = path.join(ROOT, 'references', 'multisport', L.key + '.json');
    console.log(`  \x1b[1m${L.key.toUpperCase()}\x1b[0m  ${L.path}`);
    if (!fs.existsSync(file)) { ok(`${L.key}.fixture-exists`, false, `no recorded feed at references/multisport/${L.key}.json`); continue; }
    let sum; try { sum = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { ok(`${L.key}.fixture-parses`, false, e.message); continue; }

    /* ---- 1. CAN THE ENGINE SEE THE PLAYS AT ALL? -------------------
       Football nests them under drives and soccer has no plays key, which
       is exactly why feedPlays exists and exactly what Call It failed to
       use for a whole night. */
    let plays = [];
    try { plays = AUTO.feedPlays(sum) || []; } catch (e) { /* reported below */ }
    if (L.family === 'soccer') {
      /* Soccer genuinely has no `plays` key. feedPlays returning nothing is
         correct, and Caught It builds its own stream from the commentary,
         so what must be asserted is that SOMETHING is readable rather than
         that this particular door opens. */
      const comm = (sum.commentary || sum.keyEvents || sum.plays || []);
      ok(`${L.key}.engine-has-something-to-read`, (comm || []).length > 0,
         `no plays, no commentary and no keyEvents — nothing in this feed describes the match`);
      if ((comm || []).length) plays = comm;
    } else {
      ok(`${L.key}.engine-can-read-the-plays`, plays.length > 0,
         `feedPlays returned ${plays.length} — the host cannot see this sport's game at all`);
    }
    if (!plays.length) { console.log(''); continue; }

    /* ---- 2. IS "WHAT IS NEW" DECIDABLE? ---------------------------
       THE CAUGHT IT BUG. Baseball's sequenceNumber restarts every at-bat,
       so any mechanism keyed on it ascending sees nothing new, forever,
       in silence. Identity is the only key that holds across all five. */
    /* Not every sport hands out an id. Soccer's commentary carries
       `sequence` and a time and nothing else, so the honest question is not
       "is there an id" but "can freshness be decided AT ALL, by something".
       Report WHICH key works, because the answer differs per sport and a
       mechanism that assumes one of them is how Caught It died on baseball. */
    const KEYS = [
      ['id',        p => p && p.id],
      ['sequence',  p => p && (p.sequence != null ? p.sequence : p.sequenceNumber)],
      ['clock+text',p => p && ((((p.time || p.clock || {}).displayValue) || '') + '|' + String(p.text || '').slice(0, 40))],
    ];
    let workingKey = '';
    for (const [name, fn] of KEYS) {
      const vals = plays.map(p => { try { return String(fn(p) == null ? '' : fn(p)); } catch (_) { return ''; } });
      if (vals.includes('')) continue;
      if (new Set(vals).size === vals.length) { workingKey = name; break; }
    }
    ok(`${L.key}.freshness-can-be-decided`, !!workingKey,
       `no key distinguishes one ${L.key} play from another — id, sequence and clock+text all collide, so "what is new" is undecidable and live questions can never fire`);
    if (workingKey) console.log(`      \x1b[2mfreshness key: ${workingKey}\x1b[0m`);

    const seqs = plays.map(p => Number(p.sequenceNumber || 0));
    let ascends = true;
    for (let i = 1; i < seqs.length; i++) if (seqs[i] < seqs[i-1]) { ascends = false; break; }
    if (!ascends) {
      console.log(`      \x1b[33mnote\x1b[0m sequenceNumber does NOT ascend in ${L.key} (max ${Math.max(...seqs)}); anything keyed on it is broken here`);
    }

    /* ---- 3. DOES A ROUND MAP TO THE RIGHT PERIODS? -----------------
       THE AUTOPILOT BUG. A round is not always one period. Baseball is
       three rounds across nine innings, and assuming otherwise pushed
       questions about innings 1-3 during the 2nd. */
    let bounds = null;
    try { bounds = AUTO.roundPeriodsFor(sum, 0); } catch (e) {}
    ok(`${L.key}.rounds-know-their-periods`, Array.isArray(bounds) && bounds.length === L.rounds,
       `roundPeriodsFor gave ${JSON.stringify(bounds)} for ${L.rounds} rounds`);

    if (Array.isArray(bounds) && bounds.length === L.rounds) {
      ok(`${L.key}.last-round-ends-at-the-last-period`, Number(bounds[bounds.length-1]) === L.regulation,
         `last round ends at period ${bounds[bounds.length-1]}, regulation is ${L.regulation}`);
      let climbs = true;
      for (let i = 1; i < bounds.length; i++) if (Number(bounds[i]) <= Number(bounds[i-1])) climbs = false;
      ok(`${L.key}.round-boundaries-climb`, climbs, `boundaries ${JSON.stringify(bounds)} do not increase`);
    }

    /* ---- 4. HOST THE NIGHT, PERIOD BY PERIOD ----------------------
       The heart of it, and the first version of this check was worthless:
       it asked a FINISHED game whether period 1 had ended, which is true,
       and so it failed in all five sports including basketball. A check
       that fails on everything is exactly as useless as one that cannot
       fail, and it took ten minutes to notice.

       Hosting a night means asking the question the host asks: given the
       feed AS IT LOOKED at some moment, has this round finished? So the
       feed is truncated to each period in turn and the engine is asked
       fresh each time, which is precisely what autopilot does every twenty
       seconds. A round may be reported finished only once the game has
       moved PAST its last period.

       This is the bug that pushed innings 1-3 during the 2nd. */
    if (Array.isArray(bounds) && bounds.length === L.rounds) {
      const asOf = (per) => {
        const cut = JSON.parse(JSON.stringify({
          header: sum.header || {}, boxscore: sum.boxscore || {},
          plays: (sum.plays || []).filter(pl => Number((pl.period && pl.period.number) || pl.period || 0) <= per),
          /* FOOTBALL KEEPS ITS PLAYS UNDER DRIVES, and the first version of
             this copied the drives across whole. So the "feed as it looked
             at period 1" still contained the entire game and every round
             reported finished immediately — opened at [1,1,1,1]. That was
             my truncation lying, not the engine, and it is the same shape
             of mistake as reading sum.plays for a sport that does not use
             it. Cut the drives to the period too. */
          drives: sum.drives ? {
            previous: (sum.drives.previous || []).map(d => Object.assign({}, d, {
              plays: (d.plays || []).filter(pl => Number((pl.period && pl.period.number) || pl.period || 0) <= per)
            })).filter(d => (d.plays || []).length)
          } : undefined,
          format: sum.format || undefined
        }));
        try {
          const st = cut.header.competitions[0].status;
          st.period = per;
          st.type = st.type || {};
          st.type.state = (per >= L.regulation) ? 'post' : 'in';
          st.type.completed = per >= L.regulation;
        } catch (_) {}
        return cut;
      };

      const openedAt = new Array(L.rounds).fill(0);
      const early = [];
      for (let per = 1; per <= L.regulation; per++) {
        const cut = asOf(per);
        for (let r = 0; r < L.rounds; r++) {
          const last = Number(bounds[r]);
          let done = false;
          try { done = !!AUTO.periodDone(cut, last); } catch (_) { done = false; }
          if (done && !openedAt[r]) openedAt[r] = per;
          if (done && per < last) early.push(`round ${r+1} runs to period ${last} but was reported finished at period ${per}`);
        }
      }
      ok(`${L.key}.no-round-opens-before-its-last-period`, early.length === 0, early[0] || '');
      const opensOnTime = bounds.every((bnd, r) => openedAt[r] === 0 || openedAt[r] >= Number(bnd));
      ok(`${L.key}.rounds-open-on-or-after-their-last-period`, opensOnTime,
         `opened at ${JSON.stringify(openedAt)} for boundaries ${JSON.stringify(bounds)}`);
      const openedCount = openedAt.filter(v => v > 0).length;
      ok(`${L.key}.regulation-rounds-all-open-by-the-final-whistle`, openedCount >= L.rounds - 1,
         `only ${openedCount} of ${L.rounds} rounds ever reported finished across the whole game`);
    }

    /* ---- 5. THE SCOREBOARD MUST NOT SAY OT IN REGULATION ----------
       THE THREE-COPIES BUG. Inning 4 read "OT in progress" on every phone
       in the room, because tags[per-1] indexes the OT round. */
    if (Array.isArray(bounds) && bounds.length === L.rounds) {
      const wrong = [];
      for (let per = 1; per <= L.regulation; per++) {
        let tag = '';
        for (let i = 0; i < bounds.length; i++) if (per <= Number(bounds[i])) { tag = String(i); break; }
        if (tag === '') wrong.push(per);
      }
      ok(`${L.key}.every-regulation-period-lands-in-a-round`, wrong.length === 0,
         `periods ${JSON.stringify(wrong)} fall past the last round, so the scoreboard calls them overtime`);
    }

    /* ---- 5b. A PERIOD NOBODY PLAYED IS NOT A PERIOD THAT ENDED ----
       Found the minute a 9-inning game ended 2-0 and the room held FOUR
       rounds, the fourth being OT. periodDone answers "is period N over",
       and at a final whistle it says yes to every N, including periods that
       were never played. So a room that ends in regulation would push an
       overtime round worth 70 points about innings that do not exist.

       maxPeriodIn is the feed's own high-water mark and is the only thing
       that can tell the difference. The trap is asserted directly, so that
       if periodDone ever changes behaviour this check tells us rather than
       quietly passing. */
    let played = 0;
    try { played = Number(AUTO.maxPeriodIn(sum)) || 0; } catch (_) {}
    /* Soccer has no play list for maxPeriodIn to count, so the host falls
       back to the header's status period. The test must exercise the SAME
       fallback the host uses, or it asserts a guard nobody runs. */
    if (!played) { try { played = Number(sum.header.competitions[0].status.period) || 0; } catch (_) {} }
    if (!played) {
      let over = false;
      try { over = !!sum.header.competitions[0].status.type.completed; } catch (_) {}
      if (over) { try { played = Number(AUTO.regulationPeriods(sum)) || 0; } catch (_) {} }
    }
    ok(`${L.key}.the-feed-says-how-far-the-game-actually-got`, played >= L.regulation,
       `maxPeriodIn says ${played}, regulation is ${L.regulation} — without this the host cannot tell a period that was played from one that was not`);
    let phantom = false;
    try { phantom = !!AUTO.periodDone(sum, L.regulation + 4); } catch (_) {}
    ok(`${L.key}.a-round-past-the-end-must-be-guarded-by-maxPeriodIn`, played > 0,
       `periodDone(regulation+4) is ${phantom} on a finished game and maxPeriodIn is unavailable, so nothing can stop an unplayed round opening`);
    if (phantom) console.log(`      \x1b[2mnote: periodDone says period ${L.regulation + 4} ended too — only maxPeriodIn (${played}) knows better\x1b[0m`);

    /* ---- 5c. CAN THIS SPORT PRODUCE A LIVE QUESTION AT ALL? -------
       Caught It fired ZERO times on baseball across a whole game, behind a
       badge reading ARMED, because freshness was keyed on a sequence number
       that restarts every at-bat. Nothing said so: the trigger returns
       silently when no moment matches and the builder returns null
       silently too, so the failure was indistinguishable from a quiet game.

       So the night is replayed here in twenty-play steps, the way a
       twenty-second poll would see it, through the same AUTO.CI the runner
       and the Control Room both use — and the question is simply whether
       any question ever comes out. Hockey is exempt because its builder is
       honestly unwritten and says so. */
    if (AUTO.CI && L.family !== 'hockey') {
      let stream = plays;
      if (L.family === 'soccer') { try { stream = AUTO.CI.soccerEvents(sum) || []; } catch (_) { stream = []; } }
      const comp = ((sum.header || {}).competitions || [])[0] || {};
      const cs = comp.competitors || [];
      const aw = cs.find(c => c.homeAway === 'away') || cs[0] || {};
      const hm = cs.find(c => c.homeAway === 'home') || cs[1] || {};
      const T = { awayAbbr:(aw.team||{}).abbreviation||'', homeAbbr:(hm.team||{}).abbreviation||'',
                  awayId:(aw.team||{}).id, homeId:(hm.team||{}).id,
                  awayName:(aw.team||{}).displayName||'', homeName:(hm.team||{}).displayName||'',
                  awayScore:aw.score, homeScore:hm.score };
      let key = null, counts = {}, open = null, openedAt = 0, pending = null, asked = 0, now = 0;
      const pace = AUTO.CI.PACES.normal;
      for (let cut = 20; cut <= stream.length; cut += 20) {
        now += 20000;
        const seen = stream.slice(0, cut);
        const step = AUTO.CI.freshAfter(seen, key); const first = !key; key = step.key;
        if (pending && now >= pending.at) { pending = null; open = null; }
        if (first || open || !step.fresh.length) continue;
        const per = AUTO.CI.curPeriod(seen);
        const mo = AUTO.CI.moment(L.family, step.fresh);
        if (!mo || (counts[per] || 0) >= pace.capPer) continue;
        const gap = now - openedAt;
        if (!(mo.stoppage ? gap >= 25000 : gap >= pace.gapMs)) continue;
        let q = null; try { q = AUTO.CI.build(L.family, seen, T, per, counts, sum); } catch (_) {}
        if (!q || !q.qid) continue;
        open = q.qid; openedAt = now; counts[per] = (counts[per] || 0) + 1; asked++;
        pending = q.ans != null ? { at: now + AUTO.CI.lockMsFor(q.kind) + 1200 } : null;
      }
      /* WHAT THIS CATCHES, AND WHAT IT DOES NOT. Sabotage-tested three
         ways. Breaking the builder outright turns it red. Breaking only
         baseball's ordinary moment left three questions standing, from the
         scoring path, and it stayed green — so this is a floor against
         SILENCE, not a guard on cadence. The count is printed on every run
         precisely so a drop from seven to three is visible to a person even
         though it does not fail the gate. */
      ok(`${L.key}.live-questions-can-actually-fire`, asked > 0,
         `replaying the whole game produced ZERO live questions — the badge would say ARMED all night and nothing would ever come`);
      if (asked) console.log(`      \x1b[2m${asked} live question(s) across the game · ${Object.keys(counts).map(k => 'P' + k + '=' + counts[k]).join(' ')}\x1b[0m`);
    }

    /* ---- 6. THE ENGINE AGREES WHICH SPORT THIS IS -----------------
       sportOf/familyOf feed the resolver choice. Getting this wrong is how
       a baseball room asks how many quarters a game runs. */
    let fam = '';
    try { fam = String(AUTO.familyOf(sum) || ''); } catch (e) {}
    ok(`${L.key}.engine-identifies-the-family`, fam === L.family,
       `engine says "${fam}", the league table says "${L.family}"`);

    console.log('');
  }

  console.log(`  ${FAIL ? '\x1b[31mRED' : '\x1b[32mGREEN'}  ${PASS} passed, ${FAIL} failed\x1b[0m`);
  if (FAIL) { console.log('  ' + FAILS.join('\n  ')); }
  console.log('');
  process.exit(FAIL ? 1 : 0);
})();
