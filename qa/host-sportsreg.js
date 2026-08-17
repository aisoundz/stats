#!/usr/bin/env node
/* =====================================================================
   Does every sport in the registry actually load and play?
   ---------------------------------------------------------------------
   Added 17 Aug 2026 with baseball, football and hockey. A sport is not
   "added" when its entry exists — it is added when ?sport=<it> loads
   without throwing, carries its OWN language, and can start a practice
   round. ?sport=soccer shipped reachable and half-built for weeks, with
   rules copy that contradicted its own point values, which is exactly what
   a sport that was declared rather than tested looks like.

   It also pins the ceiling: every sport is six picks at 100 = 600 of a
   1,000-point night. A sport quietly paying a different total makes scores
   incomparable across sports for no reason anybody chose.

       node qa/host-sportsreg.js
   ================================================================== */
const { chromium } = require('playwright');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const F=require(path.join(__dirname,'fixtures.js'));
(async()=>{
  const b=await chromium.launch();
  let bad=0;
  for(const sport of ['basketball','baseball','football','hockey','soccer']){
    const p=await b.newPage({viewport:{width:393,height:852}});
    const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
    await p.route('**/site.api.espn.com/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(F.PRE)}));
    await p.goto('file://'+path.join(ROOT,'index.html')+'?sport='+sport,{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(1200);
    const r=await p.evaluate(()=>{
      let started=false, qtext=null, opts=0;
      try{ startDemo(); S.name='QA'; lockPredictions(); startQuarter(0); started=true;
           const c=document.getElementById('qText')||document.querySelector('#gtQuestion .qh, #gtQuestion h3');
           qtext=c?(c.innerText||'').slice(0,60):null;
           opts=document.querySelectorAll('#gtQuestion button, .qopt').length;
      }catch(e){ started=String(e.message); }
      return { key:SPORT.key, league:(SPORT.L||{}).league, period:(SPORT.L||{}).Period,
               rounds:rounds.length, qPerRound:rounds.map(r=>r.q.length).join('+'),
               preds:preds.length, predTotal:preds.reduce((a,p)=>a+(p.base||0)+(p.bonus||0),0),
               worth:(SPORT.worth||[]).join('/'), tags:(SPORT.tags||[]).join('/'),
               game:GAME.awayAbbr+'@'+GAME.homeAbbr, night:GAME.night||GAME.nightId,
               started, qtext, opts };
    });
    /* Every sport pays the same 600 for its pick sheet. */
    const ok = errs.length===0 && r.started===true && r.predTotal===600;
    if(!ok) bad++;
    console.log(`${ok?'\x1b[32m✓\x1b[0m':'\x1b[31m✗\x1b[0m'} ${sport.padEnd(11)} ${String(r.league||'-').padEnd(5)} ${String(r.period||'-').padEnd(8)} rounds=${r.rounds} (${r.qPerRound})  picks=${r.preds}=${r.predTotal}pts  worth=${r.worth}  ${r.game}`);
    if(errs.length) console.log(`    errors: ${errs.slice(0,2).join(' | ')}`);
    if(r.started!==true) console.log(`    practice failed: ${r.started}`);
    if(r.predTotal!==600) console.log(`    pick sheet pays ${r.predTotal}; every sport must pay 600`);
    await p.close();
  }
  console.log(bad?`\n${bad} sport(s) broken`:'\nevery sport loads and starts a practice round');
  await b.close(); process.exit(bad?1:0);
})();
