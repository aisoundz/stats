#!/usr/bin/env node
/* =====================================================================
   THE FIRST OUTSIDE FEEDBACK SESSION, AS EXECUTABLE CHECKS.
   ---------------------------------------------------------------------
   26 Aug 2026. The first time anybody outside the build was walked
   through this product end to end. Three of his notes were defects, and
   he found all three himself in under an hour:

     1. "I put in ten, and then you hit enter… ENTER ISN'T WORKING NOW.
         You gotta go to Next, but we should get the Enter to work."

     2. "It needs to be to the right sport, because THE PLAYERS THAT
         YOU'RE SEEING THERE IS ACTUALLY BASKETBALL PLAYERS."
        — said during the SOCCER demo, moments after the founder said
        "we also give you the reports, who's not playing".

     3. "For soccer, this should be you scored in ALL TWO HALVES, not
         two quarters."

   Each is the same shape this codebase keeps producing, and each is
   asserted below against the real function rather than a copy of it.

       node qa/feedback-26aug.js
       node qa/feedback-26aug.js index-test.html
   ================================================================== */
const fs=require('fs'), path=require('path'), os=require('os');
const ROOT=path.resolve(__dirname,'..');
const TARGET=process.argv[2] && !process.argv[2].startsWith('--')
  ? path.resolve(process.argv[2]) : path.join(ROOT,'index.html');
const ENG=(process.env.QA_ENGINE||'firefox');

let fail=0;
const ok=(id)=>console.log(`  \x1b[32m✓\x1b[0m ${id}`);
const bad=(id,why)=>{fail++;console.log(`  \x1b[31m✗ ${id}\x1b[0m — ${why}`);};
const check=(id,c,why)=>c?ok(id):bad(id,why);

(async()=>{
  const {firefox,chromium}=require('playwright');
  const ENGINE = ENG==='chromium' ? chromium : firefox;
  console.log('\n=== THE 26 AUG FEEDBACK SESSION ===   '
    + path.basename(TARGET) + ' · ' + ENG);

  const b=await ENGINE.launch();
  const p=await b.newPage({viewport:{width:390,height:844}});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,140)));
  await p.route('**/site.api.espn.com/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
  await p.route('**/assets.mailerlite.com/**',r=>r.fulfill({status:200,body:'{}'}));

  const tmp=path.join(os.tmpdir(),'qa-fb-'+process.pid+'.html');
  fs.copyFileSync(TARGET,tmp);
  await p.goto('file://'+tmp,{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>window.STATS_READY===true,null,{timeout:25000}).catch(()=>{});

  /* ------------------------------------------------------------------
     1. ENTER SUBMITS THE NUMBER FIELD.

     Driven with a REAL keyboard press on the REAL input, not by calling
     a handler. A check that invokes onkeydown directly would pass on a
     build where the handler is never attached, which is the whole bug.
     ------------------------------------------------------------------ */
  console.log('\n  1. "Enter isn\'t working now"');
  {
    const setup = await p.evaluate(()=>{
      S.mode='demo';
      preds.length=0;
      preds.push({id:'a',label:'Top scorer',q:'Who scores most?',base:100,
                  opts:['Alpha','Beta'], bonus:true, numLabel:'How many?'});
      preds.push({id:'b',label:'Rebounds',q:'Who rebounds most?',base:100,
                  opts:['Alpha','Beta']});
      PD.i=0; S.predChoices={};
      try{ go('predict'); buildPred(); }catch(e){ return {err:String(e).slice(0,90)}; }
      return { hasInput: !!document.querySelector('.pdbonus input'), at: PD.i };
    });
    check('enter.the-number-field-exists', setup.hasInput===true,
      'no .pdbonus input rendered — the fixture is wrong, not the build');

    if(setup.hasInput){
      await p.click('.pdbonus input');
      await p.type('.pdbonus input','10');
      const before = await p.evaluate(()=>PD.i);
      await p.keyboard.press('Enter');
      await p.waitForTimeout(350);
      const after = await p.evaluate(()=>({ i:PD.i, num:S.predChoices['a_num'] }));
      console.log('     card index ' + before + ' → ' + after.i + '   value kept: ' + JSON.stringify(after.num));
      check('enter.advances-to-the-next-card', after.i===before+1,
        'Enter left the player on card ' + after.i + ' — they have to find and tap Next, '
        + 'which is exactly what he hit live');
      check('enter.keeps-the-number-typed', String(after.num)==='10',
        'the value typed before Enter was lost (' + JSON.stringify(after.num) + ')');
    }
  }

  /* ------------------------------------------------------------------
     2. THE OUT LIST DOES NOT SURVIVE A SPORT SWAP.

     Drives loadInactives()'s own state and then a real hydrateNight,
     because the defect was that NOTHING cleared the Set — a check that
     cleared it itself would prove nothing.
     ------------------------------------------------------------------ */
  console.log('\n  2. "the players you\'re seeing there is actually basketball players"');
  {
    const r = await p.evaluate(()=>{
      const o={};
      try{ INACTIVE.clear(); }catch(_){}
      /* a basketball night's injury report, the way loadInactives writes it */
      try{
        INACTIVE.add('Nneka Ogwumike'); INACTIVE.add('Skylar Diggins');
        INACTIVE_NOTE = 'Nneka Ogwumike (OUT), Skylar Diggins (OUT)';
      }catch(e){ o.err=String(e).slice(0,90); }
      o.before = { n: INACTIVE.size, note: INACTIVE_NOTE.slice(0,40) };

      /* Now he taps SOCCER in the practice picker. THE REAL ROUTE, via
         setSport(), not a hand-built hydrateNight call.

         The first version of this check called hydrateNight directly with
         an empty soccer roster and it REFUSED — correctly. picksPeople is
         computed from the CURRENT global roster (still basketball, still
         full) while the incoming soccer roster is legitimately empty, so
         the guard read it as a half-built night. setSport() swaps the
         roster global first, which is why the real path works and the
         hand-built one did not. Testing the route the founder actually
         took is the point. */
      try{ setSport('soccer'); applySport(); }catch(e){ o.hydErr=String(e).slice(0,90); }
      o.after = { n: INACTIVE.size, note: String(INACTIVE_NOTE||'').slice(0,40) };
      /* and nothing basketball-shaped may still be on the screen */
      let bar=''; try{ bar=(document.getElementById('inactBar')||{}).textContent||''; }catch(_){}
      o.barHasBasketballName = /Ogwumike|Diggins/.test(bar);
      return o;
    });
    console.log('     INACTIVE before ' + r.before.n + ' → after ' + r.after.n
              + (r.hydErr ? ('   HYDRATE ERROR ' + r.hydErr) : ''));
    check('outlist.the-fixture-really-filled-it', r.before.n===2,
      'the fixture did not populate INACTIVE, so the check below is vacuous');
    check('outlist.a-new-night-empties-the-out-list', r.after.n===0,
      'INACTIVE still holds ' + r.after.n + ' name(s) from the previous sport — a soccer card '
      + 'will print basketball players under "Not playing tonight"');
    check('outlist.the-note-goes-with-it', r.after.note==='',
      'INACTIVE_NOTE still reads "' + r.after.note + '" after a different sport loaded');
    check('outlist.nothing-stale-is-left-on-screen', r.barHasBasketballName===false,
      'the rendered "Not playing tonight" bar still names a basketball player');
  }

  /* ------------------------------------------------------------------
     3. THE AWARD SAYS THE SPORT'S OWN WORD.
     ------------------------------------------------------------------ */
  console.log('\n  3. "for soccer this should be all two HALVES, not two quarters"');
  {
    const r = await p.evaluate(()=>{
      const o={};
      o.hasHelper = (typeof roundWord === 'function');
      if(o.hasHelper){
        try{ setSport('soccer');     o.soccer   = roundWord(2) + ' / ' + roundWord(1); }catch(e){ o.soccer='ERR'; }
        try{ setSport('baseball');   o.baseball = roundWord(3); }catch(e){ o.baseball='ERR'; }
        try{ setSport('basketball'); o.basket   = roundWord(4); }catch(e){ o.basket='ERR'; }
      }
      /* the award's own text, rendered by the award's own function */
      try{
        setSport('soccer');
        const a=(AWARDS||[]).filter(x=>x.id==='everyq')[0];
        o.awardWhy = a ? String(a.why({roundHits:[1,1]})).replace(/<[^>]*>/g,'') : '(no everyq award)';
        o.awardShort = a && a.short ? String(a.short()) : '';
      }catch(e){ o.awardWhy='ERR '+String(e).slice(0,70); }
      return o;
    });
    console.log('     roundWord: soccer=' + r.soccer + '  baseball=' + r.baseball + '  basketball=' + r.basket);
    console.log('     award: "' + String(r.awardWhy).slice(0,72) + '"');
    check('word.the-helper-exists', r.hasHelper===true,
      'roundWord() is missing — it is the one owner of a sport\'s word for a round');
    check('word.soccer-is-halves', /halves/.test(String(r.soccer)) && /half/.test(String(r.soccer)),
      'roundWord says "' + r.soccer + '" for soccer');
    check('word.the-award-does-not-say-quarters-in-soccer',
      !/quarter/i.test(String(r.awardWhy)) && !/quarter/i.test(String(r.awardShort)),
      'the end-of-night award still says "quarters" on a soccer card: "' + r.awardWhy + '"');
    check('word.the-award-says-halves-in-soccer',
      /halves|half/i.test(String(r.awardWhy)),
      'the award never names the sport\'s own period word');
  }

  await b.close();
  check('no-page-errors', errs.length===0, errs.slice(0,3).join(' · '));
  try{ fs.unlinkSync(tmp); }catch(_){}

  console.log(fail
    ? `\n\x1b[31mRED\x1b[0m   ${fail} failed   [${path.basename(TARGET)} · ${ENG}]`
    : `\n\x1b[32mGREEN\x1b[0m  all checks pass   [${path.basename(TARGET)} · ${ENG}]`);
  process.exit(fail?1:0);
})().catch(e=>{ console.error('SUITE CRASHED', e); process.exit(1); });
