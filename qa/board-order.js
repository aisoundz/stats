#!/usr/bin/env node
/* =====================================================================
   THE BOARD RANKS ON THE NUMBER IT PRINTS.
   ---------------------------------------------------------------------
   Game Night #12: the founder photographed his own phone showing

       1  Smakk      161
       2  Mike       103
       3  Courtside  135     <- 135 is not less than 103

   The rows printed `pts`; the sort ran on nightTotal(), which added the
   client lanes ON TOP of `pts` — a value that already contained them. So
   the list was ordered by live + 2×(pred+catch+caught).

   Every case below uses the REAL player rows from that night, at the
   moment of that screenshot and at the final buzzer. A leaderboard test
   written against invented numbers would have passed the whole time.

       node qa/board-order.js [index.html]
   ================================================================== */
const fs=require('fs'), path=require('path');
const TARGET=path.resolve(process.argv[2]||path.join(__dirname,'..','index.html'));
const src=fs.readFileSync(TARGET,'utf8');
const a=src.indexOf('function nightTotal(v) {');
if(a<0) throw new Error('nightTotal not found in '+TARGET);
const nightTotal=new Function(src.slice(a, src.indexOf('SB.nightTotal'))+'\nreturn nightTotal;')();

let pass=0, fail=0;
function order(rows){ return rows.map(r=>({n:r.n,t:nightTotal(r)}))
  .sort((x,y)=>y.t-x.t).map(r=>r.n).join(' > '); }
function is(label, got, want, why){
  if(got===want){ pass++; console.log('  ok   '+label+'  ->  '+got); }
  else { fail++; console.log('  FAIL '+label+'\n         got  '+got+'\n         want '+want+(why?'\n         ('+why+')':'')); }
}

/* 1. THE SCREENSHOT. Rows exactly as they stood at 8:43pm, before the
      server had ever published a live lane — so this is the fallback path,
      and the fallback is what every existing player row will hit. */
console.log('\nGN12, 8:43pm — the rows in the founder\'s photograph');
const shot=[
  {n:'Smakk',     pts:161, predPts:20, catchPts:0, caughtPts:61},
  {n:'Mike',      pts:103, predPts:22, catchPts:0, caughtPts:41},
  {n:'Courtside', pts:135, predPts:0,  catchPts:0, caughtPts:10}
];
is('order matches the printed numbers', order(shot), 'Smakk > Courtside > Mike',
   'the bug put Mike second on 103 ahead of Courtside on 135');
is('Courtside totals 135, not 145', nightTotal(shot[2]), 135, 'lanes were double-counted');
is('Mike totals 103, not 166',      nightTotal(shot[1]), 103);

/* 2. THE NEW SHAPE, once the server publishes livePts. Final-buzzer rows. */
console.log('\nGN12 final — with the live lane published');
const fin=[
  {n:'Smakk',     livePts:200, pts:440, predPts:220, catchPts:0, caughtPts:20},
  {n:'Mike',      livePts:80,  pts:212, predPts:72,  catchPts:0, caughtPts:60},
  {n:'Courtside', livePts:130, pts:135, predPts:0,   catchPts:0, caughtPts:5}
];
is('order',        order(fin), 'Smakk > Mike > Courtside');
is('Smakk 440',    nightTotal(fin[0]), 440);
is('Mike 212',     nightTotal(fin[1]), 212);
is('Courtside 135',nightTotal(fin[2]), 135);

/* 3. THE LANES STAY FRESHER THAN THE TALLY. A caught point earned after
      the last scoring pass must count immediately — that is the whole
      reason the total is composed rather than stored. */
console.log('\nlanes move between tally passes');
is('a catch after the last pass counts now',
   nightTotal({livePts:80, pts:212, predPts:72, catchPts:0, caughtPts:75}), 227,
   'stale pts would still read 212');

/* 4. REFUSALS — the shapes that must NOT be treated as a live lane. */
console.log('\nbad rows do not become scores');
is('no livePts falls back to pts alone', nightTotal({pts:50, predPts:9, caughtPts:9}), 50);
is('livePts 0 is a real zero, not missing', nightTotal({livePts:0, pts:99, predPts:7, caughtPts:3}), 10);
is('NaN livePts falls back', nightTotal({livePts:NaN, pts:42, predPts:5}), 42);
is('a string livePts falls back', nightTotal({livePts:'80', pts:42, predPts:5}), 42);
is('an empty row is zero', nightTotal({}), 0);
is('undefined is zero', nightTotal(undefined), 0);

console.log('\n'+(fail?('FAIL — '+fail+' of '+(pass+fail)):('PASS — all '+pass+' board-order cases')));
process.exit(fail?1:0);
