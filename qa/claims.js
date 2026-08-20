#!/usr/bin/env node
/* =====================================================================
   EVERY "IT IS DONE" IS A CLAIM. THIS CHECKS THE CLAIMS.
   ---------------------------------------------------------------------
   WHY THIS FILE EXISTS, in the founder's words: "we say something is done
   and live and it is not. That needs to stop."

   The specific failure, 19 Aug 2026. Spanish was reported as live. The
   question bank WAS translated, the voice WAS translated, the unit checks
   were green — and the founder opened statsgametime.com/?lang=es, saw an
   entirely English home screen, and said so. Both things were true. The
   report was still wrong, and the reason is precise:

       THE THING THAT WAS BUILT WAS VERIFIED.
       THE THING A PERSON WOULD EXPERIENCE WAS NOT.

   qa/*.js prove the CODE does what the code intends. Nothing proved the
   SENTENCE. So every claim gets written down here as a sentence a human
   would say, with a check that answers it the way a human would answer
   it — by opening the real site and looking.

   THREE RULES THIS FILE ENFORCES ON ITSELF.
     1. It checks PRODUCTION by default, because "deployed" is a claim
        about production and nothing else. --local checks the candidate,
        and says so loudly in the output.
     2. A check that cannot run reports UNVERIFIABLE, never PASS. "I could
        not check" and "I checked and it is fine" are different sentences.
     3. Each claim is phrased as the sentence that would be SAID to the
        founder. If the check passes but the sentence would still mislead
        him, the sentence is wrong and belongs rewritten here.

   ONE MORE RULE, LEARNED THE EXPENSIVE WAY ON 19 AUG.
   EVERY RUN AGAINST PRODUCTION CREATES A NEW ANONYMOUS FIREBASE ACCOUNT,
   and Firebase rate-limits anonymous sign-ups PER IP. Fifty-odd headless
   browsers against the live site in one morning produced

       400 TOO_MANY_ATTEMPTS_TRY_LATER   (identitytoolkit accounts:signUp)

   and from then on roughly one load in three never got past auth: boot
   stopped before Firestore existed, so the game rail was empty because
   NOTHING had loaded. That looked exactly like an iPhone bug — WebKit
   failing where Chromium passed — and very nearly got a Firestore
   transport change shipped on a game day to fix the wrong layer.

   Worse, the limit is on the IP, and the founder tests from the same
   network. Load-testing production can degrade HIS testing.

   So: run this suite when a claim needs checking, not in a loop. Drive
   the LOCAL file for anything iterative — it needs no account. If a
   production check ever reports strange auth failures, suspect this
   before suspecting the product.

       node qa/claims.js              # against https://statsgametime.com
       node qa/claims.js --local      # against index.html on disk
       node qa/claims.js --json       # machine-readable
   ================================================================== */
const {chromium}=require('playwright');
const path=require('path'), fs=require('fs');

const LOCAL=process.argv.includes('--local');
const JSONOUT=process.argv.includes('--json');
const SITE='https://statsgametime.com/';
const FILE='file://'+path.resolve(__dirname,'..','index.html');
const BASE=LOCAL?FILE:SITE;

const results=[];
const claim=(id,sentence,fn)=>results.push({id,sentence,fn});

/* ---------------------------------------------------------------------
   THE CLAIMS. Each is a sentence somebody would put in a report.
   ------------------------------------------------------------------ */

claim('deploy.build-matches-disk',
  'the build on the live site is the build in this working copy',
  async ({page})=>{
    if(LOCAL) return {state:'UNVERIFIABLE', detail:'--local cannot compare against production'};
    const live=await page.evaluate(()=>window.STATS_BUILD);
    const disk=(fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8')
                  .match(/const STATS_BUILD='([^']+)'/)||[])[1];
    return {state: live===disk?'VERIFIED':'FALSE', detail:`live ${live} · disk ${disk}`};
  });

claim('es.a-person-sees-spanish',
  'a player who switches to Spanish sees a Spanish INTERFACE, not just Spanish questions',
  async ({page})=>{
    /* THE CHECK THAT WOULD HAVE CAUGHT THE 19 AUG CLAIM. Read the home
       screen the way a person reads it — the visible text — after asking
       for Spanish the way a person asks for it. */
    await page.evaluate(()=>{ try{ VX.setLang('es'); if(window.applyLang) applyLang(); }catch(_){} });
    await page.waitForTimeout(900);
    const txt=await page.evaluate(()=>(document.getElementById('app')||document.body).innerText);
    const es=/premia prestar atenci|qu. partido est.s viendo|Pru.balo ahora/i.test(txt);
    const en=/pays to pay attention|which game are you watching/i.test(txt);
    return {state: (es&&!en)?'VERIFIED':'FALSE',
            detail: es? (en?'both languages on screen at once':'Spanish confirmed')
                      : 'the home screen is still English after switching — this is the exact 19 Aug failure'};
  });

claim('es.the-switch-is-findable',
  'a player can find the language switch without being told a URL',
  async ({page})=>{
    const found=await page.evaluate(()=>{
      try{ openMenu(); }catch(_){ return {err:'no menu'} }
      const rows=[...document.querySelectorAll('#menuSheet [data-m]')];
      const r=rows.find(b=>b.getAttribute('data-m')==='lang');
      return { has:!!r, label:r?r.textContent.trim():'', rows:rows.length };
    });
    if(found.err) return {state:'UNVERIFIABLE', detail:found.err};
    return {state: found.has?'VERIFIED':'FALSE',
            detail: found.has?`menu row: "${found.label}"`:`no language row among ${found.rows} menu rows — the only way in is a ?lang= URL`};
  });

claim('es.questions-are-spanish',
  'the questions themselves are in Spanish, not only the interface',
  async ({page})=>{
    const q=await page.evaluate(()=>{
      try{ VX.setLang('es'); }catch(_){}
      const qq=(typeof rounds!=='undefined' && rounds[0] && rounds[0].q && rounds[0].q[0]);
      if(!qq) return null;
      return { t:qText(qq), o:qOptsFor(qq) };
    });
    if(!q) return {state:'UNVERIFIABLE', detail:'no question bank loaded on this screen'};
    const spanish=/[¿áéíóúñ]/i.test(q.t);
    return {state: spanish?'VERIFIED':'FALSE', detail:`"${String(q.t).slice(0,60)}"`};
  });

claim('es.english-is-unharmed',
  'switching to Spanish and back leaves the English exactly as it was',
  async ({page})=>{
    const r=await page.evaluate(async()=>{
      try{ VX.setLang('en'); if(window.applyLang) applyLang(); }catch(_){}
      await new Promise(r=>setTimeout(r,600));
      /* STRIP THE THINGS THAT MOVE ON THEIR OWN. The countdown ticks every
         second ("TIPS IN 13:56:16"), so comparing raw innerText across two
         seconds ALWAYS differs and the check would report a translation bug
         on every run forever. A verifier that cries wolf is worse than no
         verifier — people stop reading it, which is the disease this whole
         file was written to cure. */
      const stable=(t)=>String(t).replace(/\d/g,'#');
      const before=stable((document.getElementById('app')||document.body).innerText);
      try{ VX.setLang('es'); if(window.applyLang) applyLang(); }catch(_){}
      await new Promise(r=>setTimeout(r,600));
      try{ VX.setLang('en'); if(window.applyLang) applyLang(); }catch(_){}
      await new Promise(r=>setTimeout(r,900));
      const after=stable((document.getElementById('app')||document.body).innerText);
      return {same: before===after, beforeLen:before.length, afterLen:after.length};
    });
    return {state: r.same?'VERIFIED':'FALSE',
            detail: r.same?'byte-identical round trip':`text changed (${r.beforeLen} -> ${r.afterLen}) — an English player who tried Spanish cannot get back`};
  });

claim('payoff.is-not-the-smallest-thing',
  'when a player gets one right, the payoff is the biggest thing on the screen',
  async ({page})=>{
    const r=await page.evaluate(async()=>{
      try{ VX.setLang('en'); }catch(_){}
      S.mode='practice'; S.place='live' /* was 'play' — not a member of GAME_SCREENS, so this drove the app into a state production cannot reach */; S.qi=0; S.ni=0; S.answered=false; S.results=[[]];
      try{ go('gametime'); }catch(_){}
      document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
      const g=document.getElementById('s-gametime'); if(g) g.classList.add('active');
      const qp=document.getElementById('gtQuestion'); if(qp) qp.style.display='block';
      const gr=document.getElementById('gtReview'); if(gr) gr.style.display='none';
      const q=(typeof rounds!=='undefined')&&rounds[0]&&rounds[0].q&&rounds[0].q[0];
      if(!q) return {err:'no question'};
      const opts=document.getElementById('qOpts');
      opts.innerHTML=(q.o||[]).map(o=>`<button class="opt" data-l="${o}"><span>${o}</span><span class="mk"></span></button>`).join('');
      const btn=opts.querySelector('.opt[data-l="'+String(q.a).replace(/"/g,'\\"')+'"]')||opts.querySelector('.opt');
      try{ answer(q.a, btn); }catch(e){ return {err:'answer threw '+e.message}; }
      await new Promise(r=>setTimeout(r,300));
      const box=document.getElementById('revealBox');
      const px=el=>el?parseFloat(getComputedStyle(el).fontSize):0;
      const big=Math.max(0,...[...box.querySelectorAll('.payoff .pn')].map(px));
      const rest=Math.max(0,...[...box.querySelectorAll('.reveal *')]
        .filter(e=>!e.closest('.payoff')&&e.textContent.trim()&&!e.children.length).map(px));
      const t=document.getElementById('revNow');
      return {big, rest, onScreen: t? (t.getBoundingClientRect().bottom>0 && t.getBoundingClientRect().bottom<=window.innerHeight) : false};
    });
    if(r.err) return {state:'UNVERIFIABLE', detail:r.err};
    const ok = r.big>r.rest && r.big>=40 && r.onScreen;
    return {state: ok?'VERIFIED':'FALSE',
            detail:`payoff ${r.big}px vs ${r.rest}px, own total on screen: ${r.onScreen}`};
  });

claim('rail.offers-only-hosted-rooms',
  'every room offered on the rail has something hosting it',
  async ({page})=>{
    if(LOCAL) return {state:'UNVERIFIABLE', detail:'--local has no slate'};
    const rail=await page.evaluate(async()=>{
      for(let i=0;i<40 && !document.querySelector('#gameRail [data-slate]'); i++)
        await new Promise(r=>setTimeout(r,250));
      return [...document.querySelectorAll('#gameRail [data-slate]')].map(x=>x.getAttribute('data-slate'));
    });
    if(!rail.length) return {state:'UNVERIFIABLE', detail:'the rail did not load'};
    /* ============ THIS CHECK USED TO RETURN VERIFIED, ALWAYS ==========
       It read RUN_LEAGUES, printed it, and returned VERIFIED with no
       condition attached. The comment above it said "everything offered
       must be a league the launcher actually runs, or the flagship" and
       the code compared nothing at all — so the one claim standing between
       a player and a room nobody is hosting could not fail. Found 20 Aug
       2026 while asking whether tonight's two rooms were covered; a
       neighbouring check said they were not, and this one could not
       disagree because it could not do anything else.

       Now it does the comparison the comment describes. The pick file is
       the stronger authority when there is one — leagues.env turns a
       league ON, but the pick file is what says WHICH of that league's
       fifteen games are rooms tonight. */
    const env=fs.readFileSync(path.resolve(__dirname,'..','host','leagues.env'),'utf8');
    const run=((env.match(/^RUN_LEAGUES="([^"]*)"/m)||[])[1]||'').split(/\s+/).filter(Boolean);
    const today=new Date();
    const stamp=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
    const pickPath=path.join(process.env.HOME||'','gamenight-logs','slate-pick-'+stamp+'.txt');
    let picked=null;
    try{ picked=fs.readFileSync(pickPath,'utf8').split(/\r?\n/).map(x=>x.trim()).filter(Boolean); }catch(_){}

    const unpicked = picked ? rail.filter(id=>picked.indexOf(id)<0) : [];
    /* the league is the 4th dash-field of a slate id: slate-YYYY-MM-DD-away-home
       carries no league, so fall back to the pick file as the only authority. */
    if(picked && unpicked.length){
      return {state:'FALSE',
        detail:`offered but NOT in tonight's pick file, so nothing starts them: ${unpicked.join(', ')} · pick=${pickPath}`};
    }
    if(!picked){
      return {state:'UNVERIFIABLE',
        detail:`no pick file at ${pickPath} — the rail offers ${rail.join(', ')} and RUN_LEAGUES="${run.join(' ')}" alone cannot say which of a league's games are rooms tonight`};
    }
    return {state:'VERIFIED',
      detail:`${rail.length} offered, all named in tonight's pick file · ${rail.join(', ')}`};
  });

claim('voice.spanish-recogniser-listens-in-spanish',
  'in Spanish the app both READS and LISTENS in Spanish, not Spanish words to an English ear',
  async ({page})=>{
    const r=await page.evaluate(()=>{
      try{
        VX.setLang('es');
        const tag=VX.L().tag;
        const heard=VX.match('seis o mas', ['Ninguno o uno','Dos o tres','Cuatro o cinco','Seis o más']);
        VX.setLang('en');
        return {tag, heard: heard && heard.kind==='pick' ? heard.i : null};
      }catch(e){ return {err:e.message}; }
    });
    if(r.err) return {state:'UNVERIFIABLE', detail:r.err};
    const ok = /^es/i.test(r.tag||'') && r.heard===3;
    return {state: ok?'VERIFIED':'FALSE', detail:`recogniser tag ${r.tag}, heard "seis o mas" -> option ${r.heard}`};
  });

/* =====================================================================
   CLAIMS ABOUT TONIGHT — checked against FIRESTORE, not against the
   script that writes to it.
   ---------------------------------------------------------------------
   "We are ready for tonight" is the sentence said most often and verified
   least. It is four separate claims wearing one coat, and each one has
   been false at least once:
     · the rooms on the rail have a published plan  (GN9: zero rounds)
     · every question in it can be resolved         (B11: no resolvers)
     · nothing is offered that nobody hosts         (18 Aug: 15 mute rooms)
     · the runner is actually scheduled             (18 Aug: cron never ran)
   ================================================================== */
async function tonightClaims(){
  const out=[];
  const SA=process.env.FIREBASE_SERVICE_ACCOUNT;
  const push=(id,sentence,state,detail)=>out.push({id,sentence,state,detail});
  if(!SA){
    push('night.plans','every room offered tonight has a full, resolvable question plan',
         'UNVERIFIABLE','FIREBASE_SERVICE_ACCOUNT not set — export it to check tonight');
    return out;
  }
  let admin;
  try{ admin=require('firebase-admin'); }
  catch(e){ push('night.plans','every room offered tonight has a full, resolvable question plan',
                 'UNVERIFIABLE','firebase-admin not available: '+e.message); return out; }
  try{
    if(!admin.apps.length) admin.initializeApp({credential:admin.credential.cert(JSON.parse(SA))});
    const db=admin.firestore();
    const cur=await db.doc('slate/current').get();
    if(!cur.exists){ push('night.slate','the app knows which date tonight is','FALSE','slate/current is missing'); return out; }
    const date=cur.data().date;
    push('night.slate','the app knows which date tonight is','VERIFIED','slate/current -> '+date);

    const sl=await db.doc('slate/'+date).get();
    const games=(sl.exists?sl.data().games:[])||[];
    push('night.rail','the rail offers a sensible number of rooms, not every game in the league',
         games.length>0 && games.length<=6 ? 'VERIFIED':'FALSE',
         games.length+' offered: '+games.map(g=>(g.flagship?'★':'')+g.nightId).join(', '));

    const problems=[];
    for(const g of games){
      const plan=await db.doc(`nights/${g.nightId}/plan/rounds`).get();
      if(!plan.exists){ problems.push(g.nightId+': NO PLAN AT ALL'); continue; }
      const rs=plan.data().rounds||[];
      let qs=0, noR=0, es=0;
      rs.forEach(r=>(r.qs||[]).forEach(q=>{ qs++; if(!q.r) noR++; if(q.t_es) es++; }));
      if(!rs.length) problems.push(g.nightId+': plan has ZERO rounds');
      else if(!qs)   problems.push(g.nightId+': rounds but no questions');
      else if(noR)   problems.push(g.nightId+': '+noR+' question(s) with NO RESOLVER');
      else           problems.push(null, g.nightId+': '+rs.length+' rounds, '+qs+' questions, '+es+' Spanish');
    }
    const real=problems.filter(x=>x && !/rounds, /.test(x));
    const good=problems.filter(x=>x && /rounds, /.test(x));
    push('night.plans','every room offered tonight has a full, resolvable question plan',
         real.length?'FALSE':'VERIFIED', real.length? real.join(' · ') : good.join(' · '));

    /* NO DECOY CONFIGS. 19 Aug: schedule/gn12-2026-08-19-min-gs held
       TONIGHT'S game — right teams, right ESPN event, right tip — under
       LAST night's name, with zero rounds. Nothing referenced it, so
       nothing broke. But one write of schedule/current, or one rail entry
       carrying that id, and every phone hydrates the decoy and files its
       players, submissions and telemetry there while the runner hosts the
       real room. The room looks completely normal and never opens a round
       — the worst failure this product has, sitting one config write away.
       A config for tonight's DATE that is on nobody's rail is that shape. */
    /* NARROW, ON PURPOSE. A config for tonight's date that is simply NOT on
       the rail is normal and deliberate — build wide, host narrow, so the
       backtest keeps getting data from games nobody plays. The dangerous
       shape is a SECOND config for a game that IS being hosted: same ESPN
       event, different room id. That is the one a stray pointer can send a
       whole room into while the runner hosts the real one. */
    const offered=new Map(games.map(g=>[g.nightId, String(g.espnEvent||'')]));
    const liveEvents=new Map();
    offered.forEach((ev,id)=>{ if(ev) liveEvents.set(ev,id); });
    const ids=(await db.collection('schedule').listDocuments()).map(d=>d.id);
    const mine=ids.filter(id=>id.indexOf(date)>=0 && !offered.has(id));
    const decoys=[];
    for(const id of mine){
      const c=await db.doc('schedule/'+id).get();
      const ev=String((((c.data()||{}).game)||{}).espnEvent||'');
      if(ev && liveEvents.has(ev)) decoys.push(id+' duplicates '+liveEvents.get(ev)+' (event '+ev+')');
    }
    push('night.no-decoys','no second config exists for a game that is actually being hosted',
         decoys.length? 'FALSE':'VERIFIED',
         decoys.length? decoys.join(' · ')
                      : mine.length+' built-not-hosted config(s) for '+date+' — none duplicates a hosted room');
  }catch(e){
    push('night.plans','every room offered tonight has a full, resolvable question plan',
         'UNVERIFIABLE','Firestore read failed: '+e.message);
  }
  return out;
}

/* Is the runner actually scheduled? A plan nobody hosts is GN9 again. */
function cronClaims(){
  const {execSync}=require('child_process');
  try{
    const c=execSync('crontab -l',{encoding:'utf8'});
    const lines=c.split('\n').filter(l=>l.trim() && !l.trim().startsWith('#'));
    const night=lines.filter(l=>/cron-start-night\.sh/.test(l));
    const watch=lines.filter(l=>/watch-start\.sh/.test(l));
    const slate=lines.filter(l=>/start-slate\.sh/.test(l));
    const today=new Date();
    const d=today.getDate(), mo=today.getMonth()+1;
    const dueTonight=night.filter(l=>{
      const f=l.trim().split(/\s+/); return Number(f[2])===d && Number(f[3])===mo;
    });
    /* ============ THERE ARE TWO WAYS A ROOM GETS HOSTED ===============
       This demanded exactly ONE cron-start-night.sh line dated today, and
       reported FALSE otherwise. That was true while every night was a
       hand-written flagship with its own cron line. It stopped being true
       when the Game of the Night became a SLATE room: tonight's two rooms
       (Nationals @ Rangers, 49ers @ Chargers) are both slate rooms, hosted
       by start-slate.sh reading the pick file every thirty minutes, and
       there is no night cron line for either — correctly.

       So on 20 Aug this check called a correctly-configured night FALSE.
       A check that cries wolf on a good night is worse than no check: the
       next person reads red and shrugs.

       The claim is "something will host tonight's rooms", and there are
       two honest ways to satisfy it. */
    const today2=new Date();
    const stamp=today2.getFullYear()+'-'+String(today2.getMonth()+1).padStart(2,'0')+'-'+String(today2.getDate()).padStart(2,'0');
    const pickPath=path.join(process.env.HOME||'','gamenight-logs','slate-pick-'+stamp+'.txt');
    let picked=null;
    try{ picked=fs.readFileSync(pickPath,'utf8').split(/\r?\n/).map(x=>x.trim()).filter(Boolean); }catch(_){}
    const slateRuns=slate.filter(l=>!/--build/.test(l)).length>0;
    const viaSlate = !!(picked && picked.length && slateRuns);
    const viaCron  = dueTonight.length===1;
    return [
      {id:'cron.runner', sentence:'a runner is scheduled to host tonight',
       state: (viaSlate||viaCron)?'VERIFIED':'FALSE',
       detail: viaSlate
         ? `${picked.length} room(s) in tonight's pick file + a start-slate run line: ${picked.join(', ')}`
         : viaCron
           ? dueTonight.map(l=>l.trim().split(/\s+/).slice(0,5).join(' ')+' …').join(' · ')
           : `nothing will host tonight — no cron-start-night.sh line for ${mo}/${d}, and ` +
             (picked ? 'the pick file names no rooms' : 'no pick file at '+pickPath) +
             (slateRuns ? '' : ', and no start-slate.sh run line in cron')},
      {id:'cron.watchdog', sentence:'the watchdog is scheduled', 
       state: watch.length?'VERIFIED':'FALSE', detail: watch.length+' watch line(s)'},
      {id:'cron.slate', sentence:'the slate builds and starts on its own each day',
       state: slate.length>=2?'VERIFIED':'FALSE', detail: slate.length+' start-slate line(s) (build + run)'}
    ];
  }catch(e){ return [{id:'cron.runner', sentence:'a runner is scheduled to host tonight',
                      state:'UNVERIFIABLE', detail:'crontab unreadable: '+e.message}]; }
}

/* ------------------------------------------------------------------ */
(async()=>{
  const b=await chromium.launch();
  const page=await b.newPage({viewport:{width:390,height:844}});
  const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,120)));
  await page.goto(BASE+(LOCAL?'':'?cb='+Date.now()),{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof window.VX!=='undefined',{timeout:20000}).catch(()=>{});
  await page.waitForTimeout(4000);

  const out=[];
  for(const c of results){
    let r;
    try{ r=await c.fn({page}); }
    catch(e){ r={state:'UNVERIFIABLE', detail:'check threw: '+e.message}; }
    out.push({id:c.id, sentence:c.sentence, ...r});
  }
  await b.close();

  /* The browser is closed; these read Firestore and the crontab. */
  if(!LOCAL){
    try{ out.push(...cronClaims()); }catch(_){}
    try{ out.push(...(await tonightClaims())); }catch(_){}
  }

  if(JSONOUT){ console.log(JSON.stringify({target:BASE, claims:out},null,2)); }
  else{
    console.log('\nCLAIMS CHECKED AGAINST '+(LOCAL?'THE LOCAL FILE (not production)':'PRODUCTION')+'\n'+BASE+'\n');
    out.forEach(r=>{
      const mark = r.state==='VERIFIED'?'  ✓ ' : r.state==='FALSE'?'  ✗ ' : '  ? ';
      console.log(mark+r.state.padEnd(12)+r.sentence);
      if(r.detail) console.log('                 '+r.detail);
    });
    const f=out.filter(r=>r.state==='FALSE').length, u=out.filter(r=>r.state==='UNVERIFIABLE').length;
    console.log('\n'+'-'.repeat(62));
    if(f) console.log(`${f} CLAIM(S) ARE FALSE — do not say these are done`);
    else if(u) console.log(`no false claims · ${u} could not be checked (which is not the same as fine)`);
    else console.log('every claim verified against '+(LOCAL?'the local file':'production'));
  }
  process.exit(out.some(r=>r.state==='FALSE')?1:0);
})();
