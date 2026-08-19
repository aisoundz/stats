#!/usr/bin/env node
/* =====================================================================
   THE VOICE SPEAKS MORE THAN ONE LANGUAGE.
   ---------------------------------------------------------------------
   WHY THIS SUITE EXISTS. The language tag was written out five times —
   twice onto the utterance, once in the voice filter, once as a scoring
   bonus, once on the recogniser. That is the ONE FACT, MANY COPIES shape
   this codebase is named after, and its failure mode here is the nastiest
   one the feature has: set the language to Spanish and four of the five
   copies keep saying en-US, so the app reads SPANISH WORDS in an ENGLISH
   VOICE to a recogniser LISTENING FOR ENGLISH. Nothing throws. The bar
   says Listening. Every answer is wrong or unheard, and it looks to the
   player like the microphone is broken.

   So the checks below are not "does Spanish work" — they are "is there
   still only one owner", asserted from two directions: the grammar
   answers in Spanish, AND no consumer has quietly grown its own copy of
   the tag again.

   Runs with no network and no browser, like qa/voice.js: the VX block is
   extracted and executed against stubs.

     node qa/voice-lang.js [index-test.html]
   ================================================================== */
const fs=require('fs'), P=require('path');
const TARGET=P.resolve(process.argv[2]||P.join(__dirname,'..','index.html'));
const src=fs.readFileSync(TARGET,'utf8');

let pass=0, fail=0; const bad=[];
const ok=(n,c,d)=>{ if(c){pass++;} else {fail++; bad.push(n+(d?'  — '+d:''));} };

/* ---- 1. THE SOURCE ITSELF: is the tag still owned in one place? ------
   Static checks, because a behavioural test cannot see a hardcoded tag
   on a path it does not happen to exercise. */
const a=src.indexOf('var VX=(function(){'), b=src.indexOf('try{ window.VX=VX; }catch(_){}');
if(a<0||b<0){ console.log('VX block not found in '+TARGET); process.exit(1); }
const vx=src.slice(a,b);

/* The tag may appear ONLY inside the language table. Anywhere else is a
   copy, and a copy is the bug. */
const tableStart=vx.indexOf('var LANGS={'), tableEnd=vx.indexOf("V.lang=(function(){");
ok('lang.table-exists', tableStart>0 && tableEnd>tableStart, 'LANGS table not found');
const outside = vx.slice(0,tableStart) + vx.slice(tableEnd);
const strayTag = (outside.match(/['"]en-US['"]/g)||[]).length;
ok('lang.no-stray-en-US', strayTag===0, strayTag+' hardcoded en-US outside the table');
const strayFilter = /\/\^en\(/.test(outside);
ok('lang.no-stray-en-filter', !strayFilter, 'a voice filter still hardcodes English');
ok('lang.recogniser-reads-owner', /r\.lang\s*=\s*V\.L\(\)\.tag/.test(vx), 'recogniser does not read V.L().tag');
ok('lang.utterance-reads-owner', /u\.lang\s*=\s*V\.L\(\)\.tag/.test(vx), 'utterance does not read V.L().tag');

/* ---- 2. RUN IT ------------------------------------------------------ */
const store={};
global.window={};
global.localStorage={getItem:k=>(k in store?store[k]:null),setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}};
global.document={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({})};
global.navigator={language:'en-US',languages:['en-US'],platform:'',userAgent:'',maxTouchPoints:0};
const VX=new Function(vx+'\nreturn VX;')();

/* A build with no language layer at all must report that as a FAILED
   CHECK, not as a stack trace. The gate reads exit codes, but a human
   reads the line above it, and "TypeError: VX.langs is not a function"
   does not say which promise broke. */
if(typeof VX.langs!=='function' || typeof VX.L!=='function'){
  console.log('\nFAIL  this build has no language layer at all — V.L/V.langs missing');
  console.log('      (every Spanish check below is unrunnable, not passing)');
  process.exit(1);
}
ok('lang.defaults-to-english', VX.lang==='en', 'defaulted to '+VX.lang);
ok('lang.offers-both', VX.langs().length>=2 && VX.langs().some(l=>l.key==='es'), 'Spanish is not offered');

/* ---- 3. THE GRAMMAR, IN EACH LANGUAGE ------------------------------- */
function is(lang, said, opts, want, why){
  VX.lang=lang;
  const m=VX.match(said, opts);
  const got = m ? (m.kind==='pick' ? ('pick:'+opts[m.i]) : m.kind) : 'null';
  ok(lang+'  "'+said+'"', got===want, 'got '+got+', expected '+want+(why?'  ('+why+')':''));
}

/* Real Spanish option sets, written the way a Spanish bank would be. */
const SN=['Sí','No'], EQ=['Valkyries','Wings','Igual'],
      BANDA=['Ninguno o uno','Dos o tres','Cuatro o cinco','Seis o más'],
      TIRO=['Tiros de salto','Penetraciones','Igual'];

console.log('\nSPANISH — numbers, which is the path the prompt teaches');
is('es','uno',SN,'pick:Sí');
is('es','dos',SN,'pick:No');
is('es','numero dos',SN,'pick:No','the run-up is stripped');
is('es','digo tres',BANDA,'pick:Dos o tres','a number means the band that holds it');
is('es','elijo cuatro',BANDA,'pick:Cuatro o cinco','chatty or terse, same answer');
is('es','4',BANDA,'pick:Cuatro o cinco');

console.log('SPANISH — the option, said out loud, accents and all');
is('es','sí',SN,'pick:Sí','an accent must not cost a point');
is('es','si',SN,'pick:Sí','and neither must its absence');
is('es','seis o mas',BANDA,'pick:Seis o más');
is('es','seis',BANDA,'pick:Seis o más','nobody reads an option out in full');
is('es','igual',EQ,'pick:Igual');
is('es','tiros de salto',TIRO,'pick:Tiros de salto');
is('es','penetraciones',TIRO,'pick:Penetraciones');

console.log('SPANISH — the commands');
is('es','listo',SN,'lock');
is('es','siguiente',SN,'lock');
is('es','repite',SN,'repeat');
is('es','otra vez',SN,'repeat');
is('es','opciones',SN,'help');
is('es','silencio',SN,'off');

console.log('SPANISH — and it still refuses rather than guesses');
is('es','no se',BANDA,'null','not an answer, and must not become one');

console.log('ENGLISH — unchanged by all of the above');
const YN=['Yes','No'], BAND=['None or one','Two or three','Four or five','Six or more'];
is('en','one',YN,'pick:Yes');
is('en','I pick four',BAND,'pick:Four or five');
is('en','lock it in',YN,'lock');
is('en','repeat',YN,'repeat');
is('en','six',BAND,'pick:Six or more');

/* ---- 4. THE ENGLISH COMMANDS MUST NOT FIRE IN SPANISH, AND VICE VERSA
   "no" is a Spanish answer AND an English word; "final" is a lock word in
   both. The real risk is a Spanish player saying an option that happens to
   be an English command. */
console.log('\nTHE LANGUAGES DO NOT LEAK INTO EACH OTHER');
VX.lang='es';
ok('es  "next" is not a Spanish command', (()=>{const m=VX.match('next',SN); return !m||m.kind!=='lock';})(),
   'an English command fired in a Spanish room');
VX.lang='en';
ok('en  "listo" is not an English command', (()=>{const m=VX.match('listo',YN); return !m||m.kind!=='lock';})(),
   'a Spanish command fired in an English room');

/* ---- 5. CHANGING LANGUAGE DROPS THE VOICE ---------------------------
   An English voice reading Spanish is worse than making no choice at all,
   so the saved pick must not survive the switch. */
VX.lang='en';
store['stats_voice_pick_v1']='Daniel';
VX.setLang('es');
ok('lang.switch-drops-the-voice', store['stats_voice_pick_v1']===undefined,
   'the old language’s voice survived the switch');
ok('lang.switch-is-remembered', store['stats_lang_v1']==='es', 'the choice was not saved');
VX.setLang('en');

/* ---- 6. A SPANISH PHONE MUST NOT BE AUTO-SWITCHED INTO A HALF-BUILT
   ROOM. The voice can pronounce Spanish; the question bank is not
   translated yet. Auto-detecting the device would give a Spanish speaker a
   Spanish synthesiser reading ENGLISH questions — worse than leaving them
   in English, and aimed precisely at the people the feature is for.
   An EXPLICIT choice is still honoured: that is someone asking to see the
   half that exists. */
console.log('\nTHE DEVICE IS ONLY TRUSTED AS FAR AS THE CONTENT IS READY');
ok('lang.content-gate-exists', typeof VX.contentReady==='function', 'no contentReady()');
if(typeof VX.contentReady==='function'){
  ok('lang.english-content-ready', VX.contentReady('en')===true);
  const esReady=VX.contentReady('es');
  ok('lang.gate-is-honest', typeof esReady==='boolean');
  /* Rebuild VX with a Spanish device to prove the gate actually bites. */
  global.navigator={language:'es-MX',languages:['es-MX'],platform:'',userAgent:'',maxTouchPoints:0};
  for(const k of Object.keys(store)) delete store[k];
  const VX2=new Function(vx+'\nreturn VX;')();
  if(esReady) ok('lang.spanish-device-gets-spanish', VX2.lang==='es', 'content is ready but the device was ignored');
  else        ok('lang.spanish-device-stays-english', VX2.lang==='en',
                 'a Spanish phone was auto-switched into a room whose questions are still English');
  /* ...and an explicit ask is still honoured either way. */
  global.navigator={language:'es-MX',languages:['es-MX'],platform:'',userAgent:'',maxTouchPoints:0};
  store['stats_lang_v1']='es';
  const VX3=new Function(vx+'\nreturn VX;')();
  ok('lang.explicit-choice-always-wins', VX3.lang==='es', 'an explicit Spanish choice was overridden by the gate');
}

console.log('\n'+(fail?'FAIL':'PASS')+'  '+pass+' passed, '+fail+' failed   ['+P.basename(TARGET)+']');
bad.forEach(x=>console.log('   x '+x));
process.exit(fail?1:0);
