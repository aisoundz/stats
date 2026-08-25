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
  },
  /* Added 24 Aug, after build .219's gate was found to be inoperative in
     production. Each of these restores exactly one half of .219's bug. */
  gate: {
    name: 'statPicksSupported() asking about THIS CARD rather than about a sport',
    from: "      if(id && id!=='winner' && b[id]) return true;",
    to:   "      if(id) return !!(b.pts||b.reb||b.ast||b.stl||b.blk);"
  },
  family: {
    name: "sportCfg()'s refusal to adopt a game from another sport family",
    from: "    return !own || !f || f===own;",
    to:   "    return true;"
  },
  soccerid: {
    name: "SC_GAME naming its own sport (the soccer fixture's `sport` field)",
    from: '  sport:"soccer",',
    to:   '  /* sabotaged */'
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

  /* ========= 3. THE CARD IS BASEBALL AND THE MARQUEE IS BASKETBALL =====
     Build .219 shipped the gate above and the bug stayed live, because the
     gate asked "what sport is this?" of a function that will confidently
     answer with a DIFFERENT sport than the card on the screen.

     sportCfg() decides which league the page is by looking at GAME, and if
     GAME has no espnEvent it reaches past it — first to the ?game= room,
     then to tonight's marquee. An event id is a feed target, not an
     identity: every pick'em sport's practice fixture states its sport and
     league plainly and carries no event id, while BB_GAME pins a real WNBA
     one. So an unbound baseball card resolved to basketball, box.pts was
     'PTS', and .219's gate said "supported".

     Measured on the shipped index.html from a real tap — arrive on the
     WNBA room link, press Baseball in the practice sport picker:

         YOUR CARD, LIVE · 0 of 5 leading
         ⚡ +0 pts from leading at the quarters
         2 of 4 quarters settled so far

     ...on a baseball card. Both numbers fabricated, and the word is wrong
     as well.

     Reproduced here through TONIGHT rather than through a ?game= link, so
     this check does not depend on which two games happen to be baked into
     the slate on the day somebody runs it. TONIGHT is what featureTonight()
     writes from the live slate; setSport() is literally what the practice
     sport chip calls. GS is stood up by hand because there is no ESPN from
     a file:// page — and because that is honestly the state a real player
     is in after the swap: setSport() does not clear GS, so the previous
     room's live feed is still sitting there. */
  {
    const file=writeCandidate(null);
    const p=await b.newPage({viewport:PHONE});
    const errs=[]; p.on('pageerror',e=>errs.push(String(e&&e.message||e)));
    await p.goto('file://'+file, {waitUntil:'domcontentloaded'});
    await p.waitForFunction(()=>typeof statPicksSupported==='function', {timeout:15000}).catch(()=>{});
    await p.waitForTimeout(800);

    const sw = await p.evaluate((lock)=>{
      /* tonight's marquee is a basketball game (tipISO only has to exist —
         heroGame() tests it for truthiness, nothing here reads the date) */
      TONIGHT={ nightId:'marquee', espnEvent:'401857172', tipISO:'2026-01-01T00:00:00Z',
                sport:'basketball', league:'WNBA' };
      try{ window.TONIGHT=TONIGHT; }catch(_){}
      /* the previous room's live feed, still in memory across the swap */
      S.mode='live'; GS.ok=true; GS.state='in'; GS.ev='401857172';
      GS.box={'A Player':{PTS:20,REB:5,AST:3,STL:2,BLK:1}};
      GS.plays=[{period:3, type:'play'}];
      /* the tap */
      setSport('baseball'); try{ applySport(); }catch(_){}
      eval('('+lock+')')();

      var out={ predIds:preds.map(function(x){return x.id;}).join(','),
                path:sportCfg().path, fam:famNow(), rounds:roundCountNow(),
                word:roundWord(3), supported:statPicksSupported() };
      /* THE GATE, ASKED THE HARD WAY. Pin the config to a basketball box
         underneath a baseball card — the exact disagreement measured on the
         shipped build — and the gate must still refuse. This is the half of
         the fix that does not depend on sportCfg() being right, and the
         reason there are two levers and not one. */
      var real=window.sportCfg;
      try{
        window.sportCfg=function(){ var c=real(); return Object.assign({}, c,
          {box:{pts:'PTS',reb:'REB',ast:'AST',stl:'STL',blk:'BLK'}}); };
        out.supportedWithBasketballBox=statPicksSupported();
      } finally { window.sportCfg=real; }

      S.qleadDone={}; S.qleadMissed={}; S.qleadBox={};
      checkQuarterLeadBonus();
      out.qleadDone=S.qleadDone;
      out.card=stYourCard();
      return out;
    }, LOCK_PICKS.toString());

    ok('after the sport swap the card really is baseball',
       sw.predIds==='winner,runs,first,hr,ks,extras', sw.predIds);
    ok('sportCfg() names the sport the card belongs to, not the marquee\'s',
       sw.path==='baseball/mlb', 'sportCfg().path = '+sw.path);
    ok('the round vocabulary is baseball\'s, not basketball\'s',
       sw.fam==='baseball' && sw.rounds===3 && sw.word==='rounds',
       'famNow='+sw.fam+' roundCountNow='+sw.rounds+' roundWord='+sw.word);
    ok('the gate refuses even when the config hands it a basketball box',
       sw.supportedWithBasketballBox===false,
       'statPicksSupported() = '+sw.supportedWithBasketballBox+' on a card of '+sw.predIds);
    ok('swapped card: no fabricated "N of M leading" claim',
       !/\d+ of \d+ leading/.test(sw.card),
       (sw.card.match(/[^"]*of \d+ leading[^"]*/)||[''])[0]);
    ok('swapped card: no "settled so far" line and no basketball words',
       !/settled so far/.test(sw.card) && !/quarter/i.test(sw.card),
       (sw.card.match(/[^<>]*(settled so far|quarter)[^<>]*/i)||[''])[0]);
    ok('swapped card: no round marked settled',
       Object.keys(sw.qleadDone).length===0, JSON.stringify(sw.qleadDone));
    ok('no page errors (sport swap, real build)', errs.length===0, errs.join(' | '));
    await p.close();
  }

  /* ========= 4. EVERY SPORT, ON ITS OWN FRONT DOOR ====================
     ?sport= is the plainest instruction a player can give this app, and
     until 24 Aug it moved the CARD without moving the CONFIG. Measured on
     the shipped index.html, all four pick'em sports on ?sport=<sport>:

        baseball / football / hockey / soccer
        -> sportCfg().path basketball/wnba, famNow "basketball",
           roundCountNow 4, roundWord "quarters", statPicksSupported TRUE

     Four sports, one basketball answer, and the .219 gate open on every
     one of them. This walks all five and asks the whole question at once —
     does the config the page will act on describe the card the page is
     showing? Hockey has periods, soccer has halves, baseball has rounds,
     and only basketball's picks are stat shaped.

     Deliberately table-driven and not four copies: the day a sixth sport
     is added, this fails until it is listed, which is the only way a
     "every sport" check stays true. */
  {
    const file=writeCandidate(null);
    const WANT = {
      basketball:{path:'basketball/wnba', fam:'basketball', rounds:4, word:'quarters', supported:true},
      baseball:  {path:'baseball/mlb',    fam:'baseball',   rounds:3, word:'rounds',   supported:false},
      football:  {path:'football/nfl',    fam:'football',   rounds:4, word:'quarters', supported:false},
      hockey:    {path:'hockey/nhl',      fam:'hockey',     rounds:3, word:'periods',  supported:false},
      soccer:    {path:'soccer/usa.1',    fam:'soccer',     rounds:2, word:'halves',   supported:false}
    };
    let seen=[];
    for(const s of Object.keys(WANT)){
      const p=await b.newPage({viewport:PHONE});
      await p.goto('file://'+file+'?sport='+s, {waitUntil:'domcontentloaded'});
      await p.waitForFunction(()=>typeof sportCfg==='function', {timeout:15000}).catch(()=>{});
      await p.waitForTimeout(600);
      const got=await p.evaluate(()=>({ path:sportCfg().path, fam:famNow(),
        rounds:roundCountNow(), word:roundWord(2), supported:statPicksSupported() }));
      const w=WANT[s];
      ok('?sport='+s+' — the config describes the card in front of the player',
         got.path===w.path && got.fam===w.fam && got.rounds===w.rounds &&
         got.word===w.word && got.supported===w.supported,
         JSON.stringify(got)+' wanted '+JSON.stringify(w));
      seen.push(s);
      await p.close();
    }
    /* A list that has silently stopped covering a sport is worse than no
       list — same rule qa/all.js applies to itself. */
    const inApp = await (async()=>{
      const p=await b.newPage({viewport:PHONE});
      await p.goto('file://'+file, {waitUntil:'domcontentloaded'});
      await p.waitForFunction(()=>typeof SPORTS!=='undefined', {timeout:15000}).catch(()=>{});
      const k=await p.evaluate(()=>Object.keys(SPORTS));
      await p.close(); return k;
    })();
    ok('every sport the app offers is covered above',
       inApp.every(k=>seen.indexOf(k)>=0) && inApp.length===seen.length,
       'app has ['+inApp.join(',')+'], this check walks ['+seen.join(',')+']');
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

    /* ==== LEVERS 3 & 4: the two halves of the .219 miss ===============
       Neither of the levers above can catch these — section 1 stays green
       with EITHER half of this fix in place, which is exactly how .219
       shipped a gate that did nothing and a suite that could not say so.
       Each lever here restores one half and must bring back its own,
       specific, measured symptom. */
    /* LEVER 5: the soccer fixture forgetting which sport it is. Its symptom
       is on ?sport=soccer, not on the swap, so it gets its own run. */
    {
      const f=writeCandidate('soccerid');
      const pg=await b.newPage({viewport:PHONE});
      await pg.goto('file://'+f+'?sport=soccer', {waitUntil:'domcontentloaded'});
      await pg.waitForFunction(()=>typeof sportCfg==='function', {timeout:15000}).catch(()=>{});
      await pg.waitForTimeout(600);
      const s=await pg.evaluate(()=>({ path:sportCfg().path, word:roundWord(2), rounds:roundCountNow() }));
      ok('SABOTAGE (soccer fixture cannot name its sport) does put "quarters" on a soccer card',
         s.path==='basketball/wnba' && s.word==='quarters' && s.rounds===4,
         'expected the basketball answer back; got '+JSON.stringify(s));
      await pg.close();
    }

    for(const key of ['gate','family']){
      const f=writeCandidate(key);
      const pg=await b.newPage({viewport:PHONE});
      await pg.goto('file://'+f, {waitUntil:'domcontentloaded'});
      await pg.waitForFunction(()=>typeof statPicksSupported==='function', {timeout:15000}).catch(()=>{});
      await pg.waitForTimeout(800);
      const s=await pg.evaluate((lock)=>{
        TONIGHT={ nightId:'marquee', espnEvent:'401857172', tipISO:'2026-01-01T00:00:00Z',
                  sport:'basketball', league:'WNBA' };
        try{ window.TONIGHT=TONIGHT; }catch(_){}
        S.mode='live'; GS.ok=true; GS.state='in'; GS.ev='401857172';
        GS.box={'A Player':{PTS:20,REB:5,AST:3,STL:2,BLK:1}};
        GS.plays=[{period:3, type:'play'}];
        setSport('baseball'); try{ applySport(); }catch(_){}
        eval('('+lock+')')();
        var out={ path:sportCfg().path, word:roundWord(3) };
        var real=window.sportCfg;
        try{
          window.sportCfg=function(){ var c=real(); return Object.assign({}, c,
            {box:{pts:'PTS',reb:'REB',ast:'AST',stl:'STL',blk:'BLK'}}); };
          out.supportedWithBasketballBox=statPicksSupported();
        } finally { window.sportCfg=real; }
        return out;
      }, LOCK_PICKS.toString());
      if(key==='gate'){
        ok('SABOTAGE (card-shaped gate removed) does say "supported" on a baseball card',
           s.supportedWithBasketballBox===true,
           'expected the .219 gate back; got '+s.supportedWithBasketballBox);
      } else {
        ok('SABOTAGE (family guard removed) does put the baseball card on the basketball config',
           s.path==='basketball/wnba' && s.word==='quarters',
           'expected basketball/wnba + "quarters"; got '+s.path+' + "'+s.word+'"');
      }
      await pg.close();
    }
  }

  await b.close();
  console.log('\n  round-lead.js — '+pass+' passed, '+fail+' failed'+(SABOTAGE?' (sabotage mode)':''));
  if(fail){ bad.forEach(n=>console.log('  FAIL '+n)); }
  process.exit(fail?1:0);
})();
