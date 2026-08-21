#!/usr/bin/env node
/* ============ THE ANDROID VOICE PATH, WHICH IS DAN'S ==================
   Founder, 21 August 2026: "Dan uses an android" and "We need to think of
   all android and ios. Ive mention this before."

   Fair, and the voice work shipped today was reasoned about from an iPad.
   The two platforms do not share a path — V.ios gates six separate
   branches in this layer — and the branch that matters for the only
   outside human who has ever come back is the ANDROID one.

   The difference is not cosmetic. On iOS the microphone only opens from a
   tap, so the player is always deliberately talking to the app. On Android
   the mic opens BY ITSELF, 220ms into the question, alongside the
   synthesiser (see V.say: `if(!V.ios && V.wantEar ...) V.ear({barge:true})`).
   That is the better experience and it is genuinely hands-free.

   It also means the recogniser is listening WHILE THE APP IS TALKING, in a
   room with a live broadcast playing. Everything below exists because of
   that one fact.

   Device: 412x915, Android, Chrome — Dan's actual phone, not a stand-in.

   Usage: node qa/voice-android.js [index-test.html]
*/
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const TARGET = process.argv.find(a => /\.html$/.test(a)) || 'index.html';
let pass = 0, fail = 0;
function ok(name, cond, detail){
  if(cond){ pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗ ' + name + '\x1b[0m\n      ' + (detail || '')); }
}
function serve(){
  const srv = http.createServer((q,r)=>{
    const f = path.join(process.cwd(), q.url.split('?')[0] === '/' ? TARGET : q.url.split('?')[0]);
    try{ r.writeHead(200,{'content-type':'text/html'}); r.end(fs.readFileSync(f)); }
    catch(_){ r.writeHead(404); r.end(''); }
  });
  return new Promise(res=>{ srv.listen(0,()=>res({srv, port:srv.address().port})); });
}

(async () => {
  console.log('\n  ANDROID VOICE — the hands-free path, on Dan\'s phone\n');
  const { srv, port } = await serve();
  const b = await chromium.launch();
  const pixel = devices['Pixel 7'];
  const ctx = await b.newContext(Object.assign({}, pixel, { viewport:{width:412,height:915} }));
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e.message).slice(0,120)));

  /* A recogniser we drive by hand, and a synthesiser that reports what it
     was asked to say. Both shaped like the real ones. */
  await p.addInitScript(()=>{
    window.__said=[]; window.__earOpens=0; window.__cancels=0;
    Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
      paused:false,
      speak(u){ window.__said.push(u.text); window.__lastU=u;
                setTimeout(()=>{ try{ u.onstart&&u.onstart(); }catch(_){} },1); },
      cancel(){ window.__cancels++; },
      resume(){ window.__resumed=(window.__resumed||0)+1; },
      getVoices(){ return []; }
    }});
    function Rec(){ window.__recs=(window.__recs||[]); window.__recs.push(this); }
    Rec.prototype.start=function(){ window.__earOpens++; window.__live=this; };
    Rec.prototype.stop=function(){}; Rec.prototype.abort=function(){};
    window.SpeechRecognition = Rec; window.webkitSpeechRecognition = Rec;
    /* Feed a transcript to whichever recogniser is open. */
    window.__hear=function(text, isFinal){
      const r=window.__live; if(!r||!r.onresult) return false;
      r.onresult({ resultIndex:0, results:[ Object.assign([{transcript:text,confidence:0.9}],
                    {isFinal:isFinal!==false, length:1}) ] });
      return true;
    };
  });

  await p.goto(`http://localhost:${port}/${TARGET}`, { waitUntil:'domcontentloaded' });
  await p.waitForTimeout(2800);

  const base = await p.evaluate(()=>({ ios: VX.ios, hasEar: VX.hasEar, hasOut: VX.hasOut,
                                       w: innerWidth, h: innerHeight }));

  ok('android.this-is-not-an-iphone',
     base.ios === false,
     `V.ios reported ${base.ios} on an Android user agent. Every branch below is the !V.ios one; ` +
     `if this is wrong the suite is testing the iPad path under an Android name.`);

  ok('android.it-is-dans-actual-screen',
     base.w === 412 && base.h === 915,
     `viewport ${base.w}x${base.h}, expected 412x915. The Pixel 7 profile is 412x839 — same width ` +
     `class, different Chrome UI — so it covered his layout and never his exact screen.`);

  ok('android.the-microphone-exists-at-all',
     base.hasEar === true && base.hasOut === true,
     `hasEar=${base.hasEar} hasOut=${base.hasOut}. Chrome on Android has both; if either is false ` +
     `the whole hands-free path is unreachable and Dan is tapping.`);

  /* ---- the hands-free open, which is the whole point on Android ---- */
  const hands = await p.evaluate(async ()=>{
    VX.enable();
    window.__earOpens=0; window.__said=[];
    VX.wantEar = true;
    VX.say('Who scores next, Lynx or Valkyries?');
    await new Promise(z=>setTimeout(z,420));      // barge fires at 220ms
    return { opens: window.__earOpens, said: window.__said.join(' ') };
  });

  ok('android.the-question-is-read-out-loud',
     /Who scores next/.test(hands.said),
     `nothing was spoken: ${JSON.stringify(hands.said)}`);

  ok('android.the-microphone-opens-without-being-asked',
     hands.opens > 0,
     `the ear never opened during the question (${hands.opens} opens). This is the entire Android ` +
     `advantage — on iOS the player must tap 🎙 for every answer, and on Android the mic comes up ` +
     `alongside the speech so the game can be played with the phone face down.`);

  /* ---- THE HAZARD THAT COMES WITH IT ----
     The mic is open while the app is still reading the options aloud, in a
     room with a television on. The app must not answer its own question. */
  const echo = await p.evaluate(async ()=>{
    const out = {};
    S.screen='lobby'; PCI.muted=false; PCI.picked={}; PCI.pending=null;
    const q={ qid:'echo-1', kind:'saw-pitch', state:'open',
              prompt:'That last pitch, what was it?',
              options:[{v:'a',k:'Fastball'},{v:'b',k:'Breaking ball'}],
              opensAt:{ toMillis:()=>Date.now() }, locksMs:20000 };
    PCI.active=q; renderCiCard(q);
    out.cardUp = document.querySelectorAll('#ciCard .ciopt').length;

    let clicked=null;
    document.querySelectorAll('#ciCard .ciopt').forEach(x=>{
      x.addEventListener('click',()=>{ clicked=x.getAttribute('data-civ'); });
    });

    VX.enable(); VX.saidCaughtOnce=true; VX.spokeCatch=null;
    window.__said=[]; window.__earOpens=0;
    VX.wantEar = true;
    VX.askCatch();                       // STATS starts reading the options
    await new Promise(z=>setTimeout(z,420));   // past the 220ms barge window
    out.speaking = VX.speaking === true;
    /* THE REAL ASSERTION: on a Caught It the ear must NOT come up while we
       are still reading. Forcing a transcript in (below) tests the second
       line of defence, not this one. */
    out.earOpenedWhileReading = window.__earOpens;

    /* The loudspeaker comes back through the microphone, mid-sentence. */
    window.__hear('fastball breaking ball', true);
    await new Promise(z=>setTimeout(z,60));
    out.answeredByEcho = clicked;

    /* And a single word of it, which is the nastier case: it matches ONE
       option cleanly and looks exactly like a real answer. */
    window.__hear('fastball', true);
    await new Promise(z=>setTimeout(z,60));
    out.answeredBySingleWord = clicked;
    return out;
  });

  ok('android.the-caught-it-card-really-opened',
     echo.cardUp === 2,
     `the card rendered ${echo.cardUp} options, so the echo checks below would pass for the wrong ` +
     `reason.`);

  ok('android.the-app-is-still-talking-when-the-mic-is-open',
     echo.speaking === true,
     'the app was not speaking, so this does not reproduce the Android condition at all — the ' +
     'whole risk is that the ear is open DURING the utterance.');

  ok('android.the-ear-stays-shut-while-it-reads-a-caught-it',
     echo.earOpenedWhileReading === 0,
     `the microphone opened ${echo.earOpenedWhileReading} time(s) during the Caught It read-out. ` +
     `On Android the mic comes up by itself, so opening it here puts the app's own loudspeaker ` +
     `into its own recogniser while it reads four options aloud. It answers itself. The ear opens ` +
     `when the read-out finishes — at nine seconds that was impossible, at twenty it is right.`);

  ok('android.it-does-not-answer-its-own-option-list',
     echo.answeredByEcho === null,
     `hearing its own option list back answered the question with "${echo.answeredByEcho}". On ` +
     `Android the mic is open while the options are being read aloud, so the loudspeaker is in ` +
     `the microphone. Answering on that is the app playing the game for the player.`);

  ok('android.nor-a-single-word-of-it',
     echo.answeredBySingleWord === null,
     `a single echoed word answered the question with "${echo.answeredBySingleWord}". This is the ` +
     `nastier half: one word matches exactly one option and is indistinguishable from a real ` +
     `answer by content. Only the fact that WE were speaking tells them apart.`);

  /* ---- THE FAILURE THE VOICE LAYER CANNOT REPORT BY TALKING ---- */
  const mute = await p.evaluate(async ()=>{
    /* A browser with the API and no installed voices: Linux without
       speech-dispatcher, and some stripped Chrome and Firefox builds.
       getVoices() stays empty for ever, speak() succeeds, fires no error,
       and produces silence. */
    const real = window.speechSynthesis.getVoices;
    window.speechSynthesis.getVoices = function(){ return []; };
    VX.voicesReady = true;
    const out = { hasOut: VX.hasOut, noVoices: VX.noVoices() };
    window.speechSynthesis.getVoices = real;
    return out;
  });

  ok('android.a-device-with-no-voices-is-detectable',
     mute.hasOut === true && mute.noVoices === true,
     `hasOut=${mute.hasOut} noVoices=${mute.noVoices}. hasOut only asks whether speechSynthesis ` +
     `EXISTS, which it does everywhere. It never asked whether the machine has a voice to speak ` +
     `WITH — so the app said voice was on, the bar said it was reading the question, and nothing ` +
     `came out of the speakers. "You cant hear it eventhough its on", reported three times.`);

  ok('android.no-page-errors', errs.length === 0, errs.slice(0,2).join(' | '));

  await b.close(); srv.close();
  console.log('\n  ' + (fail ? '\x1b[31mRED' : '\x1b[32mGREEN') + '  ' + pass + ' passed, ' + fail + ' failed\x1b[0m\n');
  process.exit(fail ? 1 : 0);
})();
