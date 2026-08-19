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

/* EVERY ROOM, NOT JUST THE FRONT DOOR — and this is the correction that
   matters more than the suite's first version.

   Round one of this suite loaded statsgametime.com and walked every screen.
   It went green. The founder then opened
   `?game=slate-2026-08-19-sj-la&sport=soccer` and found "Kickoff TBD — swap
   this when the Leagues Cup draw lands" on the hero, which is the exact
   string this file was written to catch.

   The suite had checked the default room. The bug lived one room over. That
   is the same mistake in a new costume: THE THING THAT WAS BUILT WAS
   VERIFIED, THE THING A PERSON WOULD EXPERIENCE WAS NOT — and a suite that
   makes it is worse than no suite, because it signs off. So the rail is
   read first and every room on it is opened in turn. */
async function walk(p, label, url, found){
  await p.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  /* The rail and the night config both come from Firestore. Reading before
     they land measures an empty page and calls it clean — this suite's own
     failure mode, arriving through the suite itself. */
  await p.waitForTimeout(6500);

  if(SABOTAGE){
    await p.evaluate(()=>{
      const t=document.querySelector('.grTile') || document.querySelector('h1') || document.body;
      t.insertAdjacentHTML('beforeend','<span> Kickoff TBD — swap this when the draw lands</span>');
    });
  }

  const tiles=await p.$$eval('.grTile, .grMore', ns=>ns.map(n=>n.innerText||''));
  tiles.forEach((t,i)=>found.push(...scan(label+' · rail tile '+(i+1), t)));

  /* ---- A COMPETITION THIS ROOM IS NOT IN -----------------------------
     The other half of the soccer card, and the half no placeholder list
     can catch: "MLS v LIGA MX — Aug 4 to Sep 6" under a live MLS match,
     and a chip reading "Leagues Cup". Neither is a placeholder. Both are
     REAL COMPETITIONS, spelled correctly, in the right element — they are
     simply not the one being played, because the label was read off the
     SPORT and one sport has many leagues.

     So: the hero may name the room's own competition and no other. Narrow
     on purpose — it looks only at the hero caption and chips, where the
     league label belongs, not at prose that may legitimately mention
     another league. */
  const COMPS=['Leagues Cup','Liga MX','Champions League','Premier League','La Liga',
               'Serie A','Bundesliga','Ligue 1','NWSL','WNBA','NBA','NFL','MLB','MLS','NHL'];
  const hero=await p.evaluate(()=>{
    const t=id=>{const e=document.getElementById(id); return e?(e.textContent||''):'';};
    let lg=''; try{ lg=String((window.GAME||{}).league||'').toUpperCase(); }catch(_){}
    return {lg, text:[t('landingMatch'),t('landingChip1'),t('landingChip3'),t('landingHead')].join(' | ')};
  });
  if(hero.lg){
    /* WORD BOUNDARIES, BECAUSE "NBA" IS INSIDE "WNBA". indexOf reported the
       WNBA room as naming the NBA — an unanchored pattern IS a substring
       match, which is the oldest bug in this repo and it got me again in
       the check written to stop bugs. */
    const wrong=COMPS.filter(c => c.toUpperCase()!==hero.lg
      && new RegExp('\\b'+c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b').test(hero.text));
    wrong.forEach(c => found.push(label+' hero names "'+c+'" but the room is '+hero.lg
      +'   (in: "'+hero.text.trim().slice(0,120)+'")'));
  }

  const screens=await p.$$eval('.screen', ns=>ns.map(n=>n.id));
  let chars=0, hits=0;
  for(const id of screens){
    const txt=await p.evaluate(sid=>{
      document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
      const s=document.getElementById(sid); if(!s) return '';
      s.classList.add('active');
      return s.innerText||'';
    }, id);
    chars+=txt.length;
    const h=scan(label+' · '+id, txt);
    hits+=h.length; found.push(...h);
  }
  console.log('  '+label.padEnd(34)+String(tiles.length).padStart(2)+' tile(s)  '
    +String(screens.length).padStart(2)+' screen(s)  '+String(chars).padStart(6)+' chars'
    +(hits?'   '+hits+' PROBLEM(S)':''));
}

(async()=>{
  const b=await chromium.launch();
  const p=await b.newPage({viewport:{width:393,height:852}});
  const cb=()=> "cb="+Date.now()+"-"+Math.floor(Math.random()*1e6);
  const found=[];

  /* 1. the front door, and read the rail off it. */
  await walk(p, 'default room', BASE+(BASE.includes('?')?'&':'?')+cb(), found);
  const rooms=await p.evaluate(()=>{
    try{ return (window.SLATE&&SLATE.games||[]).map(g=>({id:g.nightId, sport:g.sport||''})); }
    catch(_){ return []; }
  });
  console.log('  ---- the rail offers '+rooms.length+' room(s); opening each ----');
  if(!rooms.length) console.log('  (none — the slate did not load, so only the default room was read)');

  /* 2. and every other room on it. A room the rail offers is a room a
        person can be standing in. */
  for(const r of rooms){
    const u=BASE+(BASE.includes('?')?'&':'?')+'game='+encodeURIComponent(r.id)
            +(r.sport?('&sport='+encodeURIComponent(r.sport)):'')+'&'+cb();
    await walk(p, r.id, u, found);
  }

  await b.close();

  console.log('');
  ok('copy.no-placeholders-in-any-room', found.length===0,
     found.length ? found.join('\n      ') : '');

  console.log('\n'+(fail
    ? 'FAIL  '+fail+' of '+(pass+fail)+'\n  '+bad.join('\n  ')
    : 'GREEN   '+pass+' passed, 0 failed   ('+(rooms.length+1)+' room(s) on '+BASE+')'));
  process.exit(fail?1:0);
})().catch(e=>{console.error('ERR',e.stack);process.exit(3)});
