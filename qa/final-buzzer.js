#!/usr/bin/env node
/* =====================================================================
   THE FINAL BUZZER SCREEN MUST NOT CONTRADICT ITSELF.
   ---------------------------------------------------------------------
   MEASURED 25 Aug 2026 on the shipped build, by a stranger who played
   practice end to end and by this suite reproducing it. One 380-point
   night, on the LAST screen of the session, said all of this at once:

     ring         380 OUT OF 1000
     tile 1       "#8"  ·  Final rank
     tile 2       "99%" ·  Beat this % of players
     the board    six names, every one of them above the player,
                  and no row for the player at all
     stat line    "Season pts  38"

   Five surfaces, no two of them counting the same thing:

     RANK        standings() = you + eight bots, so a field of NINE.
                 Printed as "#8" with no denominator.
     PERCENTILE  (S.totalPlayers - rank) / S.totalPlayers, where
                 S.totalPlayers was the literal 1204 in freshS(). There is
                 no player population. (1204-8)/1204 = 99%, so coming last
                 in a room of nine was congratulated as top 1%.
     THE BOARD   renderLeaderboard('finalLb', 6) — the top six of nine.
                 Finish seventh or worse, which the bots' random scores
                 make likely, and you are cut from your own result screen.
     SEASON PTS  380/1000*100 = 38, a PERCENTAGE printed under a POINTS
                 label, on a game that banks nothing and joins no season.

   And under all of it, a sentence promising prizes for a practice run.

   "Four numbers that disagree, on a scoreboard product, reads as 'these
   people don't know what my score is.'" That is the whole finding, and
   this suite is the version of it a machine can hold.

   WHAT IT ASSERTS. Not "the tiles say the right words" — that is a copy
   test and it would pass on a build that computed nonsense politely. Each
   check below is either (a) an invented quantity is not printed anywhere,
   or (b) two numbers that describe the same night AGREE, read from the
   rendered DOM after the real showFinal() ran.

   IT MUST GO RED ON index.html. That build reproduces every symptom, so
   a check that stays green against it is testing nothing:

       node qa/final-buzzer.js index.html          # expect RED
       node qa/final-buzzer.js index-test.html     # expect GREEN
       node qa/final-buzzer.js --sabotage          # expect RED (inverted 0)

   ENGINES. --firefox (default) and --chromium. WebKit crashes on this
   Jetson and is not claimed.
   ================================================================== */
const PW=require('playwright');
const path=require('path'), fs=require('fs'), os=require('os');
const ARG=process.argv.slice(2);
const TARGET=path.resolve(ARG.find(a=>/\.html$/.test(a)) || path.join(__dirname,'..','index-test.html'));
const SABOTAGE=ARG.includes('--sabotage');
const ENGNAME=ARG.includes('--chromium')?'chromium':'firefox';
const ENG=PW[ENGNAME];

let pass=0, fail=0; const bad=[];
const ok=(n,c,d)=>{ if(c) pass++; else { fail++; bad.push(n+(d?'  — '+d:'')); } };

const PHONE={width:390,height:844};
const DESK ={width:1850,height:1050};   // the founder's presentation display

/* ---------------------------------------------------------------------
   ONE STAGE, USED BY EVERY CHECK.

   The whole screen is produced by showFinal(), so that is what is driven.
   The ledger is written through the app's own ledgerSet() rather than by
   assigning S.pts, because points are RECOMPUTED from the ledger and a
   hand-set total is silently thrown away on the next recompute — the
   mistake qa/payoff.js documents having made.

   FEED STATE IS PINNED BEFORE ANYTHING RENDERS. loadGameStats() is async
   and its `if(GS.ev!==ev){GS.ok=false;}` runs synchronously before the
   first await, so GS.ok flips true->false underneath a caller at whatever
   moment a file:// fetch gives up. Geometry and text read across that
   boundary is a coin toss. The caller is removed rather than the flag
   set, for the reason desk-reach.js gives.
   ------------------------------------------------------------------ */
async function stage(viewport, mutate){
  const b=await ENG.launch();
  const ctx=await b.newContext({viewport, deviceScaleFactor:1});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,160)));

  let html=fs.readFileSync(TARGET,'utf8');
  if(SABOTAGE) html=sabotage(html);
  const tmp=path.join(os.tmpdir(),'final-buzzer-under-test-'+process.pid+'.html');
  fs.writeFileSync(tmp,html);
  await p.goto('file://'+tmp);
  await p.waitForFunction(()=>typeof window.showFinal==='function',{timeout:25000});
  await p.evaluate(()=>{
    try{ window.loadGameStats = async function(){ return null; }; }catch(_){}
    try{ GS.ok=false; GS.ev=null; GS.inj=null; }catch(_){}
  });

  await p.evaluate(async (m)=>{
    setMode('demo');
    S.name='Sam'; S.mode='demo'; S.practice=true;
    seedBots();
    /* Four quarters of the simulated room moving, through the app's own
       bumper — the same call the break screens make. */
    bumpBots(40); bumpBots(80); bumpBots(120); bumpBots(160);
    /* A real, unremarkable night: 280 from the quarters, 100 from the
       sheet. 380 of 1000 — the reported score, to the point. */
    ledgerSet('r0', 10,0,'live');
    ledgerSet('r1', 60,0,'live');
    ledgerSet('r2', 90,0,'live');
    ledgerSet('r3',120,0,'live');
    ledgerSet('pred',100,0,'pred');
    /* Two rounds' worth of verdicts, in the shape practice actually
       produces them: answer() pushes one true/false onto S.results[qi]
       per question the player taps, and writes S.liveAnswers only on the
       live branch. 5 of 8 right. */
    S.results[0]=[true,false,true,true];
    S.results[1]=[false,true,true,false];
    recomputeScore();
    if(m==='rerender'){
      /* ONE PAGE, TWO SNAPSHOTS. Comparing two separate browser launches
         would compare two different random rooms and go red on a build
         with nothing wrong with it — the field is seeded from
         Math.random() by design. The question is whether DRAWING the
         screen again moves it, so both readings come from the same
         page. */
      showFinal();
      await new Promise(r=>setTimeout(r,1200));
      window.__fbSnap1 = {
        bots:(S.botScores||[]).map(b=>b.pts),
        ring:(document.getElementById('finalPts')||{}).textContent,
        t1:(document.getElementById('finalRank')||{}).textContent,
        t2:(document.getElementById('finalPct')||{}).textContent
      };
      showFinal(); showFinal();
      await new Promise(r=>setTimeout(r,1400));
      return;
    }
    if(m==='ciopen'){
      /* A Caught It that was still open when the buzzer went. This is the
         state that put a 242px hole above the headline. */
      try{ ensureCiCard(); }catch(_){}
      document.documentElement.style.setProperty('--cih','260px');
      document.body.classList.add('ciopen');
    }
    showFinal();
    await new Promise(r=>setTimeout(r,1400));
  }, mutate||'');

  return {b,p,errs};
}

/* Everything the screen is currently saying, read from the DOM. */
const READ = ()=>{
  const txt=id=>{ const e=document.getElementById(id); return e? e.textContent.trim() : null; };
  const vis=el=>{ if(!el) return false; const r=el.getBoundingClientRect();
                  const cs=getComputedStyle(el);
                  return r.width>0 && r.height>0 && cs.display!=='none' && cs.visibility!=='hidden'; };
  const sec=document.getElementById('s-final');
  /* Every rendered word on the screen, drawer included, with the drawer
     forced open so nothing hides inside a <details> — the checks are about
     what the build is willing to say, not about what is currently folded. */
  const dw=document.getElementById('fDrawer'); const wasOpen=dw?dw.open:null;
  if(dw) dw.open=true;
  const words = sec ? sec.innerText.replace(/\s+/g,' ').trim() : '';
  const lbRows=[...document.querySelectorAll('#finalLb .lb')].map(d=>({
    txt:d.innerText.replace(/\s+/g,' ').trim(), me:d.classList.contains('me')
  }));
  if(dw && wasOpen!==null) dw.open=wasOpen;

  const rr=el=>{ if(!el) return null; const r=el.getBoundingClientRect();
                 return {t:Math.round(r.top),b:Math.round(r.bottom),l:Math.round(r.left),
                         r:Math.round(r.right),w:Math.round(r.width),h:Math.round(r.height)}; };
  /* The verdicts the practice game actually recorded, counted here in the
     suite from raw state so the check has an independent number to hold
     the tile against rather than calling the same helper the tile does. */
  let hits=0, tot=0;
  try{ (S.results||[]).forEach(rd=>(rd||[]).forEach(v=>{
         if(v===true||v===false){ tot++; if(v===true) hits++; } })); }catch(_){}
  return {
    ring:txt('finalPts'), ringMax:txt('finalMax'),
    t1:txt('finalRank'), t1k:txt('finalRankK'),
    t2:txt('finalPct'),  t2k:txt('finalPctK'),
    words, lbRows,
    slPts:txt('slPts'), slPtsK:txt('slPtsK'),
    statLineVisible: vis(document.getElementById('fStatLine')),
    prizeVisible: vis(document.getElementById('finalPrizeNote')),
    graded:{hits,total:tot}, predPts:S.predPts||0, predMax:(typeof PRED_MAX==='number'?PRED_MAX:null),
    pts:S.pts, maxpts:(typeof MAXPTS==='number'?MAXPTS:null),
    hasTotalPlayers: (typeof S.totalPlayers!=='undefined'),
    botTop: (S.botScores||[]).map(b=>b.pts),
    phone:rr(document.querySelector('.phone')),
    pill:rr(document.getElementById('finalPill')),
    railBottom:(function(){ const r=document.querySelector('.rail,#gameRail');
                            return r? Math.round(r.getBoundingClientRect().bottom):0; })(),
    vw:innerWidth
  };
};

/* ---------------------------------------------------------------------
   SABOTAGE. Puts each fixed thing back the way it shipped, one edit per
   symptom, so every group below has something to go red about. If this
   run comes out green the suite is decoration.
   ------------------------------------------------------------------ */
function sabotage(html){
  let h=html;
  /* 1. the invented population and the percentile built on it */
  h=h.replace(/botScores:\[\],botSheetsSettled:false,\n\s*results:emptyRounds\(\), liveAnswers/,
              'botScores:[],botSheetsSettled:false,totalPlayers:1204,\n    results:emptyRounds(), liveAnswers');
  /* Put the shipped practice branch back, verbatim in effect: rank out of
     a nine-strong simulated field, a percentile out of 1,204, and a board
     cut to six names. */
  h=h.replace(/      if\(tot>0\) setStat\(1, hits\+'\/'\+tot, 'Questions right'\);\n\s*else\s+setStat\(1, '—', 'Questions right'\);/,
    "      var _s=standings(); var _rank=_s.findIndex(x=>x.me)+1;\n"
   +"      var _beat=Math.round((S.totalPlayers-_rank)/S.totalPlayers*100);\n"
   +"      setStat(1,'#'+_rank,'Final rank');\n"
   +"      setTimeout(function(){ setStat(2,_beat+'%','Beat this % of players');\n"
   /* The bots are random, so a straight top-six board leaves the player on
      it about half the time and the board check would go green on a
      sabotaged build — a coin-toss test is not a test. The reported case
      is "finished outside the top six", so the sabotage produces it. */
   +"                             bumpBots(700);\n"
   +"                             renderLeaderboard('finalLb',6); },0);");
  /* The pot. Fired by beating eight random numbers, in a game with no pot. */
  h=h.replace(/    \$f\('finalTitle'\)\.textContent = `Great game, \$\{S\.name\|\|'player'\}!`;/,
              "    $f('finalTitle').textContent = '🏆 You won the pot!';");
  /* 2. the season percentage under a points label, and the card back on
        in practice */
  h=h.replace(/  if\(S\.mode!=='live'\)\{ box\.style\.display='none'; return; \}/,
              '  /* sabotaged: practice shows the season card again */');
  h=h.replace(/  set\('slPtsK', live \? 'Season pts' : 'Night score \/100'\);/,
              "  set('slPtsK','Season pts');");
  /* 3. the prize sentence back on the practice screen */
  h=h.replace(/    if\(_pz\) _pz\.style\.display = \(S\.mode==='live'\) \? '' : 'none';/,
              "    if(_pz) _pz.style.display='';");
  /* 4. the Caught It hole above the headline */
  h=h.replace(/    document\.body\.classList\.remove\('ciopen'\);\n    document\.documentElement\.style\.setProperty\('--cih','0px'\);/,
              '    /* sabotaged: the open card keeps its reserved space */');
  /* 5. the 440px ribbon on a 1850px screen */
  h=h.replace(/  body\.on-final \.phone\{max-width:1120px\}/,
              '  body.on-final .phone{max-width:440px}');
  /* 6. the bots re-randomised on every render */
  h=h.replace(/if\(S\.mode==="demo" && Array\.isArray\(S\.botScores\) && !S\.botSheetsSettled\)\{\n\s*S\.botSheetsSettled = true;/,
              'if(S.mode==="demo" && Array.isArray(S.botScores)){\n    S.botSheetsSettled = true;');
  return h;
}

(async()=>{

/* =====================================================================
   1. NOTHING ON THIS SCREEN IS INVENTED
   ================================================================== */
{
  const {b,p,errs}=await stage(PHONE);
  const r=await p.evaluate(READ);

  /* The 1,204 was not an estimate that went stale. It was a placeholder
     that shipped, and it was the denominator of the loudest claim on the
     screen. There is no population to be a percentile of, so there is no
     percentile — checked as "the state field does not exist" rather than
     "the tile says something else", because the number coming back under
     a different caption is the exact way this returns. */
  ok('final.no-invented-player-population',
     r.hasTotalPlayers===false,
     `S.totalPlayers still exists and is ${JSON.stringify(r.hasTotalPlayers)}`);
  ok('final.does-not-claim-a-percentile-of-players',
     !/% of players|of players/i.test(r.words),
     `the screen still says: "${(r.words.match(/[^.·]*of players[^.·]*/i)||[''])[0].trim()}"`);
  ok('final.no-two-digit-percentile-tile',
     !/^\d{1,3}%$/.test(String(r.t2||'')) || !/players/i.test(String(r.t2k||'')),
     `tile 2 reads "${r.t2}" under "${r.t2k}"`);

  /* A practice game has no prize, and the sentence is a contest
     disclosure. In front of strangers it is doing something nobody
     wants. */
  ok('final.practice-does-not-advertise-a-prize',
     r.prizeVisible===false && !/Prizes awarded/i.test(r.words),
     `the practice screen still says "Prizes awarded to the sponsor's verified top scorers"`);
  ok('final.practice-does-not-say-you-won-the-pot',
     !/won the pot/i.test(r.words),
     'a practice run announced a pot');

  /* Practice banks nothing — bankNight() is live-only — so a "Season 1"
     card here is four boxes about a season this game did not join. */
  ok('final.practice-shows-no-season-card',
     r.statLineVisible===false,
     'the Season 1 stat line renders on a game that is never recorded');

  await b.close();
  ok('final.no-page-errors', errs.length===0, errs.slice(0,2).join(' · '));
}

/* =====================================================================
   2. THE NUMBERS THAT ARE SHOWN AGREE WITH EACH OTHER
   ================================================================== */
{
  const {b,p,errs}=await stage(PHONE);
  const r=await p.evaluate(READ);

  ok('final.ring-is-the-players-real-total',
     String(r.ring)===String(r.pts),
     `ring shows ${r.ring}, the ledger says ${r.pts}`);
  ok('final.ring-ceiling-is-the-real-ceiling',
     String(r.ringMax||'').replace(/[^\d]/g,'')===String(r.maxpts),
     `ring says "${r.ringMax}", MAXPTS is ${r.maxpts}`);

  /* Tile 1 is a claim about how many questions this person got right, so
     it has to equal what countGraded() says about this person. */
  ok('final.tile-1-is-questions-right-and-matches-the-count',
     r.graded.total>0 && r.t1===`${r.graded.hits}/${r.graded.total}`,
     `tile 1 reads "${r.t1}" under "${r.t1k}"; the verdicts on record are ${r.graded.hits}/${r.graded.total}`);
  /* And it is not a second copy of the ring. Two boxes both reading 380
     is the same disagreement in a nicer disguise. */
  ok('final.tile-1-is-not-the-ring-again',
     String(r.t1)!==String(r.ring),
     `the ring says ${r.ring} and the tile beside it says ${r.t1}`);
  ok('final.tile-1-label-describes-what-tile-1-prints',
     /question/i.test(String(r.t1k||'')),
     `"${r.t1}" is captioned "${r.t1k}"`);

  /* Tile 2 must be the same pair the breakdown drawer prints on its own
     Prediction sheet row. Two expressions for one quantity is how this
     screen got into trouble. */
  ok('final.tile-2-matches-the-breakdown-it-sits-above',
     r.t2===`${r.predPts}/${r.predMax}`,
     `tile 2 reads "${r.t2}", the ledger's prediction lane is ${r.predPts}/${r.predMax}`);
  ok('final.tile-2-label-describes-what-tile-2-prints',
     /prediction/i.test(String(r.t2k||'')),
     `"${r.t2}" is captioned "${r.t2k}"`);

  /* Every whole number on the screen has to be one the app can produce.
     380, 280, 100, 3/4-style fractions and the 1000 ceiling are all
     derivable; a bare 1204, or a rank against a field nobody counted,
     is not. */
  ok('final.no-1204-anywhere-on-the-screen',
     !/1,?204/.test(r.words), 'the placeholder population is still printed');

  await b.close();
  ok('final.no-page-errors-2', errs.length===0, errs.slice(0,2).join(' · '));
}

/* =====================================================================
   3. NOBODY IS RANKED AGAINST PEOPLE WHO DO NOT EXIST
   ---------------------------------------------------------------------
   The eight opponents are Math.random(). A rank against noise is noise
   with a # in front of it, and on the last screen of the night it is the
   thing a stranger reads as "these people don't know what my score is" —
   especially when the board that is supposed to justify it lists six
   names, all above them, and no row for them.
   ================================================================== */
{
  const {b,p,errs}=await stage(PHONE);
  const r=await p.evaluate(READ);

  ok('final.practice-does-not-rank-you-against-simulated-players',
     !/#\d/.test(String(r.t1||'')) && !/#\d/.test(String(r.t2||'')),
     `a tile reads "${r.t1}" / "${r.t2}" — a rank produced by eight random numbers`);
  ok('final.practice-does-not-print-a-rank-headline',
     !/final rank/i.test(r.words),
     'the screen still headlines a Final rank in practice');

  /* THE RULE THAT MAKES THE BOARD HONEST, whatever the board is: if the
     screen lists players at all, the player is one of them. Being cut
     from your own result screen is not a display limit, it is the screen
     disagreeing with itself. */
  const listed=r.lbRows.length;
  ok('final.if-a-board-is-listed-the-player-is-on-it',
     listed===0 || r.lbRows.some(x=>x.me),
     `${listed} players are listed on the final board and none of the rows is the player's`);
  ok('final.practice-says-the-opponents-were-simulated',
     /simulat/i.test(r.words),
     'nothing on the screen tells the player who those scores belonged to');

  await b.close();
  ok('final.no-page-errors-3', errs.length===0, errs.slice(0,2).join(' · '));
}

/* =====================================================================
   4. THE SAME SCORE PRODUCES THE SAME SCREEN
   ---------------------------------------------------------------------
   #8 on one run and #9 on the next with an identical 380. Half of that
   was the field being random to begin with — dealt with above, by not
   ranking against it. The other half is a genuine defect and outlives
   the tiles: showFinal() handed every simulated player ANOTHER random
   slice of a 600-point sheet on EVERY call, so a reload, a resume or a
   late re-render moved the field while the player sat there. It is the
   double-add this function's own comments say was fixed, wearing the
   bots' clothes.
   ================================================================== */
{
  const c=await stage(PHONE,'rerender');
  const rc=await c.p.evaluate(READ);
  const first=await c.p.evaluate(()=>window.__fbSnap1);
  await c.b.close();

  ok('final.re-rendering-the-ending-does-not-move-the-field',
     JSON.stringify(first.bots)===JSON.stringify(rc.botTop),
     `after one render: [${first.bots}]  ·  after three: [${rc.botTop}] — the simulated room grew every time the screen was drawn`);
  ok('final.re-rendering-the-ending-does-not-move-the-players-total',
     first.ring===rc.ring && first.t1===rc.t1 && first.t2===rc.t2,
     `first render ${first.ring}/${first.t1}/${first.t2}, third ${rc.ring}/${rc.t1}/${rc.t2}`);
  ok('final.no-page-errors-4', c.errs.length===0, c.errs.slice(0,2).join(' · '));
}

/* =====================================================================
   5. THE SEASON LINE MEASURES WHAT ITS LABEL CLAIMS
   ---------------------------------------------------------------------
   "Season pts 38" was 380/1000 expressed as a percentage. Same family as
   every unit bug this repo has had: the number was right and the word
   above it described something else. Practice does not show the card at
   all; on a live night with no season record yet, the fallback prints
   TONIGHT'S night score and now says so.
   ================================================================== */
{
  const {b,p,errs}=await stage(PHONE);
  const r=await p.evaluate(async()=>{
    /* Force the live-with-no-season-record fallback — the branch that was
       printing a percentage under a points label. */
    S.mode='live'; S.practice=false;
    try{ renderStatLine({games:[]}); }catch(_){}
    await new Promise(x=>setTimeout(x,200));
    /* READ THE CAPTION OFF THE TILE, NOT OFF AN ID. The id `slPtsK` is
       part of the fix; asking for it by name makes this check pass on any
       build that simply has no such element — which is the build the
       finding came from. The caption is whatever `.k` sits in the same
       box as the number, in both builds. */
    const v=document.getElementById('slPts');
    const kEl = v && v.parentElement ? v.parentElement.querySelector('.k') : null;
    return { v: v? v.textContent.trim():null,
             k: kEl? kEl.textContent.trim():null,
             pts:S.pts, maxpts:(typeof MAXPTS==='number'?MAXPTS:null) };
  });
  const asPct = Math.round(Math.min(100,(r.pts/r.maxpts)*100));
  const printsAPercentage = Number(String(r.v).replace(/,/g,''))===asPct
                            && Number(String(r.v).replace(/,/g,''))!==r.pts;

  ok('final.season-tile-does-not-print-a-percentage-under-a-points-label',
     !(printsAPercentage && /season/i.test(String(r.k||'')) && !/\/\s*100|score|%/i.test(String(r.k||''))),
     `it printed "${r.v}" under "${r.k}"; ${r.pts}/${r.maxpts} is ${asPct}%, so the box holds a percentage`);
  ok('final.season-tile-label-names-its-unit-when-it-is-a-night-score',
     !printsAPercentage || /\/\s*100|night/i.test(String(r.k||'')),
     `"${r.v}" under "${r.k}" — a night score out of 100 has to say so`);

  await b.close();
  ok('final.no-page-errors-5', errs.length===0, errs.slice(0,2).join(' · '));
}

/* =====================================================================
   6. NOTHING IS CUT OFF, AND NOTHING IS A HOLE
   ---------------------------------------------------------------------
   A ~300px void above the headline at 1850x1050, and the whole card in a
   440px ribbon with ~700px of black either side while the pick sheet on
   the same machine used ~1100px. Both are rendered rectangles and both
   are measured, not read out of the stylesheet.
   ================================================================== */
{
  /* 6a. THE HOLE. `body.ciopen` puts padding-top:var(--cih)!important on
     whatever screen is active, so a Caught It that was still open at the
     buzzer reserves its own height on a screen that does not host it. */
  const {b,p,errs}=await stage(DESK,'ciopen');
  const r=await p.evaluate(READ);
  const gap = r.pill.t - r.railBottom;
  ok('final.no-empty-void-above-the-headline',
     gap < 120,
     `${gap}px of nothing between the rail and the FINAL BUZZER pill (pill top y=${r.pill.t}) — a Caught It card that was still open kept its reserved space on a screen that does not show it`);

  /* 6b. THE RIBBON. Same question the pick sheet answers: is there room
     for the card to be read at desk distance. */
  ok('final.uses-the-desk-screen-it-is-being-presented-on',
     r.phone.w >= 900,
     `the result card is ${r.phone.w}px wide in a ${r.vw}px viewport — ${Math.round((r.vw-r.phone.w)/2)}px of black on each side, while the pick sheet on the same machine takes 1120px`);
  ok('final.desk-column-is-centred-not-adrift',
     Math.abs((r.phone.l) - (r.vw - r.phone.r)) <= 2,
     `left margin ${r.phone.l}px, right margin ${r.vw-r.phone.r}px`);

  /* And the ending still fits: the headline and the number are the two
     things a screenshot has to contain. */
  ok('final.the-headline-is-on-screen-without-scrolling',
     r.pill.t>=0 && r.pill.b<=1050,
     `pill sits at y=${r.pill.t}..${r.pill.b} in a 1050px viewport`);

  await b.close();
  ok('final.no-page-errors-6', errs.length===0, errs.slice(0,2).join(' · '));
}

/* 6c. THE PHONE MUST NOT HAVE MOVED. The desktop work is two wrappers
   that are `display:contents` below 1120px; if that is ever untrue the
   phone layout changes underneath everybody. */
{
  const {b,p,errs}=await stage(PHONE);
  const r=await p.evaluate(()=>{
    const rr=el=>{const q=el.getBoundingClientRect();return {t:Math.round(q.top),w:Math.round(q.width)};};
    const a=document.querySelector('#s-final .fcolA'), c=document.querySelector('#s-final .fcolB');
    return { colA:a?getComputedStyle(a).display:null, colB:c?getComputedStyle(c).display:null,
             pill:rr(document.getElementById('finalPill')),
             hero:rr(document.querySelector('#s-final .fhero')),
             vw:innerWidth };
  });
  ok('final.phone-layout-is-untouched-by-the-desk-columns',
     r.colA==='contents' && r.colB==='contents',
     `the column wrappers render as ${r.colA}/${r.colB} on a 390px phone instead of contents`);
  ok('final.phone-card-still-fills-the-phone',
     r.hero.w >= r.vw-40,
     `the hero card is ${r.hero.w}px inside a ${r.vw}px phone`);
  await b.close();
  ok('final.no-page-errors-7', errs.length===0, errs.slice(0,2).join(' · '));
}

/* ============ EXTRA INNINGS ARE STILL THE GAME =====================
   29 Aug 2026, Phillies at Angels, tied 1-1 in the TOP OF THE 10TH. The
   founder's phone read "FINAL OUT · Score your predictions · Settling
   your card". The runner disagreed in its own log at the same minute
   (`score 1 — 1  OT in progress`) and so did ESPN: state `in`,
   STATUS_IN_PROGRESS, period 10.

   Baseball ships three scheduled rounds. When the 7th-9th scored,
   isLastRound() went true and four separate call sites read that as "the
   game is finished" and offered to settle the card. A tied game has more
   innings and the runner publishes an overtime round for exactly that.

   The question is now asked in one place, afterRoundLabel(), and this
   checks the state that produced the bug: last scheduled round, feed
   still live. */
{
  const b = await ENG.launch();
  const p = await b.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto('file://'+TARGET);
  await p.waitForFunction(()=>typeof isLastRound==='function',{timeout:20000}).catch(()=>{});
  const r = await p.evaluate(()=>{
    const out={};
    try{
      startDemo(); S.mode='live';
      GS.ok=true; GS.ev=String(GAME.espnEvent||'');
      const last = liveRounds()-1;
      GS.state='in';
      /* FALL BACK TO THE OLD LOGIC when the owner is absent, so this
         check catches the ORIGINAL bug rather than passing because a
         function is missing. A test that goes green on a build without
         the fix is not a test. */
      const label = (i) => (typeof afterRoundLabel === 'function')
        ? afterRoundLabel(i)
        : (!isLastRound(i)
            ? ('Back to the ' + L.unit + ' — next →')
            : (L.End + ' — score predictions →'));
      out.live = label(last);
      out.moreLive = (typeof moreGameToCome==='function') ? moreGameToCome() : null;
      GS.state='post';
      out.post = label(last);
      out.morePost = (typeof moreGameToCome==='function') ? moreGameToCome() : null;
    }catch(e){ out.err=String(e).slice(0,120); }
    return out;
  });
  console.log(`     last round, feed live -> "${r.live}"`);
  console.log(`     last round, feed post -> "${r.post}"`);
  ok('final.extra-innings-do-not-offer-to-settle',
     !!r.live && !/score predictions/i.test(r.live),
     `with the last scheduled round scored and the feed still LIVE the app said "${r.live}". `
     + 'That walks a player off a game that is still being played, which is what happened to the '
     + 'founder in the top of the 10th on 29 Aug.');
  ok('final.a-finished-game-still-settles',
     !!r.post && /score predictions/i.test(r.post),
     `when the feed genuinely says post the app must offer to settle, and it said "${r.post}". `
     + 'A guard that never lets anyone finish is worse than the bug.');
  ok('final.moreGameToCome-reads-the-feed',
     r.moreLive === true && r.morePost === false,
     `moreGameToCome() returned ${r.moreLive} while live and ${r.morePost} while post`);
  ok('final.no-page-errors-extra', errs.length===0, errs.slice(0,2).join(' · '));
  await b.close();
}

const verdict = fail? 'RED' : 'GREEN';
console.log(`\n${verdict}   ${pass} passed, ${fail} failed   [${path.basename(TARGET)} · ${ENGNAME}]`
            + (SABOTAGE?'   [SABOTAGED — red is the correct result]':''));
bad.forEach(x=>console.log('   x '+x));
/* Under --sabotage the meaning inverts: passing is the failure. */
if(SABOTAGE){ process.exit(fail?0:1); }
process.exit(fail?1:0);

})().catch(e=>{ console.log('final-buzzer.js could not run: '+(e&&e.stack||e)); process.exit(1); });
