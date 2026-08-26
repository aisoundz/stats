#!/usr/bin/env node
/* =====================================================================
   WHICH GAME AM I IN? — THE RAIL'S SELECTED STATE, IN PIXELS.
   ---------------------------------------------------------------------
   Founder, 25 Aug 2026, with a screenshot:

     "we need to have a better way of showing which game is highlighted
      cause when I highlight a game, it's not the one highlighted."

   The URL was ?game=slate-2026-08-25-lad-atl. The hero read "Dodgers at
   Braves". The star was correctly on MLB #30. And in the rail the MLB
   tile — the room he was standing in — was the DIM, borderless one, while
   the WNBA tile beside it was bright and clearly outlined. Every other
   signal on the page was right and the one that answers "where am I" read
   backwards.

   THE CAUSE, measured on the shipped build at 390x844:

       current tile   opacity 0.5   border-color rgba(0,0,0,0)
       other tile     opacity 1     border-color rgba(255,255,255,.09)

   The current tile is marked `disabled`, which is correct — you cannot
   switch to the room you are already in — and `.grTile[disabled]` carried
   `opacity:.5`, which drew the whole selected state (a gradient border via
   the border-box trick, plus a 1px lift) at half strength on a small dark
   tile, where it vanishes. Greyed out means unavailable in every interface
   anybody has ever used.

   ---------------------------------------------------------------------
   WHY THIS SUITE READS PIXELS AND NOT ATTRIBUTES.

   `aria-current="true"` was present and correct on the broken build. So
   was `disabled`. So was the whole `.grTile[aria-current]` rule. An
   attribute check, a class check, or a "does the rule exist in the
   stylesheet" check all pass on the build the founder photographed. THE
   BUG IS ENTIRELY IN WHAT WAS PAINTED, so what is painted is what is
   measured: the rail is screenshotted, handed back to the page as a data
   URL, drawn into a canvas, and read pixel by pixel.

   Two numbers per tile:

     ink   the mean luminance of the sixty brightest pixels inside the
           tile. That is the TEXT — a near-white team name on a near-black
           tile — and it is what halves when opacity does. Shipped build:
           ~136 on the current tile against 255 on the one next to it,
           because a 50% white glyph over a 5% background cannot get past
           the middle of the range however many of them there are.
     edge  |mean luminance of the 1px border ring − mean luminance of the
           rail just outside it|. "Is there a visible border at all."

   and the assertion is the founder's sentence, in numbers: the tile you
   are IN must not be dimmer, and must not be less bordered, than a tile
   you are not in.

   AND THE WORDS, NOT ONLY THE TREATMENT. He asked for "a better way",
   which a gradient border is not — it is a treatment, and a treatment has
   to be taught. The current tile now says "Watching" in the same words
   the rail's own header asks the question in, in teal, in BOTH densities,
   and never on more than one tile. That is checked as RENDERED TEXT on a
   VISIBLE element, because a label inside a display:none block is not a
   label (the lesson qa/slate.js learned counting stars).

   IT MUST GO RED ON index.html:

       node qa/rail-current.js index.html         # expect RED
       node qa/rail-current.js index-test.html    # expect GREEN
       node qa/rail-current.js --sabotage         # expect RED

   ENGINES. --firefox (default) and --chromium. WebKit crashes on this
   Jetson and is not claimed. Nor is any real device: this is a rendering
   claim about two browser engines on one Linux box.
   ================================================================== */
const PW=require('playwright');
const path=require('path'), fs=require('fs'), os=require('os');
const F=require('./fixtures.js');
const {waitReady}=require('./ready.js');

const ARG=process.argv.slice(2);
const TARGET=path.resolve(ARG.find(a=>/\.html$/.test(a)) || path.join(__dirname,'..','index-test.html'));
const SABOTAGE=ARG.includes('--sabotage');
const ENGNAME=ARG.includes('--chromium')?'chromium':'firefox';
const ENG=PW[ENGNAME];

let pass=0, fail=0; const bad=[];
const ok=(n,c,d)=>{ if(c) pass++; else { fail++; bad.push(n+(d?'  — '+d:'')); } };

/* Put the bug back, both halves of it. If this file still passes with the
   dimming reattached to the current tile and the word taken off it, it is
   measuring nothing. */
function sabotage(html){
  let h=html;
  const dim=/\.grTile\[disabled\]:not\(\[aria-current="true"\]\)\{opacity:\.5;cursor:default\}/;
  const word=/\+ \(on \? '<span class="grHere"><i><\/i>Watching<\/span>' : ''\)\n/;
  if(!dim.test(h)) throw new Error('sabotage could not find the scoped [disabled] rule — the fix changed shape and this file must be updated with it');
  if(!word.test(h)) throw new Error('sabotage could not find the .grHere emission — the fix changed shape and this file must be updated with it');
  h=h.replace(dim, '.grTile[disabled]{opacity:.5;cursor:default}');
  h=h.replace(word, '');
  return h;
}

/* TOMORROW'S SLATE, near enough. Two games, one of them the Game of the
   Night so the gold star is on screen at the same time as the teal marker
   and the two can be told apart — which is a requirement, not a detail. */
const GAMES=`[
  {nightId:'slate-2026-08-25-lad-atl',league:'mlb',gn:30,gotn:true,
   away:'Dodgers',home:'Braves',awayAbbr:'LAD',homeAbbr:'ATL',
   awayColor:'#005A9C',homeColor:'#CE1141',tipISO:'2026-08-26T00:00:00Z'},
  {nightId:'slate-2026-08-25-lv-sea',league:'wnba',gn:19,
   away:'Aces',home:'Storm',awayAbbr:'LV',homeAbbr:'SEA',
   awayColor:'#111111',homeColor:'#2C5234',tipISO:'2026-08-26T02:00:00Z'},
  {nightId:'slate-2026-08-25-chi-ind',league:'wnba',gn:20,
   away:'Sky',home:'Fever',awayAbbr:'CHI',homeAbbr:'IND',
   awayColor:'#418FDE',homeColor:'#FDBB30',tipISO:'2026-08-26T02:00:00Z'}]`;

async function stage(w,h,compact){
  const b=await ENG.launch();
  const ctx=await b.newContext({viewport:{width:w,height:h}, deviceScaleFactor:1});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,160)));

  let html=fs.readFileSync(TARGET,'utf8');
  if(SABOTAGE) html=sabotage(html);
  const tmp=path.join(os.tmpdir(),'rail-current-under-test-'+process.pid+'.html');
  fs.writeFileSync(tmp,html);

  await p.route('**/site.api.espn.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(F.PRE)}));
  await p.route('**/assets.mailerlite.com/**', r=>r.fulfill({status:200,body:'{}'}));
  await p.goto('file://'+tmp,{waitUntil:'domcontentloaded'});
  await waitReady(p);

  await p.evaluate(({games,compact})=>{
    /* PIN THE FEED. GS.ok flips true→false inside loadGameStats before its
       first await, so anything measured across that boundary is a coin
       toss — and this suite measures colour, which the ticker writes. */
    try{ window.loadGameStats=async function(){ return null; }; }catch(_){}
    try{ GS.ok=false; GS.ev=null; }catch(_){}
    SLATE.date='2026-08-25'; SLATE.loaded=true;
    SLATE.games=eval(games);
    GAME.nightId='slate-2026-08-25-lad-atl';
    /* THE DENSITY IS DECIDED BY WHICH SECTION IS .active — paintGameRail()
       asks the DOM, deliberately, because every variable it used to ask
       could be stale. So the stage direction is a class, not a flag. */
    document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
    document.getElementById(compact ? 's-gametime' : 's-landing').classList.add('active');
    paintGameRail();
  }, {games:GAMES, compact:!!compact});

  /* A rectangle measured before the webfont swaps is a different
     rectangle, and so is a luminance. */
  try{ await p.evaluate(()=>document.fonts && document.fonts.ready); }catch(_){}
  await p.waitForTimeout(250);
  return {b,p,errs};
}

/* ---- WHAT THE DOM SAYS ------------------------------------------- */
const READ = ()=>{
  const rail=document.getElementById('gameRail');
  const rr=rail.getBoundingClientRect();
  const vis=el=>!!el && el.offsetParent!==null;
  const eff=el=>{ let o=1,n=el; while(n && n!==document.documentElement){
      const v=parseFloat(getComputedStyle(n).opacity); if(isFinite(v)) o*=v; n=n.parentElement; }
    return Math.round(o*1000)/1000; };
  const tiles=[...rail.querySelectorAll('.grTile')].filter(t=>!t.hasAttribute('data-railmore'))
    .map(t=>{
      const r=t.getBoundingClientRect(), cs=getComputedStyle(t);
      const here=t.querySelector('.grHere');
      const star=[...t.querySelectorAll('.grStar')].filter(vis)[0]||null;
      return {
        cur: t.getAttribute('aria-current')==='true',
        disabled: t.hasAttribute('disabled'),
        opacity: eff(t),
        borderW: parseFloat(cs.borderTopWidth)||0,
        x:r.x-rr.x, y:r.y-rr.y, w:r.width, h:r.height,
        label: (t.textContent||'').replace(/\s+/g,' ').trim().slice(0,40),
        here: here ? {
          shown: vis(here),
          text: (here.textContent||'').replace(/\s+/g,' ').trim(),
          colour: getComputedStyle(here).color,
          size: parseFloat(getComputedStyle(here).fontSize)||0,
          /* CLIPPED IS NOT SHOWN. A marker whose word runs past its own box
             is the rail's original sin one element smaller. */
          clipped: here.scrollWidth > here.clientWidth+1,
          overflowsTile: Math.round(here.getBoundingClientRect().right - r.right)
        } : null,
        star: star ? {shown:true, colour:getComputedStyle(star).color} : null
      };
    });
  return {
    mode: rail.getAttribute('data-mode'),
    railH: Math.round(rr.height),
    rail:{x:rr.x,y:rr.y,w:rr.width,h:rr.height},
    tiles
  };
};

/* ---- WHAT THE SCREEN SAYS ----------------------------------------
   The rail is screenshotted by the driver, handed back to the page as a
   data: URL and drawn into a canvas, because a data: URL does not taint
   one. The browser does the PNG decoding, which is why this needs no image
   library and works identically on both engines. */
const PIXELS = async ({dataUrl,tiles})=>{
  const img=new Image(); img.src=dataUrl; await img.decode();
  const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
  const g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(img,0,0);
  const D=g.getImageData(0,0,c.width,c.height).data;
  const at=(x,y)=>{ x=Math.round(x); y=Math.round(y);
    if(x<0||y<0||x>=c.width||y>=c.height) return null;
    const i=(y*c.width+x)*4; return 0.2126*D[i]+0.7152*D[i+1]+0.0722*D[i+2]; };
  const mean=a=>{ const v=a.filter(z=>z!=null); return v.length ? v.reduce((s,z)=>s+z,0)/v.length : 0; };
  return tiles.map(t=>{
    const x0=Math.round(t.x), y0=Math.round(t.y), w=Math.round(t.w), h=Math.round(t.h);
    const inside=[];
    for(let y=y0+4;y<y0+h-4;y++) for(let x=x0+4;x<x0+w-4;x++){
      const v=at(x,y); if(v!=null) inside.push(v); }
    inside.sort((a,b)=>b-a);
    /* THE BRIGHTEST 60 PIXELS, AVERAGED — not the maximum and not a
       percentile. The maximum is one antialiased pixel of one glyph and
       proves nothing. A percentile was the first attempt and it is a trap:
       the current tile is TALLER than its neighbours (it carries the
       marker line), so the same amount of white text sits at a lower
       percentile of a larger area, and a perfectly bright tile scored
       lower than a dim one at 320x568. A fixed count of the brightest
       pixels asks the question that was meant — "how white is the whitest
       text on this tile" — and does not care how big the tile is. */
    const K=Math.min(60, inside.length);
    const ink = K ? inside.slice(0,K).reduce((s,z)=>s+z,0)/K : 0;
    const ring=[], out=[];
    for(let x=x0+6;x<x0+w-6;x++){ ring.push(at(x,y0)); ring.push(at(x,y0+h-1));
      out.push(at(x,y0-3)); out.push(at(x,y0+h+2)); }
    for(let y=y0+6;y<y0+h-6;y++){ ring.push(at(x0,y)); ring.push(at(x0+w-1,y));
      out.push(at(x0-3,y)); out.push(at(x0+w+2,y)); }
    return {cur:t.cur, ink:Math.round(ink), body:Math.round(inside.reduce((s,z)=>s+z,0)/(inside.length||1)),
            edge:Math.round(Math.abs(mean(ring)-mean(out))*10)/10};
  });
};

const SIZES=[
  {w:390,h:844, compact:false, why:'an iPhone on the landing, choosing'},
  {w:390,h:844, compact:true,  why:'the same phone inside a room, mid-game'},
  {w:320,h:568, compact:false, why:'the narrowest phone the rail claims'},
  {w:1440,h:788,compact:false, why:"the founder's laptop"}
];

(async()=>{
  console.log('\n=== WHICH GAME AM I IN ===   '
    + path.basename(TARGET) + ' · ' + ENGNAME + (SABOTAGE?' · SABOTAGED':''));

  for(const s of SIZES){
    const key = s.w+'x'+s.h+(s.compact?'.compact':'.tiles');
    const {b,p,errs}=await stage(s.w,s.h,s.compact);
    const dom=await p.evaluate(READ);
    const shot=await p.screenshot({clip:{x:Math.round(dom.rail.x),y:Math.round(dom.rail.y),
      width:Math.round(dom.rail.w),height:Math.round(dom.rail.h)}});
    const px=await p.evaluate(PIXELS,
      {dataUrl:'data:image/png;base64,'+shot.toString('base64'), tiles:dom.tiles});
    await b.close();

    const cur=dom.tiles.filter(t=>t.cur), others=dom.tiles.filter(t=>!t.cur);
    const pxCur=px.filter(t=>t.cur), pxOth=px.filter(t=>!t.cur);

    console.log('\n  ' + s.w + 'x' + s.h + '  ' + (s.compact?'compact':'tiles')
      + '   (' + s.why + ')   rail ' + dom.railH + 'px, ' + dom.tiles.length + ' tiles');
    px.forEach((t,i)=>console.log('    ' + (t.cur?'YOU → ':'      ')
      + 'ink ' + String(t.ink).padStart(3) + '   body ' + String(t.body).padStart(3)
      + '   edge ' + String(t.edge).padStart(5)
      + '   opacity ' + dom.tiles[i].opacity
      + '   "' + dom.tiles[i].label + '"'));

    ok(key+'.exactly-one-tile-is-the-current-room',
       cur.length===1 && others.length>=1,
       cur.length + ' tiles claim to be the current room, ' + others.length + ' do not');
    if(cur.length!==1 || !pxCur.length){ ok(key+'.no-page-errors', errs.length===0, errs.slice(0,2).join(' · ')); continue; }

    /* ---- 1. THE FOUNDER'S SENTENCE, IN PIXELS --------------------- */
    const inkCur=pxCur[0].ink, inkOth=Math.max(...pxOth.map(t=>t.ink));
    ok(key+'.the-room-you-are-in-is-not-dimmer-than-one-you-are-not',
       inkCur >= inkOth-10,
       'the tile you are in renders at ink ' + inkCur + ' against ' + inkOth
       + ' on a tile you are not in — it is the greyed-out one, and greyed out reads as unavailable');

    const edgeCur=pxCur[0].edge, edgeOth=Math.max(...pxOth.map(t=>t.edge));
    ok(key+'.the-room-you-are-in-is-not-less-bordered',
       edgeCur >= edgeOth-1,
       'border contrast against the rail behind it: ' + edgeCur + ' on the current tile, '
       + edgeOth + ' on a tile that is merely available');

    /* The cause, stated directly, so a red run says WHY and not only
       THAT. Effective opacity — the product up the tree, because a parent
       can dim a child that is itself at 1. */
    ok(key+'.the-unavailable-styling-does-not-apply-to-it',
       cur[0].opacity >= 0.999,
       'the current tile renders at effective opacity ' + cur[0].opacity
       + '; .grTile[disabled] is dimming the one tile that is not unavailable');

    /* ---- 2. AND IT SAYS SO IN WORDS ------------------------------- */
    ok(key+'.the-current-tile-says-which-room-in-words',
       !!cur[0].here && cur[0].here.shown && /\S/.test(cur[0].here.text),
       cur[0].here ? ('the marker renders "' + cur[0].here.text + '" but is not visible at this density')
                   : 'there is no plain-language marker on the current tile at all — a gradient border is a treatment, and a treatment has to be taught');
    ok(key+'.and-only-on-that-one',
       others.every(t=>!t.here || !t.here.shown),
       others.filter(t=>t.here&&t.here.shown).length + ' tiles you are NOT in also carry the marker');
    if(cur[0].here){
      ok(key+'.the-marker-is-not-clipped',
         !cur[0].here.clipped && cur[0].here.overflowsTile <= 0,
         'the marker is cut off inside its own tile (clipped=' + cur[0].here.clipped
         + ', ' + cur[0].here.overflowsTile + 'px past the tile edge)');
      /* 12px is the ramp floor and a label is what the floor is for; below
         it is a different bug and qa.js owns that one. */
      ok(key+'.the-marker-is-on-the-ramp',
         cur[0].here.size >= 12,
         'the marker renders at ' + cur[0].here.size + 'px, under the 12px floor');
    }

    /* ---- 3. IT IS NOT THE STAR ------------------------------------ */
    const starred=dom.tiles.filter(t=>t.star);
    ok(key+'.the-star-still-means-game-of-the-night',
       starred.length===1,
       starred.length + ' tiles wear a visible star — it marks ONE game, and if it marks all of them it marks none');
    if(cur[0].here && cur[0].star){
      ok(key+'.the-marker-and-the-star-are-different-colours',
         cur[0].here.colour !== cur[0].star.colour,
         'the "you are here" marker and the Game of the Night star both render '
         + cur[0].star.colour + ' — two different facts in one colour is one fact');
    }

    /* ---- 4. THE BEHAVIOUR THAT WAS NEVER WRONG -------------------- */
    ok(key+'.you-still-cannot-switch-into-the-room-you-are-in',
       cur[0].disabled===true && others.every(t=>!t.disabled),
       'disabled is on ' + dom.tiles.filter(t=>t.disabled).length
       + ' tiles — the fix was to the appearance, not to the behaviour');

    /* ---- 5. WHAT IT COSTS ----------------------------------------- */
    /* The marker is a line of type on one tile and the grid stretches its
       row to match, so it is not free. It is 18px in tiles and 16px
       compact, measured; this is the ceiling that keeps it honest. */
    ok(key+'.the-rail-still-fits-the-budget',
       dom.railH <= (s.compact ? 0.22 : 0.42) * s.h,
       'the rail is ' + dom.railH + 'px of a ' + s.h + 'px screen ('
       + Math.round(dom.railH/s.h*100) + '%) before anything else is drawn');

    ok(key+'.no-page-errors', errs.length===0, errs.slice(0,2).join(' · '));
  }

  const verdict = fail? 'RED' : 'GREEN';
  console.log(`\n${verdict}   ${pass} passed, ${fail} failed   [${path.basename(TARGET)} · ${ENGNAME}]`
              + (SABOTAGE?'   [SABOTAGED — red is the correct result]':''));
  bad.forEach(x=>console.log('   x '+x));
  if(SABOTAGE){ process.exit(fail?0:1); }
  process.exit(fail?1:0);

})().catch(e=>{ console.log('rail-current.js could not run: '+(e&&e.stack||e)); process.exit(1); });
