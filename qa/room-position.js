/* ============ qa/room-position.js ====================================
   THREE BUGS FROM ONE LIVE NIGHT, 21 AUGUST, ALL FOUND BY THE FOUNDER
   WHILE PLAYING — which is the expensive way to find anything.

   1. The app named the wrong quarter to anybody who arrived after tip.
   2. YOUR NIGHT said 0 while the board, on the same screen, said 10.
   3. The game rail floated a 200px chooser on top of a live question.

   What links them: each is a screen reading a LOCAL variable when a
   SHARED fact was available and correct. None needed new data. This file
   pins the three readings.
   ================================================================== */
const fs=require('fs'), path=require('path');
const SRC=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
let pass=0, fail=0;
const ok =(n)=>{pass++; console.log('  ok   '+n);};
const bad=(n,d)=>{fail++; console.log('  FAIL '+n+(d?'\n         '+d:''));};
function t(n,f){ try{ f()?ok(n):bad(n); }catch(e){ bad(n,e.message); } }

/* ---- 1. roomNextRound, run for real ------------------------------- */
const m = SRC.match(/function roomNextRound\(local\)\{[\s\S]*?\n\}/);
if(!m){ bad('roomNextRound exists'); }
else{
  const HR={doc:null};
  const roomNextRound = new Function('HR', m[0]+'; return roomNextRound;')(HR);

  t('a fresh device in a room at halftime is NOT offered Quarter 1', ()=>{
    HR.doc={idx:1,state:'scored'};          // Q2 scored, exactly the founder's room
    return roomNextRound(0) === 2;          // -> Quarter 3
  });
  t('a live round is the round to be in, not the one after it', ()=>{
    HR.doc={idx:2,state:'live'};
    return roomNextRound(0) === 2;
  });
  t('the local counter still wins when it is further along', ()=>{
    HR.doc={idx:1,state:'scored'};
    return roomNextRound(3) === 3;          // never drag a player backwards
  });
  t('no room document changes nothing', ()=>{
    HR.doc=null; return roomNextRound(1) === 1;
  });
  t('a malformed room document changes nothing', ()=>{
    HR.doc={idx:'two',state:'scored'}; return roomNextRound(1) === 1;
  });
  t('pre-tip is still Quarter 1', ()=>{
    HR.doc=null; return roomNextRound(0) === 0;
  });
}

/* ---- 2. both quarter-naming sites go through it -------------------- */
t('gtStartRow names the round from the room', ()=>
  /var qi = roomNextRound\(/.test(SRC));
t('the resume bar names the round from the room', ()=>
  /var nq=roomNextRound\(/.test(SRC));
t('no site still reads the raw local counter to NAME a round', ()=>{
  /* Practice has no room and is allowed its own counter; it is the only
     exception, and it is asserted by name so a second one cannot slip in
     unnoticed. */
  const hits=[...SRC.matchAll(/\(S\.nextQ!=null\s*\?\s*S\.nextQ\s*:\s*S\.qi\)/g)];
  const bare=hits.filter(h=>{
    const near=SRC.slice(Math.max(0,h.index-260), h.index);
    /* the match starts AT the '(', so the text before it ends with the
       bare function name — not with the paren. */
    return !/roomNextRound\(?$/.test(SRC.slice(Math.max(0,h.index-20),h.index))
        && !/S\.mode!=='live'/.test(near);
  });
  if(bare.length) console.log('         '+bare.length+' unguarded read(s)');
  return bare.length===0;
});

/* ---- 3. shownTotal reads the row the way the board does ------------- */
const st = SRC.match(/function shownTotal\(\)\{[\s\S]*?\n\}/);
if(!st){ bad('shownTotal exists'); }
else{
  const S={pts:0};
  const mk = (row)=> new Function('S','myServerRow', st[0]+'; return shownTotal;')(S, ()=>row);
  t('a row with only pts is NOT reported as zero', ()=>
    mk({me:true, pts:10})() === 10);                 // the exact founder screenshot
  t('total wins over pts when both are present', ()=>
    mk({me:true, pts:10, total:35})() === 35);
  t('total:0 is honoured, not treated as missing', ()=>
    mk({me:true, pts:10, total:0})() === 0);
  t('no server row falls back to the local counter', ()=>{
    S.pts=7; return mk(null)() === 7;
  });
  t('it cannot disagree with the board line', ()=>{
    /* The board prints `total!=null ? total : pts`. Run both over the same
       rows and demand the same answer — this is the check that actually
       remembers the bug, because it compares the two readings. */
    const board=(p)=>(Number(p.total!=null?p.total:p.pts)||0);
    const rows=[{pts:10},{pts:0,total:35},{total:0,pts:10},{pts:5,total:5},{}];
    return rows.every(r=>{ S.pts=0; return mk(Object.assign({me:true},r))() === board(r); });
  });
}

/* ---- 4. the rail may not float a chooser over a question ------------ */
t('neither density is sticky', ()=>{
  /* Assert the BASE rule, not an override. The override existed and the
     base rule still said sticky, so compact inherited it at 130px and sat
     on the question — the check that only looked at the override saw
     nothing wrong. */
  const m=SRC.match(/#gameRail\{position:([a-z]+)/);
  if(!m){ console.log('         no #gameRail position rule at all'); return false; }
  if(m[1]!=='static'){ console.log('         base rule is position:'+m[1]); return false; }
  return !/#gameRail\[data-mode="[a-z]+"\]\{position:sticky/.test(SRC);
});
t('both densities are stamped on the element', ()=>
  /setAttribute\('data-mode', compact \? 'compact' : 'tiles'\)/.test(SRC));

/* ---- 5. AND NOTHING MAY DEPEND ON A SCROLL GESTURE ------------------
   "we need to reinvent the way we show games and the home page cause not
   all devices can access it." The Fire at Tempo room was live, on the
   slate as gn#19, drawn by the rail — and off the right edge of the
   column, in a box whose only route to it was a horizontal scroll. A
   phone can do that. A mouse wheel cannot. A TV remote cannot.

   So the invariant is not "the fade is present" or "the wheel handler
   exists" — I shipped both of those and neither put the room on his
   screen. The invariant is that the chooser NEVER SCROLLS SIDEWAYS. */
t('the horizontal strip is gone', ()=>
  SRC.indexOf('grStrip')<0 && SRC.indexOf('grChip')<0);
t('the rail renders exactly one way', ()=>{
  const f=SRC.match(/function paintGameRail\(\)\{[\s\S]*?\n\}/);
  if(!f) return false;
  const returns=(f[0].match(/\n    return;/g)||[]).length;
  if(returns){ console.log('         '+returns+' early return(s) — a second renderer is back'); return false; }
  return true;
});
t('no part of the chooser is horizontally scrollable', ()=>{
  /* Scan the rail's own CSS block for any overflow-x that can hide. */
  const bad=[...SRC.matchAll(/\.(gr[A-Za-z]+)\{[^}]*overflow-x:\s*(auto|scroll)/g)].map(m=>m[1]);
  if(bad.length){ console.log('         scrollable: '+bad.join(', ')); return false; }
  return true;
});
t('the grid wraps rather than overflowing', ()=>
  /\.grTiles\{display:grid;grid-template-columns:repeat\(auto-fit/.test(SRC));
t('compact is a density, not a second renderer', ()=>
  /var compact = false;/.test(SRC) && SRC.indexOf('var playing = ')<0);
t('the density is read from the DOM, not from a variable set elsewhere', ()=>{
  /* Three attempts at this now: S.place==='play' (a screen that never
     existed), a GAME_SCREENS lookup (real screens, stale variable), and
     !!cur (stale-proof but blunt enough to strip the landing chooser of
     its team names and its star). The class go() puts on the active
     screen is the only one of the four that is both real and current. */
  const f=SRC.match(/var compact = false;[\s\S]{0,420}?\}catch\(_\)\{\}/);
  if(!f) return false;
  return /querySelector\('\.screen\.active'\)/.test(f[0]) && /s-landing/.test(f[0]);
});

console.log('\n  '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
