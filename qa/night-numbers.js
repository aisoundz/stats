/* ============ qa/night-numbers.js ====================================
   GAME NIGHT #N IS A FACT ABOUT TIP ORDER, AND IT HAS ONE OWNER.

   Founder, 22 Aug: "We added a game last minute yesterday. All the games
   should be in order."

   That is the whole cause. Friday's fourth room — Lynx at Mystics — was
   added after the marquee files had been written. It took #17 in tip
   order and pushed Friday's last room to #19. Saturday's marquee file,
   written on the 20th when the highest known number was 18, still said
   19-22, so Saturday opened with a #19 that Friday had already used.

   TWO FILES OWNED ONE NUMBER. build-slate.js derives it from the tip
   order, counting on from the previous night. host/marquee.js had its own
   nextNumber() that scanned marquee FILES and stamped the result into
   slate/{date}. A comment in marquee.js said its numbers were "advisory
   only" because build-slate runs afterwards and overwrites them —
   start-slate.sh runs build at line 127 and marquee at line 168, so the
   opposite was true every single morning. The note explaining why it was
   safe named the exact symptom it was causing.

   A rule that is REMEMBERED from a file cannot survive a game being added
   late. A rule that is RECOMPUTED from the series can.
   ================================================================== */
const fs=require('fs'), path=require('path');
const H=f=>fs.readFileSync(path.join(__dirname,'..','host',f),'utf8');
const build=H('build-slate.js'), marq=H('marquee.js'), start=H('start-slate.sh');
let pass=0, fail=0;
const ok =(n,d)=>{pass++; console.log('  ok   '+n+(d?('   '+d):''));};
const bad=(n,d)=>{fail++; console.log('  FAIL '+n+(d?'\n         '+d:''));};
const t=(n,f)=>{ try{ f()?ok(n):bad(n); }catch(e){ bad(n,e.message); } };

/* ---- one owner ------------------------------------------------------ */
t('build-slate derives the number from tip order', ()=>
  /merged\.forEach\(\(g,i\) => \{ g\.gn = last \+ i \+ 1; \}\)/.test(build));
t('it counts on from the previous night', ()=>
  /slate\/' \+ prev/.test(build) && /Math\.max\(m,\s*Number\(g\.gn\)\s*\|\|\s*0\)/.test(build));
t('marquee.js does NOT stamp gn onto the slate', ()=>{
  const stamp=(marq.match(/const stamp = arr =>[\s\S]{0,900}?\n  \}\);/)||[''])[0];
  if(/gn:\s*numbers\.get/.test(stamp)){
    console.log('         the stamp still writes gn — it runs AFTER the build and will win');
    return false;
  }
  return /gotn:/.test(stamp);
});
t('marquee.js no longer invents the next number', ()=>
  !/let next = nextNumber\(\);[\s\S]{0,200}?numbers\.set\(g\.nightId, String\(next\+\+\)\)/.test(marq));

/* ---- the order the two actually run in ------------------------------ */
t('the build runs before the marquee, and the code knows it', ()=>{
  const b=start.indexOf('node host/build-slate.js');
  const m=start.indexOf('node host/marquee.js');
  if(b<0||m<0){ console.log('         could not find both invocations in start-slate.sh'); return false; }
  if(!(b<m)){ console.log('         marquee now runs FIRST — the ownership note is stale again'); return false; }
  /* And the comment must not claim the reverse, which is what made this
     invisible for a day. */
  return !/it does so AFTER this file's numbers are applied/.test(marq);
});

/* ---- THE CLAIM: a late-added game keeps the series in order --------- */
/* Replay the real derivation. Friday is the case that broke it: three
   rooms planned, a fourth added on the day. */
const derive = (prevMax, tips) => {
  const sorted = tips.slice().sort((a,b)=>String(a.tip).localeCompare(String(b.tip)));
  return sorted.map((g,i)=>({ id:g.id, gn: prevMax + i + 1 }));
};
t('a game added last minute takes its place in tip order', ()=>{
  /* FULL ISO INSTANTS, not clock strings. A night crosses midnight UTC —
     a 7pm Pacific tip is the next day in UTC — so "02:00" sorts before
     "23:00" and the whole order inverts. The real slate carries tipISO for
     exactly this reason, and a fixture that drops it tests nothing. */
  const fri = derive(15, [
    {id:'nyj-pit', tip:'2026-08-21T23:00Z'}, {id:'laa-tex', tip:'2026-08-22T00:15Z'},
    {id:'por-tor', tip:'2026-08-22T02:00Z'}, {id:'min-wsh', tip:'2026-08-21T23:30Z'}  // added on the day
  ]);
  const got = fri.map(x=>x.id+'#'+x.gn).join(' ');
  const want = 'nyj-pit#16 min-wsh#17 laa-tex#18 por-tor#19';
  if(got!==want){ console.log('         got: '+got+'\n         want: '+want); return false; }
  return true;
});
t('the next night starts after it, not after the plan', ()=>{
  const friMax = 19;                       // what Friday actually ended on
  const sat = derive(friMax, [
    {id:'buf-cle', tip:'2026-08-22T17:00Z'}, {id:'nyg-mia', tip:'2026-08-22T20:00Z'},
    {id:'pit-lad', tip:'2026-08-22T23:15Z'}, {id:'por-lafc', tip:'2026-08-23T02:30Z'}
  ]);
  const first = sat[0].gn;
  if(first!==20){ console.log('         Saturday opened on #'+first+', reusing a number'); return false; }
  return sat[sat.length-1].gn===23;
});
t('no number is ever used twice across two nights', ()=>{
  const fri = derive(15, [{id:'a',tip:'1'},{id:'b',tip:'2'},{id:'c',tip:'3'},{id:'d',tip:'4'}]);
  const sat = derive(Math.max(...fri.map(x=>x.gn)), [{id:'e',tip:'1'},{id:'f',tip:'2'}]);
  const all = fri.concat(sat).map(x=>x.gn);
  return new Set(all).size === all.length;
});
t('the series has no gaps either', ()=>{
  const fri = derive(15, [{id:'a',tip:'1'},{id:'b',tip:'2'}]);
  const sat = derive(Math.max(...fri.map(x=>x.gn)), [{id:'c',tip:'1'},{id:'d',tip:'2'}]);
  const all = fri.concat(sat).map(x=>x.gn).sort((a,b)=>a-b);
  return all.every((n,i)=> i===0 || n===all[i-1]+1);
});


/* ============================================================================
   ADDED 22 Aug — TWO ROOMS CANNOT BE THE SAME GAME NIGHT

   Building 23 August wrote slate-marquee-2026-08-23.txt as
   24 sf-bos / 25 nyc-ne / 24 ind-chi / 25 sea-ten, while slate/2026-08-23
   correctly held #24-#27 in tip order. The number the PLAYER saw was right
   and the durable RECORD was wrong — the worse way round, because
   build-slate.js reads that file back at 08:10 and honours a number for a
   night it believes was already announced. A duplicate in the file
   propagates into the next day rather than staying a display bug.

   host/marquee.js refuses to write such a file now. This asserts the
   refusal exists and runs BEFORE the write, because a guard nobody checks
   is a guard that gets deleted.
   ========================================================================== */
const _fs2 = require('fs'), _path2 = require('path');
const MSRC = _fs2.readFileSync(_path2.join(__dirname, '..', 'host', 'marquee.js'), 'utf8');
const _w = MSRC.indexOf('fs.writeFileSync(MARQF');
const _d = MSRC.search(/new Set\(nums\)\.size\s*!==\s*nums\.length/);

t('marquee.js tests its numbers for duplicates', () => _d > -1);
t('marquee.js tests for a room with no number at all', () => /blank\.length/.test(MSRC));
t('marquee.js still writes the record', () => _w > -1);
t('the duplicate test runs BEFORE the file is written', () => _d > -1 && _w > -1 && _d < _w);
t('it REFUSES rather than warning', () => /die\(\s*['"`]two rooms were given the SAME/.test(MSRC));

/* And every record actually on disk must be clean. */
const LOGDIR2 = _path2.join(process.env.HOME, 'gamenight-logs');
let _checked = 0; const _bad = [];
try{
  _fs2.readdirSync(LOGDIR2)
    .filter(f => /^slate-marquee-\d{4}-\d{2}-\d{2}\.txt$/.test(f))
    .forEach(f => {
      const ns = _fs2.readFileSync(_path2.join(LOGDIR2, f), 'utf8')
        .split('\n').map(x => x.trim()).filter(Boolean)
        .map(l => (l.match(/^(\d+)\s/) || [])[1]).filter(Boolean);
      if(!ns.length) return;
      _checked++;
      if(new Set(ns).size !== ns.length) _bad.push(f + ' -> ' + ns.join(','));
    });
}catch(_){}
t('there are marquee records on disk to check', () => _checked > 0);
t('every marquee record on disk has distinct Game Night numbers', () => {
  if(_bad.length) console.error('        ' + _bad.join('\n        '));
  return _bad.length === 0;
});

console.log('\n  '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);