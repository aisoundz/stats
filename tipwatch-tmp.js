/* Watches the one transition that matters right now: the feed flipping to
   in-progress, and the runner writing the score card behind it. Exits the
   moment the score lands (good) or if the game is demonstrably live and the
   score is STILL missing 4 minutes later (that would be a real bug). */
const admin=require('firebase-admin'),fs=require('fs'),path=require('path');
admin.initializeApp({credential:admin.credential.cert(JSON.parse(
  fs.readFileSync(path.join(process.env.HOME,'.secrets/stats-firebase-admin.json'),'utf8')))});
const db=admin.firestore(), N='gn12-2026-08-17-dal-gs', EV='401857151';
const t=()=>new Date().toLocaleTimeString('en-US',{timeZone:'America/Los_Angeles',hour12:true});
let liveSince=null;
(async()=>{
  for(let i=0;i<200;i++){
    let st=null;
    try{
      const j=await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${EV}`)).json();
      st=j.header.competitions[0].status;
    }catch(_){}
    const n=(await db.doc('nights/'+N).get()).data()||{};
    const sc=n.score||null;
    const live = st && st.type.name==='STATUS_IN_PROGRESS';
    if(live && !liveSince) liveSince=Date.now();
    if(sc){
      console.log(t()+'  SCORE IS UP: '+JSON.stringify(sc)+'  (feed '+(st?st.type.name:'?')+')');
      process.exit(0);
    }
    if(live && liveSince && Date.now()-liveSince > 4*60*1000){
      console.log(t()+'  !! GAME IS LIVE AND NO SCORE CARD AFTER 4 MIN — real bug. feed period '+st.period+' clock '+st.displayClock);
      process.exit(3);
    }
    if(i%4===0) console.log(t()+'  feed='+(st?st.type.name.replace('STATUS_',''):'?')+' score='+(sc?'yes':'none'));
    await new Promise(r=>setTimeout(r,30000));
  }
  console.log(t()+'  tip watch timed out after 100 min');
})().catch(e=>{console.log('tipwatch crashed: '+e.message);process.exit(9);});
