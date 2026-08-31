#!/usr/bin/env node
/* =====================================================================
   STATS GAMETIME — pre-deploy QA engine
   ---------------------------------------------------------------------
   Run this before ANY promotion from a test file to the live file.
   Non-zero exit means do not deploy.

       node qa/qa.js                    # checks index-test.html + admin-test.html
       node qa/qa.js --file index.html  # check a specific file
       node qa/qa.js --quick            # static + unit only, no browser

   THE RULE THIS ENCODES. Every serious outage this platform has had was
   the same shape: a new feature whose new path was never exercised before
   deploy. Not carelessness — absence of machinery. So every bug that ever
   reached a player becomes a named test here, and it stays forever. The
   suite is allowed to get slow. It is not allowed to get smaller.
   ===================================================================== */
const fs=require('fs'), path=require('path'), {execFileSync}=require('child_process'), os=require('os');
const ROOT=path.resolve(__dirname,'..');
const F=require('./fixtures.js');

const args=process.argv.slice(2);
const QUICK=args.includes('--quick');
const only=(f)=>{const i=args.indexOf('--file');return i>=0?args[i+1]:f;};
const PLAYER=only('index-test.html'), ADMIN='admin-test.html';

let PASS=0, FAIL=0; const FAILS=[];
const ok =(id,note)=>{PASS++;console.log(`  \x1b[32m✓\x1b[0m ${id}`);};
const bad=(id,why,note)=>{FAIL++;FAILS.push({id,why,note});console.log(`  \x1b[31m✗ ${id}\x1b[0m — ${why}`+(note?`\n      guards: ${note}`:''));};
/* ---- A WEDGED MACHINE IS NOT A BROKEN BUILD -------------------------
   feed.live.group-crashed has been red on every build for days. It is not
   the build: the group blocks at 0% CPU with chromium alive, a wedged
   protocol call on this arm64 box, and it was already measured as such in
   the withTimeout comment below.

   Carrying a permanently red row is its own bug. It trained the only person
   who reads this gate to check whether a red also fails on the deployed
   build and then proceed, which is exactly the reflex that waves a real
   failure through. It nearly did, twice today.

   But hiding it would be worse, because then the gate reports green while a
   whole feed state went unexercised, and that is the sin qa/all.js exists
   to prevent. So a wedge is neither passed nor failed: it is RECORDED, the
   checks it took down are named as unrun, and the verdict line says so. */
const WEDGED=[];
const wedged=(id,why)=>{WEDGED.push({id,why});
  console.log(`  \x1b[33m⚠ ${id}\x1b[0m — ${why}`);
  console.log('      NOT a build failure and NOT a pass. These checks did not run.');};
const check=(id,cond,why,note)=> cond?ok(id,note):bad(id,why,note);
/* THE PERFECT PREDICTION CARD FOR WHATEVER GAME IS CONFIGURED.
   Every settlement test used to spell out five player names, so swapping
   the configured matchup turned the gate red for reasons that had nothing
   to do with the app. Built once, here, from the fixture cast. */
const PICKS=()=>({winner:F.CAST.home.name, pts:F.CAST.home.top, reb:F.CAST.home.dd,
                  ast:F.CAST.home.dime, stl:F.CAST.home.dime, blk:F.CAST.away.blk2});
const group=(t)=>console.log(`\n\x1b[1m${t}\x1b[0m`);

/* AN ABSOLUTE PATH IS ALREADY A PATH. path.join(ROOT, '/tmp/x') yields
   ~/stats/tmp/x, so `--file` with an absolute path died on ENOENT inside
   a fs stack trace — which reads like the gate is broken rather than like
   a path was mangled. Same trap qa/voice-wiring.js hit from the other
   direction, and the cost is the same: time spent on the wrong layer.
   Sabotage-testing a check means pointing the gate at a copy somewhere
   else, so this path has to work or the discipline cannot be practised. */
const read=(f)=>fs.readFileSync(path.isAbsolute(f)?f:path.join(ROOT,f),'utf8');
const scripts=(h)=>[...h.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]);

/* ========== 1. STATIC ================================================= */
function staticChecks(file){
  group(`STATIC — ${file}`);
  const h=read(file);
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'qa-'));

  // 1.1 every script block parses
  let syntaxOk=true, firstErr='';
  scripts(h).forEach((b,i)=>{
    const p=path.join(tmp,`b${i}.js`); fs.writeFileSync(p,b);
    for(const mode of [[],['--input-type=module']]){
      try{ execFileSync('node',[...mode,'--check',p],{stdio:'pipe'}); return; }
      catch(e){ firstErr=String(e.stderr||'').split('\n').slice(0,3).join(' '); }
    }
    syntaxOk=false;
  });
  check('syntax.parse', syntaxOk, `a <script> block does not parse: ${firstErr}`,
        'a syntax error ships a blank white page to every player');

  // 1.2 inline handlers resolve to something defined
  const handlers=new Set([...h.matchAll(/on(?:click|change|input|submit)="([A-Za-z_$][\w$]*)\s*\(/g)].map(m=>m[1]));
  const defined=new Set([
    ...[...h.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m=>m[1]),
    ...[...h.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/g)].map(m=>m[1]),
    ...[...h.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)].map(m=>m[1]),
    'if','return'
  ]);
  const missing=[...handlers].filter(x=>!defined.has(x));
  check('handlers.defined', missing.length===0, `onclick calls undefined: ${missing.join(', ')}`,
        'a button that calls a function that does not exist is a dead button with no error');

  /* 1.2b CSS THAT THE BROWSER SILENTLY THROWS AWAY.
     `font: 900 48px/54px inherit` looks reasonable and is invalid — a
     CSS-wide keyword cannot sit in the family slot of a shorthand, so the
     WHOLE declaration is dropped. No error, no warning: the element just
     renders at its inherited size and weight instead of the one that was
     designed. Thirty-six of these shipped, and they are a real part of why
     the typography never felt deliberate. Longhand only. */
  const deadFont=[...h.matchAll(/font:[^;}"']*\binherit\b/g)].map(m=>m[0].slice(0,44));
  check('css.no-dropped-font-shorthand', deadFont.length===0,
    `${deadFont.length} invalid font shorthand(s), e.g. ${deadFont.slice(0,2).join(' | ')}`,
    'the browser discards the entire declaration and the element quietly renders at the wrong size');

  /* 1.2c ONE TYPE RAMP, AND A FLOOR YOU CAN READ FROM A COUCH.
     Thirty-four different font sizes had accumulated — 12.5 next to 13
     next to 13.5, differences nobody can perceive and every one of them
     a decision made twice. Worse, 142 of them were under 12px, on a
     product whose entire job is to be glanceable on a phone held at
     arm's length while you are actually watching the television. That
     is not a small detail; it is most of why the app read as amateur.
     Thirteen sizes now, floor of 12. Adding a fourteenth should be a
     deliberate act, which is what this check makes it. */
  const RAMP=[12,14,15,17,20,22,24,26,30,34,40,46,52];
  const sizes=[...new Set([...h.matchAll(/font-size:\s*([0-9.]+)px/g)].map(m=>parseFloat(m[1])))];
  const offRamp=sizes.filter(s=>RAMP.indexOf(s)<0).sort((a,b)=>a-b);
  const tooSmall=sizes.filter(s=>s<12).sort((a,b)=>a-b);
  check('type.one-ramp', offRamp.length===0,
    `${offRamp.length} size(s) off the ramp: ${offRamp.join('px, ')}px`,
    'thirty-four sizes is not a design system, it is thirty-four separate guesses');
  check('type.readable-floor', tooSmall.length===0,
    `text below the 12px floor: ${tooSmall.join('px, ')}px`,
    'a companion app you read from the couch cannot have 9px type in it');

  /* 1.2d THE SITE HAS TO LOOK LIKE SOMETHING WHEN IT IS NOT OPEN.
     Reported from an iPhone: in Safari's Suggestions list, statsgametime.com
     rendered as a grey square with a letter S while HuffPost and ESPN showed
     their logos. The icons WERE there — inlined as data: URLs to keep the
     product to a single file — and Safari does not reliably read
     apple-touch-icon from a data: URL. A logo the browser cannot load is the
     same as no logo. Real files, real paths, checked. */
  if(file===PLAYER){                       // the Control Room is not a public page
    /* Safari asks for these root paths itself, before it reads a single
       <link>. A 404 there is what it caches, and it caches it hard. */
    const ICONS=['/favicon.ico','/icon-32.png','/icon-192.png','/apple-touch-icon.png',
                 '/apple-touch-icon-precomposed.png','/apple-touch-icon-152x152.png',
                 '/site.webmanifest','og.png'];
    const missingIcon=ICONS.filter(f=>h.indexOf(f)<0);
    check('brand.icons-are-real-files', missingIcon.length===0,
      `not referenced in the head: ${missingIcon.join(', ')}`,
      'REGRESSION: the icons were data: URLs, and Safari showed a grey letter instead of the logo');
    const dataIcon=/<link[^>]+rel="(?:apple-touch-icon|icon|manifest)"[^>]+href="data:/i.test(h);
    check('brand.no-data-url-icons', dataIcon===false,
      'an icon or the manifest is still inlined as a data: URL',
      'Safari will not read apple-touch-icon from a data: URL — that is the whole bug');
    /* The title is clipped everywhere it matters — a browser tab, a
       Suggestions tile, a shared link. Whatever survives the cut has to be
       the brand. */
    const dyn=(h.match(/document\.title=`([^`]*)`/)||[])[1]||'';
    check('brand.title-leads-with-the-brand', /^STATS GAMETIME/.test(dyn),
      `the live title starts "${dyn.slice(0,32)}"`,
      'REGRESSION: it read "STATS — Indiana Fever v New York Liberty", which clips to "STATS — Indiana F…" and looks like somebody else\'s site');
    check('brand.has-link-preview',
      /property="og:image"/.test(h) && /name="twitter:card"/.test(h),
      'no Open Graph or Twitter card image',
      'a game night spreads by somebody pasting the link into a group chat; it should look like something');
  }

  // 1.3 duplicate element ids
  const ids=[...h.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]);
  const dupes=[...new Set(ids.filter((v,i)=>ids.indexOf(v)!==i))];
  check('dom.unique-ids', dupes.length===0, `duplicate id(s): ${dupes.join(', ')}`,
        'getElementById silently returns the first — the second element becomes unreachable');

  // 1.4 build id present
  check('build.stamped', /STATS_BUILD|ADMIN_BUILD|\d{4}-\d{2}-\d{2}-(?:g\d|admin)/.test(h), 'no build id found in the file',
        'without a build stamp you cannot tell what is actually deployed');

  fs.rmSync(tmp,{recursive:true,force:true});
  return h;
}

/* ---- player-only structural invariants ---- */
function playerStructure(h){
  group('STRUCTURE — screen registry');
  const mapBlock=(h.match(/const map=\{[\s\S]*?\};/)||[''])[0];
  const backBlock=(h.match(/const BACKMAP=\{[\s\S]*?\};/)||[''])[0];
  const mapKeys=[...mapBlock.matchAll(/(\w+)\s*:\s*"(s-[\w-]+)"/g)].map(m=>({k:m[1],el:m[2]}));
  check('screens.map-nonempty', mapKeys.length>0, 'could not parse the screen map', 'the parser must fail loudly, not silently pass');

  const missingEl=mapKeys.filter(x=>!h.includes(`id="${x.el}"`)).map(x=>x.k);
  check('screens.have-dom', missingEl.length===0, `screen(s) in map with no <section>: ${missingEl.join(', ')}`,
        'go() to a screen with no element shows a blank page');

  const backKeys=new Set([...backBlock.matchAll(/(\w+)\s*:/g)].map(m=>m[1]));
  const noBack=mapKeys.filter(x=>!backKeys.has(x.k)).map(x=>x.k);
  check('screens.have-backmap', noBack.length===0, `screen(s) missing from BACKMAP: ${noBack.join(', ')}`,
        'a screen with no BACKMAP entry strands the player with no way out');

  // every nav tab has a branch in navGo
  const tabs=[...h.matchAll(/data-nav="(\w+)"/g)].map(m=>m[1]);
  const navGo=(h.match(/function navGo\(tab\)\{[\s\S]*?\n\}/)||[''])[0];
  const noBranch=[...new Set(tabs)].filter(t=>!new RegExp(`['"]${t}['"]`).test(navGo));
  check('nav.tabs-wired', noBranch.length===0, `nav tab(s) with no navGo branch: ${noBranch.join(', ')}`,
        'a tab that falls through navGo does nothing when tapped');

  // two tabs must never resolve to the same screen (the "Board and Home are the same" report)
  const dests={};
  [...navGo.matchAll(/tab===['"](\w+)['"]\)?\s*\{?\s*[^}]*?go\(['"](\w+)['"]\)/g)].forEach(m=>{
    (dests[m[2]]=dests[m[2]]||[]).push(m[1]);
  });
  const collided=Object.entries(dests).filter(([,v])=>v.length>1).map(([s,v])=>`${v.join('+')}→${s}`);
  check('nav.tabs-distinct', collided.length===0, `tabs share a destination: ${collided.join(', ')}`,
        'REGRESSION: "Board and Home are the same thing" — a tab that redirects to another tab is not navigation');
}

/* ========== 2. UNITS — pure logic lifted from the shipped source ====== */
function slice(src,from,to,label){
  const a=src.indexOf(from), b=src.indexOf(to);
  if(a<0||b<0||b<=a) { bad(`unit.anchor:${label}`,`could not locate ${label} in source`,'the harness must fail when the code moves, not silently skip'); return null; }
  return src.slice(a,b);
}

function unitTests(){
  group('UNITS — scoring and question maths');
  const admin=read(ADMIN);

  // 2.1 server-derived speed (anti-cheat)
  const sb=slice(admin,'function tms(v)','function scoreSub(sub, spec)','serverBank');
  if(sb){
    let gradeRid='r0'; const GTIMES={rid:'r0',byUid:{}};
    let serverBank; eval(sb.replace('function serverBank','serverBank = function'));
    const T=ms=>({toMillis:()=>ms}), base=1786400000000;
    GTIMES.byUid={fast:{o0:T(base),a0:T(base+1200)}, slow:{o0:T(base),a0:T(base+18900)},
      over:{o0:T(base),a0:T(base+26000)}, skew:{o0:T(base+5000),a0:T(base)},
      half:{o0:T(base)}, none:{}};
    const cases=[['fast',19],['slow',1],['over',0],['skew',null],['half',null],['none',null]];
    const wrong=cases.filter(([u,w])=>serverBank(u,0,20)!==w).map(([u])=>u);
    check('speed.server-derived', wrong.length===0, `wrong bank for: ${wrong.join(', ')}`,
          'speed points decide the leaderboard tiebreak — a wrong formula silently reorders the night');
    GTIMES.rid='r1';
    check('speed.cross-round-guard', serverBank('fast',0,20)===null, 'stamps from another round were used',
          'grading round 2 with round 1 timings would pay people for the wrong question');
  }

  // 2.2 retrospective Call It: the stored answer must match the actual play
  const cb=slice(admin,'CI.scorerName = function(p)','CI.write = function(q)','CI.build');
  if(cb){
    const CI={countPer:{},
      abbr:(id,T)=>String(id)===String(T.homeId)?T.homeAbbr:(String(id)===String(T.awayId)?T.awayAbbr:''),
      teamName:(id,T)=>String(id)===String(T.homeId)?T.homeName:(String(id)===String(T.awayId)?T.awayName:'They')};
    const E={isMadeFG:p=>p.scoringPlay&&(p.scoreValue===2||p.scoreValue===3)};
    eval(cb);
    const T={homeId:F.CAST.home.id,awayId:F.CAST.away.id,homeAbbr:F.CAST.home.ab,awayAbbr:F.CAST.away.ab,
                 homeName:F.CAST.home.name,awayName:F.CAST.away.name};
    const last=F.PLAYS.filter(E.isMadeFG).slice(-1)[0];
    let wrong=[], unanchored=[], ft=[];
    for(let rot=0;rot<3;rot++){
      CI.countPer[3]=rot; const q=CI.build(F.PLAYS,T,3);
      if(!q){wrong.push('rot'+rot+':null');continue;}
      let good=false;
      if(q.kind==='sawTwoOrThree') good=q.ans===String(last.scoreValue);
      else if(q.kind==='sawWho'||q.kind==='sawRun') good=q.ans===String(last.team.id);
      else if(q.kind==='sawScorer'){const a=q.options.find(o=>o.v===q.ans); good=!!a&&a.k===F.CAST.home.top;}
      if(!good) wrong.push(q.kind);
      if(!/made it|that last bucket|in a row/.test(q.prompt)) unanchored.push(q.kind);
      if(/free throw/i.test(q.prompt)) ft.push(q.kind);
    }
    /* THE QUARTER-RETROSPECTIVE KINDS. Rotations 3–5 ask about the whole
       quarter rather than the last bucket, and every answer is computed by
       the generator rather than marked by the host — so if the arithmetic
       is wrong, the room is graded wrong and nobody finds out. Truth is
       recomputed here independently from the same plays. */
    {
      const per=3;
      const qp=F.LONG.filter(p=>p.period && Number(p.period.number)===per);
      const qs=qp.filter(p=>p.scoringPlay && Number(p.scoreValue)>0);
      const firstId=String(qs[0].team.id);
      const n3=qs.filter(p=>Number(p.scoreValue)===3).length;
      let ph=0, pa=0;
      qs.forEach(p=>{ const id=String(p.team.id);
        if(id===T.homeId) ph+=Number(p.scoreValue); else if(id===T.awayId) pa+=Number(p.scoreValue); });
      const want={ qtrFirst:firstId,
                   qtrThrees:(n3<=1?'a':(n3<=3?'b':'c')),
                   qtrMore:(ph>pa?T.homeId:T.awayId) };
      const seen=[], bad=[];
      for(let rot=3;rot<=5;rot++){
        CI.countPer[per]=rot;
        const q=CI.build(F.LONG,T,per);
        if(!q){ bad.push('rot'+rot+':null'); continue; }
        seen.push(q.kind);
        if(want[q.kind]!==undefined && String(q.ans)!==String(want[q.kind]))
          bad.push(q.kind+': got '+q.ans+' want '+want[q.kind]);
        if(/^qtr/.test(q.kind)){
          if(!(q.options||[]).some(o=>String(o.v)===String(q.ans))) bad.push(q.kind+':answer not an option');
          if(!/quarter/i.test(q.prompt)) bad.push(q.kind+':prompt does not say which window it means');
        }
      }
      check('callit.quarter-kinds-build', seen.filter(k=>/^qtr/.test(k)).length>=2,
        `rotations 3-5 produced ${seen.join(', ')}`,
        'the whole point is questions you can only answer by having watched the quarter');
      check('callit.quarter-answers-correct', bad.length===0, bad.slice(0,3).join(' | '),
        'these answers are computed, never marked by the host — wrong arithmetic grades the whole room wrong and nobody finds out');
      CI.countPer[per]=0;
    }

    check('callit.answer-correct', wrong.length===0, `wrong answer for: ${wrong.join(', ')}`,
          'a Call It that grades the wrong way breaks the streak and the trust in one tap');
    check('callit.anchored', unanchored.length===0, `unanchored prompt: ${unanchored.join(', ')}`,
          '"that bucket" is ambiguous if the feed lags — every prompt names the score it produced');
    check('callit.no-free-throw', ft.length===0, `built off a free throw: ${ft.join(', ')}`,
          'REGRESSION: a made free throw is not a bucket — it once resolved "two or three?" nonsensically');
    CI.countPer[3]=0;
    const none=CI.build([{sequenceNumber:9,scoringPlay:true,scoreValue:1,team:{id:'2'},text:'X makes free throw 1 of 2'}],T,3);
    check('callit.no-data-no-question', none===null, 'returned a question with no made field goal to ask about',
          'inventing a question when the feed has nothing is how a bank starts lying');
  }
}


/* ---- INLINE HANDLERS MUST SURVIVE BEING CALLED ----------------------
   The static check proves a handler is DEFINED. It cannot prove the
   handler works, and the difference is not academic: a wrapper written as
   `window.f = function(){ return f(); }` at global scope reassigns the
   very name it calls, so pressing the button recursed until the stack
   blew. It passed "is it defined" and failed the first real press.
   This calls every global referenced by an inline onclick and fails on a
   stack overflow or a missing function. Guarded so a handler that simply
   needs sign-in is not counted as broken. */
async function handlersCallable(page, file){
  return await page.evaluate(()=>{
    const names=[...new Set(Array.from(document.querySelectorAll('[onclick]'))
      .map(el=>{const m=String(el.getAttribute('onclick')||'').match(/^\s*([A-Za-z_$][\w$]*)\s*\(/); return m?m[1]:null;})
      .filter(Boolean))];
    const bad=[];
    names.forEach(n=>{
      const fn=window[n];
      if(typeof fn!=='function'){ bad.push(n+': not a function'); return; }
      try{ fn(); }
      catch(e){
        const msg=String(e&&e.message||e);
        if(/Maximum call stack|is not a function|undefined is not/.test(msg)) bad.push(n+': '+msg.slice(0,60));
      }
    });
    return bad;
  });
}

/* ========== 3. BROWSER ================================================ */
/* Fill the prediction card's exact-number box by SELECTOR, not by a handle
   captured earlier. See the note at its first call site: under load the card
   repaints between the two and a captured handle detaches, failing the gate
   for a build that is fine. */
async function pdFill(p, v){
  try{ await p.fill('#predCard .pdbonus input', String(v==null?7:v), {timeout:4000}); }
  catch(_){ /* the box genuinely went away — that is the caller's business */ }
}

async function browserTests(){
  const {chromium}=require('playwright');
  /* ONE CHROMIUM FOR ~40 HEAVY PAGES WAS THE WHOLE BUG.
     The suite died near the end with "Failed to create browser context",
     which is resource exhaustion, not logic — and because browserTests()
     had one try/catch at the call site, it surfaced as the single opaque
     failure "the browser suite crashed" while two entire feed states went
     unexercised behind it.

     Measured before fixing: 70 lightweight pages open and close with
     contexts pinned at 1 and no failure, so page churn is not the problem
     and neither is this box (43Gi free). The real pages are far heavier —
     each loads an 885KB document, pulls a fixture feed, renders the Stats
     tab and runs quarters — and roughly forty of those in one browser is
     what runs it out. Nothing here needs a single long-lived browser, so
     it gets recycled instead.

     Recycling only happens when NOTHING is open, so it can never pull a
     page out from under a group that is mid-check. */
  const launch=()=>chromium.launch((require('fs').existsSync('/opt/pw-browsers/chromium')?{executablePath:'/opt/pw-browsers/chromium'}:{}));
  let b=await launch();
  let pagesMade=0;
  const RECYCLE_EVERY=12;
  /* The feed-state groups are the last and heaviest in the suite, and the
     browser has already served ~35 pages by the time they start. Recycling
     on a page COUNT does not help them, because the count boundary lands
     wherever it lands. Give them an explicit fresh browser instead: at a
     group boundary nothing is open, so this is always safe. */
  const forceRecycle=async()=>{
    const open=b.contexts().reduce((n,c)=>n+c.pages().length,0);
    if(open!==0) return;
    const old=b;
    b=await launch();
    pagesMade=0;
    Promise.race([old.close().catch(()=>{}), new Promise(r=>setTimeout(r,5000))]).catch(()=>{});
  };
  const mkPage=async(vp)=>{
    if(pagesMade && pagesMade%RECYCLE_EVERY===0){
      const open=b.contexts().reduce((n,c)=>n+c.pages().length,0);
      if(open===0){
        /* NEVER BLOCK ON CLOSING A BROWSER YOU ARE THROWING AWAY.
           The first version did `await b.close()` here and that is what
           wedged the live feed group for 180 seconds. Proof it was not the
           group's own work: every operation that group performs runs in
           1.9s total in isolation, with zero page errors — the wedge was
           positional, landing on whichever group happened to fall on a
           recycle boundary. Closing a degraded chromium can hang forever,
           and awaiting it hands that hang to the caller.

           So: launch the replacement FIRST, then let the old one go without
           waiting on it. A browser being discarded owes us nothing, and if
           it refuses to die the OS reaps it when the run ends. */
        const old=b;
        b=await launch();
        Promise.race([
          old.close().catch(()=>{}),
          new Promise(r=>setTimeout(r,5000))
        ]).catch(()=>{});
      }
    }
    pagesMade++;
    const pg=await b.newPage({viewport:vp});
    /* browser.newPage() makes its own context and Playwright disposes it
       with the page — but only if close() is actually reached. A check that
       throws first leaks both, so close() is wrapped to take the context
       down explicitly and to never throw during teardown. */
    const _close=pg.close.bind(pg);
    pg.close=async()=>{
      const c=pg.context();
      try{ await _close(); }catch(_){}
      try{ await c.close(); }catch(_){}
    };
    /* ============ EVERY PAGE PLAYS A HYDRATED NIGHT ===================
       From 26 Aug joinNight() refuses to seat anybody into a BAKED night
       that has expired — see qa/stale-seat.js, written after 76 real
       visitors were filed into gn13-2026-08-19-min-gs over the week
       after that game finished.

       Suites load the app from file:// with no slate to read, so GAME
       stays BB_GAME and BB_GAME is stale eighteen hours after its tip.
       Left alone the ident checks stop testing identity and start
       testing the staleness guard: `wrote` stays null because the join
       never reached SB.join, and the suite reports "a fresh device
       overwrote the seat" on a build where the seat was never touched.

       Registered HERE, on every page this helper makes, and as an
       initScript rather than a post-boot evaluate — freshStart() ends in
       location.reload(), which wipes a one-shot. GAME does not exist at
       init time, so this polls, stops on the first success, and gives up
       after 15s rather than spinning. */
    try{
      await pg.addInitScript(() => {
        try {
          var t = setInterval(function () {
            try {
              if (typeof GAME !== 'undefined' && GAME) {
                /* Un-baked is no longer enough. joinNight() now asks
                   nightHasExpired(), which is about the TIP, so a fixture
                   night whose tipISO is a week old is refused however the
                   flag reads.

                   DO NOT TOUCH tipISO HERE. Two attempts did and both
                   broke a pretip check, in opposite directions: a PAST tip
                   turns feed-down-before-tip's 'not-started' into
                   'no-host', and a FUTURE tip turns no-push-feed-down's
                   'no-host' into 'not-started'. No single value satisfies
                   both, because those two checks exist precisely to tell
                   the two states apart. The suites that care about the
                   clock set it themselves. */
                delete GAME.__baked;
                clearInterval(t);
              }
            } catch (_) {}
          }, 10);
          setTimeout(function () { try { clearInterval(t); } catch (_) {} }, 15000);
        } catch (_) {}
      });
    }catch(_){}
    return pg;
  };
  /* A GATE MUST NEVER HANG. Measured: the live feed group blocked for
     twenty minutes at 0% CPU with ten chromium processes alive — a wedged
     protocol call, not a busy loop. Every Playwright call has its own
     timeout, but a wedged transport outlives all of them, and a suite that
     hangs is strictly worse than one that fails: nobody learns anything and
     the run never reports. So each group gets a hard ceiling, and blowing
     it is a normal named failure that costs that group and nothing else. */
  const withTimeout=(work, ms, label)=>Promise.race([
    work,
    new Promise((_,rej)=>setTimeout(()=>rej(new Error(`${label} exceeded ${Math.round(ms/1000)}s — treated as wedged`)), ms))
  ]);

  const url='file://'+path.join(ROOT,PLAYER);

  const newPage=async(vp,feed)=>{
    const p=await mkPage(vp);
    /* Default is 30s per operation; nothing in this suite legitimately
       waits that long, and a lower ceiling turns a wedge into a fast,
       localised failure instead of a slow mystery. */
    try{ p.setDefaultTimeout(15000); }catch(_){}
    const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
    await p.route('**/site.api.espn.com/**', r=> feed==='down'
      ? r.fulfill({status:500,contentType:'application/json',body:'{}'})
      : r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(feed)}));
    /* NOT blocking Firestore here, deliberately. It was tried and it breaks
       the app's BOOT rather than just the fallback: no slate loads, so no
       game is ever chosen, so the Stats tab is never even asked the
       question this scenario exists to ask. A test that stops the subject
       from starting is not testing the subject. */
    await p.route('**/assets.mailerlite.com/**', r=>r.fulfill({status:200,body:'{}'}));
    /* ============ THE GATE MUST NOT PLAY THE GAME =====================
       index.html carries the REAL Firebase config, so a test that sets
       S.mode='live' signed in anonymously and wrote a REAL seat into the
       REAL configured night. Ten full gate runs put ten "QA" players into
       Game Night #10's room hours before tip.

       Not merely untidy: run.js computes everyoneIn = subs >= seats, so
       ghost seats that never answer make "everyone has answered"
       permanently false and force every round to burn its full 150-second
       wait — which is exactly the delay that stops a cumulative resolver
       from reading the box score while it is still true. The test suite
       would have degraded the night it exists to protect.

       ESPN and MailerLite were already stubbed here. Firebase never was.
       The SDK itself still loads; only sign-in and Firestore traffic are
       cut, so the app sees "backend unavailable" — a state this suite
       already tests deliberately — instead of a live production database. */
    await p.route('**/identitytoolkit.googleapis.com/**', r=>r.abort());
    await p.route('**/securetoken.googleapis.com/**',     r=>r.abort());
    await p.route('**/firestore.googleapis.com/**',       r=>r.abort());
    /* B2. A LIVE ROUND ONLY EXISTS IF THE HOST PUSHED IT. Since the
       one-question-bank fix, startQuarter() in live mode refuses to open a
       round the Control Room never opened — so any check that drives a live
       question has to say who pushed it. This is the smallest honest stand-in
       for that push: the round document the app's own watch would have
       received. It deliberately supplies no questions, so the built-in bank
       still renders them and layout checks measure what they always did.
       Checks that are ABOUT the absence of a push simply never call it.

       It goes in as an init script, not a post-load evaluate, because three
       groups in this suite re-navigate the page they were handed — and a
       helper installed by evaluate does not survive a reload, which is
       exactly how this arrived: as a crash. */
    await p.addInitScript(()=>{
      window.__hostRound = function(qi, state){
        try{ HR.doc = {id:'r'+qi, idx:qi, state:state||'live'}; }catch(_){}
      };
      window.__noHostRound = function(){ try{ HR.doc=null; }catch(_){} };
    });
    await p.goto(url,{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(1800);
    /* The hydrated-night initScript is registered in the newPage helper
       above, so it survives freshStart()'s reload and covers every page
       this file makes, not just this one. */
    /* ---- THE SUITE'S DEFAULT PERSONA IS A SIGNED-IN MEMBER --------
       The five nav tabs are behind the door now (see TAB_LOCKED /
       tabsUnlocked in the player), so a suite that drives navGo() as an
       anonymous visitor is testing the lock, over and over, instead of
       the screens. A member is who navigates tabs, so a member is the
       default here — and the handful of checks that are ABOUT being
       signed out call __signOut() explicitly, which is more honest than
       leaving it implicit in the boot state. */
    await p.evaluate(()=>{
      window.SB = window.SB || {};
      window.__signIn  = function(){ SB.verified = function(){ return true;  }; };
      window.__signOut = function(){ SB.verified = function(){ return false; }; };
      window.__signIn();
      /* LEAN ships ON. Every check written before it drives the full app, so
         the default here is OFF and the LEAN group turns it on explicitly.
         A flag that could not be turned off would have deleted four hundred
         checks' worth of coverage the day it shipped, silently, which is the
         exact class of thing LEAN exists to prevent. */
      try{ LEAN_ON = false; if(typeof paintNav==='function') paintNav(); }catch(_){}
    });
    return {p,errs};
  };

  const VPS=[{name:'phone',width:393,height:852},{name:'laptop',width:1440,height:900}];

  for(const vp of VPS){
   /* A crash in ONE viewport must not hide the twenty group() sections
      that follow it. Before this, any throw anywhere in these 1400 lines
      aborted browserTests() entirely and the run reported "the browser
      suite crashed" with ~85 of 512 checks having run — which reads as a
      small failure and is actually near-total blindness. */
   try{
    group(`BROWSER — ${vp.name} ${vp.width}x${vp.height}`);
    const {p,errs}=await newPage({width:vp.width,height:vp.height},F.PRE);

    check(`boot.no-errors.${vp.name}`, errs.length===0, `page errors on load: ${errs.slice(0,2).join(' | ')}`,
          'a thrown error during boot can leave half the app wired and half not');

    // ---- the pick deck cannot be left in an unfinishable state
    await p.evaluate(()=>{ startDemo(); S.name='QA'; startPredict(); });
    await p.waitForTimeout(400);
    await p.click('#predCard .pdopt'); await p.waitForTimeout(420);
    /* ============ A HANDLE TAKEN BEFORE A REPAINT IS A STALE HANDLE ==
       21 Aug: this went red on BOTH viewports with "elementHandle.fill:
       Element is not attached to the DOM", and nothing was wrong with the
       build — four clean reruns proved it. The Jetson was hosting four
       game runners and a live night at the time, the card repainted in
       the gap between $() and fill(), and the handle pointed at a node
       that no longer existed.

       A gate that goes red under load is worse than no gate, because it
       teaches you that red does not mean stop. Locator-style fill()
       re-resolves the selector at the moment it acts and waits for the
       element, so a repaint between the two is no longer a failure. */
    if(await p.$('#predCard .pdbonus input')) await pdFill(p);
    for(let k=0;k<4;k++){
      const can=await p.evaluate(()=>{const b=document.querySelector('[data-pdgo="1"]');return b&&!b.disabled;});
      if(!can) break;
      await p.click('[data-pdgo="1"]'); await p.waitForTimeout(200);
      await p.click('#predCard .pdopt'); await p.waitForTimeout(200);
      if(await p.$('#predCard .pdbonus input')) await pdFill(p);
    }
    const skipped=await p.evaluate(()=>({
      done:preds.filter(x=>S.predChoices[x.id]).length, total:preds.length,
      blankDots:Array.from(document.querySelectorAll('.pddot')).filter(d=>!d.className.includes('fill')).length,
      lock:document.getElementById('pdLock').textContent.trim()
    }));
    check(`deck.gap-is-visible.${vp.name}`,
      skipped.done===skipped.total || skipped.blankDots>0,
      'a card was skipped and nothing on screen shows which one',
      'REGRESSION: "5/6 locked" with every visible card filled and no way to find the empty one');

    if(skipped.done<skipped.total){
      await p.click('#pdLock'); await p.waitForTimeout(800);
      const rec=await p.evaluate(()=>{
        /* Same correction as deck.next-question-comes-to-you: the guarantee
           is that the blank card is READABLE and ANSWERABLE, not that its
           box happens to start near the top. */
        const c=document.getElementById('predCard');
        const q=c.querySelector('.pdq');
        const bar=document.getElementById('pdBar').getBoundingClientRect();
        const qt=q?q.getBoundingClientRect().top:null;
        const hidden=[...c.querySelectorAll('.pdopt')]
          .filter(o=>{const g=o.getBoundingClientRect(); return g.bottom>bar.top+1 && g.top<bar.bottom;}).length;
        return {onBlank:!S.predChoices[predOrderList()[PD.i].id],
                inView: qt!==null && qt>0 && qt<window.innerHeight*0.6,
                qt: qt===null?null:Math.round(qt), hidden};
      });
      check(`deck.recovery-jumps.${vp.name}`, rec.onBlank, 'the finish button did not land on the blank card',
            'REGRESSION: the recovery button worked but scrolled nowhere, so it read as a dead button');
      check(`deck.recovery-scrolls.${vp.name}`, rec.inView,
            `jumped to the blank card but left it unusable — question at ${rec.qt}px, ${rec.hidden} option(s) behind the bar`,
            'REGRESSION: on a laptop the deck was above the fold — the tap looked like nothing happened');
      await p.click('#predCard .pdopt'); await p.waitForTimeout(500);
    }
    const finished=await p.evaluate(()=>({done:preds.filter(x=>S.predChoices[x.id]).length,total:preds.length,
      ready:document.getElementById('pdLock').className.includes('ready')}));
    check(`deck.completable.${vp.name}`, finished.done===finished.total&&finished.ready,
      `deck still incomplete (${finished.done}/${finished.total})`,
      'REGRESSION: the prediction sheet could not be completed at all');

    await p.click('#pdLock'); await p.waitForTimeout(700);
    check(`deck.locks.${vp.name}`, (await p.evaluate(()=>S.screen))==='lobby', 'locking the card did not reach the lobby',
      'the single most important transition in the night');

    // ---- Call It: fires once, resolves on answer, leaves the screen
    /* Count QUESTIONS OPENED, not guard keys. The first version of this
       test counted keys in demoCiFired and passed while the bug was
       deliberately reintroduced — a false negative, which is worse than
       no test, because it certifies a broken build. Instrument the real
       thing: every distinct qid that reaches the card in 'open' state. */
    await p.evaluate(()=>{
      window.__opened=new Set();
      const orig=window.renderCiCard;
      window.renderCiCard=function(q){
        try{ if(q && (q.state||'open')==='open' && q.qid) window.__opened.add(q.qid); }catch(e){}
        return orig.apply(this,arguments);
      };
    });
    for(let i=0;i<6;i++){ await p.evaluate(()=>renderLobby(0)); await p.waitForTimeout(90); }
    await p.waitForTimeout(6000);
    const opened=await p.evaluate(()=>window.__opened.size);
    check(`callit.no-repeat.${vp.name}`, opened<=1, `${opened} distinct Call It questions opened across 6 lobby repaints`,
      'REGRESSION: a shuffled bank broke the already-fired guard and a new Call It popped up on every repaint');

    const up=await p.evaluate(()=>{const c=document.getElementById('ciCard');return c&&c.style.display==='block';});
    if(up){
      await p.click('#ciCard .ciopt'); await p.waitForTimeout(3200);
      /* WAS RED SINCE 137ba32 AND THE PRODUCT WAS NEVER BROKEN.
         This used to assert /resolved/i against the card's innerText. That
         word was deliberately taken OUT of the copy in GN11's commit, and
         the code says why in its own comment: "resolved was the machine's
         word, not the player's — the card only ever appears once the answer
         is in, so the state was never news." The card now says "Nice call ·
         +15" or "Not this time" or "You sat this one out". So the check was
         a second copy of a fact the product owns, went stale the moment the
         copy improved, and sat red through eleven game nights next to three
         real failures — which is exactly how a gate stops being read.

         Assert the SUBSTANCE instead: the question reached the resolved
         state, the card put a result block on screen, and that block has a
         headline a player can read. All three are true of any wording. */
      const res=await p.evaluate(()=>{
        const inner=document.getElementById('ciInner');
        const q=(window.PCI&&PCI.active)||null;
        const h=inner?inner.querySelector('.ciresh'):null;
        return { state:q?(q.state||null):null,
                 graded:!!(q&&window.PCI&&PCI.graded&&PCI.graded[q.qid]),
                 hasResult:!!(inner&&inner.querySelector('.cires')),
                 head:h?String(h.innerText||'').trim():'' };
      });
      check(`callit.resolves-on-answer.${vp.name}`,
        res.state==='resolved' && res.hasResult && res.head.length>0,
        `3s after answering: state=${res.state} graded=${res.graded} resultBlock=${res.hasResult} headline="${res.head}"`,
        'REGRESSION: answered cards hung on "waiting on the play…" indefinitely. Asserts the resolved STATE and a readable result, never one particular word — the word changed once already');
      await p.waitForTimeout(12500);
      check(`callit.auto-hides.${vp.name}`,
        (await p.evaluate(()=>document.getElementById('ciCard').style.display))==='none',
        'the resolved card never left the screen',
        'REGRESSION: a resolved card sat over the leaderboard for a whole quarter');
    }

    // ---- Call It must never survive onto a question screen
    await p.evaluate(()=>{ ensureCiCard(); document.getElementById('ciCard').style.display='block'; go('live'); });
    await p.waitForTimeout(400);
    check(`callit.hidden-on-live.${vp.name}`,
      (await p.evaluate(()=>document.getElementById('ciCard').style.display))==='none',
      'a Call It card is visible on the live question screen',
      'REGRESSION: it covered the score and the quarter question and looked frozen');

    // ---- nothing overlaps the back button on any reachable screen
    /* Hit-test real pixels, not bounding boxes. The first version compared
       the button's rect against the first child's rect and reported eleven
       screens — all false, because those children are full-width wrappers
       with no text of their own. A check that cries wolf gets ignored, and
       an ignored check is worse than no check. */
    const overlaps=await p.evaluate(()=>{
      const out=[]; const bb=document.getElementById('backBtn');
      const ownText=(el)=>Array.from(el.childNodes)
        .filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join('');
      Object.keys(map).forEach(k=>{
        try{
          go(k);
          if(!bb.classList.contains('show')) return;
          const r=bb.getBoundingClientRect();
          bb.style.pointerEvents='none';
          const pts=[[r.left+r.width/2,r.top+r.height/2],[r.right-3,r.top+3],
                     [r.left+3,r.bottom-3],[r.right-3,r.bottom-3]];
          const hit=pts.some(([x,y])=>{
            const e=document.elementFromPoint(x,y);
            if(!e||e===bb) return false;
            if(ownText(e).length===0) return false;      // container, not content
            const cs=getComputedStyle(e);
            return cs.visibility!=='hidden' && cs.opacity!=='0';
          });
          bb.style.pointerEvents='';
          if(hit) out.push(k);
        }catch(e){}
      });
      return out;
    });
    check(`layout.back-button-clear.${vp.name}`, overlaps.length===0,
      `back button covers text on: ${overlaps.join(', ')}`,
      'REGRESSION: the back button sat on the live score strip and ate the first digit of your own points');

    // ---- no flash of the wrong screen on refresh
    check(`boot.paint-gated.${vp.name}`,
      await p.evaluate(()=>document.body.classList.contains('booted')),
      'the app never marked itself booted — the paint curtain would stay shut',
      'the failsafe must always open the app, even if boot throws');

    /* ---- NO HOST SURFACE REACHABLE BY A PLAYER --------------------
       A screen badged HOST MODE was on the end-of-game menu, so anyone
       who finished a night could open the operator's side of the product.
       Removing the button is not access control — the function is global
       and the screen is still in the DOM. This calls the openers directly
       and asserts they refuse. */
    const hostLeak=await p.evaluate(()=>{
      const bad=[];
      ['openHost','openTally'].forEach(fn=>{
        if(typeof window[fn]!=='function') return;
        try{ window[fn](); }catch(e){}
        if(S.screen==='host'||S.screen==='tally') bad.push(fn+' opened '+S.screen);
      });
      const menu=document.body.innerText||'';
      if(/Peek behind the curtain/i.test(menu)) bad.push('host panel button is still on a player screen');
      return bad;
    });
    check(`security.no-host-surface.${vp.name}`, hostLeak.length===0,
      `a player can reach host tooling: ${hostLeak.join(', ')}`,
      'REGRESSION: the HOST MODE engine room was one tap from the end-of-game menu for every player');

    /* ---- RELOAD MID-GAME FROM EVERY TAB ----------------------------
       THE Game #5 fire. Mid-game state saved `screen`, and the resume path
       only recognised game screens — so tapping Gametime/Stats/Board/Me
       wrote a value resume did not know, the resume bar never appeared,
       and two live players restarted at zero mid-night. Any new navigation
       surface must be tested against a reload from that surface. */
    const resumeCheck=await p.evaluate(()=>{
      const out=[];
      const tabs=Array.from(document.querySelectorAll('#botnav .navb')).map(b=>b.getAttribute('data-nav'));
      tabs.forEach(t=>{
        // put the player mid-game, then go look at the tab
        /* Score the way the app scores. Since A1 the total is DERIVED
           from S.led — assigning S.pts is not a thing the product can do
           any more, so a test that does it is testing a code path that no
           longer exists. */
        S.mode='live'; S.qi=1; S.place='lobby';
        try{ ledgerClear(); ledgerSet('r0',42,0,'live'); }catch(e){ S.pts=42; }
        try{ go('lobby'); }catch(e){}
        try{ navGo(t); }catch(e){}
        try{ save(); }catch(e){}
        /* LS_KEY IS A FUNCTION NOW. One save slot per NIGHT rather than
           per sport, because two rooms sharing a slot is how the flagship's
           half-played card followed a player into the other game. Passing
           it as a value coerced the function to its own source text and
           used that as the key — every read came back null and the save
           looked like it had never been written. */
        let blob=null; try{ blob=JSON.parse(localStorage.getItem(LS_KEY())||'null'); }catch(e){}
        if(!blob){ out.push(t+': nothing saved'); return; }
        const where = blob.place || blob.screen;
        if(['predict','lobby','live','review','predreview','break'].indexOf(where)<0)
          out.push(t+': save says "'+where+'" — resume will not recognise it');
        if(Number(blob.pts)!==42) out.push(t+': points lost in the save ('+blob.pts+')');
      });
      try{ S.mode='demo'; localStorage.removeItem(LS_KEY()); }catch(e){}
      return out;
    });
    check(`state.survives-tab-switch.${vp.name}`, resumeCheck.length===0,
      `mid-game save corrupted by: ${resumeCheck.join(' · ')}`,
      'REGRESSION: tapping a nav tab mid-game made the night unresumable — two live players restarted at 0');

    /* ---- A PHONE WAKING UP MUST NOT RESTART THE NIGHT --------------
       "Every time it locks and I log back in it goes back to the 1st
       quarter and asks me to lock in my picks." iOS discards the page;
       the player lands on the marketing home, presses Play, and gets a
       blank pick sheet for a card they already locked. */
    const wake=await p.evaluate(()=>{
      S.mode='live'; S.name='QA'; S.qi=2; S.nextQ=2; S.place='lobby';
      try{ ledgerClear(); ledgerSet('r0',42,0,'live'); }catch(e){ S.pts=42; }
      try{ renderLobby(2); go('lobby'); save(); }catch(e){}
      const blob=JSON.parse(localStorage.getItem(LS_KEY())||'null');
      return blob ? {place:blob.place, pts:blob.pts} : null;
    });
    check(`state.wake-saves-position.${vp.name}`, !!wake && wake.place==='lobby' && Number(wake.pts)===42,
      `mid-night save is wrong: ${JSON.stringify(wake)}`,
      'the save must record the game position and the score before any reload');

    const replay=await p.evaluate(()=>{
      // simulate the reload path without navigating: resume from the blob
      const saved=JSON.parse(localStorage.getItem(LS_KEY())||'null');
      if(!saved) return 'no save';
      resumeData=saved;
      try{ doResume(); }catch(e){ return 'doResume threw: '+e.message; }
      return {screen:S.screen, pts:S.pts};
    });
    check(`state.auto-resume.${vp.name}`,
      replay && replay.screen==='lobby' && Number(replay.pts)===42,
      `resume landed wrong: ${JSON.stringify(replay)}`,
      'REGRESSION: a locked phone restarted the night at Q1 and asked for picks again');

    /* ---- A SAVE BELONGS TO ONE NIGHT ------------------------------
       The save key is per-sport. With two game nights inside 24 hours,
       an unkeyed save hands last night's locked card, last night's score
       and a roster of people who aren't playing to every returning
       player — automatically, because resume is automatic. */
    const stale=await p.evaluate(()=>{
      S.mode='live'; S.name='QA'; S.qi=2; S.pts=99; S.place='lobby';
      S.predChoices={pts:'Somebody From Last Night'};
      try{ save(); }catch(e){}
      const stamped=(JSON.parse(localStorage.getItem(LS_KEY())||'{}')||{}).nid;
      // now pretend the app has moved on to the next game night
      const blob=JSON.parse(localStorage.getItem(LS_KEY()));
      blob.nid='gn-some-other-night';
      localStorage.setItem(LS_KEY(), JSON.stringify(blob));
      resumeData=null;
      try{ checkResume(); }catch(e){ return {err:e.message}; }
      const after=localStorage.getItem(LS_KEY());
      // ...and an ancient save with no stamp at all is also not tonight's
      localStorage.setItem(LS_KEY(), JSON.stringify({mode:'live',place:'lobby',pts:77}));
      resumeData=null;
      try{ checkResume(); }catch(e){}
      const afterUnstamped=localStorage.getItem(LS_KEY());
      S.mode='demo'; try{ localStorage.removeItem(LS_KEY()); }catch(e){}
      return {stamped, cleared:after===null, unstampedCleared:afterUnstamped===null, resumed:!!resumeData};
    });
    check(`state.save-is-per-night.${vp.name}`,
      !!stale.stamped && stale.cleared && stale.unstampedCleared && !stale.resumed,
      `stale-night handling wrong: ${JSON.stringify(stale)}`,
      'REGRESSION: two game nights in two days meant every returning player resumed inside YESTERDAY\'s game');

    /* ---- A RESUMED PLAYER MUST REJOIN THE ROOM --------------------
       THE root cause of Game #5's dead room. doResume() restored the
       screen but never called joinNight(), so the backend layer's
       nightId stayed null and EVERY room operation silently no-opped:
       the board was empty, trash talk was dead, answers never reached
       the host, and the hosted-round watcher never started so no
       Gametime questions ever arrived. Auto-resume made it certain. */
    /* Split: an evaluate() that returns a promise living 300ms in the page
       is garbage-collected if anything disturbs the context, which crashes
       the whole suite on a slower machine. Setup, wait, read. */
    await p.evaluate(()=>{
      window.__qaPrevJoin=window.joinNight; window.__qaJoinCalls=0; window.__qaErr=null;
      window.joinNight=function(){ window.__qaJoinCalls++; return Promise.resolve(true); };
      S.mode='live'; S.name='QA'; S.qi=2; S.nextQ=2; S.pts=42; S.place='lobby';
      try{ save(); }catch(e){}
      const saved=JSON.parse(localStorage.getItem(LS_KEY())||'null');
      if(!saved){ window.joinNight=window.__qaPrevJoin; window.__qaErr='no save'; return; }
      resumeData=saved;
      try{ doResume(); }catch(e){ window.joinNight=window.__qaPrevJoin; window.__qaErr='doResume threw: '+e.message; }
    });
    await p.waitForTimeout(300);
    const rejoin=await p.evaluate(()=>{
      try{ window.joinNight=window.__qaPrevJoin; }catch(e){}
      if(window.__qaErr) return window.__qaErr;
      return {joinCalls: window.__qaJoinCalls||0, screen:S.screen};
    });
    check(`state.resume-rejoins-room.${vp.name}`,
      !!rejoin && rejoin.joinCalls>=1,
      `a resumed live player did not rejoin the room: ${JSON.stringify(rejoin)}`,
      'REGRESSION: resume left nightId null — empty board, dead trash talk, answers never reached the host, no pushed rounds');

    const playGuard=await p.evaluate(()=>{
      try{ go('landing'); startPredict(); }catch(e){ return 'threw: '+e.message; }
      return S.screen;
    });
    /* ---- B-63: PRACTICE MUST NOT SCORE THE LIVE NIGHT --------------
       Found by the founder two hours before GN10. Practice and the live
       game shared one ledger, so a practice run walked back into the live
       night carrying its points: "You're already in this one — 180 pts",
       a red "Q4 is open" banner and a graded question four, before tip.
       save() then persisted it because S.mode was 'live' again by then.
       The CARD must survive the switch — predChoices are local-only, so
       clearing them to fix this would cost a player their 600-point sheet. */
    const modeLeak = await p.evaluate(()=>{
      const out={};
      setMode('live');
      S.predChoices={winner:'x',pts:'y'};
      ledgerSet('r0q0',40,3,'live'); recomputeScore();
      setMode('demo');
      out.practiceStartsClean = (S.pts===0);
      out.cardSurvivedIn = Object.keys(S.predChoices).length;
      ledgerSet('r0q0',90,5,'live'); ledgerSet('r0q1',90,5,'live'); recomputeScore();
      out.practiceScored = S.pts;
      setMode('live');
      out.liveComesBackClean = (S.pts===0);
      out.cardSurvivedOut = Object.keys(S.predChoices).length;
      try{ S.mode='demo'; ledgerClear(); recomputeScore(); S.predChoices={}; }catch(e){}
      return out;
    });
    check(`state.practice-does-not-score-the-live-night.${vp.name}`,
      modeLeak.practiceStartsClean===true && modeLeak.liveComesBackClean===true
      && modeLeak.practiceScored>0,
      `mode switch leaked: ${JSON.stringify(modeLeak)}`,
      'B-63: practice and the live night shared one ledger, so a practice run put its score on the live scoreboard before tip — and save() persisted it');
    check(`state.the-card-survives-a-practice-game.${vp.name}`,
      modeLeak.cardSurvivedIn===2 && modeLeak.cardSurvivedOut===2,
      `predChoices did not survive the mode switch: in=${modeLeak.cardSurvivedIn} out=${modeLeak.cardSurvivedOut}`,
      'predChoices are LOCAL ONLY — nothing pushes them — so wiping them to isolate practice would cost a player the 600-point sheet they just filled in');

    /* ---- B-65: ONE SCORE, ONE OWNER --------------------------------
       GN10. The same player saw 254 on his card, 236 on the board eight
       pixels below, 478 on his phone at the buzzer, 291 on his laptop, and
       the server held 836. Every surface totalled its own local ledger and
       the server's graded numbers were never shown. The night is 1,000:
       live + the 600-point card + Caught It. */
    const oneScore = await p.evaluate(()=>{
      const out={};
      setMode('live');
      ledgerSet('r0q0',478,94,'live'); recomputeScore();
      out.preview = S.pts;                       // this device only ever saw live
      lastStand = [
        {name:'Me',  me:true,  pts:478, predPts:258, catchPts:0, caughtPts:100, total:836, speed:94},
        {name:'Two', me:false, pts:400, predPts:100, catchPts:0, caughtPts:100, total:600, speed:113}
      ];
      out.shown = shownTotal();
      out.rank  = shownRank();
      const keep=lastStand; lastStand=null;
      out.fallback = shownTotal();               // before the server speaks
      lastStand=keep;
      setMode('demo'); ledgerSet('r0q0',150,5,'live'); recomputeScore();
      out.practice = shownTotal();               // practice has no server row, ever
      try{ setMode('live'); ledgerClear(); recomputeScore(); lastStand=null; }catch(e){}
      return out;
    });
    check(`score.one-number-and-it-is-the-servers.${vp.name}`,
      oneScore.shown===836 && oneScore.fallback===oneScore.preview && oneScore.practice===150,
      `totals disagree: ${JSON.stringify(oneScore)}`,
      'B-65: the final card printed this device\u2019s live-only preview against a 1,000 ceiling that includes the 600-point card, under-reporting one player by 358');
    check(`score.rank-comes-from-the-board.${vp.name}`,
      oneScore.rank===1,
      `rank was ${oneScore.rank}, expected 1 from the ordered board`,
      'SB.rank() compared the server\u2019s live-only pts against this device\u2019s all-lanes total, which no player could clear \u2014 every phone reported "#1 of 4"');

    check(`state.play-does-not-restart.${vp.name}`, playGuard==='lobby',
      `pressing Play mid-night went to "${playGuard}" instead of back to the game`,
      'REGRESSION: the Play button handed back a blank pick sheet for an already-locked card');
    await p.evaluate(()=>{ try{ S.mode='demo'; S.place=''; localStorage.removeItem(LS_KEY()); }catch(e){} });

    /* ---- THE BOARD MUST READ FOR ITSELF ---------------------------
       Two real players on two devices, both in Firestore, and the board
       was empty — because it rendered whatever the LOBBY poller had last
       cached, and the bottom nav lets you reach the Board without ever
       passing through the lobby. */
    await p.evaluate(()=>{
      window.SB=window.SB||{};
      window.__qaBoard={mode:S.mode, top:SB.top, en:SB.enabled};
      SB.enabled=true;
      SB.top=function(){ return Promise.resolve([
        {name:'P1',color:'#fff',pts:14,speed:2,me:true},
        {name:'P2',color:'#fff',pts:9,speed:1,me:false}]); };
      S.mode='live';
      try{ lastStand=null; }catch(e){}
      try{ navGo('board'); }catch(e){}
    });
    /* Poll, do not sleep. A fixed 900ms was enough for the phone viewport
       and not for the laptop one on slower hardware, so this reported "the
       Board rendered empty" for a Board that simply had not painted yet —
       a timing flake dressed as a regression. Wait for the condition, with
       the same 900ms as a floor and a real ceiling. */
    await p.waitForFunction(()=>{
      const el=document.getElementById('bdBody');
      return !!(el && /P1/.test(el.innerText) && /P2/.test(el.innerText));
    }, null, {timeout:6000}).catch(()=>{});
    const boardSelf=await p.evaluate(()=>{
      /* Defensive on purpose. This read used to throw inside a setTimeout,
         so its promise never resolved and Playwright reported the far less
         useful "Resulting promise was garbage collected" — which took the
         WHOLE suite down and hid every check after it. A single check must
         never be able to do that. */
      const el=document.getElementById('bdBody');
      try{ SB.top=window.__qaBoard.top; SB.enabled=window.__qaBoard.en; S.mode=window.__qaBoard.mode; }catch(e){}
      if(!el) return 'no #bdBody in the document (page replaced mid-test?)';
      const t=el.innerText;
      return /P1/.test(t) && /P2/.test(t);
    });
    check(`board.reads-for-itself.${vp.name}`, boardSelf===true,
      'the Board rendered empty with two players available from the backend',
      'REGRESSION: two players on two devices did not appear on the board');

    // ---- every tab reaches a distinct screen
    const tabScreens=await p.evaluate(()=>{
      const seen={};
      Array.from(document.querySelectorAll('#botnav .navb')).forEach(b=>{
        const t=b.getAttribute('data-nav');
        try{ navGo(t); seen[t]=S.screen; }catch(e){ seen[t]='ERROR'; }
      });
      return seen;
    });
    const vals=Object.entries(tabScreens).filter(([k])=>k!=='crew').map(([,v])=>v);
    check(`nav.distinct-destinations.${vp.name}`, new Set(vals).size===vals.length,
      `tabs collide: ${JSON.stringify(tabScreens)}`,
      'REGRESSION: Board routed to Home, so two tabs were the same thing');

    /* ---- THE ROOM MUST PUT YOU IN THE ROOM ------------------------
       "Fix trash talk. It don't work." Same root cause as the empty
       Board in Game #5, surfacing in the one place I never checked:
       Trash Talk is reachable from the nav before a player has ever
       joined, so the backend has no night, every read returns nothing
       and every send is refused with a reason nobody sees. */
    const talk=await p.evaluate(async()=>{
      let joins=0;
      const prevJoin=window.joinNight;
      window.joinNight=function(){ joins++; return Promise.resolve(true); };
      window.SB=window.SB||{};
      const prev={en:SB.enabled, inRoom:SB.inRoom, talk:SB.talk, say:SB.say,
                  ver:SB.verified, wt:SB.watchTalk};
      SB.enabled=true; SB.inRoom=function(){ return false; };     // signed in, not joined
      /* Liveness is signedInNow() + a night + not-a-rehearsal now, so a test
         that wants a live room has to actually present one. */
      SB.verified=function(){ return true; };
      SB.watchTalk=null;                                          // force the poller path
      SB.talk=function(){ SB.lastTalkError='not-in-room'; return Promise.resolve(null); };
      S.mode='live'; S.practice=false; S.name='QA';

      try{ openTalk(); }catch(e){ return {err:e.message}; }
      await new Promise(r=>setTimeout(r,120));
      const joinedOnOpen = joins>0;

      // the empty state must NAME the reason, not say "nothing said yet"
      ttWhy='not-in-room'; ttLines=[];
      try{ renderRoom(); }catch(e){}
      const txt=(document.getElementById('talkBody').innerText||'');
      const honest = /not in tonight’s room|not in tonight's room/i.test(txt);
      const lying  = /nothing said yet/i.test(txt);

      // permission-denied gets its own, actionable sentence
      ttWhy='permission-denied'; try{ renderRoom(); }catch(e){}
      const perm=/reload/i.test(document.getElementById('talkBody').innerText||'');

      try{ closeTalk(); }catch(e){}
      window.joinNight=prevJoin;
      SB.enabled=prev.en; SB.inRoom=prev.inRoom; SB.talk=prev.talk; SB.say=prev.say;
      SB.verified=prev.ver; SB.watchTalk=prev.wt;
      S.mode='demo';
      return {joinedOnOpen, honest, lying, perm};
    });
    check(`talk.opening-joins-the-room.${vp.name}`, talk.joinedOnOpen===true,
      'opening Trash Talk does not join the night',
      'REGRESSION: the room was reachable from the nav before joining, so every read returned nothing and every send was silently refused');
    check(`talk.empty-state-is-honest.${vp.name}`, talk.honest===true && talk.lying===false,
      `room showed "${talk.lying?'nothing said yet':'?'}" over a failed read`,
      'a cheerful empty state over a silent failure cost us a whole game night of guessing on the Board');
    check(`talk.names-the-reason.${vp.name}`, talk.perm===true,
      'a permission failure does not tell the player what to do',
      '"it doesn\'t work" is what you get back when the app will not say why');

    /* ---- YOU ARE STILL YOU AFTER A RELOAD -------------------------
       The handle was written to a profile the moment it was picked, and
       then only ever read back inside prefillGate() — which runs on the
       handle screen and nowhere else. So a returning player was anonymous
       on every other screen: the room did not know them, and the app was
       about to ask a question it already had the answer to. The game save
       could not cover this, by design — it is stamped to one night and
       cleared when that night ends. Identity is not part of a game save. */
    const ident=await p.evaluate(async()=>{
      const R={};
      const prevName=S.name, prevColor=S.color;
      /* (a) the SHIPPED boot path, called directly — not a copy of it */
      try{ localStorage.setItem('stats_profile_v1', JSON.stringify({name:'Anis',color:'#28e0d0',sport:'Basketball'})); }catch(e){}
      S.name=''; S.color='#2f6bff'; try{ colorTouched=false; }catch(e){}
      R.hasBootRestore = (typeof restoreIdentity==='function');
      try{ restoreIdentity(); }catch(e){}
      R.nameRestored = (S.name==='Anis');
      R.colourRestored = (S.color==='#28e0d0');

      /* (b) a device that has forgotten you must not rename your seat */
      const prevJoin={ join:SB.join, en:SB.enabled, ver:SB.verified, uid:SB.uid, inRoom:SB.inRoom };
      let wrote=null;
      SB.enabled=true; SB.verified=function(){return true;}; SB.uid=function(){return 'u1';};
      SB.inRoom=function(){return true;};
      SB.join=function(o){
        const seat={name:'Anis', color:'#28e0d0'};
        let n=o.name, c=o.color;
        if(seat.name  && (!o.name  || o.name==='player')) n=seat.name;
        if(seat.color && (!o.color || o.color==='#888'))  c=seat.color;
        wrote={name:n,color:c}; SB.joinedAs={name:n,color:c};
        return Promise.resolve(true);
      };
      S.name=''; S.color='#2f6bff';            // fresh device: no idea who you are
      try{ localStorage.removeItem('stats_profile_v1'); }catch(e){}
      /* A CURRENT NIGHT, SCOPED TO THIS CHECK. joinNight() refuses a night
         whose tip is more than 18h past (qa/stale-seat.js), and the build's
         baked fallback tipped on 19 August. This block is about IDENTITY,
         not about the clock, so give it a night somebody could actually be
         sitting in. Deliberately NOT page-wide: the pretip checks in this
         same file need a pre-tip AND a post-tip state, and no single value
         satisfies all three. */
      try{ GAME.tipISO = new Date(Date.now() + 3*60*60*1000).toISOString(); }catch(e){}
      await joinNight();
      R.seatKeptItsName   = !!(wrote && wrote.name==='Anis');
      R.seatKeptItsColour = !!(wrote && wrote.color==='#28e0d0');
      R.adoptedTheName    = (S.name==='Anis');
      R.wroteToProfile    = ((JSON.parse(localStorage.getItem('stats_profile_v1')||'{}')).name==='Anis');

      SB.join=prevJoin.join; SB.enabled=prevJoin.en; SB.verified=prevJoin.ver;
      SB.uid=prevJoin.uid; SB.inRoom=prevJoin.inRoom; delete SB.joinedAs;
      S.name=prevName; S.color=prevColor;
      try{ localStorage.removeItem('stats_profile_v1'); }catch(e){}
      return R;
    });
    check(`ident.handle-survives-a-reload.${vp.name}`,
      ident.hasBootRestore===true && ident.nameRestored===true && ident.colourRestored===true,
      `a returning player boots with no handle (restore=${ident.hasBootRestore} name=${ident.nameRestored} colour=${ident.colourRestored})`,
      'REGRESSION: the profile was only read on the handle screen, so the app asked a question it already had the answer to');
    check(`ident.second-device-keeps-your-name.${vp.name}`,
      ident.seatKeptItsName===true && ident.seatKeptItsColour===true,
      `joining from a fresh device overwrote the seat (name=${ident.seatKeptItsName} colour=${ident.seatKeptItsColour})`,
      'opening a laptop mid-night must not rename you to "player" or repaint your dot for everyone else');
    check(`ident.second-device-recognises-you.${vp.name}`,
      ident.adoptedTheName===true && ident.wroteToProfile===true,
      'the seat knew the name and the app did not adopt it',
      'the room should call you by your name on the second device, not leave you blank');

    /* ---- THE ROOM IS OPEN IF THERE IS A ROOM ----------------------
       "Trash talk still doesn't work", reported on the morning of Game
       #6 with a real room open. It was never Firestore. Trash Talk was
       gated on `S.mode !== 'demo'`, and S.mode is "demo" on every fresh
       page load — it only becomes "live" after you press Play and walk
       through the handle screen. So a signed-in player who opened the
       site and tapped Talk, which is the most natural thing in the world
       to do in the hour before tip when there is nothing else to do yet,
       was told "The room · offline — this is the practice run."
       Three checks: a real night must read as live from a cold load, it
       must not cost you a seat on the leaderboard just to look, and an
       ACTUAL practice run must still say practice run. */
    const room=await p.evaluate(async()=>{
      const R={}; const said=[]; let joins=0, observes=0;
      window.SB=window.SB||{};
      const prev={en:SB.enabled, ver:SB.verified, uid:SB.uid, inRoom:SB.inRoom,
                  seated:SB.seated, obs:SB.observe, wt:SB.watchTalk, say:SB.say,
                  talk:SB.talk, join:window.joinNight};
      let night='';
      SB.enabled=true;
      SB.verified=function(){ return true; };
      SB.uid=function(){ return 'uid-qa'; };
      SB.inRoom=function(){ return !!night; };
      SB.seated=function(){ return !!night && !!SB.__seat; };
      SB.observe=function(n){ observes++; night=n; return true; };
      window.joinNight=function(){ joins++; night='qa'; SB.__seat=true; return Promise.resolve(true); };
      SB.watchTalk=function(cb){ setTimeout(function(){ cb([{id:'a',name:'HoopsOracle',
        text:'Fever by 8',at:1,color:'#ffffff',kind:'chat'}]); },20); return function(){}; };
      SB.say=function(o){ said.push(o.text); return Promise.resolve({ok:true}); };
      SB.talk=function(){ return Promise.resolve([]); };

      /* A COLD LOAD. This is the state the live site was actually in. */
      S.mode='demo'; S.practice=false; S.name=''; ttLines=[]; ttLastAt=0;
      try{ ttRoomStop(); }catch(e){}
      R.liveFromColdLoad = ttHasRoom();

      openTalk();
      await new Promise(r=>setTimeout(r,450));
      const txt=document.getElementById('talkBody').innerText||'';
      R.saysLive     = /live tonight/i.test(txt);
      R.saysPractice = /practice run/i.test(txt);
      R.showsTheRoom = /HoopsOracle/.test(txt);
      R.noSeatToLook = (joins===0 && observes>=1);

      /* No handle: may read, may not post, and is shown where to get one. */
      document.getElementById('ttInput').value='let me in';
      await ttSend(); await new Promise(r=>setTimeout(r,120));
      R.blocksAnonPost = (said.length===0);
      R.sendsYouForAHandle = (S.screen==='name');
      /* And the box must have SAID so before you typed into it. */
      try{ openTalk(); }catch(e){}
      await new Promise(r=>setTimeout(r,150));
      R.asksForAHandleUpFront = /handle/i.test(document.getElementById('ttInput').placeholder||'');

      /* With a handle: posts, and takes the seat on the way through. */
      S.name='QA'; try{ openTalk(); }catch(e){}
      await new Promise(r=>setTimeout(r,250));
      document.getElementById('ttInput').value='here we go';
      await ttSend(); await new Promise(r=>setTimeout(r,250));
      R.postsWithHandle = (said.indexOf('here we go')>=0);
      R.seatsOnFirstPost = (joins>=1);

      /* An actual rehearsal still reads as one. */
      S.practice=true; try{ renderRoom(); }catch(e){}
      R.practiceStillSaysPractice = /practice run/i.test(document.getElementById('talkBody').innerText||'');

      try{ closeTalk(); }catch(e){}
      SB.enabled=prev.en; SB.verified=prev.ver; SB.uid=prev.uid; SB.inRoom=prev.inRoom;
      SB.seated=prev.seated; SB.observe=prev.obs; SB.watchTalk=prev.wt; SB.say=prev.say;
      SB.talk=prev.talk; window.joinNight=prev.join; delete SB.__seat;
      S.practice=false; S.mode='demo'; S.name=''; ttLines=[]; try{ ttLive=false; }catch(e){}
      return R;
    });
    check(`talk.live-from-a-cold-load.${vp.name}`,
      room.liveFromColdLoad===true && room.saysLive===true && room.saysPractice===false,
      `a signed-in player with a real night open sees ${room.saysPractice?'"practice run"':'no live room'}`,
      'REGRESSION: this is the "trash talk still doesn\'t work" bug — S.mode is "demo" until you press Play, so the room called itself offline on game night');
    check(`talk.cold-load-shows-the-room.${vp.name}`, room.showsTheRoom===true,
      'the room was live but nobody else\'s lines rendered',
      'a live header over an empty box is the same broken feeling as an offline one');
    check(`talk.reading-costs-no-seat.${vp.name}`, room.noSeatToLook===true,
      'opening the room wrote a player document',
      'looking at the room should not put you on tonight\'s leaderboard as "player"');
    check(`talk.composer-says-what-it-needs.${vp.name}`, room.asksForAHandleUpFront===true,
      'the box invited you to "say something" and then bounced you to the handle screen',
      'a placeholder that promises something the button refuses is how "it doesn\'t work" starts');
    check(`talk.no-handle-no-post.${vp.name}`,
      room.blocksAnonPost===true && room.sendsYouForAHandle===true,
      `posted without a handle (blocked=${room.blocksAnonPost}) or did not offer one (screen=${room.sendsYouForAHandle})`,
      'six people called "player" is not a conversation — but refusing without a way forward is the old bug again');
    check(`talk.handle-then-post-works.${vp.name}`,
      room.postsWithHandle===true && room.seatsOnFirstPost===true,
      'a named player could not post, or posted without ever taking a seat',
      'the first thing you say is also the moment you join the room');
    check(`talk.practice-still-says-practice.${vp.name}`, room.practiceStillSaysPractice===true,
      'an actual rehearsal claimed to be tonight\'s live room',
      'over-correcting the offline bug would promise a room that genuinely is not there');

    /* ---- WALK A WHOLE PRACTICE NIGHT TO ITS LAST SCREEN -----------
       THE GAP THAT LET THIS SHIP. Every check in this suite pokes ONE
       screen in isolation, so each of them passed while the actual
       journey — press Practice, play it out, reach the end — landed on
       "The feed didn't settle it" with a form asking the player to type
       in the official box score. The screen we deleted weeks ago. Nobody
       re-added it; practice simply fell through into the LIVE fallback,
       because tonight's game has not been played and so nothing could
       settle. No test walked the road, so no test saw the hole in it.
       This one walks it. */
    const night=await p.evaluate(async()=>{
      const R={};
      try{
        startDemo(); S.name='QA'; S.practice=true;
        startPredict(); await new Promise(r=>setTimeout(r,200));
        // fill the whole card the way a person would
        for(let k=0;k<10;k++){
          const L=predOrderList();
          const blank=L.findIndex(x=>!S.predChoices[x.id]);
          if(blank<0) break;
          PD.i=blank; buildPred();
          const o=document.querySelector('#predCard .pdopt:not(.isout)');
          if(!o) break;
          o.click(); await new Promise(r=>setTimeout(r,90));
          const bi=document.querySelector('#predCard .pdbonus input');
          if(bi){ bi.value='9'; bi.dispatchEvent(new Event('input',{bubbles:true})); }
        }
        R.cardFilled = preds.every(x=>!!S.predChoices[x.id]);
        lockPredictions(); await new Promise(r=>setTimeout(r,300));
        // jump to the end of the night the way the app does
        S.qi = NR-1;
        openPredReview();
        await new Promise(r=>setTimeout(r,400));
        R.screen = S.screen;
        R.landedOnFinal = (S.screen==='final');
        const body=document.body.innerText||'';
        R.noManualForm = !/feed didn.{0,3}t settle it/i.test(body);
        R.noOfficialInputs = document.querySelectorAll('#prCard select').length===0;
        R.saysWhy = /Practice run/i.test(
          (document.getElementById('finalCardNote')||{}).textContent||'');
      }catch(e){ R.err=e.message; }
      try{ S.mode='demo'; S.practice=false; S.predChoices={}; }catch(e){}
      return R;
    });
    check(`night.practice-reaches-a-real-ending.${vp.name}`,
      night.cardFilled===true && night.landedOnFinal===true,
      `a full practice night ended on "${night.screen}" (card filled=${night.cardFilled}) ${night.err||''}`,
      'REGRESSION: it ended on the manual box-score form — the screen deleted weeks ago — because practice fell through into the live settlement fallback');
    check(`night.practice-never-asks-for-a-box-score.${vp.name}`,
      night.noManualForm===true && night.noOfficialInputs===true,
      'the practice run asked the player to type in official results',
      'the player is never the data entry clerk; that was settled and then quietly undone by a code path nobody walked');
    check(`night.unscored-card-says-why.${vp.name}`, night.saysWhy===true,
      'the prediction card scored nothing and the screen said nothing about it',
      'a silent zero reads as a bug — if it cannot settle, say so in a sentence');

    /* ---- YOU CAN ALWAYS GET OUT ----------------------------------
       "I'm on my phone and there is no practice and it now goes straight
       to Q4 ended. So i cant test anything. Even with a refresh."

       Two independent decisions combined into a trap. (1) A save carrying
       tonight's nightId auto-resumes, and the per-night guard cannot tell
       a rehearsal from the real thing. (2) The home card hides Practice
       whenever a live save exists. So a phone holding a stale "Q4 ended"
       from an afternoon test had nowhere to go, seven hours before tip,
       and a refresh put it straight back.

       Both halves get a test, because either one alone is survivable and
       it was the pair that locked the door. */
    const trap=await p.evaluate(async()=>{
      const R={};
      try{
        const tip=Date.parse(GAME.tipISO);
        R.beforeTip = Date.now() < tip;   // the fixture must still be pre-tip
        /* HALF ONE — a save that claims a quarter is over, before the ball
           has gone up, is from a rehearsal. It must not be walked into. */
        const stale={mode:'live',place:'live',screen:'live',qi:NR-1,pts:110,
                     nid:GAME.nightId,name:'QA',predLocked:true};
        localStorage.setItem(LS_KEY(), JSON.stringify(stale));
        resumeData=null;
        checkResume();
        R.staleRefused = (resumeData===null);
        R.staleCleared = (localStorage.getItem(LS_KEY())===null);

        /* THE ONE THE FIRST FIX MISSED. Between quarters you sit in the
           LOBBY, so a stale mid-game save is far more likely to be parked
           there than on 'live' — and 'lobby' was whitelisted as a normal
           pre-tip position. Points and a scored round are the tell. */
        localStorage.setItem(LS_KEY(), JSON.stringify(
          Object.assign({},stale,{place:'lobby',screen:'lobby',qi:3,nextQ:3,pts:110})));
        resumeData=null;
        checkResume();
        R.lobbyRefused = (resumeData===null);
        R.lobbyCleared = (localStorage.getItem(LS_KEY())===null);

        /* …and the mirror case: sitting in the lobby before tip with a
           locked card and nothing scored is exactly right, and must live. */
        localStorage.setItem(LS_KEY(), JSON.stringify(
          Object.assign({},stale,{place:'lobby',screen:'lobby',qi:0,nextQ:0,pts:0})));
        resumeData=null;
        checkResume();
        R.waitingKept = (resumeData!==null);
        resumeData=null;

        /* …but a pre-tip save that is only "I was filling my card in" is
           real, and taking THAT away would be a worse bug than the one we
           are fixing. */
        localStorage.setItem(LS_KEY(), JSON.stringify(
          Object.assign({},stale,{place:'predict',screen:'predict',qi:0,pts:0})));
        resumeData=null;
        checkResume();
        R.realKept = (resumeData!==null);
        /* checkResume() schedules doResume() 60ms out, and doResume()
           REPLACES the global S with the save blob. Left armed, this fake
           save would detonate under whichever test happened to be running
           in 60ms time — which is exactly how it behaved the first time. */
        resumeData=null;
        localStorage.removeItem(LS_KEY());
        try{ document.getElementById('resumeBar').style.display='none'; }catch(e){}

        /* HALF TWO — with a live game genuinely in progress, the home card
           must still offer a way out. */
        go('landing');
        S.mode='live'; S.practice=false; S.place='live'; S.qi=2; S.pts=110;
        paintContinueCard();
        await new Promise(r=>setTimeout(r,60));
        const demo=document.getElementById('landingDemoBtn');
        const esc=document.getElementById('contEsc');
        const vis=el=>!!el && el.offsetParent!==null &&
                     getComputedStyle(el).display!=='none' &&
                     getComputedStyle(el).visibility!=='hidden';
        R.escapeOffered = vis(demo) || vis(esc);
        R.escapeText = ((demo&&demo.textContent)||'')+' | '+((esc&&esc.textContent)||'');
        R.escapeWired = !!((demo&&demo.onclick)||(esc&&esc.onclick));
        R.hasFreshStart = (typeof freshStart==='function');

        /* …and it comes back to normal wording once the game is not on. */
        S.mode='demo'; S.place=''; S.qi=0; S.pts=0;
        paintContinueCard();
        R.restored = /practice/i.test((document.getElementById('landingDemoBtn')||{}).textContent||'');
      }catch(e){ R.err=e.message; }
      try{ localStorage.removeItem(LS_KEY()); S.mode='demo'; S.practice=false; }catch(e){}
      return R;
    });
    check(`night.a-save-cannot-be-ahead-of-the-game.${vp.name}`,
      trap.beforeTip!==true || (trap.staleRefused===true && trap.staleCleared===true),
      `a save claiming the last quarter was already over was auto-resumed before tip-off (refused=${trap.staleRefused}, cleared=${trap.staleCleared}) ${trap.err||''}`,
      'REGRESSION: a rehearsal save stamped with tonight\'s nightId dropped the phone into "Q4 ended — answer now" hours before the ball went up, and a refresh did it again');
    check(`night.a-stale-lobby-save-is-caught-too.${vp.name}`,
      trap.beforeTip!==true || (trap.lobbyRefused===true && trap.lobbyCleared===true),
      `a lobby save holding 110 pts and three scored quarters auto-resumed before tip (refused=${trap.lobbyRefused}, cleared=${trap.lobbyCleared}) ${trap.err||''}`,
      'REGRESSION: the first version of this guard whitelisted "lobby" as a normal pre-tip position, but the lobby is also where you wait BETWEEN quarters — position alone cannot tell those apart, progress can');
    check(`night.waiting-for-tip-in-the-lobby-survives.${vp.name}`,
      trap.beforeTip!==true || trap.waitingKept===true,
      `a player who locked their card and is waiting in the lobby for tip had their save thrown away ${trap.err||''}`,
      'the progress test must cut stale mid-game saves without touching the player who is legitimately early');
    check(`night.a-real-pre-tip-save-still-resumes.${vp.name}`,
      trap.beforeTip!==true || trap.realKept===true,
      `a genuine pre-tip save (mid pick sheet) was thrown away too ${trap.err||''}`,
      'the guard must cut rehearsals, not the player who was halfway through their card when the phone locked');
    check(`night.practice-is-never-taken-away.${vp.name}`,
      trap.escapeOffered===true && trap.escapeWired===true && trap.hasFreshStart===true,
      `with a live game in progress the home card offered no way out (offered=${trap.escapeOffered}, wired=${trap.escapeWired}) — buttons read "${trap.escapeText}" ${trap.err||''}`,
      'an escape hatch that disappears exactly when the app is stuck is not an escape hatch');
    check(`night.home-card-goes-back-to-normal.${vp.name}`, trap.restored===true,
      'the home card kept its "leave this game" wording after the game was over',
      'the demoted state has to be temporary, or every future visitor is told to leave a game they were never in');

    /* ---- THE DECK MUST MOVE, NOT THE PLAYER -----------------------
       Two full rosters is a long list, so you tap a name from a screen and
       a half down — and the next question rendered ABOVE you, off-screen,
       while you sat looking at the middle of a list you had already
       answered. Every pick cost a scroll up to read the question and a
       scroll back down to answer it. Six times, before tip. */
    const deck=await p.evaluate(async()=>{
      const R={};
      try{
        S.mode='demo'; S.predChoices={}; go('predict');
        PD.i=0; buildPred(); window.scrollTo(0,0);
        await new Promise(r=>setTimeout(r,120));
        // land on a PLAYER question (long list), scroll to the bottom of it
        const L=predOrderList();
        let idx=L.findIndex(x=>x.id!=='winner'); if(idx<0) idx=1;
        PD.i=idx; buildPred(); await new Promise(r=>setTimeout(r,150));
        window.scrollTo(0, document.documentElement.scrollHeight);
        await new Promise(r=>setTimeout(r,150));
        R.scrolledAway = Math.round(window.scrollY);
        const before=PD.i;
        // tap the last option in the list — the deep-in-the-list case
        const opts=[...document.querySelectorAll('#predCard .pdopt:not(.isout)')];
        R.optionCount=opts.length;
        opts[opts.length-1].click();
        await new Promise(r=>setTimeout(r,700));   // past the auto-advance beat
        R.advanced = (PD.i!==before);
        R.hadBonus = !!L[before].bonus;
        /* PATH ONE — a player pick. Every one of these carries the +50
           bonus so it deliberately does NOT advance; you are not finished.
           The failure was that "does not advance" looked identical to
           "nothing happened", because the +50 field was below the fold.
           It has to come to them. */
        const row=document.querySelector('#predCard .pdbonus');
        R.hasBonusRow=!!row;
        if(row){ const rr=row.getBoundingClientRect();
          R.bonusOnScreen = (rr.top > 40 && rr.bottom < window.innerHeight - 20);
          R.bonusMarked = row.classList.contains('ask'); }

        /* PATH TWO — the question actually changes. Then it must arrive at
           the top of the screen, whatever the player had scrolled to. */
        window.scrollTo(0, document.documentElement.scrollHeight);
        await new Promise(r=>setTimeout(r,120));
        R.scrolledAgain = Math.round(window.scrollY);
        predGo(1);
        await new Promise(r=>setTimeout(r,200));
        /* WHAT THE PLAYER CAN SEE, NOT WHERE THE BOX IS. This measured the
           CARD's top and wanted it near the top of the screen. That was a
           fair proxy while predFocus was dead code — its scroll was being
           wiped by go()'s scrollTo(0,0) a line later, so nothing ever
           moved. With it working, a short phone deliberately scrolls the
           card's header (progress bar, dots) off the top so the last
           OPTION clears the fixed bar: card top -129px, question and every
           option perfectly in view. The old proxy called that a failure.
           Ask the two things a player actually needs instead. */
        const card=document.getElementById('predCard');
        R.cardTop = Math.round(card.getBoundingClientRect().top);
        const q=card.querySelector('.pdq');
        const qt=q?Math.round(q.getBoundingClientRect().top):null;
        R.questionTop=qt;
        const barR=document.getElementById('pdBar').getBoundingClientRect();
        R.optionsUnderBar=[...card.querySelectorAll('.pdopt')]
          .filter(o=>{const g=o.getBoundingClientRect(); return g.bottom>barR.top+1 && g.top<barR.bottom;}).length;
        /* THE QUESTION, at the top of the screen. Not "every option also
           clears the bar" — a six-option question on a 390px phone cannot
           fit entirely above it, and predFocus deliberately stops nudging
           rather than push the question itself off the top. Options being
           reachable at FIRST PAINT is a different guarantee and it has its
           own check: deck.the-bar-does-not-sit-on-the-card. */
        R.questionIsVisible = (qt!==null && qt > 0 && qt < 240);
      }catch(e){ R.err=e.message; }
      try{ S.predChoices={}; PD.i=0; }catch(e){}
      return R;
    });
    check(`deck.next-question-comes-to-you.${vp.name}`, deck.questionIsVisible===true,
      `after changing question from a scroll of ${deck.scrolledAgain}: question at ${deck.questionTop}px, ${deck.optionsUnderBar} option(s) behind the bar (card box at ${deck.cardTop}px)`,
      'REGRESSION: the deck advanced but never scrolled, so every one of six picks cost a scroll up to read and a scroll back down to answer');
    /* AND IT CAME BACK, SO THE CHECK CAME BACK. This was retired for
       exactly one build, while the exact-number field was cut from the
       sheet. The lesson it encodes is the durable part: a control that
       deliberately does NOT advance looks identical to nothing happening,
       so whatever you still owe the player has to come to them rather than
       wait below the fold. */
    check(`deck.bonus-field-comes-to-you.${vp.name}`,
      deck.hasBonusRow===true && deck.bonusOnScreen===true && deck.bonusMarked===true,
      `after picking a player the +50 field is off screen (row=${deck.hasBonusRow} visible=${deck.bonusOnScreen} marked=${deck.bonusMarked})`,
      'a bonus pick deliberately does not advance — which looked exactly like nothing happening, because the field you still owed was below the fold');

    /* ---- A PICK YOU ARE TOLD NOT TO MAKE, AND CAN STILL MAKE -------
       Reported from the pick sheet on game day: players ruled out by the
       league injury report were still tappable, and the OUT flag rendered
       as a sliced orange corner because it lived inside the element that
       carries text-overflow:ellipsis. So the app warned you not to spend a
       pick, let you spend it anyway, and mangled the warning on the way. */
    const outpick=await p.evaluate(async(_unusedFixtureName)=>{
      const R={};
      try{
        S.mode='demo'; go('predict');
        /* DERIVE THE NAME FROM THE BUILD, DO NOT HARDCODE IT.
           This used to take the ruled-out player from qa/fixtures.js CAST,
           which is Dallas/Toronto — GN7's matchup. The pick sheet renders
           the APP's roster, so once the configured night changed, the test
           looked for a player who was not on the card, found no option, and
           reported "a player on the injury report was still selectable".
           It had stopped testing the feature entirely and was reporting a
           product bug that did not exist. A test that hardcodes a fact the
           config owns is a second copy of that fact and goes stale exactly
           like the app does. */
        PD.i = predOrderList().length-1; buildPred();
        var firstOpt = document.querySelector('#predCard .pdopt[data-pd]');
        var OUT = firstOpt ? firstOpt.getAttribute('data-pd') : null;
        if(!OUT){ R.err='the pick deck rendered no player options at all'; return R; }
        R.usedName = OUT;
        INACTIVE = new Set([OUT]);
        buildPred();
        const btn=[...document.querySelectorAll('#predCard .pdopt')]
          .find(b=>b.getAttribute('data-pd')===OUT);
        if(!btn){ R.err='no option for the ruled-out player'; return R; }
        R.flagged = btn.classList.contains('isout');
        const chip = btn.querySelector('.pdout');
        R.hasChip = !!chip;
        R.chipOutsideTheClip = !!(chip && !chip.closest('.pdname'));
        const nameEl=btn.querySelector('.pdname');
        R.struckThrough = !!(nameEl && /line-through/.test(getComputedStyle(nameEl).textDecorationLine||''));
        // and the chip must be fully inside the button, not sliced by it
        if(chip){ const cb=chip.getBoundingClientRect(), bb=btn.getBoundingClientRect();
          R.chipNotClipped = (cb.right <= bb.right + 1 && cb.width > 8); }
        const before = S.predChoices[predOrderList()[PD.i].id];
        btn.click(); await new Promise(r=>setTimeout(r,80));
        R.refusedThePick = (S.predChoices[predOrderList()[PD.i].id] === before);
      }catch(e){ R.err=e.message; }
      try{ INACTIVE=new Set(); }catch(e){}
      return R;
    }, F.CAST.home.dd);
    check(`pick.ruled-out-cannot-be-picked.${vp.name}`, outpick.refusedThePick===true,
      `a player on the injury report was still selectable (${JSON.stringify(outpick)})`,
      'REGRESSION: the card said "don\'t spend a pick on them" and then accepted the pick — that is a trap, not a warning');
    check(`pick.ruled-out-is-marked.${vp.name}`,
      outpick.flagged===true && outpick.hasChip===true && outpick.struckThrough===true,
      `the ruled-out state is not visible (${JSON.stringify(outpick)})`,
      'an unavailable option that looks available is worse than no flag at all');
    check(`pick.out-flag-is-not-clipped.${vp.name}`,
      outpick.chipOutsideTheClip===true && outpick.chipNotClipped===true,
      'the OUT flag is inside the ellipsis container and gets sliced',
      'REGRESSION: the flag rendered as a stray orange corner next to a truncated name');

    /* ---- A QUESTION WITH A CLOCK ON IT MUST NOT BE SCROLLED TO -----
       Call It docked INTO the Gametime feed, so on the one tab people sit
       on during a game it was an ordinary card at whatever scroll offset
       it was born at — findable, not noticeable. Twenty seconds is not
       long enough to go looking. */
    const ci=await p.evaluate(async()=>{
      const R={};
      try{
        navGo('gametime');
        /* The scoreboard is the anchor this whole check is about, so make
           sure it has actually rendered before measuring against it. */
        try{ if(typeof renderGametime==='function') renderGametime(); }catch(e){}
        await new Promise(r=>setTimeout(r,600));
        /* Mount state must not be inherited from an earlier test. This
           check passed once only because something upstream had already
           created the card; on a cold page ciShow was a silent no-op. */
        try{ const old=document.getElementById('ciCard'); if(old) old.remove(); }catch(e){}
        R.coldStart = !document.getElementById('ciCard');
        ciShow('<div class="cihead">Call It</div><div class="cibody">x</div>', true);
        R.mountedOnDemand = !!document.getElementById('ciCard');
        const c=document.getElementById('ciCard');
        const st=getComputedStyle(c);
        R.pos    = st.position;
        R.live   = c.classList.contains('cilive');

        /* Top, under the clock — and NOT anchored top-and-bottom at once,
           which stretched it down the whole phone. */
        /* ON GAMETIME it must hang off the pinned score, not float over the
           page: inside #ciSlot, inside a sticky block, below the board. */
        R.inSlot   = !!c.closest('#ciSlot');
        R.notStretched = (c.getBoundingClientRect().height < window.innerHeight * 0.6);
        const sticky=document.getElementById('gtSticky');
        R.anchorIsPinned = !!sticky && getComputedStyle(sticky).position==='sticky';
        /* Pre-game the anchor is the countdown card, live it is the
           scoreboard — either way it is the first card in #gtHead. */
        const gb=document.querySelector('#gtHead .card');
        R.hasBoard = !!gb;
        R.belowTheScore = !!(gb && c.getBoundingClientRect().top >= gb.getBoundingClientRect().bottom - 2);
        /* DECLARING position:sticky IS NOT STICKING. An ancestor with
           overflow:hidden becomes the scroll container and silently kills
           it — the rule applies, getComputedStyle says "sticky", and the
           element scrolls away anyway. Only scrolling proves it. */
        window.scrollTo(0, 900);
        await new Promise(r=>setTimeout(r,180));
        const gb2=document.querySelector('#gtHead .card');
        R.scrolled = Math.round(window.scrollY);
        R.scoreSurvivesScroll = !!(gb2 && gb2.getBoundingClientRect().top > -4
                                       && gb2.getBoundingClientRect().top < 120);
        R.questionFollowsTheScore = !!(gb2 && c.getBoundingClientRect().top >= gb2.getBoundingClientRect().bottom - 2
                                            && c.getBoundingClientRect().top < 400);
        window.scrollTo(0,0); await new Promise(r=>setTimeout(r,80));
        /* ANSWERING IS THE MOMENT IT BROKE. A non-live docked card fell
           through to the FLOATING card's keyframes, which carry
           translateX(-50%) — so the card threw itself half its width off
           to the left and snapped back. Assert the docked card never
           animates a horizontal transform. */
        ciShow('<div class="cihead">Call It</div><div class="cibody">done</div>', false);
        const c2=document.getElementById('ciCard');
        R.calmsDown = !c2.classList.contains('cilive');
        const anim=getComputedStyle(c2).animationName||'';
        R.noSidewaysAnim = anim.indexOf('ciUp')<0;
        R.stillCentred = Math.abs(c2.getBoundingClientRect().left
          - (c2.parentNode.getBoundingClientRect().left)) < 6;
        /* And there must be a control that closes it. */
        const x=c2.querySelector('[data-cix]');
        R.hasClose = !!x;
        if(x){ const b=x.getBoundingClientRect(), cb=c2.getBoundingClientRect();
          R.closeIsTappable = (b.width>=30 && b.height>=30);
          /* And it must be ON the card. An inline position:static stopped
             the card being a containing block, so the ✕ anchored to the
             sticky wrapper and rendered over the scoreboard. */
          R.closeIsOnTheCard = (b.top>=cb.top-1 && b.bottom<=cb.bottom+1
                             && b.left>=cb.left-1 && b.right<=cb.right+1);
          x.click(); }
        await new Promise(r=>setTimeout(r,60));
        R.closeWorks = (document.getElementById('ciCard').style.display==='none');
        c.style.display='none';
      }catch(e){ R.err=e.message; }
      return R;
    });
    check(`callit.mounts-on-demand.${vp.name}`,
      ci.coldStart===true && ci.mountedOnDemand===true,
      `showing a question on a cold page did nothing (${JSON.stringify(ci)})`,
      'ciShow returned early when the card had never been built — a question that silently fails to appear is the worst bug this app has');
    check(`callit.is-pinned-not-buried.${vp.name}`,
      ci.inSlot===true && ci.anchorIsPinned===true && ci.belowTheScore===true
        && ci.notStretched===true && ci.hasBoard===true
        && ci.scoreSurvivesScroll===true && ci.questionFollowsTheScore===true,
      `the question is not anchored to the score (${JSON.stringify(ci)})`,
      'REGRESSION: three layouts failed because the card was positioned against the SCREEN. It hangs off the pinned scoreboard — and .phone{overflow:hidden} once killed that sticky silently');
    check(`callit.answering-does-not-fling-it.${vp.name}`,
      ci.noSidewaysAnim===true && ci.stillCentred===true,
      `the answered card animates sideways (anim ok=${ci.noSidewaysAnim} centred=${ci.stillCentred})`,
      'REGRESSION: it flew half its width off to the left and snapped back the instant you tapped an answer');
    check(`callit.can-be-closed.${vp.name}`,
      ci.hasClose===true && ci.closeIsTappable===true && ci.closeWorks===true && ci.closeIsOnTheCard===true,
      `no working close control (present=${ci.hasClose} tappable=${ci.closeIsTappable} onCard=${ci.closeIsOnTheCard} works=${ci.closeWorks})`,
      'the only dismissal was a link that muted Call It for the entire night — a different offer entirely');
    check(`callit.open-question-is-loud.${vp.name}`,
      ci.live===true && ci.calmsDown===true,
      'an open question does not announce itself, or a resolved one keeps shouting',
      'the ring is what makes it unmissable without a modal covering the game');

    /* ---- THE LAST SCREEN OF THE NIGHT MUST BE TRUE AND FEEL EARNED --
       From a full practice playthrough: the share card read "Rank #9 of
       1,204" — a hardcoded bot field, no such room ever existed — and a
       genuinely good night (7 of 16, scoring in all four quarters) was
       awarded a drawing pin. One of those makes every other number on a
       screenshotted card look invented; the other makes winning feel like
       nothing. */
    const endcard=await p.evaluate(async()=>{
      const R={};
      try{
        S.mode='demo'; S.pts=290; S.streak=1;
        // 7 of 16, at least one in every quarter — the reported night
        S.results=[[true,false,false,false],[false,true,true,false],
                   [false,true,true,false],[false,true,false,true]];
        S.liveAnswers=S.results.map(r=>r.map(()=>({choice:'x',bank:2})));
        /* Call the REAL renderer. The first version of this check called a
           function that does not exist, so the element kept its placeholder
           and the check passed with the bug present — a test that cannot
           fail is worse than no test, because it is believed. */
        R.hasRenderer = (typeof openShare==='function');
        document.getElementById('scRankLine').textContent='__unset__';
        try{ openShare(); }catch(e){ R.shareErr=e.message; }
        const line=(document.getElementById('scRankLine')||{}).textContent||'';
        R.rankLine=line;
        R.rendererRan = (line!=='__unset__');
        R.noInventedField = R.rendererRan && !/of\s*1,?204/.test(line) && !/Rank #\d+ of/.test(line);
        const got=earnedAwards(null);
        R.head=got.list[0]&&got.list[0].id;
        R.notAThumbtack = R.head!=='board';
        R.everyQuarterCounted = Array.isArray(got.ctx.roundHits) && got.ctx.roundHits.every(n=>n>=1);
        /* Assert the AWARD ITSELF fires, not merely that some other badge
           happened to outrank the thumbtack — the first version of this
           passed under sabotage because WIRE TO WIRE covered for it. */
        R.everyqFires = got.all.some(a=>a.id==='everyq');
        try{ renderAwards(null); }catch(e){}
        const chips=(document.getElementById('fAwardMore')||{}).innerText||'';
        R.noEchoedChip = !/SEASON OPENED\s*·\s*season opened/i.test(chips);
      }catch(e){ R.err=e.message; }
      return R;
    });
    check(`final.share-card-invents-no-room.${vp.name}`,
      endcard.hasRenderer===true && endcard.rendererRan===true && endcard.noInventedField===true,
      `the share card claims a field that does not exist: "${endcard.rankLine}"`,
      'REGRESSION: it printed "Rank #9 of 1,204" from a hardcoded bot count — one invented number makes every real one look invented too');
    check(`final.good-night-gets-a-real-award.${vp.name}`,
      endcard.notAThumbtack===true && endcard.everyQuarterCounted===true && endcard.everyqFires===true,
      `7 of 16 with a score in every quarter still awarded "${endcard.head}"`,
      'scoring in all four quarters is exactly the behaviour this product exists to create; it cannot be worth a drawing pin');
    check(`final.award-chip-does-not-echo.${vp.name}`, endcard.noEchoedChip===true,
      'an award chip printed its own name twice',
      '"SEASON OPENED · season opened" — the floor badge takes its name from its short text');

    /* ---- NOTHING MAY SIT OFF THE EDGE OF THE PHONE ----------------
       Found the morning of Game #6: on the pick sheet, the two-column
       roster grid pushed thirteen player names past the right edge of a
       393px iPhone — you could not read them and you could not tap the
       far half. `1fr` tracks default to min-width:auto, so the longest
       name sets the column and the card grows wider than the screen.
       The one-column fallback fired at 380px and the most common phone
       in the world is 393, so it sat there through five game nights.
       This is now checked on every screen, every build. */
    const edge=await p.evaluate((screens)=>{
      const bad=[]; let widest=0;
      screens.forEach(k=>{
        try{ go(k); }catch(e){ return; }
        /* Land on a PLAYER pick, not the winner pick. The full two-team
           roster is the only list that goes two-column, and it is the
           only one that ever overflowed — measuring the default step
           would have looked clean while the bug was live. */
        if(k==='predict'){ try{ PD.i=predOrderList().length-1; buildPred(); }catch(e){} }
        const de=document.documentElement;
        widest=Math.max(widest, de.scrollWidth);
        const sec=document.getElementById(map[k]); if(!sec) return;
        sec.querySelectorAll('button,a,input,select').forEach(el=>{
          const r=el.getBoundingClientRect();
          if(r.width<1||r.height<1) return;
          if(r.right>window.innerWidth+1||r.left<-1)
            bad.push(k+': '+((el.textContent||el.tagName).trim().slice(0,18))
                     +' @'+Math.round(r.right)+'/'+window.innerWidth);
        });
      });
      return {bad:[...new Set(bad)].slice(0,6), widest, vw:window.innerWidth};
    }, ['landing','name','predict','lobby','live','break','gametime','stats','board','me','final']);
    check(`layout.nothing-off-screen.${vp.name}`, edge.bad.length===0,
      `controls sit past the edge: ${edge.bad.join(' · ')}`,
      'REGRESSION: thirteen player names were physically off the right of an iPhone 15 on the pick sheet');
    check(`layout.no-sideways-scroll.${vp.name}`, edge.widest<=edge.vw+1,
      `the page is ${edge.widest-edge.vw}px wider than the screen`,
      'a sideways scroll on a phone makes every vertical swipe feel broken');

    /* ---- LISTENERS INSTEAD OF POLLERS -----------------------------
       The room polled: the Board every fifteen seconds and Trash Talk
       every four, per player, for three hours. That is roughly 3,400
       reads a night each, and the free tier is 50,000 — so somewhere
       around a dozen players the room starts refusing reads and the
       app degrades silently, which is the single worst failure mode
       this product has.
       Two things have to hold. The listener must actually REPLACE the
       poller, or we have paid for both. And a listener that cannot
       attach must leave us with exactly last night's behaviour, or a
       scale fix becomes an outage. */
    const listen=await p.evaluate(async()=>{
      const R={};
      window.SB=window.SB||{};
      const prev={en:SB.enabled, top:SB.top, wb:SB.watchBoard, wt:SB.watchTalk,
                  talk:SB.talk, inRoom:SB.inRoom, ver:SB.verified};
      SB.verified=function(){ return true; };
      S.mode='live'; S.practice=false; S.name='QA';

      // ---------- BOARD ----------
      let attaches=0, polls=0, detaches=0, push=null;
      SB.enabled=true;
      SB.top=function(){ polls++; return Promise.resolve([{name:'poll',pts:1,color:'#888'}]); };
      SB.watchBoard=function(cb){ attaches++; push=cb; return function(){ detaches++; }; };
      try{ bdUnsub=null; bdLive=false; }catch(e){}

      boardRefresh(); boardRefresh(); boardRefresh();     // idempotent attach
      R.attachOnce = (attaches===1);
      if(push) push([{name:'live',pts:42,color:'#0f0'}]); // a snapshot lands
      await new Promise(r=>setTimeout(r,30));
      // ...and the in-flight polls that were fired before it must not
      // overwrite it when they land a tick later.
      R.listenerFeedsBoard = (typeof lastStand!=='undefined' && lastStand
                              && lastStand[0] && lastStand[0].pts===42);
      const pollsBefore=polls;
      boardRefresh();
      R.pollerStopped = (polls===pollsBefore);            // listener owns it now

      if(push) push(null);                                // the listener errors
      boardRefresh();
      R.fallsBackOnError = (polls>pollsBefore);

      // a listener that refuses to attach at all == today's behaviour
      try{ bdUnsub=null; bdLive=false; }catch(e){}
      SB.watchBoard=function(){ return null; };
      const p2=polls; boardRefresh(); await new Promise(r=>setTimeout(r,30));
      R.degradesToPoller = (polls>p2);

      // ---------- TRASH TALK ----------
      let tAttach=0, tDetach=0, tPolls=0, tPush=null;
      SB.inRoom=function(){ return true; };
      SB.talk=function(){ tPolls++; return Promise.resolve([]); };
      SB.watchTalk=function(cb){ tAttach++; tPush=cb; return function(){ tDetach++; }; };
      try{ ttRoomStop(); ttLines=[]; ttLastAt=0; }catch(e){}

      ttRoomStart();
      await new Promise(r=>setTimeout(r,60));
      R.talkAttached = (tAttach===1);
      R.talkNoTimer  = (ttTimer===null);                  // the 4s poll never starts
      R.talkNoPoll   = (tPolls===0);

      if(tPush) tPush([{id:'a',name:'Anis',text:'listener line',at:1,color:'#fff',kind:'burn'}]);
      await new Promise(r=>setTimeout(r,30));
      R.talkLinesLand = ttLines.some(l=>l.text==='listener line');

      try{ ttRoomStop(); }catch(e){}
      R.talkDetached = (tDetach===1 && ttTimer===null);

      // a failing listener hands the room back to the poller
      try{ ttLines=[]; ttLastAt=0; }catch(e){}
      SB.watchTalk=function(cb){ setTimeout(()=>cb(null),0); return function(){}; };
      ttRoomStart();
      await new Promise(r=>setTimeout(r,80));
      R.talkFallsBack = (ttTimer!==null && tPolls>0);
      try{ ttRoomStop(); }catch(e){}

      SB.enabled=prev.en; SB.top=prev.top; SB.watchBoard=prev.wb; SB.watchTalk=prev.wt;
      SB.talk=prev.talk; SB.inRoom=prev.inRoom; SB.verified=prev.ver;
      try{ bdUnsub=null; bdLive=false; ttLive=false; ttLines=[]; }catch(e){}
      S.mode='demo';
      return R;
    });
    check(`live.board-attaches-one-listener.${vp.name}`, listen.attachOnce===true,
      'boardRefresh attaches a new listener every call',
      'one listener per refresh is a read leak that gets worse the longer somebody plays');
    check(`live.board-listener-feeds-the-board.${vp.name}`, listen.listenerFeedsBoard===true,
      'a snapshot did not reach the standings',
      'a listener that is attached but not wired is strictly worse than the poller it replaced');
    check(`live.board-poller-stands-down.${vp.name}`, listen.pollerStopped===true,
      'the 15s poll still runs while a listener is live',
      'paying for both is the one outcome that makes the migration pointless');
    check(`live.board-falls-back-on-error.${vp.name}`, listen.fallsBackOnError===true,
      'a listener error leaves the Board with no source at all',
      'an empty Board is the exact bug that cost us Game #5');
    check(`live.board-degrades-to-poller.${vp.name}`, listen.degradesToPoller===true,
      'a listener that will not attach leaves the Board dead',
      'the floor for any scale fix is last night\'s behaviour, never worse');
    check(`talk.room-uses-a-listener.${vp.name}`,
      listen.talkAttached===true && listen.talkNoTimer===true && listen.talkNoPoll===true,
      `room did not switch to the listener (attach=${listen.talkAttached} timer=${listen.talkNoTimer} polls=${listen.talkNoPoll})`,
      '4s polling per player is the ceiling that keeps this room at a dozen people');
    check(`talk.listener-lines-land.${vp.name}`, listen.talkLinesLand===true,
      'a line from the listener never reached the room',
      'both sources go through one merge for exactly this reason');
    check(`talk.closing-detaches.${vp.name}`, listen.talkDetached===true,
      'closing the room leaves the listener attached',
      'a listener nobody unsubscribes keeps billing after the night ends');
    check(`talk.poller-returns-if-listener-fails.${vp.name}`, listen.talkFallsBack===true,
      'a failed talk listener leaves the room with no updates',
      'silent degradation is worse than the poll it replaced');

    /* ---- TELEMETRY ------------------------------------------------
       Six game nights and not one number. The three things that could
       go wrong here are all worse than having no analytics at all: it
       could throw into a scoring path, it could burn the write budget
       the live room is already close to, or it could collect nothing. */
    const trkT=await p.evaluate(async()=>{
      const writes=[];
      window.SB=window.SB||{}; SB.enabled=true;
      SB.trkWrite=function(o){ writes.push(o); return Promise.resolve(true); };
      try{ localStorage.removeItem('stats_trk_v1'); }catch(e){}
      TRK.buf=[]; TRK.t0=Date.now(); TRK.sent=0;

      // it must survive garbage without throwing
      let threw=null;
      try{ trk(); trk(null); trk('x',null); trk('y',{a:undefined,b:{deep:1},c:NaN}); }
      catch(e){ threw=e.message; }

      // a real sequence
      trk('app_open',{build:'test'});
      trk('card_start');
      trk('round_answer',{q:1,n:1,left:14});
      await trkFlush(true);

      // the cap has to hold — a runaway loop cannot fill a document
      for(let i=0;i<900;i++) trk('spam');
      const capped=TRK.buf.length;

      // it must survive a reload
      const saved=JSON.parse(localStorage.getItem('stats_trk_v1')||'null');
      TRK.buf=[]; trkLoad();
      const restored=TRK.buf.length;

      // and a dead backend must be silent, not fatal
      SB.enabled=false;
      let deadThrew=null;
      try{ trk('after_death'); await trkFlush(true); }catch(e){ deadThrew=e.message; }
      SB.enabled=true;

      const rep=(typeof STATS_TRK==='function') ? STATS_TRK() : null;
      return {threw, writes:writes.length, capped, restored, deadThrew,
              savedNight:saved&&saved.night, hasFunnel:!!(rep&&rep.funnel),
              firstDoc:writes[0]?Object.keys(writes[0]).sort():[]};
    });
    check(`trk.never-throws.${vp.name}`, !trkT.threw && !trkT.deadThrew,
      `threw on bad input (${trkT.threw}) or with a dead backend (${trkT.deadThrew})`,
      'analytics that can throw into a scoring path is worse than no analytics');
    check(`trk.batches-writes.${vp.name}`, trkT.writes===1,
      `${trkT.writes} backend writes for 4 events — should be 1`,
      'one write per event would burn a free tier the live room is already close to');
    check(`trk.caps-the-buffer.${vp.name}`, trkT.capped<=400,
      `buffer grew to ${trkT.capped}`,
      'a runaway loop must not be able to fill a Firestore document');
    check(`trk.survives-a-reload.${vp.name}`, trkT.restored>0 && !!trkT.savedNight,
      `restored ${trkT.restored} events, night=${trkT.savedNight}`,
      'a player who reloads mid-night must not erase the record of their own night');
    check(`trk.is-readable.${vp.name}`, trkT.hasFunnel===true,
      'STATS_TRK() does not print a funnel',
      'data nobody can look at is the same as no data');

    /* ---- A MEMBER IS NOT A STRANGER --------------------------------
       "The signed-in Home is the signed-out Home." A member was still
       being sold the product they had already bought: the tagline, the
       free-to-enter pill, a three-step explanation of the game, and a
       "can't play tonight, join the list" card — under an account that
       is already on the list. */
    const home=await p.evaluate(()=>{
      const read=()=>{
        const sec=document.getElementById('s-landing');
        const vis=[...sec.querySelectorAll('.strangers')].filter(e=>e.offsetParent!==null).length;
        return {vis, total:sec.querySelectorAll('.strangers').length,
                txt:(sec.innerText||'')};
      };
      /* Drive the REAL function rather than hand-toggling the body class —
         renderPortal() is what hides #howBlock, and a test that only flips
         `member` was testing the stylesheet, not the app. */
      try{ __signOut(); }catch(e){}
      try{ renderPortal(); }catch(e){}
      go('landing');
      const out1=read();
      try{ __signIn(); }catch(e){}
      try{ renderPortal(); }catch(e){}
      document.body.classList.add('member');
      const out2=read();
      try{ __signOut(); }catch(e){}
      try{ renderPortal(); }catch(e){}
      document.body.classList.remove('member');
      try{ __signIn(); }catch(e){}
      try{ renderPortal(); }catch(e){}
      return {stranger:out1, member:out2};
    });
    /* The COUNT went down on purpose and the INTENT did not. The page used
       to explain the game three times — the numbered block above the door,
       a three-step card further down, and a "can't play tonight" card below
       that — so a stranger read the rules twice before reaching anything
       they could do, and the front page was a scroll. One explanation now,
       above the door, and this check asserts the SUBSTANCE is there rather
       than counting boxes. */
    check(`home.stranger-gets-the-pitch.${vp.name}`,
      home.stranger.total>=3 && home.stranger.vis===home.stranger.total
        && /predict/i.test(home.stranger.txt) && /board|wins the night/i.test(home.stranger.txt),
      `${home.stranger.vis}/${home.stranger.total} pitch blocks visible signed-out; pitch text present=${/predict/i.test(home.stranger.txt)}`,
      'a stranger has to understand the whole game before being asked for anything');
    check(`home.member-does-not.${vp.name}`, home.member.vis===0,
      `${home.member.vis} marketing blocks still shown to a signed-in member`,
      'REGRESSION: "the signed-in Home is the signed-out Home" — selling somebody what they already bought');
    check(`home.member-keeps-the-game.${vp.name}`,
      /game night/i.test(home.member.txt) && home.member.txt.length>200,
      'the member home lost the thing it is actually for',
      'stripping the pitch must leave tonight’s game, not an empty page');

    /* ---- THE HOME PAGE IS THE RIGHT WAY UP -------------------------
       "We need to clean the home page. It's bulky and you have to scroll
       down for more stuff you may not use."

       It was not only bulky, it was upside down: the one fact that makes
       anybody open this app — there is a game tonight, these two teams,
       this time — sat 950px down, under a 633px sign-in form and two
       separate explanations of the rules. Order is the argument. */
    const order=await p.evaluate(()=>{
      go('landing');
      const sec=document.getElementById('s-landing');
      const kids=[...sec.querySelectorAll('#tonightCard,#portalCard,#howBlock,#matchupCard')]
        .map(e=>e.id);
      const box=id=>{const e=document.getElementById(id); if(!e) return null;
        const r=e.getBoundingClientRect(); return {top:Math.round(r.top+window.scrollY), bot:Math.round(r.bottom+window.scrollY), h:Math.round(r.height)};};
      return {kids, tonight:box('tonightCard'), portal:box('portalCard'), vh:window.innerHeight};
    });
    check(`home.tonight-comes-before-the-door.${vp.name}`,
      order.kids.indexOf('tonightCard')>=0
        && order.kids.indexOf('tonightCard') < order.kids.indexOf('portalCard'),
      `landing order is ${order.kids.join(' → ')}`,
      'REGRESSION: what is on tonight was below the sign-in form. Nobody opens this app to look at a sign-in form');
    check(`home.the-pitch-comes-after-the-door.${vp.name}`,
      order.kids.indexOf('howBlock') > order.kids.indexOf('portalCard'),
      `landing order is ${order.kids.join(' → ')}`,
      'the three-step explanation is one thumb flick away; it does not get to push the game and the way in off the first screen');
    check(`home.the-game-is-on-the-first-screen.${vp.name}`,
      !!order.tonight && order.tonight.bot <= order.vh,
      `tonight card runs ${order.tonight&&order.tonight.top}–${order.tonight&&order.tonight.bot} on a ${order.vh}px screen`,
      'if you have to scroll to find out who is playing, the page has failed at its only job');

    /* ---- ONE SET OF DOORS ------------------------------------------ */
    const doors=await p.evaluate(()=>{
      const R={};
      const laVis=()=>{const e=document.getElementById('landingActions');
        return !!(e && e.offsetParent!==null);};
      /* Signed out, nothing in progress: the sign-in card IS the door.
         "Play Game Night" underneath it only opens the card you are
         looking at, and its practice button is the same button again. */
      try{ __signOut(); }catch(e){}
      S.mode='demo'; S.place=''; document.body.classList.remove('member');
      try{ renderPortal(); }catch(e){ R.err=e.message; }
      try{ paintContinueCard(); }catch(e){}
      R.signedOutIdle = laVis();
      /* …but a live game in progress must always show the way OUT, signed
         in or not: this row carries "leave this and run a practice game"
         and "this isn't my game — start over". */
      S.mode='live'; S.place='lobby'; S.qi=1;
      try{ renderPortal(); }catch(e){}
      try{ paintContinueCard(); }catch(e){}
      R.signedOutLive = laVis();
      S.mode='demo'; S.place='';
      try{ __signIn(); }catch(e){}
      return R;
    });
    check(`home.one-set-of-doors.${vp.name}`,
      doors.signedOutIdle===false,
      `the play/practice row was showing under the sign-in card (err=${doors.err||'none'})`,
      'a stranger was offered the same two doors twice inside one screen');
    check(`home.the-way-out-is-never-hidden.${vp.name}`,
      doors.signedOutLive===true,
      'a live game in progress and no escape hatch on the home page',
      'REGRESSION: hiding this row for signed-out visitors also hid "this isn\'t my game — start over" from anybody with a stale save. An escape hatch you remove when things go wrong is not an escape hatch');

    /* ---- THE SCREEN YOU SIT ON MUST NEVER BE EMPTY ----------------
       "On Gametime there's nothing in there we can test." Before tip the
       Feed has no plays, and stripping the old filler left the most
       important screen in the app as one empty-state card and a
       thousand pixels of nothing — for the exact hours when the host is
       trying to prove the thing works. */
    const warm=await p.evaluate(async()=>{
      S.mode='live'; S.name='QA'; S.predChoices={};
      await loadGameStats(true);
      navGo('gametime'); renderGametime();
      const txt=(document.getElementById('gtFeed').innerText||'');
      const cards=document.querySelectorAll('#gtFeed .fdc').length;
      const head=(document.getElementById('gtHead').innerText||'');
      return {cards, txt:txt.slice(0,400), head,
              tryBtn:!!document.getElementById('warmTry'),
              dupeCountdown:(txt.match(/until tip|tips off in/gi)||[]).length,
              rail:(document.getElementById('rail')||{}).style.display,
              back:(document.getElementById('backBtn')||{}).classList.contains('show')};
    });
    check(`warmup.not-empty.${vp.name}`, warm.cards>=3 && warm.tryBtn,
      `pre-game Gametime had ${warm.cards} cards, practice button=${warm.tryBtn}`,
      'REGRESSION: "on Gametime there is nothing in there we can test" — the tab was dead until tip-off');
    check(`warmup.counts-down.${vp.name}`, /until tip|any minute/i.test(warm.head),
      `hero shows "${warm.head.slice(0,60)}" instead of a countdown`,
      'two dashes and the words NOT STARTED is a placeholder, not a scoreboard');
    check(`warmup.says-it-once.${vp.name}`, warm.dupeCountdown===0,
      'the countdown is printed in the hero and again as a card',
      'the same sentence twice is how a screen starts to feel padded');

    /* ---- NO SECOND SCOREBOARD, NO BACK ARROW ON A TAB -------------- */
    check(`chrome.no-double-score.${vp.name}`, warm.rail==='none',
      'the rail is up on Gametime, directly above the score it duplicates',
      'two scoreboards stacked is not redundancy, it is a bug you can see');
    const chrome=await p.evaluate(()=>{
      const out={};
      ['home','gametime','stats','board','me'].forEach(t=>{
        try{ navGo(t); }catch(e){}
        out[t]=(document.getElementById('backBtn')||{}).classList.contains('show');
      });
      return out;
    });
    check(`chrome.no-back-on-tabs.${vp.name}`, Object.values(chrome).every(v=>v===false),
      `back arrow shown on: ${Object.entries(chrome).filter(([,v])=>v).map(([k])=>k).join(', ')}`,
      'a ← on a nav tab is a question with no answer — the nav is how you got there and how you leave');

    /* ---- SWIPE ----------------------------------------------------
       Cheap to add, easy to get wrong in the one way that matters: a
       stray horizontal thumb during a live question would navigate you
       off the round and cost you the points. */
    const swipe=await p.evaluate(()=>{
      // `target` is read-only on a real Event, so build plain objects and
      // hand them straight to the listeners the app registered.
      function fling(dx,dy){
        const tgt=document.getElementById('stBody')||document.body;
        const ev=t=>({type:t,target:tgt});
        document.dispatchEvent(new CustomEvent('__noop'));
        const start=Object.assign(ev('touchstart'),{touches:[{clientX:200,clientY:400}]});
        const end=Object.assign(ev('touchend'),{changedTouches:[{clientX:200+dx,clientY:400+dy}]});
        (window.__swipeStart||function(){})(start);
        (window.__swipeEnd||function(){})(end);
      }
      /* SWIPE MOVES BETWEEN TABS NOW. It used to page through the STATS
         tab's own segmented control first, swallowing three gestures
         before it would let you leave the tab. The segments are gone —
         STATS is one scroll that changes with the phase of the game — so
         the whole app is two swipes wide: stats · gametime · board. */
      S.mode='live';
      navGo('stats');
      /* ============ SAY WHAT BLOCKED IT ==============================
         On 22 Aug this reported `stats/stats/stats` for two gate runs and
         the swipe was provably fine — the same fling sequence, driven
         through the same exposed handlers on the same build, moved
         gametime/board/gametime in isolation. The difference is page
         STATE built up by the forty checks that run before this one, and
         a bare tab name cannot say which piece of it.

         start() refuses a gesture whose ancestors include a horizontal
         scroller, so record that walk. Cheap, and it turns "the swipe is
         broken" into "this element is 79px too wide". */
      const blocked=(function(){
        try{
          const out=[]; let t=document.getElementById('stBody')||document.body;
          while(t && t!==document.body){
            out.push((t.id||t.className||t.tagName)+':'+t.scrollWidth+'/'+t.clientWidth
                     +(t.scrollWidth>t.clientWidth+8?'<<':''));
            t=t.parentNode;
          }
          const wide=[];
          document.querySelectorAll('#stBody *').forEach(e=>{
            if(e.scrollWidth>e.clientWidth+8)
              wide.push((e.className||e.tagName)+':'+e.scrollWidth+'/'+e.clientWidth);
          });
          if(wide.length) out.push('WIDE[' + [...new Set(wide)].slice(0,4).join(' ') + ']');
          return out.join(' ');
        }catch(e){ return 'walk failed: '+e.message; }
      })();
      const gate={ unlocked:(()=>{try{return tabsUnlocked();}catch(e){return 'ERR';}})(),
                   lean:(()=>{try{return lean();}catch(e){return 'ERR';}})(),
                   afterNav:S.screen };
      fling(-120,4); const a=S.screen;             // stats  -> gametime
      fling(-120,4); const b=S.screen;             // gametime -> board
      fling(120,4);  const c=S.screen;             // board  -> gametime
      fling(-14,4);  const tiny=S.screen;          // too small to count
      navGo('stats'); fling(-120,300); const vert=S.screen;  // mostly vertical
      // and it must be dead under a live question
      go('live'); const before=S.screen; fling(-120,4); const during=S.screen;
      S.mode='demo';
      return {a,b,c,tiny,vert,locked:before===during,blocked,gate};
    });
    check(`swipe.moves-between-tabs.${vp.name}`,
      swipe.a==='gametime' && swipe.b==='board' && swipe.c==='gametime',
      `swipe sequence gave ${swipe.a}/${swipe.b}/${swipe.c}` +
      ` · after navGo('stats') the screen was ${swipe.gate&&swipe.gate.afterNav}` +
      `, tabsUnlocked=${swipe.gate&&swipe.gate.unlocked}, lean=${swipe.gate&&swipe.gate.lean}` +
      ` · ancestor walk: ${swipe.blocked}`,
      'a tab bar you have to aim at is a website; swipe is what makes it feel like an app');
    check(`swipe.ignores-scroll.${vp.name}`, swipe.tiny==='gametime' && swipe.vert==='stats',
      `fired on a small (${swipe.tiny}) or vertical (${swipe.vert}) gesture`,
      'a swipe that triggers while you are scrolling makes the whole app feel broken');
    check(`swipe.dead-during-a-question.${vp.name}`, swipe.locked===true,
      'a swipe navigated away from a live question',
      'losing a round to a stray thumb is worse than having no swipe at all');

    /* ---- THE SCORE MUST BE ON EVERY SCREEN ------------------------
       "The score does not automatically update at the current pace on
       Gametime and throughout the site." The rail is the answer: one
       strip, one source, visible wherever the nav is. If it can go
       missing on a tab, the note comes back. */
    const rail=await p.evaluate(()=>{
      const seen={};
      S.mode='live'; S.pts=42;
      // Gametime is deliberately excluded: it shows the score big at the
      // top already, so the rail there was a second scoreboard stacked on
      // the first. Every OTHER screen must carry it.
      ['home','stats','board','me'].forEach(t=>{
        try{ navGo(t); }catch(e){}
        const r=document.getElementById('rail');
        seen[t]= !!r && r.style.display!=='none' && /\d/.test(r.innerText||'');
      });
      // ...and it must get out of the way under a live question
      try{ go('live'); paintNav(); }catch(e){}
      const hidden=(document.getElementById('rail')||{}).style.display==='none';
      S.mode='demo'; try{ paintNav(); }catch(e){}
      const offInDemo=(document.getElementById('rail')||{}).style.display==='none';
      return {seen, hidden, offInDemo};
    });
    check(`rail.on-every-screen.${vp.name}`, Object.values(rail.seen).every(Boolean),
      `rail missing on: ${Object.entries(rail.seen).filter(([,v])=>!v).map(([k])=>k).join(', ')}`,
      'REGRESSION: the live score only existed on the two screens that drew it, so it looked frozen everywhere else');
    check(`rail.yields-to-a-question.${vp.name}`, rail.hidden===true && rail.offInDemo===true,
      `rail still up during a live question (${rail.hidden}) or in practice (${rail.offInDemo})`,
      'a strip pinned over a 20-second clock costs somebody the question');

    check(`runtime.no-errors.${vp.name}`, errs.length===0, `errors during the run: ${errs.slice(0,2).join(' | ')}`,
      'a thrown error mid-game can stop scoring without anyone noticing');
    }catch(__e){ bad(`browser.viewport.${vp.name}`, `this viewport crashed: ${__e.message}`, `a crashed section must never hide the checks after it`); }
    try{ await p.close(); }catch(__e2){}
  }

  // ---- Control Room handlers must survive being pressed
  group('BROWSER — Control Room handlers');
  {
    const p=await mkPage({width:1440,height:900});
    const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,90)));
    p.on('dialog',async d=>{ try{ await d.dismiss(); }catch(e){} });
    await p.goto('file://'+path.join(ROOT,ADMIN),{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(2500);
    check('cr.boot-no-errors', errs.length===0, `Control Room threw on load: ${errs.slice(0,2).join(' | ')}`,
      'the dashboard is the engine — a boot error there stops the whole room');
    const bad=await handlersCallable(p, ADMIN);
    check('cr.handlers-callable', bad.length===0, `handler(s) blow up when pressed: ${bad.join(', ')}`,
      'REGRESSION: window.resetNight was assigned a wrapper that called itself — defined, and dead on the first press');

    /* ---- A DRAFT FROM BEFORE SIGNATURES EXISTED --------------------
       Found on the morning of Game #6, on the host's actual laptop. The
       drift detector decides a round is untouched by comparing it to the
       signature recorded when it was seeded — and signatures only began
       in admin .26. Every draft older than that has an EMPTY sig map, so
       the first version of this classified all four rounds as edited,
       held the new questions back, and printed a banner telling the host
       they had edited rounds they had never opened. The rewritten set
       never arrived, which is the exact failure the mechanism existed to
       prevent, reintroduced by the fix for it.
       An unrecorded round is not evidence of an edit. */
    const legacy=await p.evaluate(()=>{
      const R={};
      try{
        const nd=nightDraft(night);              // created lazily on first read
        // exactly the shape on the real laptop: sig map present, empty
        nd.sig={};
        nd.undo=null;
        nd.rounds.forEach(function(r,i){
          r.qs=[{t:'Old question '+(i+1)+'?',o:['A','B'],k:null}];
          nd.fed[i]=1;
        });
        const d1=bankDrift(night);
        R.notBlamedOnTheHost = (d1.edited.length===0 && d1.legacy.length>0);
        R.legacyCount = d1.legacy.length;

        const n=applyBankDrift(night,false);      // the automatic pass
        R.autoUpdated = n;
        R.nowCurrent  = (bankDrift(night).legacy.length===0 && bankDrift(night).edited.length===0);
        R.matchesBank = (qsig(nd.rounds[0].qs)===qsig(bankRound(night,0)));
        R.keptUndo    = !!(nd.undo && Object.keys(nd.undo).length===n);

        const back=undoBankDrift(night);
        R.undoRestores = (back===n && /Old question 1/.test(nd.rounds[0].qs[0].t));

        /* And a round we can PROVE was edited still waits to be asked. */
        applyBankDrift(night,false);
        nd.sig[0]=qsig(nd.rounds[0].qs);            // seeded, then...
        nd.rounds[0].qs=[{t:'My own question?',o:['A','B'],k:null}];   // ...typed over
        const d2=bankDrift(night);
        R.realEditsStillProtected = (d2.edited.indexOf(0)>=0);
        applyBankDrift(night,false);
        R.realEditsUntouched = /My own question/.test(nd.rounds[0].qs[0].t);
      }catch(e){ R.err=e.message; }
      return R;
    });
    check('cr.legacy-draft-is-not-an-edit',
      legacy.notBlamedOnTheHost===true && legacy.legacyCount>0,
      `a draft with no recorded signature was reported as host-edited (${JSON.stringify(legacy)})`,
      'REGRESSION: on Game #6 morning this held back all four rounds and blamed the host for edits they never made');
    check('cr.legacy-draft-self-updates',
      legacy.autoUpdated>0 && legacy.nowCurrent===true && legacy.matchesBank===true,
      `a pre-signature draft did not pick up the shipped set (${JSON.stringify(legacy)})`,
      'the whole point is that a rewritten question set reaches the laptop that runs the night');
    check('cr.auto-update-is-undoable',
      legacy.keptUndo===true && legacy.undoRestores===true,
      'rounds were replaced with no way to put them back',
      'assuming an unsigned round is unedited is only safe because being wrong costs one press');
    check('cr.proven-edits-still-protected',
      legacy.realEditsStillProtected===true && legacy.realEditsUntouched===true,
      'a round the host actually typed over was overwritten automatically',
      'silently replacing work typed in a two-minute timeout is the thing we are protecting against');
    await p.close();
  }

  // ---- feed states
  /* ---- THE END OF THE GAME ---------------------------------------
     Three notes from Game #5 all landed on the last two screens: a form
     asking you to retype a box score the app already has, a result card
     nine cards deep whose numbers disagreed, and no way back into the
     product once the buzzer went. */
  /* ---- THE FEED --------------------------------------------------
     Gametime is an endless scroll now, and the whole bet is that it wins
     the ninety seconds during a timeout that currently go to a social
     app. The three things that would make it lose that bet — inventing
     content, yanking the page while you read, and rebuilding the world
     when you tap a reaction — each get a check. */
  group('BROWSER — the feed');
  {
    const {p,errs}=await newPage({width:390,height:800},F.POST);
    await p.evaluate(async()=>{ S.mode='live'; S.name='QA'; await loadGameStats(true); navGo('gametime'); });
    await p.waitForTimeout(900);

    const built=await p.evaluate(()=>{
      const items=feedBuild();
      const texts=new Set((GS.plays||[]).map(x=>x.text));
      const plays=items.filter(i=>i.k==='play');
      return { n:items.length, plays:plays.length,
               cuts:items.filter(i=>i.k==='cut').length,
               invented:plays.filter(i=>!texts.has(i.text)).map(i=>i.text).slice(0,2),
               newestFirst: plays.length>1 && plays[0].seq>plays[plays.length-1].seq,
               rendered:document.querySelectorAll('#gtFeed .fdc').length };
    });
    check('feed.builds-from-plays', built.plays>=40 && built.rendered>0,
      `${built.plays} play cards built, ${built.rendered} rendered`,
      'the feed is the answer to "why would I stay in this app during a timeout" — an empty one answers nothing');
    check('feed.nothing-invented', built.invented.length===0,
      `text not present in the league feed: ${built.invented.join(' | ')}`,
      'every card must be sourced from the feed — invented filler is the one thing that would kill the claim');
    check('feed.newest-first', built.newestFirst===true, 'the feed is running oldest-first',
      'a feed that reads backwards is not a feed');
    check('feed.interleaves-cuts', built.cuts>=2,
      `only ${built.cuts} deep cuts mixed in`,
      'plays alone are a ticker; the cuts are what make it ours');
    check('feed.caps-the-render', built.rendered<=120,
      `${built.rendered} nodes rendered at once`,
      'a four-hundred-play game must not paint four hundred DOM nodes on a phone');

    /* Reacting must not rebuild the feed — a list that jumps to the top
       when you tap a heart is a list nobody taps twice. */
    const react=await p.evaluate(()=>{
      const first=document.querySelector('#gtFeed .fdc');
      const id=first.getAttribute('data-fd');
      const before=document.querySelectorAll('#gtFeed .fdc').length;
      first.querySelector('.fdr').click();
      const after=document.querySelectorAll('#gtFeed .fdc').length;
      const stillFirst=(document.querySelector('#gtFeed .fdc')||{}).getAttribute
        ? document.querySelector('#gtFeed .fdc').getAttribute('data-fd') : '';
      return {same:before===after, stillFirst:stillFirst===id,
              counted:/\d/.test(first.querySelector('.fdr').innerText)};
    });
    check('feed.react-is-local', react.same && react.stillFirst && react.counted,
      `reaction rebuilt or lost the row: ${JSON.stringify(react)}`,
      'tapping a reaction must repaint one row, never the feed');

    /* New items arriving must not move the page under a reader. */
    const yank=await p.evaluate((C)=>{
      feedRender(true);
      const before=(document.querySelector('#gtFeed .fdc')||{}).getAttribute('data-fd');
      // pretend we are scrolled down, and that a new play landed
      document.getElementById('gtFeed').getBoundingClientRect=function(){ return {top:-800}; };
      GS.plays.push({id:'zz',seq:9999,text:C.top+' makes 30-foot three point jumper',
        scoring:true,value:3,ab:C.ab,tid:C.id,away:88,home:98,period:4,clock:'0:02'});
      feedRender();
      const after=(document.querySelector('#gtFeed .fdc')||{}).getAttribute('data-fd');
      const pill=document.getElementById('feedNew');
      const shown=pill && pill.style.display!=='none';
      feedShowNew();
      const now=(document.querySelector('#gtFeed .fdc')||{}).getAttribute('data-fd');
      return {held:before===after, pill:!!shown, releases:now==='pzz'};
    }, {top:F.CAST.home.top, ab:F.CAST.home.ab, id:F.CAST.home.id});
    check('feed.does-not-yank', yank.held && yank.pill && yank.releases,
      `new-item handling wrong: ${JSON.stringify(yank)}`,
      'a feed that jerks to the top mid-sentence is the fastest way to send somebody back to Instagram');
    /* ---- TAKEOVERS EARN THEIR INTERRUPTION -------------------------
       A full-bleed card is the most aggressive thing this app can do to
       somebody watching a game. The entire value is rarity, so the tests
       are almost all about restraint — and the one that matters most is
       that it can never land on top of a scoring question. */
    const take=await p.evaluate(async()=>{
      await loadGameStats(true);
      TAKE.last=0; TAKE.seen={}; TAKE.showing=false;
      S.mode='live';
      const cands=takeoverCandidates().map(c=>c.key);

      go('gametime'); takeoverTick();
      const fired=(document.getElementById('takeover')||{}).classList
        ? document.getElementById('takeover').classList.contains('on') : false;

      // straight away again: the gap must hold it back
      const before=TAKE.last;
      TAKE.showing=false; takeoverTick();
      const gapHeld=TAKE.last===before;

      // and the same moment must never fire twice
      TAKE.last=0; TAKE.showing=false; takeoverTick();
      const noRepeat=TAKE.last===0;

      // never over a live scoring question
      TAKE.last=0; TAKE.seen={}; TAKE.showing=false;
      go('live'); takeoverTick();
      const duringQ=TAKE.last!==0;

      // and never in practice
      go('gametime'); TAKE.last=0; TAKE.seen={}; S.mode='demo'; takeoverTick();
      const inDemo=TAKE.last!==0;

      hideTakeover(); S.mode='demo';
      return {n:cands.length, fired, gapHeld, noRepeat, duringQ, inDemo};
    });
    check('takeover.fires-on-a-real-moment', take.n>=1 && take.fired===true,
      `${take.n} candidates, fired=${take.fired}`,
      'a run or a season high should stop the screen — otherwise the feed is a ticker');
    check('takeover.is-rare', take.gapHeld===true && take.noRepeat===true,
      `gap held=${take.gapHeld}, no-repeat=${take.noRepeat}`,
      'the whole value is rarity — a takeover that fires twice in a row is an interstitial ad');
    check('takeover.never-over-a-question', take.duringQ===false && take.inDemo===false,
      `fired during a question=${take.duringQ}, in practice=${take.inDemo}`,
      'a full-bleed card over a 20-second clock costs somebody the round — far worse than missing a moment');

    /* ---- SHARE IS THE ONLY MARKETING THIS PRODUCT HAS -------------- */
    const share=await p.evaluate(()=>{
      feedRender(true);
      const first=document.querySelector('#gtFeed .fdc');
      const id=first && first.getAttribute('data-fd');
      const txt=id ? shareCardText(id) : '';
      return {btns:document.querySelectorAll('#gtFeed .fdsh').length,
              hasAddr:/statsgametime\.com/.test(txt),
              hasNight:/Game Night/i.test(txt),
              noHtml:!/[<>]/.test(txt),
              len:txt.length};
    });
    check('share.on-every-card', share.btns>=3,
      `only ${share.btns} share controls in the feed`,
      'the result card was the only shareable thing, so only somebody who played a whole night could spread it');
    check('share.text-is-clean', share.hasAddr && share.hasNight && share.noHtml && share.len>40,
      `share text wrong: ${JSON.stringify(share)}`,
      'a share that pastes raw HTML into a group chat is worse than no share button');

    check('feed.no-errors', errs.length===0, `errors: ${errs.slice(0,2).join(' | ')}`,
      'the feed runs on every repaint all night — a throw here kills the tab');
    await p.close();
  }

  group('BROWSER — the final buzzer');
  {
    const {p,errs}=await newPage({width:390,height:800},F.POST);
    await p.evaluate(()=>{ S.mode='live'; S.name='QA'; });
    await p.waitForTimeout(1400);

    /* The sheet settles itself. Picking the real leaders must score; the
       tie on blocks must pay everybody who took either player. */
    const settled=await p.evaluate(async()=>{
      await loadGameStats(true);
      const st=settleFromFeed();
      if(!st) return {err:'settleFromFeed returned null with a post-game feed'};
      return {truth:st.truth, num:st.num, tiedBlk:(st.tied.blk||[]).slice().sort()};
    });
    check('final.settles-from-feed', !settled.err
        && settled.truth && settled.truth.winner===F.CAST.home.name
        && settled.truth.pts===F.CAST.home.top  && settled.num.pts===31
        && settled.truth.reb===F.CAST.home.dd   && settled.num.reb===16
        && settled.truth.ast===F.CAST.home.dime && settled.num.ast===11,
      `settlement wrong: ${JSON.stringify(settled)}`,
      'REGRESSION: the app made a human retype a box score it already had, and every typo silently changed a score');
    check('final.tie-pays-everyone',
      JSON.stringify(settled.tiedBlk||[])===JSON.stringify([F.CAST.home.dd,F.CAST.away.blk2].sort()),
      `blocks tie not detected: ${JSON.stringify(settled.tiedBlk)}`,
      'two players level on blocks means both picks were right — name-matching paid only one of them');

    const graded=await p.evaluate(async(PK)=>{
      S.predChoices=Object.assign({pts_num:31, reb_num:99}, PK);
      S.pts=0; S.predPts=0;
      await loadGameStats(true);
      applySettlement(settleFromFeed());
      return {screen:S.screen, predPts:S.predPts, auto:!!S.predAuto};
    }, PICKS());
    /* 6 lines all correct = 100 + 5x50 = 350, plus the one exact number
       = 400. Briefly 300, when the sheet was cut to three picks with no
       number entry — reversed, because the cut was argued for an audience
       that came to play along and this app is for people who came for the
       stats. To them the number is the bet, not a form field. */
    check('final.grades-the-card', graded.predPts===400 && graded.auto===true,
      `graded ${graded.predPts} (expected 400), auto=${graded.auto}`,
      'the settlement must pay base points for every right line and the bonus only for an exact number');
    check('final.skips-the-form', graded.screen==='final',
      `landed on "${graded.screen}" instead of the result`,
      'REGRESSION: "we still have the page to add your predictions at the end. Nobody wants to fill it in."');

    /* The result card must not be nine cards deep, and it must have a door. */
    const card=await p.evaluate(()=>{
      const sec=document.getElementById('s-final');
      const cards=[...sec.children].filter(el=>/\bcard\b|\baward\b|\bfpend\b/.test(el.className)&&el.offsetParent!==null).length;
      const txt=sec.innerText||'';
      return {cards, home:/back to home/i.test(txt), drawer:!!document.getElementById('fDrawer'),
              drawerOpen:(document.getElementById('fDrawer')||{}).open,
              navHidden:(document.getElementById('botnav')||{}).style.display==='none',
              slate:/🎬/.test(txt), emptyBadge:/·\s*·/.test(txt)};
    });
    check('final.not-bulky', card.cards<=5 && card.drawer===true && !card.drawerOpen,
      `${card.cards} cards visible on the final screen, drawer=${card.drawer}/${card.drawerOpen}`,
      'REGRESSION: "the score sheets at the end are too bulky" — nine cards at the moment of least attention');
    check('final.has-way-home', card.home===true && card.navHidden===false,
      `back-to-home=${card.home}, nav hidden=${card.navHidden}`,
      'REGRESSION: "there is no place to go back home. It just says do you want to play again."');
    check('final.no-broken-badge', card.slate===false && card.emptyBadge===false,
      'a badge rendered with the clapper emoji or an empty name',
      'REGRESSION: "a slate emoji for record, that doesn\'t make any sense" — it rendered as a black box on iOS');
    check('final.no-errors', errs.length===0, `errors: ${errs.slice(0,2).join(' | ')}`,
      'a throw on the last screen of the night loses the whole result');
    await p.close();
  }

  /* ===================================================================
     FAILURE IS VISIBLE

     A6, out of the Game Night #6 debrief. One sentence explains every
     serious bug this product has ever shipped: AN OPERATION FAILS AND
     NOBODY IS TOLD. A rejoin no-ops. The board comes back empty. Trash
     talk is dead. A submit returns false into silence. A status dot is
     green while the words beside it say the room is unreachable.

     A test suite that only checks the happy path cannot see any of that,
     which is why 293 checks passed on a build that lost a player's entire
     night. So this category does the opposite of every other one here: it
     FORCES the failure and then asserts that a human finds out.

     Every check below is sabotage-verified — the fix was reverted, the
     check was watched to fail, and the fix was put back.
     =================================================================== */
  group('BROWSER — failure is visible');
  {
    const src=read(PLAYER);

    /* ---- the call budget, split into lanes (B-44) ------------------
       MAX_CALLS = 4000, one counter for reads and writes. A tester who
       opened the app two hours early spent it on leaderboard polling and
       then every answer he gave returned false without attempting the
       write. He played all four quarters and scored nothing. */
    check('fail.budget.lanes-are-separate',
      /MAX_READS\s*=/.test(src) && /MAX_WRITES\s*=/.test(src) && /MAX_CHORES\s*=/.test(src)
        && /function budgetRead/.test(src) && /function budgetWrite/.test(src),
      'reads, writes and chores do not have separate allowances',
      'B-44: one shared counter meant a leaderboard poll could spend the allowance an answer needed');
    check('fail.budget.no-shared-counter',
      !/if\s*\(\s*calls\+\+\s*>\s*MAX_CALLS\s*\)/.test(src),
      'the single shared call counter is still here',
      'this exact line cost Danthefan every point of Game Night #6');
    check('fail.budget.answer-is-never-refused',
      /function budgetAnswer/.test(src) && !/if\s*\(\s*!budgetAnswer/.test(src)
        && !/\|\|\s*!budgetAnswer\(/.test(src),
      'an answer write can still be refused by the circuit breaker',
      'a breaker exists to stop a runaway poll; a human tapping an option once per question is not one');
    /* REWRITTEN, AND THE REASON IS THE POINT. The old version of this
       check looked for the literal string `!budget()` inside the first
       200 characters of SB.submit. `budget()` is not a function and never
       was — so the second half of the condition was `!false`, permanently
       true, and this check has been green since the day it was written
       while guarding nothing.

       It was caught by sabotage: putting the Game-Night-#6 line back —
       `if (!budgetWrite('submit')) return false;` — left it green. The
       check that guards the single most expensive bug in this product's
       history did not work.

       It now reads the WHOLE body of SB.submit and asserts that no budget
       lane is consulted in it at all. Answers count; they are never
       asked for permission. */
    const submitBody = (src.match(/SB\.submit\s*=\s*async function[\s\S]*?\n  \};/) || [''])[0];
    check('fail.budget.submit-is-not-gated',
      submitBody.length > 200
        && /budgetAnswer\('submit'\)/.test(submitBody)
        && !/budget(Read|Write|Chore)\s*\(/.test(submitBody),
      submitBody.length<=200
        ? 'could not find the body of SB.submit to check it'
        : `SB.submit consults: ${(submitBody.match(/budget\w+\s*\(/g)||[]).join(', ')}`,
      'the one write this whole product exists to make must never be silently skipped. Dan answered all four quarters of Game Night #6 and scored nothing, because a leaderboard poll had spent the shared counter two hours before tip');
    check('fail.budget.exhaustion-is-not-a-global-outage',
      !/function budgetRead[\s\S]{0,400}?setState\('error'/.test(src)
        && /notifyOps\('budget-read'/.test(src),
      'a spent lane still marks the entire backend broken, or says nothing',
      'one exhausted lane blacked out the room bar and produced "Live count unavailable" all night');

    /* ---- a failed read must never be read as "no seat" (B-50) ------- */
    check('fail.join.unknown-is-not-new',
      /readOk\s*=\s*false/.test(src) && /if\s*\(!readOk\)/.test(src)
        && !/try\s*\{\s*existing\s*=\s*await F\.getDoc\(meRef\);\s*\}\s*catch\s*\(e\)\s*\{\s*\}/.test(src),
      'SB.join still treats a thrown existence read as "there is no seat here"',
      'B-50: the else-branch writes pts:0, so a wifi blip overwrote fifty real points with zeros');

    /* ---- an answer that cannot be written is queued, not lost ------- */
    check('fail.outbox.exists',
      /function outQueue/.test(src) && /function outDrain/.test(src) && /OUT_KEY/.test(src),
      'there is no outbox — a failed answer write is still just a false',
      '"a write that cannot go queues, retries, and says so"');
    check('fail.outbox.survives-a-reload',
      /localStorage\.setItem\(OUT_KEY/.test(src) && /localStorage\.getItem\(OUT_KEY/.test(src),
      'the outbox lives in memory only',
      'a phone that reloads mid-round would drop the queue on the floor');
    check('fail.outbox.is-announced',
      /stats:outbox/.test(src) && /pendingWrites/.test(src),
      'nothing tells the app that answers are unsaved',
      'the queue is only worth having if the player can see it');

    /* ---- the light and the sentence come from one value (B-41) ------ */
    check('fail.roombar.state-is-derived',
      /function roomBarState/.test(src) && !/setRoomBar\('on'/.test(src) && !/setRoomBar\('err'/.test(src),
      'setRoomBar still takes a state argument the caller can get wrong',
      'B-41: a hardcoded \'on\' painted a green dot next to the words "Live count unavailable"');

    /* ---- one score, one source (A0/A1) ------------------------------ */
    /* Comments in this file quote the old broken lines on purpose, so the
       scan has to look at code only. */
    const code=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:])\/\/[^\n]*/g,'$1');
    check('fail.score.is-never-accumulated',
      !/S\.pts\s*\+=/.test(code) && !/S\.speed\s*\+=/.test(code),
      'the score is still accumulated somewhere',
      'six write paths into one running total; any one of them wrong corrupts the night permanently');
    /* 30 Aug. The second half of this used to be
       `/const livePts = livePtsOnly\(\)/.test(src)` — it required one
       LINE to exist rather than requiring the property to hold, so
       extracting the ending's paint into one function failed it while
       the invariant it names was untouched. A check pinned to an
       implementation detail votes against every legitimate change to
       that detail, and the next person's cheapest way to green is to
       put the line back rather than to keep the property.

       The property is: the quarter-questions figure handed to the
       breakdown is DERIVED at the moment of paint, never accumulated
       and never carried from earlier in the screen's life. B18 made
       `live` a lane out of recomputeScore()'s switch precisely so it
       could be asked for rather than remembered. */
    check('fail.score.final-does-not-double-add',
      !/S\.pts\s*\+=\s*\(S\.predPts/.test(src)
      && /renderBreakdown\(\s*livePtsOnly\(\)\s*\)/.test(code),
      'the final screen still adds the prediction card into the total, '
      + 'or the breakdown is fed a remembered live figure instead of a derived one',
      'a re-entered final screen paid the card out twice');
    /* ---- B18: the explanation must add up to the number -------------
       livePtsOnly() computed the quarter-questions figure by SUBTRACTING
       the other lanes — pts - predPts - catchPts — and never learned about
       the caught lane added later. So Caught It points sat inside the
       "Quarter questions" bar and on their own row at the same time, and
       the breakdown summed to five more than the total above it. The ring
       was right; the explanation under it was wrong, which is worse: a
       player who checks your maths and finds it broken stops believing the
       parts they cannot check.

       Guarded as the invariant, not the line. `live` is derived in the one
       switch that knows the lanes; nothing subtracts its way there. */
    check('fail.score.the-breakdown-adds-up-to-the-total',
      /function livePtsOnly\(\)\{ return recomputeScore\(\)\.live; \}/.test(code)
      && /else lv\+=v;/.test(code)
      && !/r\.pts\s*-\s*r\.predPts/.test(code),
      'the quarter-questions figure is being derived by subtracting lanes again',
      'B18. Subtracting a hand-written list of lanes breaks silently the day a lane is added — it did, and the final screen showed a breakdown that did not sum to its own headline');

    check('fail.score.has-a-ledger',
      /function ledgerSet/.test(src) && /function recomputeScore/.test(src) && /function ledgerMigrate/.test(src),
      'there is no ledger',
      'a score you cannot audit is a score you cannot defend to the player who lost it');

    /* ---- one clock (A0) --------------------------------------------- */
    check('fail.phase.is-derived-from-the-feed',
      /function phaseNow/.test(src) && /function phaseSync/.test(src) && /function finishNightFromFeed/.test(src),
      'there is no single phase and the night still cannot end itself',
      'after the buzzer the rail said Final, the button said Q4 and the card said LIVE — and predictions never settled');
    check('fail.settle.is-partial-tolerant',
      /missing\s*:\s*missing/.test(src) && !/if\(!okAll\) return null;/.test(src),
      'one unreadable category still voids the entire prediction card',
      '600 of the night\'s 1,000 points settled as zero for everybody');
    check('fail.clock.is-a-clock',
      /function fmtClock/.test(src) && /fmtClock\(p\.clock\)/.test(src),
      'the raw feed clock is still printed',
      '"30.5" is not a time; a decimal point in the middle of a scoreboard is a bug you can see');
  }

  group('BROWSER — failure is visible, in the browser');
  {
    const {p,errs}=await newPage({width:390,height:800},F.POST);
    await p.evaluate(()=>{ S.mode='live'; S.name='QA'; });
    await p.waitForTimeout(1200);

    /* Scoring the same round twice must cost the same as scoring it once. */
    const idem=await p.evaluate(()=>{
      ledgerClear();
      ledgerSet('r1', 40, 12, 'live');
      const once=S.pts;
      ledgerSet('r1', 40, 12, 'live');
      ledgerSet('r1', 40, 12, 'live');
      return {once, thrice:S.pts, speed:S.speed};
    });
    check('fail.ledger.is-idempotent', idem.once===40 && idem.thrice===40 && idem.speed===12,
      `scored once=${idem.once}, three times=${idem.thrice}`,
      'a host reveal that arrives twice, or a re-entered review screen, must not pay twice');

    /* The total is DERIVED. Writing to it directly is not a thing. */
    const derived=await p.evaluate(()=>{
      ledgerClear(); ledgerSet('r0', 20, 0, 'live');
      S.pts = 999;                       // the old way of scoring
      return {before:999, after:recomputeScore().pts};
    });
    check('fail.ledger.assignment-does-not-score', derived.after===20,
      `a direct assignment to S.pts survived recompute (${derived.after})`,
      'if a total can be assigned, six code paths will assign it and one of them will be wrong');

    /* A save carrying a higher total than the ledger raises the ledger.
       Never the other way round: an upgrade must not delete points. */
    const floor=await p.evaluate(()=>{
      ledgerClear(); ledgerSet('r0', 20, 0, 'live');
      S.pts = 90; S.speed = 30;          // e.g. a blob written by an older build
      ledgerMigrate();
      return {pts:S.pts, speed:S.speed, carried:!!(S.led && S.led.carried)};
    });
    check('fail.ledger.never-lowers-a-score', floor.pts===90 && floor.speed===30 && floor.carried===true,
      `reconcile produced ${JSON.stringify(floor)}`,
      'the ledger rollout must not be the thing that eats somebody\'s night');

    /* The dot and the sentence. */
    const dots=await p.evaluate(()=>{
      const out={};
      S.mode='live';
      setRoomBar('Live count unavailable — your game is unaffected.');
      out.bad=document.getElementById('roomDot').className;
      setRoomBar('<b>7</b> here now');
      out.good=document.getElementById('roomDot').className;
      setRoomBar('Connecting to tonight’s room…');
      out.wait=document.getElementById('roomDot').className;
      return out;
    });
    check('fail.roombar.no-green-light-over-bad-news',
      !/\bon\b/.test(dots.bad) && /\berr\b/.test(dots.bad),
      `the dot read "${dots.bad}" next to an unavailable message`,
      'B-41 exactly: a player was told the room was fine by a light sitting on top of the words saying it was not');
    check('fail.roombar.green-when-it-is-actually-good',
      /\bon\b/.test(dots.good) && !/\berr\b/.test(dots.wait) && !/\bon\b/.test(dots.wait),
      `good="${dots.good}" waiting="${dots.wait}"`,
      'the inverse matters too — a bar that is never green tells you nothing either');

    /* An unsaved answer outranks the crowd count. */
    const pend=await p.evaluate(async()=>{
      S.mode='live';
      const real=SB.pendingWrites;
      SB.pendingWrites=()=>2;
      try{ await refreshRoom(); }finally{ SB.pendingWrites=real; }
      return document.getElementById('roomTxt').textContent;
    });
    check('fail.outbox.tells-the-player', /saving 2 answers/i.test(pend||''),
      `the room bar said "${pend}" while two answers were unsaved`,
      'the player must never be shown a healthy room while their own round is sitting in a queue');

    /* One missing category is one unsettled line, not a voided card. */
    const partial=await p.evaluate(async(PK)=>{
      await loadGameStats(true);
      Object.keys(GS.box).forEach(nm=>{ delete GS.box[nm].BLK; });
      const st=settleFromFeed();
      if(!st) return {err:'settleFromFeed voided the whole card over one missing category'};
      S.predChoices=PK;
      ledgerClear();
      applySettlement(st);
      return {missing:st.missing, predPts:S.predPts};
    }, PICKS());
    check('fail.settle.one-missing-line-does-not-void-the-card',
      !partial.err && (partial.missing||[]).indexOf('blk')>=0 && partial.predPts>=300,
      `partial settlement produced ${JSON.stringify(partial)}`,
      'all-or-nothing settlement is how 600 points became zero for three players at once');

    /* THE BUZZER ENDS THE NIGHT. Nobody has to tap anything. */
    const auto=await p.evaluate(async(PK)=>{
      FINALISED=false; PHASE={v:'',at:0,src:''};
      S.mode='live'; S.name='QA'; S.qi=3; S.nextQ=3;
      S.predChoices=PK;
      ledgerClear();
      try{ renderLobby(3); go('lobby'); }catch(e){}
      const before=S.screen;
      await loadGameStats(true);          // feed says post -> phaseSync -> onPhase
      await new Promise(r=>setTimeout(r,600));
      return {before, after:S.screen, phase:PHASE.v};
    }, PICKS());
    check('fail.final.the-buzzer-ends-the-night',
      auto.before==='lobby' && auto.phase==='final' && (auto.after==='final'||auto.after==='predreview'),
      `phase=${auto.phase}, went from ${auto.before} to ${auto.after}`,
      'REGRESSION: "Even after the game when I go back home it shows continue Q4" — the night never ended, so the card never settled');

    check('fail.no-errors', errs.length===0, `errors: ${errs.slice(0,2).join(' | ')}`,
      'a throw inside the failure-handling paths is the worst possible place for one');
    await p.close();
  }

  /* ===================================================================
     THE ARENA

     "It still looks like the same ol platform, not updated to the arena."
     The Arena existed as a concept page for a day and was never built into
     the app. It is built now, and this is the category that stops it from
     quietly rotting back into the old look one hardcoded hex at a time.

     Two kinds of check here. The first kind guards the SYSTEM — one token
     set, one type ramp, no colour literals creeping back into a stylesheet.
     The second guards the SCREEN — every Arena block either renders real
     data or hides itself, and none of them ever renders a zero, a dash or
     a guess in place of something it does not know.
     =================================================================== */
  group('BROWSER — the Arena');
  {
    const src=read(PLAYER);

    check('arena.one-token-set',
      /--page:#05080e/.test(src) && /--glass:rgba/.test(src) && /--line:rgba\(255,255,255,\.09\)/.test(src),
      'the Arena token block is missing or has been edited away',
      'ninety-two scattered hex values is why the look never changed for six months');
    check('arena.hairlines-are-alpha',
      !/border(?:-top|-bottom|-left|-right)?:\s*1px solid #26304a/.test(src),
      'solid slate hairlines are back',
      'a solid line bands against every background it crosses; white at 9% never does');
    check('arena.energy-layer-exists',
      /id="energy"/.test(src) && /function setEnergy/.test(src) && /function syncEnergy/.test(src)
        && /#energy\.hit/.test(src),
      'the Live Energy layer is missing',
      'the room changing colour with the game is the single thing that makes this feel like a broadcast');
    check('arena.energy-resets-itself',
      /ENERGY_HOLD/.test(src) && /function flashEnergy/.test(src),
      'a hit/miss flash has no expiry back to the resting state',
      'an energy state that has to be manually turned off is one that will be left on');
    check('arena.component-language',
      /\.ablk\{/.test(src) && /\.alab\{/.test(src) && /\.atiles\{/.test(src) && /\.atab\{/.test(src)
        && /\.ascore\{/.test(src),
      'the Arena component classes are not defined',
      'the next screen someone adds has to look like the app without anybody deciding anything');
    check('arena.numbers-are-tabular',
      (src.match(/font-variant-numeric:\s*tabular-nums/g)||[]).length>=6,
      'scoreboard numbers are not tabular',
      'a score that shifts sideways as it counts up is a score you cannot read at a glance');
    /* The line is a benchmark. If this block ever grows a button it has
       stopped being STATS, and that is worth a permanent test. */
    check('arena.line-is-not-a-bet',
      /A benchmark, not a pick/.test(src)
        && !/function gtLine[\s\S]{0,1600}?<button/.test(src),
      'the line block contains an interactive control',
      'free entry, sponsor-funded prizes, and a line that is shown and never offered — that separation is the product');
  }

  group('BROWSER — the Arena, rendered');
  for(const [name,feed] of [['live',F.LIVE],['post',F.POST],['pre',F.PRE]]){
    const {p,errs}=await newPage({width:390,height:800},feed);
    await p.evaluate(()=>{ S.mode='live'; S.name='QA'; });
    await p.waitForTimeout(900);
    const gt=await p.evaluate(async()=>{
      await loadGameStats(true);
      navGo('gametime');
      await new Promise(r=>setTimeout(r,450));
      const head=document.getElementById('gtHead'), idle=document.getElementById('gtIdle');
      /* MEASURE THE SCREEN AS A PLAYER GETS IT — drawer closed — BEFORE
         opening it. Measuring after would report the depth of a screen
         nobody is looking at and would have quietly passed a 1,800px
         scroll as if it were the shipped one. */
      const dr=idle.querySelector('.adraw');
      const feedTopClosed=Math.round(document.getElementById('gtFeed').getBoundingClientRect().top+window.scrollY);
      const drawerClosed=!!dr && !dr.hasAttribute('open');
      if(dr) dr.setAttribute('open','');
      const txt=(head.innerText||'')+'\n'+(idle.innerText||'');
      return {
        board:!!head.querySelector('.ascore'),
        wp:!!head.querySelector('.abar'),
        spark:!!head.querySelector('svg path'),
        zones:/where the points come from/i.test(txt),
        yourNum:(function(){ const e=idle.querySelector('.abig'); return e?parseInt(e.textContent,10):null; })(),
        yourSize:(function(){ const e=idle.querySelector('.abig'); return e?parseFloat(getComputedStyle(e).fontSize):0; })(),
        teamSize:(function(){ const e=head.querySelector('.atm .n'); return e?parseFloat(getComputedStyle(e).fontSize):0; })(),
        drawerClosed:drawerClosed,
        feedTop:feedTopClosed,
        assists:/who found who/i.test(txt),
        pm:!!idle.querySelector('.atab'),
        building:/the building/i.test(txt),
        line:/the line vs the game/i.test(txt),
        benchmark:/benchmark, not a pick/i.test(txt),
        // nothing may render an empty or placeholder value
        emptyBig:[...idle.querySelectorAll('.abig,.atiles b')].some(e=>!/[0-9]/.test(e.textContent||'')),
        dashes:/(^|\s)(NaN|undefined|null)(\s|$)/.test(txt),
        wpN:(GS.wp||[]).length, phase:phaseNow()
      };
    });
    if(name==='pre'){
      /* BEFORE TIP THERE IS NO WIN PROBABILITY. A projection is not a live
         probability and showing one as the other is the sort of small
         dishonesty that costs a tester.

         THIS CHECK ASKS THE FUNCTION DIRECTLY. The first version only
         looked at the rendered screen, which passes for a reason that has
         nothing to do with the guard — a pre-game board takes the
         countdown branch and never calls gtWinProb at all. Deleting the
         phase guard entirely did not fail it. So the guard is now
         exercised on its own terms: real readings in memory, phase forced
         to pre, and the function must still return nothing.
         (B-49: sabotage proves a test CAN fail, not that it is pointed at
         the right case.) */
      const guard=await p.evaluate(()=>{
        const was=GS.state;
        GS.state='pre';
        const out=gtWinProb('AW','HM','#7fe3c7','#4a86ff');
        GS.state=was;
        return {len:(out||'').length, readings:(GS.wp||[]).length};
      });
      check('arena.pre.no-probability-before-tip',
        gt.wp===false && guard.len===0 && guard.readings>0,
        `screen bar=${gt.wp}, gtWinProb returned ${guard.len} chars with ${guard.readings} readings in memory`,
        'a number nobody can source must not appear on a screen people trust');
      check('arena.pre.countdown-not-dashes', /any minute|until tip/i.test(
        await p.evaluate(()=>document.getElementById('gtHead').innerText||'')),
        'the pre-tip board is not a countdown',
        'two dashes and the words "not started" is a placeholder, not a scoreboard');
    } else {
      check(`arena.${name}.board-renders`, gt.board===true,
        'the Arena scoreboard did not render',
        'this is the element that makes the screen read as a broadcast instead of a web page');
      check(`arena.${name}.win-probability`, gt.wp===true && gt.spark===true,
        `win probability bar=${gt.wp} sparkline=${gt.spark} (${gt.wpN} readings)`,
        'the most valuable unused thing in the feed — a number per play, turning the night into a shape');
      check(`arena.${name}.shot-zones`, gt.zones===true,
        'the shot-zone table did not render',
        'the 286px scatter plot it replaced answered no question a player has; three numbers per team do');
      /* THE HIERARCHY CHECK. On .75 the team scores rendered at 52px, the
         player\'s own points at 22px in the lobby and 12px in the rail, and
         on this screen their number did not appear at all. For a product
         called "the game that pays to pay attention" that is backwards,
         and it is the kind of thing that creeps back one layout at a time. */
      check(`arena.${name}.your-number-is-not-smaller`,
        gt.yourNum!=null && gt.yourSize>0 && gt.yourSize>=gt.teamSize,
        `your points render at ${gt.yourSize}px against a ${gt.teamSize}px team score (value=${gt.yourNum})`,
        'the player\'s own number may never be smaller than the broadcast\'s on the screen they live on');
      check(`arena.${name}.feed-is-reachable`, gt.feedTop>0 && gt.feedTop<1100 && gt.drawerClosed===true,
        `the feed starts ${gt.feedTop}px down (drawer closed by default: ${gt.drawerClosed})`,
        'nobody scrolls two full phone screens between quarters — it was 1,746px before the cut');
      check(`arena.${name}.assist-network`, gt.assists===true,
        'the assist network did not render',
        'parsed out of play text, no extra request, and the only stat that says how a team is playing');
      check(`arena.${name}.plus-minus`, gt.pm===true,
        'the +/− table did not render', 'already in the box score, never once shown');
      check(`arena.${name}.the-building`, gt.building===true,
        'the crowd/lead-change block did not render',
        'it is what makes the screen feel like a place rather than a dashboard');
      check(`arena.${name}.line-shown-as-benchmark`, gt.line===true && gt.benchmark===true,
        `line=${gt.line} benchmark disclaimer=${gt.benchmark}`,
        'the line may be a benchmark and may never be a pick — the disclaimer is part of the feature');
    }
    check(`arena.${name}.no-placeholder-values`, gt.emptyBig===false && gt.dashes===false,
      `a block rendered an empty or NaN value (emptyBig=${gt.emptyBig}, junk=${gt.dashes})`,
      'every block hides itself when its data is missing rather than rendering a zero, a dash or a guess');
    check(`arena.${name}.no-errors`, errs.length===0, `errors: ${errs.slice(0,2).join(' | ')}`,
      'a throw on the screen players sit on for two and a half hours');
    await p.close();
  }

  /* ===================================================================
     ONE PAGE

     "We are still having the problem of where the game is played at the
     end of the quarter and then the other parts of the game. Let's get
     everything on one page."

     The night used to bounce between four sections — lobby, live, review,
     lobby — and every transition was a place to lose state, paint a stale
     screen, or strand somebody. It is the root cause named in five
     separate backlog items. The question and the scoring now happen in
     place on Gametime.

     These checks exist so it cannot quietly come apart again: the section
     never changes under a question, the scoreboard is still on screen
     while you answer, and the nav does not vanish.
     =================================================================== */
  group('BROWSER — one page');
  {
    const {p,errs}=await newPage({width:375,height:667},F.LIVE);   // the SMALLEST phone
    await p.evaluate(()=>{ S.mode='live'; S.name='QA'; });
    await p.waitForTimeout(900);

    const flow=await p.evaluate(async()=>{
      await loadGameStats(true);
      const seen=[];
      const snap=(tag)=>{
        const sec=(document.querySelector('.screen.active')||{}).id;
        const q=document.getElementById('gtQuestion'), rv=document.getElementById('gtReview');
        seen.push({tag, sec, screen:S.screen,
          q:!!q && q.style.display!=='none', rv:!!rv && rv.style.display!=='none',
          board:!!document.querySelector('#gtHead .ascore'),
          nav:(document.getElementById('botnav')||{}).style.display!=='none'});
      };
      navGo('gametime'); snap('gametime');
      __hostRound(0);
      startQuarter(0);   snap('question');
      go('review');      snap('review');
      navGo('gametime'); snap('back');
      return seen;
    });
    const bySec = flow.every(f=>f.sec==='s-gametime');
    const q = flow.find(f=>f.tag==='question'), rv=flow.find(f=>f.tag==='review');
    check('onepage.never-leaves-the-page', bySec,
      `the section changed during the night: ${flow.map(f=>f.tag+'='+f.sec).join(' ')}`,
      'four sections meant four transitions, and every one of them was somewhere to lose a round');
    check('onepage.question-opens-in-place', !!q && q.q===true && q.rv===false && q.screen==='live',
      `question state wrong: ${JSON.stringify(q)}`,
      'the question is a slot on the page now, not a page — and S.screen must still say live so resume works');
    check('onepage.review-opens-in-place', !!rv && rv.rv===true && rv.q===false && rv.screen==='review',
      `review state wrong: ${JSON.stringify(rv)}`,
      'the other half of the bounce');
    check('onepage.scoreboard-stays-up', !!q && q.board===true,
      'the scoreboard was gone while a question was on screen',
      'the entire argument for moving the question here is that you keep looking at the score');
    check('onepage.nav-does-not-vanish', flow.every(f=>f.nav===true),
      `the nav disappeared on: ${flow.filter(f=>!f.nav).map(f=>f.tag).join(', ')}`,
      'hiding the nav made sense when the question was its own screen; here it hides the tab you are standing on');

    /* AND IT HAS TO FIT. A question and a scoreboard on one page is only an
       improvement if both are visible at once on the smallest phone we
       support — otherwise it is the old two-screen flow with extra
       scrolling. The board collapses while a question is open; this is the
       check that says it collapsed enough. */
    const fits=await p.evaluate(async()=>{
      __hostRound(0);
      startQuarter(0);
      await new Promise(r=>setTimeout(r,350));
      const board=document.querySelector('#gtHead .ascore').getBoundingClientRect();
      const opts=document.querySelector('#qOpts');
      const last=opts && opts.lastElementChild ? opts.lastElementChild.getBoundingClientRect() : null;
      return {boardTop:Math.round(board.top), lastOptBottom:last?Math.round(last.bottom):null,
              vh:window.innerHeight, qopen:document.body.classList.contains('qopen')};
    });
    check('onepage.board-and-question-fit-on-a-375',
      fits.qopen===true && fits.boardTop>=0 && fits.lastOptBottom!=null && fits.lastOptBottom<=fits.vh,
      `board top ${fits.boardTop}, last option bottom ${fits.lastOptBottom}, viewport ${fits.vh}, qopen=${fits.qopen}`,
      'if you have to scroll to see the score and the answers, nothing was gained by merging them');

    check('onepage.no-errors', errs.length===0, `errors: ${errs.slice(0,2).join(' | ')}`,
      'a throw during the merge shows up as a blank game');
    await p.close();
  }

  /* ===================================================================
     ONE PAGE, PART THREE — THE WAITING ROOM

     Asked three times: "I should play the game on one page", "I still want
     a seamless page which should be the Gametime tab where people put in
     the question for the quarters and caught it."

     The question moved first, then the button that opens it, and the last
     third was the lobby: the room bar, the alert opt-in, tonight's top
     five and the watchlist. An earlier attempt moved the whole section
     wholesale and broke resume, the layout and the swipe handler on the
     morning of a game night — so these are pointed at exactly the ways
     this merge can rot.
     =================================================================== */
  group('BROWSER — the waiting room is folded in');
  {
    const src=read(PLAYER);
    check('lobby.is-the-gametime-page',
      /lobby:"s-gametime"/.test(src),
      'map.lobby still resolves to its own section',
      'the whole point: the night never leaves one page');
    check('lobby.the-old-section-is-unreachable-but-alive',
      /id="s-lobby"[^>]*aria-hidden/.test(src) && /id="legacyLobbyBits"/.test(src)
        && /id="lobbyBtn"/.test(src) && /id="lobbySub"/.test(src) && /id="sbCard"/.test(src),
      'the lobby ids were deleted rather than parked',
      'renderLobby() and paintScore() paint into these all night — deleting them makes every one of those calls a silent no-op, which is the exact class of bug this build exists to end');
    check('lobby.controls-moved-to-the-board',
      src.indexOf('id="gtLobby"') > 0 && src.indexOf('id="gtLobby"') < src.indexOf('id="gtFeed"')
        && /id="gtLobby"[\s\S]{0,3000}id="roomBar"/.test(src)
        && /id="gtLobby"[\s\S]{0,3000}id="alertRow"/.test(src)
        && /id="gtLobby"[\s\S]{0,3000}id="standCard"/.test(src),
      'the room bar, the alert opt-in or the standings are not inside #gtLobby on the Gametime page',
      'a merge that leaves the useful half behind is a deletion');

    const {p,errs}=await newPage({width:375,height:667},F.LIVE);
    await p.evaluate(()=>{ S.mode='live'; S.name='QA'; });
    await p.waitForTimeout(900);

    const r=await p.evaluate(async()=>{
      await loadGameStats(true);
      const vis=id=>{ const e=document.getElementById(id); if(!e) return null;
        return !!(e.offsetParent!==null || e.getClientRects().length); };
      const R={};
      /* Sitting between quarters. */
      S.qi=1; S.nextQ=1; S.place='lobby';
      renderLobby(1); go('lobby');
      R.sec = (document.querySelector('.screen.active')||{}).id;
      R.screen = S.screen;
      R.lobbyShown = vis('gtLobby');
      R.board = !!document.querySelector('#gtHead .ascore');
      R.startBtn = !!(document.getElementById('gtIdle')||{}).querySelector
        && !!document.querySelector('#gtIdle button');
      /* …and nothing from the waiting room may sit under a running clock. */
      __hostRound(1);
      startQuarter(1);
      await new Promise(r=>setTimeout(r,250));
      R.lobbyDuringQuestion = vis('gtLobby');
      R.qopen = document.body.classList.contains('qopen');
      return R;
    });
    check('lobby.between-quarters-you-are-on-the-board',
      r.sec==='s-gametime' && r.screen==='lobby' && r.board===true,
      `section=${r.sec} screen=${r.screen} board=${r.board}`,
      'S.screen must still say "lobby" — every save, guard and resume path reads it. Only the section it points at changed');
    check('lobby.its-controls-are-on-screen-between-quarters',
      r.lobbyShown===true,
      'the room bar, alert opt-in and standings did not appear while waiting for the next quarter',
      'that is the entire content of the screen that was removed');
    check('lobby.nothing-from-it-sits-under-a-running-clock',
      r.qopen===true && r.lobbyDuringQuestion===false,
      `qopen=${r.qopen} lobby visible during a question=${r.lobbyDuringQuestion}`,
      'the nav and the menu already hide for this reason — a notification opt-in next to a 20-second clock is a lost round');

    /* PRACTICE MUST STILL BE ABLE TO START A QUARTER. gtStartRow() used to
       bail on anything that was not a live night, because practice started
       from the lobby button. With the lobby folded in, that bail would
       strand every practice player on a page with no way to play — and
       practice is how almost everybody sees this app for the first time. */
    const demo=await p.evaluate(async()=>{
      S.mode='demo'; S.name='QA'; S.qi=0; S.nextQ=0; S.place='lobby';
      renderLobby(0); go('lobby');
      const btns=[...document.querySelectorAll('#gtIdle button')]
        .map(b=>(b.textContent||'').trim());
      return {btns, opened:(()=>{ try{ startQuarter(0); return S.screen; }catch(e){ return 'threw:'+e.message; } })()};
    });
    check('lobby.practice-can-still-open-a-quarter',
      demo.btns.length>0 && demo.opened==='live'
        && demo.btns.some(t=>/start/i.test(t)),
      `buttons on the practice board: ${JSON.stringify(demo.btns)}, startQuarter left us on ${demo.opened}`,
      'REGRESSION GUARD: the start button was live-mode only while the lobby existed to carry practice. It must also wear the PRACTICE label — the live one says "Q1 ended? Answer now", which is a lie in a simulated game');

    check('lobby.no-errors', errs.length===0, `errors: ${errs.slice(0,2).join(' | ')}`,
      'a throw here is a night with no way to answer a question');
    await p.close();
  }

  /* ===================================================================
     THE DOOR — the five nav tabs are behind it

     "I can still tap in the other layers of the game without signing in."

     startLive() already gated the handle screen and the pick sheet. The
     nav did not, so a stranger could walk into Gametime, Stats, the Board
     and the Me tab and follow the night without ever making an account —
     screens whose whole content is your number, your rank and your seat.

     Two exceptions, and they are not optional. Practice needs no account,
     ever. And a game in progress keeps the tabs whether the account is
     verified or not, or a stale save locks a phone inside a game with the
     ways out on the far side of a sign-in it cannot complete.
     =================================================================== */
  group('BROWSER — the door');
  {
    const {p,errs}=await newPage({width:393,height:852},F.PRE);
    const d=await p.evaluate(async()=>{
      const R={};
      const where=()=>({sec:(document.querySelector('.screen.active')||{}).id, scr:S.screen});
      /* --- signed out, nothing started: every tab bounces to the door --- */
      __signOut();
      S.mode='demo'; S.practice=false; S.place=''; go('landing');
      R.locked={};
      ['gametime','stats','board','me'].forEach(t=>{
        try{ navGo(t); }catch(e){}
        R.locked[t]=where().sec;
      });
      R.pendingTab = (typeof PENDING_TAB!=='undefined') ? PENDING_TAB : 'undeclared';
      /* --- practice opens the app again (B14 reversed, 18 Aug) --------- */
      S.mode='demo'; S.practice=true; S.place='lobby'; S.qi=0; S.nextQ=0;
      try{ navGo('gametime'); }catch(e){}
      R.practice = where().sec;
      try{ navGo('stats'); }catch(e){}
      R.practiceStats = where().sec;
      /* --- and tapping Practice starts one, no account asked ---------- */
      S.mode='demo'; S.practice=false; S.place=''; go('landing');
      try{ PENDING_AFTER=null; }catch(e){}
      try{ startDemo(); }catch(e){}
      R.practiceTap = where().sec;
      R.practicePending = (typeof PENDING_AFTER!=='undefined') ? PENDING_AFTER : 'undeclared';
      /* --- a live game in progress, unverified: still gets the tabs ---- */
      S.mode='live'; S.practice=false; S.place='review';
      try{ navGo('board'); }catch(e){}
      R.staleSave = where().sec;
      /* --- and a member, obviously -------------------------------------- */
      __signIn();
      S.mode='demo'; S.place='';
      try{ navGo('stats'); }catch(e){}
      R.member = where().sec;
      return R;
    });
    check('door.tabs-are-locked-signed-out',
      Object.keys(d.locked).every(k=>d.locked[k]==='s-landing'),
      `signed-out tab destinations: ${JSON.stringify(d.locked)}`,
      '"I can still tap in the other layers of the game without signing in." Gametime, Stats, the Board and the Me tab are about your seat in the room — a visitor with no seat was being shown the shape of a game they were not in');
    /* Was 'me'. The Me tab is retired — it rendered the member card that
       already sits on Home — so a tap on it is now refused outright and
       never becomes a pending destination. The door itself is unchanged;
       the test just has to knock on a door that still exists. */
    check('door.it-remembers-where-you-were-going',
      d.pendingTab==='board',
      `PENDING_TAB after a blocked tap was ${JSON.stringify(d.pendingTab)}`,
      'a door that forgets the destination makes the player navigate twice; signing in has to finish the trip');
    /* REVERSED TWICE, AND THE SECOND ONE IS THE INTERESTING ONE.

       13 Aug this check was flipped to assert that practice was LOCKED,
       on the founder's call "lock everything until sign-in". The argument
       was sound for the product that existed: there were no strangers
       arriving, so an open door bought three more surfaces that could be
       wrong and a half-state with no seat, no score and no room. That
       version said it was kept as a named check rather than deleted, so
       that whoever wanted the demo back would have to read why it went.

       18 Aug, they read it. The numbers underneath the decision had moved:
       thirteen people have ever taken a seat, six have ever left an email,
       and the plan is now to run every game of the slate — which is a bet
       ENTIRELY on strangers arriving. "There are no strangers arriving"
       had quietly stopped being a reason for the lock and started being a
       result of it.

       So the door is open again for practice, and the check asserts that
       again. What does NOT move, and what the next reversal has to leave
       alone: a live night still needs an account, because a seat and a
       score need an identity the rules will accept. That is the check
       directly above this one, and it has never flipped. */
    check('door.practice-opens-the-app',
      d.practice==='s-gametime' && d.practiceStats==='s-stats',
      `practice reached ${d.practice} / ${d.practiceStats}`,
      'B14 reversed. Somebody who has never heard of us has to be able to see the thing work before deciding — that is the whole bet behind running every game of the slate');
    check('door.tapping-practice-starts-a-game',
      d.practiceTap==='s-name',
      `Practice tap landed on ${d.practiceTap}`,
      'B14 reversed. Tapping Practice starts a practice; it does not ask for an account first');
    check('door.a-game-in-progress-is-never-locked-out',
      d.staleSave==='s-board',
      `a live save with no verified account reached ${d.staleSave}`,
      'the failure mode is a phone locked inside a game that is not happening, with every way out behind a sign-in it cannot complete — same rule as landingActionsWanted()');
    check('door.a-member-walks-through',
      d.member==='s-stats',
      `a signed-in member reached ${d.member}`,
      'the lock is for strangers, not for the people who did what we asked');
    check('door.no-errors', errs.length===0, `errors: ${errs.slice(0,2).join(' | ')}`,
      'a throw in the nav gate is an app with no navigation');
    await p.close();
  }

  /* ===================================================================
     THE PICK SHEET, ON FIRST PAINT

     Found on a real phone, opening a practice game: the sheet said
     "1 / 6" over a bar already a sixth full, six inches above a footer
     saying "0 / 6 locked"; a sticky button said "Still need winning team"
     about the card filling the screen; that same sticky bar covered the
     bottom of the card, so the SECOND option of the very first question
     was behind it; and the hamburger sat on top of "Up to 600 pts".

     Four separate bugs, all of them only visible in the first two seconds,
     which is exactly the window a new player decides in.
     =================================================================== */
  group('BROWSER — the pick sheet opens clean');
  {
    const {p,errs}=await newPage({width:393,height:852},F.PRE);
    const first=await p.evaluate(async()=>{
      startDemo(); S.name='QA';
      try{ await loadGameStats(true); }catch(e){}
      startPredict();
      await new Promise(r=>setTimeout(r,500));
      const R={};
      const card=document.getElementById('predCard').getBoundingClientRect();
      const bar=document.getElementById('pdBar').getBoundingClientRect();
      R.pdn=((document.querySelector('.pdn')||{}).textContent||'').trim();
      R.fillPct=(function(){ const i=document.querySelector('.pdbar i');
        return i ? Math.round(parseFloat(i.style.width)||0) : -1; })();
      R.filledDots=[...document.querySelectorAll('.pddot')].filter(d=>d.className.includes('fill')).length;
      /* THE COUNTER MOVED, THE RULE DID NOT. `.pdsummary` was its own row
         in the pinned bar until 22 Aug, when the bar grew a navigation row
         and went 70px -> 112px — which on a 375px phone put it over the
         answers themselves. The count folded into the nav line, where "3
         of 6" already said half of it, and the third row went away.

         Read wherever it lives; keep asserting that it agrees with the
         header. Pinning the selector to `.pdsummary` would have made this
         check die of a layout change rather than of a real disagreement,
         which is the failure mode it exists to catch. */
      R.summary=((document.querySelector('.pdsummary') || document.querySelector('#pdBar .pdsofar') || {})
                  .textContent||'').replace(/\s+/g,' ').trim();
      R.lock=(document.getElementById('pdLock')||{}).textContent||null;
      R.barOverlapsCard = bar.top < card.bottom - 1;
      /* every option of the FIRST question has to be reachable without the
         bar sitting on it */
      R.hiddenOpts=[...document.querySelectorAll('#predCard .pdopt')]
        .filter(o=>{ const r=o.getBoundingClientRect(); return r.bottom > bar.top + 1 && r.top < bar.bottom; }).length;
      /* the hamburger must not be printing over the worth */
      const w=document.getElementById('predWorth'), mb=document.getElementById('menuBtn');
      R.menuShown = !!(mb && mb.classList.contains('show'));
      if(w&&mb&&R.menuShown){ const a=w.getBoundingClientRect(), b2=mb.getBoundingClientRect();
        R.menuOverlapsWorth = !(a.right<b2.left||a.left>b2.right||a.bottom<b2.top||a.top>b2.bottom); }
      else R.menuOverlapsWorth=false;
      /* the eyebrow row must stay on ONE line — the first attempt at this
         reserved 52px for the hamburger, which wrapped the row down into
         the back arrow. Fixing one collision by making two. */
      R.eyebrowHeight = Math.round(document.querySelector('#s-predict > .qmeta').getBoundingClientRect().height);
      /* …and once a pick exists, the way back to a missed card returns */
      document.querySelector('#predCard .pdopt').click();
      await new Promise(r=>setTimeout(r,400));
      R.lockAfterOnePick=(document.getElementById('pdLock')||{}).textContent||null;
      R.pdnAfterOnePick=((document.querySelector('.pdn')||{}).textContent||'').trim();
      return R;
    });
    check('deck.the-two-counters-agree',
      /^0 \/ \d+ picked$/.test(first.pdn) && first.fillPct===0 && first.filledDots===0
        && /\b0 locked\b/.test(first.summary),
      `header said "${first.pdn}" (bar ${first.fillPct}% full, ${first.filledDots} dots) over a footer saying "${first.summary}"`,
      'REGRESSION: the sheet opened reading "1 / 6" over a bar a sixth full and a footer reading "0 / 6 locked". One counted the card you were LOOKING at, the other what you had DONE — both true, and a player has no way to know that');
    check('deck.nothing-is-still-needed-before-you-start',
      first.lock===null,
      `the sticky button said ${JSON.stringify(first.lock)} with nothing picked yet`,
      'it read "Still need winning team" while pointing at the card filling the screen — scolding somebody for not doing a thing they had not had the chance to do');
    check('deck.the-bar-does-not-sit-on-the-card',
      first.barOverlapsCard===false && first.hiddenOpts===0,
      `sticky bar overlaps the card=${first.barOverlapsCard}, options behind it=${first.hiddenOpts}`,
      'REGRESSION: the second option of the very first question was behind the fixed bar, so a player could reasonably not know there was one');
    check('deck.the-menu-does-not-cover-the-worth',
      first.menuOverlapsWorth===false && first.eyebrowHeight<=20,
      `menu shown=${first.menuShown}, overlaps worth=${first.menuOverlapsWorth}, eyebrow row ${first.eyebrowHeight}px tall`,
      'the hamburger was printing on top of "Up to 600 pts" — the number that says what the sheet is worth. It is off on this screen now, the same way it is off under a running clock: nothing in the corner of a focused task. And the row must stay one line — padding it to dodge the menu wrapped it into the back arrow instead');
    check('deck.the-way-back-returns-with-your-first-pick',
      !!first.lockAfterOnePick && /still need/i.test(first.lockAfterOnePick)
        && /^1 \/ \d+ picked$/.test(first.pdnAfterOnePick),
      `after one pick the button was ${JSON.stringify(first.lockAfterOnePick)} and the counter ${JSON.stringify(first.pdnAfterOnePick)}`,
      'hiding it at zero must not hide it forever — from the first pick on, "which one did I miss" is a real question and this is the answer to it');
    check('deck.first-paint-no-errors', errs.length===0, `errors: ${errs.slice(0,2).join(' | ')}`,
      'a throw here is a player who cannot make a card');
    await p.close();
  }

  /* ===================================================================
     YOU CANNOT ANSWER A QUARTER THAT HAS NOT HAPPENED

     Found in the live Control Room ten hours before Game Night #7 tipped:
     a submission sitting in the Q1 grade grid — a player with 10 points
     and 19 banked speed, for a quarter of a game nobody had played. The
     app was opened on a live night in the morning, the host had pushed
     nothing, so it fell through to its BUILT-IN bank and cheerfully asked
     "the first bucket of the night — how did it go in?"

     Points scored before tip are points taken from the people who
     actually watched, and paying attention is the entire proposition.
     =================================================================== */
  group('BROWSER — nothing to be right about yet');
  {
    const {p,errs}=await newPage({width:393,height:852},F.PRE);   // PRE = not tipped
    const r=await p.evaluate(async()=>{
      const R={};
      S.mode='live'; S.name='QA'; S.place='lobby'; S.qi=0; S.nextQ=0;
      try{ await loadGameStats(true); }catch(e){}
      try{ phaseSync('test'); }catch(e){}
      R.phase = (typeof phaseNow==='function') ? phaseNow() : '?';
      renderLobby(0); go('lobby');
      /* the button must not invite a tap */
      R.btns = [...document.querySelectorAll('#gtIdle button')]
        .map(b=>({t:(b.textContent||'').trim(), off:b.disabled}));
      /* and the function must refuse even if something calls it directly */
      try{ startQuarter(0); }catch(e){ R.threw=e.message; }
      await new Promise(r2=>setTimeout(r2,200));
      R.screenAfter = S.screen;
      /* a host who HAS pushed a round outranks the clock */
      R.hostOverride = (function(){
        try{
          const rid = (typeof curRoundId==='function') ? 'r0' : 'r0';
          HR.docs = HR.docs || {};
          HR.docs[0] = {id:rid, state:'live', idx:0};
          const was = window.hostedDoc;
          window.hostedDoc = function(){ return {id:rid, state:'live', idx:0}; };
          const blocked = liveRoundBlocked(0);
          window.hostedDoc = was;
          return blocked;
        }catch(e){ return 'err:'+e.message; }
      })();
      /* practice is never blocked */
      S.mode='demo';
      R.practiceBlocked = liveRoundBlocked(0);
      startQuarter(0);
      await new Promise(r2=>setTimeout(r2,200));
      R.practiceScreen = S.screen;
      return R;
    });
    check('pretip.the-quarter-will-not-open',
      r.phase==='pre' && r.screenAfter!=='live',
      `phase=${r.phase}, startQuarter left us on ${r.screenAfter}`,
      'REGRESSION: a real submission with 10 points and 19 speed landed in Game Night #7\'s Q1 grid ten hours before tip, answering the built-in bank about a game nobody had played');
    /* THIS CHECK USED TO DEMAND THE WORD "tips", AND THAT WAS THE BUG.
       It read `/tips/i.test(b.t)` — pinning one sport's word for the start
       of play, and pinning the wrong MOMENT with it. A round is ABOUT its
       period, so run.js opens it only once that period is DONE; "opens when
       the game tips" is the one time it is guaranteed not to. The founder
       watched Arsenal at Villa Park from kickoff for forty-five minutes on
       the strength of that sentence and reported the app broken.

       So the assertion reverses with the behaviour, which is the rule: the
       button must still be DEAD before tip (that is the regression this
       check exists for — a live "Q1 ended? Answer now" at four in the
       afternoon), and it must name something ENDING rather than the game
       starting. The words are no longer pinned to a sport. */
    check('pretip.the-button-says-so',
      r.btns.length>0 && r.btns.every(b=>b.off===true)
        && r.btns.some(b=>/\b(ends?|after)\b/i.test(b.t))
        && !r.btns.some(b=>/answer now|ended\?/i.test(b.t)),
      `buttons on the board before tip: ${JSON.stringify(r.btns)}`,
      'a live button reading "Q1 ended? Answer now" at four in the afternoon is the app asking somebody to make something up — and a button promising the round opens at tip-off sent the founder to watch 45 minutes of nothing');
    check('pretip.a-host-push-outranks-the-clock',
      r.hostOverride===null,
      `with the Control Room saying a round is live, the block still returned ${JSON.stringify(r.hostOverride)}`,
      'the human is allowed to know something the feed does not — a deliberate push must never be overruled by our own clock');
    check('pretip.practice-is-never-blocked',
      r.practiceBlocked===null && r.practiceScreen==='live',
      `practice block=${JSON.stringify(r.practiceBlocked)}, landed on ${r.practiceScreen}`,
      'a simulated game has already happened. Practice must work at any hour of any day, tipped or not');
    check('pretip.no-errors', errs.length===0, `errors: ${errs.slice(0,2).join(' | ')}`,
      'a throw in the pre-tip guard is a night nobody can start');
    await p.close();
  }

  /* ---- AND IT MUST FAIL OPEN ------------------------------------
     This guard is the highest-consequence line in the build: get it
     wrong in the other direction and NOBODY CAN PLAY AT ALL. The
     dangerous case is not a slow feed before tip, it is ESPN dying at
     8:01 — the phase clock goes quiet, and if silence read as "pre" the
     entire night would be locked out with no way in.

     phaseNow() falls back to the tip time and then to nothing, and
     "nothing" is not "pre". These four cases are that promise. */
  /* B2 SPLIT THIS GROUP IN TWO. These four cases were written to prove one
     thing — THE FEED DOES NOT DECIDE WHETHER YOU CAN PLAY — and they proved
     it by leaving the host out of the picture entirely. Once a live round
     requires a push, "no push" and "no feed" both read as blocked and the
     cases stopped testing the feed at all.

     So the host is now held constant: every case below has a pushed round,
     and the only thing that varies is ESPN. The push's own effect gets its
     own cases underneath, where it belongs. */
  for(const CASE of [
    /* Before tip, nothing is playable and the feed has no say in it. No push
       either — a quarter nobody has opened, three hours early, is not a
       quarter. */
    {name:'feed-down-before-tip', feed:'down',  offset:-3*3600e3, blocked:true,  host:false, why:'not-started'},
    {name:'feed-pre-before-tip',  feed:F.PRE,   offset:-3*3600e3, blocked:true,  host:false, why:'not-started'},
    /* THE HOST OUTRANKS THE CLOCK. A deliberate push before tip opens the
       round anyway — the human is allowed to know something the feed does
       not, and this is the one case where they overrule it. */
    {name:'host-push-before-tip', feed:F.PRE,   offset:-3*3600e3, blocked:false, host:true},
    /* After tip, with a pushed round in hand, ESPN must not be able to shut
       the door. This is the direction that would lock out a whole night. */
    {name:'feed-down-after-tip',  feed:'down',  offset:+5*60e3,   blocked:false, host:true},
    {name:'feed-live-after-tip',  feed:F.LIVE,  offset:+5*60e3,   blocked:false, host:true},
    /* THE NEW RULE. Tipped, feed perfect, host silent — no round. A player
       who taps here used to be handed four questions out of the built-in
       bank, answer them, and hold an unscoreable round for the rest of the
       night, because the key the host eventually posted was for a different
       quiz. Nothing is lost by refusing: that round never paid. */
    {name:'no-push-after-tip',    feed:F.LIVE,  offset:+5*60e3,   blocked:true,  host:false, why:'no-host'},
    {name:'no-push-feed-down',    feed:'down',  offset:+5*60e3,   blocked:true,  host:false, why:'no-host'}
  ]){
    const pg = await mkPage({width:393,height:852});
    const perrs=[]; pg.on('pageerror',e=>perrs.push(String(e)));
    /* This group builds its own page rather than going through newPage(),
       so it installs the host-round stand-in itself. Found the hard way:
       the helper went in as a post-load evaluate first, three groups
       re-navigate, and the suite crashed instead of failing a check. */
    await pg.addInitScript(()=>{
      window.__hostRound = function(qi, state){
        try{ HR.doc = {id:'r'+qi, idx:qi, state:state||'live'}; }catch(_){}
      };
      window.__noHostRound = function(){ try{ HR.doc=null; }catch(_){} };
    });
    /* THE TIP TIME IS NOT OURS TO HARDCODE. This was a literal date, and it
       went red the moment the night config was swapped to the next game —
       the clock said "before tip" for a case that was meant to be after it.
       A test holding its own copy of a fact the app owns is the same bug
       this whole suite has spent a week finding in the app. Read it from
       the build. */
    const TIP = Date.parse((read(PLAYER).match(/tipISO:"([^"]+)"/)||[])[1] || '2026-08-13T00:00:00Z');
    await pg.addInitScript(t=>{ Date.now = () => t; }, TIP + CASE.offset);
    await pg.route('**/site.api.espn.com/**', r => CASE.feed==='down'
      ? r.abort()
      : r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(CASE.feed)}));
    await pg.route('**/site.web.api.espn.com/**', r=>r.abort());
    /* ?fixture=1 — this block fakes the clock relative to the tipISO it
       read out of the BUILD, then let the app hydrate a different night
       with a different tip time. The faked clock was measured against a
       game the app was no longer showing, which is why
       pretip.blocked-for-the-right-reason flipped between 'no-host' and
       'not-started' depending on the hour the gate ran. Hold the fixture
       and the clock and the game describe the same thing again. */
    await pg.goto(url+'?fixture=1',{waitUntil:'domcontentloaded'});
    await pg.waitForTimeout(1500);
    const got = await pg.evaluate(async(HOST)=>{
      S.mode='live'; S.name='QA'; S.place='lobby'; S.qi=0; S.nextQ=0;
      HOST ? __hostRound(0) : __noHostRound();
      try{ await loadGameStats(true); }catch(e){}
      try{ phaseSync('t'); }catch(e){}
      const why = liveRoundBlocked(0);
      const blocked = !!why;
      startQuarter(0);
      await new Promise(x=>setTimeout(x,220));
      return {blocked, why, screen:S.screen, phase:(function(){try{return phaseNow();}catch(e){return 'err';}})()};
    }, CASE.host);
    check(`pretip.fails-open.${CASE.name}`,
      got.blocked===CASE.blocked && (CASE.blocked ? got.screen!=='live' : got.screen==='live') && perrs.length===0,
      `phase=${got.phase} blocked=${got.blocked} (wanted ${CASE.blocked}) why=${got.why} screen=${got.screen} errors=${perrs.length}`,
      !CASE.host
        ? 'B2: tipped but the host never pushed this round. Opening it would serve the built-in bank, and a key written for the host\u2019s questions can never grade those answers'
        : CASE.blocked
          ? 'before tip, with or without a feed, there is nothing to be right about'
          : 'THE DANGEROUS DIRECTION: if ESPN dies at 8:01 and silence read as "pre", the whole night would be locked out with no way in. Silence is not "pre" \u2014 and with a pushed round in hand the feed must not be able to shut the door');
    /* THE REASON IS NOT DECORATION — the button copy branches on it. "Opens
       when the game tips", printed in the middle of the third quarter, told a
       player something they could see with their own eyes was false. Before
       tip the honest reason is 'not-started'; after tip with no push it is
       'no-host', and they are different sentences. */
    if(CASE.why){
      check(`pretip.blocked-for-the-right-reason.${CASE.name}`, got.why===CASE.why,
        `wanted reason '${CASE.why}', got '${got.why}'`,
        'two reasons, two sentences: before tip nothing has happened yet; after tip the host simply has not opened this one');
    }
    await pg.close();
  }

  /* ===================================================================
     THE BACKEND IS REAL NOW  (`A7`, the oldest thing on the list)

     Until this group, every check in this suite ran against a hand-built
     `window.SB`. The code that has caused EVERY scoring failure this
     product has ever had — join, submit, the outbox, the score push —
     had never once been executed by a test. We were testing the app
     around the exact hole the bugs live in.

     `qa/fakebase.js` serves real ES modules in place of Google's, through
     the app's own `STATS_SDK_BASE` hook. Nothing in index.html changes.
     SB boots, signs in, and writes — to a store that really stores, and
     that can be told to fail on command, which is the one thing a real
     backend will never do for you.
     =================================================================== */
  group('BROWSER — the backend is real now');
  {
    const FAKE = require('./fakebase.js');
    const mk = async () => {
      const pg = await mkPage({width:393,height:852});
      const es = []; pg.on('pageerror',e=>es.push(String(e)));
      await FAKE.install(pg, {});
      await pg.route('**/site.api.espn.com/**', r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(F.LIVE)}));
      await pg.route('**/site.web.api.espn.com/**', r=>r.abort());
      await pg.goto(url,{waitUntil:'domcontentloaded'});
      await pg.waitForTimeout(2200);
      return {pg, es};
    };

    /* ---- it actually connects, and it actually writes --------------- */
    {
      const {pg, es} = await mk();
      const r = await pg.evaluate(async()=>{
        const R = { state: SB.state, enabled: !!SB.enabled, uid: SB.me && SB.me.uid };
        R.joined = await SB.join({ nightId:'qa-night', name:'QA', color:'#fff' });
        R.seat = window.__FB.dump('nights/qa-night/players');
        return R;
      });
      const seatPaths = Object.keys(r.seat||{});
      check('backend.sb-boots-against-a-real-sdk',
        r.state==='on' && r.enabled===true && !!r.uid,
        `SB.state=${r.state} enabled=${r.enabled} uid=${r.uid}`,
        'A7: every check before this one ran against a hand-stubbed SB, so join/submit/outbox/grade were never executed by a test at all');
      check('backend.join-writes-a-seat',
        r.joined===true && seatPaths.length===1 && seatPaths[0].endsWith(r.uid),
        `join returned ${r.joined}, seats written: ${JSON.stringify(seatPaths)}`,
        'the seat is what puts a player on the board — a submission with no seat is the ghost row that turned up in Game Night #7 before tip');
      check('backend.no-errors-on-a-real-boot', es.length===0,
        `errors: ${es.slice(0,2).join(' | ')}`,
        'the whole Firebase path had never been executed in a test, so a throw in it was invisible');
      await pg.close();
    }

    /* ---- unknown is not new: the wifi blip that zeroed a seat ------- */
    {
      const {pg} = await mk();
      const r = await pg.evaluate(async()=>{
        /* seat exists with 50 real points */
        await SB.join({ nightId:'qa-night', name:'QA', color:'#fff' });
        const uid = SB.me.uid, path = 'nights/qa-night/players/'+uid;
        window.__FB.docs.set(path, Object.assign({}, window.__FB.docs.get(path), { pts:50 }));
        /* ONE blip must now RECOVER, not abort — B-58, GN8 widened the read
           budget from a single shot to three tries with short gaps, because
           a phone reconnecting right as its network came back would lose
           its one attempt to the very blip it was recovering from. This
           test still failed exactly one read, so the retry swallowed it,
           join succeeded as designed, and the check reported a regression
           that was actually the fix working. */
        window.__FB.failReads(1);
        const survived = await SB.join({ nightId:'qa-night', name:'QA', color:'#fff' });
        const afterBlip = (window.__FB.docs.get(path)||{}).pts;
        /* Now exhaust the WHOLE budget, which is what "the read failed"
           actually means today. */
        window.__FB.failReads(3);
        const again = await SB.join({ nightId:'qa-night', name:'QA', color:'#fff' });
        return { survived, afterBlip, again,
                 after: (window.__FB.docs.get(path)||{}).pts, why: SB.lastJoinError||'' };
      });
      check('backend.one-blip-is-retried-not-fatal',
        r.survived===true && r.afterBlip===50,
        `a single failed read should retry and succeed: join=${r.survived}, seat=${r.afterBlip}`,
        'B-58, GN8: a single read was the whole budget, so a phone reconnecting as its network returned lost its one shot to the same blip');
      check('backend.a-failed-read-never-zeroes-a-seat',
        r.again===false && r.after===50,
        `join returned ${r.again} and the seat now holds ${r.after} pts (lastJoinError=${r.why})`,
        'REGRESSION: SB.join read the seat inside a bare catch, so "the read failed" and "there is no seat here" were the same answer — and the else-branch writes pts:0. A wifi blip overwrote fifty real points with zeros');
      await pg.close();
    }

    /* ---- the outbox: an answer is never lost -------------------------- */
    {
      const {pg} = await mk();
      const r = await pg.evaluate(async()=>{
        await SB.join({ nightId:'qa-night', name:'QA', color:'#fff' });
        window.__FB.offline(true, 'unavailable');          // the room goes away
        const sent = await SB.submit('r0', { name:'QA', picks:['a'], qs:['q'], keys:['a'], worth:10 });
        const queuedWhileDown = SB.pendingWrites();
        const onDiskWhileDown = Object.keys(window.__FB.dump('nights/qa-night/rounds/r0/subs')).length;
        /* Persisted, not just held in a variable — this is the half of
           the promise that matters, because the phone gets closed. */
        const parked = localStorage.getItem('stats_outbox_v2') || '';
        window.__FB.offline(false);                        // …and comes back
        /* Drive the REAL trigger. `outDrain` is module-scoped on purpose;
           an earlier version of this test called it as a global, got
           `undefined`, and reported a working outbox as broken. Test the
           door the app actually uses. */
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise(r2=>setTimeout(r2,700));
        return { sent, queuedWhileDown, onDiskWhileDown, parkedHasRow: /\"rid\":\"r0\"/.test(parked),
                 queuedAfter: SB.pendingWrites(),
                 onDiskAfter: Object.keys(window.__FB.dump('nights/qa-night/rounds/r0/subs')).length };
      });
      check('backend.a-lost-write-queues-and-drains',
        r.queuedWhileDown>=1 && r.onDiskWhileDown===0 && r.parkedHasRow===true
          && r.onDiskAfter===1 && r.queuedAfter===0,
        `while down: queued=${r.queuedWhileDown} on disk=${r.onDiskWhileDown} parked=${r.parkedHasRow}; after recovery: queued=${r.queuedAfter} on disk=${r.onDiskAfter}`,
        'the outbox has existed since Build A and has never once been watched actually recover a write against a backend that really refused one');
      await pg.close();
    }

    /* ---- an answer is never refused, even with the lanes spent ------ */
    {
      const {pg} = await mk();
      const r = await pg.evaluate(async()=>{
        await SB.join({ nightId:'qa-night', name:'QA', color:'#fff' });
        /* BURN THE LANE THROUGH THE PUBLIC API. An earlier version of
           this looped on `budgetWrite()`, which is module-scoped — it
           threw on the first iteration, burned nothing, and the check
           passed against a submit that WAS gated. Every join spends one
           write, and re-joining the same night does not reset the lanes,
           so this exhausts it the way a real runaway would. */
        for(let i=0;i<3200;i++){ await SB.join({nightId:'qa-night', name:'QA', color:'#fff'}); }
        const b = SB.budget ? SB.budget() : null;
        const laneSpent = !!(b && b.write >= b.maxWrite);
        const sent = await SB.submit('r9', { name:'QA', picks:['a'], qs:['q'], keys:['a'], worth:10 });
        await new Promise(r2=>setTimeout(r2,250));
        return { budget:b, laneSpent, sent, onDisk:Object.keys(window.__FB.dump('nights/qa-night/rounds/r9/subs')).length };
      });
      check('backend.an-answer-survives-an-exhausted-budget',
        r.laneSpent===true && r.onDisk===1,
        `write lane actually spent=${r.laneSpent} (${r.budget&&r.budget.write}/${r.budget&&r.budget.maxWrite}); answer on disk: ${r.onDisk} (submit returned ${r.sent})`,
        'THE BUG THAT ATE DAN\'S NIGHT: one shared counter, spent by a leaderboard poll two hours before tip, and every answer he gave afterwards returned false before it ever attempted the write');
      await pg.close();
    }

    /* ---- the room bar tells the truth about a queue ----------------- */
    {
      const {pg} = await mk();
      const r = await pg.evaluate(async()=>{
        S.mode='live'; S.name='QA';
        await SB.join({ nightId:'qa-night', name:'QA', color:'#fff' });
        window.__FB.offline(true);
        await SB.submit('r0', { name:'QA', picks:['a'], qs:['q'], keys:['a'], worth:10 });
        try{ await refreshRoom(); }catch(e){}
        await new Promise(r2=>setTimeout(r2,250));
        const el = document.getElementById('roomTxt');
        const dot = document.getElementById('roomDot');
        window.__FB.offline(false);
        return { txt:(el&&el.textContent)||'', cls:(dot&&dot.className)||'', pending:SB.pendingWrites() };
      });
      check('backend.the-bar-says-your-answer-is-safe',
        r.pending>=1 && /saving|retry|safe/i.test(r.txt),
        `room bar read "${r.txt}" with ${r.pending} write(s) queued`,
        'during an outage "the room is unreachable" and "your round is in a queue" are both true, and only one of them is about the player');
      await pg.close();
    }

    /* ================================================================
       THE RECEIPT  (`B4`)

       Game Night #7's two worst outcomes were both silent. One player
       answered nothing all night and believed he had answered; another
       lost his fourth quarter at the buzzer and got a toast that
       disappeared. Both screens said "Your answers are locked and sent."

       That sentence was printed by the code that ASKED for the write. It
       is now printed by the code that WATCHED IT LAND, and there are four
       states rather than one. These checks exist because a receipt that
       lies is worse than no receipt: it is the same failure with more
       confidence.                                                       */
    {
      const {pg} = await mk();
      const r = await pg.evaluate(async()=>{
        S.mode='live'; S.name='QA';
        await SB.join({ nightId:'qa-night', name:'QA', color:'#fff' });
        const out={};
        // 1. the happy path says saved, and only after the server answers
        const ok = await SB.submit('r0', {name:'QA',picks:['a'],banks:[0]});
        out.okReturn = ok; out.saved = SB.subStateOf('r0');
        // 2. offline: held, not lost, and never "saved"
        window.__FB.offline(true);
        await SB.submit('r1', {name:'QA',picks:['b'],banks:[0]});
        out.queued = SB.subStateOf('r1');
        // 3. it drains, and the state flips to saved on its own
        window.__FB.offline(false);
        window.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise(x=>setTimeout(x,400));
        out.drained = SB.subStateOf('r1');
        return out;
      });
      check('receipt.saved-means-the-server-answered',
        r.okReturn===true && r.saved==='saved',
        `submit returned ${r.okReturn}, state='${r.saved}'`,
        'the whole point: "saved" is a fact about the server, not about the button');
      check('receipt.an-outage-is-held-not-saved',
        r.queued==='queued',
        `state during an outage was '${r.queued}'`,
        'a write in the outbox is a real answer that has not landed. Calling it saved is the Game Night #7 lie');
      check('receipt.a-drained-queue-becomes-saved',
        r.drained==='saved',
        `state after the outage cleared was '${r.drained}'`,
        'the receipt has to catch up on its own, or a player stares at a warning about answers that arrived minutes ago');
      await pg.close();
    }

    /* The one that actually bit: no night id, so the write cannot even be
       queued. Before B3 this was unreachable in practice because the
       fallback that was supposed to prevent it read `window.GAME`, and
       `GAME` is a top-level const that never lands on window. */
    {
      const {pg} = await mk();
      const r = await pg.evaluate(async()=>{
        S.mode='live'; S.name='QA';
        // deliberately never join, so there is no nightId anywhere
        const out={ hasWindowGame: !!(window.GAME && window.GAME.nightId) };
        // (a) never joined, but the night is configured. This is Mike's Q4.
        await SB.submit('r3', {name:'QA',picks:['c'],banks:[0]});
        out.state = SB.subStateOf('r3'); out.pending = SB.pendingWrites();
        // (b) and now take the night away entirely — the only true 'lost'
        const keep = window.GAME.nightId; window.GAME.nightId = '';
        await SB.submit('r4', {name:'QA',picks:['d'],banks:[0]});
        out.lost = SB.subStateOf('r4');
        window.GAME.nightId = keep;
        return out;
      });
      check('receipt.the-write-safety-net-is-connected',
        r.hasWindowGame===true,
        'window.GAME is undefined — nidNow()\u2019s fallback is dead code again',
        'B3: `const GAME` never becomes a window property, so the fallback meant to catch a missing nightId had never once fired');
      check('receipt.a-session-that-never-joined-still-keeps-the-answers',
        r.state==='queued' && r.pending>=1,
        `state='${r.state}' pending=${r.pending}`,
        'THIS IS MIKE\u2019S Q4. A reload plus a restore-from-save leaves a session with the night configured but no join. Before B3 the write was deleted and announced in a toast that faded; it is now held and retried');
      check('receipt.a-genuinely-homeless-write-says-lost',
        r.lost==='lost',
        `state with no night anywhere was '${r.lost}'`,
        'the one case nothing can save still has to be visible — red, with a retry, not a toast');
      await pg.close();
    }
  }

  /* ===================================================================
     CAUGHT IT PAYS, AND THE ENDING TELLS THE TRUTH  (`B7`, `B8`)

     Two of Game Night #7's findings were about the app congratulating
     someone for something that had not happened. Caught It flashed the
     scoreboard green for zero points, and the final screen handed PERFECT
     NIGHT to a player whose last three quarters were never scored.

     Both are the same class: a celebration with no idea whether the night
     worked. These checks are the guard on that.                        */
  group('BROWSER — the ending tells the truth');
  {
    const {p, errs} = await newPage(VPS[0], F.LIVE);
    const r = await p.evaluate(async()=>{
      const out={};
      S.mode='live'; S.name='QA'; S.led={}; recomputeScore();
      PCI.pts=0; PCI.streak=0; PCI.best=0; PCI.called=0; PCI.hit=0; PCI.graded={}; PCI.picked={};
      const fire=(id,ans,mine)=>{ PCI.picked[id]=mine; ciGrade({qid:id, answer:ans}); };
      fire('ci-1','A','A');  out.one   = S.caughtPts;          // 5  × streak 1
      fire('ci-2','A','A');  out.two   = S.caughtPts;          // +10 → 15
      fire('ci-3','A','A');  out.three = S.caughtPts;          // +15 → 30
      fire('ci-4','A','B');  out.miss  = S.caughtPts;          // wrong: no change
      out.streakReset = PCI.streak;
      // the cap holds
      for(let i=0;i<40;i++) fire('ci-c'+i,'A','A');
      out.capped = S.caughtPts;
      // and it is its own lane, not folded into the quarters
      out.lanes = Object.keys(S.led).map(k=>S.led[k].k).filter((v,i,a)=>a.indexOf(v)===i);
      out.total = S.pts;
      return out;
    });
    check('caught.a-correct-call-pays', r.one===5,
      `first catch paid ${r.one}, expected 5`,
      'for seven game nights it paid nothing while flashing the scoreboard green. That is the bug this check exists for');
    check('caught.the-streak-is-the-point', r.two===15 && r.three===30,
      `after two: ${r.two} (want 15), after three: ${r.three} (want 30)`,
      '5 x the streak. Protecting a run is the behaviour the side game exists to create, so the run is what pays');
    check('caught.a-miss-pays-nothing-and-resets', r.miss===r.three && r.streakReset===0,
      `points went ${r.three} -> ${r.miss}, streak now ${r.streakReset}`,
      'no consolation points, and the run genuinely ends — otherwise the streak multiplier is free money');
    check('caught.the-night-is-capped', r.capped===100,
      `a hot night reached ${r.capped}, cap is 100`,
      'a Q4 question is worth 40. A side game that can outrun the main one is not a side game');
    check('caught.it-is-its-own-auditable-lane', r.lanes.indexOf('caught')>=0,
      `ledger kinds present: ${JSON.stringify(r.lanes)}`,
      "'catch' is the watchlist and 'caught' is Caught It. One letter apart, and for seven nights only one of them existed");
    check('caught.no-errors', errs.length===0, `errors: ${errs.slice(0,2).join(' | ')}`, '');
    await p.close();
  }

  {
    const {p} = await newPage(VPS[0], F.LIVE);
    const r = await p.evaluate(async()=>{
      const out={};
      S.mode='live'; S.name='QA';
      const nQ = rounds[0].q.length;
      /* POINTS ON THE BOARD, AND A ROOM WITH PEOPLE IN IT.
         30 Aug. This block used to score nothing and rank against nobody,
         and it still passed — which meant the two `B7` checks under it
         were green because NO award fired at all, not because the guard
         withheld the right ones. A check that cannot observe its own
         failure is not a check. The zero-night gate and the field>=2 rule
         both make the old setup produce an empty award list, so the setup
         is now a night that genuinely earned something: real points, and
         a field of six to be first in. */
      ledgerSet('qa-live', 300, 0, 'live');
      const FIELD = 6;
      // Answered Q1 perfectly and it WAS graded; answered Q2 and it never was.
      S.liveAnswers[0]=rounds[0].q.map(()=>({choice:'x',bank:0}));
      S.results[0]=rounds[0].q.map(()=>true);
      S.liveAnswers[1]=rounds[1].q.map(()=>({choice:'x',bank:0}));
      S.results[1]=[];
      let c=awardCtx(1, FIELD);
      out.unsettled=c.unsettled; out.settled=c.settled;
      out.pts=c.pts; out.field=c.field;
      out.awardsWhileOwed = earnedAwards(1, FIELD).all.map(a=>a.id);
      // now settle it
      S.results[1]=rounds[1].q.map(()=>true);
      out.awardsWhenSettled = earnedAwards(1, FIELD).all.map(a=>a.id);
      return out;
    });
    check('award.an-owed-round-is-counted', r.unsettled===1 && r.settled===false,
      `unsettled=${r.unsettled} settled=${r.settled}`,
      'a round you answered that never came back with a score. The engine had no concept of this and so could not avoid celebrating it');
    /* THE GUARD ON THE GUARD. The three checks below are all of the form
       "this award did NOT fire", and every one of them passes trivially on
       a night that earned nothing — which is exactly the state this block
       was in until 30 Aug. Assert the setup is a scoring night with a real
       field FIRST, so a future change that quietly empties it fails here
       instead of turning the next three green for the wrong reason. */
    check('award.the-setup-is-a-night-that-could-win',
      r.pts>0 && r.field>=2,
      `pts=${r.pts} field=${r.field}`,
      'the B7 checks below only mean something on a night that would otherwise be celebrated');
    check('award.no-perfect-night-while-a-round-is-owed',
      r.awardsWhileOwed.indexOf('perfect')<0 && r.awardsWhileOwed.indexOf('wire')<0,
      `awards given on an unsettled night: ${JSON.stringify(r.awardsWhileOwed)}`,
      'THIS IS MIKE. "You did not miss a single graded question all night" — with three quarters ungraded. The award counted graded questions, so the more of your night that failed, the easier perfection got');
    check('award.no-crown-while-a-round-is-owed',
      r.awardsWhileOwed.indexOf('gameball')<0,
      `awards given on an unsettled night: ${JSON.stringify(r.awardsWhileOwed)}`,
      'a first place declared over incomplete data is a guess wearing a trophy');
    check('award.a-settled-night-still-earns-them',
      r.awardsWhenSettled.indexOf('perfect')>=0 && r.awardsWhenSettled.indexOf('gameball')>=0,
      `awards on a settled night: ${JSON.stringify(r.awardsWhenSettled)}`,
      'the guard must not eat the reward on a night that actually worked — that would be the same mistake pointing the other way');
    await p.close();
  }

  /* ---- one score, one source (`B5`, `B6`) ------------------------- */
  {
    const src=read(PLAYER);
    const summaryFetches=(src.match(/summary\?event=/g)||[]).length;
    check('score.only-one-thing-fetches-the-game',
      summaryFetches===1,
      `${summaryFetches} places build a summary?event= URL; there must be exactly one`,
      'paintHeroRibbon() had its own fetch on its own timer. Game Night #7 put its answer and the rail\u2019s answer on one screen, 47 seconds apart, and asked the player to hold both');
    check('score.the-ribbon-reads-the-shared-feed',
      /async function paintHeroRibbon\(\)[\s\S]{0,900}loadGameStats\(\)/.test(src)
      && /async function paintHeroRibbon\(\)[\s\S]{0,1200}GS\.teams/.test(src),
      'paintHeroRibbon no longer reads GS — it has gone back to having its own eyes',
      'every surface derives from one read or the app can disagree with itself in a single screenshot');
    check('home.the-tip-off-line-follows-the-game',
      /function landingTipLine\(\)/.test(src) && /set\('landingTip', landingTipLine\(\)\)/.test(src),
      'the landing page is writing GAME.tip directly again',
      'mid-second-quarter it still read "Tip-off 8:00 ET" in gold, above everything — a page announcing an event that started ninety minutes ago');
  }

  /* ===================================================================
     LEAN — THE FOUR SURFACES

     This group is the only one in the suite that runs the app as it will
     actually ship on Friday. Every other check turns LEAN off and drives
     the full product, which is deliberate: the machinery still has to be
     correct underneath, because these features come back one per night.

     Two halves, and the second matters more. First: the things LEAN claims
     to remove are genuinely gone — a flag that half-hides a feature, while
     its points still count toward a denominator somewhere, produces a wrong
     total, which is worse than leaving it on. Second: THE GAME STILL RUNS.
     A strip that quietly removes the ability to answer a quarter would be
     the most expensive possible version of this idea.                   */
  group('BROWSER — lean, the four surfaces');
  {
    const {p, errs} = await newPage(VPS[0], F.LIVE);
    const r = await p.evaluate(async()=>{
      LEAN_ON = true;
      S.mode='live'; S.name='QA'; S.place='lobby'; S.qi=0; S.nextQ=0;
      try{ await loadGameStats(true); }catch(e){}
      try{ phaseSync('t'); }catch(e){}
      navGo('gametime');
      try{ renderGametime(); }catch(e){}
      await new Promise(x=>setTimeout(x,300));
      const txt=(document.getElementById('s-gametime')||{}).innerText||'';
      const has=(re)=>re.test(txt);
      const out={
        winprob:  has(/win probability/i),
        spark:    has(/the night so far/i),
        run:      has(/last 12 scores/i),
        deepcut:  has(/deep cut/i),
        drawer:   has(/the game, in numbers/i),
        feed:     !!((document.getElementById('gtFeed')||{}).innerHTML||'').trim(),
        // …and the four that must survive
        score:    !!document.querySelector('#gtHead .ascore'),
        yournight:has(/your night/i),
        /* LEAN MUST NOT GATE CAUGHT IT. This guards the GN8 incident: the
           host fired questions all night and the player app was simply not
           listening.

           It used to read `PCI.unsub=null; startCallItWatch(); return
           !!PCI.unsub` in a harness that never sets up a backend — and it
           passed only because SB.watchCallIt returned a truthy no-op
           `function(){}` when there was no night. That sentinel was itself
           a bug: a handle that unsubscribes nothing permanently satisfies
           every `if(handle) return` guard, which is how a whole night's
           Caught It could be lost in silence. Closing it (25 Aug) turned
           this check red without one line of behaviour changing.

           So give it a backend and assert the INTENT — with a room to
           attach to, LEAN still lets Caught It attach — instead of the
           accident. qa/ci-deaf.js asserts the opposite for the NO-night
           case and is the correct reading there; the two agree now.
           State is restored so the rest of this block is unaffected. */
        ciWatch:  (function(){
                    var _mode=S.mode, _sb=window.SB, _en=(window.SB||{}).enabled,
                        _w=(window.SB||{}).watchCallIt, attempts=0;
                    try{
                      window.SB = window.SB || {};
                      SB.enabled = true;
                      SB.watchCallIt = function(){ attempts++; return function(){}; };
                      S.mode = 'live';
                      PCI.unsub = null;
                      startCallItWatch();
                      /* Both halves matter: that the attach was actually
                         ATTEMPTED (LEAN did not short-circuit it) and that
                         the handle came back. Either alone can be faked. */
                      return attempts === 1 && !!PCI.unsub;
                    } finally {
                      PCI.unsub = null;
                      S.mode = _mode;
                      if(_sb){ SB.enabled = _en; SB.watchCallIt = _w; } else { window.SB = _sb; }
                    }
                  })(),
        catches:  CATCHES.length
      };
      // the tabs
      /* Talk and Me are RETIRED — not hidden, gone from the markup — so
         querying for their buttons returns null and the old version of this
         crashed the whole suite. Absent is the stronger result and the
         check now says so. */
      var _sb = document.querySelector('#botnav [data-nav="stats"]');
      out.statsBtn = _sb ? (_sb.style.display || 'shown') : 'absent';
      out.talkBtn  = document.querySelector('#botnav [data-nav="crew"]') ? 'present' : 'absent';
      out.meBtn    = document.querySelector('#botnav [data-nav="me"]')   ? 'present' : 'absent';
      out.navCount = document.querySelectorAll('#botnav .navb').length;
      /* Force every screen that owns a Talk button to render, then count
         what is left visible. The final screen is the one that leaked. */
      try{ showFinal(); }catch(e){}
      try{ paintNav(); }catch(e){}
      /* COUNT WHAT A PLAYER CAN TAP, NOT AN ATTRIBUTE.
         This used to read b.style.display — the INLINE style. leanStripTabs()
         deliberately stopped writing inline styles: revTalkBtn is shown again
         by the review screen with its own inline write, which beat ours every
         time, so the strip moved to a .leanHidden class backed by
         display:none !important. The buttons have been correctly hidden ever
         since and this check has been reporting three of them visible,
         because it was looking at the one property that no longer carries the
         answer. Same shape as the sticky lesson in the incident catalogue: a
         getComputedStyle assertion passed while sticky was disabled, and the
         fix was to measure the effect rather than the declaration.
         Computed display + real box size catches an inline style, a class, a
         visibility flip and a zero-height collapse alike. */
      /* AND THE FIRST REWRITE OF THIS WAS ITSELF A FALSE GREEN, which is
         the more useful half of the story. It added `width>0 && height>0`
         on the theory that "tappable" is what matters. But these buttons
         live on sections that are themselves hidden — review, break, the
         final screen — so they are never laid out and their box is 0x0
         whatever their own display says. Sabotaging leanStripTabs to strip
         NOTHING left the count at zero and the check green: the size
         condition threw away the only signal that was working. Computed
         display on the button is the thing that actually moved (0 -> 3).
         Measure that. */
      out.talkButtonsVisible = Array.prototype.filter.call(
        document.querySelectorAll('button'),
        function(b){
          if(!/talk trash/i.test(b.textContent||'')) return false;
          var cs = getComputedStyle(b);
          return cs.display!=='none' && cs.visibility!=='hidden';
        }
      ).length;
      /* THE STRIP HAS TO SURVIVE A LATER INLINE WRITE, which is the whole
         reason it uses a class with !important instead of style.display.
         revTalkBtn is shown again by the review screen with its own inline
         write; an inline display beats a plain stylesheet rule and loses to
         !important. Simulate exactly that and confirm the button stays
         shut, because without this the !important can be dropped and
         nothing notices until a screenshot finds four live Talk buttons. */
      /* ============ MEASURE THE MECHANISM, NOT THE SETTING =============
         28 Aug 2026: talk was turned back on. TALK_ON now sits beside
         LEAN_ON and only governs the talk surfaces, so "is a Talk button
         visible" is no longer the same question as "does the strip work".

         Both still matter and they are measured separately. The strip is
         exercised by forcing TALK_ON off and re-running the sweep — the
         !important behaviour it exists for is unchanged and still guarded.
         Whether talk is ON is recorded as a fact, not asserted here. */
      out.talkOn = (typeof TALK_ON !== 'undefined') ? !!TALK_ON : null;
      out.talkSurvivesInlineWrite = (function(){
        var b = document.getElementById('revTalkBtn');
        if(!b) return null;
        var wasOn = (typeof TALK_ON !== 'undefined') ? TALK_ON : null;
        try{ if(wasOn !== null) window.TALK_ON = false; leanStripTabs(); }catch(_){}
        var before = b.style.display;
        b.style.display = 'block';
        var held = getComputedStyle(b).display === 'none';
        b.style.display = before;
        try{ if(wasOn !== null) window.TALK_ON = wasOn; leanStripTabs(); }catch(_){}
        return held;
      })();
      /* And with talk OFF, every door must still shut — the four buttons
         plus the one on Home. Same forced state as above. */
      out.talkDoorsShutWhenOff = (function(){
        var wasOn = (typeof TALK_ON !== 'undefined') ? TALK_ON : null;
        try{ if(wasOn !== null) window.TALK_ON = false; leanStripTabs(); }catch(_){}
        var n = Array.prototype.filter.call(document.querySelectorAll('button'), function(b){
          if(!/talk trash/i.test(b.textContent||'')) return false;
          var cs = getComputedStyle(b);
          return cs.display!=='none' && cs.visibility!=='hidden';
        }).length;
        try{ if(wasOn !== null) window.TALK_ON = wasOn; leanStripTabs(); }catch(_){}
        return n;
      })();
      navGo('stats'); out.screenAfterStats = S.screen;
      navGo('crew');  out.screenAfterTalk  = S.screen;
      navGo('board'); out.boardReachable   = S.screen==='board';
      return out;
    });
    check('lean.the-win-probability-is-gone', r.winprob===false,
      'win probability is still on the Gametime page',
      '89% DAL on a six-point game. It is ESPN\u2019s number, still weighted by the pregame line, and every player who read it trusted the app less');
    check('lean.the-sparkline-is-gone', r.spark===false,
      '"the night so far" is still rendering',
      'the biggest block on the page, a near-flat line with no axis, and the element that pushed the sticky header past its cap');
    check('lean.the-run-bar-is-gone', r.run===false,
      'the run bar is still rendering',
      'true, and it contradicted the win probability in the line directly above it');
    check('lean.the-deep-cut-is-gone', r.deepcut===false,
      'a deep cut is still on the page',
      'a stranger\u2019s season average, printed larger than the player\u2019s own card, three times in one scroll');
    check('lean.the-numbers-drawer-is-gone', r.drawer===false,
      '"the game, in numbers" is still there',
      'shot zones, assist networks, plus/minus and the line \u2014 five features behind one summary');
    check('lean.the-play-by-play-is-gone', r.feed===false,
      'the feed still has content',
      'the one thing ESPN does better than us, occupying more pixels than anything else');
    /* REVERSED ON GN8, 14 AUG, MID-GAME, BY DIRECT REQUEST. This used to
       assert ciWatch===false: Caught It was held back as a second scoring
       mechanic while the first one proved itself. Then the Control Room was
       found to be firing and resolving Call It questions correctly all
       along while the player app was simply not listening, and it was
       turned back on. startCallItWatch() says so in its own comment: the
       LEAN flag "no longer gates Caught It, only [Stats and Talk]".
       A check that guards a decision which has since been reversed is not
       a safety net, it is a false alarm that trains you to ignore the gate. */
    check('lean.caught-it-attaches-since-gn8', r.ciWatch===true,
      'startCallItWatch() did NOT attach under LEAN — Caught It was turned back on for GN8 and the player app must listen',
      'the Control Room fired and resolved Call It questions all through GN8 while the player app was not listening; that is the bug this now guards');
    check('lean.the-watchlist-is-empty-not-hidden', r.catches===0,
      `CATCHES still has ${r.catches} entries`,
      'a hidden card whose points still count toward MAXPTS is a wrong total, which is worse than leaving the card on');
    check('lean.the-talk-strip-survives-a-later-inline-write',
      r.talkSurvivesInlineWrite!==false,
      `revTalkBtn was re-shown by an inline display write (held=${r.talkSurvivesInlineWrite})`,
      'the strip uses .leanHidden with !important precisely because the review screen shows revTalkBtn again with its own inline style; drop the !important and the button comes back');
    /* REVERSED 28 AUG, and for the same reason the Caught It check above
       was reversed on GN8. This asserted talkButtonsVisible===0: talk was
       held back by LEAN and every door had to be shut. Then the founder,
       with three people in a live room and an empty leaderboard, asked
       for it back — and it turned out the room, the rules, the rate
       limits and the push had been built and unreachable the whole time.
       Nobody had ever sent a message on any night.

       The DECISION changed; the MECHANISM must not rot. So the check now
       asks the question that still has a right answer: with talk off,
       does every door still shut? A check guarding a reversed decision is
       a false alarm that trains you to ignore the gate. */
    check('lean.every-talk-door-shuts-when-talk-is-off',
      r.talkDoorsShutWhenOff===0,
      `${r.talkDoorsShutWhenOff} "Talk trash" button(s) still visible with TALK_ON=false`,
      'removing the tab does not remove Talk. There are five buttons that open it \u2014 review, Gametime, break, the FINAL screen and now Home \u2014 and the first version of LEAN shipped with all of them live. A player screenshot found it');
    check('lean.stats-is-reachable-and-lean-still-holds',
      r.statsBtn!=='none' && r.screenAfterStats==='stats'
      && r.winprob===false && r.deepcut===false && r.feed===false,
      `stats btn=${r.statsBtn}, navGo('stats') -> ${r.screenAfterStats}; gametime still shows winprob=${r.winprob} deepcut=${r.deepcut} feed=${r.feed}`,
      'STATS is deliberately outside LEAN. LEAN takes the deep cuts and the win probability off GAMETIME, where they competed with a twenty-second clock; STATS is where they live. Both halves of that have to be true at once or the strip means nothing');
    check('nav.talk-and-me-are-retired',
      r.talkBtn==='absent' && r.meBtn==='absent'
      && r.screenAfterTalk!=='crew',
      `talk=${r.talkBtn} me=${r.meBtn}, navGo('crew') landed on ${r.screenAfterTalk}`,
      'Me rendered the member card that already sits on Home, and Talk is a group chat competing with the group chat these people are already in. Both are out of the markup, not merely hidden');
    check('nav.four-tabs-gametime-in-the-middle',
      r.navCount===4,
      `${r.navCount} nav buttons in the row, want 4`,
      'Home \u00B7 STATS \u00B7 Gametime \u00B7 Board \u2014 an even row puts Gametime dead centre under the thumb, which is where the thing you tap forty times a night belongs');

    /* ---- AND THE GAME STILL RUNS -------------------------------------- */
    const g = await p.evaluate(async()=>{
      LEAN_ON = true;
      S.mode='live'; S.name='QA'; S.qi=0; S.nextQ=0; S.led={}; recomputeScore();
      __hostRound(0);
      navGo('gametime');
      const out={};
      out.startButton = /answer now/i.test(((document.getElementById('gtIdle')||{}).innerText)||'');
      startQuarter(0);
      await new Promise(x=>setTimeout(x,300));
      out.questionOpens = (document.getElementById('gtQuestion')||{}).style.display !== 'none';
      out.optionCount   = (document.querySelectorAll('#qOpts .opt')||[]).length;
      out.boardVisible  = !!document.querySelector('#gtHead .ascore');
      out.scoreShown    = /\d/.test(((document.getElementById('gtScoreA')||{}).textContent)||'');
      out.receiptExists = !!document.getElementById('subRcpt');
      return out;
    });
    check('lean.the-round-still-opens',
      g.startButton===true && g.questionOpens===true && g.optionCount>0,
      `button=${g.startButton} question=${g.questionOpens} options=${g.optionCount}`,
      'THE ONE THAT MATTERS. A strip that removes the ability to answer a quarter is the most expensive possible version of this idea');
    check('lean.the-score-still-shows',
      g.boardVisible===true && g.scoreShown===true,
      `board=${g.boardVisible} score=${g.scoreShown}`,
      'surface one of four');
    check('lean.the-receipt-still-exists', g.receiptExists===true,
      'the submit receipt element is missing under LEAN',
      'surface three of four, and the whole reason Friday is worth running');
    check('lean.no-errors', errs.length===0, `errors: ${errs.slice(0,3).join(' | ')}`,
      'a flag that throws while removing things is strictly worse than the things');
    await p.close();
  }

  /* ===================================================================
     THE STATS TAB

     Organised by moment rather than by category, because the old version
     was four panes of tables that competed with the thing the player was
     doing. One rule governs every card: it is a sentence you could text
     somebody. These checks hold that rule, hold the three phases apart,
     and hold the one thing that makes it distribution rather than a
     feature \u2014 every card copies itself as plain text.                */
  group('BROWSER — the STATS tab');
  {
    const {p, errs} = await newPage(VPS[0], F.LIVE);
    const r = await p.evaluate(async()=>{
      LEAN_ON = false;                    // the tab is dark under LEAN
      S.mode='live'; S.name='QA';
      const out = {};
      const paint = async()=>{ navGo('stats'); renderStats();
        await new Promise(x=>setTimeout(x,250));
        return (document.getElementById('stBody')||{}).innerText||''; };

      /* FORCE THE PHASE AT THE SOURCE. Setting GS.state is not enough —
         phaseNow() is the app's single answer to "where are we in this
         game" and it derives from more than one signal on purpose. The
         first version of this check set the field, got 'live' back, and
         then reported the live pane as a pre-tip failure. Override the
         one function the renderer actually asks. */
      const _realPhase = phaseNow;
      phaseNow = function(){ return 'pre'; };
      const pre = await paint();
      phaseNow = function(){ return 'live'; };
      /* NOT a regex for "two numbers with a dash". The storyline card
         legitimately quotes past results — "DAL 89-76" is exactly the kind
         of sentence this tab exists to print — and the first version of
         this check went red on its own content. What must not appear
         before tip is anything DERIVED FROM A GAME THAT HAS NOT STARTED. */
      out.preHasRun     = /scored \d+ in a row/i.test(pre);
      out.preHasZones   = /where the points/i.test(pre);
      out.preHasAssists = /who found who/i.test(pre);
      out.preHasOneThing= /the one thing/i.test(pre);

      // ---- DURING: the run is a SENTENCE, not a sparkline -------------
      const live = await paint();
      phaseNow = _realPhase;
      out.liveText = live.slice(0, 400);
      out.runIsASentence = typeof stBiggestRun === 'function';

      // ---- the copy contract ------------------------------------------
      out.copyButtons = document.querySelectorAll('#stBody [data-stcopy]').length;
      const ids = [].map.call(document.querySelectorAll('#stBody [data-stcopy]'),
                              b => b.getAttribute('data-stcopy'));
      out.everyButtonHasText = ids.length > 0 && ids.every(id => !!(STX[id] || '').trim());
      out.noMarkupInCopy = ids.every(id => !/[<>]/.test(STX[id] || ''));

      // ---- and there is exactly one scoreboard in this app ------------
      out.noSecondScoreboard = !document.querySelector('#s-stats .ascore');
      return out;
    });

    check('statstab.before-tip-invents-nothing',
      r.preHasRun === false && r.preHasZones === false
      && r.preHasAssists === false && r.preHasOneThing === false,
      `pre-tip showed run=${r.preHasRun} zones=${r.preHasZones} assists=${r.preHasAssists} oneThing=${r.preHasOneThing}`,
      'before tip there is nothing to report, and the app must not invent a shape for a game that has not happened');
    check('statstab.is-not-a-second-scoreboard',
      r.noSecondScoreboard === true,
      'the STATS tab is rendering its own scoreboard',
      'there is one score in this app and it lives on Gametime. A second one is how Game Night #7 put two different numbers on one screen');
    check('statstab.the-turn-is-a-sentence',
      r.runIsASentence === true,
      'stBiggestRun() is missing — the win-probability line has no sentence attached',
      '157 readings of a near-flat line with no axis told a player nothing. "Dallas scored 13 in a row in the 3rd" is the same data and is the whole point');
    /* REVERSED 15 AUG, FOUNDER'S CALL. This asserted copyButtons >= 1 — a
       stat worth reading is a stat worth pasting, and the tab spec called
       it the only growth mechanism that does not require sending an email.
       The founder removed it after seeing a grey Copy chip still sitting on
       the Tonight card after the final score. The argument for the share
       loop is on record in the spec and in the backlog; if it returns it
       should return as a deliberate share affordance, not a button on every
       card whether or not anyone wants one.

       Now guards the opposite, so the removal cannot silently come undone:
       no Copy chips on the STATS cards. The sibling check
       statstab.copied-text-is-plain still guards the payload of the share
       controls that remain on the final tally screen. */
    check('statstab.no-copy-chip-on-the-cards',
      r.copyButtons === 0,
      `${r.copyButtons} copy button(s) still on the STATS cards`,
      'the Copy chip was removed on 15 Aug — a grey button on every card, still there after the final score. See the backlog for the share-loop argument if it ever comes back');
    check('statstab.copied-text-is-plain',
      r.noMarkupInCopy === true,
      'a copy payload contains markup',
      'the drawn version and the copied version are separate on purpose \u2014 pasting "<b>Caitlin Clark</b>" into a group chat is worse than pasting nothing');
    check('statstab.no-errors', errs.length === 0,
      `errors: ${errs.slice(0,3).join(' | ')}`, '');
    await p.close();
  }

  /* ===================================================================
     ONE SEASON, ONE SOURCE  (`B10`)

     Caught on a real phone: one signed-in account showed 270 points on the
     final screen, 180 on the Board and 0 on the home member card, at the
     same moment. Three stores — stats_statline_v1, stats_season_v1 and
     S.seasonPts — each written by different code on a different trigger.
     Swapping the night config from #7 to #8 fired one trigger and not the
     others, and the three answers separated.                            */
  group('BROWSER — one season, one source');
  {
    const {p} = await newPage(VPS[0], F.LIVE);
    const r = await p.evaluate(async()=>{
      localStorage.removeItem('stats_statline_v1');
      localStorage.removeItem('stats_season_v1');
      /* Two banked nights in the statline. They carry `max`, because every
         row this product has ever written does — the ceiling is what turns
         a room's points into a night score, and 26 Aug is when the Board
         started reading it. */
      localStorage.setItem('stats_statline_v1', JSON.stringify({v:1, games:[
        {night:'gn7-2026-08-10-x', pts:180, max:1000, speed:20, hits:4, total:8, rank:1, awards:[]},
        {night:'gn8-2026-08-11-x', pts:90,  max:1000, speed:10, hits:2, total:8, rank:2, awards:[]}
      ]}));
      // …and one older night that only the retired store ever knew about
      localStorage.setItem('stats_season_v1', JSON.stringify({
        nights:{ 'gn6-2026-08-09-x':{pts:50, rank:3, at:1} }, total:50, played:1, best:50 }));
      const ss = seasonStats();
      // what the two member cards would print
      S.seasonPts = 0; S.streak = 0;      // the blob showFinal() clears
      let card=null, me=null;
      try{ renderPortal(); }catch(e){}
      try{ renderMe(); }catch(e){}
      const grab = id => { const e=document.getElementById(id); return e?e.innerText:''; };
      return { total:ss.total, played:ss.played, best:ss.best,
               portal:grab('portalCard') };
    });
    /* THIS CHECK USED TO ASSERT THE BUG. It wanted 320 \u2014 the RAW SUM of
       180+90+50 \u2014 which is the arithmetic that put 3455 TOTAL PTS over 18
       NIGHTS on the Board on 26 Aug, on a rule that caps a night at 100.
       Same three facts, judged by the rule the product actually agreed:
       180/1000 = 18, 90/1000 = 9, and a folded-in row with no recorded
       ceiling that still counts as a NIGHT. */
    check('season.one-total-from-the-per-night-rows',
      r.total===27 && r.played===3,
      `total=${r.total} (want 27: 18+9+an unscorable pre-rule night), nights=${r.played} (want 3)`,
      'the statline is the source and the retired store folds in \u2014 deleting it outright would silently shorten a season somebody earned');
    check('season.best-night-is-derived-too', r.best===18,
      `best=${r.best}, want 18`,
      'a third number that used to be stored separately and could disagree with the rows it summarised \u2014 and it has to be in the same unit as the total it sits beside');
    check('season.the-member-card-does-not-print-zero',
      !/\b0\s*SEASON/i.test(String(r.portal||'').replace(/\n/g,' ')),
      `member card read: ${String(r.portal||'').replace(/\n/g,' ').slice(0,140)}`,
      'it read S.seasonPts, which showFinal() clears \u2014 so it printed 0 SEASON PTS over a night that had just been played and banked');
    await p.close();
  }

  /* ===================================================================
     THE AUTONOMOUS HOST  (`B-55`)

     "We've tried a bunch of times with me pressing the quarter is open and
     then closing it. Our biggest problem is that it's not doing it
     automatically."

     The loop that fixes that is allowed to write to a live room, which
     makes it the most dangerous code in the Control Room. One rule matters
     more than every other behaviour here and it is the only thing these
     checks really guard: IT MAY NOT GUESS. A missing score is a bad night.
     A confidently wrong key, applied to everybody, with nobody in the room
     able to tell, is the end of the product.                            */
  group('BROWSER — the autonomous host');
  {
    const pg = await mkPage({width:1440,height:900});
    await pg.goto('file://'+path.join(ROOT,ADMIN),{waitUntil:'domcontentloaded'});
    await pg.waitForTimeout(900);
    const r = await pg.evaluate(()=>{
      const out = {};
      out.hasLoop   = typeof hostTick === 'function';
      out.hasSwitch = typeof hostToggle === 'function';
      out.startsOff = HOST.on === false;

      // The resolver contract: a round is all-or-nothing.
      const nd = { rounds:[ { qs:[
        {t:'a', o:['x','y'], r:'firstScoreKind'},
        {t:'b', o:['x','y'], r:'__nope__'}
      ] } ] };
      const realDraft = window.nightDraft;
      window.nightDraft = function(){ return nd; };
      const bad = hostResolveRound({}, 0);
      out.refusesPartial = !!(bad && bad.fail);
      out.wroteNothing   = nd.rounds[0].qs.every(q => q.k == null);

      // …and a fully marked round resolves without touching the feed
      nd.rounds[0].qs = [ {t:'a', o:['x','y'], k:1}, {t:'b', o:['p','q'], k:0} ];
      const good = hostResolveRound({}, 0);
      out.acceptsComplete = !!(good && !good.fail && good.marks.join(',') === '1,0');
      window.nightDraft = realDraft;

      // the log is the product — an autopilot you cannot watch is a coin flip
      HOST.log = [];
      hostSay('push','test');
      out.logs = HOST.log.length === 1;
      out.panel = !!document.getElementById('hostBody');
      return out;
    });

    check('host.the-loop-exists-and-starts-off',
      r.hasLoop && r.hasSwitch && r.startsOff,
      `loop=${r.hasLoop} switch=${r.hasSwitch} startsOff=${r.startsOff}`,
      'nothing in the Control Room may begin writing to a live room because a page loaded');
    check('host.it-will-not-post-a-partial-key',
      r.refusesPartial === true && r.wroteNothing === true,
      `refused=${r.refusesPartial}, left the draft untouched=${r.wroteNothing}`,
      'THE ONE THAT MATTERS. One unanswerable question hands the whole round back to a human. A key that is right about three questions and invented about the fourth scores every player wrong and looks marked while doing it');
    check('host.it-does-post-a-complete-one',
      r.acceptsComplete === true,
      'a fully marked round was refused',
      'a guard that never lets anything through is not a guard, it is the manual product with extra steps');
    check('host.the-server-runner-can-still-find-the-engine',
      (function(){
        const src = read(ADMIN);
        const a = src.indexOf('/* @host-shared:start');
        const b = src.indexOf('/* @host-shared:end */');
        if(a<0 || b<0 || b<=a) return false;
        const block = src.slice(a,b);
        /* Two rules for the shared block, both enforced here rather than
           discovered at 7:30 on a Friday: the runner evaluates it in Node,
           so it may not touch the DOM, and it must actually contain the
           resolver engine rather than having drifted to sentinels around
           nothing. */
        if(/\bdocument\.|\bwindow\.|localStorage/.test(block)) return false;
        return /var AUTO = \(function\(\)/.test(block) && /R\.firstScoreKind/.test(block);
      })(),
      'the @host-shared sentinels in admin.html are missing, empty, or the block now touches the DOM',
      'host/run.js slices admin.html between those markers and evaluates it, so there is ONE copy of the sixteen resolvers rather than a browser copy and a server copy that can answer the same question differently on the same night. If this check is red the runner will exit at startup rather than host a night with no answers in it — which is the correct failure, but a much worse place to find out');
    check('host.every-action-is-logged',
      r.logs === true && r.panel === true,
      `log captured=${r.logs}, panel present=${r.panel}`,
      'an autopilot you cannot watch either worked or did not, and you find out at the buzzer');

    /* ---- B11 -------------------------------------------------------
       bankRound() copied t, o and k out of the bank and dropped `r`. It
       cost nothing for months because only the ESPN panel used resolvers
       and it reads BANK directly. Then the plan started being published
       FROM THE DRAFT, all sixteen resolvers went missing, and the runner
       would have opened every round on Friday and stalled on all four
       while the Control Room reported "automated". */
    check('host.the-resolver-survives-the-copy-out-of-the-bank',
      (function(){
        const src = read(ADMIN);
        const m = src.match(/function bankRound\(id, i\)\{[\s\S]*?\n\}/);
        if(!m) return false;
        return /r:\s*String\(q\.r\s*\|\|\s*''\)/.test(m[0]);
      })(),
      'bankRound() is not carrying `r` through to the draft',
      'B11. The bank owns the resolver and the draft is a copy of the bank. A lossy copy means the published plan has no resolvers in it, and a runner with no resolvers hands every single round back to a human while looking automated');

    /* Recovery for drafts already seeded by the lossy version — and the
       part that actually matters is the text match. Falling back by index
       alone would attach question three's resolver to a question the host
       rewrote, and a resolver pointed at the wrong question produces a
       confidently wrong key, which is the one outcome this whole design
       is built to refuse. */
    check('host.a-rewritten-question-does-not-inherit-a-resolver',
      (function(){
        const src = read(ADMIN);
        const m = src.match(/function resolverFor\([\s\S]*?\n\}/);
        if(!m) return false;
        const f = m[0];
        return /BANK\[id\]/.test(f)
            && /String\(bq\.t\|\|''\)\.trim\(\)\s*!==\s*String\(\(q&&q\.t\)\|\|''\)\.trim\(\)/.test(f)
            && /return '';/.test(f);
      })(),
      'resolverFor() is missing, or recovers a resolver without checking the question text still matches',
      'B11. Position-only recovery is worse than no recovery: it silently attaches a resolver to a question the host edited, and the runner then posts a key that is confidently about the wrong thing');

    /* ---- B12 -------------------------------------------------------
       hostTick read `eventId`, declared inside the ESPN panel's IIFE a
       thousand lines below and invisible from the main script. Every tick
       threw before reaching the feed. hostStart had the same bug wrapped
       in a catch, so it silently never switched the live score on. */
    /* ---- one control, one job --------------------------------------
       The RUN tab used to offer the same action twice: a step card at the
       top that knows what round the game is up to, and four independent
       full-width red push buttons that do not. Two controls for one job on
       the busiest screen of the night, and the second one put "push Q3
       before Q1" a single tap away.

       Both halves are asserted, because deleting the out-of-order path
       would be a worse bug than the redundancy: a host does sometimes have
       to skip a quarter, and a night with no way to move on is a night
       that stops. */
    check('run.the-next-round-is-pushed-from-one-place',
      (function(){
        const src = read(ADMIN);
        const a = src.indexOf("if(state==='draft'){");
        const b = src.indexOf("}else if(state==='live'){", a);
        if(a < 0 || b <= a) return false;
        const card = src.slice(a, b);
        if(/Push \$\{tag\} to every phone/.test(card)) return false;   // the duplicate is back
        return /out of order/.test(card)                                // recovery survives
            && /confirm\(/.test(card)                                   // and is not one tap
            && /nextIdx/.test(card);                                    // and knows the sequence
      })(),
      'the round cards either render the old duplicate push button again, or have lost the out-of-order recovery path',
      'Two controls for one action is how a host pushes Q3 before Q1 at the exact moment they are least able to check. The step card owns the next round because it is the only thing that knows the order; the cards keep a quieter, confirmed path for the genuine case of deciding to skip a quarter');

    /* ---- B13 -------------------------------------------------------
       Both live-score writers must refuse to post before tip. The runner
       was fixed in the morning and the Control Room's ESPN panel was left
       with the identical line, which then posted "0 — 0 · Q1 in progress"
       into Game Night #8's room the day before the game.

       So this check asserts BOTH copies, deliberately. Checking only the
       one I happened to be looking at is how the bug survived. */
    check('score.neither-writer-posts-a-score-before-tip',
      (function(){
        const browser = read(ADMIN);
        const bi = browser.indexOf('ESPN.liveTick = async function');
        if(bi < 0) return false;
        /* READ THE WHOLE FUNCTION, NOT THE FIRST 3000 BYTES OF IT.
           This sliced a fixed window, and on 21 Aug the check went red
           while the guard it names was intact and working — liveTick had
           simply grown past the window as comments were added to it. That
           failure was the lucky direction. The same rot points the other
           way: had the guard been DELETED and something harmless moved
           into the first 3000 bytes, this check would have gone on passing
           and B13 would have shipped again. A check anchored to a byte
           count is not anchored to anything.

           So: cut at the next top-level `ESPN.` assignment, which is the
           real end of this function, and assert the ORDER as well as the
           presence — a guard that runs after the write is not a guard. */
        const after = browser.slice(bi);
        const endRel = after.indexOf('\n  ESPN.', 10);
        const tick = endRel > 0 ? after.slice(0, endRel) : after.slice(0, 8000);
        const gAt = tick.search(/if\(!label\)\{[\s\S]{0,400}?return;/);
        const wAt = tick.indexOf('writeScore(');
        const browserOk = /state==='in'/.test(tick)      // only a live game gets a label
                       && gAt >= 0                       // and no label means no write
                       && wAt >= 0 && gAt < wAt          // and the refusal comes FIRST
                       && /OT/.test(tick);               // overtime is named, not wrapped
        let runnerOk = false;
        try{
          const runner = require('fs').readFileSync('host/run.js', 'utf8');
          runnerOk = /if\(state !== 'in'\) return '';/.test(runner)
                  && /if\(!label\) return last;/.test(runner);
        }catch(_){ runnerOk = false; }
        return browserOk && runnerOk;
      })(),
      'one of the two live-score writers will post a score for a game that has not started',
      'B13. A 0 — 0 with "Q1 in progress" on every phone the day before tip is a lie the product tells unprompted, and it is the exact bug that survived being fixed once because only one of the two copies got the fix');

    /* ---- B15: one scorer, and the phone is not it ------------------ */
    check('score.the-arithmetic-is-shared-not-copied',
      (function(){
        const src = read(ADMIN);
        const a = src.indexOf('/* @host-shared:start');
        const b = src.indexOf('/* @host-shared:end */');
        if(a<0 || b<=a) return false;
        const block = src.slice(a,b);
        if(!/function tally\(scored, players, subs\)/.test(block)) return false;
        if(/\bdocument\.|\bwindow\.|localStorage|FB\./.test(block)) return false;  // must run in Node
        if(!/tally:tally/.test(block)) return false;                                    // and be exported
        const grade = src.match(/async function gradeAllScored\(\)[\s\S]*?\n\}/);
        if(!grade) return false;
        if(!/AUTO\.tally\(/.test(grade[0])) return false;   // the room uses the shared one
        let runner = '';
        try{ runner = require('fs').readFileSync('host/run.js','utf8'); }catch(_){ return false; }
        return /AUTO\.tally\(/.test(runner) && /async function scoreRoom/.test(runner);
      })(),
      'the Control Room and the runner are not both scoring through the shared AUTO.tally',
      'B15. Two scorers is Game Night #7\u2019s two-question-banks bug with a different name: the same night would score differently depending on which machine happened to be awake. Fetching and writing differ between the web SDK and the Admin SDK; the arithmetic must not');

    check('score.the-runner-scores-after-it-keys',
      (function(){
        let r=''; try{ r = require('fs').readFileSync('host/run.js','utf8'); }catch(_){ return false; }
        const keyed = /log\('key',[\s\S]{0,400}?scoreRoom\(/.test(r);
        const buzzer = /final scoring pass failed/.test(r);
        const guarded = /catch\(e\)\{ log\('err', 'scoring failed after/.test(r);
        return keyed && buzzer && guarded;
      })(),
      'the runner posts keys without turning them into scores, or a scoring failure can undo a posted key',
      'A fully automated night that opens every quarter, keys every question and leaves everyone on zero is automated in the half nobody can see. And scoring must never throw away a key that is already correct — hence the catch');

    /* ---- B16 -------------------------------------------------------
       The caught lane was missing from gradeAllScored for as long as it has
       existed. Nobody noticed because the phone was ALSO writing the total
       and its version had all four lanes. Stopping the phone from writing
       pts would have made an old, hidden bug into a visible one: every
       Caught It point in the room, gone, remembered only on the device that
       earned it.

       Found while working out the real prediction ceiling for a rules cap
       \u2014 not by a test. Hence this test. */
    /* ---- B17 -------------------------------------------------------
       The score lanes were named in three separate literal arrays — join
       restore, read-back, push. Adding caughtPts to one of them (which is
       exactly what I did) means a player who refreshes mid-game restores a
       local zero and writes it over their real points on the next push.
       Their own device deletes their score and says nothing.

       The list is a fact. It gets one home. */
    check('score.the-lanes-are-named-once',
      (function(){
        const src = read(PLAYER);
        if(!/var SCORE_LANES = \[/.test(src)) return false;
        /* No surviving literal array of lane names anywhere else. Matching
           on the two that always travel together is enough to catch a
           re-inlined copy without tripping over unrelated arrays. */
        /* Strip the declaration first — it IS a literal array of lane
           names, and the first version of this check counted it as a
           violation and went red on the file it was meant to bless. */
        const rest = src.replace(/var SCORE_LANES = \[[^\]]*\];/, '');
        const copies  = rest.match(/\[\s*'pts'\s*,\s*'speed'/g) || [];
        const copies2 = rest.match(/\[\s*"pts"\s*,\s*"speed"/g) || [];
        if(copies.length + copies2.length > 0) return false;
        const uses = (src.match(/SCORE_LANES\.forEach/g) || []).length;
        return uses >= 3;   // restore, read-back, push
      })(),
      'the score lanes are named in more than one place again, or a caller stopped using the shared list',
      'B17. Three copies of "which fields are the score" meant adding a lane to one of them silently zeroed it through the others. A player refreshing mid-game would have wiped their own Caught It points and been shown no error');

    check('score.every-lane-reaches-the-total',
      (function(){
        const admin = read(ADMIN);
        const player = read(PLAYER);
        const tallyFn = admin.match(/function tally\(scored, players, subs\)[\s\S]*?\n  \}/);
        if(!tallyFn) return false;
        const t = tallyFn[0];
        // all four lanes summed, and the caught lane actually read in
        if(!/t\.pts = t\.live \+ t\.predPts \+ t\.catchPts \+ t\.caughtPts/.test(t)) return false;
        if(!/caughtPts:/.test(t)) return false;
        // the room and the runner both hydrate it
        if(!/caughtPts:\(typeof d\.caughtPts==='number'\?d\.caughtPts:0\)/.test(admin)) return false;
        let runner=''; try{ runner = require('fs').readFileSync('host/run.js','utf8'); }catch(_){ return false; }
        if(!/caughtPts: typeof v\.caughtPts === 'number'/.test(runner)) return false;
        /* and the phone still reports the lane only it can know.
           Scoped to SB.push first: an unanchored search for setDoc(meRef,…)
           finds the JOIN write higher up the file and happily passes while
           the push itself is missing the lane. It did exactly that to me. */
        const fn = player.match(/SB\.push = async function[\s\S]*?\n  \};/);
        if(!fn) return false;
        const push = fn[0].match(/F\.setDoc\((?:meRef|myRef\(\)), \{[\s\S]*?\}, \{ merge: true \}\)/);
        return !!push && /caughtPts: mine\.caughtPts/.test(push[0]);
      })(),
      'the caught lane is missing from the scored total, or the phone is no longer reporting it',
      'B16. Caught It is resolved on the device, so if the phone does not send it and the tally does not add it, the points exist only on the player\u2019s own screen and the room disagrees with them all night. That is the exact complaint this whole rebuild started from');

    check('score.the-phone-does-not-report-its-own-total',
      (function(){
        const src = read(PLAYER);
        const m = src.match(/SB\.push = async function[\s\S]*?\n  \};/);
        if(!m) return false;
        const body = m[0];
        const write = body.match(/F\.setDoc\((?:meRef|myRef\(\)), \{[\s\S]*?\}, \{ merge: true \}\)/);
        if(!write) return false;
        const w = write[0];
        if(/\bpts:/.test(w) || /\bspeed:/.test(w) || /roundsDone:/.test(w)) return false;
        return /predPts:/.test(w) && /catchPts:/.test(w);
      })(),
      'the player app is still pushing pts / speed / roundsDone from the device',
      'B15. Those three are graded from the submissions by the Control Room and the runner. A phone that reports its own total is a phone that can be told to report any total from a console. predPts and catchPts stay client-reported because only the phone can know them \u2014 they are bounded in the rules instead, which is a smaller hole and not no hole. NOTE 21 Aug: caughtPts is no longer in that category. The runner now recomputes it server-side from nights/{id}/callit picks (AUTO.CI.caughtFor), so the phone value is a preview and the server figure overwrites it. The phone still SENDS it, which is what this check asserts, and that is deliberate \u2014 it is what the player sees before the next scoring pass lands');

    check('host.the-autopilot-does-not-borrow-another-scope',
      (function(){
        const src = read(ADMIN);
        /* Scoped to the autopilot block rather than the whole main script,
           and that narrowing is the second thing this check taught me. The
           first version scanned everything above the ESPN IIFE and tried to
           strip string literals so it would not trip over the words "on
           ESPN." in a toast — but this is an HTML file, JS string rules
           applied to English prose ate two thirds of it on an apostrophe,
           and the check went red on a file that was correct.

           Guard the code that had the bug. */
        const a = src.indexOf('var HOST = {');
        const b = src.indexOf('function renderHost(');
        if(a < 0 || b <= a) return false;
        const block = src.slice(a, b)
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
          .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
          .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
        if(/(^|[^.\w])eventId\b/.test(block)) return false;   // another scope's variable
        if(/(^|[^.\w])ESPN\s*\./.test(block)) return false;   // another scope's object
        return /HOST\.event/.test(block) && /window\.STATS_ESPN/.test(block);
      })(),
      'the main script references `eventId` or bare `ESPN.` — both live inside the ESPN panel IIFE and are undefined from there',
      'B12. This is not a subtle failure mode: the autopilot threw ReferenceError on every 20-second tick and had never once fetched a feed, while the panel above it said it was watching. The same line inside hostStart was wrapped in a catch, so it failed in total silence for a whole build. HOST owns its own event id, seeded from the night config that owns the mapping');

    await pg.close();
  }

  /* ===================================================================
     THE CONTROL ROOM CLOCK  (`B9`)

     Found by replaying Game Night #7's finished game against the answer
     keys the host actually posted — fourteen agreements, one silence and
     one flat disagreement. The disagreement was real and the robot was
     wrong: it said the last two minutes had more field-goal attempts than
     free throws, when the truth was 6 free throws to 4.

     ESPN sends `mm:ss` for most of a period, then drops the minutes inside
     the final minute and sends a bare decimal — "50.1", "25.7". clockSec()
     only matched `mm:ss` and returned null for the rest, and every caller
     filters on `s !== null && s <= 120`, so null did not mean "unknown", it
     meant EXCLUDED. The one stretch of a basketball game that is almost
     entirely free throws was the exact stretch being deleted.            */
  group('BROWSER — the Control Room clock');
  {
    const pg = await mkPage({width:1440,height:900});
    await pg.goto('file://'+path.join(ROOT,ADMIN),{waitUntil:'domcontentloaded'});
    await pg.waitForTimeout(900);
    const r = await pg.evaluate(()=>{
      const c = v => AUTO.clockSec({clock:{displayValue:v}});
      return { mmss:c('1:36'), tens:c('10:00'), sub:c('50.1'), sub2:c('25.7'),
               whole:c('9'), junk:c('End of Game'), empty:c('') };
    });
    check('crclock.reads-minutes-and-seconds',
      r.mmss===96 && r.tens===600,
      `"1:36" -> ${r.mmss} (want 96), "10:00" -> ${r.tens} (want 600)`,
      'the format it always handled');
    check('crclock.reads-the-final-minute',
      r.sub===50 && r.sub2===26 && r.whole===9,
      `"50.1" -> ${r.sub} (want 50), "25.7" -> ${r.sub2} (want 26), "9" -> ${r.whole} (want 9)`,
      'THE BUG. Returning null here did not mean "unknown" to any caller \u2014 it meant excluded, so every clock-filtered question silently lost the last sixty seconds');
    check('crclock.still-refuses-nonsense',
      r.junk===null && r.empty===null,
      `"End of Game" -> ${r.junk}, "" -> ${r.empty}; both must be null`,
      'widening a parser must not make it credulous \u2014 a resolver that reads "End of Game" as a time is worse than one that skips it');
    await pg.close();
  }

  /* The word "catch" belongs to exactly one mechanic. */
  group('BROWSER — one word, one meaning');
  {
    const src=read(PLAYER);
    const body=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/<!--[\s\S]*?-->/g,'');
    check('watchlist.soccer-catches-were-renamed',
      !/live catches|Live catches/i.test(body) && /watchlist/i.test(body),
      'soccer\'s pre-set picks are still called "catches"',
      'Caught It is the 20-second mechanic. Two different things cannot both be catches — the score noun stops meaning anything');
  }

  /* Two navy teams on one scoreboard is one team. */
  group('BROWSER — team colour');
  {
    const {p,errs}=await newPage({width:390,height:800},F.LIVE);
    const col=await p.evaluate(async()=>{
      await loadGameStats(true);
      const cs=getComputedStyle(document.documentElement);
      const away=cs.getPropertyValue('--away').trim(), home=cs.getPropertyValue('--home').trim();
      return {away, home, split:!!GS.colourSplit, tooClose:tcTooClose(away,home)};
    });
    check('colour.two-teams-are-distinguishable', col.tooClose===false,
      `away ${col.away} vs home ${col.home} are too close (split applied: ${col.split})`,
      'Toronto #33476D against Dallas #002b5c: the guard only ever compared a colour to the background, so both read as the same navy and the run bar stopped saying anything');
    check('colour.no-errors', errs.length===0, `errors: ${errs.slice(0,2).join(' | ')}`, 'colour maths must never throw');
    await p.close();
  }

  /* ===================================================================
     WHAT A REAL PHONE FOUND

     Every check in this group is a defect that survived 360 automated
     checks and was caught by a person holding an iPhone. They are here so
     they cannot come back, and they are grouped together as a reminder
     that the suite is not the same thing as a hand.
     =================================================================== */
  group('BROWSER — found on a phone');
  {
    const src=read(PLAYER);
    check('phone.sticky-does-not-eat-the-page',
      /body\.qopen #gtSticky\{position:static/.test(src) && /max-height:42dvh/.test(src),
      'the sticky block can still grow to cover the screen',
      'with the question inside it the sticky region hit ~600px on an 852px phone; everything below slid underneath it and the page could not be scrolled to the end');
    check('phone.practice-has-its-own-board',
      /A PRACTICE RUN IS NOT A COUNTDOWN/.test(src) && /PRACTICE · /.test(src),
      'a practice run still renders the real countdown at the top',
      'pressing Practice ten hours early put a rehearsal question under a board reading "10h 42m UNTIL TIP"');
    check('phone.callit-asks-about-a-game',
      /function ciPastBank/.test(src) && !/Which defense gives up fewer points a night/.test(src),
      'the pre-tip Call It bank is still season-average trivia',
      'a season average is a lookup: you either happen to know it or you guess, and either way you watched nothing');
    check('phone.callit-waits-for-the-clock-not-the-screen',
      /if\(scr==='live' && !S\.answered\) return false;/.test(src)
        && !/var CI_BLOCKED=\['live'/.test(src),
      'Call It is still banned by screen name rather than by whether a clock is running',
      'on one page the two questions share a scroll — the thing to protect is the 20 seconds, not the section');

    const {p,errs}=await newPage({width:393,height:852},F.PRE);
    const bug=await p.evaluate(async()=>{
      await loadGameStats(true);
      startDemo(); S.name='QA';
      try{ lockPredictions(); }catch(e){}
      startQuarter(0);
      await new Promise(r=>setTimeout(r,350));
      /* SCROLL, THEN WAIT FOR THE PAGE TO STOP GROWING, THEN SCROLL AGAIN.
         This was scroll -> sleep 250ms -> measure, and it went red roughly
         one run in four while passing on untouched HEAD — a flake, which
         costs a gate more than a steady failure does, because people learn
         to re-run it. The cause is ordinary: blocks on this screen render
         after the first paint, so scrollHeight grows AFTER the scroll and
         the 4px tolerance is measured against a target that has moved. The
         same lesson is already written into the feed group above — wait for
         the condition, not the clock. Settle the height first (up to ~2s),
         then scroll to the real bottom and measure that. */
      const settle=async()=>{
        let last=-1, stable=0;
        for(let i=0;i<40 && stable<3;i++){
          const h=document.documentElement.scrollHeight;
          stable = (h===last) ? stable+1 : 0;
          last=h;
          await new Promise(r=>setTimeout(r,50));
        }
      };
      /* AND THEN WAIT FOR THE CONDITION, NOT THE CLOCK — which is what the
         paragraph above says and what the line under it stopped doing. The
         settle only requires 150ms of stable height, so content arriving in
         bursts further apart than that slips through, and the fixed 120ms
         sleep after the scroll is one more window for the page to grow
         under the measurement. It went red in two gate runs out of five
         while passing 6/6 in isolation, which is the signature of a race
         and not a bug in the page.
         So: scroll, and keep re-scrolling until the page is actually at its
         own bottom, up to ~4s. Then measure. */
      window.scrollTo(0,999999);
      await settle();
      for(let i=0;i<40;i++){
        window.scrollTo(0, document.documentElement.scrollHeight);
        await new Promise(r=>setTimeout(r,100));
        const d=document.documentElement;
        if(Math.abs(d.scrollHeight-d.clientHeight-window.scrollY)<4) break;
      }
      const doc=document.documentElement;
      const gs=document.getElementById('gtSticky');
      // the LAST thing on the page must be reachable and not covered
      const feed=document.getElementById('gtFeed');
      const lastCard=feed && feed.lastElementChild ? feed.lastElementChild.getBoundingClientRect() : null;
      const navTop=document.getElementById('botnav').getBoundingClientRect().top;
      const head=(document.getElementById('gtHead').innerText||'');
      return { stickyPos:getComputedStyle(gs).position,
               atBottom:(Math.abs(doc.scrollHeight-doc.clientHeight-window.scrollY)<4),
               lastVisible: lastCard ? Math.round(lastCard.bottom) <= Math.round(navTop)+2 : null,
               practiceBoard:/PRACTICE/.test(head), countdown:/UNTIL TIP/.test(head),
               past:(function(){ try{ return ciPastBank().length; }catch(e){ return -1; } })() };
    });
    check('phone.page-scrolls-to-the-end', bug.atBottom===true && bug.lastVisible!==false,
      `bottom reachable=${bug.atBottom}, last item clear of the nav=${bug.lastVisible} (sticky=${bug.stickyPos})`,
      '"the practice questions are overlapping at the bottom, you can\'t scroll down all the way"');
    check('phone.practice-board-not-a-countdown', bug.practiceBoard===true && bug.countdown===false,
      `practice board=${bug.practiceBoard}, countdown showing=${bug.countdown}`,
      'a rehearsal under a countdown to a game that has not started');
    check('phone.pre-tip-questions-are-about-real-games', bug.past>=3,
      `only ${bug.past} questions about games that actually happened`,
      'the season series and last-five feeds were in the payload all along and were being thrown away');
    check('phone.no-errors', errs.length===0, `errors: ${errs.slice(0,2).join(' | ')}`, 'these paths run on every practice run');
    await p.close();
  }

  group('BROWSER — round three of the phone test');
  {
    const src=read(PLAYER);
    check('phone.the-rename-actually-happened',
      !/Call It|CALL IT|Call it/.test(src) && /Caught It/.test(src),
      'the feature is still called Call It somewhere in the file',
      '"It\'s still call it." A rename that leaves the old name on the card is not a rename');
    check('phone.no-install-nag-in-the-lobby',
      !/id="a2hs"/.test(src),
      'the "put STATS on your home screen" card is still there',
      'it asked for an install on the screen where somebody was waiting to play, every single night');
    check('phone.rail-reserves-its-real-height',
      /body\.hasrail\{padding-top:calc\(38px \+ env\(safe-area-inset-top/.test(src),
      'the rail offset is still a flat 38px',
      'the rail includes safe-area padding, so on a notched phone it sat on top of the first card');

    /* YOUR CARD before tip has to show an OPPONENT, not just your picks. */
    const {p,errs}=await newPage({width:393,height:852},F.PRE);
    const card=await p.evaluate(async(PK)=>{
      S.mode='live'; S.name='QA'; S.predChoices=PK;
      await loadGameStats(true);
      /* THE FIELD IS THE TWO ROSTERS. Seed the season table with the
         player the card picked AND a team-mate who is better at it, so
         the pane has a real in-game rival to name. A league-wide leader
         who is not playing tonight is the exact thing this check now
         exists to keep out. */
      SEA.by={}; SEA.ok=true;
      const rival=BB_ROSTER.home[0]===PK.pts ? BB_ROSTER.home[1] : BB_ROSTER.home[0];
      [[PK.pts,{pts:12.4}],[PK.reb,{reb:4.1}],[PK.ast,{ast:2.2}],[PK.stl,{stl:0.4}],[PK.blk,{blk:0.1}],
       [rival,{pts:24.9,reb:11.8,ast:7.4,stl:2.3,blk:2.6}]]
        .forEach(([n,v])=>{ SEA.by[String(n).toLowerCase()]=Object.assign({name:n},v); });
      STAB='you'; navGo('stats'); renderStats();
      await new Promise(r=>setTimeout(r,300));
      const t=document.getElementById('s-stats').innerText||'';
      const inField=[].concat(BB_ROSTER.home,BB_ROSTER.away);
      return { rows:document.querySelectorAll('#s-stats .stPickRow2').length,
               hasLeaderCol:new RegExp('best tonight: '+rival).test(t),
               rivalIsInThisGame:inField.indexOf(rival)>=0,
               hasGapSentence:new RegExp('behind '+rival).test(t),
               hasRace:document.querySelectorAll('#s-stats .stRace').length,
               /* HOW MANY ROWS THERE SHOULD BE IS THE CONFIG'S BUSINESS,
                  NOT THIS TEST'S. It was hardcoded to 4 and went red the
                  moment the sheet was cut from six picks to three - the same
                  class of failure as the hardcoded tip time. Count the stat
                  picks the build actually defines. */
               wantRows: preds.filter(function(x){ return x.id!=='winner'; }).length,
               twoCards:/WHAT YOUR PICKS AVERAGE/i.test(t) };
    }, PICKS());
    check('phone.your-card-shows-who-you-have-to-beat',
      card.rows>=card.wantRows && card.hasLeaderCol===true
      && card.hasRace>=card.wantRows && card.twoCards===false,
      `rows=${card.rows} (want ${card.wantRows}), rival=${card.hasLeaderCol}, bars=${card.hasRace}, twoCards=${card.twoCards}`,
      '"before you would have your score next to the actual stat leader" — a number with nothing to beat is a receipt, not a race');
    check('phone.the-rival-is-playing-tonight', card.rivalIsInThisGame===true,
      'the player named as the one to beat is not in tonight\'s game',
      '"it shows the league leader, it should be who is the leader in the game" — being told you are 1.6 blocks behind somebody who is not on the floor is true and useless');
    check('phone.your-card-says-what-has-to-change', card.hasGapSentence===true,
      'no gap sentence under the bar',
      'the one line that tells you what to watch for');
    check('phone.round3.no-errors', errs.length===0, `errors: ${errs.slice(0,2).join(' | ')}`,
      'this pane runs before every tip-off');
    await p.close();
  }

  group('BROWSER — round four of the phone test');
  {
    const src=read(PLAYER);
    check('phone.no-lifeline-button', !/onclick="useLifeline\(\)"/.test(src),
      'the lifeline button is still under every question',
      '"nobody uses it" — six nights, a handful of firings, and a permanent control under every single question');
    check('phone.no-emoji-in-question-text',
      !/\{t:"[^"]*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(src),
      'a question still opens with an emoji',
      'the dart was there to flag the best question to ME and shipped to the player as a red blob mid-sentence');
    /* Rewritten to test the ORDER rather than the exact first characters of
       the function. The original pinned `startQuarter(qi){ try{ ciStash()`
       as a literal, so adding a pre-tip guard in front of it turned the
       check red while the behaviour was untouched — a test that fails on
       formatting is a test that trains you to ignore it. What must be true
       is that the card is stashed BEFORE the question is put on screen. */
    const sq = (src.match(/function startQuarter\(qi\)\{[\s\S]*?\n\}/) || [''])[0];
    check('phone.a-question-clears-the-caught-it-card',
      /function ciStash/.test(src) && !!sq
        && sq.indexOf('ciStash()') >= 0
        && sq.indexOf('ciStash()') < sq.indexOf("go('live')"),
      'nothing hides an already-open Caught It card before a quarter question opens',
      'ciScreenOk stops a NEW card; it does nothing about one already pinned over the thing you are being timed on');
    check('phone.menu-exists', /id="menuBtn"/.test(src) && /function openMenu/.test(src)
        && !/class="fmore"/.test(src),
      'there is no menu, or the final screen still stacks the extras',
      'seven things nobody needs during a game, stacked at the bottom of the two screens where attention is scarcest');
    check('phone.home-explains-the-game-once',
      (src.match(/class="step"/g)||[]).length===0,
      'the three-step card is still on the home page',
      'the page explained the game three times before a stranger could reach anything they could do');

    const {p,errs}=await newPage({width:393,height:852},F.PRE);
    const m=await p.evaluate(async()=>{
      go('landing');
      const btn=document.getElementById('menuBtn');
      const shown=btn && btn.classList.contains('show');
      openMenu();
      await new Promise(r=>setTimeout(r,150));
      const sheet=document.getElementById('menuSheet');
      const open=sheet.classList.contains('open');
      const rows=[...sheet.querySelectorAll('.mrow')].map(b=>b.getAttribute('data-m'));
      closeMenu();
      await new Promise(r=>setTimeout(r,120));
      /* and it must get out of the way of a running clock */
      startDemo(); try{ lockPredictions(); }catch(e){}
      startQuarter(0);
      await new Promise(r=>setTimeout(r,200));
      const hiddenInPlay=!document.getElementById('menuBtn').classList.contains('show');
      const ciHidden=(document.getElementById('ciCard')||{style:{display:'none'}}).style.display==='none';
      return {shown, open, rows, closed:!sheet.classList.contains('open'), hiddenInPlay, ciHidden};
    });
    check('phone.menu-opens-and-closes', m.shown===true && m.open===true && m.closed===true && m.rows.length>=3,
      `button shown=${m.shown}, opened=${m.open}, closed=${m.closed}, rows=${(m.rows||[]).length}`,
      'a drawer for everything that is not "play tonight"');
    check('phone.menu-has-the-rules-and-the-account',
      (m.rows||[]).indexOf('rules')>=0 && (m.rows||[]).indexOf('me')>=0 && (m.rows||[]).indexOf('join')>=0,
      `rows were ${(m.rows||[]).join(', ')}`,
      'the rules, your season and the mailing list have to be findable somewhere, and this is the somewhere');
    check('phone.menu-advertises-nothing-that-does-not-exist',
      (m.rows||[]).indexOf('plus')<0 && (m.rows||[]).indexOf('league')<0,
      `rows were ${(m.rows||[]).join(', ')}`,
      'Leagues and STATS+ were two "coming soon" rows with no code behind them. A menu that lists things that do not exist next to things that do teaches a player to distrust the whole list');
    check('phone.menu-yields-to-a-question', m.hiddenInPlay===true,
      'the menu button is still up during a live question',
      'nothing in the corner of a twenty-second clock');
    check('phone.caught-it-is-stashed-by-a-question', m.ciHidden===true,
      'a Caught It card was still on screen once the quarter question opened',
      'this is the bug: it lands directly on top of the thing you are being timed on');
    check('phone.round4.no-errors', errs.length===0, `errors: ${errs.slice(0,2).join(' | ')}`, 'these run on every game night');
    await p.close();
  }

  group('BROWSER — feed states');
  /* ONE CRASH USED TO COST EVERY REMAINING CHECK.
     browserTests() was one long function inside a single try/catch at the
     call site, so the first throw anywhere aborted the rest of the browser
     layer and reported it as the single failure "the browser suite crashed".
     In the run that exposed this, the `pre` pass completed and then `live`
     and `down` never ran at all — losing stats.renders.live,
     callit.quarter-questions, stats.feed-down-degrades and the retry-storm
     guard, silently, behind one red line. Lost coverage that reads as one
     failure is worse than a failure, because the gate looks 99% green while
     a whole feed state went unexercised. A crash now costs its own
     iteration and says so. */
  const FEEDS=[['pre',F.PRE],['live',F.LIVE],['down','down']];
  const RETRIED=new Set();
  for(let fi=0; fi<FEEDS.length; fi++){
   const [name,feed]=FEEDS[fi];
   try{
    await forceRecycle();
    await withTimeout((async()=>{
    const {p,errs}=await newPage({width:390,height:800},feed);
    await p.evaluate(()=>{ startDemo(); S.name='QA'; navGo('stats'); });
    /* WAIT FOR THE CONDITION, NOT THE CLOCK. This was a fixed 2.5s sleep,
       which on a loaded machine sometimes landed while the feed was still
       on its first retry — so the suite failed for a reason that had
       nothing to do with the code. A gate that fails at random is worse
       than no gate: people start re-running it until it passes, which is
       the same as not having one. */
    if(feed==='down'){
      /* ============ "UNREACHABLE" NOW MEANS BOTH ROUTES ===============
         The app gained a second source on 20 Aug: when the phone cannot
         reach ESPN it reads the copy the runner publishes to our own
         database, because tracking protection, an ad blocker or a VPN
         silently empties every stat and chart otherwise.

         That is the right behaviour and it made this check fail, correctly:
         blocking ESPN alone no longer leaves the tab with nothing to show.
         But the thing being asserted still matters — when there is genuinely
         nothing to show, the tab must SAY SO rather than invent a number.

         So the scenario blocks both routes. Stubbing the fallback is the
         honest way to test "nothing is reachable" now that there are two
         ways to reach something. */
      /* ============ WAIT LIKE A PLAYER WAITS, NOT LIKE A TEST =========
         This waited for GS.fails to reach 2 and only THEN rendered, which
         cannot happen: renderStats() is the thing that retries. It calls
         loadGameStats() unforced at the foot of its own failure branch, so
         with nothing on screen nothing retries, fails sits at 1, the wait
         times out and the tab is still honestly saying "Pulling the
         numbers…" because one failure is not yet a dead feed.

         That is the app behaving correctly and the test asking the wrong
         question. A player does not stare at a variable; they sit on the
         screen while it re-renders. So: render, wait, render again, until
         the tab either admits it cannot reach the feed or the budget runs
         out. The assertion below is unchanged. */
      for(let i = 0; i < 14; i++){
        await p.evaluate(()=>{ try{ renderStats(); }catch(e){} });
        const said = await p.evaluate(()=>{
          const el = document.getElementById('stBody');
          return !!(el && /can.t reach|try again/i.test(el.innerText || ''));
        });
        if(said) break;
        await p.waitForTimeout(1000);
      }
    } else {
      await p.waitForFunction(()=>window.GS && GS.ok, null, {timeout:15000}).catch(()=>{});
      await p.waitForTimeout(400);
    }
    const st=await p.evaluate(()=>({txt:document.getElementById('stBody').innerText, ok:GS.ok, fails:GS.fails}));
    if(feed==='down'){
      /* ============ TWO HONEST OUTCOMES, ONE DISHONEST ONE ===========
         The app gained a second source on 20 Aug: when the phone cannot
         reach ESPN it reads the copy the runner publishes into our own
         database, because tracking protection, an ad blocker or a VPN
         otherwise empties every stat in the product with no explanation.

         So "ESPN is down" now has two correct endings, and the check has to
         allow both or it punishes the fix:

           · the fallback answered  -> show the real numbers it returned
           · nothing answered       -> say so, and offer Try again

         What is never acceptable is the third ending: a tab that sits on
         "Pulling the numbers…" forever, or renders empty, or invents a
         figure. That is what this asserts now. GS.via records which source
         replied, so the two endings are distinguishable rather than guessed
         at. */
      const via = await p.evaluate(()=>{ try{ return GS.via || ''; }catch(_){ return ''; } });
      const saidSo   = /can.t reach|try again/i.test(st.txt);
      const hasReal  = st.ok && st.txt.length > 120;
      check('stats.feed-down-degrades', saidSo || hasReal,
        `with ESPN unreachable the tab neither showed the fallback's numbers nor admitted it could ` +
        `not reach anything — GS.ok=${st.ok}, via="${via}", ${st.txt.length} chars on screen`,
        'the Stats tab must never invent a number, and must never sit on a spinner — it either ' +
        'shows what our own runner published or it says it cannot reach the feed');
      check('stats.feed-down-backs-off', st.fails<=4, `${st.fails} fetch attempts — retry storm`,
        'REGRESSION: a failed feed re-rendered and immediately refetched, hammering the radio');
    } else {
      check(`stats.renders.${name}`, st.ok && st.txt.length>120, 'stats tab rendered empty with a good feed',
        'the Stats tab is the product identity — an empty one is worse than none');
      const bank=await p.evaluate(()=>ciBank().map(q=>q.prompt));
      check(`callit.bank-nonempty.${name}`, bank.length>=4, `only ${bank.length} questions available`,
        'REGRESSION: practice fell back to "how many quarters in a game", which insults the player');
      /* ---- QUESTIONS MUST REWARD WATCHING --------------------------
         "We need questions of what happened earlier in the quarter."
         The old live bank asked about current state — who is ahead, who
         is top scorer — every one answerable by glancing at the score.
         A lookup is not a question: somebody who just walked in scores
         the same as somebody who watched the whole quarter. */
      if(name==='live'){
        const qtr=await p.evaluate(()=>{
          let b=[]; try{ b=ciQtrBank(); }catch(e){ return {err:e.message}; }
          const wrong=[];
          // Every generated question must carry an answer that is one of
          // its own options. A question that grades against nothing is
          // worse than no question.
          b.forEach(q=>{
            if(!q.answer) wrong.push(q.qid+':no answer');
            else if(!(q.options||[]).some(o=>String(o.v)===String(q.answer))) wrong.push(q.qid+':answer not an option');
            if((q.options||[]).length<2) wrong.push(q.qid+':fewer than two options');
            if(!q.resolveText) wrong.push(q.qid+':no explanation');
            const ks=(q.options||[]).map(o=>String(o.k));
            if(new Set(ks).size!==ks.length) wrong.push(q.qid+':duplicate option labels');
            /* NO TIES. "Who scored the most" with both names on 18 marks
               half the room wrong for being right. If the explanation
               names two equal numbers, the question should never have
               been asked. */
            const nums=String(q.resolveText||'').match(/\b(\d+)\b/g)||[];
            if(/most|more|leading|winning/i.test(q.prompt) && nums.length>=2
               && nums[0]===nums[1]) wrong.push(q.qid+':tied answer');
          });
          const lead=(typeof ciBank==='function') ? ciBank()[0] : null;
          return {n:b.length, wrong, prompts:b.map(q=>q.prompt).slice(0,3),
                  leadsWithQtr: !!lead && /^ciq-/.test(String(lead.qid||''))};
        });
        check('callit.quarter-questions', !qtr.err && (qtr.n||0)>=4,
          `only ${qtr.n} quarter-retrospective questions built${qtr.err?(' — threw: '+qtr.err):''}`,
          'a question you can answer by glancing at the scoreboard is a lookup, not a question');
        check('callit.questions-are-gradable', (qtr.wrong||[]).length===0,
          `malformed: ${(qtr.wrong||[]).slice(0,3).join(' | ')}`,
          'a generated question whose answer is not one of its own options grades everybody wrong');
        /* THE SAME AMBIGUITY RULE APPLIES TO THE QUESTIONS THE APP
           GENERATES ITSELF. These are graded automatically, so a vague
           one is worse than a vague hosted one — nobody is there to
           notice it and rule. */
        const vagueGen=await p.evaluate(()=>{
          const GAME_LEVEL=/lead change|change hands|first points|first basket|last basket|which team|which player/i;
          const COUNTS=/how many|more than|were there more|which was more/i;
          const SCOPED=/both teams combined|either team|each team|combined/i;
          let b=[]; try{ b=ciQtrBank(); }catch(e){ return ['threw: '+e.message]; }
          return b.filter(q=>COUNTS.test(q.prompt) && !SCOPED.test(q.prompt) && !GAME_LEVEL.test(q.prompt))
                  .map(q=>q.prompt);
        });
        check('callit.generated-questions-are-specific', vagueGen.length===0,
          vagueGen.join(' | '),
          'an auto-graded question that counts without saying whose marks people wrong with nobody there to argue it');

        check('callit.watching-questions-first', qtr.leadsWithQtr===true,
          'the bank still leads with a current-state lookup',
          'the questions that reward watching have to be the ones people actually get');
      }

      const generic=bank.filter(q=>/how many quarters|worth the most/i.test(q));
      check(`callit.bank-not-canned.${name}`, generic.length===0, `canned fallback leaked in: ${generic.join(' | ')}`,
        'the fallback exists for a dead feed only, never for a live one');
    }
    /* ---- THE STATS TAB IS FOUR PANES, NOT FIVE STACKED CARDS -------
       "We need each section smooth and not busy." The screen now shows
       one pane at a time behind a segmented control. Every pane must
       render, and no pane may throw — a stats product whose stats screen
       half-paints is worse than not having one. */
    if(feed!=='down'){
      const panes=await p.evaluate(async()=>{
        const seen={}, thrown=[];
        for(const t of ['a','b']){
          try{ renderStats(); }catch(e){ thrown.push(t+': '+e.message); }
          seen[t]=(document.getElementById('stBody').innerText||'').length;
        }
        return {seen, thrown};
      });
      /* THE SEGMENTED CONTROL IS GONE, AND THE CHECK GOES WITH IT.
         Four panes behind a segmented control was the right answer to
         "we need each section smooth and not busy" and the wrong answer
         to the real problem, which was never how the content was
         divided — it was that the whole tab competed with the thing the
         player was doing. STATS is one scroll now that changes with the
         phase of the game: before tip, during, after the buzzer. See the
         `statstab.*` group.

         What survives from this check, because it was the valuable half
         and is not about panes at all: the screen must not throw, and
         the deep cuts below must name real players. */
      check(`stats.paints-without-throwing.${name}`, panes.thrown.length===0,
        `renderStats threw: ${panes.thrown.join(' · ')}`,
        'a stats product whose stats screen half-paints is worse than not having one');
      check(`stats.says-something.${name}`,
        Object.values(panes.seen).some(n=>n>60),
        `content length by call ${JSON.stringify(panes.seen)}`,
        'an empty stats tab reads as a broken app, whatever it is divided into');

      /* Deep cuts must be TRUE. Every fact names a player, and every
         player named must be in tonight's box score — a stats product
         that invents a name is finished. */
      const cutCheck=await p.evaluate(()=>{
        let cuts=[]; try{ cuts=deepCuts(); }catch(e){ return {err:e.message}; }
        const names=Object.keys(GS.box);
        const teams=(GS.teams||[]).map(t=>t.ab);
        const bad=cuts.filter(c=>{
          const m=String(c.t).match(/<b>([^<]+)<\/b>/);
          if(!m) return false;
          const who=m[1].replace(/&#39;|&amp;/g,'');
          if(teams.indexOf(who)>=0) return false;
          if(/^\d/.test(who)) return false;          // "12 lead changes"
          if(/ by \d+$/.test(who)) return false;      // "ATL by 16"
          return !names.some(n=>n.replace(/'/g,'')===who.replace(/[’']/g,"'").replace(/'/g,''));
        }).map(c=>c.t);
        return {n:cuts.length, bad};
      });
      /* An UNQUALIFIED player has season averages but no league rank, and
         claiming one for her would be a lie. The copy must be able to say
         nothing rather than emit "· in the league in scoring". */
      const unranked=await p.evaluate(()=>{
        SEA.ok=true; SEA.n=128;
        SEA.by={}; Object.keys(GS.box).forEach(nm=>{
          SEA.by[nm.toLowerCase()]={name:nm, unranked:true, gp:21, pts:4.1, reb:3.0, ast:2.0, tpm:1.1, dd:2, fgp:41.0};
        });
        let cuts=[]; try{ cuts=deepCuts(); }catch(e){ return {err:e.message}; }
        // Leading whitespace counts: ord(undefined) leaves " in the league
        // in scoring", which starts with a space, not with the word.
        const dangling=cuts.filter(c=>/(^|[·,])\s*in the (league|WNBA)/.test(String(c.s||''))
                                    || /\bundefined\b/.test(String(c.s||'')+String(c.t||''))
                                    || /·\s*$/.test(String(c.s||'')));
        SEA.ok=false; SEA.by={};
        return {n:cuts.length, dangling:dangling.map(c=>c.s).slice(0,2)};
      });
      check(`stats.no-fake-ranks.${name}`, !unranked.err && (unranked.dangling||[]).length===0,
        `rank copy printed for an unranked player: ${(unranked.dangling||[]).join(' | ')}`,
        'the league table only covers qualified players — claiming a rank for anyone else is a lie, and a stats product does not get to make one');

      /* THE GAME LOG. Season highs, runs of games and head-to-head are the
         deepest thing the app claims, so they get the hardest test: a
         hand-built log with known answers, and a check that tonight's own
         game can never be counted as prior history. */
      const logs=await p.evaluate(()=>{
        const nm=Object.keys(GS.box)[0];
        if(!nm) return {skip:true};
        const g=(id,pts,reb,ast,tpm,opp)=>({id:String(id),date:'2026-0'+(1+(id%9))+'-01T00:00Z',
          opp:opp||'XXX',min:30,pts,reb,ast,stl:1,blk:0,tpm});
        // 6 prior games: 22,24,21,26,23 points (high 26) and 5 straight 20+
        LOG.by={}; LOG.by[nm]=[g(1,22,4,3,2),g(2,24,5,2,3),g(3,21,3,4,1),
                               g(4,26,6,2,2),g(5,23,4,3,4),
                               // tonight's own game, which must be excluded
                               {id:String(GAME.espnEvent),date:'2026-09-01T00Z',opp:'ZZZ',min:30,pts:99,reb:20,ast:9,stl:0,blk:0,tpm:9}];
        const near=logCuts(nm,{pts:24,reb:2,ast:2});   // 2 off the season high of 26
        const over=logCuts(nm,{pts:31,reb:2,ast:2});   // new season high
        LOG.by={};
        return {
          nm,
          nearTxt:near.map(c=>c.t).join(' || '),
          overTxt:over.map(c=>c.t).join(' || '),
          nearKinds:near.map(c=>c.kind), overKinds:over.map(c=>c.kind)
        };
      });
      if(!logs.skip){
        check(`log.season-high-watch.${name}`,
          logs.nearKinds.indexOf('highwatch')>=0 && /3 points from her season high of 26/.test(logs.nearTxt),
          `season-high watch wrong: ${logs.nearTxt}`,
          'a season high is the most watchable number there is — getting it wrong by one is worse than not showing it');
        check(`log.new-season-high.${name}`,
          logs.overKinds.indexOf('high')>=0 && /new season high/.test(logs.overTxt)
            && !/best before tonight was 99/.test(logs.overTxt),
          `new-high copy wrong: ${logs.overTxt}`,
          'tonight cannot be part of its own history — including it makes every season high unbeatable');
        check(`log.finds-a-run.${name}`,
          logs.nearKinds.indexOf('streak')>=0 && /5 straight games/.test(logs.nearTxt),
          `run of games not found: ${logs.nearTxt}`,
          '"20+ in five straight" is the kind of line a kid repeats at school — it has to be right');
      }

      check(`stats.deep-cuts-are-real.${name}`, !cutCheck.err && (cutCheck.bad||[]).length===0,
        `deep cuts named someone not in the box score: ${(cutCheck.bad||[]).slice(0,2).join(' | ')}${cutCheck.err?(' threw: '+cutCheck.err):''}`,
        'every line on the Deep Cuts pane is sourced from the feed — one invented name and the whole product loses its claim');
      if(name==='live')
        check('stats.deep-cuts-nonempty', (cutCheck.n||0)>=3,
          `only ${cutCheck.n} deep cuts from a live box score`,
          'a live game with a full box score must produce things no scoreboard shows');

      /* The practice button belongs on Me, not on a live play surface. */
      const practice=await p.evaluate(()=>{
        try{ navGo('gametime'); renderGametime(); }catch(e){}
        const gt=(document.getElementById('gtIdle')||{}).innerText||'';
        const st=(document.getElementById('stBody')||{}).innerText||'';
        try{ navGo('me'); }catch(e){}
        const me=(document.getElementById('meBody')||{}).innerText||'';
        return {onGametime:/practice call it/i.test(gt), onStats:/practice call it/i.test(st),
                onMe:/practice call it/i.test(me), meBtn:!!document.getElementById('meTry')};
      });
      check(`practice.off-play-surfaces.${name}`, !practice.onGametime && !practice.onStats,
        `practice button still on ${practice.onGametime?'Gametime':''}${practice.onStats?' Stats':''}`,
        'a grey practice button under a live scoreboard is noise at best and a misfire at worst');
    }

    if(feed===F.PRE){
      await p.evaluate(()=>{ navGo('stats'); }); await p.waitForTimeout(300);
      await p.evaluate(()=>startPredict()); await p.waitForTimeout(1600);
      const inj=await p.evaluate(()=>{const b=document.getElementById('inactiveBar');return b?b.innerText:'';});
      check('injuries.shown-on-deck', /not playing/i.test(inj), 'no injury bar above the pick deck',
        'REGRESSION: players were offered a pick who was ruled out hours earlier');
      /* Derive the ruled-out player from the deck the build actually
         renders. INACTIVE is populated from the FEED, and the feed here is
         a fixture whose injured players belong to a different matchup — so
         once the configured night changed, no rendered option was ever
         marked and this reported a missing OUT chip that renders fine. The
         feature under test is "an inactive player is marked in the deck",
         not "the fixture and the roster happen to overlap". */
      check('injuries.out-chip', await p.evaluate(()=>{
        PD.i=1; buildPred();
        var opt=document.querySelector('#predCard .pdopt[data-pd]');
        if(!opt) return false;
        INACTIVE=new Set([opt.getAttribute('data-pd')]);
        buildPred();
        var hit=/OUT/.test(document.getElementById('predCard').innerText);
        try{ INACTIVE=new Set(); buildPred(); }catch(e){}
        return hit;
      }),
        'no OUT flag inside the deck', 'the bar is easy to scroll past — the name itself has to be marked');
    }
    check(`feed.${name}.no-errors`, errs.length===0, `errors: ${errs.slice(0,2).join(' | ')}`, 'feed handling must never throw');
    try{ await p.close(); }catch(_){}
    })(), 180000, `the ${name} feed group`);
   }catch(e){
    const wedge = /exceeded \d+s/.test(String((e&&e.message)||e));
    if(wedge && !RETRIED.has(name)){
      /* ONE RETRY, IN A FRESH BROWSER. A wedged transport is a property of
         the process, not of the page, so recycling and re-running is the
         only thing that can distinguish "this machine hiccuped" from "this
         group cannot complete here". If the retry passes, the coverage is
         real and nobody had to be told to ignore a red. */
      RETRIED.add(name);
      console.log(`  \x1b[33m↻\x1b[0m the ${name} feed group wedged; recycling the browser and running it once more`);
      try{ await forceRecycle(); }catch(_){}
      FEEDS.push([name,feed]);
      continue;
    }
    if(wedge){
      wedged(`feed.${name}.wedged-on-this-machine`,
        `the ${name} feed group blocked past its budget twice, in two separate browsers`);
    }else{
      bad(`feed.${name}.group-crashed`, `the ${name} feed group threw: ${(e&&e.message)||e}`,
          'a group that dies takes its own checks with it and nothing else — every other feed state still runs');
      console.log('\x1b[31m    ── where ──\x1b[0m');
      console.log(String((e&&e.stack)||e).split('\n').slice(0,8).map(l=>'    '+l).join('\n'));
    }
   }
  }
  /* Teardown must not be able to fail the run. Every check has already been
     counted by the time we get here, so a throw while closing the browser
     turned a complete pass into "the browser suite crashed" — which reads
     as no coverage at all when the truth was full coverage and a messy
     exit. Failures belong to checks, not to cleanup. */
  try{ await b.close(); }catch(_){}
}

/* ========== 4. CONTROL ROOM ===========================================
   The dashboard has never been in this suite, and it is the one screen
   whose failure stops the whole room — the player app can be perfect and
   the night still dies if the host cannot reveal a quarter. These run
   against admin-test.html with Firebase absent, which is exactly the
   state the host sees before signing in, and is enough to exercise the
   button-state logic that has now frozen a night twice. */
function controlRoomStatic(){
  group('CONTROL ROOM — button state rules');
  const a=read(ADMIN);

  // Every disabled-looking control must actually look disabled.
  check('cr.disabled-is-visible', /button\.btn\.teal:disabled/.test(a),
    'a disabled .btn.teal keeps its bright background',
    'REGRESSION: the reveal button was disabled but rendered brightest on the page — the host pressed it and the night looked frozen');

  // The reveal button must not go dead just because the key is unmarked.
  const revealBlock=(a.match(/data-revealbtn','1'\);[\s\S]{0,1400}?b\.onclick[^\n]*/)||[''])[0];
  check('cr.reveal-not-dead', /b\.disabled\s*=\s*busy\s*;/.test(revealBlock),
    'the reveal button still disables itself on an unmarked answer key',
    'REGRESSION: a dead button with the reason in grey text above it is how "End Q1" got stuck');
  check('cr.reveal-explains', /jumpToKey\(i\)/.test(revealBlock),
    'pressing reveal with no key does not take the host anywhere',
    'a control that refuses must put you in front of the thing that unblocks it');

  // Two writers of the same state is how the freeze survived a repaint.
  const sync=(a.match(/function syncRevealState\(i\)\{[\s\S]*?\n\}/)||[''])[0];
  check('cr.one-disable-rule', !/btn\.disabled\s*=\s*!ready/.test(sync),
    'syncRevealState re-disables using the old rule and undoes the renderer',
    'REGRESSION: two places set the same button state with different rules, so tapping an answer re-froze it');
  check('cr.sync-restores-label', /data-readytext/.test(sync) && /data-readytext/.test(a),
    'the repaint cannot restore the ready label',
    'the button would keep saying "mark the answers" after they were all marked');

  // The navigator must exist and must not throw on a missing zone.
  check('cr.jump-exists', /function jumpToKey\(i\)\{/.test(a), 'jumpToKey is not defined',
    'the reveal button calls it — an undefined handler is a dead button again');
  check('cr.jump-guarded', /data-keyzone/.test(a) && /catch\(e\)\{ try\{ toast/.test(a),
    'jumpToKey has no fallback when the answers block is missing',
    'the host must get a message, never a silent no-op');


  group('CONTROL ROOM — the night must be finishable');
  const a2=read(ADMIN);

  /* THE DEADLOCK TEST. Reveal used to call roundIssues(), which includes
     "every answer marked". One unanswerable question and the quarter could
     never close; the next quarter cannot be pushed while one is live; so
     the night ended at Q1. Every game night so far died here. */
  const close=(a2.match(/async function closeQuarter\(i\)\{[\s\S]*?const canPush/)||[''])[0];
  check('cr.close-no-key-deadlock', /const iss = pushIssues\(i\);/.test(close) && !/const iss = roundIssues\(i\)/.test(close),
    'closeQuarter still hard-blocks on an unmarked answer',
    'REGRESSION: one unanswerable question deadlocked the whole night at the end of Q1');
  check('cr.close-voids-explicitly', /keyIssues\(i\)/.test(close) && /VOIDS/.test(close),
    'closing with a partial key does not warn that those questions void',
    'silently zeroing a question the host meant to answer is worse than refusing');

  const rev=(a2.match(/async function revealRound\(i, again\)\{[\s\S]*?const cfg = nightCfg/)||[''])[0];
  check('cr.reveal-no-key-deadlock', /const issues = pushIssues\(i\);/.test(rev) && !/roundIssues\(i\)/.test(rev),
    'revealRound still hard-blocks on an unmarked answer',
    'the escape hatch itself was gated by the thing it exists to escape');

  check('cr.escape-is-visible', /void the \$\{pr\.total-pr\.done\} unanswered/.test(a2),
    'the reveal-anyway button does not say what it will do',
    'an escape hatch nobody can find is not an escape hatch');

  /* Structural problems must STILL block — voiding a missing answer is
     fair, shipping a question with no text to two hundred phones is not. */
  check('cr.structure-still-blocks', /pushIssues\(i\)/.test(close),
    'closeQuarter no longer validates the round structurally',
    'loosening the answer gate must not loosen the "is this round shippable" gate');

  group('CONTROL ROOM — question bank');
  // Retrospective questions only — no predictive language left in the bank.
  /* ---- TONIGHT'S QUESTION SET ------------------------------------
     The house rules for a quarter question, enforced instead of trusted:
     it resolves, the host can settle it from the broadcast in seconds, it
     asserts nothing, and it is about the GAME rather than about one
     network's coverage of the game. That last one matters because the room
     is not all watching the same feed — somebody is on a Spanish call,
     somebody has the sound down in a bar, somebody is in the building. */
  {
    const bank=(a.match(/'gn6-2026-08-11-ny-ind':\s*\[[\s\S]*?\n  \],/)||[''])[0];
    const qs=[...bank.matchAll(/\{\s*t:\s*'((?:[^'\\]|\\.)*)'\s*,\s*o:\s*\[([^\]]*)\]/g)]
      .map(m=>({t:m[1], o:[...m[2].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(x=>x[1])}));
    const rounds=(bank.match(/\n    \[/g)||[]).length;
    check('qset.shape', rounds===4 && qs.length===16,
      `${rounds} rounds, ${qs.length} questions`,
      'four quarters, four questions each — the shape the scoring maths assumes');
    const thin=qs.filter(q=>q.o.length<2).map(q=>q.t);
    check('qset.every-question-has-choices', thin.length===0, thin.join(' | '),
      'a question with one option is a statement');
    const dupOpts=qs.filter(q=>new Set(q.o).size!==q.o.length).map(q=>q.t);
    check('qset.no-duplicate-options', dupOpts.length===0, dupOpts.join(' | '),
      'two identical options means one of them can never be right');
    const texts=qs.map(q=>q.t.replace(/[^a-z]/gi,'').toLowerCase());
    check('qset.no-repeats-across-the-night', new Set(texts).size===texts.length,
      'the same question is asked in two different quarters',
      'asking it twice tells the room we are not paying attention either');
    /* The banned register: anything that depends on a broadcast rather
       than on the game. We do not own the feed and the room is not all
       watching the same one. */
    const bad=qs.filter(q=>/announcer|commentator|graphic|replay|commercial|sideline|studio|halftime show|booth/i.test(q.t));
    check('qset.not-about-the-broadcast', bad.length===0, bad.map(q=>q.t).join(' | '),
      'a question keyed to one English-language feed quietly excludes part of the room');
    /* Team-name questions must use THIS night's nicknames — a leftover
       "Dream" or "Tempo" from the previous game is unanswerable. */
    const wrongTeam=qs.filter(q=>q.o.some(o=>/^(Dream|Tempo|Aces|Lynx|Sky|Storm|Wings)$/.test(o)));
    check('qset.right-teams', wrongTeam.length===0, wrongTeam.map(q=>q.t).join(' | '),
      'a question offering last week\'s teams cannot be answered by anybody');
    /* AMBIGUITY IS A SCORING BUG. "How many threes did BOTH teams make in
       Q1?" reads as the combined total or as how many each of them made.
       Two readings means two defensible answers, and marking one of them
       marks half the room wrong for being right — with nothing they can
       point at, because the question was never clear.

       So anything that counts or compares a team-or-player event has to
       say whose. The exemption list is short and deliberate: events that
       belong to the GAME rather than to a team need no scope, because
       there is nothing to be ambiguous between. */
    const GAME_LEVEL=/lead change|change hands|first points|first foul|last basket|final basket|last shot|halftime|buzzer|foul out|outscored/i;
    const COUNTS=/how many|were there more|which was more|which happened more/i;
    const SCOPED=/both teams combined|either team|each team|combined/i;
    const vague=qs.filter(q=>COUNTS.test(q.t) && !SCOPED.test(q.t) && !GAME_LEVEL.test(q.t)).map(q=>q.t);
    check('qset.no-ambiguous-scope', vague.length===0, vague.join(' | '),
      'a question that counts without saying whose has two right answers and one accepted one');
    // "BOTH teams" on its own is the exact phrasing that caused this.
    const bare=qs.filter(q=>/both teams/i.test(q.t) && !/both teams combined/i.test(q.t)).map(q=>q.t);
    check('qset.both-means-combined', bare.length===0, bare.join(' | '),
      '"both teams" alone still reads as "each of them" — the word "combined" is what removes the argument');

    /* NO EMOJI IN A QUESTION. The interface became one stroked icon set
       on the morning of Game #6, which left the question bank as the last
       place emoji survived — and a row of full-colour pictograms in front
       of the only words that carry the game read as leftovers from a
       different product. Four of these land on every phone every quarter,
       so it is the most-seen text we write. */
    const EMOJI=/[\u203C-\u3299\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u2600-\u27BF\uFE0F]/u;
    const withEmoji=qs.filter(q=>EMOJI.test(q.t)).map(q=>q.t.slice(0,40));
    check('qset.no-emoji-in-questions', withEmoji.length===0, withEmoji.join(' | '),
      'the question is the thing — it should not need a pictogram in front of it');
    /* A question you can answer off the scoreboard is not a question, it
       is a free ten points for the person who alt-tabbed. */
    const freebie=qs.filter(q=>/^who (was ahead|led) (at|when)/i.test(q.t)).map(q=>q.t);
    check('qset.no-scoreboard-freebies', freebie.length===0, freebie.join(' | '),
      'this game pays for paying attention; a question the scoreboard answers pays for nothing');

    /* ---- EVERY QUESTION MUST HAVE A GRADER --------------------------
       Rewriting the bank this morning orphaned ten of sixteen questions
       from the ESPN resolver, because questions were matched to graders by
       loose regex and the regexes were written against the OLD wording.
       Three of the six that still matched matched the wrong rule: "the
       team that led at halftime — did they win?" (Yes / No / tied) picked
       up the resolver for "who led at halftime", which answers with a
       TEAM. That writes a team index into a Yes/No question, at high
       confidence, with nothing on screen suggesting a second look.
       Nobody noticed because nothing checked. Now something does. */
    const qmapBlock=(a.match(/QMAP = \{\}[\s\S]*?\]\.forEach/)||[''])[0];
    const mapped=new Map([...qmapBlock.matchAll(/\[\s*'((?:[^'\\]|\\.)*)'\s*,\s*'([a-z0-9_]+)'\s*\]/g)]
      .map(m=>[m[1].replace(/[^a-z0-9]+/gi,'').toLowerCase(), m[2]]));
    const norm=t=>t.replace(/\\'/g,"'").replace(/[^a-z0-9]+/gi,'').toLowerCase();
    const unmapped=qs.filter(q=>!mapped.has(norm(q.t))).map(q=>q.t.slice(0,44));
    check('grade.every-question-has-a-grader', unmapped.length===0,
      `${unmapped.length} question(s) with no ESPN resolver: ${unmapped.join(' | ')}`,
      'REGRESSION: the Game #6 rewrite orphaned ten of sixteen questions and the host would have marked them all by hand');
    /* And every rule the map names has to actually exist, or the pull
       throws and silently degrades the whole quarter to manual. */
    const defined=new Set([...a.matchAll(/^\s{4}([a-z0-9_]+)\(s,o,T\)\s*\{/gm)].map(m=>m[1]));
    const ghosts=[...new Set([...mapped.values()])].filter(id=>!defined.has(id));
    check('grade.every-grader-exists', ghosts.length===0,
      `mapped to resolvers that are not defined: ${ghosts.join(', ')}`,
      'a map entry pointing at nothing is worse than no map entry — it looks handled');
    /* Exact text, not patterns. A question matched by shape can pick up
       another quarter's rule the moment somebody rewords it. */
    check('grade.matching-is-exact', /QMAP\[qnorm\(t\)\]/.test(a),
      'questions are still matched to graders by regex alone',
      'pattern-matching a question to a grader is how a Yes/No question got wired to a rule that answers with a team');
    /* An index outside the question's own options must never be written. */
    check('grade.refuses-out-of-range', /res\.index < q\.o\.length/.test(a),
      'the pull writes whatever index a rule returns',
      'findIndex returns -1 when it misses, and -1 as an answer key grades every player wrong while looking marked');

    // The shot-clock question is the best one we have ever asked. Keep it.
    check('qset.keeps-the-best-one', /24-second shot-clock violations/i.test(bank),
      'the shot-clock violation question is missing from the set',
      'nobody watches the shot clock; ask about it once and everybody watches it all night');
  }

  /* ---- A NEW QUESTION SET HAS TO REACH THE HOST -------------------
     The draft lives in the host's own localStorage and a round is seeded
     exactly once. So a set rewritten after they opened the Control Room
     never arrives: they see the old questions, conclude the change did
     not ship, and nothing on screen says otherwise. That happened. */
  check('cr.bank-drift-detected', /function bankDrift/.test(a) && /function qsig/.test(a),
    'nothing compares the seeded draft against the shipped bank',
    'a question set that cannot reach the host is a question set that did not ship');
  check('cr.untouched-rounds-self-update', /applyBankDrift\(id, false\)/.test(a),
    'an untouched round does not pick up a newer set on its own',
    'if the host has not typed a character there is nothing to protect — just update it');
  check('cr.edited-rounds-are-never-clobbered',
    /out\.fresh\.push\(i\)/.test(a) && /out\.edited\.push\(i\)/.test(a)
      && /applyBankDrift\(night, true\)/.test(a),
    'edited rounds are not separated from untouched ones',
    'silently overwriting work the host typed in a two-minute timeout is unforgivable; it has to be their button press');
  check('cr.drift-is-visible', /bankDriftBar/.test(a) && /reloadAllBank/.test(a),
    'no banner tells the host their questions are behind',
    'the original failure was silence, not the staleness');

  check('cr.no-predictive-callit', !/scores the NEXT bucket|Next field goal — deuce/.test(read(ADMIN)),
    'predictive Call It prompts are still in the Control Room',
    'a prediction is a coin flip and it cannot resolve until something else happens');
}

/* ========== RUN ======================================================= */
/* VOICE — static, therefore in --quick. These are reads of the source,
   not of a running page, and a three-second gate that covers them is a
   gate people actually run. */
/* THE BOARD — added after GN12, where the founder photographed a
   leaderboard putting 135 below 103. The arithmetic lives in
   qa/board-order.js against that night's real rows; these are the
   structural guarantees that keep the sort key and the printed number
   from drifting apart again. */
/* THE NIGHT CONFIG — added with B39. The arithmetic-free version of the
   bug: hydrateNight() named a league, so the schedule-in-the-database
   path only ever worked for the league it named. The real proof runs in
   a browser (qa/night-config.js) because a static read cannot tell you
   which object a const binding points at. These two keep the PROPERTY
   from being quietly reverted afterwards. */
/* THE SLATE. The behaviour is proved in a browser by qa/slate.js; these
   are the structural guarantees that keep it from being quietly undone. */
/* THE TEMPLATES — one bank per sport, and every claim in it checkable.
   The banks themselves are proved against finished games by
   qa/bank-shadow.js; these are the structural claims a shadow test cannot
   make, because a template that names a resolver which does not exist
   publishes happily and then voids every question at the buzzer. */
function templateStatic(){
  group('THE TEMPLATES — a bank per sport');
  const src=read(ADMIN);
  const grab=(open,name)=>{
    const i=src.indexOf(open); if(i<0) return null;
    let d=0,end=-1; const o=src.indexOf('{',i);
    for(let j=o;j<src.length;j++){const c=src[j]; if(c==='{')d++; else if(c==='}'){d--; if(!d){end=j+1;break;}}}
    try{ return require('vm').runInNewContext(src.slice(i,end)+';'+name+';',{},{timeout:5000}); }catch(_){ return null; }
  };
  const T=grab('const TEMPLATES = {','TEMPLATES');
  check('tmpl.evaluates', !!T && Object.keys(T).length>0,
    'TEMPLATES did not evaluate — publish.js reads it the same way and would die at the same point');
  if(!T) return;

  /* Every resolver a template names must exist in the R table. */
  const known=new Set([...src.matchAll(/\n  R\.(\w+)\s*=/g)].map(m=>m[1]));
  const missing=[];
  Object.keys(T).forEach(sp=>{
    (T[sp].rounds||[]).forEach((rd,i)=>rd.forEach((q,x)=>{
      if(q.r && !known.has(q.r)) missing.push(`${sp} ${T[sp].tags[i]}Q${x+1} -> ${q.r}`);
    }));
  });
  check('tmpl.every-resolver-exists', missing.length===0,
    `named but not defined: ${missing.join(', ')}`,
    'a bank naming a resolver that does not exist publishes fine and then voids every one of those questions at the buzzer, where nobody can fix it');

  /* tags / names / worth / rounds all describe the same rounds. B26's shape. */
  const ragged=[];
  Object.keys(T).forEach(sp=>{
    const t=T[sp], n=(t.rounds||[]).length;
    if((t.tags||[]).length!==n)  ragged.push(`${sp}: ${(t.tags||[]).length} tags vs ${n} rounds`);
    if((t.names||[]).length!==n) ragged.push(`${sp}: ${(t.names||[]).length} names vs ${n} rounds`);
    if((t.worth||[]).length!==n) ragged.push(`${sp}: ${(t.worth||[]).length} worths vs ${n} rounds`);
    if(t.periods && t.periods.length!==n) ragged.push(`${sp}: ${t.periods.length} periods vs ${n} rounds`);
  });
  check('tmpl.four-lists-one-set-of-rounds', ragged.length===0,
    ragged.join(' | '),
    'tags, names, worth and periods all describe the same rounds and must be edited together — B26 with a new name');

  /* A round with no questions is GN9's failure, pre-published. */
  const empty=[];
  Object.keys(T).forEach(sp=>(T[sp].rounds||[]).forEach((rd,i)=>{
    if(!rd.length) empty.push(`${sp} ${(T[sp].tags||[])[i]||i}`);
  }));
  check('tmpl.no-empty-rounds', empty.length===0, empty.join(', '),
    'B28. A round the runner opens and scores, with nothing in it to earn from, is worse than not opening it');

  /* Every option list a player will see must have something to choose. */
  const thin=[];
  Object.keys(T).forEach(sp=>(T[sp].rounds||[]).forEach((rd,i)=>rd.forEach((q,x)=>{
    if(!q.t || (q.o||[]).length<2) thin.push(`${sp} ${T[sp].tags[i]}Q${x+1}`);
  })));
  check('tmpl.every-question-is-answerable', thin.length===0, thin.join(', '),
    'a question with fewer than two options is not a question');

  /* Team tokens come in pairs. A round offering {HOME} and a real name is a
     question whose two sides were written at different times. */
  const lone=[];
  Object.keys(T).forEach(sp=>(T[sp].rounds||[]).forEach((rd,i)=>rd.forEach((q,x)=>{
    const j=(q.o||[]).join(' ');
    if(/\{HOME\}/.test(j) !== /\{AWAY\}/.test(j)) lone.push(`${sp} ${T[sp].tags[i]}Q${x+1}`);
  })));
  check('tmpl.team-tokens-come-in-pairs', lone.length===0, lone.join(', '),
    'one side tokenised and the other hard-coded means a real team name from some other night is sitting in an option');
}

/* THE DOOR — playing comes before signing in. The browser group already
   checks that practice OPENS the app; this checks the front door still
   OFFERS it first, which is a different claim and the one a redesign
   quietly reverses. */
function doorStatic(){
  group('THE DOOR — play first, account second');
  {
    const src=read(PLAYER);
    const card=(src.match(/<div class="card" id="portalCard"[\s\S]*?\n    <\/div>/)||[''])[0];
    check('door.the-card-still-exists', card.length>400,
      'portalCard could not be found — the order checks in the browser group depend on it');

    const play = card.indexOf('startDemo()');
    const gsi  = card.indexOf('portalGsi');
    check('door.playing-is-offered-before-signing-in',
      play > 0 && gsi > 0 && play < gsi,
      `practice at ${play}, sign-in at ${gsi}`,
      'a stranger sent a link met an account form before they had seen a single question. Playing costs nothing and goes first');

    /* The honest sentence. If sign-in ever gets sold as a benefit again
       rather than explained as a requirement, this is the line that went. */
    check('door.says-why-an-account-is-needed',
      /belong to somebody/i.test(card),
      'the door no longer explains that a seat and a score need an identity — it is not a toll and must not read like one');

    check('door.you-can-ask-for-a-heads-up-without-an-account',
      /id="notifyEmail"/.test(card) && /notifyOnly\(\)/.test(card),
      'the notify-me path is gone. The consent box only fires as a side effect of signing in, so without this somebody who tried the game and left has no way to hear about the next night');
  }
  {
    const src=read(PLAYER);
    const code=src.replace(/\/\*[\s\S]*?\*\//g,' ');
    const fn=(code.match(/function notifyOnly\(\)\{[\s\S]*?\n\}/)||[''])[0];
    check('door.notify-validates-before-it-writes',
      /\^\[\^@/.test(fn) && /SB\.signup/.test(fn),
      'notifyOnly no longer checks the address before writing — the rules would refuse it and the player would see a permission error they cannot read');
  }
}

function slateStatic(){
  group('THE SLATE — every game gets a room');
  {
    const src=read(PLAYER);
    const code=src.replace(/\/\*[\s\S]*?\*\//g,' ').replace(/(^|[^:])\/\/[^\n]*/g,'$1 ');
    /* A PICK OUTRANKS THE POINTER. schedule/current names the game we are
       PROMOTING; the pick names the game they are WATCHING, and only one of
       those two is in the room with them. If this order ever flips, a
       player who chose a game gets dragged back to the flagship on every
       boot — and would have no way to say so except "it keeps changing". */
    const load=(code.match(/async function loadNightConfig\(db, F\)\{[\s\S]*?\n\}/)||[''])[0];
    const pickAt=load.indexOf('slatePick()');
    const ptrAt =load.indexOf("'schedule','current'");
    check('slate.a-choice-is-read-before-the-pointer',
      pickAt>0 && ptrAt>0 && pickAt<ptrAt,
      `pick at ${pickAt}, pointer at ${ptrAt} — the promoted game must not override the chosen one`);
    check('slate.a-stale-choice-cannot-survive-the-night',
      /if\(p && !slateGame\(p\)\)/.test(code),
      'loadSlate no longer drops a remembered pick that is not on tonight\'s slate — last night\'s room would follow the player into tonight');
    check('slate.the-picker-hides-when-there-is-no-choice',
      /gs\.length < 2/.test(code),
      'paintSlate would render a picker with one option, which is a question with one answer');
  }
  {
    /* build-slate.js must never rebuild a game a hand-written night owns.
       Two rooms for one game splits an audience of thirteen into two of
       six, and the flagship is the one with the email behind it. */
    const b=read('host/build-slate.js');
    check('slate.never-rebuilds-the-flagships-game',
      /claimed\.get\(String\(e\.id\)\)/.test(b) && /if\(owner\)\{/.test(b),
      'build-slate no longer checks whether a hand-written night already claims the event');
    check('slate.still-offers-the-flagship-in-the-picker',
      /flagship: !!owner/.test(b),
      'the flagship would be missing from the picker — the person who came because of the email would arrive and not find the game it was about');
  }
}

function nightConfigStatic(){
  group('THE NIGHT CONFIG — one hydration path, every league');
  {
    const src=read(PLAYER);
    /* STRIP THE PROSE ONCE, FOR EVERY CHECK IN THIS GROUP. Twice now a
       check in here has gone red on the comment that EXPLAINS the bug it
       guards. Comments must stay free to name the thing that went wrong,
       so the searching is done against code. The `//` rule spares `https://`. */
    const nocomment=(t)=>t.replace(/\/\*[\s\S]*?\*\//g,' ')
                          .replace(/(^|[^:])\/\/[^\n]*/g,'$1 ');
    const code=nocomment(src);
    const raw=(src.match(/function hydrateNight\(cfg\)\{[\s\S]*?\n\}/)||[''])[0];
    /* READ THE CODE, NOT THE PROSE. The first version of this check banned
       the token anywhere in the function and went red on the comment that
       EXPLAINS B39 — which is the voice.answers-through-the-same-door
       mistake again: ban a string and you catch the sentence that describes
       the bug alongside the bug. Comments are where the reasoning lives and
       they must stay free to name the thing that went wrong. */
    const body=nocomment(raw);
    /* THE GUARANTEE IS "HYDRATION DOES NOT NAME A LEAGUE" — not "line 4632
       says GAME". Any BB_ token in here is the same bug wearing a new
       variable name, so the check bans the prefix rather than blessing one
       spelling of the fix. */
    check('night.hydration-names-no-league',
      body.length>200 && !/\bBB_[A-Z]/.test(body),
      'hydrateNight() mentions '+((body.match(/\bBB_[A-Z_]+/)||[])[0]||'a basketball constant')+
      ' — it writes into one league instead of the one being played (B39)');
    /* SABOTAGE FOUND THIS ONE DEAD. The first version searched for the
       strings `g.sport` and `SPORT.key` anywhere in the body — and
       replacing the whole guard with `if(false){` left both strings
       sitting in the console.error INSIDE it, so the check stayed green
       over a guard that could never fire. Assert the COMPARISON. */
    check('night.hydration-checks-the-sport',
      /g\.sport\s*&&\s*String\(g\.sport\)\s*!==\s*SPORT\.key/.test(body),
      'a published config can be applied to a different league than the page is showing');
    /* A league with roster:null has nowhere to put a published roster, so
       its bank can never name a player — the ceiling B39 removed. */
    /* AND THIS ONE. The region was cut with a non-greedy match to the
       first `\n};`, which lands inside the FIRST sport's entry — so four
       of the five leagues were never looked at, and setting baseball back
       to roster:null passed the gate. The property is about the whole
       file, so read the whole file. */
    check('night.every-league-has-somewhere-to-put-a-roster',
      !/roster\s*:\s*null/.test(code),
      'a sport still has roster:null — a published roster would be dropped on the floor');
  }
}

function boardStatic(){
  group('THE BOARD — it ranks on the number it prints');
  {
    const src=read(PLAYER);
    const nt=(src.match(/function nightTotal\(v\) \{[\s\S]*?\n  \}/)||[''])[0];
    /* THE TIME AND THE CHANNEL SURVIVE A REDESIGN. THE MARQUEE hid
       #landingTip on a good argument — the countdown owns "when" — and
       took "which channel" off the page entirely with it. A countdown
       answers HOW LONG; it never answers WHAT TIME or WHERE, and it stops
       answering anything once the game is live. The existing
       home.the-game-is-on-the-first-screen only asserts the matchup is
       above the fold, which is why this got through. */
    /* THE WAIT IS 90% OF THE NIGHT AND IT HAS TO SAY WHAT IT IS. Measured
       on GN12: 106 minutes, 11 of them answering, 95 waiting — 27, 32 and
       36 minutes between rounds. For all of it the button read "opens when
       the host pushes it", which names a person who has not existed since
       the runner shipped and never says WHEN. Two devices, three silences,
       and the founder's word for it was "stuck". */
    /* SCOPED TO THE FUNCTION, not the file. The first version searched the
       whole of index.html for the old sentence and went red on two
       COMMENTS — including the one directly above the fix, which quotes the
       old copy to explain why it went. That is the unanchored-search false
       green's evil twin: an unanchored search producing a false RED, on
       prose. Slice to the function before asserting on its contents. */
    const gsr=(src.match(/function gtStartRow\(\)\{[\s\S]*?\n\}/)||[''])[0];
    check('night.the-wait-says-what-it-is-waiting-for',
      /* Match the CODE form, not the words. The fix's own comment quotes the
         old sentence to explain why it went, and a plain substring search
         cannot tell an explanation from an instruction. The concatenation
         only appears when it is a string being built. */
      /* ASSERT THE PROPERTY, NOT ONE SPELLING OF IT. This pinned the exact
         concatenation, and on 22 Aug the line was rewritten for a real
         reason — the founder's "Innings 4-6 opens when this stretch ends.
         Mid 5th", sent from the fifth inning, where the round named after
         the stretch he was standing in appeared to be waiting for
         something already under way. Baseball tags name their own boundary
         so it says "after the 6th" now, and the check went red on a
         change that made it MORE specific about the trigger.

         What must hold is two things: no host is blamed, and the button
         names a moment in the game. Either phrasing satisfies the second —
         the generic period form for sports whose rounds are one period,
         or roundEndsAfter() for the ones that span several. */
      /* NOT a bare search for "host" — the comment three lines above this
         one quotes the retired sentence to explain why it went, and the
         check's own note warns about exactly that: "an unanchored search
         producing a false RED, on prose". I added that clause and it went
         red on the explanation. Match the CODE form only. */
      !!gsr && gsr.indexOf("+' opens when the host pushes it'") < 0
        && (/when this ' \+ \(L\.period\|\|'quarter'\)/.test(gsr)
            || gsr.indexOf("opens when this '+(L.period||'quarter')+' ends") >= 0)
        && /roundEndsAfter\(qi\)/.test(gsr),
      'the between-rounds button still blames a host for the wait, or no longer names the moment it is waiting for',
      'there is no host — the runner opens a round off the game clock, and the player is owed the trigger, not a name. ' +
      'A round that spans several periods must name the one that ends it: "Innings 4-6 open after the 6th", not "when this stretch ends" while you are standing in it');

    /* THE SURFACE IS THE FIRST THING THAT SAYS "SPORT". Founder, after the
       redesign: "look at the background of the first image how there's like
       a court, and now on the new website there is no court… whenever we
       showcase a new sport we should have the sport image behind in the
       same style." THE MARQUEE had parked it for a colour glow, which says
       neither sport nor which one. */
    /* THE BRAND KEEPS ITS COLOUR EVEN WHEN IT LOSES ITS SIZE. The redesign
       demoted the wordmark (right — it was bigger than the matchup) AND
       stripped its teal→blue gradient (wrong, and a separate decision that
       nobody needed to make). The founder, comparing the two landings:
       "the new one is missing something that doesn't give it the same feel
       and color." Small and coloured is not a compromise between the two
       versions; it is what each was individually right about. */
    check('home.the-wordmark-keeps-the-brand-gradient',
      /#s-landing\.mq \.logo\{[^}]*background:linear-gradient\(90deg,var\(--teal2\),var\(--blue2\)\)/.test(src)
        && !/#s-landing\.mq \.logo\{[^}]*background:none/.test(src),
      'the landing wordmark has been flattened to a solid colour again',
      'teal2 to blue2 across the wordmark is the brand signature and the most colourful thing on a very dark page');
    check('home.the-top-of-the-page-is-not-dead-black',
      /#s-landing\.mq::before\{[^}]*radial-gradient/.test(src),
      'the landing header has no light behind it',
      'every lit thing moved into the hero card and left the top third flat — half of what "missing something" meant');

    check('home.the-playing-surface-is-behind-the-hero',
      /id="landingSurface"/.test(src) && /function paintSurface\(\)/.test(src)
        && /#s-landing\.mq #landingSurface\{position:absolute/.test(src),
      'the landing hero has no playing surface behind it',
      'before a word is read it says this is a sports product and which sport');
    check('home.every-built-sport-has-its-own-surface',
      ['basketball','football','soccer','baseball','hockey']
        .every(k=>new RegExp('\\b'+k+':function\\(a,h\\)').test(src)),
      'a sport is missing its own playing surface',
      'a basketball court behind a baseball night is the same class of lie as a wrong score');
    /* The rule that lifts the card's children above the ground must not
       lift the ground with them — it did, and a 210px static div pushed the
       hero four hundred pixels down the page. */
    check('home.the-ground-stays-under-the-hero',
      /#tonightCard > \*:not\(#landingSurface\)\{position:relative\}/.test(src),
      'the card lifts the surface along with everything else',
      'equal specificity, later in the sheet — it beat position:absolute and became a spacer');

    check('home.the-time-and-the-channel-survive',
      !/#s-landing\.mq #landingTip\{[^}]*display:\s*none/.test(src)
        && /#s-landing\.mq #landingTip\{[^}]*display:block !important/.test(src),
      'the landing page hides the tip-off line again',
      'the ordering rule is four things — a game tonight, these two teams, THIS TIME, THIS CHANNEL');

    check('board.the-total-is-composed-not-double-counted',
      !!nt && /v\.livePts/.test(nt) && /if \(live === null\) return Number\(v\.pts\) \|\| 0;/.test(nt),
      'nightTotal adds the client lanes on top of pts again',
      'pts already contains them — GN12 ranked on live + 2x(pred+catch+caught) while printing pts');
    check('board.rows-print-what-they-were-sorted-by',
      (src.match(/p\.total!=null\?p\.total:p\.pts/g)||[]).length>=2,
      'a leaderboard row prints pts while the list is ordered by the total',
      'two quantities in one list is how 135 ended up below 103');
    /* The live lane has to be PUBLISHED or the total cannot be composed. */
    const adm=read(ADMIN);
    check('board.the-server-publishes-the-live-lane',
      /livePts: t\.live/.test(adm),
      'the Control Room writes pts without livePts',
      'without the one lane the phone does not own, the board can only guess at a total');
    /* One rank, not three. GN12 showed #2 on the tile and #3 in the bar. */
    check('board.one-answer-to-what-rank-am-i',
      /function roomStand\(\)/.test(src)
        && /if\(S\.mode==='live'\)\{\s*\n\s*var l=roomStand\(\); if\(!l\) return null;/.test(src),
      'myRank still ranks a live player against the practice bots',
      'one screen said #2 of 3 and #3 at the same time');
  }
}

function voiceStatic(){
  /* VOICE — added the night it shipped, Game Night #12. Every check names
     the thing it stops, same rule as everything else here. The grammar
     itself has its own suite (node qa/voice.js) because it is a pure
     function and deserves real cases; these are the structural guarantees
     that keep voice from becoming a second game. */
  group('VOICE — reading the question out loud, and hearing the answer');
  {
    const src=read(PLAYER);
    const vx=(src.match(/var VX=\(function\(\)\{[\s\S]*?\n\}\)\(\);/)||[''])[0];
    check('voice.module-exists', !!vx && /window\.VX=VX/.test(src),
      'the voice module is gone or no longer exposed',
      'the feature a player asked for by name: "people do not want to look at the screen"');
    /* THE ONE THAT MATTERS. Voice must reach the game through the same two
       functions the buttons use. The day it grows its own scoring, its own
       submit or its own ledger write is the day the room has two games in
       it — B2 with a microphone. */
    check('voice.answers-through-the-same-door',
      /* FORBID WRITING, NOT READING. This used to ban the string `S.pts`
         outright, and it went red the day voice learned to SAY the score —
         "you have 135 points" reads S.pts and changes nothing. Reading a
         number to speak it is the opposite of owning it. What must never
         appear is an assignment or a scoring call. */
      !!vx && /typeof answer==='function'\) answer\(/.test(vx)
           && /typeof nextQuestion==='function'\) nextQuestion\(/.test(vx)
           && !/ledgerSet\(|SB\.submit|pushScore\(/.test(vx)
           && !/S\.pts\s*(=[^=]|\+=|-=)/.test(vx)
           && !/S\.led\s*(=[^=]|\[)/.test(vx),
      'voice reaches the score by some path other than answer() and nextQuestion()',
      'a second way to score is the two-question-banks bug wearing a microphone');
    /* A mishear that LOCKED would be worse than no voice at all. Hearing an
       answer must do exactly what a tap does: select, changeably. */
    check('voice.hearing-you-is-a-pick-never-a-lock',
      !!vx && /kind==='pick'/.test(vx)
           && /kind==='lock'/.test(vx)
           && /Say lock, or say another number/.test(vx),
      'a heard answer no longer says itself back, or locking is not its own word',
      'speech recognition mishears; the read-back is how a player finds out before it costs them the question');
    /* These two assert the GUARANTEE, not the code that implements it. The
       first version named a `hits` array and a local called `toks`, so a
       rewrite that kept both behaviours exactly turned them red — and a
       check that fails on a rename is a check that trains you to ignore it.
       The behaviour itself is proven case by case in qa/voice.js. */
    check('voice.two-candidates-is-a-refusal',
      !!vx && /return \{kind:'ambiguous'\}/.test(vx),
      'an ambiguous phrase resolves to one of the candidates instead of refusing',
      '"yes or no" picked Yes — a coin toss written on a player\'s card as if they had chosen it');
    /* ASSERT THE GUARANTEE, NOT THE VARIABLE NAME. This check used to grep
       for the literal `NUM[`, and the multilingual rewrite renamed that map
       to a per-language lookup — so a change that kept the behaviour exactly
       turned it red, which is the precise failure the comment above warns
       about. Run the matcher instead: what matters is that a sentence with a
       homophone in the middle of it is not an answer, whoever holds the map. */
    check('voice.homophones-only-count-on-a-short-phrase',
      (function(){
        try{
          const store={};
          const g=global, sv={window:g.window,localStorage:g.localStorage,document:g.document,navigator:g.navigator};
          g.window={};
          g.localStorage={getItem:k=>(k in store?store[k]:null),setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}};
          g.document={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>({})};
          g.navigator={language:'en-US',languages:['en-US'],platform:'',userAgent:'',maxTouchPoints:0};
          let V;
          try{ V=new Function(vx+'\nreturn VX;')(); }
          finally{ Object.assign(g,sv); }
          const OPTS=['None or one','Two or three','Four or five','Six or more'];
          const notAPick=(said)=>{ const m=V.match(said,OPTS); return !m || m.kind!=='pick'; };
          /* The television sentences. None of these is a player answering. */
          return notAPick('go for it')
              && notAPick('come on ref that was a foul')
              && notAPick('pass it to him')
              /* ...while the short utterance the prompt teaches still lands. */
              /* Assert by the OPTION, not by its index — the index is a
                 property of this list, and getting it wrong writes a green
                 check that proves nothing (it took one to write this). */
              && (function(){ const m=V.match('four',OPTS);
                   return !!m && m.kind==='pick' && OPTS[m.i]==='Four or five'; })();
        }catch(e){ return false; }
      })(),
      '"for" and "to" can be picked out of the middle of a sentence',
      'a player says "go for it" at the television and the app answers 4 on their behalf');
    /* OFF MEANS OFF. Not a preference — the default, and the state every
       player who never finds the button stays in all night. */
    check('voice.off-is-the-default',
      !!vx && /V\.on = V\.hasOut && localStorage\.getItem\(KEY\)==='1'/.test(vx),
      'voice is on for somebody who never asked for it',
      'a phone that starts talking in a quiet room is a phone that gets closed');
    check('voice.the-mic-belongs-to-the-question',
      !!vx && /V\.deaf=function/.test(vx)
           && /if\(k!=='live'\)\{ VX\.clearHint\(\); VX\.deaf\(\); \}/.test(src)
           && /VX\.locked\(/.test(src),
      'the microphone outlives the question it belongs to',
      'nobody\'s living room gets listened to between quarters');
    /* FAILURE IS VISIBLE — the fail.* rule, applied to the two ways voice
       dies quietly: a blocked microphone, and a browser that cannot speak. */
    check('voice.a-blocked-mic-says-so',
      !!vx && /not-allowed/.test(vx) && /Microphone blocked/.test(vx)
           && /cannot read questions out loud/.test(vx),
      'a denied microphone looks exactly like one that is on and ignoring you',
      'silence is the one thing a player cannot forgive — the same lesson as the submit receipt');
    /* Speech and the microphone are both gesture-gated. A deferred toggle is
       a button that does nothing the first time it is pressed. */
    check('voice.the-toggle-runs-inside-the-click',
      /if\(k==='voice'\)\{ try\{ \(MENU_GO\[k\]\|\|function\(\)\{\}\)\(\); \}catch\(_\)\{\} closeMenu\(\); return; \}/.test(src),
      'the voice row is deferred behind closeMenu like every other row',
      'Safari will not speak or open a mic outside the gesture that asked — the row would silently do nothing');
    check('voice.speech-never-strands-the-question',
      !!vx && /setTimeout\(fire, Math\.min\(20000/.test(vx),
      'nothing sequenced behind speech has a failsafe',
      'Safari and Chrome both drop onend; without this the ear never opens and the question sits silent');
  }
}

(async()=>{
  console.log('\x1b[1m\nSTATS GAMETIME — pre-deploy QA\x1b[0m');
  console.log(`player: ${PLAYER}   admin: ${ADMIN}   mode: ${QUICK?'quick':'full'}`);
  const h=staticChecks(PLAYER);
  playerStructure(h);
  staticChecks(ADMIN);
  unitTests();
  controlRoomStatic();
  boardStatic();
  voiceStatic();
  nightConfigStatic();
  slateStatic();
  doorStatic();
  templateStatic();
  if(!QUICK){ try{
    /* A CEILING ON THE WHOLE BROWSER LAYER. The feed groups have their own,
       but any of the twenty-odd other groups could wedge the same way, and a
       run that never returns teaches nobody anything. Twenty-five minutes is
       generous — a healthy full run is well under fifteen — and blowing it
       reports as a failure with everything counted up to that point. */
    await Promise.race([
      browserTests(),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('the browser layer exceeded 25m — wedged, not slow')), 25*60*1000))
    ]);
  }catch(e){
    /* PRINT WHERE IT DIED. "the browser suite crashed" with no location is
       a dead end — this failure sat in every run for days precisely because
       nobody could tell which group threw. A crashed suite is still a
       failed suite; it just has to say where. */
    bad('browser.suite','the browser suite crashed: '+e.message,'a crashed suite is a failed suite, never a passed one');
    console.log('\x1b[31m  ── where it crashed ──\x1b[0m');
    console.log(String((e&&e.stack)||e).split('\n').slice(0,12).map(l=>'  '+l).join('\n'));
  } }

  console.log(`\n\x1b[1m${'─'.repeat(58)}\x1b[0m`);
  if(FAIL===0 && !WEDGED.length){
    console.log(`\x1b[32m\x1b[1mALL ${PASS} CHECKS PASS — safe to promote\x1b[0m\n`);
    process.exit(0);
  }
  if(FAIL===0){
    /* NO BUILD FAILURES, BUT NOT "ALL PASS" EITHER. Saying ALL PASS here
       would be the exact lie this file exists to prevent: three suites once
       reported success while running nothing. A group that wedged did not
       pass. It did not run. Say which one, say what it covered, and let the
       person decide. */
    console.log(`\x1b[32m\x1b[1m${PASS} CHECKS PASS, no build failures\x1b[0m`);
    console.log(`\x1b[33m\x1b[1mBUT ${WEDGED.length} GROUP(S) NEVER RAN ON THIS MACHINE\x1b[0m`);
    WEDGED.forEach(w=>console.log(`  \x1b[33m⚠\x1b[0m ${w.id}: ${w.why}`));
    console.log(`\x1b[33m  Those checks are not green. They are unexecuted, after a retry in a`);
    console.log(`  second browser. Nothing here says the build is wrong, and nothing here`);
    console.log(`  says that coverage is fine. Promote if you accept the gap; run this`);
    console.log(`  suite somewhere else before a release that touches that feed path.\x1b[0m\n`);
    process.exit(0);
  }
  console.log(`\x1b[31m\x1b[1m${FAIL} FAILED\x1b[0m of ${PASS+FAIL} — \x1b[31mDO NOT DEPLOY\x1b[0m`);
  if(WEDGED.length) console.log(`\x1b[33m  and ${WEDGED.length} group(s) never ran on this machine: `
    + WEDGED.map(w=>w.id).join(', ') + `\x1b[0m`);
  FAILS.forEach(f=>console.log(`  • ${f.id}: ${f.why}`));
  console.log('');
  process.exit(1);
})();
