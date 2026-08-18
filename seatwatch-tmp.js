/* Waits for the third seat. Exits the moment it appears (confirm), or after
   6 minutes still missing (then it is the join failing, not the player). */
const admin=require('firebase-admin'),fs=require('fs'),path=require('path');
admin.initializeApp({credential:admin.credential.cert(JSON.parse(
  fs.readFileSync(path.join(process.env.HOME,'.secrets/stats-firebase-admin.json'),'utf8')))});
const db=admin.firestore(), N='gn12-2026-08-17-dal-gs', WANT='3yaTpCkRi8VD';
const t=()=>new Date().toLocaleTimeString('en-US',{timeZone:'America/Los_Angeles',hour12:true});
(async()=>{
  for(let i=0;i<24;i++){
    const ps=await db.collection('nights/'+N+'/players').get();
    const hit=ps.docs.find(d=>d.id.startsWith(WANT));
    const er=await db.collection('nights/'+N+'/errors').get();
    if(hit){
      const v=hit.data();
      console.log(t()+'  THIRD SEAT IS IN: "'+(v.name||'?')+'" — the join landed. '+ps.size+' in the room.');
      process.exit(0);
    }
    if(er.size){
      console.log(t()+'  !! '+er.size+' player error(s) logged while the seat was missing:');
      er.forEach(d=>console.log('     '+JSON.stringify(d.data()).slice(0,200)));
      process.exit(4);
    }
    if(i%3===0) console.log(t()+'  seats='+ps.size+' ('+ps.docs.map(d=>d.data().name||'?').join(', ')+') third seat still missing');
    await new Promise(r=>setTimeout(r,15000));
  }
  console.log(t()+'  !! SIX MINUTES AND NO THIRD SEAT. If that phone pressed Play Game Night, the join is failing — B31 again, and it needs looking at tonight.');
  process.exit(3);
})().catch(e=>{console.log('seatwatch: '+e.message);process.exit(9);});
