const {webkit,devices}=require('playwright');
(async()=>{const b=await webkit.launch(); const res=[];
 for(let i=1;i<=8;i++){
  const c=await b.newContext({...devices['iPhone 13'],hasTouch:true});
  const p=await c.newPage();
  await p.goto('https://statsgametime.com/?cb='+Date.now());
  await p.waitForTimeout(2200 + (i%4)*900);
  const st=await p.evaluate(()=>({night:(window.GAME||{}).nightId,
    tiles:[...document.querySelectorAll('#gameRail [data-slate]')].map(e=>e.getAttribute('data-slate'))}));
  if(st.tiles.length<2){ await c.close(); continue; }
  const other=st.tiles.find(t=>t!==st.night);
  const t0=Date.now();
  try{ await p.tap(`[data-slate="${other}"]`,{timeout:5000}); }catch(e){}
  let ms=null;
  for(let k=0;k<200;k++){                       // 20 SECONDS of patience
    const n=await p.evaluate(()=>(window.GAME||{}).nightId);
    if(n===other){ ms=Date.now()-t0; break; } await p.waitForTimeout(100); }
  res.push(ms);
  console.log(`player ${i}: ${ms!==null?ms+'ms':'never, even after 20s'}`);
  await c.close();
 }
 const got=res.filter(x=>x!==null).sort((a,b)=>a-b);
 console.log(`\n${got.length}/${res.length} eventually switched · median ${got[Math.floor(got.length/2)]}ms · slowest ${got[got.length-1]}ms`);
 await b.close();})();
