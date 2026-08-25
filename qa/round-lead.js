#!/usr/bin/env node
/* =====================================================================
   A ROUND CANNOT SETTLE BEFORE IT HAPPENS, AND A CARD CANNOT INVENT A LEAD.
   ---------------------------------------------------------------------
   Founder screenshot, 24 Aug, TB @ DET, Top 2nd: the STATS tab read

       "YOUR CARD, LIVE · 0 of 5 leading"
       "⚡ +0 pts from leading at the round"
       "1 of 3 rounds settled so far"

   Zero rounds should have settled — baseball's round 1 (innings 1-3)
   doesn't close until the 3rd inning does, and Top 2nd is one inning in.
   Two bugs were hiding in that one screenshot, both from the same cause:
   checkQuarterLeadBonus() and stYourCard()'s live race were both written
   for basketball, where the Nth PERIOD is the Nth ROUND and every pick is
   a player stat (most points, most rebounds — see BB_PREDS). Neither is
   true for baseball, football, hockey or soccer, whose sheets are all
   pick'em (winner, over/under, first-to-score — see BA_PREDS, FO_PREDS,
   HO_PREDS, SC_PREDS). So for every sport but basketball:

     1. `per` (the raw ESPN period/inning number) was used directly as the
        round index. Basketball's periods ARE its rounds, 1-to-1, so this
        was invisible there. Baseball's three rounds cover NINE innings,
        so "1 period complete" got reported as "round 1 settled" two
        innings early.
     2. The race itself can't run at all — `KEY[p.id]` only knows
        pts/reb/ast/stl/blk, none of which a pick'em pick's id ever is —
        so every row returned '' before computing a lead, `winning` never
        incremented, and the header read "0 of N leading" EVERY SINGLE
        NIGHT, whether the player's picks were good or terrible. A
        permanently-false number is worse than a missing card.

   Fixed with two independent levers, and this suite pulls each one on its
   own so a regression in either shows up as a specific, named failure
   rather than one vague red line:

     statPicksSupported()   — gates the whole "leading" mechanic (both the
                               Stats-tab card and the ledger-writing bonus)
                               to sports whose picks are actually stat
                               shaped. False for baseball/football/hockey/
                               soccer today; true the day a sport's sheet
                               becomes stat-shaped, with no code change.
     INNINGS_PER_ROUND      — divides a period count down into a round
                               count. 1 (a no-op) for every sport but
                               baseball, where it is 3.

       node qa/round-lead.js [index-test.html]
       node qa/round-lead.js --sabotage
   ================================================================== */
const {chromium}=require('playwright');
const path=require('path'), fs=require('fs'), os=require('os');
const TARGET=path.resolve(process.argv.find(a=>/\.html$/.test(a)) || path.join(__dirname,'..','index-test.html'));
const SABOTAGE=process.argv.includes('--sabotage');

let pass=0, fail=0; const bad=[];
const ok=(n,c,d)=>{ if(c) pass++; else { fail++; bad.push(n+(d?'  — '+d:'')); } };
const PHONE={width:390, height:844};

/* One-line, uniquely-anchored levers — same convention as qa/change-it.js:
   if the pattern has moved, say so loudly rather than silently sabotaging
   nothing and reporting a false green. */
const LEVERS = {
  card: {
    name: 'the "no leading claim for pick\'em sports" branch in stYourCard()',
    from: "} else if(!hasStatBox){",
    to:   "} else if(false){"
  },
  math: {
    name: 'INNINGS_PER_ROUND (baseball innings -> rounds)',
    from: "var INNINGS_PER_ROUND = { baseball: 3 };",
    to:   "var INNINGS_PER_ROUND = {};"
  }
};

function writeCandidate(leverKey){
  let html=fs.readFileSync(TARGET,'utf8');
  if(leverKey){
    const L=LEVERS[leverKey];
    const before=html;
    html=html.replace(L.from, L.to);
    if(html===before){
      console.log('SABOTAGE DID NOT APPLY for "'+leverKey+'" ('+L.name+') — the pattern moved; fix this suite');
      process.exit(4);
    }
  }
  const tmp=path.join(os.tmpdir(),'round-lead-'+(leverKey||'real')+'.html');
  fs.writeFileSync(tmp, html);
  return tmp;
}

async function openBaseball(b, file){
  const p=await b.newPage({viewport:PHONE});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e&&e.message||e)));
  await p.goto('file://'+file+'?sport=baseball', {waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>typeof stYourCard==='function', {timeout:15000}).catch(()=>{});
  await p.waitForTimeout(800);
  return {p, errs};
}
async function openBasketball(b, file){
  const p=await b.newPage({viewport:PHONE});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e&&e.message||e)));
  await p.goto('file://'+file, {waitUntil:'domcontentloaded'}); // default sport
  await p.waitForFunction(()=>typeof stYourCard==='function', {timeout:15000}).catch(()=>{});
  await p.waitForTimeout(800);
  return {p, errs};
}

/* Lock every non-winner pick, the way a real card is filled in. */
const LOCK_PICKS = () => {
  S.predChoices = S.predChoices || {};
  preds.forEach(function(pr){ if(pr.id!=='winner' && pr.opts) S.predChoices[pr.id]=pr.opts[0]; });
};

(async()=>{
  const b=await chromium.launch();

  /* ================== 1. THE REAL, UNSABOTAGED BUILD ================= */
  {
    const file=writeCandidate(null);
    const {p, errs}=await openBaseball(b, file);

    const topOf2nd = await p.evaluate((lock)=>{
      eval('('+lock+')')();
      S.mode='live'; GS.ok=true; GS.state='in'; GS.box={'Some Player':{H:1}};
      GS.plays=[{period:2, type:'play'}];               // Top of the 2nd
      S.qleadDone={}; S.qleadMissed={}; S.qleadBox={};
      checkQuarterLeadBonus();
      return { qleadDone:S.qleadDone, card:stYourCard() };
    }, LOCK_PICKS.toString());

    ok('baseball at Top 2nd: no round is marked settled',
       Object.keys(topOf2nd.qleadDone).length===0,
       'S.qleadDone = '+JSON.stringify(topOf2nd.qleadDone));
    ok('baseball card: no fabricated "N of M leading" claim',
       !/\d+ of \d+ leading/.test(topOf2nd.card),
       (topOf2nd.card.match(/[^"]*of \d+ leading[^"]*/)||[''])[0]);
    ok('baseball card: no "pts from leading at the round" bonus line',
       !/pts from leading at the/.test(topOf2nd.card));
    ok('baseball card: still shows the picks, plainly',
       (topOf2nd.card.match(/stPickRow2/g)||[]).length===5,
       'expected 5 plain pick rows, got '+((topOf2nd.card.match(/stPickRow2/g)||[]).length));
    ok('no page errors (baseball, real build)', errs.length===0, errs.join(' | '));
    await p.close();
  }

  /* ================== 2. BASKETBALL MUST STILL WORK =================== */
  {
    const file=writeCandidate(null);
    const {p, errs}=await openBasketball(b, file);
    const q3 = await p.evaluate((lock)=>{
      eval('('+lock+')')();
      var field=((roster&&roster.home)||[]).concat((roster&&roster.away)||[]);
      S.predChoices.pts=field[0]; S.predChoices.reb=field[0];
      S.predChoices.ast=field[0]; S.predChoices.stl=field[0]; S.predChoices.blk=field[0];
      S.mode='live'; GS.ok=true; GS.state='in';
      var box={}; box[field[0]]={PTS:20,REB:5,AST:3,STL:2,BLK:1};
      GS.box=box; GS.plays=[{period:3, type:'play'}];   // in Q3 -> Q1,Q2 complete
      S.qleadDone={}; S.qleadMissed={}; S.qleadBox={};
      checkQuarterLeadBonus();
      var settled=JSON.parse(JSON.stringify(S.qleadDone));
      /* ====== RE-STATE THE LIVE FEED BEFORE RENDERING, ON PURPOSE ======
         checkQuarterLeadBonus() pays out Q1 as "missed" (no snapshot was
         taken while it was live), and ledgerSet() -> recomputeScore()
         re-enters loadGameStats(). That function is `async`, so the line

             if(GS.ev!==ev){ GS.ok=false; }

         runs SYNCHRONOUSLY, before its first await, inside this very
         evaluate. This harness never pinned GS.ev, so whenever the page
         had finished resolving its event during the wait above, GS.ok got
         knocked false between the bonus call and the render — and
         stYourCard() correctly fell to its pre-game "WHO YOU HAVE TO
         BEAT · season table still loading" branch instead of the live
         race. Measured 24 Aug: 2 of 5 runs, and 1 of 6 on the SHIPPED
         index.html too, so it is this suite's race and not the fix's.
         The bonus is asserted on the state it ran under (captured above);
         the card is asserted on the state it is about. */
      GS.ok=true; GS.state='in'; GS.box=box;
      return { qleadDone:settled, card:stYourCard(), supported: statPicksSupported() };
    }, LOCK_PICKS.toString());
    ok('basketball: statPicksSupported() is true', q3.supported===true);
    ok('basketball: exactly the two completed quarters are settled (Q3 live)',
       JSON.stringify(Object.keys(q3.qleadDone).sort())==='["1","2"]',
       JSON.stringify(q3.qleadDone));
    ok('basketball card: the leading count still renders', /\d+ of 5 leading/.test(q3.card));
    ok('no page errors (basketball, real build)', errs.length===0, errs.join(' | '));
    await p.close();
  }

  if(SABOTAGE){
    /* ============ LEVER 1: the sport-appropriateness gate ============= */
    const file=writeCandidate('card');
    const {p}=await openBaseball(b, file);
    const r = await p.evaluate((lock)=>{
      eval('('+lock+')')();
      S.mode='live'; GS.ok=true; GS.state='in'; GS.box={'Some Player':{H:1}};
      GS.plays=[{period:2, type:'play'}];
      S.qleadDone={}; S.qleadMissed={}; S.qleadBox={};
      checkQuarterLeadBonus();
      return { card: stYourCard() };
    }, LOCK_PICKS.toString());
    ok('SABOTAGE (card gate removed) does reproduce the fabricated claim',
       /\d+ of \d+ leading/.test(r.card),
       'expected the false claim back; got: '+r.card.slice(0,200));
    await p.close();

    /* ============ LEVER 2: innings-per-round math ====================
       Bypasses the (separately-tested) sport gate with a harness-only
       override — the same idiom qa/stats-page.js uses to force famNow()
       — so this isolates the DIVISION, not the gate that normally keeps
       baseball out of this function entirely. */
    const file2=writeCandidate('math');
    const {p:p2}=await openBaseball(b, file2);
    const r2 = await p2.evaluate((lock)=>{
      eval('('+lock+')')();
      window.statPicksSupported = function(){ return true; }; // test harness only
      S.mode='live'; GS.ok=true; GS.state='in'; GS.box={'Some Player':{H:1}};
      GS.plays=[{period:2, type:'play'}];                      // Top of the 2nd
      S.qleadDone={}; S.qleadMissed={}; S.qleadBox={};
      checkQuarterLeadBonus();
      return { qleadDone:S.qleadDone };
    }, LOCK_PICKS.toString());
    ok('SABOTAGE (innings-per-round math removed) does mark round 1 settled at Top 2nd',
       !!r2.qleadDone[1],
       'expected round 1 wrongly marked done; got '+JSON.stringify(r2.qleadDone));
    await p2.close();
  }

  await b.close();
  console.log('\n  round-lead.js — '+pass+' passed, '+fail+' failed'+(SABOTAGE?' (sabotage mode)':''));
  if(fail){ bad.forEach(n=>console.log('  FAIL '+n)); }
  process.exit(fail?1:0);
})();
