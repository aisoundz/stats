/* ============ qa/pick-reach.js =======================================
   THE WAY FORWARD MUST BE UNDER YOUR THUMB.

   From the demo, 22 August: "When someone was putting in their picks they
   had to scroll to the bottom of the page for locked in or next. It
   should be [pinned] on the bottom of the screen to make it [visible] no
   matter if you're at the top of the picks or the bottom. The user
   shouldn't scroll down to find next or lock."

   A basketball pick is a twelve-name roster in two columns. Back and Next
   sat after the options, so the control that advances the card was most
   of a screen below the thumb that had just tapped a name — every pick
   cost a scroll down to move on and a scroll back up to read the next
   question.

   Nothing in the suite could see this. The buttons existed, they were
   bound, they worked, and every check that asked "is the control present"
   said yes. The question that matters is WHERE it is when you need it.
   ================================================================== */
const {chromium}=require('playwright');
const path=require('path');
const { waitReady } = require('./ready.js');
const FILE='file://'+path.join(__dirname,'..','index-test.html');
let pass=0, fail=0;
const ok =(n,d)=>{pass++; console.log('  ok   '+n+(d?('   '+d):''));};
const bad=(n,d)=>{fail++; console.log('  FAIL '+n+(d?'\n         '+d:''));};

/* The small phone. If it is reachable here it is reachable everywhere. */
const VPS=[{n:'iPhone SE',w:375,h:667},{n:'iPhone 15',w:393,h:852}];

  /* Ask the browser what is ACTUALLY at the middle of each visible answer.
     The only question that catches an overlay, and the one no other check
     on this page asks. Must be run at a DEFINED scroll position — the
     first version ran it after a Next tap, on a different card, at
     whatever offset happened to be left over, and reported options as
     covered that were simply scrolled off the top. */
  const coveredNow = (p) => p.evaluate(()=>{
    const out=[];
    document.querySelectorAll('#predCard .pdopt').forEach((o,i)=>{
      const r=o.getBoundingClientRect();
      if(r.width<4 || r.height<4) return;
      if(r.bottom<=0 || r.top>=window.innerHeight) return;   // off-screen is a scroll, not an overlay
      const x=Math.round(r.left+r.width/2), y=Math.round(r.top+r.height/2);
      const hit=document.elementFromPoint(x,y);
      if(!hit) return;
      if(o===hit || o.contains(hit) || hit.contains(o)) return;
      /* ONLY A FIXED BLOCKER IS A BUG. A sticky header — the question and
         its stake, pinned to the top of its own card so you can see what
         you are answering — covers whatever scrolls beneath it, and that
         is what sticky is FOR: scroll a little further and the option
         comes out below it. A `position:fixed` element does not move, so
         anything under it is unreachable at every scroll position, and
         that is what put an answer out of reach on a 375px phone.
         Flagging the sticky header too would make this check unpassable
         and it would be wrong. */
      let node = hit, fixed = null;
      while(node && node !== document.body){
        if(getComputedStyle(node).position === 'fixed'){ fixed = node; break; }
        node = node.parentElement;
      }
      if(!fixed) return;
      const blocker = fixed.id ? ('#'+fixed.id) : (fixed.className ? ('.'+String(fixed.className).split(' ')[0]) : fixed.tagName);
      out.push('option '+(i+1)+' is under the fixed '+blocker);
    });
    return out;
  });

(async()=>{
  const b=await chromium.launch();
  for(const vp of VPS){
    const p=await b.newPage({viewport:{width:vp.w,height:vp.h}});
    const errs=[]; p.on('pageerror',e=>errs.push(String(e&&e.message||e)));
    await p.goto(FILE, { waitUntil: 'domcontentloaded' });
    /* waitReady(), not a fixed sleep. qa/stats-page.js slept 1300ms for
     boot and, on a loaded machine, called into an app that was not
     there yet — its catch swallowed the ReferenceError and a whole
     sport section was skipped behind one red line, differently on
     every run. A guess at boot is a guess at coverage. */
    await waitReady(p);
    await p.evaluate(()=>{ startDemo(); S.name='QA'; startPredict(); });
    await p.waitForTimeout(700);

    console.log('\n  ── '+vp.n+' ('+vp.w+'x'+vp.h+')');

    /* Scroll to the very BOTTOM of the longest card — the roster pick —
       which is exactly where a player is standing when they have just
       chosen a name and want to move on. */
    const at = async () => p.evaluate(()=>{
      const app=document.getElementById('app');
      const vh=window.innerHeight;
      const seen=(el)=>{ if(!el) return null; const r=el.getBoundingClientRect();
        return { top:Math.round(r.top), bottom:Math.round(r.bottom),
                 onScreen: r.bottom>0 && r.top<vh && r.width>0 && r.height>0 }; };
      const bar=document.getElementById('pdBar');
      const next=document.querySelector('#pdBar [data-pdgo="1"]');
      const back=document.querySelector('#pdBar [data-pdgo="-1"]');
      const lock=document.getElementById('pdLock');
      /* THE WINDOW IS THE SCROLLER, not #app. #app is `overflow:clip` and
         sized to its content, so scrollHeight-clientHeight is 0 on it no
         matter how long the card is — and the first version of this check
         read exactly that and concluded a 2,222px roster card "fits
         without scrolling". Measuring the wrong element is how a check
         reports on the easy case forever. */
      const doc=document.scrollingElement||document.documentElement;
      return { scrollTop:doc.scrollTop,
               scrollable:(doc.scrollHeight-doc.clientHeight),
               bar:seen(bar), next:seen(next), back:seen(back), lock:seen(lock),
               barFixed: bar?getComputedStyle(bar).position:'(none)' };
    });

    /* GO TO THE LONGEST CARD, which is the one the report is about. The
       first pick is the winning team — two options, fits any screen, and
       proves nothing. A player pick is a twelve-name roster and that is
       where the way forward disappeared. */
    const jumped = await p.evaluate(async ()=>{
      for(let i=0;i<preds.length;i++){
        try{ predJump(i); }catch(_){}
        await new Promise(r=>setTimeout(r,120));
        const n=document.querySelectorAll('#predCard .pdopt').length;
        if(n>=8) return {i, n};
      }
      return {i:-1, n:document.querySelectorAll('#predCard .pdopt').length};
    });
    await p.waitForTimeout(300);
    if(jumped.i>=0) ok('found the long card to test on', 'pick '+(jumped.i+1)+', '+jumped.n+' options');
    else bad('found the long card to test on',
             'no pick on this sheet has 8+ options — the roster card is the case the founder reported');

    /* answer it so the lock button exists at all */
    await p.click('#predCard .pdopt').catch(()=>{});
    await p.waitForTimeout(350);

    const top = await at();
    if(top.barFixed==='fixed') ok('the bar is pinned, not in the page flow', 'position:'+top.barFixed);
    else bad('the bar is pinned, not in the page flow', 'position:'+top.barFixed+' — it will scroll away with the roster');

    if(top.next && top.next.onScreen) ok('Next is on screen at the TOP of the card');
    else bad('Next is on screen at the TOP of the card', JSON.stringify(top.next));

    /* now go to the bottom, where the reported bug lives */
    await p.evaluate(()=>{ const d=document.scrollingElement||document.documentElement; d.scrollTop=d.scrollHeight; });
    await p.waitForTimeout(300);
    /* AT THE TOP OF THE CARD — where a player starts answering. */
    const covTop = await coveredNow(p);
    if(!covTop.length) ok('nothing sits on top of the answers at the top of the card');
    else bad('nothing sits on top of the answers at the top of the card',
             covTop.slice(0,3).join('; ')+' — visible, and not tappable');

    const barH = await p.evaluate(()=>{ const b=document.getElementById('pdBar');
      return b?Math.round(b.getBoundingClientRect().height):-1; });
    const budget = Math.round(vp.h * 0.16);
    if(barH>0 && barH<=budget) ok('the pinned bar stays within its budget', barH+'px of '+vp.h+' (max '+budget+')');
    else bad('the pinned bar stays within its budget',
             barH+'px on a '+vp.h+'px screen — over '+budget+'px it starts eating the question');

    const bot = await at();

    /* If the long card does not overflow the screen there is nothing to
       scroll past and the check proves nothing — say so as a FAILURE, not
       a note. A test that quietly measures the easy case is the vacuous
       pass this repo keeps producing. */
    if(bot.scrollable>80) ok('the card really is longer than the screen', bot.scrollable+'px of scroll');
    else bad('the card really is longer than the screen',
             'only '+bot.scrollable+'px of scroll on a '+vp.h+'px screen — nothing below the fold, so the '+
             'reachability checks below are not exercising the reported case');

    [['Next','next'],['Back','back'],['Lock','lock']].forEach(([label,key])=>{
      const g=bot[key];
      if(g && g.onScreen) ok(label+' is still on screen at the BOTTOM of the roster');
      else bad(label+' is still on screen at the BOTTOM of the roster',
               'it is '+(g?('at top='+g.top+' with the viewport '+vp.h+' tall'):'not rendered')+
               ' — this is the reported bug: you have to scroll to find it');
    });

    /* AND AT THE BOTTOM — where the reported scroll problem lives. */
    const covBot = await coveredNow(p);
    if(!covBot.length) ok('nothing sits on top of the answers at the bottom of the roster');
    else bad('nothing sits on top of the answers at the bottom of the roster',
             covBot.slice(0,3).join('; ')+' — the bar is covering the last picks');

    /* and it must actually work from there, not merely be visible */
    const before = await p.evaluate(()=>PD.i);
    await p.click('#pdBar [data-pdgo="1"]').catch(()=>{});
    await p.waitForTimeout(350);
    const after = await p.evaluate(()=>PD.i);
    if(after===before+1) ok('tapping Next in the bar advances the card', before+' -> '+after);
    else bad('tapping Next in the bar advances the card',
             'card index went '+before+' -> '+after+' — the control renders and does nothing');

    /* one control per job: the nav must not exist twice */
    const dupes = await p.evaluate(()=>document.querySelectorAll('[data-pdgo="1"]').length);
    if(dupes===1) ok('there is exactly one Next on the screen');
    else bad('there is exactly one Next on the screen', dupes+' found — two controls for one job is how they disagree');

    /* ============ AND THE LIVE LOOP, WHICH MATTERS MORE ===============
       The pick sheet happens once. The live question happens sixteen
       times a night, and its own reveal copy says "nothing's final until
       you hit the button below" — which on a phone was below the reveal
       box, below the options, below the voice row. The founder's demo
       player could not find it, and neither could he.

       Answer a question for real and demand the confirm button is on
       screen without scrolling. */
    await p.evaluate(()=>{ try{ startQuarter(0); }catch(_){} });
    await p.waitForTimeout(600);
    const liveOk = await p.evaluate(()=>{
      const o=document.querySelector('#qOpts .opt, #qOpts button');
      if(!o) return {err:'no options on the live question'};
      o.click();
      return {clicked:true};
    });
    await p.waitForTimeout(600);
    if(liveOk.err){ bad('the live question offers an answer to tap', liveOk.err); }
    else {
      const nb = await p.evaluate(()=>{
        const b=document.getElementById('nextBtn');
        if(!b) return {there:false};
        const cs=getComputedStyle(b), r=b.getBoundingClientRect();
        return { there: cs.display!=='none', pos: cs.position,
                 onScreen: r.bottom>0 && r.top<window.innerHeight && r.height>0,
                 top: Math.round(r.top), vh: window.innerHeight,
                 label: (b.textContent||'').trim() };
      });
      if(!nb.there) bad('the confirm button appears after answering', 'it is still display:none');
      else if(nb.onScreen) ok('the confirm button is on screen without scrolling', '"'+nb.label+'" at y='+nb.top+', position:'+nb.pos);
      else bad('the confirm button is on screen without scrolling',
               '"'+nb.label+'" is at y='+nb.top+' on a '+nb.vh+'px screen — the reveal copy says "the button below" and it is below the fold');

      /* and it must not be sitting on the answers either — after the
         page has had its beat to step aside. */
      await p.waitForTimeout(350);
      const liveCovered = await p.evaluate(()=>{
        const out=[];
        document.querySelectorAll('#qOpts button, #qOpts .opt').forEach((o,i)=>{
          const r=o.getBoundingClientRect();
          if(r.width<4||r.height<4||r.bottom<=0||r.top>=window.innerHeight) return;
          const hit=document.elementFromPoint(Math.round(r.left+r.width/2), Math.round(r.top+r.height/2));
          if(!hit || o===hit || o.contains(hit) || hit.contains(o)) return;
          let n=hit, fixed=null;
          while(n && n!==document.body){ if(getComputedStyle(n).position==='fixed'){ fixed=n; break; } n=n.parentElement; }
          if(fixed) out.push('answer '+(i+1)+' is under the fixed '+(fixed.id?('#'+fixed.id):fixed.tagName));
        });
        return out;
      });
      if(!liveCovered.length) ok('the pinned button is not covering the answers');
      else bad('the pinned button is not covering the answers', liveCovered.slice(0,2).join('; '));
    }

    if(errs.length) bad('no page errors', errs.slice(0,2).join(' | '));
    else ok('no page errors');
    await p.close();
  }
  console.log('\n  '+pass+' passed, '+fail+' failed');
  await b.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.log('  FATAL '+e.message); process.exit(1); });
