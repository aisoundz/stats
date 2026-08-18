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
/* RESOLVE IT. A bare filename ("index-marquee.html") became
   file://index-marquee.html/ — a HOST, not a path — and Playwright threw
   something that reads like a browser fault rather than a typo. Caught by
   the other session running this against its own build. A tool that only
   works when you happen to type an absolute path is a tool with a trap in
   it, and the person who trips it wastes their time on the wrong layer. */
const TARGET=path.resolve(process.argv[2]||path.join(__dirname,'..','index.html'));
const REC=`function(){ window.__recStarts++; this.start=function(){}; this.stop=function(){}; this.abort=function(){}; }`;
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.addInitScript(()=>{
    window.__said=[]; window.__recStarts=0;
    /* WRITABLE. Object.defineProperty defaults writable:false, so a later
       `window.__micThrows = true` is a SILENT no-op — the third time this
       harness has reported the feature broken when only the stub was. */
    const def=(k,v)=>Object.defineProperty(window,k,{configurable:true,writable:true,value:v});
    def('speechSynthesis',{ speak(u){ window.__said.push(u.text); setTimeout(()=>u.onend&&u.onend(),5); },
                            cancel(){ window.__said.push('<<CANCEL>>'); },
                            addEventListener(){},
                            /* Headless Chromium ships NO voices at all, so an
                               empty list here tests nothing. This is the real
                               shape of an iOS/Android list, novelty voices
                               included, because ranking them is the point. */
                            getVoices(){ return [
                              {name:'Samantha', lang:'en-US', voiceURI:'v-sam', localService:true},
                              {name:'Aaron',    lang:'en-US', voiceURI:'v-aaron', localService:true},
                              {name:'Bells',    lang:'en-US', voiceURI:'v-bells', localService:true},
                              {name:'Daniel',   lang:'en-GB', voiceURI:'v-dan', localService:true},
                              {name:'Google US English', lang:'en-US', voiceURI:'v-goog', localService:false}
                            ]; } });
    def('SpeechSynthesisUtterance', function(t){ this.text=t; });
    const R=function(){ window.__recBuilds++; window.__rec=this;
      this.start=function(){ if(window.__micThrows) throw new Error('not allowed'); window.__recStarts++; };
      this.stop=function(){}; this.abort=function(){};
      /* drive the engine the way a real one does: interim first, then final */
      this.__speak=function(txt,final){
        const res=[{transcript:txt,confidence:.9}]; res.isFinal=!!final; res.length=1;
        const ev={resultIndex:0,results:Object.assign([res],{length:1})};
        if(this.onspeechstart && !final) this.onspeechstart();
        if(this.onresult) this.onresult(ev);
      };
    };
    def('SpeechRecognition', R); def('webkitSpeechRecognition', R);
    def('__micThrows', false);
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

  /* PRACTICE — how almost everybody sees this app first, and the mode
     where a question SETTLES the instant it is answered rather than
     staying changeable. Voice used to talk over its own reveal here and
     then dead-end, so these are the checks for exactly that. */
  await p.evaluate(()=>{ S.answered=false; try{setMode('demo');}catch(_){}; window.__said=[]; startQuarter(0); });
  await p.waitForTimeout(900);
  await p.evaluate(()=>{ window.__said=[]; window.__recStarts=0; VX.heard('one'); });
  await p.waitForTimeout(600);
  const pr=await p.evaluate(()=>({said:window.__said.filter(s=>s!=='<<CANCEL>>'), answered:S.answered, recStarts:window.__recStarts}));
  R['practice-reveal-is-not-talked-over'] =
    pr.said.some(s=>/Correct|Not quite|Missed it/i.test(s)) &&
    !pr.said.some(s=>/say another number/i.test(s));
  R['practice-reopens-the-ear-for-next'] = pr.recStarts>0;
  /* Assert the MOVE, not the absence of a complaint. The first version of
     this check only looked for "Nothing picked yet" — and passed happily
     while "next" was not in the grammar at all and did nothing whatsoever.
     A check that passes when the feature is missing is worse than no check. */
  R['next-works-on-a-settled-question'] = await p.evaluate(()=>{
    window.__nq2=0; const o=window.nextQuestion;
    window.nextQuestion=function(){window.__nq2++;return o.apply(this,arguments);};
    window.__said=[]; VX.heard('next'); window.nextQuestion=o;
    return window.__nq2===1 && !window.__said.some(s=>/Nothing picked yet/i.test(s));
  });

  /* ---- THE THREE BUGS THAT MADE IT "NOT ACCEPT MY ANSWER" ---------- */
  await p.evaluate(()=>{ VX.enable(); S.mode='live'; S.qi=0; S.ni=0; S.answered=false;
                         go('live'); window.__said=[]; loadQuestion(); });
  await p.waitForTimeout(900);
  /* 1. Answering must cancel the options prompt, not be cut off by it. */
  R['speaking-cancels-the-options-prompt'] = await p.evaluate(()=>{
    if(!window.__rec) return false;
    window.__said=[]; window.__rec.__speak('tw',false);   // interim: somebody is talking
    return VX.hint===null;                                 // the prompt is off
  });
  /* 2. The engine runs one long session — no gap to answer into. */
  R['recognition-is-continuous'] = await p.evaluate(()=>!!(window.__rec && window.__rec.continuous===true && window.__rec.interimResults===true));
  /* 3. A final transcript answers, and is shown back on screen. */
  await p.evaluate(()=>{ window.__said=[]; window.__rec.__speak('two',true); });
  await p.waitForTimeout(300);
  R['a-spoken-answer-lands-through-the-engine'] = await p.evaluate(()=>{
    const s=document.querySelector('#qOpts .opt.sel');
    return !!s && (document.querySelectorAll('#qOpts .opt')[1]||{}).textContent.indexOf(s.querySelector('span').textContent)>=0;
  });
  R['it-shows-you-what-it-heard'] = await p.evaluate(()=>
    VX.lastHeard==='two' && (document.getElementById('vxBar').textContent||'').indexOf('heard')>=0);

  /* A MIC THAT REFUSES TO OPEN MUST SAY SO — iOS throws from start(). */
  R['a-mic-that-will-not-open-says-so'] = await p.evaluate(()=>{
    window.__micThrows=true; VX.micThrew=0; VX.note='';
    VX.deaf(); VX.wantEar=true; VX.ear(); VX.wantEar=true; VX.ear();
    const said=!!VX.note && /tap/i.test(VX.note);
    window.__micThrows=false; VX.micThrew=0; VX.note='';
    return said && VX.listening===false;
  });
  R['there-is-a-tap-to-talk-door'] = await p.evaluate(()=>
    typeof VX.listenNow==='function' && (document.getElementById('vxBar').innerHTML||'').indexOf('VX.listenNow()')>=0);

  /* THE VOICE ITSELF — a real choice off the device, remembered. */
  R['a-voice-can-be-chosen-and-is-remembered'] = await p.evaluate(()=>{
    const l=VX.voices(); if(!l.length) return false;
    const pick=l[l.length-1].voiceURI; VX.setVoice(pick);
    const ok=VX.voice() && VX.voice().voiceURI===pick;
    VX.setVoice(''); return ok;
  });
  R['it-prefers-a-real-voice-over-a-novelty-one'] = await p.evaluate(()=>{
    VX.setVoice(''); const v=VX.voice();
    return !!v && !/compact|eloquence|novelty|bells|bad news/i.test(v.name||'');
  });
  /* The default must not just be "whatever came first" — Samantha is first
     in the list and is exactly what the founder asked us to move off. */
  R['the-default-is-a-male-us-voice-not-the-first-one'] = await p.evaluate(()=>{
    VX.setVoice(''); const v=VX.voice(); return !!v && v.voiceURI==='v-aaron';
  });

  /* ---- iPHONE. Everything the founder reported is consistent with Safari
     refusing a microphone that has no tap behind it, so this is the path
     that has to be right; the desktop one already worked. */
  /* The recogniser is built ONCE now, so the iOS decision is made at build
     time — force a rebuild to test it, the way a real iPhone would. */
  /* SETTLE THE SPEECH FIRST. V.ear() declines while the app is talking —
     correctly — so a check that runs on the tail of the previous one's
     utterance reads a recogniser that was never rebuilt. It failed one run
     in two, and a flaky check is worse than no check: it teaches you to
     re-run until it goes green. Null the handle too, so "never built" is a
     loud failure rather than a stale object quietly answering for it. */
  await p.waitForFunction(()=>VX.speaking===false,{timeout:5000});
  R['ios-does-not-ask-for-a-session-it-cannot-have'] = await p.evaluate(()=>{
    const was=VX.ios; VX.deaf(); VX.mic=null; window.__rec=null; VX.ios=true;
    VX.wantEar=true; VX.ear();
    const r=window.__rec, ok = !!r && r.continuous===false && r.interimResults===false;
    VX.ios=was; VX.deaf(); VX.mic=null; return ok;
  });
  /* THE GUARANTEE CHANGED ON PURPOSE, so this is re-aimed rather than
     patched. It used to assert that iOS gives up and asks for a specific
     button. It now asserts the better thing: a mic that ends while still
     wanted stays WANTED, and re-arms itself. Sending a player hunting for
     one particular button is not conversational; any touch is. */
  R['a-mic-that-ends-while-wanted-comes-back'] = await p.evaluate(()=>{
    VX.wantEar=true; VX.ear(); VX.listening=false;
    if(window.__rec && window.__rec.onend) window.__rec.onend();
    return VX.wantEar===true;
  });
  R['a-tap-reopens-the-mic'] = await p.evaluate(()=>{
    VX.deaf(); const before=window.__recStarts; VX.listenNow();
    return window.__recStarts>before && VX.wantEar===true;
  });

  /* ---- THE VOICE CHECK. Its whole job is to name the broken step. */
  R['the-check-names-a-dead-mic'] = await p.evaluate(()=>{
    VX.deaf(); VX.lastHeard=''; const L=VX.check().map(r=>r[1]).join(' | ');
    return /has not heard anything yet/i.test(L) && /microphone is closed/i.test(L);
  });
  R['the-check-tells-chrome-on-iphone-to-use-safari'] = await p.evaluate(()=>{
    const w=VX.iosNotSafari; VX.iosNotSafari=true;
    const L=VX.check().map(r=>r[1]).join(' | '); VX.iosNotSafari=w;
    return /SAFARI/.test(L);
  });
  R['the-check-explains-a-phrase-it-refused'] = await p.evaluate(()=>{
    VX.lastHeard='what do you reckon';
    const L=VX.check().filter(r=>r[0]==='no').map(r=>r[1]).join(' | ');
    VX.lastHeard=''; return /not one of the answers/i.test(L);
  });
  R['the-check-is-reachable-without-a-question'] = await p.evaluate(()=>{
    VX.openCheck(); const d=document.getElementById('vxCheck');
    const open = !!d && d.className==='open' && /VOICE CHECK/.test(d.textContent||'');
    VX.closeCheck(); return open && document.getElementById('vxCheck').className==='';
  });

  /* ---- THE THREE SYMPTOMS FROM ONE DEAD MICROPHONE -----------------
     "I said made field goals, it didn't hear me" · "it put me as wrong" ·
     "I said next question and it wouldn't move". One fault, three faces. */
  await p.evaluate(()=>{ VX.enable(); S.mode='live'; S.qi=0; S.ni=0; S.answered=false;
                         go('live'); window.__recBuilds=0; loadQuestion(); });
  await p.waitForTimeout(900);
  R['one-recogniser-not-one-per-utterance'] = await p.evaluate(()=>{
    const b0=window.__recBuilds;
    VX.pause(); VX.ear(); VX.pause(); VX.ear();      // four lifecycle events
    return window.__recBuilds===b0;                   // and still one object
  });
  /* Speaking must PAUSE the mic, never surrender the permission. */
  R['talking-pauses-the-mic-it-does-not-give-it-up'] = await p.evaluate(()=>{
    VX.wantEar=true; VX.ear(); VX.deafSay('something');
    return VX.wantEar===true && VX.listening===false;
  });
  R['locking-a-question-keeps-the-conversation-open'] = await p.evaluate(()=>{
    VX.wantEar=true; VX.ear(); VX.locked('Locked in.');
    return VX.wantEar===true;
  });
  R['the-reveal-listens-for-next'] = await p.evaluate(()=>{
    VX.deaf(); VX.reveal('Not quite.');
    return VX.wantEar===true;
  });
  /* ANY tap re-arms it — that is what makes iOS feel conversational. */
  await p.waitForFunction(()=>VX.speaking===false,{timeout:5000});
  R['any-tap-anywhere-reopens-a-shut-mic'] = await p.evaluate(()=>{
    window.__micThrows=true; VX.deaf(); VX.wantEar=true; VX.ear();
    const shut = VX.listening===false && VX.wantEar===true;
    window.__micThrows=false;
    const before=window.__recStarts;
    document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    return shut && window.__recStarts>before && VX.listening===true;
  });
  R['a-shut-mic-says-so-loudly'] = await p.evaluate(()=>{
    VX.deaf(); VX.wantEar=true; VX.note='';
    VX.paint();
    const t=(document.getElementById('vxBar')||{}).textContent||'';
    return /can.t hear you/i.test(t);
  });
  /* And the phrase he actually said has to land. */
  R['made-field-goals-lands'] = await p.evaluate(()=>{
    const m=VX.match('made field goals', ['Made field goals','Made free throws','Equal']);
    return !!m && m.kind==='pick' && m.i===0;
  });
  R['next-question-moves-on'] = await p.evaluate(()=>{
    const m=VX.match('next question', ['Yes','No']);
    return !!m && m.kind==='lock';
  });

  /* ---- THE VOICE CHECK'S OWN TWO BUGS, both hit by the founder ------
     "On the voice page in the menu when you test the voice it doesn't work.
     It says speak into it and it doesn't detect it." */
  R['the-test-button-works-with-voice-off'] = await p.evaluate(()=>{
    VX.disable();                       // exactly the state he was in
    const before=window.__recStarts;
    VX.listenNow();
    return VX.on===true && window.__recStarts>before;   // it turns itself on and listens
  });
  R['the-check-tests-the-mic-not-a-question-that-isnt-there'] = await p.evaluate(()=>{
    try{ document.getElementById('qOpts').innerHTML=''; }catch(_){}  // no live question
    VX.enable();
    const opts=VX.curOpts();
    const graded = opts.length>0 && VX.match('two', opts);
    return VX.onAQuestion()===false && !!graded && graded.kind==='pick' && graded.i===1;
  });
  R['a-working-mic-is-never-reported-as-failed'] = await p.evaluate(()=>{
    try{ document.getElementById('qOpts').innerHTML=''; }catch(_){}
    VX.enable(); VX.lastHeard='two';
    const L=VX.check();
    const bad=L.filter(r=>r[0]==='no').map(r=>r[1]).join(' | ');
    const good=L.filter(r=>r[0]==='ok').map(r=>r[1]).join(' | ');
    VX.lastHeard='';
    return !/not one of the answers/i.test(bad) && /microphone works/i.test(good);
  });

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
