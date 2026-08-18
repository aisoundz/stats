/* GAME NIGHT WATCHDOG — quiet unless something is wrong.
   Polls the night every 45s. Exits (which notifies the session) only on a
   real event: the runner going silent, a round that needs a human, a player
   error landing, or the final buzzer. Everything else is written to the log
   so status can be read without interrupting anybody. */
const admin=require('firebase-admin'),fs=require('fs'),path=require('path');
admin.initializeApp({credential:admin.credential.cert(JSON.parse(
  fs.readFileSync(path.join(process.env.HOME,'.secrets/stats-firebase-admin.json'),'utf8')))});
const db=admin.firestore(), N='gn12-2026-08-17-dal-gs', EV='401857151';
const t=()=>new Date().toLocaleTimeString('en-US',{timeZone:'America/Los_Angeles',hour12:true});
const out=(s)=>{ console.log(t()+'  '+s); };
let softFails=0, lastSig='', reportedErr=0, quietSince=Date.now();

async function feedState(){
  try{
    const r=await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${EV}`);
    const j=await r.json(); const st=j.header.competitions[0].status;
    return {name:st.type.name, period:st.period, clock:st.displayClock, done:!!st.type.completed};
  }catch(_){ return null; }
}
(async()=>{
  const started=Date.now();
  for(;;){
    if(Date.now()-started > 3.6*3600*1000){ out('WATCHDOG: 3h36m elapsed, standing down.'); process.exit(0); }
    let n=null, rounds=[], errs=0;
    try{
      n=(await db.doc('nights/'+N).get()).data()||{};
      const rs=await db.collection('nights/'+N+'/rounds').get();
      rounds=rs.docs.map(d=>({id:d.id, ...d.data()}));
      errs=(await db.collection('nights/'+N+'/errors').get()).size;
      softFails=0;
    }catch(e){
      softFails++;
      out('read failed ('+softFails+'/4): '+e.message);
      if(softFails>=4){ out('!! WATCHDOG CANNOT READ FIRESTORE after 4 tries — investigate.'); process.exit(2); }
      await new Promise(r=>setTimeout(r,45000)); continue;
    }
    const at=(n.host&&n.host.at&&n.host.at.toMillis)?n.host.at.toMillis():0;
    const age=at?Math.round((Date.now()-at)/1000):null;
    const f=await feedState();
    const sig=JSON.stringify([rounds.map(r=>r.id+':'+r.state), errs, f&&f.period, f&&f.name]);
    if(sig!==lastSig){
      out(`heartbeat ${age==null?'never':age+'s'} | ${f?f.name.replace('STATUS_','')+' P'+f.period+' '+(f.clock||''):'feed?'} | rounds ${rounds.length?rounds.map(r=>r.id+'='+r.state).join(' '):'none'} | errors ${errs}`);
      lastSig=sig; quietSince=Date.now();
    }
    // ---- the four things worth interrupting a game for ----
    if(age!==null && age>110){
      out('!! RUNNER SILENT for '+age+'s — it has stopped writing. Rounds will not open by themselves.');
      process.exit(3);
    }
    const need=rounds.filter(r=>r.needsHuman);
    if(need.length){
      out('!! NEEDS A HUMAN: '+need.map(r=>(r.tag||r.id)+' — '+r.needsHuman).join(' | '));
      process.exit(4);
    }
    if(errs>reportedErr){
      out('!! PLAYER ERRORS LOGGED: '+errs+' (was '+reportedErr+') — somebody is hitting something.');
      process.exit(5);
    }
    if(f && f.done){
      out('FINAL BUZZER. rounds: '+rounds.map(r=>r.id+'='+r.state).join(' '));
      process.exit(0);
    }
    await new Promise(r=>setTimeout(r,45000));
  }
})().catch(e=>{ out('watchdog crashed: '+e.message); process.exit(9); });
