const admin=require('firebase-admin'),fs=require('fs'),path=require('path');
admin.initializeApp({credential:admin.credential.cert(JSON.parse(fs.readFileSync(path.join(process.env.HOME,'.secrets/stats-firebase-admin.json'),'utf8')))});
const db=admin.firestore(), N='gn12-2026-08-17-dal-gs';
const t=()=>new Date().toLocaleTimeString('en-US',{timeZone:'America/Los_Angeles',hour12:true});
(async()=>{
  for(let i=0;i<40;i++){
    const v=(await db.doc('nights/'+N+'/rounds/r3').get()).data()||{};
    if(v.state==='scored'){
      const ps=await db.collection('nights/'+N+'/players').get();
      console.log(t()+'  Q4 SCORED. key='+JSON.stringify(v.key));
      ps.forEach(p=>{const d=p.data();console.log('   '+(d.name||'?').padEnd(10)+' pts='+d.pts+' rounds='+d.roundsDone+' speed='+d.speed+' pred='+d.predPts+' caught='+d.caughtPts);});
      process.exit(0);
    }
    if(i%4===0) console.log(t()+'  r3 still '+v.state);
    await new Promise(r=>setTimeout(r,20000));
  }
  console.log(t()+'  !! Q4 NEVER CLOSED — up to 160 pts per player uncounted. Needs a human key.');
  process.exit(3);
})().catch(e=>{console.log(e.message);process.exit(9);});
