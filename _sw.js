const {chromium}=require('playwright');
const fs=require('fs'),path=require('path');
(async()=>{
  const b=await chromium.launch();
  const raw=JSON.parse(fs.readFileSync(path.join('references','multisport','wnba.json'),'utf8'));
  const p=await b.newPage({viewport:{width:393,height:852}});
  await p.goto('file://'+process.cwd()+'/index-test.html'); await p.waitForTimeout(1200);
  const r=await p.evaluate(async (j)=>{
    const rf=window.fetch; window.fetch=()=>Promise.resolve({json:()=>Promise.resolve(j)});
    try{ GS.ok=false; GS.at=0; GS.ev=''; await loadGameStats(true); }catch(e){}
    window.fetch=rf;
    window.famNow=()=>'basketball';
    S.mode='live'; try{ go('stats'); renderStats(); }catch(e){ return {err:e.message}; }
    await new Promise(r=>setTimeout(r,250));
    const w=(sel)=>{ const e=document.querySelector(sel); if(!e) return sel+': (missing)';
      const c=e.getBoundingClientRect(); const cs=getComputedStyle(e);
      return sel+': w='+Math.round(c.width)+' sw='+e.scrollWidth+' cw='+e.clientWidth+' disp='+cs.display; };
    return { chain:['#s-stats','#stBody','#stBody .stBars','#stBody .tbRow','#stBody .tbLbl','#stBody .tbVals'].map(w),
             active: (document.querySelector('.screen.active')||{}).id };
  }, raw);
  console.log('active screen:', r.active);
  (r.chain||[]).forEach(x=>console.log('   '+x));
  if(r.err) console.log('ERR', r.err);
  await b.close();
})();
