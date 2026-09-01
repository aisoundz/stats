#!/usr/bin/env node
/* =====================================================================
   THE CHROME BUDGET — how much of the screen is NOT the game.
   ---------------------------------------------------------------------
   WHY THIS SUITE EXISTS. On Game Night #13 the founder, on an iPad:

     "as I move up and down the game still stays and it doesnt move so its
      not natively easy... I dont see the question its just not intuitive
      and its all over."

   538 checks were green. Every one of them. qa/devices.js does test fixed
   elements — but it tests whether they OVERLAP, and it only knows about
   three of them (botnav, pdBar, ciCard). #gameRail is sticky and was never
   in the list, #gtSticky was never in the list, and three bars that do not
   touch each other can still leave a third of the phone.

   OVERLAP IS THE WRONG QUESTION. The right one is OCCUPANCY: add up every
   band of the viewport that a sticky or fixed element has permanently
   taken, and ask what is left for the thing the player came for. Measured
   on 19 Aug against index-test.html, with a four-game rail:

       iPhone SE  375x667   pick sheet  44% claimed
       iPad land 1024x768   pick sheet  41% claimed   <- the founder's screen
       iPhone 15  393x852   pick sheet  35% claimed

   And the second question, which is the one he actually reported: can you
   ever READ the question? Scrolling the pick sheet end to end in 40px
   steps, the question was behind a bar at 21 of 30 positions on an SE and
   19 of 30 on an iPad. It was clear at every position on an iPhone 15,
   which is why this was invisible for a month — the one device it works on
   is the one on the desk.

   THE TWO BUDGETS, and they are deliberately generous. This is a floor
   that catches a regression, not a design target.
     · no screen may give more than 38% of the viewport to chrome
     · the question a player is being asked must be readable at some
       scroll position on every device, and must not be occluded at more
       than half of them

       node qa/chrome.js                       # index-test.html
       node qa/chrome.js index.html            # what is live
       node qa/chrome.js --json                # machine-readable
   ================================================================== */
const PW=require('playwright'); const path=require('path'); const fs=require('fs');
const { waitReady } = require('./ready.js');
const F=require('./fixtures.js');
const ARGS=process.argv.slice(2);
const FILE=ARGS.find(a=>/\.html$/.test(a))||'index-test.html';
const JSONOUT=ARGS.includes('--json');
const TARGET=path.resolve(__dirname,'..',FILE);
if(!fs.existsSync(TARGET)){ console.error('no such file: '+TARGET); process.exit(2); }
const URL='file://'+TARGET;

/* THE BUDGET. 38% is not a taste call — it is one percentage point above
   the best real screen measured on 19 Aug (37% on a 393px phone in the
   worst case) and four below the founder's iPad. Anything that makes the
   chrome worse than it is today fails; nothing that is already shipped
   fails for being shipped. Lower it as the shell lands. */
const MAX_CHROME_PCT = 38;
/* Occlusion: a question hidden at more than half the scroll positions it
   appears at is a question the player has to hunt for. */
const MAX_OCCLUDED_RATIO = 0.5;

/* Every sticky or fixed element that can sit over the game. Named, not
   discovered, because a name in this list is a decision somebody made —
   and the bug was an element NOT being in a list exactly like it. Adding
   a new pinned element without adding it here is the regression. */
const CHROME_IDS=['gameRail','gtSticky','botnav','pdBar','gameBar','ciCard','rail','menuBtn','feedNew'];

/* The devices that disagree. An iPhone 15 is 852px tall and forgives
   everything; an SE and a landscape iPad do not, and between them they are
   most of what a person watching a game actually holds. */
const PROFILES=[
  {n:'iPhone SE',      w:375,  h:667,  e:'webkit'},
  {n:'iPhone 15',      w:393,  h:852,  e:'webkit'},
  {n:'Pixel 7',        w:412,  h:915,  e:'chromium'},
  {n:'iPad portrait',  w:768,  h:1024, e:'webkit'},
  {n:'iPad landscape', w:1024, h:768,  e:'webkit'},
];
const SCREENS=['predict','gametime','lobby','live','board','stats'];

let pass=0, fail=0; const bad=[]; const rows=[];
const ok=(id,cond,why)=>{ if(cond){pass++;} else {fail++;bad.push(id+(why?' — '+why:''));} };

/* Runs INSIDE the page. Union of every claimed band, so two bars that
   overlap are counted once and two that do not are counted twice — which
   is the arithmetic qa/devices.js was missing. */
function measure(ids, screen){
  try{ go(screen); }catch(e){ return null; }
  window.scrollTo(0, Math.floor(document.documentElement.scrollHeight/2));
  void document.documentElement.offsetHeight;
  const vh=window.innerHeight;
  const bands=[], parts=[];
  ids.forEach(id=>{
    const el=document.getElementById(id); if(!el) return;
    const cs=getComputedStyle(el);
    if(cs.display==='none'||cs.visibility==='hidden'||cs.opacity==='0') return;
    if(cs.position!=='fixed'&&cs.position!=='sticky') return;
    const b=el.getBoundingClientRect();
    if(b.height<2||b.bottom<=0||b.top>=vh) return;
    const t=Math.max(0,b.top), bo=Math.min(vh,b.bottom);
    if(bo<=t) return;
    bands.push([t,bo]); parts.push(id+':'+Math.round(bo-t));
  });
  bands.sort((a,c)=>a[0]-c[0]);
  let claimed=0, curT=null, curB=null;
  bands.forEach(([t,bo])=>{
    if(curT===null){curT=t;curB=bo;return;}
    if(t<=curB){ curB=Math.max(curB,bo); } else { claimed+=curB-curT; curT=t; curB=bo; }
  });
  if(curT!==null) claimed+=curB-curT;
  return {screen, vh, claimed:Math.round(claimed), pct:Math.round(claimed/vh*100), parts};
}

/* Can the player read what they are being asked? Walks the whole page in
   40px steps rather than sampling one scroll position, because the bug is
   that SOME positions are fine — sampling is how it stayed hidden. */
function occlusion(ids, screen, sel){
  try{ go(screen); }catch(e){ return null; }
  const q=document.querySelector(sel);
  if(!q||!q.offsetParent) return null;
  const vh=window.innerHeight, H=document.documentElement.scrollHeight;
  let seen=0, hidden=0;
  for(let y=0;y<=H;y+=40){
    window.scrollTo(0,y); void document.documentElement.offsetHeight;
    const bands=[];
    ids.forEach(id=>{
      const el=document.getElementById(id); if(!el) return;
      const cs=getComputedStyle(el); if(cs.display==='none'||cs.visibility==='hidden') return;
      if(cs.position!=='fixed'&&cs.position!=='sticky') return;
      const b=el.getBoundingClientRect();
      if(b.height<2||b.bottom<=0||b.top>=vh) return;
      bands.push([Math.max(0,b.top),Math.min(vh,b.bottom)]);
    });
    const qb=q.getBoundingClientRect();
    if(qb.bottom<=0||qb.top>=vh) continue;
    seen++;
    if(bands.some(([t,bo])=>qb.top<bo&&qb.bottom>t)) hidden++;
  }
  window.scrollTo(0,0);
  return {seen, hidden, sel};
}

(async()=>{
  console.log('\n=== CHROME BUDGET · '+path.basename(TARGET)+' · max '+MAX_CHROME_PCT+'% ===\n');
  const browsers={};
  for(const d of PROFILES){
    if(!browsers[d.e]) browsers[d.e]=await PW[d.e].launch();
    const p=await browsers[d.e].newPage({viewport:{width:d.w,height:d.h},
      deviceScaleFactor:2, isMobile:d.w<900, hasTouch:d.w<1100});
    const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,120)));
    await p.route('**/site.api.espn.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(F.PRE)}));
    await p.route('**/assets.mailerlite.com/**', r=>r.fulfill({status:200,body:'{}'}));
    /* THE HELPERS HAVE TO BE IN THE PAGE. The first version of this file
       defined measure() and occlusion() in Node and called them inside
       p.evaluate(), where they do not exist — so every evaluate threw, the
       .catch(()=>null) swallowed it, and the suite printed "all 0 chrome
       checks pass". A suite that runs nothing and reports success is the
       exact failure qa/all.js was written for; it happened again here, in
       the file written to stop it. Hence the zero-check guard at the end,
       which is the part that is not allowed to be removed. */
    /* window.__ explicitly. Playwright wraps an init script in a function,
       so a bare `function measure(){}` is scoped to that wrapper and is not
       a global — which is precisely how this file first reported that it
       had run zero checks and passed. */
    await p.addInitScript('window.__measure='+measure.toString()+';'
                        + 'window.__occlusion='+occlusion.toString()+';');
    await p.goto(URL,{waitUntil:'domcontentloaded'});
    await p.waitForFunction(()=>typeof window.go==='function',{timeout:25000}).catch(()=>{});
    await waitReady(p);   /* was await p.waitForTimeout(2000); — a guess at boot */

    /* A FOUR-GAME NIGHT, WHICH IS WHAT 29 AUGUST IS. Measuring against a
       one-game rail measures the product we stopped shipping on 18 Aug. */
    await p.evaluate(()=>{
      try{
        SLATE.date='2026-08-19'; SLATE.loaded=true;
        try{ window.loadSlate=async function(){ return; }; }catch(_){}  /* pin the fixture: a late loadSlate() rewrites SLATE.games and the check then grades the live slate. Four suites hit this on 31 Aug. */
        SLATE.games=['tor-wsh','min-gs','lv-ind','sea-atl'].map((k,i)=>({
          nightId:'slate-2026-08-19-'+k, league:'wnba',
          away:k.split('-')[0].toUpperCase(), home:k.split('-')[1].toUpperCase(),
          awayAbbr:k.split('-')[0].toUpperCase(), homeAbbr:k.split('-')[1].toUpperCase(),
          tipISO:'2026-08-20T00:0'+i+':00Z', flagship:i===1, live:i===1,
          awayColor:'#c8102e', homeColor:'#002b5c'}));
        if(typeof paintGameRail==='function') paintGameRail();
      }catch(e){}
    });
    /* A REAL PICK SHEET. An empty #predCard has no question in it, so the
       occlusion check silently measures nothing — which is the same shape
       of false green this suite exists to end. */
    await p.evaluate(()=>{ try{ startDemo(); S.name='QA'; startPredict(); }catch(e){} });
    await p.waitForTimeout(700);

    console.log(d.n+'  '+d.w+'x'+d.h+'  ('+d.e+')');
    for(const scr of SCREENS){
      const m=await p.evaluate(([ids,scr])=>window.__measure(ids,scr), [CHROME_IDS,scr])
        .catch(()=>null);
      if(!m) continue;
      const id='chrome.'+d.n.replace(/\s+/g,'-')+'.'+scr;
      const over=m.pct>MAX_CHROME_PCT;
      ok(id, !over, m.pct+'% of '+m.vh+'px claimed by ['+m.parts.join(' ')+']');
      rows.push(Object.assign({device:d.n,w:d.w,h:d.h},m));
      console.log('  '+(over?'\x1b[31m✗\x1b[0m':'\x1b[32m✓\x1b[0m')+' '+scr.padEnd(9)
        +String(m.pct+'%').padStart(4)+' of '+String(m.vh+'px').padEnd(7)
        +' ['+m.parts.join(' ')+']');
    }
    /* THE QUESTION. Two of them: the pick sheet's and the live round's. */
    for(const [scr,sel,label] of [['predict','#predCard .pdq','pick question'],
                                  ['live','#qText','live question']]){
      const o=await p.evaluate(([ids,scr,sel])=>window.__occlusion(ids,scr,sel),[CHROME_IDS,scr,sel]).catch(()=>null);
      if(!o||!o.seen) continue;
      const ratio=o.hidden/o.seen;
      const id='chrome.'+d.n.replace(/\s+/g,'-')+'.'+scr+'.readable';
      ok(id, ratio<=MAX_OCCLUDED_RATIO, label+' behind chrome at '+o.hidden+' of '+o.seen+' scroll positions');
      console.log('  '+(ratio>MAX_OCCLUDED_RATIO?'\x1b[31m✗\x1b[0m':'\x1b[32m✓\x1b[0m')+' '
        +label.padEnd(15)+'occluded '+o.hidden+'/'+o.seen+' scroll positions');
    }
    if(errs.length){ fail++; bad.push(d.n+' threw: '+errs[0]); console.log('  \x1b[31m✗\x1b[0m JS error: '+errs[0]); }
    console.log('');
    await p.close();
  }
  for(const k in browsers) await browsers[k].close();
  if(JSONOUT) console.log(JSON.stringify(rows,null,1));
  console.log('──────────────────────────────────────────────');
  if(fail){ console.log('\x1b[31m'+fail+' FAILED\x1b[0m of '+(pass+fail));
            bad.forEach(b=>console.log('  • '+b)); process.exit(1); }
  /* A GATE THAT MEASURED NOTHING HAS NOT PASSED. Five profiles x six
     screens plus two readability checks is 40 at the floor; anything under
     that means screens were skipped and the verdict is worthless. */
  const FLOOR = PROFILES.length * 4;
  if(pass < FLOOR){
    console.log('\x1b[31mONLY '+pass+' CHECKS RAN — expected at least '+FLOOR+'\x1b[0m');
    console.log('  the suite did not measure the app; treat this as a failure, not a pass');
    process.exit(1);
  }
  console.log('\x1b[32mall '+pass+' chrome checks pass\x1b[0m'); process.exit(0);
})().catch(e=>{ console.error(e); process.exit(2); });
