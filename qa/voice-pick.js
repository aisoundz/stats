#!/usr/bin/env node
/* =====================================================================
   VOICE ON THE PICK SHEET — the half of a player pick that was missing.
   ---------------------------------------------------------------------
   Found by the founder testing out loud, 18 Aug, in three messages:

     "it doesnt know how to say how many points. So it gets stuck."
     "It alos doesnt allow me to change the players name"
     "It also doesnt allow me to lock my card"

   All three were one screen and two bugs. "Who scores the most points" is
   TWO answers — a name and a number — and only the name was ever wired, so
   a number spoken into that card did NOTHING AT ALL. And "lock my card"
   fell through to a grammar rule that treats lock and next as one word,
   whose handler called V.deaf(): the card did not lock and the microphone
   went off, so everything said afterwards landed on a dead mic. That is
   what made the other two look broken.

   THE STUB IS THE TRANSPORT, NOT THE FEATURE. Every function under test
   here — heardPick, spokenNumber, setBonus, pickBonus — is the real one out
   of the real file. What is faked is the speech engine, exactly as
   qa/voice-wiring.js fakes it, and for the same reason: there is no way to
   make a headless browser hear a human.

     node qa/voice-pick.js [index-test.html]
   ================================================================== */
const {chromium}=require('playwright'); const path=require('path');
const { waitReady } = require('./ready.js');
const F=require('./fixtures.js');
const TARGET=path.resolve(process.argv[2]||path.join(__dirname,'..','index-test.html'));

let pass=0, fail=0; const bad=[];
const ok=(n,c,d)=>{ if(c) pass++; else { fail++; bad.push(n+(d?'  — '+d:'')); } };

(async()=>{
  const b=await chromium.launch();
  const p=await b.newPage({viewport:{width:393,height:852}});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.route('**/site.api.espn.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(F.PRE)}));
  await p.route('**/assets.mailerlite.com/**', r=>r.fulfill({status:200,body:'{}'}));
  await p.addInitScript(()=>{
    window.__said=[];
    const def=(k,v)=>Object.defineProperty(window,k,{configurable:true,writable:true,value:v});
    def('speechSynthesis',{ speak(u){ window.__said.push(u.text); setTimeout(()=>u.onend&&u.onend(),5); },
      cancel(){}, addEventListener(){},
      getVoices(){ return [{name:'Samantha',lang:'en-US',voiceURI:'v',localService:true}]; } });
    def('SpeechSynthesisUtterance', function(t){ this.text=t; });
    const R=function(){ window.__rec=this;
      this.start=function(){ window.__open=true; }; this.stop=function(){ window.__open=false; };
      this.abort=function(){ window.__open=false; };
      this.__speak=function(txt,final){
        const res=[{transcript:txt,confidence:.9}]; res.isFinal=!!final; res.length=1;
        if(this.onspeechstart && !final) this.onspeechstart();
        if(this.onresult) this.onresult({resultIndex:0,results:Object.assign([res],{length:1})});
      };
    };
    def('SpeechRecognition', R); def('webkitSpeechRecognition', R);
  });
  /* ?fixture=1 — hold the built-in night. Without it this suite reads
     TONIGHT'S live roster and fails at breakfast while passing at
     midnight, against identical bytes. See LOCK_FIXTURE in
     index.html. A gate whose answer depends on the hour is worse
     than a slow one. */
  await p.goto('file://'+TARGET+'?fixture=1');
  await p.waitForFunction(()=>typeof window.VX==='object'||typeof VX==='object',{timeout:15000}).catch(()=>{});
  await waitReady(p);   /* was await p.waitForTimeout(1800); — a guess at boot */

  /* WAIT FOR QUIET, DO NOT GUESS A DELAY. The app pauses the microphone
     while its own voice is in the room — correctly, or it answers itself —
     so a phrase fired on a fixed timer can land in that gap and be
     discarded. A fixed 420ms passed everywhere except after a spoken
     "Not yet", whose reply is on a 260ms timer, and reading THAT as a dead
     microphone is precisely the misdiagnosis the bug itself caused. */
  const quiet=async()=>{ try{
      await p.waitForFunction(()=>window.VX && !VX.speaking && VX.listening, {timeout:4000});
    }catch(_){ } };
  const say=async(t)=>{ await quiet();
    await p.evaluate((txt)=>{ window.__said=[];
      const r=window.__rec; if(r&&r.__speak){ r.__speak(txt,false); r.__speak(txt,true); } }, t);
    await p.waitForTimeout(420); };
  const st=async()=>p.evaluate(()=>{
      const c=document.getElementById('predCard');
      const nb=c&&c.querySelector('.pdbonus input');
      const on=c&&c.querySelector('.pdopt.on');
      return { q:((c&&c.querySelector('.pdq'))||{}).textContent||'',
        picked:(on&&on.getAttribute('data-pd'))||null, choices:S.predChoices,
        bonus: nb?nb.value:null, hasBonus:!!nb,
        said:(window.__said||[]).join(' | '), screen:S.screen, wantEar:VX.wantEar };
    });

  /* ---- 1. the parser, on its own ------------------------------------ */
  const nums=await p.evaluate(()=>{
    const cases=[['twenty three',23],['23',23],['twenty-three',23],['thirty',30],['eight',8],
                 ['zero',0],['none',0],['seventeen',17],['ninety nine',99],['23 points',23],
                 ['eight rebounds',8],['say twenty three',23],
                 ['Napheesa Collier',null],['',null],['she had about twenty three I think',null],
                 ['two hundred and six',null],['lock my card',null]];
    return cases.map(([t,want])=>[t,want,VX.spokenNumber(t)]);
  });
  nums.forEach(([t,want,got])=>ok(`vpick.number("${t}")`, got===want, `wanted ${want}, got ${got}`));

  /* ---- 2. the flow --------------------------------------------------- */
  await p.evaluate(async()=>{
    startDemo(); S.name='QA';
    try{ await loadGameStats(true); }catch(e){}
    startPredict(); await new Promise(r=>setTimeout(r,400));
    try{ VX.on=true; VX.wantEar=true; VX.mount(); VX.askPick(); }catch(e){}
  });
  await p.waitForTimeout(400);
  await say('next');
  let r=await st();
  ok('vpick.a-player-card-has-a-bonus-field', r.hasBonus===true, `q="${r.q}" bonus=${r.bonus}`);

  await say('Napheesa Collier'); r=await st();
  ok('vpick.a-name-is-picked', r.picked==='Napheesa Collier', `picked ${r.picked}`);
  /* THE ONE THE FOUNDER HIT. */
  ok('vpick.and-it-then-ASKS-for-the-number', /how many/i.test(r.said),
     `it said: ${r.said}`);

  await say('twenty three'); r=await st();
  ok('vpick.a-spoken-number-lands-in-the-field', r.bonus==='23', `field=${r.bonus}`);
  ok('vpick.the-number-reaches-the-card-state', r.choices.pts_num==='23',
     `predChoices=${JSON.stringify(r.choices)}`);
  ok('vpick.it-reads-the-number-back', /23/.test(r.said), r.said);

  await say('thirty'); r=await st();
  ok('vpick.the-number-can-be-changed', r.bonus==='30', `field=${r.bonus}`);

  await say('Olivia Miles'); r=await st();
  ok('vpick.the-name-can-be-changed', r.picked==='Olivia Miles', `picked ${r.picked}`);

  await say('qwertyuiop'); r=await st();
  /* SILENCE WAS THE BUG. On a phone, saying nothing back is exactly what a
     dead microphone looks like — and that is what it was taken for. */
  ok('vpick.nonsense-is-answered-not-ignored', r.said.length>0 && /did not catch/i.test(r.said), `said: "${r.said}"`);
  ok('vpick.nonsense-does-not-change-the-pick', r.picked==='Olivia Miles' && r.bonus==='30',
     `picked ${r.picked} / ${r.bonus}`);

  /* ---- 3. lock, incomplete ------------------------------------------- */
  await say('lock my card'); r=await st();
  ok('vpick.lock-with-gaps-says-what-is-missing', /not yet/i.test(r.said), `said: "${r.said}"`);
  ok('vpick.lock-with-gaps-does-not-lock', r.screen==='predict', `landed on ${r.screen}`);
  /* THE ONE THAT MADE EVERYTHING ELSE LOOK BROKEN — and the check for it
     had to be re-aimed, which is worth recording.

     The first version asserted V.wantEar was still true here. It passed
     even with V.deaf() put back, because clicking the lock button always
     causes a re-render and buildPred calls askPick(), which reopens the
     ear. The mic dying was never really about deaf() — it was that the old
     handler called predGo(1), and on the last card that does NOTHING: no
     re-render, no askPick, no reopen. So the load-bearing guard is
     "act on the lock button", which vpick.a-full-card-actually-locks
     covers, and this one asserts the guarantee a player would notice:
     after a failed lock the sheet is still listening.

     A failed lock JUMPS to the card that is missing, so the thing to say
     next is an answer to THAT card — the first draft of this check said a
     player's name at the winner card and read the (correct) "I did not
     catch that" as the mic being dead, which is the same misreading the
     bug itself caused. Answer the card you are actually on. */
  /* Let it finish talking first. The "Not yet" reply is spoken on a 260ms
     timer and the mic is deliberately paused while the app's own voice is
     in the room — so a phrase fired at 420ms is correctly discarded, and
     reading that as a dead mic would be the same mistake the bug caused. */
  const at=await st();
  const firstOpt=await p.evaluate(()=>{
    const o=document.querySelector('#predCard .pdopt'); return o?o.getAttribute('data-pd'):null;
  });
  await say(firstOpt||'yes');
  const alive=await st();
  /* ASSERT THE STATE, NOT THE CARD ON SCREEN. A pick with no bonus
     auto-advances, so by the time this reads the DOM the card showing is
     the NEXT one and its .pdopt.on is empty — which the first draft of
     this check read as "nothing was picked". Twice now on this screen a
     correct behaviour has been mistaken for a dead microphone; the fix
     both times is to look at what was RECORDED rather than what is lit. */
  const landed=Object.keys(alive.choices||{}).some(function(k){
    return alive.choices[k]===firstOpt; });
  ok('vpick.the-sheet-still-listens-after-a-failed-lock',
     landed===true,
     `jumped to "${at.q}", said "${firstOpt}", choices=${JSON.stringify(alive.choices)} — the mic must survive a lock that could not complete`);

  /* ---- 4. lock, complete --------------------------------------------- */
  const done=await p.evaluate(async()=>{
    /* fill every card by hand — this is about the LOCK, not the picking */
    const L=predOrderList();
    L.forEach(function(x){
      const o=(preds.find(q=>q.id===x.id)||{}).opts||[];
      if(o.length) predPick(x.id, o[0]);
    });
    await new Promise(r=>setTimeout(r,300));
    const lk=document.getElementById('pdLock');
    return { label:(lk||{}).textContent||null, ready:!!(lk&&lk.classList.contains('ready')) };
  });
  ok('vpick.a-full-card-offers-the-lock', done.ready===true, `button reads ${JSON.stringify(done.label)}`);

  await say('lock my card');
  await p.waitForTimeout(700);
  const after=await p.evaluate(()=>({screen:S.screen, wantEar:VX.wantEar}));
  ok('vpick.a-full-card-actually-locks', after.screen!=='predict',
     `still on ${after.screen} — "lock my card" used to call predGo(1), which does nothing on the last card`);

  ok('vpick.no-page-errors', errs.length===0, errs.slice(0,2).join(' | '));

  await b.close();
  bad.forEach(x=>console.log('  FAIL  '+x));
  console.log((fail?'RED':'GREEN')+'   '+pass+' passed, '+fail+' failed');
  process.exit(fail?1:0);
})().catch(e=>{ console.error(e); process.exit(2); });
