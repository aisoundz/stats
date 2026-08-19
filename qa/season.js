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
