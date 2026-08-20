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
  let railSeen=false;
  try{ await p.waitForFunction(()=>!!document.querySelector('#gameRail [data-slate]'),{timeout:20000}); railSeen=true; }catch(_){}
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
    const live = await p.evaluate(()=>{
      const t=(document.getElementById('gameRail')||{}).innerText||'';
      return { es:/qu. partido est.s viendo/i.test((document.getElementById('app')||document.body).innerText),
               teams:(window.SLATE&&SLATE.games||[]).map(g=>String(g.home||g.homeAbbr||'')).filter(Boolean),
               railText:t };
    });
    const kept = live.teams.length>0 && live.teams.every(n=>live.railText.indexOf(n)>=0);
    ok('i18n.the-real-rail-is-translated-too', live.es, 'the live rail header stayed English');
    ok('i18n.the-real-rail-keeps-its-team-names', kept,
       live.teams.length===0
         ? 'the slate carried no team names to check — the rail loaded but is empty, which is its own bug'
         : `the rail should still name ${JSON.stringify(live.teams)} after switching to Spanish; it reads ${JSON.stringify(live.railText.slice(0,120))}`);
  }else{
    console.log('       (the rail did not load — its two checks were not run)');
  }

  /* ---- 4. IT DOES NOT LOOP ON ITS OWN EDITS -------------------------- */
  const settled = await p.evaluate(async()=>{
    let n=0; const mo=new MutationObserver(ms=>{ n+=ms.length; });
    mo.observe(document.getElementById('app')||document.body,{childList:true,subtree:true,characterData:true});
    await new Promise(r=>setTimeout(r,1500));
    mo.disconnect();
    return n;
  });
  ok('i18n.the-pass-does-not-loop-on-itself', settled < 50,
     `${settled} mutations in 1.5s with nothing happening — the observer is re-triggering its own edits`);

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
