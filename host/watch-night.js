#!/usr/bin/env node
/* =====================================================================
   WATCH THE NIGHT — every room at once, one line a minute.
   ---------------------------------------------------------------------
   GN13 is the first night this product has ever run more than one room,
   and the failures that matter are the quiet ones: a runner that stopped
   beating, a round that opened and never closed, a score that stopped
   moving while the game did not. None of those throw anything.

   So this samples every room on tonight's slate — flagship included — and
   prints a line per room per tick, with an ALERT column that is empty
   almost always and is the only thing anybody has to read.

   READ-ONLY. It never writes to a night. Watching a room must not be able
   to change it.

     node host/watch-night.js                 # tonight, until the games end
     node host/watch-night.js --date 2026-08-19 --every 60
   ================================================================== */
const admin=require('firebase-admin');
const ARG=(k,d)=>{const i=process.argv.indexOf('--'+k); return i>=0?process.argv[i+1]:d;};
const EVERY=Number(ARG('every',60))*1000;
const DATE=ARG('date', new Date().toLocaleDateString('en-CA'));
const raw=process.env.FIREBASE_SERVICE_ACCOUNT;
if(!raw){ console.error('FATAL: FIREBASE_SERVICE_ACCOUNT is not set'); process.exit(1); }
admin.initializeApp({credential:admin.credential.cert(JSON.parse(raw))});
const db=admin.firestore();
const now=()=>new Date().toLocaleTimeString('en-US',{hour12:false});
const age=(ts)=>{ try{ return Math.round((Date.now()-ts.toMillis())/1000); }catch(_){ return null; } };

async function rooms(){
  const s=await db.doc('slate/'+DATE).get();
  if(!s.exists) return [];
  return (s.data().games||[]).map(g=>({id:g.nightId, label:(g.away||'')+' @ '+(g.home||''), tip:g.tipISO, flagship:!!g.flagship}));
}

async function sample(r){
  const out={id:r.id, label:r.label, alerts:[]};
  const nd=await db.doc('nights/'+r.id).get();
  if(!nd.exists){
    out.state='not created';
    /* Before tip that is correct — the runner creates the room when it
       starts. After tip it means nothing is hosting this game. */
    if(r.tip && Date.parse(r.tip) < Date.now()-5*60000) out.alerts.push('NO ROOM 5m AFTER TIP');
    return out;
  }
  const d=nd.data()||{};
  const sc=d.score||{};
  out.state=sc.period||'—';
  out.score=(sc.away!=null?sc.away:'-')+'–'+(sc.home!=null?sc.home:'-');
  const beat = d.hostAt ? age(d.hostAt) : (sc.at ? age(sc.at) : null);
  out.beat=beat;
  /* The runner ticks every 20–30s. Two minutes of silence is a stopped
     machine, not a slow one. */
  if(beat!=null && beat>150) out.alerts.push('RUNNER SILENT '+beat+'s');

  const [pl, rd, er] = await Promise.all([
    db.collection(`nights/${r.id}/players`).count().get(),
    db.collection(`nights/${r.id}/rounds`).get(),
    db.collection(`nights/${r.id}/errors`).count().get().catch(()=>({data:()=>({count:0})}))
  ]);
  out.seats=pl.data().count;
  out.errors=er.data().count;
  if(out.errors) out.alerts.push(out.errors+' ERROR DOC(S)');

  let live=0, scored=0, subs=0, newest=0;
  rd.forEach(doc=>{ const v=doc.data()||{};
    const opened=v.openedAt&&v.openedAt.toMillis?v.openedAt.toMillis():0;
    if(opened>newest) newest=opened;
    if(v.state==='live'){ live++;
      /* A round answers for 150s then scores. Six minutes open is stuck. */
      if(opened && Date.now()-opened>360000) out.alerts.push(v.tag+' OPEN '+Math.round((Date.now()-opened)/60000)+'m');
    }
    if(v.state==='scored') scored++;
  });

  /* ============ ROUNDS THAT STOP ARRIVING ==========================
     Every alert above catches something BREAKING — a runner that stopped
     beating, a round stuck open, an error doc. None of them catch rounds
     that simply stop coming, and that is the whole risk on a nine-inning
     night: baseball went from three rounds to nine on 31 Aug 2026, so a
     room that quietly opens four and then nothing looks exactly like a
     room between innings.

     No feed read. The signal is the gap since the NEWEST round opened,
     against a runner that is still beating. Innings run about twenty
     minutes; 45 is long enough to sit through a pitching change, a replay
     review and a short delay without crying wolf — and a watcher that
     cries wolf teaches the person to stop reading it, which is the reason
     the Sunday guards stand down. */
  if(newest && beat!=null && beat<=150){
    const since=Math.round((Date.now()-newest)/60000);
    if(since>=45) out.alerts.push(`NO NEW ROUND IN ${since}m (${rd.size} so far) — rounds may have stalled`);
  }
  out.rounds=scored+'/'+rd.size+(live?' ('+live+' open)':'');
  /* Seats but no answers once a round has scored is the GN8 failure:
     mechanically perfect, nobody actually playing. */
  if(scored>0 && out.seats>0){
    /* 30 Aug 2026: this counted the FIRST scored round only and reported it as
       the room. The first Premier League room scored r0 with 0 answers and r1
       with 1 — a real player, handle set — and the watch log called the night
       empty. A proxy (round one) printed as the thing (the room).
       Sum every scored round, and only warn when the whole room is silent. */
    const scoredIds=rd.docs.filter(x=>(x.data()||{}).state==='scored').map(x=>x.id);
    const counts=await Promise.all(scoredIds.map(id=>
      db.collection(`nights/${r.id}/rounds/${id}/subs`).count().get()
        .then(c=>c.data().count).catch(()=>0)));
    subs=counts.reduce((a,b)=>a+b,0);
    if(subs===0) out.alerts.push(`SCORED WITH ZERO ANSWERS (all ${scoredIds.length} scored round(s))`);
    else if(counts[0]===0) out.alerts.push(`round 1 had no answers · ${subs} across the room`);
  }
  out.subs=subs;
  return out;
}

(async()=>{
  const rs=await rooms();
  if(!rs.length){ console.error('no slate for '+DATE); process.exit(1); }
  console.log(`\n  WATCHING ${rs.length} ROOM(S) · ${DATE} · sampling every ${EVERY/1000}s`);
  rs.forEach(r=>console.log(`    ${r.flagship?'★':' '} ${r.id}  ${r.label}`));
  console.log('');
  for(;;){
    for(const r of rs){
      let s; try{ s=await sample(r); }catch(e){ s={label:r.label, state:'READ FAILED', alerts:[e.message.slice(0,50)]}; }
      const line = `${now()}  ${String(s.label).padEnd(24).slice(0,24)} ${String(s.state).padEnd(16).slice(0,16)}`
        + ` ${String(s.score||'').padEnd(7)} seats ${String(s.seats??'-').padStart(2)}`
        + ` rounds ${String(s.rounds||'-').padEnd(11)} beat ${String(s.beat??'-').padStart(4)}s`;
      console.log(line + (s.alerts.length ? '   ⚠ ' + s.alerts.join(' · ') : ''));
    }
    await new Promise(r=>setTimeout(r, EVERY));
  }
})().catch(e=>{ console.error('FATAL', e.message); process.exit(1); });
