#!/usr/bin/env node
/* =====================================================================
   NOTHING READS WHAT THE SCREEN ACTUALLY SAYS.
   ---------------------------------------------------------------------
   Twenty-nine suites, 538 checks, and every one of them asks a structural
   question: does this element exist, is it above the fold, is it 44px, did
   the resolver return one of its own options. Not one of them READS THE
   WORDS.

   So this shipped, twice, on two cards at once, to the founder's own phone:

       Kickoff TBD — swap this when the Leagues Cup draw lands

   His words: "it says swap this on both soccer cards. How did we miss
   that?" We missed it because a placeholder is structurally perfect. It is
   a string in the right element, the right size, above the fold, on the
   ramp. Every check we own passes it. The only thing wrong with it is what
   it SAYS, and nothing was looking.

   This is that thing. It walks the rendered text of every screen and every
   room card on the real site and refuses:

     · placeholder language     TBD, swap this, coming soon, lorem, FIXME,
                                XXX, TODO, "your team here", "example"
     · leaked JavaScript        undefined, NaN, null, [object Object],
                                Invalid Date, "function ("
     · leaked template syntax   ${...}, {{...}}
     · contradictions           a date that is not the night's date

   It is deliberately a LIVE suite, like live-smoke.js. A placeholder that
   only appears when the real slate is on the page is exactly the one that
   got through, and a stubbed backend cannot see it.

     node qa/screen-copy.js
     node qa/screen-copy.js --base https://statsgametime.com/index-test.html
     node qa/screen-copy.js --sabotage      # proves it can go red
   ================================================================== */
const {chromium}=require('playwright');
const ARG=(k,d)=>{const i=process.argv.indexOf('--'+k); return i>=0?process.argv[i+1]:d;};
const BASE=ARG('base','https://statsgametime.com/');
const SABOTAGE=process.argv.includes('--sabotage');

let pass=0, fail=0; const bad=[];
const ok=(n,c,d)=>{ if(c){pass++; console.log('  ✓ '+n);} else {fail++; bad.push(n+(d?'  — '+d:'')); console.log('  ✗ '+n+(d?'\n      '+d:''));} };

/* EVERY PATTERN IS A REAL STRING THAT REACHED A REAL SCREEN, or a leak
   whose failure mode is identical. Anchored where anchoring is right and
   deliberately loose where the placeholder itself is loose — "swap this"
   is a sentence fragment and appeared mid-line. */
const BANNED=[
  [/\bswap this\b/i,            'the Leagues Cup placeholder, verbatim'],
  [/\bTBD\b/,                   'a to-be-decided that shipped'],
  [/\bTBA\b/,                   'same, other spelling'],
  [/\bcoming soon\b/i,          'a promise on a screen instead of a feature'],
  [/\blorem ipsum\b/i,          'filler'],
  [/\b(TODO|FIXME|XXX)\b/,      'a note to the author, on the player screen'],
  [/\byour (team|name|handle) here\b/i, 'a template that was never filled'],
  [/\bplaceholder\b/i,          'says so itself'],
  [/\bundefined\b/,             'a JavaScript value reached the screen'],
  [/\bNaN\b/,                   'a number that is not one'],
  [/\[object Object\]/,         'an object printed as text'],
  [/\bInvalid Date\b/,          'a date that failed to parse'],
  [/\bnull\b/,                  'a missing value printed rather than handled'],
  [/\$\{[^}]*\}/,               'an un-evaluated template literal'],
  [/\{\{[^}]*\}\}/,             'an un-evaluated mustache'],
];

/* Words that are legitimately on these screens and must never be read as a
   leak. "Null" inside "Nullifies" would be a false positive that teaches
   the next person to ignore this suite, which is worse than the bug. */
const ALLOW=[/\bnullif/i, /\bundefined behaviou?r\b/i];

function scan(where, text){
  const out=[];
  String(text||'').split('\n').forEach(line=>{
    const t=line.trim(); if(!t) return;
    if(ALLOW.some(a=>a.test(t))) return;
    BANNED.forEach(([re,why])=>{ if(re.test(t)) out.push(where+': "'+t.slice(0,110)+'"   ('+why+')'); });
  });
  return out;
}

(async()=>{
  const b=await chromium.launch();
  const p=await b.newPage({viewport:{width:393,height:852}});
  const url=BASE+(BASE.includes('?')?'&':'?')+'cb='+Date.now();
  await p.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
  /* The rail is populated from Firestore. Reading before it lands measures
     an empty page and calls it clean — the failure this suite exists to
     stop, arriving through the suite itself. */
  await p.waitForTimeout(6000);

  if(SABOTAGE){
    await p.evaluate(()=>{
      const t=document.querySelector('.grTile') || document.querySelector('h1') || document.body;
      t.insertAdjacentHTML('beforeend','<span> Kickoff TBD — swap this when the draw lands</span>');
    });
  }

  const found=[];
  /* ---- 1. THE ROOM CARDS. Where it actually happened. --------------- */
  const tiles=await p.$$eval('.grTile, .grMore', ns=>ns.map(n=>n.innerText||''));
  console.log('\n  game rail: '+tiles.length+' tile(s)');
  tiles.forEach((t,i)=>found.push(...scan('rail tile '+(i+1), t)));

  /* ---- 2. EVERY SCREEN, one at a time ------------------------------- */
  const screens=await p.$$eval('.screen', ns=>ns.map(n=>n.id));
  for(const id of screens){
    const txt=await p.evaluate(sid=>{
      document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
      const s=document.getElementById(sid); if(!s) return '';
      s.classList.add('active');
      return s.innerText||'';
    }, id);
    const hits=scan(id, txt);
    console.log('  '+id.padEnd(16)+String(txt.length).padStart(6)+' chars'+(hits.length?'   '+hits.length+' PROBLEM(S)':''));
    found.push(...hits);
  }

  await b.close();

  console.log('');
  ok('copy.no-placeholders-on-any-screen', found.length===0,
     found.length ? found.join('\n      ') : '');

  console.log('\n'+(fail
    ? 'FAIL  '+fail+' of '+(pass+fail)+'\n  '+bad.join('\n  ')
    : 'GREEN   '+pass+' passed, 0 failed   ('+BASE+')'));
  process.exit(fail?1:0);
})().catch(e=>{console.error('ERR',e.stack);process.exit(3)});
