/* Cross-device audit. Runs the real game loop at the sizes people actually
   hold, and reports the things that only break on a small screen: content
   wider than the viewport, tap targets too small for a thumb, text too
   small to read across a couch, and fixed elements stacked on top of each
   other. Run before any game night you plan to play on more than one device.
       node qa/devices.js [file]                                        */
const {chromium}=require('playwright'); const path=require('path');
const F=require('./fixtures.js');
const FILE=process.argv[2]||'index.html';
const URL='file://'+path.join(__dirname,'..',FILE);

const DEVICES=[
  {n:'iPhone SE',      w:375, h:667},
  {n:'iPhone 15',      w:393, h:852},
  {n:'iPhone 15 Pro Max', w:430, h:932},
  {n:'laptop 13"',     w:1280,h:800},
  {n:'laptop 15"',     w:1440,h:900},
];
/* Screens a player actually touches during a night. */
const LIVEPATH=['landing','name','predict','lobby','live','review','break','gametime','stats','board','me','final'];

(async()=>{
  console.log(`\nCROSS-DEVICE AUDIT — ${FILE}\n`);
  const b=await chromium.launch((require('fs').existsSync('/opt/pw-browsers/chromium')?{executablePath:'/opt/pw-browsers/chromium'}:{}));
  let problems=0;
  for(const d of DEVICES){
    const p=await b.newPage({viewport:{width:d.w,height:d.h},deviceScaleFactor:2,
      isMobile:d.w<600, hasTouch:d.w<600});
    const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
    await p.route('**/site.api.espn.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(F.PRE)}));
    await p.route('**/assets.mailerlite.com/**', r=>r.fulfill({status:200,body:'{}'}));
    await p.goto(URL,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2200);

    // Drive a full practice night so the later screens have real content.
    await p.evaluate(()=>{ startDemo(); S.name='QA'; startPredict(); });
    await p.waitForTimeout(500);
    for(let k=0;k<8;k++){
      const L=await p.evaluate(()=>predOrderList().length);
      await p.evaluate(()=>{ const L=predOrderList(); const blank=L.findIndex(x=>!S.predChoices[x.id]);
        if(blank>=0){ PD.i=blank; buildPred(); } });
      const opt=await p.$('#predCard .pdopt'); if(!opt) break;
      await opt.click(); await p.waitForTimeout(260);
      const bi=await p.$('#predCard .pdbonus input'); if(bi) await bi.fill('9');
      const done=await p.evaluate(()=>preds.filter(x=>S.predChoices[x.id]).length===preds.length);
      if(done) break;
    }
    await p.evaluate(()=>{ try{ lockPredictions(); }catch(e){} });
    await p.waitForTimeout(600);

    const report=await p.evaluate((screens)=>{
      const out={overflow:[],tiny:[],small:[],stacked:[],cut:[]};
      const seen=new Set();
      screens.forEach(k=>{
        if(!map[k]) return;
        try{ go(k); }catch(e){ return; }
        // horizontal overflow
        const de=document.documentElement;
        if(de.scrollWidth > window.innerWidth+1) out.overflow.push(`${k} (+${de.scrollWidth-window.innerWidth}px)`);
        const sec=document.getElementById(map[k]); if(!sec) return;
        sec.querySelectorAll('button, a, input, select').forEach(el=>{
          const r=el.getBoundingClientRect();
          if(r.width<1||r.height<1) return;
          const id=k+'|'+(el.id||el.className||el.tagName)+'|'+Math.round(r.top);
          if(seen.has(id)) return; seen.add(id);
          if(r.height<38) out.tiny.push(`${k}: ${(el.textContent||el.id||el.tagName).trim().slice(0,26)} ${Math.round(r.height)}px`);
          if(r.right>window.innerWidth+1||r.left<-1) out.cut.push(`${k}: ${(el.textContent||el.tagName).trim().slice(0,22)}`);
        });
        sec.querySelectorAll('*').forEach(el=>{
          if(!el.childNodes.length) return;
          const own=Array.from(el.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join('');
          if(own.length<6) return;
          const fs=parseFloat(getComputedStyle(el).fontSize);
          if(fs && fs<12) out.small.push(`${k}: "${own.slice(0,24)}" ${fs}px`);
        });
      });
      /* Fixed overlays must not stack — measured at the WORST case, which
         is scrolled to the very bottom of the pick screen. Measuring at
         scroll 0 hides the exact collision this is looking for, and
         measuring at whatever scroll the last screen happened to leave
         behind reports collisions that are not real. Be deliberate. */
      const fx=['botnav','pdBar','ciCard'].map(id=>document.getElementById(id)).filter(Boolean);
      go('predict');
      window.scrollTo(0, document.documentElement.scrollHeight);
      void document.documentElement.offsetHeight;
      const vis=fx.filter(e=>getComputedStyle(e).display!=='none');
      for(let i=0;i<vis.length;i++)for(let j=i+1;j<vis.length;j++){
        const a=vis[i].getBoundingClientRect(), c=vis[j].getBoundingClientRect();
        if(a.right>c.left&&a.bottom>c.top&&a.top<c.bottom&&a.left<c.right)
          out.stacked.push(`${vis[i].id} over ${vis[j].id}`);
      }
      return out;
    }, LIVEPATH);

    const uniq=a=>[...new Set(a)];
    const lines=[];
    if(report.overflow.length) lines.push(`  horizontal overflow: ${uniq(report.overflow).join(', ')}`);
    if(report.cut.length)      lines.push(`  cut off at the edge: ${uniq(report.cut).slice(0,6).join(', ')}`);
    if(report.stacked.length)  lines.push(`  overlapping bars: ${uniq(report.stacked).join(', ')}`);
    const tiny=uniq(report.tiny), small=uniq(report.small);
    if(tiny.length)  lines.push(`  tap targets under 38px (${tiny.length}): ${tiny.slice(0,5).join(' · ')}`);
    if(small.length) lines.push(`  text under 12px (${small.length}): ${small.slice(0,5).join(' · ')}`);
    if(errs.length)  lines.push(`  JS errors: ${errs.slice(0,2).join(' | ')}`);

    const bad=report.overflow.length||report.cut.length||report.stacked.length||errs.length;
    console.log(`${bad?'\x1b[31m✗\x1b[0m':'\x1b[32m✓\x1b[0m'} ${d.n} ${d.w}x${d.h}`);
    lines.forEach(l=>console.log(l));
    if(!lines.length) console.log('  clean');
    if(bad) problems++;
    await p.close();
  }
  await b.close();
  console.log(problems?`\n\x1b[31m${problems} device(s) with blocking issues\x1b[0m\n`:'\n\x1b[32mNo blocking issues on any device\x1b[0m\n');
  process.exit(problems?1:0);
})();
