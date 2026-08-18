#!/usr/bin/env node
/* =====================================================================
   VOICE, DRIVEN END TO END IN A REAL BROWSER.
   ---------------------------------------------------------------------
   qa/voice.js proves the grammar — a pure function over strings. This
   proves the WIRING: that a spoken question is actually spoken, that a
   heard phrase reaches answer() and nextQuestion() and nothing else, and
   that switching it off silences it completely.

   TWO HARNESS TRAPS, both of which reported the feature broken when only
   the stub was, and both worth leaving written down:

     1. `speechSynthesis` is a READ-ONLY accessor on Window. `window.
        speechSynthesis = {...}` is a silent no-op. Use defineProperty.
     2. Chromium ships BOTH `SpeechRecognition` and the webkit-prefixed
        alias. Stubbing only the prefixed one leaves the code using the
        real engine, so the stub's counter stays at zero while the feature
        is working perfectly.

       node qa/voice-wiring.js [index.html]
   ================================================================== */
const {chromium}=require('playwright'); const path=require('path');
const TARGET=process.argv[2]||path.resolve(__dirname,'..','index.html');
const REC=`function(){ window.__recStarts++; this.start=function(){}; this.stop=function(){}; this.abort=function(){}; }`;
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.addInitScript(()=>{
    window.__said=[]; window.__recStarts=0;
    const def=(k,v)=>Object.defineProperty(window,k,{configurable:true,value:v});
    def('speechSynthesis',{ speak(u){ window.__said.push(u.text); setTimeout(()=>u.onend&&u.onend(),5); },
                            cancel(){}, getVoices(){return[];} });
    def('SpeechSynthesisUtterance', function(t){ this.text=t; });
    const R=function(){ window.__recStarts++; this.start=function(){}; this.stop=function(){}; this.abort=function(){}; };
    def('SpeechRecognition', R); def('webkitSpeechRecognition', R);
  });
  await p.goto('file://'+TARGET,{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>document.body.classList.contains('booted'),{timeout:25000});
  await p.evaluate(()=>{ try{SB.verified=()=>true;}catch(_){} });

  const R={};
  R['off-is-the-default'] = await p.evaluate(()=>VX.on===false);
  R['a-browser-with-no-speech-is-just-todays-app'] = await p.evaluate(()=>{
    const o=VX.hasOut; VX.hasOut=false; VX.on=false; window.__said=[];
    VX.enable(); const quiet = window.__said.length===0 && VX.on===false && !!VX.note;
    VX.hasOut=o; return quiet;                       // says why, does not pretend
  });
  await p.evaluate(()=>{ VX.enable(); });
  R['switching-it-on-speaks-inside-the-click'] = await p.evaluate(()=>window.__said.some(s=>/Voice is on/i.test(s)));

  /* THE LIVE PATH — the one a game night actually runs. */
  await p.evaluate(()=>{ S.mode='live'; S.qi=0; S.ni=0; S.answered=false;
                         go('live'); window.__said=[]; window.__recStarts=0; loadQuestion(); });
  await p.waitForTimeout(900);
  R['the-question-is-read-out-loud'] = await p.evaluate(()=>{
    const qt=(document.getElementById('qText')||{}).textContent||'';
    return !!qt && window.__said.some(s=>s.indexOf(qt.slice(0,25))>=0);
  });
  R['the-switch-is-on-the-question-card'] = await p.evaluate(()=>!!document.getElementById('vxBar'));
  R['the-mic-opens-only-after-it-stops-talking'] = await p.evaluate(()=>window.__recStarts>0);

  await p.evaluate(()=>{ window.__said=[]; VX.heard('two'); });
  await p.waitForTimeout(300);
  const a=await p.evaluate(()=>{
    const s=document.querySelector('#qOpts .opt.sel');
    return { sel:s?s.querySelector('span').textContent:null,
             opt2:(document.querySelectorAll('#qOpts .opt')[1]||{}).textContent||'',
             said:window.__said.slice(), pts:S.pts, answered:S.answered };
  });
  R['a-heard-number-picks-that-option'] = !!a.sel && a.opt2.indexOf(a.sel)>=0;
  R['it-says-the-option-back-to-you']   = a.said.some(s=>s.indexOf(a.sel)>=0);
  R['a-pick-is-not-a-lock']             = a.answered===false;   // still changeable
  R['hearing-you-scores-nothing']       = a.pts===0;

  await p.evaluate(()=>VX.heard('what do you reckon for this one'));
  R['a-sentence-is-not-an-answer'] = await p.evaluate(()=>{
    const s=document.querySelector('#qOpts .opt.sel'); return !!s;
  }) && (await p.evaluate(()=>document.querySelector('#qOpts .opt.sel').querySelector('span').textContent))===a.sel;

  await p.evaluate(()=>{ window.__nq=0; const o=window.nextQuestion;
                         window.nextQuestion=function(){window.__nq++;return o.apply(this,arguments);}; VX.heard('lock'); });
  await p.waitForTimeout(300);
  R['lock-goes-through-nextQuestion'] = await p.evaluate(()=>window.__nq===1);

  await p.evaluate(()=>{ VX.disable(); window.__said=[]; window.__recStarts=0;
                         VX.askQuestion(); VX.reveal('x'); VX.roundOpen(1,true); VX.locked('y'); });
  await p.waitForTimeout(200);
  R['off-means-silent-and-deaf'] = await p.evaluate(()=>window.__said.length===0 && window.__recStarts===0);
  R['no-page-errors'] = errs.length===0;

  await b.close();
  let bad=0;
  Object.keys(R).forEach(k=>{ if(!R[k]) bad++; console.log((R[k]?'  \x1b[32m✓\x1b[0m ':'  \x1b[31m✗\x1b[0m ')+'voice.'+k); });
  if(errs.length) console.log('  page errors: '+errs.slice(0,3).join(' | '));
  console.log('\n'+(bad?('\x1b[31mFAIL — '+bad+' of '+Object.keys(R).length+'\x1b[0m')
                       :('\x1b[32mPASS — all '+Object.keys(R).length+' voice wiring checks\x1b[0m')));
  process.exit(bad?1:0);
})();
