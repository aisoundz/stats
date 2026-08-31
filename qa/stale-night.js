/* qa/stale-night.js — a link to a finished night must not repaint it.
   The bug: ?game=slate-2026-08-30-cin-chc on 31 Aug painted "CIN 7 CHC 5
   Final" and offered "Play Reds at Cubs" while the hero counted down to
   Arsenal. Checked at the FUNCTION level because the failure happens at
   boot, before anything a selector could read has settled. */
const PW=require('/home/higherthan7/stats/node_modules/playwright');
const F=process.argv[2]||'/home/higherthan7/stats/index-test.html';
(async()=>{
  const b=await PW.firefox.launch(); const p=await b.newPage({viewport:{width:390,height:844}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  let pass=0,fail=0;
  const ok=(n,c,d)=>{c?pass++:fail++;console.log((c?'  ok   ':'  FAIL ')+n+(d?'   '+d:''));};
  await p.goto('file://'+F+'?fixture=1',{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>typeof window.staleNightId==='function',{timeout:25000});

  const r=await p.evaluate(()=>{
    const today=todayPTDate();
    const d=new Date(today+'T12:00:00Z');
    const y=new Date(d.getTime()-86400000).toISOString().slice(0,10);
    const t=new Date(d.getTime()+86400000).toISOString().slice(0,10);
    return {today,
      yesterday: staleNightId('slate-'+y+'-cin-chc'),
      tonight:   staleNightId('slate-'+today+'-ars-avl'),
      tomorrow:  staleNightId('slate-'+t+'-xxx-yyy'),
      garbage:   staleNightId('not-a-slate-id'),
      empty:     staleNightId(''),
      nul:       staleNightId(null),
      parsed:    nightIdDate('slate-2026-08-30-cin-chc')};
  });
  ok('it reads the date out of the nightId', r.parsed==='2026-08-30', r.parsed);
  ok('YESTERDAY is stale — the actual bug', r.yesterday===true);
  ok("tonight's room is not stale", r.tonight===false, 'today='+r.today);
  ok('a future night is stale too', r.tomorrow===true);
  ok('an unreadable id is LEFT ALONE, not guessed', r.garbage===false && r.empty===false && r.nul===false,
     JSON.stringify([r.garbage,r.empty,r.nul]));

  // THE REAL BOOT PATH, not a re-implementation of it. The first version
  // of this check copied the guard's logic into evaluate() and asserted
  // against the copy — so deleting the guard from the page left it green.
  // Seed localStorage, reload WITH the stale link, and read what the app
  // itself did.
  const today = r.today;
  const yday = new Date(new Date(today+'T12:00:00Z').getTime()-86400000).toISOString().slice(0,10);
  const stale = 'slate-'+yday+'-cin-chc';
  await p.evaluate(([id])=>{
    localStorage.setItem('stats_slate_pick_v1', id);
    localStorage.setItem('stats_night_cfg_'+id, JSON.stringify({
      nightId:id, sport:'baseball', away:'Reds', home:'Cubs', rounds:[] }));
  },[stale]);
  await p.goto('file://'+F+'?fixture=1&game='+stale,{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>typeof window.staleNightId==='function',{timeout:25000});
  const after = await p.evaluate(([id])=>({
    source: (typeof NIGHT_CFG_SOURCE!=='undefined') ? NIGHT_CFG_SOURCE : '(undefined)',
    remembered: localStorage.getItem('stats_slate_pick_v1'),
    body: document.body.innerText.slice(0,4000)
  }),[stale]);
  ok('a stale ?game= does not replay yesterday from cache',
     after.source !== 'cache', 'NIGHT_CFG_SOURCE='+after.source);
  ok('and the remembered pick is cleared at boot',
     after.remembered===null, String(after.remembered));
  ok('yesterday\'s teams are not on the screen',
     !/Reds at Cubs|CIN\s*\d+\s*CHC/.test(after.body),
     (after.body.match(/Reds at Cubs|CIN\s*\d+\s*CHC/)||['none'])[0]);

  ok('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
  await b.close();
  console.log(`\n${fail?'RED':'GREEN'}   ${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})();
