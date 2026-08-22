/* ============ qa/stats-page.js =======================================
   THE STATS TAB HAS TO SAY SOMETHING, IN EVERY SPORT.

   Founder, 21 Aug, three times: "The stats page has no effect", "This is
   the stats page and it is empty. This page is so importnat", "the stats
   for baseball and nfl have nothing".

   Every block on that page was basketball — shot zones, assist networks,
   scoring runs — so football and baseball fell through to "Not enough has
   happened yet" during games with plenty happening. Baseball was worse
   than thin: ESPN nests its team statistics under Batting/Pitching/
   Fielding groups and the reader only understood the flat `label` shape,
   so the map was EMPTY and no block could have drawn anything.

   This drives the real page against the real fixtures for three leagues
   and demands content. It is deliberately a CONTENT test, not a wiring
   test: qa/voice-wiring.js passed 74 checks through two real bugs by
   asserting that functions existed.
   ================================================================== */
const {chromium}=require('playwright');
const path=require('path'), fs=require('fs');
const FILE='file://'+path.join(__dirname,'..','index-test.html');
let pass=0, fail=0;
const ok =(n,d)=>{pass++; console.log('  ok   '+n+(d?('   '+d):''));};
const bad=(n,d)=>{fail++; console.log('  FAIL '+n+(d?'\n         '+d:''));};

const FIX = {
  wnba:     {file:'wnba.json', fam:'basketball', wantBars:['Rebounds','Assists','Turnovers']},
  nfl:      {file:'nfl.json',  fam:'football',   wantBars:['Total Yards','1st Downs','Turnovers']},
  mlb:      {file:'mlb.json',  fam:'baseball',   wantBars:['Hits','Errors']}
};

(async()=>{
  const b=await chromium.launch();
  for(const [league, cfg] of Object.entries(FIX)){
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname,'..','references','multisport',cfg.file),'utf8'));
    const p=await b.newPage({viewport:{width:393,height:852}});
    const errs=[]; p.on('pageerror',e=>errs.push(String(e&&e.message||e)));
    await p.goto(FILE); await p.waitForTimeout(1300);

    /* Feed the REAL summary through the REAL parser, then call the REAL
       renderers. Nothing here reimplements what it is testing. */
    const r = await p.evaluate(async ({j, fam}) => {
      /* Stand the parser up exactly the way loadGameStats does, by
         letting it fetch our fixture instead of the network. */
      const realFetch = window.fetch;
      window.fetch = () => Promise.resolve({ json: () => Promise.resolve(j) });
      window.__famOverride = fam;
      const oldFam = window.famNow;
      window.famNow = () => fam;
      try { GS.ok=false; GS.at=0; GS.ev=''; await loadGameStats(true); } catch(e){ }
      window.fetch = realFetch;

      const T = (()=>{ try{ return gtTeams(); }catch(_){ return null; } })();
      const out = {
        parsed: !!GS.ok,
        lines: (GS.lines||[]).length,
        periods: ((GS.lines||[])[0]||{vals:[]}).vals.length,
        statKeys: T && T.a && T.a.m ? Object.keys(T.a.m).length : 0,
        someKeys: T && T.a && T.a.m ? Object.keys(T.a.m).slice(0,6) : [],
        flow: (()=>{ try{ return stFlow()||''; }catch(e){ return 'THREW:'+e.message; } })(),
        bars: (()=>{ try{ return stTeamBars()||''; }catch(e){ return 'THREW:'+e.message; } })()
      };
      window.famNow = oldFam;
      return out;
    }, {j: raw, fam: cfg.fam});

    console.log('\n  ── ' + league.toUpperCase() + ' (' + cfg.fam + ')');
    if(!r.parsed){ bad(league+': the fixture parses', 'GS.ok is false — the feed never loaded'); await p.close(); continue; }

    /* ---- the data the page needs actually arrived ---- */
    if(r.statKeys>0) ok(league+': team statistics were read', r.statKeys+' labels, e.g. '+r.someKeys.slice(0,3).join(' / '));
    else bad(league+': team statistics were read',
             'the stat map is EMPTY — this is the baseball bug: a nested statistics[] shape read as flat');
    if(r.periods>=2) ok(league+': linescores were read', r.periods+' periods');
    else bad(league+': linescores were read', 'only '+r.periods+' period(s) — stFlow has nothing to draw');

    /* ---- and the page drew something ---- */
    if(String(r.flow).startsWith('THREW')) bad(league+': the flow chart draws', r.flow);
    else if(r.flow.length>120) ok(league+': the flow chart draws', r.flow.length+' chars');
    else bad(league+': the flow chart draws', 'it rendered nothing');

    if(String(r.bars).startsWith('THREW')) bad(league+': the head-to-head draws', r.bars);
    else if(r.bars.length>120) ok(league+': the head-to-head draws', r.bars.length+' chars');
    else bad(league+': the head-to-head draws', 'it rendered nothing — no label in ST_BARS matched this feed');

    /* ---- the rows are the ones a fan of THAT sport expects ---- */
    const missing = cfg.wantBars.filter(w => r.bars.indexOf('>'+w+'<')<0 && r.bars.indexOf(w)<0);
    if(!missing.length) ok(league+': the rows name this sport\'s own numbers', cfg.wantBars.join(', '));
    else bad(league+': the rows name this sport\'s own numbers', 'missing: '+missing.join(', '));

    /* ---- no invented numbers ---- */
    if(r.bars.indexOf('NaN')<0 && r.flow.indexOf('NaN')<0
       && r.bars.indexOf('undefined')<0 && r.flow.indexOf('undefined')<0)
      ok(league+': nothing reads NaN or undefined');
    else bad(league+': nothing reads NaN or undefined', 'a number leaked through as NaN/undefined');

    /* ============ RENDER IT, DO NOT JUST BUILD THE STRING ============
       The geometry checks below measure #stBody. The probe above calls
       stFlow() and stTeamBars() and reads their RETURN VALUES — it never
       puts them on the page. So #stBody was EMPTY, "0px overflow" was a
       measurement of nothing, and the check passed vacuously until a
       later one asked for an element by name and found none.

       That is the same vacuous-pass shape qa/voice-wiring.js had: 74
       checks green through two real bugs because its cards carried no
       real timing. Put the real page on the screen and then measure it. */
    /* KEEP THE SPORT OVERRIDE FOR THE RENDER. The probe above restores
       famNow before returning, so renderStats() then drew BASKETBALL rows
       against an NFL box score and only one label happened to match. The
       geometry was real and it was measuring the wrong sport. */
    await p.evaluate((fam)=>{ try{ window.famNow=()=>fam; S.mode='live'; go('stats'); renderStats(); }catch(_){} }, cfg.fam);
    await p.waitForTimeout(300);
    const rendered = await p.evaluate(()=>{
      const b=document.getElementById('stBody');
      return { has: !!b, len: b ? b.innerHTML.length : 0,
               bars: document.querySelectorAll('#stBody .h2h').length,
               flow: document.querySelectorAll('#stBody .stFlow').length };
    });
    if(rendered.has && rendered.len>400) ok(league+': the page actually renders into #stBody',
      rendered.len+' chars, '+rendered.bars+' head-to-head, '+rendered.flow+' flow');
    else bad(league+': the page actually renders into #stBody',
      'stBody has '+rendered.len+' chars — every geometry check below would be vacuous');

    /* ---- and nothing here may be wider than the screen -------------
       The swipe handler refuses to hijack a gesture that starts inside a
       horizontally scrollable element — `scrollWidth > clientWidth + 8`.
       The first version of the flow chart put two numbers abreast in each
       column, which a nine-inning game cannot fit, so #stBody overflowed
       and the Stats tab silently became a tab you could not SWIPE OUT OF.
       qa.js caught it as `swipe.moves-between-tabs: stats/stats/stats`,
       two screens away from the cause.

       This is the same rule the game rail was rebuilt around on the same
       night: nothing sideways, anywhere. */
    const over = await p.evaluate(()=>{
      const body=document.getElementById('stBody');
      const wide=[];
      document.querySelectorAll('#stBody *').forEach(e=>{
        if(e.scrollWidth > e.clientWidth+8) wide.push(e.className||e.tagName);
      });
      return { body: body ? (body.scrollWidth-body.clientWidth) : -1,
               wide: [...new Set(wide)].slice(0,4) };
    });
    if(over.body<=8 && !over.wide.length) ok(league+': nothing on the page is wider than the screen');
    else bad(league+': nothing on the page is wider than the screen',
             '#stBody overflows by '+over.body+'px'+(over.wide.length?('; wide: '+over.wide.join(', ')):'')+
             ' — this is what makes the swipe handler refuse to leave the tab');

    /* ---- and it has to be READABLE, not merely present -------------
       Founder, 22 Aug: "stats page looks so ugly fix it and make it
       presentable". The head-to-head labels were flex items with
       min-width:0 and overflow-wrap:anywhere — added to stop the row
       overflowing its card — and together those let "Total Yards" shrink
       to one character wide and render vertically, a letter per line.

       Every check passed: the block drew, the rows were there, the
       numbers were right, nothing overflowed. A layout can be correct in
       every property a test usually asserts and still be unreadable. So
       measure the SHAPE: a label narrower than it is tall is a word
       standing on end. */
    const shape = await p.evaluate(()=>{
      const out={narrow:[], tall:[]};
      document.querySelectorAll('#stBody .tbLbl').forEach(e=>{
        const r=e.getBoundingClientRect();
        const txt=(e.textContent||'').trim().slice(0,24);
        if(r.width < 60) out.narrow.push(txt+' ('+Math.round(r.width)+'px wide)');
        /* Three lines of 12px type is ~50px. Anything past that for a
           two-word stat name means it is wrapping per character. */
        if(r.height > 56) out.tall.push(txt+' ('+Math.round(r.height)+'px tall)');
      });
      out.count=document.querySelectorAll('#stBody .tbLbl').length;
      return out;
    });
    if(shape.count===0) bad(league+': the head-to-head has labelled rows', 'no .tbLbl found');
    else if(!shape.narrow.length && !shape.tall.length)
      ok(league+': every stat label is readable across, not down', shape.count+' rows');
    else bad(league+': every stat label is readable across, not down',
             'squeezed: '+shape.narrow.concat(shape.tall).slice(0,3).join('; ')+
             ' — this is the label rendering one letter per line');

    if(errs.length) bad(league+': no page errors', errs.slice(0,2).join(' | '));
    else ok(league+': no page errors');
    await p.close();
  }
  console.log('\n  '+pass+' passed, '+fail+' failed');
  await b.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.log('  FATAL '+e.message); process.exit(1); });
