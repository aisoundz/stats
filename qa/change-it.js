/* "CHANGE IT" MUST DO SOMETHING ON A REAL SCREEN.
   The founder said it out loud to a live question and the app answered
   "I did not catch that", which is the app telling a player their own
   words are wrong when the app is the one missing a word. Grammar tests
   prove V.match returns {kind:'change'}; only this proves the handler on
   the other side of it exists and speaks.

     node qa/change-it.js [index-test.html] [--sabotage]                */
const {chromium}=require('playwright');
const path=require('path'), fs=require('fs'), os=require('os');
const TARGET=path.resolve(process.argv.find(a=>/\.html$/.test(a)) || path.join(__dirname,'..','index-test.html'));
const SABOTAGE=process.argv.includes('--sabotage');
let pass=0, fail=0; const bad=[];
const ok=(n,c,d)=>{ if(c){pass++; console.log('  ✓ '+n);} else {fail++; bad.push(n+(d?'  — '+d:'')); console.log('  ✗ '+n+(d?'  — '+d:''));} };

(async()=>{
  const b=await chromium.launch(fs.existsSync('/opt/pw-browsers/chromium')?{executablePath:'/opt/pw-browsers/chromium'}:{});
  const p=await b.newPage({viewport:{width:390,height:844}});
  let html=fs.readFileSync(TARGET,'utf8');
  /* SABOTAGE MUST REMOVE THE WHOLE COMMAND, not one alternative of it.
     The first version swapped the bare `change` for a nonsense token and
     left `change it` sitting in the very next slot — so the suite stayed
     green through its own sabotage and proved nothing. A check that cannot
     be made to fail is decoration with a green tick on it. */
  if(SABOTAGE){
    const before=html;
    html=html.replace(/CHANGE:\/\^\(\?:[^\n]*?\/,\n/, 'CHANGE:/^(?:__nothing_matches_this__)$/,\n');
    if(html===before){ console.log('SABOTAGE DID NOT APPLY — the pattern moved; fix this suite'); process.exit(4); }
  }
  const tmp=path.join(os.tmpdir(),'change-under-test.html');
  fs.writeFileSync(tmp,html);
  await p.goto('file://'+tmp);
  await p.waitForFunction(()=>typeof window.VX==='object',{timeout:15000});

  const r=await p.evaluate(()=>{
    const out={said:[]};
    /* No speech engine in headless; capture what it WOULD say. */
    VX.on=true; VX.hasOut=false; VX.hasEar=false; VX.wantEar=false;
    VX.say=function(t,cb){ out.said.push(String(t||'')); if(cb) setTimeout(cb,0); };
    /* Same route qa/payoff.js uses: practice, on the play screen, with the
       question panel rendered — a hidden panel has no options and reads as
       "nothing on screen" rather than as a failure. */
    S.mode='practice'; S.place='play'; S.qi=0; S.ni=0; S.answered=false; S.results=[[]];
    try{ go('gametime'); }catch(_){}
    document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
    document.getElementById('s-gametime').classList.add('active');
    const gtr=document.getElementById('gtReview'); if(gtr) gtr.style.display='none';
    const qp=document.getElementById('gtQuestion'); if(qp) qp.style.display='block';
    /* THE APP'S OWN RENDER, NOT A COPY OF IT. Hand-built option markup
       put the empty <span class="mk"> first, and curOpts() reads the FIRST
       span — so the suite's own options came back as four empty strings and
       the app dutifully offered to read out "1. . 2. . 3. . 4.". That is a
       suite testing itself. loadQuestion() is the real path. */
    try{ loadQuestion(); }catch(e){ out.err='loadQuestion threw: '+(e&&e.message); }
    out.opts=document.querySelectorAll('#qOpts .opt').length;
    out.labels=Array.prototype.map.call(document.querySelectorAll('#qOpts .opt'),
      function(b){ var sp=b.querySelector('span'); return sp?sp.textContent:''; });

    out.said=[]; out.changed = VX.heard('change it'); out.afterChange=out.said.slice();
    out.said=[]; out.locked  = VX.heard('lock it in'); out.afterLock=out.said.slice();
    return out;
  });

  if(r.err) console.log('\n  '+r.err);
  console.log('\n  options on screen: '+r.opts+'   '+JSON.stringify(r.labels));
  console.log('  "change it"  -> '+r.changed+'   said: '+JSON.stringify(r.afterChange));
  console.log('  "lock it in" -> '+r.locked +'   said: '+JSON.stringify(r.afterLock)+'\n');

  ok('change.is-handled', r.changed===true, 'the phrase fell through unhandled');
  ok('change.does-not-say-did-not-catch', !r.afterChange.some(x=>/did not catch/i.test(x)),
     'still answers the founder with "I did not catch that"');
  ok('change.says-something', r.afterChange.length>0, 'handled it silently, which on a phone is a dead mic');
  /* It has to hand the player their options back, in words they can then
     say — not just acknowledge them. And it must never read out a list of
     blanks, which is what a wrong option selector produces. */
  const line=r.afterChange.join(' ');
  ok('change.offers-the-options-again',
     (r.labels||[]).some(l => l && line.indexOf(l)>=0) || /say (the answer|another)/i.test(line),
     'said "'+line+'" — which does not give the player anything to say back');
  ok('change.no-blank-options', !/\d\.\s*\.\s*\d\./.test(line),
     'read out a numbered list with nothing in it');
  ok('lock.still-locks', r.locked===true, 'the opposite command stopped working');

  await b.close();
  console.log('\n'+(fail? 'FAIL  '+fail+' of '+(pass+fail)+'\n  '+bad.join('\n  ')
                        : 'GREEN   '+pass+' passed, 0 failed   ['+path.basename(TARGET)+']'));
  process.exit(fail?1:0);
})().catch(e=>{console.error('ERR',e.stack);process.exit(3)});
