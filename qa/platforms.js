#!/usr/bin/env node
/* =====================================================================
   EVERY SCREEN THIS GAME IS PLAYED ON.
   ---------------------------------------------------------------------
   Phones, tablets, laptops, desktops and a television — in the three
   engines that actually exist: WebKit (every iPhone and iPad, because iOS
   forces every browser onto it), Chromium (Android, Chrome, Edge, most TV
   browsers) and Gecko (Firefox).

   WHAT THIS CAN PROVE, and it is most of what breaks: layout at a real
   viewport and pixel ratio, horizontal overflow, touch targets big enough
   for a thumb, text above the legibility floor, whether the menu can be
   reached, whether the language switch is on screen and works, whether a
   practice round starts, and whether anything throws.

   WHAT IT CANNOT PROVE, stated here so nobody mistakes a green run for
   device coverage:
     · the iOS microphone gesture rule. Safari opens a mic from a user
       gesture and from nothing else, and a headless WebKit on Linux does
       not enforce that. Voice on a real iPhone is a HUMAN check.
     · a real TV remote. The TV profile below asserts that the interface
       is reachable by ARROW KEYS AND ENTER, which is what a D-pad sends —
       it does not prove any particular television.
     · fonts, IME, notches, safe-area insets and battery behaviour.
   Those live on the human checklist, and that is the whole point of
   having one.

       node qa/platforms.js                 # the default matrix
       node qa/platforms.js --all           # every profile including landscape
       node qa/platforms.js --only iPhone   # substring filter
       node qa/platforms.js index.html      # judge a specific build
   ================================================================== */
const {chromium, webkit, firefox, devices}=require('playwright');
const path=require('path');

const ARGS=process.argv.slice(2);
const TARGET=path.resolve(ARGS.find(a=>/\.html$/.test(a)) || path.join(__dirname,'..','index-test.html'));
const ALL=ARGS.includes('--all');
const oi=ARGS.indexOf('--only');
const ONLY=oi>=0?ARGS[oi+1]:null;
const ENGINES={chromium, webkit, firefox};

/* THE MATRIX. `kind` drives which checks apply — a television has no thumb
   and a phone has no remote. */
const MATRIX=[
  {name:'iPhone 15',        dev:'iPhone 15',           kind:'phone',   engine:'webkit'},
  {name:'iPhone 14',        dev:'iPhone 14',           kind:'phone',   engine:'webkit'},
  {name:'iPhone SE-ish',    dev:'Galaxy S9+',          kind:'phone',   engine:'chromium', note:'320px — the narrowest screen anyone still uses'},
  {name:'Pixel 7',          dev:'Pixel 7',             kind:'phone',   engine:'chromium'},
  {name:'iPad Pro 11',      dev:'iPad Pro 11',         kind:'tablet',  engine:'webkit'},
  {name:'iPad Mini',        dev:'iPad Mini',           kind:'tablet',  engine:'webkit'},
  {name:'Galaxy Tab S9',    dev:'Galaxy Tab S9',       kind:'tablet',  engine:'chromium'},
  {name:'Laptop (Firefox)', dev:'Desktop Firefox',     kind:'desktop', engine:'firefox'},
  {name:'Laptop (Safari)',  dev:'Desktop Safari',      kind:'desktop', engine:'webkit'},
  {name:'Desktop (Chrome)', dev:'Desktop Chrome HiDPI',kind:'desktop', engine:'chromium'},
  /* A TELEVISION. Ten feet away, no pointer, driven by a D-pad — arrow
     keys and Enter. Sport is watched on one of these more than on
     anything else, so it is in the default matrix, not the --all tail. */
  {name:'TV 1080p',         viewport:{width:1920,height:1080}, dsf:1, kind:'tv', engine:'chromium'},
];
const LANDSCAPE=[
  {name:'iPhone 15 landscape', dev:'iPhone 15 landscape', kind:'phone',  engine:'webkit'},
  {name:'iPad Pro landscape',  dev:'iPad Pro 11 landscape', kind:'tablet', engine:'webkit'},
  {name:'Galaxy Tab landscape',dev:'Galaxy Tab S9 landscape', kind:'tablet', engine:'chromium'},
];

let pass=0, fail=0; const bad=[];
const ok=(dev,n,c,d)=>{ if(c) pass++; else { fail++; bad.push(dev+' · '+n+(d?'  — '+d:'')); } };

(async()=>{
  const list=(ALL?MATRIX.concat(LANDSCAPE):MATRIX).filter(m=>!ONLY||m.name.toLowerCase().includes(ONLY.toLowerCase()));
  console.log('\n=== '+list.length+' platform(s) · '+path.basename(TARGET)+' ===\n');
  const browsers={};
  for(const m of list){
    if(!browsers[m.engine]) browsers[m.engine]=await ENGINES[m.engine].launch();
    const b=browsers[m.engine];
    const ctx=await b.newContext(m.dev ? devices[m.dev]
                                       : {viewport:m.viewport, deviceScaleFactor:m.dsf||1});
    const p=await ctx.newPage();
    const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,110)));
    let r;
    try{
      await p.goto('file://'+TARGET,{waitUntil:'domcontentloaded'});
      await p.waitForFunction(()=>typeof window.VX!=='undefined',{timeout:20000}).catch(()=>{});
      await p.waitForTimeout(2500);
      r=await p.evaluate((kind)=>{
        const app=document.getElementById('app')||document.body;
        const vw=window.innerWidth;
        /* Horizontal overflow: the single most common device bug and the
           one that makes an app feel broken without any error. */
        const wide=[...document.querySelectorAll('body *')].filter(el=>{
          const b=el.getBoundingClientRect();
          return b.width>0 && (b.right>vw+2||b.left<-2) && getComputedStyle(el).position!=='fixed';
        }).slice(0,3).map(el=>(el.id?'#'+el.id:el.tagName)+' '+Math.round(el.getBoundingClientRect().right)+'px');
        /* Touch targets. Apple says 44pt, Google 48dp; 44 is the floor. */
        const taps=[...document.querySelectorAll('button,[role=button],a')]
          .filter(el=>{const b=el.getBoundingClientRect(); return b.width>0&&b.height>0&&el.offsetParent;});
        /* #buildStamp is exempt and says so: it is a diagnostic — the build
           number, tappable to copy — not a control any player needs to hit
           to play. Making it 44px tall would put a fat bar at the bottom of
           the menu for something nobody but me presses. Everything a PLAYER
           must hit is held to the floor. */
        const EXEMPT=new Set(['buildStamp']);
        const small=taps.filter(el=>{ if(EXEMPT.has(el.id)) return false;
                                      const b=el.getBoundingClientRect(); return Math.min(b.width,b.height)<44;})
          .slice(0,4).map(el=>(el.id?'#'+el.id:(el.textContent||'').trim().slice(0,14))+' '
            +Math.round(el.getBoundingClientRect().width)+'x'+Math.round(el.getBoundingClientRect().height));
        /* Legibility floor: the ramp's own minimum. */
        const tiny=[...document.querySelectorAll('body *')].filter(el=>{
          if(el.children.length||!el.textContent.trim()||!el.offsetParent) return false;
          return parseFloat(getComputedStyle(el).fontSize)<12;
        }).slice(0,3).map(el=>(el.textContent||'').trim().slice(0,18)+' @'+getComputedStyle(el).fontSize);
        /* The four tabs are the wordmark and the only navigation. */
        const tabs=[...document.querySelectorAll('#botnav a,#botnav button,[class*=navbtn]')]
          .map(x=>x.textContent.trim()).filter(Boolean);
        /* Can a keyboard/D-pad reach anything? A television has no pointer. */
        const focusable=document.querySelectorAll('a[href],button:not([disabled]),input,select,[tabindex]:not([tabindex="-1"])').length;
        /* CONTENT HIDDEN INSIDE A SCROLLER, WITH NOTHING SAYING SO.
           This suite already checked that the PAGE does not scroll
           sideways. It passed a rail that was a flex row with
           overflow-x:auto AND the scrollbar removed on both engines — so
           with four games the third tile was sliced down the middle and
           the fourth did not exist as far as any player could tell. The
           sliced one was the FLAGSHIP. The founder found it in seconds and
           114 green checks had not.

           "The page does not scroll" and "nothing is hidden" are different
           promises. This is the second one: any element whose children
           overflow its own box is reported, and a hidden scrollbar makes it
           worse rather than better, because then there is no affordance at
           all. */
        const clipped=[];
        document.querySelectorAll('#app *').forEach(box=>{
          if(box.children.length<2) return;
          const cs=getComputedStyle(box);
          const scrolls = /auto|scroll/.test(cs.overflowX);
          const overflows = box.scrollWidth > box.clientWidth+2;
          if(!overflows) return;
          const bb=box.getBoundingClientRect();
          /* ONLY THINGS A PLAYER IS MEANT TO SEE OR PRESS. Decorative
             layers are SUPPOSED to bleed past their box — the arena light
             behind the matchup is a glow, not content, and flagging it
             would teach everyone to ignore this check. So: it must carry
             text or be interactive, and it must not be marked hidden from
             assistive tech, which is how decoration declares itself. */
          const cut=[...box.children].filter(ch=>{
            const r=ch.getBoundingClientRect();
            if(!(r.width>0 && (r.right>bb.right+1 || r.left<bb.left-1))) return false;
            if(ch.getAttribute && ch.getAttribute('aria-hidden')==='true') return false;
            const cs2=getComputedStyle(ch);
            if(cs2.position==='absolute'||cs2.position==='fixed') return false;
            if(cs2.pointerEvents==='none') return false;
            const isControl=/^(BUTTON|A|INPUT|SELECT)$/.test(ch.tagName)
                          || ch.querySelector('button,a,input,select');
            const hasText=(ch.textContent||'').trim().length>0;
            return isControl || hasText;
          });
          if(!cut.length) return;
          const bar = cs.scrollbarWidth==='none' ? ' (scrollbar hidden — no affordance)' : '';
          clipped.push((box.id?'#'+box.id:box.className||box.tagName)
            +': '+cut.length+' of '+box.children.length+' child(ren) cut off'
            +(scrolls?' in a scroller':'')+bar);
        });
        /* A STICKY CHOOSER CHARGES RENT ALL NIGHT. Whatever height the rail
           takes, it takes on every screen for the whole evening. At four
           games and two rows it reached 158px of an 844px phone and pushed
           the player's own running total below the fold at the exact moment
           it counts up. A third of the viewport is the ceiling; past that
           the chooser is bigger than the thing it chooses for. */
        const railEl=document.getElementById('gameRail');
        const railH = railEl && railEl.offsetParent ? Math.round(railEl.getBoundingClientRect().height) : 0;
        const railTiles = railEl ? railEl.querySelectorAll('.grTile').length : 0;
        /* MEASURE IT WHERE IT COSTS. On the landing screen the chooser IS
           the content — "which game are you watching?" is the question that
           page exists to ask, so a third of the screen is not extravagant
           there. The cost lands on the PLAY screen, where the rail is
           sticky above a question the player is trying to answer. That is
           the number worth holding to a ceiling. */
        let railPlayH = railH;
        try{
          /* ============ 'play' IS NOT A PLACE ==========================
             This drove the app with S.place='play' — and 'play' is not a
             member of GAME_SCREENS, which is
             ["predict","lobby","live","review","predreview","break"].
             S.place is only ever assigned from that list or ''.

             So this check was green for the worst possible reason: the app
             ALSO tested for 'play', so the test and the bug agreed with
             each other about a state production can never be in. The
             collapse it certifies has never run once on a real phone. The
             founder found it the hard way on an iPad, with the question
             scrolled into the gap between three sticky bars.

             'live' is a real place — the screen with a question on it,
             which is precisely what this check is about. */
          const sp=S.place, ss=S.screen;
          S.place='live'; S.screen='live'; paintGameRail();
          railPlayH = railEl && railEl.offsetParent ? Math.round(railEl.getBoundingClientRect().height) : 0;
          S.place=sp; S.screen=ss; paintGameRail();
        }catch(_){}
        return { clipped, railH, railPlayH, railTiles, vh:window.innerHeight,
                 docW:document.documentElement.scrollWidth, vw, wide, small, tiny, tabs, focusable,
                 bodyScrollsSideways: document.documentElement.scrollWidth > vw+2,
                 hasRail: !!document.getElementById('gameRail'),
                 vxExists: typeof window.VX!=='undefined',
                 langs: (()=>{try{return VX.langs().length;}catch(_){return 0;}})() };
      }, m.kind);
    }catch(e){
      ok(m.name,'loads',false,e.message.slice(0,90));
      await ctx.close(); continue;
    }

    const touch = m.kind==='phone'||m.kind==='tablet';
    console.log('  '+m.name.padEnd(20)+String(r.vw+'px').padEnd(8)+m.engine.padEnd(10)
      +(m.note?('  '+m.note):''));

    ok(m.name,'no page errors', errs.length===0, errs.slice(0,1).join(''));
    if(r.railH>0)
      ok(m.name,'the game chooser gets out of the way during a question',
         r.railPlayH <= Math.round(r.vh/5),
         `mid-question the rail is ${r.railPlayH}px of a ${r.vh}px viewport (${r.railH}px on the landing screen, which is fine — there it IS the content). Sticky above a question the player is trying to answer.`);
    ok(m.name,'nothing is cut off inside a scroller', (r.clipped||[]).length===0,
       (r.clipped||[]).slice(0,2).join(' · ')+' — a player cannot see or reach it, and nothing indicates it exists');
    ok(m.name,'no sideways scroll', !r.bodyScrollsSideways,
       `document is ${r.docW}px in a ${r.vw}px window` + (r.wide.length?('; widest: '+r.wide.join(', ')):''));
    ok(m.name,'the four tabs are present', r.tabs.length>=4, 'nav shows '+JSON.stringify(r.tabs));
    ok(m.name,'nothing below the 12px floor', r.tiny.length===0, r.tiny.join(' · '));
    ok(m.name,'both languages offered', r.langs>=2, 'VX.langs()='+r.langs);
    if(touch) ok(m.name,'touch targets are at least 44px', r.small.length===0,
                 r.small.length+' too small: '+r.small.join(' · '));
    if(m.kind==='tv') ok(m.name,'reachable without a pointer', r.focusable>=8,
                 `only ${r.focusable} focusable elements — a D-pad sends arrows and Enter, nothing else`);

    /* The menu and the language switch, on every device. */
    try{
      const men=await p.evaluate(()=>{
        try{ openMenu(); }catch(_){ return {err:'openMenu threw'}; }
        const sh=document.getElementById('menuSheet');
        const row=[...(sh?sh.querySelectorAll('[data-m]'):[])].find(b=>b.getAttribute('data-m')==='lang');
        if(!row) return {err:'no language row'};
        const b=row.getBoundingClientRect();
        return { onScreen: b.top>=0 && b.bottom<=window.innerHeight+1 && b.width>0,
                 h:Math.round(b.height), top:Math.round(b.top), bottom:Math.round(b.bottom),
                 vh:window.innerHeight };
      });
      if(men.err) ok(m.name,'the language switch is reachable',false,men.err);
      else{
        ok(m.name,'the language switch is on screen', men.onScreen,
           `row sits ${men.top}..${men.bottom} in a ${men.vh}px window — a player would have to scroll a sheet to find it`);
        if(touch) ok(m.name,'the language row is tappable', men.h>=44, men.h+'px tall');
      }
      const sw=await p.evaluate(async()=>{
        const before=VX.lang;
        const row=[...document.querySelectorAll('#menuSheet [data-m]')].find(b=>b.getAttribute('data-m')==='lang');
        if(!row) return {err:'gone'};
        row.click(); await new Promise(r=>setTimeout(r,900));
        const txt=(document.getElementById('app')||document.body).innerText;
        const es=/premia prestar atenci|qu. partido est.s viendo|Pru.balo ahora/i.test(txt);
        /* READ IT BEFORE RESETTING. The first version put the app back to
           English and THEN reported VX.lang, so every platform came back
           "en -> en" and eleven devices looked broken while the feature
           worked perfectly. Measure, then clean up. */
        const after=VX.lang;
        try{ VX.setLang('en'); closeMenu(); }catch(_){}
        return {before, after, es};
      });
      if(!sw.err){
        ok(m.name,'tapping it switches language', sw.after!==sw.before, sw.before+' -> '+sw.after);
        ok(m.name,'and the screen actually turns Spanish', sw.es===true,
           'language changed but the visible text did not');
      }
    }catch(e){ ok(m.name,'the language switch is reachable',false,e.message.slice(0,70)); }

    /* A practice round has to start on every screen — it is the only thing
       reachable without an account, so it is the whole front door. */
    try{
      const pr=await p.evaluate(async()=>{
        try{ setMode('demo'); startQuarter(0); }catch(e){ return {err:e.message}; }
        await new Promise(r=>setTimeout(r,900));
        const q=document.getElementById('qText');
        const opts=document.querySelectorAll('#qOpts .opt').length;
        return { q:(q&&q.textContent||'').trim().slice(0,40), opts };
      });
      if(pr.err) ok(m.name,'a practice round starts',false,pr.err.slice(0,70));
      else ok(m.name,'a practice round starts', pr.opts>=2 && pr.q.length>2,
              `question "${pr.q}", ${pr.opts} options`);
    }catch(e){ ok(m.name,'a practice round starts',false,e.message.slice(0,70)); }

    await ctx.close();
  }
  for(const k in browsers) await browsers[k].close();

  console.log('\n'+'-'.repeat(64));
  console.log((fail?'RED':'GREEN')+'   '+pass+' passed, '+fail+' failed   across '+list.length+' platform(s)');
  bad.forEach(x=>console.log('   x '+x));
  console.log('\nNOT PROVEN HERE — these need a human on a real device:');
  console.log('  · the iOS microphone (Safari opens it from a gesture and nothing else)');
  console.log('  · a real TV remote, and reading distance');
  console.log('  · notches, safe-area insets, system fonts, battery');
  process.exit(fail?1:0);
})();
