#!/usr/bin/env node
/* =====================================================================
   THE INTERFACE IN THE PLAYER'S LANGUAGE — and nothing else touched.
   ---------------------------------------------------------------------
   The UI is translated by an exact-match dictionary pass over the DOM,
   because the copy is written inline across twenty thousand lines and
   retrofitting a t() call at every string would be a month of edits on
   screens that already work, for a language with no players in it yet.

   That design has exactly one way to go badly wrong: touching something
   it should not. A substring match would rewrite the inside of a team
   name; a loose match would rename a player. So these checks care far
   more about what is LEFT ALONE than about what is translated:

     · a team name, a handle, a score and a time are never touched
     · a string not in the dictionary stays English, never half-translated
     · switching back to English restores the original exactly
     · the pass cannot loop on its own edits (it observes the DOM)
     · the switch is in the ☰ MENU, because a URL parameter is not a
       feature anybody can find

       node qa/i18n.js [index-test.html]
   ================================================================== */
const {chromium}=require('playwright');
const { waitReady } = require('./ready.js');
const path=require('path');
const TARGET=path.resolve(process.argv.find(a=>/\.html$/.test(a)) || path.join(__dirname,'..','index-test.html'));

let pass=0, fail=0; const bad=[];
const ok=(n,c,d)=>{ if(c) pass++; else { fail++; bad.push(n+(d?'  — '+d:'')); } };

(async()=>{
  const b=await chromium.launch();
  const p=await b.newPage({viewport:{width:390,height:844}});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await p.goto('file://'+TARGET);
  await p.waitForFunction(()=>typeof window.applyLang==='function',{timeout:15000});
  await waitReady(p);   /* was await p.waitForTimeout(1500); — a guess at boot */

  /* THE SUITE OWNS ITS OWN FIXTURE, and this is not fussiness — the first
     version asserted against the LIVE RAIL ("Which game are you watching?",
     "7:00 PM", "Valkyries"), all of which arrive from Firestore. Run alone
     it was green; run inside the full gate, with a dozen browsers on the
     box, the rail had not landed inside the wait and the suite reported
     "a tip-off time was rewritten" — a translation bug that did not exist,
     about a string that was not on the page yet.
     A probe block is present the instant the page is, so what is measured
     is the dictionary pass and nothing else. */
  const PROBE = {
    tagline : 'The game that pays to pay attention',
    which   : 'Which game are you watching?',
    team    : 'Golden State Valkyries',
    time    : '7:00 PM',
    league  : 'WNBA',
    tab     : 'Gametime',
    unknown : 'A sentence nobody ever translated into anything'
  };
  await p.evaluate((PR)=>{
    const box=document.createElement('div');
    box.id='__i18n_probe';
    Object.keys(PR).forEach(k=>{
      const d=document.createElement('div'); d.id='__p_'+k; d.textContent=PR[k]; box.appendChild(d);
    });
    (document.getElementById('app')||document.body).appendChild(box);
  }, PROBE);

  const read = () => p.evaluate(()=>{
    const g=(k)=>{ const el=document.getElementById('__p_'+k); return el?el.textContent:''; };
    return { lang: VX.lang,
             tagline:g('tagline'), which:g('which'), team:g('team'),
             time:g('time'), league:g('league'), tab:g('tab'), unknown:g('unknown') };
  });

  /* ---- 1. ENGLISH IS THE DEFAULT AND IS UNTOUCHED -------------------- */
  await p.waitForTimeout(400);
  const en = await read();
  ok('i18n.defaults-to-english', en.lang==='en', 'booted in '+en.lang);
  ok('i18n.english-copy-is-english',
     en.tagline===PROBE.tagline && en.which===PROBE.which,
     `"${en.tagline}" / "${en.which}"`);

  /* ---- 2. SWITCHING TRANSLATES THE CHROME ---------------------------- */
  await p.evaluate(()=>{ VX.setLang('es'); applyLang(); });
  await p.waitForTimeout(600);
  const es = await read();
  ok('i18n.switching-translates-the-interface',
     /premia prestar atenci/i.test(es.tagline) && /qu. partido est.s viendo/i.test(es.which),
     `"${es.tagline}" / "${es.which}" — the switch did nothing visible, which is what a player reported`);
  ok('i18n.and-the-english-is-gone',
     es.tagline!==PROBE.tagline && es.which!==PROBE.which,
     'both languages are on screen at once');

  /* ---- 3. WHAT IT MUST NEVER TOUCH ----------------------------------- */
  ok('i18n.team-names-survive', es.team===PROBE.team, `became "${es.team}"`);
  ok('i18n.times-survive', es.time===PROBE.time, `became "${es.time}"`);
  ok('i18n.league-names-survive', es.league===PROBE.league, `became "${es.league}"`);
  ok('i18n.the-wordmark-tabs-survive', es.tab===PROBE.tab,
     `"${es.tab}" — Stats/Gametime are the product name in the nav and must not be translated`);
  ok('i18n.an-unknown-string-stays-english', es.unknown===PROBE.unknown,
     `became "${es.unknown}"`);

  /* And the REAL page, once it has actually loaded — waited for rather
     than assumed, so a slow Firestore read is a wait and not a failure. */
  let railSeen=false, railSynthetic=false;
  try{ await p.waitForFunction(()=>!!document.querySelector('#gameRail [data-slate]'),{timeout:20000}); railSeen=true; }catch(_){}
  /* ============ A CHECK MAY NOT DEPEND ON WHAT IS ON TELEVISION =======
     31 Aug 2026. The gate went red on COVERAGE SHRANK — i18n.js 23 -> 21 —
     and the two missing checks were these, skipped with a console note
     while the suite still printed GREEN. The cause was not a regression:
     paintGameRail() hides the rail below two games ("one game is not a
     choice", which is correct), and that night's slate had exactly one
     room. So the translation of the rail went unchecked on any night with
     a single game, silently, and would have gone unchecked all winter on
     a quiet schedule.

     A suite whose coverage rises and falls with the fixture list is a
     suite nobody can read a verdict from — which is the whole reason
     qa/.counts.json exists. So if the real slate cannot raise the rail,
     build one that can. The live rail is still preferred when it is
     there, because it is the thing a player sees; this is the floor
     underneath it, not a replacement for it. */
  if(!railSeen){
    await p.evaluate(()=>{
      const isoIn = ms => new Date(Date.now()+ms).toISOString();
      const mk = (id,aw,hm,aa,ha,gn) => ({
        nightId:id, espnEvent:'', tipISO:isoIn(2*3600e3),
        away:aw, home:hm, awayAbbr:aa, homeAbbr:ha, net:'QA Net',
        sport:(typeof SPORT_KEY!=='undefined'?SPORT_KEY:'basketball'),
        league:'QA', gn:gn, flagship:false, marquee:false, gotn:false });
      try{
        SLATE.date='qa'; SLATE.loaded=true;
        SLATE.games=[ mk('slate-qa-rail-a','Away Alpha','Home Alpha','AWA','HMA','901'),
                      mk('slate-qa-rail-b','Away Bravo','Home Bravo','AWB','HMB','902') ];
      }catch(_){}
      /* HOLD IT. loadSlate() may still be in flight from boot, and when it
         lands it rewrites SLATE.games from tonight's real (one-game) slate
         and the rail hides again mid-check — which is what made the first
         version of this fail with "the rail header stayed English" when
         the translator was working perfectly. */
      try{ window.__QA_RAIL_FIXTURE = SLATE.games; }catch(_){}
      try{ window.loadSlate = async function(){ return; }; }catch(_){}
      try{ paintSlate(); }catch(_){}
      try{ paintGameRail(); }catch(_){}
    });
    try{ await p.waitForFunction(()=>!!document.querySelector('#gameRail [data-slate]'),{timeout:8000});
         railSeen=true; railSynthetic=true; }catch(_){}
    if(railSynthetic) console.log('       (one-game night: the rail was raised with a two-game fixture so its checks still run)');
  }
  if(railSeen){
    await p.waitForTimeout(500);
    /* ============ COMPARE THE RAIL TO ITSELF, NOT TO A TEAM NAME =======
       This asserted /Valkyries/ — the WNBA built-in's home side. That is
       not the invariant; it is a bet on who is playing. It held only while
       the rail happened to be showing the built-in night, and on 20 Aug
       2026, with a real slate of Nationals-Rangers and 49ers-Chargers, it
       went red and reported "a real team name was rewritten" when nothing
       had been rewritten at all. A check that fails because the schedule
       changed teaches everyone to ignore it.

       The actual promise is: whatever team names the rail is showing, the
       translation layer does not touch them. So read them in English
       FIRST, then switch, then demand the same set back. Date-independent,
       sport-independent, and it now fails for exactly one reason. */
    /* ============ AND ONLY THE NAMES IT IS ACTUALLY SHOWING ===========
       28 Aug 2026, the first five-room night. This read the team names out
       of SLATE.games — the DATA — and demanded every one of them in the
       rail's rendered text. At five games the rail deliberately collapses
       to four behind a "+1 more game" button, so the fifth name was in the
       data, correctly absent from the screen, and reported as a
       translation failure. Nothing had been translated.

       The comment above already says the right thing — compare the rail to
       itself — and this now does it: read the names the rail is SHOWING
       while it is still English, then demand those same names back in
       Spanish. A name the rail chose not to show is not this check's
       business, and a rail that shows nothing at all is caught by the
       length guard below.

       Expanding the rail first was the other option and was rejected: the
       collapsed state is what a player actually sees, so it is the state
       worth asserting about. */
    /* The page is ALREADY Spanish here — the switch happens far above — so
       reading the baseline now and comparing it to the same rail would be
       a tautology that passes whatever the translator does. Caught while
       writing this. Go back to English for the baseline, then forward
       again for the comparison, so the assertion genuinely crosses the
       switch. */
    const before = await p.evaluate(()=>{
      try{ if(window.__QA_RAIL_FIXTURE){ SLATE.games = window.__QA_RAIL_FIXTURE;
             SLATE.loaded = true; paintSlate(); paintGameRail(); } }catch(_){}
      try{ VX.setLang('en'); applyLang(); }catch(_){}
      const names=(window.SLATE&&SLATE.games||[]).map(g=>String(g.home||g.homeAbbr||'')).filter(Boolean);
      const t=(document.getElementById('gameRail')||{}).innerText||'';
      return { shown: names.filter(n=>t.indexOf(n)>=0), all: names, englishRail: t.slice(0,60) };
    });
    await p.waitForTimeout(250);
    /* Set the language and READ IT IN SEPARATE TURNS. applyLang() repaints
       asynchronously, so reading innerText in the same evaluate returns the
       old text and the header check fails for a reason that has nothing to
       do with the translator. */
    await p.evaluate(()=>{ try{ VX.setLang('es'); applyLang(); }catch(_){} });
    /* 400ms was not enough and the failure read "the live rail header
       stayed English", which points at the translator and is a lie.
       Measured: the rail comes back Spanish somewhere between 0.5s and
       1.2s after applyLang(). Wait for the header itself rather than
       guessing again. */
    await p.waitForFunction(
      ()=>/qu. partido est.s viendo/i.test(((document.getElementById('gameRail')||{}).innerText||'')),
      {timeout:6000}
    ).catch(()=>{});
    const live = await p.evaluate(()=>{
      const t=(document.getElementById('gameRail')||{}).innerText||'';
      return { es:/qu. partido est.s viendo/i.test((document.getElementById('app')||document.body).innerText),
               railText:t };
    });
    live.teams = before.shown;
    const kept = live.teams.length>0 && live.teams.every(n=>live.railText.indexOf(n)>=0);
    ok('i18n.the-real-rail-is-translated-too', live.es, 'the live rail header stayed English');
    ok('i18n.the-real-rail-keeps-its-team-names', kept,
       live.teams.length===0
         ? 'the slate carried no team names to check — the rail loaded but is empty, which is its own bug'
         : `the rail should still name ${JSON.stringify(live.teams)} after switching to Spanish; it reads ${JSON.stringify(live.railText.slice(0,120))}`);
  }else{
    /* NOT A SKIP ANY MORE. With the synthetic fixture above, a rail that
       still will not render is a real fault in paintGameRail(), not a
       quiet schedule — so it fails rather than silently costing two
       checks and printing GREEN. */
    ok('i18n.the-real-rail-is-translated-too', false,
       'the rail would not render even with a two-game fixture');
    ok('i18n.the-real-rail-keeps-its-team-names', false,
       'the rail would not render even with a two-game fixture');
  }

  /* ---- 4. IT DOES NOT LOOP ON ITS OWN EDITS -------------------------- */
  /* ============ A BURST IS NOT A LOOP ================================
     One 1.5s window could not tell the difference, and that made this
     check intermittent the moment anything legitimate repainted once.
     20 Aug: featureTonight() began calling applySport() when the slate
     lands — a single, correct repaint of the marquee card. Land it inside
     the window and this reported "the observer is re-triggering its own
     edits" about code that had edited once. It failed roughly one run in
     three, which is the worst kind of red: real-looking, and wrong.

     The defect this exists to catch is a LOOP — the mid-question language
     repaint that ran 115 mutations a second and never stopped. A loop
     mutates in every window. A burst mutates in one and then goes quiet.

     So: two consecutive windows, and it is only a loop if the SECOND one
     is still busy. Strictly stronger than the old check — a real loop
     fails it exactly as before, and now says which window was noisy. */
  const settled = await p.evaluate(async()=>{
    const watch = ms => new Promise(res=>{
      let n=0; const mo=new MutationObserver(r=>{ n+=r.length; });
      mo.observe(document.getElementById('app')||document.body,
                 {childList:true,subtree:true,characterData:true});
      setTimeout(()=>{ mo.disconnect(); res(n); }, ms);
    });
    /* ============ WAIT FOR QUIET BEFORE MEASURING QUIET ==============
       Two windows fixed the one-shot burst but not the other half of the
       problem: on a loaded machine BOOT ITSELF can still be running when
       measurement starts, and boot mutates continuously — the slate lands,
       featureTonight repaints the card, paintSlate draws the rail, the
       config prefetch resolves. Sustained across both windows, and not a
       loop at all. Measured 55 then 53 on a run that was perfectly healthy.

       So: wait until the page has actually gone quiet — a 400ms window with
       almost nothing in it — and only then start counting. Bounded, so a
       genuine runaway loop can never make this wait forever; it just starts
       measuring anyway and fails, which is the right outcome. */
    let quiet = false;
    for(let i = 0; i < 30 && !quiet; i++){ quiet = (await watch(400)) <= 2; }
    const a = await watch(1500);
    const b = await watch(1500);
    /* ============ A THIRD WINDOW, AND ONLY IF THE SECOND WAS BUSY =====
       This failed once in a full gate run — 4 mutations then 130 — and
       passed three times out of three on its own immediately afterwards.
       Under a full gate the machine is running a dozen browsers, so a boot
       step that normally lands before measurement starts can arrive inside
       the second window instead. `quiet` was true and it still failed.

       Chasing that as a translation loop would have been a night wasted on
       a ghost, and this is the third flake of exactly this shape today.

       So: a busy second window buys a THIRD, after waiting for quiet again.
       This does not weaken the check. A genuine loop never stops, so it
       fails all three windows; a machine under load goes quiet and passes.
       Both numbers are reported either way, so a near-miss stays visible. */
    let c = null;
    if(b >= 50){
      let q2 = false;
      for(let i = 0; i < 30 && !q2; i++){ q2 = (await watch(400)) <= 2; }
      c = await watch(1500);
    }
    return {a, b, c, quiet};
  });
  ok('i18n.the-pass-does-not-loop-on-itself',
     settled.b < 50 || (settled.c != null && settled.c < 50),
     `${settled.a} mutations in the first 1.5s, ${settled.b} in the second` +
     (settled.c != null ? `, ${settled.c} in a third after waiting for quiet again` : '') +
     ` (page reached ` +
     `quiet before measuring: ${settled.quiet}), with nothing ` +
     `happening — sustained across both windows means the observer is re-triggering its own ` +
     `edits. (A single burst in the first window only is a legitimate one-time repaint and is ` +
     `not what this check is for.)`);

  /* ---- 5. GOING BACK RESTORES EXACTLY -------------------------------- */
  await p.evaluate(()=>{ VX.setLang('en'); applyLang(); });
  await p.waitForTimeout(600);
  const back = await read();
  ok('i18n.switching-back-restores-english',
     back.tagline===PROBE.tagline && back.which===PROBE.which,
     `"${back.tagline}" / "${back.which}" — a player cannot get back`);

  /* ---- 5b. IT NEVER STAMPS OVER LIVE CONTENT ------------------------
     The pass remembers what a node said before it translated it, so it can
     put English back. That memory is a loaded gun: if the APP later writes
     live content into the same node — a score, a clock, a name — the next
     pass would stamp the translation back over it, and switching to English
     would restore a stale word over live data. Reachable the day anyone
     writes `node.nodeValue = …` anywhere in the file. */
  const clobber = await p.evaluate(async ()=>{
    const d=document.createElement('div');
    d.id='__i18n_clob'; d.textContent='Tonight';
    (document.getElementById('app')||document.body).appendChild(d);
    VX.setLang('es'); applyLang();
    await new Promise(r=>setTimeout(r,300));
    const translated=d.textContent;
    /* the app takes the node back, IN PLACE — the case textContent= hides */
    d.firstChild.nodeValue='104 - 98';
    await new Promise(r=>setTimeout(r,600));      // let the observer run
    const afterObserver=d.textContent;
    VX.setLang('en'); applyLang();
    await new Promise(r=>setTimeout(r,600));
    const afterEnglish=d.textContent;
    d.remove();
    return {translated, afterObserver, afterEnglish};
  });
  ok('i18n.never-stamps-a-translation-over-live-content',
     clobber.afterObserver==='104 - 98',
     `the app wrote "104 - 98" into a node and the pass put "${clobber.afterObserver}" back over it`);
  ok('i18n.switching-back-does-not-resurrect-a-stale-word',
     clobber.afterEnglish==='104 - 98',
     `switching to English replaced live content with "${clobber.afterEnglish}"`);

  /* ---- 5c. AN ENGLISH PLAYER PAYS NOTHING ---------------------------
     Every player tonight is English. With no dictionary in play the pass
     must not walk the tree at all — it used to, ~1,000 nodes, about once a
     second because the countdown ticks. */
  /* A FRESH PAGE, because the claim is about a player who NEVER touches
     Spanish. Measuring it on this page would measure a player who switched
     and switched back — a different person, who opted in, and for whom
     restoring English is real work that has to happen. */
  const fresh = await b.newPage({viewport:{width:390,height:844}});
  await fresh.goto('file://'+TARGET);
  await fresh.waitForFunction(()=>typeof window.applyLang==='function',{timeout:15000});
  await waitReady(fresh);   /* was await fresh.waitForTimeout(1200); — a guess at boot */
  const cost = await fresh.evaluate(async ()=>{
    const t0=performance.now();
    for(let i=0;i<200;i++) applyLang();
    return (performance.now()-t0)/200;
  });
  const everTouched = await fresh.evaluate(()=>{ try{ return VX.lang; }catch(_){ return '?'; } });
  await fresh.close();
  ok('i18n.english-costs-nothing', cost < 0.2,
     `${cost.toFixed(3)}ms per pass (lang=${everTouched}) — a player who never touches Spanish pays this on every DOM change, about once a second because the countdown ticks`);

  /* ---- 5d. EVERY PATTERN IS ANCHORED --------------------------------
     The exact-match rule is what stops the dictionary rewriting the inside
     of a team name. Patterns are the one place that rule can be broken:
     an unanchored regex IS a substring match. So this asserts the shape of
     every pattern rather than its behaviour, because one bad entry added
     next year is all it takes. */
  const pats = await p.evaluate(()=>{
    try{
      const out=[];
      for(const lang in I18N_PATTERNS)
        I18N_PATTERNS[lang].forEach(pr=>out.push({lang, src:String(pr[0])}));
      return out;
    }catch(_){ return null; }
  });
  ok('i18n.patterns-exist', Array.isArray(pats) && pats.length>0, 'no pattern table found');
  if(Array.isArray(pats)){
    const loose=pats.filter(x=>!/^\/\^/.test(x.src) || !/\$\/[a-z]*$/.test(x.src));
    ok('i18n.every-pattern-is-anchored', loose.length===0,
       loose.map(x=>x.lang+' '+x.src).join(' · ')+' — an unanchored pattern is a substring match, and a substring match rewrites the inside of team names');
  }

  /* ---- 6. THE SWITCH IS FINDABLE ------------------------------------- */
  const menu = await p.evaluate(()=>{
    try{ openMenu(); }catch(_){}
    const sh=document.getElementById('menuSheet');
    const rows=[...(sh?sh.querySelectorAll('[data-m]'):[])].map(b=>({m:b.getAttribute('data-m'), t:b.textContent.trim()}));
    return { rows, hasLang: rows.some(r=>r.m==='lang'),
             label: (rows.find(r=>r.m==='lang')||{}).t || '' };
  });
  ok('i18n.the-language-switch-is-in-the-menu', menu.hasLang,
     'the only way to Spanish is a ?lang= URL, which is not a feature anybody can find');
  ok('i18n.the-menu-row-is-labelled-in-both-languages',
     /Language/i.test(menu.label) && /Idioma/i.test(menu.label),
     `"${menu.label}" — somebody who needs Spanish cannot read an English label telling them where Spanish is`);

  /* And tapping it actually switches. */
  const toggled = await p.evaluate(async()=>{
    const before=VX.lang;
    const btn=[...document.querySelectorAll('#menuSheet [data-m]')].find(b=>b.getAttribute('data-m')==='lang');
    if(!btn) return {before, after:before, clicked:false};
    btn.click();
    await new Promise(r=>setTimeout(r,700));
    return {before, after:VX.lang, clicked:true};
  });
  ok('i18n.tapping-the-row-switches-language',
     toggled.clicked && toggled.after!==toggled.before,
     `${toggled.before} -> ${toggled.after}`);

  await p.evaluate(()=>{ try{ VX.setLang('en'); closeMenu(); }catch(_){} });
  /* THE PASS MUST NOT HAVE DIED QUIETLY. It is wrapped in a try/catch so a
     translation can never take the app down — which means a bug inside it
     produces no symptom except "everything is still English". That is
     exactly what happened once. If it threw, say so. */
  const broke = await p.evaluate(()=>{ try{ return I18N_BROKE; }catch(_){ return 'no I18N_BROKE flag'; } });
  ok('i18n.the-pass-did-not-fail-silently', !broke,
     'applyLang threw and was swallowed: '+broke);

  ok('i18n.no-page-errors', errs.length===0, errs.slice(0,2).join(' · '));

  await b.close();
  console.log(`\n${fail?'RED':'GREEN'}   ${pass} passed, ${fail} failed   [${path.basename(TARGET)}]`);
  bad.forEach(x=>console.log('   x '+x));
  process.exit(fail?1:0);
})();
