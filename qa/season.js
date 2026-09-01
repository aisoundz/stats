#!/usr/bin/env node
/* =====================================================================
   A NIGHT IS WORTH AT MOST ONE NIGHT.
   ---------------------------------------------------------------------
   Every room has its own board and its own seat. The season used to be
   the SUM of every row, so a player in two rooms on one evening banked
   both — and on a Saturday with twenty-one games available, the season
   would be won by whoever opened the most ROOMS rather than whoever read
   a game best. The optimal play became "drop into the fourth quarter of
   six games, answer four questions each, leave": the highest
   points-per-minute strategy available, and the exact opposite of the
   thing the product is named after.

   The rule now: a night scores as a PERCENTAGE of what was available in
   the best room you played that night, and the season sums those. Each
   night is worth at most 100.

   These checks are about FAIRNESS, so they are written as the scenarios a
   player would argue about, not as assertions about a function.

       node qa/season.js [index-test.html]
   ================================================================== */
const {chromium}=require('playwright');
const path=require('path');
const TARGET=path.resolve(process.argv.find(a=>/\.html$/.test(a)) || path.join(__dirname,'..','index-test.html'));

let pass=0, fail=0; const bad=[];
const ok=(n,c,d)=>{ if(c) pass++; else { fail++; bad.push(n+(d?'  — '+d:'')); } };

/* One room's worth of points. The real ceiling differs per sport, which is
   the whole reason the season is a percentage. */
const row=(night,pts,max,extra)=>Object.assign({night, pts, max, hits:0, total:0, speed:0, awards:[]}, extra||{});

(async()=>{
  const b=await chromium.launch();
  const p=await b.newPage();
  await p.goto('file://'+TARGET);
  await p.waitForFunction(()=>typeof window.lineTotals==='function' || typeof lineTotals==='function',{timeout:15000})
    .catch(()=>{});
  const t=(games)=>p.evaluate((g)=>{ try{ return lineTotals({v:1,games:g}); }catch(e){ return {err:e.message}; } }, games);

  /* ---- 1. THE SCENARIO THE FOUNDER ASKED ABOUT ---------------------- */
  const stayed  = await t([ row('gn13-2026-08-19-min-gs', 800, 1000) ]);
  const hopped  = await t([ row('gn13-2026-08-19-min-gs', 800, 1000),
                            row('slate-2026-08-19-tor-wsh', 120, 1000) ]);
  ok('season.hopping-does-not-inflate-the-season',
     hopped.pts === stayed.pts,
     `one room ${stayed.pts} vs two rooms ${hopped.pts} — a player who dropped into a second game late scored higher for it`);
  ok('season.the-best-room-is-the-one-that-counts',
     stayed.pts === 80,
     `800 of 1000 in the best room should be 80, got ${stayed.pts}`);

  /* And the reverse: a BETTER second room should raise it to that room. */
  const better = await t([ row('gn13-2026-08-19-min-gs', 300, 1000),
                           row('slate-2026-08-19-tor-wsh', 900, 1000) ]);
  ok('season.your-best-room-counts-even-if-it-is-the-second-one',
     better.pts === 90, `expected 90, got ${better.pts}`);

  /* ---- 2. NIGHTS ADD UP; ROOMS DO NOT -------------------------------- */
  const twoNights = await t([ row('gn13-2026-08-19-min-gs', 800, 1000),
                              row('gn14-2026-08-21-abc-def', 500, 1000) ]);
  ok('season.two-nights-add-up', twoNights.pts === 130, `expected 130, got ${twoNights.pts}`);
  ok('season.a-night-is-counted-once-however-many-rooms',
     hopped.games === 1 && hopped.rooms === 2,
     `nights=${hopped.games} rooms=${hopped.rooms} — the streak must count nights, not rooms`);
  ok('season.two-nights-count-as-two',
     twoNights.games === 2, `nights=${twoNights.games}`);

  /* ---- 3. SPORTS ARE COMPARABLE -------------------------------------- */
  /* A three-round baseball night and a four-quarter basketball night have
     different ceilings. Perfect is perfect in both. */
  const ball = await t([ row('slate-2026-08-19-tor-wsh', 1000, 1000) ]);
  const base = await t([ row('slate-2026-08-19-det-pit',  700,  700) ]);
  ok('season.a-perfect-night-is-100-in-any-sport',
     ball.pts === 100 && base.pts === 100,
     `basketball ${ball.pts}, baseball ${base.pts} — raw points are not the same unit across sports`);
  const halfBall = await t([ row('slate-2026-08-19-tor-wsh', 500, 1000) ]);
  const halfBase = await t([ row('slate-2026-08-19-det-pit', 350,  700) ]);
  ok('season.half-a-night-is-half-in-any-sport',
     halfBall.pts === halfBase.pts,
     `basketball ${halfBall.pts}, baseball ${halfBase.pts}`);

  /* ---- 4. NOTHING FROM THE PAST DISAPPEARS --------------------------- */
  const legacy = await t([ row('gn11-2026-08-16-ind-atl', 420, 0) ]);
  ok('season.an-old-row-with-no-ceiling-still-counts-as-a-night',
     legacy.games === 1,
     'a row written before max was recorded vanished from the season');
  ok('season.the-raw-total-is-still-kept',
     hopped.ptsRaw === 920,
     `ptsRaw=${hopped.ptsRaw} — the stat book is a record of what happened and 920 points did happen`);

  /* ---- 4b. AN UNSCORED ROOM MUST NOT EVICT A SCORED ONE --------------
     28 Aug 2026, from the founder's own Board: a night he scored 150 in
     printed a dash and added zero to the season.

     Section 4 above already checked that a legacy row survives ALONE.
     What nothing checked was a legacy row sharing a night with a real
     one — and that is where it broke. `score` is a PERCENTAGE for a row
     with a ceiling and RAW POINTS for a row without, and the two were
     compared with `>`. 150 raw beat 45%, so the row with no ceiling won
     the night, and then contributed nothing because the season sums
     `pct` and its pct is null.

     A row with no denominator did not just fail to count. It evicted the
     row that would have. */
  const mixed = await t([
    row('slate-2026-08-28-wsh-bal', 150, 0),      // legacy: no ceiling
    row('slate-2026-08-28-por-atl', 450, 1000),   // real: 45% of its room
  ]);
  ok('season.an-unscored-room-does-not-evict-a-scored-one',
     mixed.pts === 45,
     `expected the night to count 45, got ${mixed.pts} — a row with no ceiling took the night and scored nothing for it`);
  ok('season.the-scored-room-represents-the-night',
     mixed.byNight && mixed.byNight['2026-08-28'] &&
     mixed.byNight['2026-08-28'].night === 'slate-2026-08-28-por-atl',
     `the night is represented by ${mixed.byNight && mixed.byNight['2026-08-28'] && mixed.byNight['2026-08-28'].night}`);
  ok('season.both-rooms-are-still-counted-as-played',
     mixed.rooms === 2, `rooms=${mixed.rooms}`);

  /* And the reverse order, because "the legacy one came second" is a
     different code path through the same comparison. */
  const mixedRev = await t([
    row('slate-2026-08-28-por-atl', 450, 1000),
    row('slate-2026-08-28-wsh-bal', 150, 0),
  ]);
  ok('season.order-does-not-decide-which-room-represents-a-night',
     mixedRev.pts === 45, `expected 45, got ${mixedRev.pts}`);

  /* ---- 4c. THE DENOMINATOR BELONGS TO THE SPORT ----------------------
     The season is a percentage, so every check above is only as honest as
     MAXPTS. It was a `const` computed once at page load from whatever
     night happened to be built in, and never again — so a baseball room
     whose parts sum to 1300 was recorded out of basketball's 1000, and
     every sport reported the identical ceiling.

     sportTotals() exists because NR, CATCH_PTS, PRED_MAX and LIVE_MAX all
     had this bug; its own comment reads "Leaving any of them behind is
     this codebase's whole disease." MAXPTS was the one left behind.

     Measured before the fix: 1000 for all five sports. After: 1100
     basketball, 940 soccer, 1300 baseball, 1100 football, 1060 hockey. */
  const ceilings = await p.evaluate(() => {
    const out = [];
    for (const k of Object.keys(SPORTS || {})) {
      try { setSport(k); sportTotals(); } catch (e) { out.push({k, err:e.message}); continue; }
      out.push({ k, max: MAXPTS,
                 parts: PRED_MAX + LIVE_MAX + CATCH_PTS
                        + (typeof CAUGHT_NIGHT_CAP === 'number' ? CAUGHT_NIGHT_CAP : 0) });
    }
    return out;
  });
  ok('season.every-sport-reports-its-own-ceiling',
     ceilings.length > 0 && ceilings.every(c => !c.err && c.max === c.parts),
     ceilings.map(c => c.err ? `${c.k} threw ${c.err}` : `${c.k}: MAXPTS=${c.max} but its parts sum to ${c.parts}`)
             .join('; ') || 'no sports walked');
  /* ---- 4d. THE FROZEN-MAXPTS DETECTOR HAD TO CHANGE SHAPE ------------
     This used to assert that the five sports report DIFFERENT ceilings,
     because a frozen MAXPTS shows up as every sport reporting the same
     number. That detector died on 31 Aug 2026, and not to a bug — to a
     product decision.

     Founder: "we should find a way to make every game a potential of 1000
     points." Every sport now pays 600 on the sheet and 400 in live rounds,
     so every sport's ceiling is legitimately 1100 (the 1000 plus the 100
     Caught It cap). The old check cannot tell CORRECTLY EQUAL from FROZEN
     any more, and it went red on the very build that implemented the rule.

     This is worth naming, because it will happen again: MAKING A SET OF
     VALUES UNIFORM DESTROYS EVERY DETECTOR THAT WORKED BY COMPARING THEM.
     The uniformity is the feature; the detector has to stop reading values
     and start reading behaviour.

     So it perturbs and observes. Change a worth that MUST move the
     ceiling, recompute, and require the ceiling to move. A MAXPTS frozen
     at load cannot follow, whatever the sports happen to total. The
     original value is restored and re-derived so nothing downstream in
     this suite inherits a doctored page. */
  const reactive = await p.evaluate(() => {
    try {
      setSport('basketball'); sportTotals();
      const before = MAXPTS;
      const keep = SPORTS.basketball.worth[0];
      SPORTS.basketball.worth[0] = keep + 500;   // 4 questions x 500 = +2000
      sportTotals();
      const after = MAXPTS;
      SPORTS.basketball.worth[0] = keep;         // put it back
      sportTotals();
      const restored = MAXPTS;
      return { before, after, restored, keep };
    } catch (e) { return { err: e.message }; }
  });
  ok('season.the-ceiling-recomputes-and-is-not-frozen-at-load',
     !reactive.err && reactive.after !== reactive.before && reactive.restored === reactive.before,
     reactive.err
       ? `threw ${reactive.err}`
       : `MAXPTS was ${reactive.before}, and after raising basketball's Q1 worth by 500 it read `
         + `${reactive.after} — it must move, or it is frozen at load `
         + `(restored to ${reactive.restored})`);

  /* ---- 5. IT CANNOT EXCEED THE CAP ----------------------------------- */
  const silly = await t([ row('gn13-2026-08-19-min-gs', 5000, 1000) ]);
  ok('season.one-night-can-never-exceed-100',
     silly.pts === 100, `a corrupt row produced ${silly.pts}`);
  const empty = await t([]);
  ok('season.no-games-is-zero-not-a-crash',
     empty && empty.pts === 0 && empty.games === 0, JSON.stringify(empty));

  await b.close();
  console.log(`\n${fail?'RED':'GREEN'}   ${pass} passed, ${fail} failed   [${path.basename(TARGET)}]`);
  bad.forEach(x=>console.log('   x '+x));
  process.exit(fail?1:0);
})();
