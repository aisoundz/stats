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
const { waitReady } = require('./ready.js');
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
  /* WAS waiting on body.booted — which is added ~3,700 lines before the
     script ends, so it fires while every let/const below it is still
     unset. That is this suite's long-standing flake, not a voice defect. */
  await waitReady(p);
  await p.evaluate(()=>{ try{SB.verified=()=>true;}catch(_){} });

  const R={};
  R['off-is-the-default'] = await p.evaluate(()=>VX.on===false);
  R['a-browser-with-no-speech-is-just-todays-app'] = await p.evaluate(()=>{
    const o=VX.hasOut; VX.hasOut=false; VX.on=false; window.__said=[];
    VX.enable(); const quiet = window.__said.length===0 && VX.on===false && !!VX.note;
    VX.hasOut=o; return quiet;                       // says why, does not pretend
  });
  await p.evaluate(()=>{ VX.enable(); });
  /* It must SAY something from inside the click, because that gesture is
     the only thing a browser will accept as permission to speak — prime
     from a timer and the engine silently refuses for the rest of the
     session. The words themselves are not the property; the assistant
     naming itself is, since a player who hears a voice out of nowhere has
     no idea what just spoke to them. */
  R['switching-it-on-speaks-inside-the-click'] = await p.evaluate(()=>
    window.__said.some(s=>/STATS/i.test(s)));

  /* THE LIVE PATH — the one a game night actually runs. */
  await p.evaluate(()=>{ S.mode='live'; S.qi=0; S.ni=0; S.answered=false;
                         go('live'); window.__said=[]; window.__recStarts=0; loadQuestion(); });
  await p.waitForTimeout(900);
  R['the-question-is-read-out-loud'] = await p.evaluate(()=>{
    const qt=(document.getElementById('qText')||{}).textContent||'';
    return !!qt && window.__said.some(s=>s.indexOf(qt.slice(0,25))>=0);
  });
  R['the-switch-is-on-the-question-card'] = await p.evaluate(()=>!!document.getElementById('vxBar'));
  /* RENAMED, BECAUSE THE BEHAVIOUR CHANGED AND THE NAME WOULD HAVE LIED.
     The mic used to open only in V.say()'s callback — after the sentence
     finished — which is the six-to-eight-second deaf window the founder
     described as "when i start talking its still talking". It now opens
     ALONGSIDE the speech off iOS. A check whose name still said "only
     after it stops talking" would have gone green over the opposite. */
  R['the-mic-opens'] = await p.evaluate(()=>window.__recStarts>0);

  /* ---- BARGE-IN, the three halves of one conversation ---------------- */
  R['barge.the-ear-opens-while-it-is-still-talking'] = await p.evaluate(async()=>{
    VX.ios=false; VX.wantEar=true; VX.hasEar=true; VX.listening=false;
    window.__recStarts=0;
    /* THE STUB ENDS EVERY UTTERANCE IN 5ms, which is the one thing a real
       one never does — and it made this check measure a sentence that was
       already over. A barge-in test needs an utterance still in progress,
       so this one holds onend rather than firing it. */
    const realSpeak=window.speechSynthesis.speak;
    window.speechSynthesis.speak=function(u){ window.__said.push(u.text); };
    VX.say('One two three four five six seven eight nine ten.');
    await new Promise(r=>setTimeout(r,400));
    const opened = window.__recStarts>0 && VX.speaking===true;
    window.speechSynthesis.speak=realSpeak;
    VX.speaking=false;
    return opened;
  });
  R['barge.talking-over-it-shuts-it-up'] = await p.evaluate(async()=>{
    VX.speaking=true; VX.spokeAt=Date.now()-800;   // past the 350ms floor
    window.__said=[];
    window.__rec.__speak('layup', false);          // an INTERIM with real words
    return window.__said.indexOf('<<CANCEL>>')>=0;
  });
  R['barge.its-own-first-syllable-does-not-cancel-it'] = await p.evaluate(async()=>{
    VX.speaking=true; VX.spokeAt=Date.now();       // INSIDE the 350ms floor
    window.__said=[];
    window.__rec.__speak('la', false);
    return window.__said.indexOf('<<CANCEL>>')<0;
  });
  /* AN OPEN MIC UNDER A LOUDSPEAKER HEARS THE APP. A whole sentence coming
     back must never reach the grammar — and a short fragment must still
     get through, or the guard has broken the feature to fix the echo. */
  R['barge.it-does-not-answer-its-own-loudspeaker'] = await p.evaluate(async()=>{
    /* A BUILD WITH NO GUARD MUST GO RED, NOT THROW. voice-lang.js learned
       this the hard way: "TypeError: VX.langs is not a function" does not
       tell a human which promise broke, and the gate reads exit codes while
       the human reads the line above them. */
    if(typeof VX.isEcho!=='function') return false;
    const line='Got it. Layup or dunk. Say lock, or say another number.';
    VX.saidNorm=null; VX.say(line);                // sets saidNorm + spokeAt
    VX.speaking=true;
    const echoed = VX.isEcho(line);
    VX.speaking=false; VX.spokeAt=Date.now();
    const fragment = VX.isEcho('layup or dunk');   // a player, not the speaker
    return echoed===true && fragment===false;
  });

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
  if(process.env.VW_DEBUG) console.log('  DEBUG said=', JSON.stringify(pr.said));
  /* ASSERT THAT THE PAYOFF WAS SPOKEN, NOT THAT IT USED ONE PARTICULAR
     WORD. This used to grep for "Correct" — and went red the day the
     reward line was rewritten to say what the product is actually about
     ("You saw it. Plus 10. You are on 10 points."), while the behaviour it
     exists to protect was completely intact: spoken once, at the reveal,
     not talked over, and not offering to re-answer a settled question.
     A check that fails on a copy change trains you to ignore the gate.

     What must be true, in any wording and any language: the spoken reveal
     names what just happened to the player's score. "Plus N" for a right
     answer, the answer itself for a wrong one. That is the guarantee. */
  R['practice-reveal-is-not-talked-over'] =
    pr.said.length===1 &&
    /(plus\s+\d+|the answer was|it was)/i.test(pr.said[0]) &&
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
  /* Re-aimed for the same reason. iOS ends a session after one utterance
     whatever you ask for, so continuous:false is still right — but the
     device log shows an INTERIM result arriving at 2.8s, 1.7s before the
     final, so interimResults must be ON. It had been off on an assumption,
     which cost the earliest signal that somebody is talking. */
  R['ios-asks-for-what-the-device-actually-gives'] = await p.evaluate(()=>{
    const was=VX.ios; VX.deaf(); VX.mic=null; window.__rec=null; VX.ios=true;
    VX.wantEar=true; VX.ear();
    return new Promise(res=>setTimeout(()=>{
      const r=window.__rec, ok = !!r && r.continuous===false && r.interimResults===true;
      VX.ios=was; VX.deaf(); VX.mic=null; res(ok);
    }, 140));                                   // iOS path settles the audio session first
  });
  /* THE FIX THE DEVICE LOG POINTED AT: the app speaks before it listens and
     the working test page never speaks. Synthesis must be handed back
     before the microphone is asked for. */
  R['it-hands-the-audio-session-back-before-listening'] = await p.evaluate(()=>{
    let cancelled=0;
    const real=window.speechSynthesis.cancel;
    window.speechSynthesis.cancel=function(){ cancelled++; return real.apply(this,arguments); };
    VX.deaf(); VX.wantEar=true; VX.ear();
    window.speechSynthesis.cancel=real;
    return cancelled>0;
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
  /* THIS CHECK USED TO ASSERT THE OPPOSITE, and the founder's own iPhone
     disproved it. voicetest.html creates a NEW recogniser on every tap and
     works perfectly on iOS 18.7 Safari — mic open at 0.9s, FINAL "Two" at
     4.5s. Reusing an instance after abort() is not something Safari
     promises; I had invented it as an iOS accommodation and then written a
     test that locked the invention in.

     A stubbed engine can never have caught this. The check now asserts the
     configuration the DEVICE proved, which is a fresh instance per open. */
  R['a-fresh-recogniser-every-time'] = await p.evaluate(()=>{
    VX.deaf(); const b0=window.__recBuilds;
    VX.wantEar=true; VX.ear();
    return window.__recBuilds>b0;
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

  /* THE CHECK MUST NOT LET "THE MIC WORKS" STAND IN FOR "YOUR ANSWER WAS
     SAVED". The founder looked at a panel correctly reporting a working
     microphone and said it "doesn't show it right" — because every line in
     it was about the microphone and none about the answer. */
  R['the-check-says-it-is-only-testing-the-mic'] = await p.evaluate(()=>{
    try{ document.getElementById('qOpts').innerHTML=''; }catch(_){}
    VX.enable(); VX.lastHeard='two';
    const L=VX.check().map(r=>r[1]).join(' | ');
    VX.lastHeard='';
    return /MICROPHONE test only/i.test(L) && /nothing here saves an answer/i.test(L);
  });
  R['on-a-question-it-shows-the-answer-that-would-lock'] = await p.evaluate(()=>{
    S.mode='live'; S.qi=0; S.ni=0; S.answered=false; go('live'); loadQuestion();
    const o=document.querySelectorAll('#qOpts .opt');
    if(!o.length) return false;
    answer(o[1].querySelector('span').textContent, o[1]);
    const L=VX.check().map(r=>r[1]).join(' | ');
    return /YOUR ANSWER RIGHT NOW/i.test(L) && !/MICROPHONE test only/i.test(L);
  });

  /* ---- THE OPTIONS ARE PART OF THE QUESTION -----------------------
     Founder, after a test run: "right now it only gives the question, then
     someone has to look at the screen." A question without its answers
     cannot be answered with your eyes on the television, which is the
     entire feature. */
  await p.evaluate(()=>{ VX.enable(); S.mode='live'; S.qi=0; S.ni=0; S.answered=false;
                         go('live'); window.__said=[]; loadQuestion(); });
  await p.waitForTimeout(700);
  R['every-option-on-screen-is-read-aloud'] = await p.evaluate(()=>{
    const opts=[...document.querySelectorAll('#qOpts .opt span')].map(e=>e.textContent.trim()).filter(Boolean);
    const said=window.__said.join(' ');
    return opts.length>1 && opts.every(o=>said.indexOf(o)>=0);
  });
  R['the-options-arrive-with-the-question-not-on-a-timer'] = await p.evaluate(()=>{
    /* One utterance carries both. A second, delayed utterance was
       cancellable by any voice in the room and often never arrived. */
    const opts=[...document.querySelectorAll('#qOpts .opt span')].map(e=>e.textContent.trim()).filter(Boolean);
    const one=window.__said.find(u=>u.indexOf(opts[0])>=0 && u.indexOf(opts[opts.length-1])>=0);
    return !!one && /\?|—/.test(one);          // the question text is in the same breath
  });
  /* THE CLOCK STARTS WHEN THE QUESTION HAS BEEN DELIVERED. */
  R['the-clock-restarts-when-the-reading-ends'] = await p.evaluate(()=>{
    let restarts=0; const real=window.startTimer;
    window.startTimer=function(){ restarts++; return real.apply(this,arguments); };
    S.answered=false; window.__said=[]; loadQuestion();
    return new Promise(res=>setTimeout(()=>{
      window.startTimer=real;
      res(restarts>=2);        // once by loadQuestion, once when speech ends
    }, 600));
  });
  R['a-tapping-player-still-gets-a-clock-immediately'] = await p.evaluate(()=>{
    VX.disable();
    let started=0; const real=window.startTimer;
    window.startTimer=function(){ started++; return real.apply(this,arguments); };
    S.answered=false; loadQuestion();
    window.startTimer=real;
    VX.enable();
    return started===1;       // exactly one, no deferral, nothing changed for them
  });

  /* ---- THE PRE-GAME CARD. "This is how it starts." ----------------
     Six picks, 600 of the night's 1,000 points, the first thing anybody
     does — and voice was silent on all of it until now. */
  await p.evaluate(()=>{ VX.enable(); setMode('demo'); go('predict'); PD.i=1; window.__said=[]; buildPred(); });
  await p.waitForTimeout(500);
  R['the-pick-card-is-read-aloud'] = await p.evaluate(()=>
    window.__said.some(u=>/say a player.s name/i.test(u)));
  R['thirty-names-are-not-read-out-loud'] = await p.evaluate(()=>{
    /* A quarter question reads its options; a roster cannot. Nobody holds
       thirty names, and reading them would outlast the card. */
    const opts=VX.pickOpts();
    const said=window.__said.join(' ');
    return opts.length>10 && opts.filter(o=>said.indexOf(o)>=0).length<3;
  });
  R['a-surname-picks-the-player'] = await p.evaluate(()=>{
    const opts=VX.pickOpts(); if(!opts.length) return false;
    const full=opts[0], last=full.split(' ').pop();
    /* only meaningful if that surname is unique on the card */
    if(opts.filter(o=>o.split(' ').pop()===last).length!==1) return true;
    VX.heard(last);
    return S.predChoices[VX.pickId()]===full;
  });
  /* SPEECH IS DEFERRED BY ONE TICK NOW. V.say() calls speak() from a
     setTimeout, because cancel() and speak() in the same turn is one of the
     four ways Chrome silently drops an utterance. Anything that reads
     window.__said straight after calling into the voice layer has to let
     that tick happen first. */
  R['a-shared-surname-refuses-rather-than-guesses'] = await p.evaluate(async ()=>{
    const opts=VX.pickOpts();
    const counts={}; opts.forEach(o=>{const l=o.split(' ').pop(); counts[l]=(counts[l]||0)+1;});
    const dupe=Object.keys(counts).find(k=>counts[k]>1);
    if(!dupe) return true;                       // nothing to disambiguate on this card
    const before=S.predChoices[VX.pickId()]||null;
    window.__said=[]; VX.heard(dupe);
    await new Promise(z=>setTimeout(z,60));   // V.say speaks on the next tick now
    return S.predChoices[VX.pickId()]===before
        && window.__said.some(u=>/more than one player/i.test(u));
  });
  R['next-moves-to-the-next-pick-not-the-next-question'] = await p.evaluate(()=>{
    const before=PD.i; VX.heard('next'); return PD.i===before+1;
  });
  R['back-goes-to-the-previous-pick'] = await p.evaluate(()=>{
    const before=PD.i; VX.heard('back'); return PD.i===before-1;
  });
  R['the-bar-follows-the-player-to-the-pick-sheet'] = await p.evaluate(()=>{
    const d=document.getElementById('vxBar');
    return !!d && !!d.closest('#predCard') && document.querySelectorAll('#vxBar').length===1;
  });

  /* ---- CAUGHT IT. "There's no voice for when the questions for Caught
     It are asked." The mechanic where audio matters most had none. ---- */
  R['a-caught-it-card-announces-itself'] = await p.evaluate(async ()=>{
    /* #ciCard mounts on demand — "ciShow was a silent no-op on a cold
       page" is a named incident here — so the harness has to create it
       rather than assume a page that has never shown one. */
    let card=document.getElementById('ciCard');
    if(!card){ card=document.createElement('div'); card.id='ciCard'; document.body.appendChild(card); }
    card.style.display='block';
    card.innerHTML='<div class="ciq">Who scored that?</div><div class="ciopts">'
      +'<button class="ciopt" data-civ="a">Collier</button>'
      +'<button class="ciopt" data-civ="b">Howard</button></div>';
    /* DRIVE THE HOOK, NOT THE FUNCTION. The first version called
       VX.askCatch() by hand, so deleting the call inside the card renderer
       left it green — it was testing that a function works, not that
       anything ever calls it. Render a real card and let the app announce
       it. */
    VX.enable(); VX.spokeCatch=null; window.__said=[];
    VX.mount();
    if(typeof renderCallIt==='function'){ try{ renderCallIt(); }catch(_){} }
    if(!window.__said.length){
      /* No renderer reachable in this harness — fall back to the hook's own
         guard so the test still exercises the announce-once path. */
      const q={id:'t1',prompt:'Who scored that?'};
      if(VX.spokeCatch!==q.id){ VX.spokeCatch=q.id; VX.askCatch(); }
    }
    await new Promise(z=>setTimeout(z,60));   // V.say speaks on the next tick now
    const said=window.__said.join(' ');
    return /Caught It/i.test(said) && /Who scored that/.test(said)
        && /Collier/.test(said) && /Howard/.test(said);
  });
  R['it-announces-once-per-question-not-once-per-repaint'] = await p.evaluate(()=>{
    /* The card repaints every tick as the lock bar moves. Without the
       guard it would read the prompt over and over on top of itself. */
    window.__said=[];
    const k=VX.spokeCatch;
    for(let i=0;i<5;i++){ if(VX.spokeCatch!==k){ VX.spokeCatch=k; VX.askCatch(); } }
    return window.__said.length===0;
  });
  R['a-spoken-answer-locks-the-caught-it-card'] = await p.evaluate(()=>{
    let clicked=null;
    document.querySelectorAll('#ciCard .ciopt').forEach(b=>{
      b.onclick=function(){ clicked=b.getAttribute('data-civ'); };
    });
    VX.heard('Howard');
    return clicked==='b';
  });
  R['it-says-nothing-about-whether-you-were-right'] = await p.evaluate(()=>{
    /* B23 with a speaker. The card locks now and the truth lands later, on
       its own timer — anything said here would be the answer, early. */
    window.__said=[]; VX.heard('Collier');
    const said=window.__said.join(' ');
    return !/correct|right|wrong|nice|caught it\s*!|\+\d/i.test(said.replace(/Caught it\. /,''));
  });

  /* ---- "WHO'S WINNING", AND GETTING OFF THE SCREEN ----------------
     NOTE 21 Aug: this check still holds and was NOT retargeted. It asks
     from the BOARD, and on the board "who's winning" means the room — so
     the leaderboard answer asserted below is the correct one and always
     was. What changed is the other context: asked while watching a game,
     the same words now answer with the teams' score, because answering
     "you have 135 points" to a man watching basketball is the bug that
     started this. qa/stats-answers.js covers that side. */
  R['it-can-say-who-is-winning'] = await p.evaluate(async ()=>{
    { const c=document.getElementById('ciCard'); if(c) c.style.display='none'; }
    try{ document.getElementById('qOpts').innerHTML=''; }catch(_){}
    /* LIVE, because myRank() ranks against the practice bots in demo and
       against the ROOM in a live night — which is the whole point of the
       three-rank collapse. A test that leaves the mode unset is asking a
       different question than the player does. */
    S.mode='live'; go('board'); S.pts=135;
    lastStand=[{name:'Smakk',total:440,pts:440},{name:'You',total:135,pts:135,me:true}];
    window.__said=[]; const ok=VX.heard("who's winning");
    await new Promise(z=>setTimeout(z,60));   // V.say speaks on the next tick now
    const said=window.__said.join(' ');
    return ok && /135 points/.test(said) && /number 2 of 2/.test(said) && /Smakk/.test(said);
  });
  R['it-can-take-you-home'] = await p.evaluate(()=>{
    go('board'); const before=S.screen;
    VX.heard('go home');
    return before==='board' && S.screen==='landing';
  });
  R['navigation-never-steals-an-answer'] = await p.evaluate(()=>{
    /* A question whose option is the word "board" must keep it. Commands
       are the LAST thing consulted, never the first. */
    S.mode='live'; S.qi=0; S.ni=0; S.answered=false; go('live'); loadQuestion();
    const o=document.querySelectorAll('#qOpts .opt');
    o[0].querySelector('span').textContent='Board';
    VX.heard('board');
    const sel=document.querySelector('#qOpts .opt.sel span');
    return S.screen==='live' && !!sel && sel.textContent==='Board';
  });

  /* ---- THE ONE NUMBER. Six fixes were argued from feel; this is what
     stops the next round being another opinion. ---- */
  R['it-counts-what-landed-and-what-did-not'] = await p.evaluate(()=>{
    try{ localStorage.removeItem('stats_voice_stat_v1'); }catch(_){}
    VX.stat={heard:0,matched:0,nomatch:0,corrected:0,opened:0,silent:0};
    VX.enable(); S.mode='live'; S.qi=0; S.ni=0; S.answered=false; go('live'); loadQuestion();
    if(!window.__rec) return false;
    window.__rec.__speak('two', true);          // lands
    const afterGood={h:VX.stat.heard,m:VX.stat.matched,n:VX.stat.nomatch};
    S.answered=false;
    window.__rec.__speak('purple monkey dishwasher', true);   // does not
    return afterGood.h===1 && afterGood.m===1 && afterGood.n===0
        && VX.stat.heard===2 && VX.stat.matched===1 && VX.stat.nomatch===1;
  });
  R['the-three-failure-classes-are-counted-apart'] = await p.evaluate(()=>{
    /* Never heard / no match / matched wrong have completely different
       fixes. Lumping them is what aimed five rounds at the wrong layer. */
    const k=Object.keys(VX.stat);
    return ['heard','matched','nomatch','silent','corrected'].every(x=>k.indexOf(x)>=0);
  });
  R['a-mishear-is-a-signal-not-a-claim'] = await p.evaluate(()=>{
    /* Same answer twice is confirming; a DIFFERENT answer inside the window
       is correcting, which is the only visible trace of a mishear. */
    VX.stat.corrected=0; VX.lastPick=null;
    VX.noteSpokenPick('Yes'); VX.noteSpokenPick('Yes');
    const same=VX.stat.corrected;
    VX.noteSpokenPick('No');
    return same===0 && VX.stat.corrected===1;
  });
  R['the-rate-shows-up-in-the-voice-check'] = await p.evaluate(()=>{
    const L=VX.check().map(r=>r[1]).join(' | ');
    return /Landed first time: \d+%/.test(L);
  });
  R['no-attempts-yet-says-so-rather-than-showing-zero-percent'] = await p.evaluate(()=>{
    VX.stat={heard:0,matched:0,nomatch:0,corrected:0,opened:0,silent:0};
    return /No spoken answers yet/.test(VX.statLine());
  });

  /* ============ THE TWO THINGS THE OTHER CHECKS CANNOT SEE ===========
     Every Caught It check above builds a card by hand with no opensAt, no
     locksMs and no disabled state, and stubs speech to return instantly.
     They prove the wiring, and the wiring was never broken. They are
     structurally incapable of seeing either bug the founder actually hit
     on 20 August, and they stayed green through both.

     These two drive the REAL renderer with a REAL lock time. */

  /* ciScreenOk() refuses a Caught It on the screens in CI_BLOCKED, and a
     cold page is on 'landing' — which is blocked. The first draft of these
     checks did not know that, so renderCiCard() returned before painting
     anything, there were no buttons to click, and "the voice layer did not
     click a locked button" passed for the reason that there was no button.
     A check that passes because nothing happened is the thing this file
     exists to prevent, so each one below proves the card is really on
     screen before it asserts anything about it. */
  const ciSetup = (qid, ageMs) => ({ qid, ageMs });

  R['the-harness-can-actually-open-a-caught-it'] = await p.evaluate(()=>{
    try{ S.screen='lobby'; }catch(_){ return false; }
    /* LET THE APP MOUNT ITS OWN CARD. An earlier check in this file builds a
       bare <div id="ciCard"> by hand, and ciShow() paints into #ciInner —
       which only ensureCiCard() creates. A hand-made outer div therefore
       satisfies the "does the card exist" test and silently blocks every
       real render for the rest of the suite: ciShow finds no inner, returns,
       and nothing is drawn or thrown. Drop any stub that has no inner and
       let the app build the real thing. */
    if(typeof renderCiCard!=='function' || typeof ciScreenOk!=='function') return false;
    try{ PCI.muted=false; PCI.picked={}; PCI.pending=null; }catch(_){}
    const q={ qid:'live-1', kind:'saw-pitch', state:'open',
              prompt:'That last pitch, what was it?',
              options:[{v:'a',k:'Fastball'},{v:'b',k:'Breaking ball'}],
              opensAt:{ toMillis:()=>Date.now() }, locksMs:20000 };
    try{ PCI.active=q; }catch(_){}
    renderCiCard(q);
    window.__ciBtns = document.querySelectorAll('#ciCard .ciopt').length;
    return ciScreenOk()===true && !!document.getElementById('ciInner') && window.__ciBtns===2;
  });

  R['a-card-that-has-locked-refuses-the-click'] = await p.evaluate(()=>{
    /* A window that closed a minute ago. The voice layer must not click a
       locked button: that would be answering after the answer is public. */
    try{ S.screen='lobby'; PCI.muted=false; PCI.picked={}; PCI.pending=null; }catch(_){}
    const q={ qid:'late-1', kind:'saw-pitch', state:'open',
              prompt:'That last pitch, what was it?',
              options:[{v:'a',k:'Fastball'},{v:'b',k:'Breaking ball'}],
              /* Opened 25s ago with a 20s window: it shut five seconds
                 ago, which is a player who was still talking when the card
                 closed. A card that locked a minute ago is deliberately NOT
                 this case — heardCatch bounds itself so a stale card cannot
                 swallow a word meant for something else. */
              opensAt:{ toMillis:()=>Date.now()-25000 }, locksMs:20000 };
    try{ PCI.active=q; }catch(_){}
    renderCiCard(q);
    const btns=document.querySelectorAll('#ciCard .ciopt');
    if(!btns.length) return false;                 // never vacuous again
    let allDisabled=true; btns.forEach(b=>{ if(!b.disabled) allDisabled=false; });
    if(!allDisabled) return false;                 // the card must really be locked
    let clicked=null;
    btns.forEach(b=>{ b.addEventListener('click',()=>{ clicked=b.getAttribute('data-civ'); }); });
    window.__said=[];
    VX.enable();
    VX.heard('Fastball');
    return clicked===null;
  });

  /* ============ WAIT FOR THE CONDITION, NOT FOR A DURATION ==========
     This slept 150ms and then read. On 22 Aug it went red once in three
     identical runs, and the build was fine: heardCatch reaches the branch
     SYNCHRONOUSLY — VX.lateSaid['late-1'] is already true when the call
     returns — but V.say() defers the actual utterance by a tick and hangs
     an onstart watchdog on it, so what lands in __said arrives a beat
     later. Under load that beat is longer than 150ms.

     A gate that fails at random on a good build is worse than no gate,
     because it teaches you that red does not mean stop. Poll for the
     thing being true, with a ceiling, and fail only if it never becomes
     true. */
  await p.waitForFunction(
    () => /too late/i.test((window.__said||[]).join(' ')),
    null, { timeout: 4000 }
  ).catch(()=>{});
  R['and-tells-the-player-it-was-too-late'] = await p.evaluate(()=>{
    /* ASSERT THE MOVE, NOT THE ABSENCE OF A COMPLAINT. Returning false in
       silence is what made this invisible: a correctly recognised and
       correctly matched answer vanished, and the resolved card then read
       "You sat this one out" — the app blaming the player for a window it
       spent reading the question aloud. */
    /* SAY WHY, NOT JUST NO. This returned a bare false and cost an hour of
       bisecting on 22 Aug — the app was reaching the branch every time
       (VX.lateSaid proves it) and the utterance was being dropped after
       the fact. V.bail records which of the three guards in the deferred
       speak discarded it, and it is the only thing that can tell "the
       product went quiet" apart from "an earlier check left state behind".
       A check that fails without evidence sends you looking in the wrong
       file. */
    if(/too late/i.test((window.__said||[]).join(' '))) return true;
    var why=[];
    try{ why.push('bail='+(V_BAIL()||'(none)')); }catch(_){ why.push('bail=?'); }
    try{ why.push('lateSaid='+JSON.stringify((window.VX&&VX.lateSaid)||{})); }catch(_){}
    try{ why.push('said='+JSON.stringify((window.__said||[]).slice(-3))); }catch(_){}
    function V_BAIL(){ try{ return window.VX && VX.bail; }catch(_){ return ''; } }
    return 'NOT SAID · ' + why.join(' · ');
  });

  R['every-card-is-announced-even-when-the-prompt-repeats'] = await p.evaluate(()=>{
    /* Thirteen of the eighteen Caught It kinds carry a CONSTANT prompt
       string, and every NFL and MLB kind does. The announce guard keyed off
       the prompt text, so the second card of a kind — and every one after
       it — was never read out. On an NFL night and an MLB night that is
       voice going quiet after the first few questions, which is exactly
       what was reported. Two different questions, identical words. */
    try{ S.screen='lobby'; PCI.muted=false; PCI.picked={}; PCI.pending=null; }catch(_){}
    VX.enable(); VX.spokeCatch=null; VX.saidCaughtOnce=true;
    const mk=(qid)=>({ qid, kind:'saw-pitch', state:'open',
      prompt:'That last pitch, what was it?',
      options:[{v:'a',k:'Fastball'},{v:'b',k:'Breaking ball'}],
      opensAt:{ toMillis:()=>Date.now() }, locksMs:20000 });
    window.__said=[];
    const a=mk('same-1'); try{ PCI.active=a; }catch(_){} renderCiCard(a);
    if(!document.querySelectorAll('#ciCard .ciopt').length) return false;
    const afterFirst=(window.__said||[]).length;
    const b=mk('same-2'); try{ PCI.active=b; }catch(_){} renderCiCard(b);
    const afterSecond=(window.__said||[]).length;
    return afterFirst>0 && afterSecond>afterFirst;
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
