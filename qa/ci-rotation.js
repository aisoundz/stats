/* ============ qa/ci-rotation.js ======================================
   "We need more questions for caught it in baseball." — 21 Aug.

   The bank was never the problem. Baseball has four Caught It kinds and
   the chooser was

       rot = (counts[per] || 0) % 4          counts is keyed BY PERIOD

   Baseball gets about one Caught It an inning, so counts[per] was 0
   nearly every time, so rot was 0, so it was always kind zero. Friday's
   baseball room fired eight questions and every single one was "that last
   pitch, what was it?" — the question he had told me an hour earlier does
   not work because the broadcast runs behind the feed.

   Three of baseball's four kinds had never fired in a real game. Football
   has six and reached three. Nothing in the suite noticed, because every
   check asked "does a question resolve", never "do we ask more than one".
   ================================================================== */
const fs=require('fs'), path=require('path'), vm=require('vm');
let pass=0, fail=0;
const ok =(n,d)=>{pass++; console.log('  ok   '+n+(d?('   '+d):''));};
const bad=(n,d)=>{fail++; console.log('  FAIL '+n+(d?'\n         '+d:''));};

const src=fs.readFileSync(path.join(__dirname,'..','admin.html'),'utf8');
const S='/* @host-shared:start', E='/* @host-shared:end */';
const ctx=vm.createContext({console, fetch:()=>{throw new Error('no network');}});
vm.runInContext(src.slice(src.indexOf(S), src.indexOf(E)+E.length), ctx, {filename:'host-shared'});
const C=(ctx.AUTO && ctx.AUTO.CI) || ctx.CI;
if(!C){ bad('the Caught It engine loads'); process.exit(1); }

/* ---- the counter it rotates on ------------------------------------- */
if(typeof C.asked!=='function') bad('C.asked exists');
else {
  ok('C.asked exists');
  const t=(n,f)=>{ try{ f()?ok(n):bad(n); }catch(e){ bad(n,e.message); } };
  t('it counts the whole game, not one period', ()=> C.asked({1:2,2:3,3:1})===6);
  t('an empty night is zero', ()=> C.asked({})===0);
  t('nothing at all is zero', ()=> C.asked(null)===0);
  t('a junk value does not poison the count', ()=> C.asked({1:2,2:'x'})===2);
}

/* ---- and the builders use it ---------------------------------------- */
const perPeriod=[...src.matchAll(/var rot\s*=\s*\(counts\[per\]\|\|0\)\s*%/g)];
if(perPeriod.length) bad('no builder rotates on the per-period counter',
  perPeriod.length+' builder(s) still divide a counter that resets every period — '+
  'that is the bug: one question an inning means rot is always 0');
else ok('no builder rotates on the per-period counter');

const onGame=[...src.matchAll(/var rot\s*=\s*C\.asked\(counts\)\s*%\s*(\d+)/g)];
if(onGame.length>=4) ok('every builder rotates on the game', onGame.length+' builders, cycles of '+onGame.map(m=>m[1]).join('/'));
else bad('every builder rotates on the game', 'only '+onGame.length+' found');

/* ---- THE CLAIM THAT MATTERS: a real night sees every kind ----------- */
/* Walk the rotation the way a night walks it — one question at a time,
   the counter rising — and demand that a game reaches all of a sport's
   kinds. This is the check that could have caught it: it counts DISTINCT
   questions asked, which is the thing the founder was missing. */
[['baseball',4,9,12],['football',6,4,12],['basketball',4,4,12],['soccer',3,2,12]]
  .forEach(([sport,cycle,periods,perGame])=>{
    const seen=new Set(); const counts={};
    for(let i=0;i<perGame;i++){
      const per=Math.min(periods, Math.floor(i/(perGame/periods))+1);
      seen.add(C.asked(counts) % cycle);
      counts[per]=(counts[per]||0)+1;
    }
    if(seen.size===cycle) ok(sport+': a full game reaches all '+cycle+' kinds');
    else bad(sport+': a full game reaches all '+cycle+' kinds',
             'it only ever reaches '+seen.size+' of them — kinds '+[...seen].sort().join(',')+
             '. A player is asked the same question all night.');
  });

/* And the specific shape that produced the bug: roughly one a period. */
[['baseball',4,9]].forEach(([sport,cycle,periods])=>{
  const seen=new Set(); const counts={};
  for(let per=1; per<=periods; per++){
    seen.add(C.asked(counts) % cycle);
    counts[per]=1;                     // exactly one question this period
  }
  if(seen.size===cycle) ok(sport+': one question an inning still reaches all '+cycle+' kinds');
  else bad(sport+': one question an inning still reaches all '+cycle+' kinds',
           'reaches '+seen.size+' — this is Friday night exactly: eight questions, one kind');
});

console.log('\n  '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
