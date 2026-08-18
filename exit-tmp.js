/* The runner should walk away once the last quarter is scored. A process
   that lingers holds a lease, and a stale lease is Wednesday's problem. */
const { execSync } = require('child_process');
const t=()=>new Date().toLocaleTimeString('en-US',{timeZone:'America/Los_Angeles',hour12:true});
const alive=()=>{ try{ execSync('pgrep -f "host/run.js"',{stdio:'ignore'}); return true; }catch(_){ return false; } };
(async()=>{
  for(let i=0;i<30;i++){
    if(!alive()){ console.log(t()+'  runner exited cleanly. Lease released, night finished.'); process.exit(0); }
    if(i%5===0) console.log(t()+'  runner still up');
    await new Promise(r=>setTimeout(r,20000));
  }
  console.log(t()+'  !! RUNNER STILL UP 10 MIN AFTER THE LAST QUARTER SCORED. It should have exited. Check before Wednesday — a held lease can stop the next night starting.');
  process.exit(3);
})();
