const PW=require('/home/higherthan7/stats/node_modules/playwright');
const F=process.argv[2]||process.cwd()+'/v75.html';
(async()=>{
  const b=await PW.firefox.launch(); const p=await b.newPage({viewport:{width:390,height:844}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  let pass=0,fail=0;
  const ok=(n,c,d)=>{c?pass++:fail++;console.log((c?'  ok   ':'  FAIL ')+n+(d?'   '+d:''));};
  await p.goto('file://'+F,{waitUntil:'load'}); await p.waitForTimeout(300);

  ok('the four tabs still spell the product',
     (await p.locator('nav button').allInnerTexts()).join(' · ')==='Home · Stats · Gametime · Board',
     (await p.locator('nav button').allInnerTexts()).join(' · '));

  await p.locator('nav [data-t="game"]').click(); await p.waitForTimeout(300);
  ok('trash talk is a section in the room', await p.locator('#talkCard').count()===1);
  ok('and no redundant button above it',
     await p.locator('#ttBtn').count()===0
     && !/^\s*Talk trash\s*$/m.test(await p.locator('#v').innerText()));
  ok('the thread is labelled with THIS room',
     (await p.locator('#talkCard .lab .r').innerText()).includes('ARS AT AVL'),
     await p.locator('#talkCard .lab .r').innerText());

  // ---- THE LEAK TEST ----
  const before1 = await p.evaluate(()=>ROOMS[1].talk.length);
  await p.locator('#roomIn').fill('SECRET-ARS-ONLY'); await p.waitForTimeout(80);
  await p.locator('#roomGo').click(); await p.waitForTimeout(300);
  ok('message lands in room 0', (await p.locator('#talkBody').innerText()).includes('SECRET-ARS-ONLY'));

  await p.locator('[data-g="1"]').first().click(); await p.waitForTimeout(350);
  const body1 = await p.locator('#talkBody').innerText();
  ok('room 1 does NOT show room 0 message', !body1.includes('SECRET-ARS-ONLY'),
     JSON.stringify(body1.slice(0,52)));
  ok('room 1 length unchanged', (await p.evaluate(()=>ROOMS[1].talk.length))===before1);
  ok('room 1 shows its OWN thread', body1.includes('Assad at eleven pitches'));
  // The leak came back once as a SECOND copy of the feature on another
  // tab. So the guard is not "room threads differ" — it is "no chat lives
  // anywhere except the room", checked on every other tab.
  for (const t of ['home','stats','board']){
    await p.locator('nav [data-t="'+t+'"]').click(); await p.waitForTimeout(260);
    const txt=await p.locator('#v').innerText();
    ok('no chat thread on the '+t+' tab',
       !/Assad is at eleven pitches|Twenty-five or more in the first|Fifteen threes/.test(txt)
       && await p.locator('#v #talkBody').count()===0);
  }
  await p.locator('nav [data-t="game"]').click(); await p.waitForTimeout(280);

  // A generated line is content too, so it can leak the same way. Assert it
  // NAMES this game — a line that mentions no team here came from elsewhere.
  const lines=await p.evaluate(()=>Object.keys(ROOMS).map(k=>{
    const g=GAMES[k], t=roomLine(g,ROOMS[k]);
    const mine=[g.a,g.h,g.an,g.hn].some(x=>t.indexOf(x)>=0);
    const other=GAMES.filter((_,i)=>String(i)!==k)
      .some(o=>[o.an,o.hn].some(x=>t.indexOf(x)>=0)) ||
      /Assad|Wrigley|Hoerner|Watkins/.test(t);
    return {room:g.a+' v '+g.h, mine, other, t:t.slice(0,44)};
  }));
  ok('every generated line names the game it is in OR names no game at all',
     lines.every(l=>!l.other), JSON.stringify((lines.find(l=>l.other)||{}).t||''));
  ok('no generated line borrows another room\'s players',
     lines.every(l=>!/Assad|Hoerner|Watkins|Collier/.test(l.t)));

  ok('every room has a separate array',
     await p.evaluate(()=>new Set(Object.keys(ROOMS).map(k=>ROOMS[k].talk)).size===Object.keys(ROOMS).length));

  await p.locator('[data-g="0"]').first().click(); await p.waitForTimeout(350);
  ok('going back, room 0 still has it', (await p.locator('#talkBody').innerText()).includes('SECRET-ARS-ONLY'));
  ok('140 char cap in TALK mode', await p.locator('#roomIn').getAttribute('maxlength')==='140');
  if (await p.locator('[data-rm="ask"]').count()){
    await p.locator('[data-rm="ask"]').click(); await p.waitForTimeout(250);
    ok('the cap is lifted for a question', await p.locator('#roomIn').getAttribute('maxlength')===null);
    await p.locator('[data-rm="talk"]').click(); await p.waitForTimeout(250);
  } else ok('the cap is lifted for a question', false, 'ASK mode is missing');

  // The founder's entry point: the button must land you ON the thread with
  // the cursor ready — not just focus a box that is scrolled off screen.
  await p.locator('nav [data-t="home"]').click(); await p.waitForTimeout(280);
  ok('no Talk trash button on Home', await p.locator('#homeTalk').count()===0);
  ok('Home carries no "talk trash" call to action at all',
     !/talk trash/i.test(await p.locator('#v').innerText()));
  await p.evaluate(()=>openTalk()); await p.waitForTimeout(750);
  ok('the menu entry still reaches the thread', (await p.evaluate(()=>tab))==='game');
  ok('cursor is in the box', (await p.evaluate(()=>document.activeElement&&document.activeElement.id))==='roomIn');
  const seen=await p.evaluate(()=>{const r=document.getElementById('talkCard').getBoundingClientRect();
    return {top:Math.round(r.top), ok:r.top>-40&&r.top<innerHeight};});
  ok('the thread itself is on screen', seen.ok, 'card top = '+seen.top+'px');
  const nb=await p.evaluate(()=>ROOMS[ACTIVE].talk.length);
  await p.locator('#roomIn').fill('ENTER-SENDS'); await p.locator('#roomIn').press('Enter');
  await p.waitForTimeout(280);
  ok('Enter submits (the bug class this app already had)',
     (await p.evaluate(()=>ROOMS[ACTIVE].talk.length))===nb+1);

  // ---- ASK STATS ----
  // ONE INPUT, TWO MODES — the whole point of the merge.
  ok('the room has exactly ONE text input',
     await p.locator('#v input.inp').count()===1,
     (await p.locator('#v input.inp').count())+' inputs');
  ok('exactly one send button', await p.locator('#roomGo').count()===1);
  const modes=await p.locator('[data-rm]').allInnerTexts();
  ok('both modes are reachable from one toggle',
     modes.length===2 && /TALK/.test(modes[0]) && /ASK/.test(modes[1]), JSON.stringify(modes));
  if (await p.locator('[data-rm="ask"]').count()){
    await p.locator('[data-rm="ask"]').click(); await p.waitForTimeout(280);
  }
  ok('switching to ASK keeps it to one input',
     await p.locator('#v input.inp').count()===1);
  const cross=await p.evaluate(async ()=>{
    const before={talk:ROOMS[ACTIVE].talk.length, ask:askLog.length};
    roomMode='ask';
    const i=document.getElementById('roomIn');
    i.value='HOW MANY POINTS DO I HAVE'; i.dispatchEvent(new Event('input'));
    document.getElementById('roomGo').click();
    await new Promise(r=>setTimeout(r,120));
    return {before, talk:ROOMS[ACTIVE].talk.length, ask:askLog.length,
            leaked:(ROOMS[ACTIVE].talk||[]).some(m=>/HOW MANY POINTS/.test(m.m||''))};
  });
  ok('a question does NOT post into the trash-talk thread',
     cross.talk===cross.before.talk && !cross.leaked,
     'talk '+cross.before.talk+'->'+cross.talk+(cross.leaked?' LEAKED':''));
  ok('a question DOES reach the answer log', cross.ask>cross.before.ask,
     'ask '+cross.before.ask+'->'+cross.ask);

  ok('the send button relabels for the mode',
     (await p.locator('#roomGo').innerText()).includes('Ask'),
     await p.locator('#roomGo').innerText());
  await p.locator('[data-ask="0"]').click(); await p.waitForTimeout(300);
  const log=await p.evaluate(()=>askLog[askLog.length-1]);
  ok('answers the score from a named field', /kicked off|ARS|AVL/.test(log.t)&&!!log.s, log.t.slice(0,58));
  ok('every answer cites its source', /schedule|scoreboard|nights\//.test(log.s), log.s);

  const ref=await p.evaluate(()=>askAnswer('who will win the super bowl in 2031'));
  ok('REFUSES what it does not know', ref.no===true && !/\d{2,}/.test(ref.t), JSON.stringify(ref.t));
  ok('the refusal lists what it CAN do', /score|card|points/.test(ref.s));
  // EVERY answer, in EVERY room state — pre, live and final each take a
  // different branch, and testing one game only exercised the pre branch.
  const inv=await p.evaluate(()=>{
    const bad=[];
    Object.keys(ROOMS).forEach(k=>{
      const g=GAMES[k], R=ROOMS[k];
      ASK.forEach((x,xi)=>{
        const r=x.a(g,R);
        if(!r || !r.s || !String(r.s).trim()) bad.push(g.a+'/'+g.state+' ask#'+xi+' no source');
        if(/\d/.test(String(r.t)) && !String(r.s).trim()) bad.push(g.a+' ask#'+xi+' number, no source');
      });
    });
    return bad;
  });
  ok('every answer in every room state cites a source', inv.length===0, inv.slice(0,3).join(' · '));

  // ---- HOME: the sign-up must stay above the fold ----------------
  // The slate caption was 175px of prose explaining a control that already
  // says TAP TO ENTER, and it pushed the sign-up card off a 844px screen.
  // Guard the OUTCOME (what the viewer can see), not the absence of one
  // element — anything else added above it fails this the same way.
  await p.locator('nav [data-t="home"]').click(); await p.waitForTimeout(350);
  const home=await p.evaluate(()=>{
    // Find it by the FIELD it contains, not by a label string — a label is
    // copy and copy gets rewritten. The email input is the thing that makes
    // this the sign-up, and it survives any renaming of the card around it.
    const input=document.querySelector('#v input[type="email"]');
    const card=input?input.closest('.card'):null;
    const r=card?card.getBoundingClientRect():null;
    return {found:!!card, top:r?Math.round(r.top+scrollY):null, vh:innerHeight,
            caption:/Every game gets a room/.test(document.getElementById('v').innerText),
            count:/ROOMS OPEN/.test(document.getElementById('v').innerText)};
  });
  // Two assertions, because "I could not find it" and "it is below the fold"
  // are different failures and one sentinel value was hiding that.
  ok('the sign-up is on Home at all', home.found);
  ok('the sign-up is above the fold on a 844px screen',
     home.found && home.top>=0 && home.top < home.vh,
     home.found ? ('top='+home.top+'px, fold='+home.vh+'px') : 'card not found');
  ok('Home does not explain a control that labels itself', !home.caption);
  ok('the room count survived the cut', home.count);

  // ---- ONE FACT, ONE CARD · ONE GRADIENT --------------------------
  const hm=await p.evaluate(()=>{
    const v=document.getElementById('v');
    const btns=[...v.querySelectorAll('button')].filter(b=>b.offsetWidth>200);
    return {
      grad: btns.filter(b=>/gradient/.test(getComputedStyle(b).backgroundImage))
                .map(b=>b.innerText.trim()),
      runBlocks: [...v.querySelectorAll('.card,.met')]
                 .filter(c=>/days straight|CURRENT RUN|KEEP THE STREAK/i.test(c.innerText)).length,
      streakMentions: (v.innerText.match(/\b13\b/g)||[]).length,
      escapeIsLink: !!v.querySelector('.lnk'),
      escapeIsButton: btns.some(b=>/without an account/i.test(b.innerText)
                       && getComputedStyle(b).borderTopWidth!=='0px'),
      h: Math.round(v.getBoundingClientRect().height)
    };
  });
  ok('exactly one gradient CTA on Home', hm.grad.length===1, JSON.stringify(hm.grad));
  ok('the gradient is on the daily action, not the ask',
     /tape/i.test(hm.grad[0]||''), JSON.stringify(hm.grad[0]));
  ok('the streak is told in ONE block', hm.runBlocks===1, hm.runBlocks+' blocks');
  ok('the streak number is printed once', hm.streakMentions===1, hm.streakMentions+'x');
  ok('the escape hatch is a link, not a button', hm.escapeIsLink && !hm.escapeIsButton);
  ok('Home fits under 1.6 screens', hm.h < 844*1.6, hm.h+'px = '+(hm.h/844).toFixed(1)+' screens');

  // ---- THE BUILD STAMP ------------------------------------------
  // It exists so a cached file is distinguishable from a live one. That
  // only works if it is (a) present, (b) not the placeholder, and (c) the
  // same value everywhere it appears. A stamp that silently ships as
  // "DEVBUILD" is worse than none — it looks like an answer.
  const stamp=await p.evaluate(()=>{
    const meta=document.querySelector('meta[name=build]');
    const foot=document.getElementById('footBuild');
    return {meta:meta?meta.getAttribute('content'):null,
            foot:foot?foot.textContent.trim():null};
  });
  ok('a build stamp is present', !!stamp.meta && !!stamp.foot, JSON.stringify(stamp));
  // DEVBUILD is correct in the SOURCE and a defect in anything delivered.
  // The placeholder shipping is the whole failure this stamp guards, so a
  // file outside the working directory must never carry it.
  // The SOURCE keeps DEVBUILD; only a file that went through deliver.sh
  // carries a hash. Identify the source by name, not by directory — this
  // suite moved out of the scratchpad and the old path test then called
  // the source "delivered" and went red for no reason.
  const delivered = !/\/v75\.html$/.test(F);
  if (delivered) ok('a delivered file carries a real hash, not the placeholder',
                    stamp.meta!=='DEVBUILD', stamp.meta);
  else ok('the source keeps the placeholder for the delivery step to fill',
          stamp.meta==='DEVBUILD', stamp.meta);
  ok('the footer stamp matches the meta stamp',
     (stamp.foot||'').toLowerCase()===(stamp.meta||'').toLowerCase(), JSON.stringify(stamp));
  ok('the footer carries the build, not an engineering note',
     !/prototype|feed-resolved/i.test(await p.locator('.foot').innerText()),
     await p.locator('.foot').innerText());

  // ---- THE LEADERBOARD FOLLOWS THE ROOM ---------------------------
  // The failure this guards is a stats tab that is confidently wrong about
  // which sport you are watching. Checked in EVERY room, because it was
  // rendered from two functions and could be fixed in only one of them.
  const boards=[];
  for (const i of [0,1,2,3,4]){
    // Home PREVIEWS; you have to enter, or this tests one room five times.
    await p.locator('nav [data-t="home"]').click(); await p.waitForTimeout(180);
    await p.locator('[data-g="'+i+'"]').first().click(); await p.waitForTimeout(190);
    await p.locator('#enterRoom').click(); await p.waitForTimeout(230);
    await p.locator('nav [data-t="stats"]').click(); await p.waitForTimeout(260);
    boards.push(await p.evaluate(()=>{
      const g=GAMES[ACTIVE];
      const lab=[...document.querySelectorAll('#v .lab')].find(x=>/LEADERS/.test(x.innerText));
      return {code:g.code, lg:g.lg,
        heading: lab?lab.innerText.split('\n')[0]:'',
        cats:[...document.querySelectorAll('[data-lc]')].map(x=>x.innerText),
        rows: document.querySelectorAll('#v .row').length,
        src: (()=>{const p2=[...document.querySelectorAll('#v p')].find(x=>/core\.api\.espn/.test(x.innerText));
              return p2?p2.innerText:'';})()};
    }));
  }
  ok('every room shows ITS OWN league in the heading',
     boards.every(b=>b.heading.includes(b.lg.toUpperCase())),
     boards.map(b=>b.code+':'+b.heading).join(' | ').slice(0,90));
  ok('no room shows another league\'s table',
     boards.every(b=>!boards.some(o=>o.lg!==b.lg && b.heading.includes(o.lg.toUpperCase()))));
  ok('each league has its own categories', boards.every(b=>b.cats.length>=4),
     boards.map(b=>b.code+':'+b.cats.length).join(' '));
  const eplB=boards.find(b=>b.code==='EPL'), wnbaB=boards.find(b=>b.code==='WNBA');
  ok('all five rooms were actually visited',
     !!eplB && !!wnbaB && new Set(boards.map(b=>b.code)).size===5,
     boards.map(b=>b.code).join(','));
  ok('soccer and basketball categories are actually different',
     !!eplB && !!wnbaB && JSON.stringify(eplB.cats)!==JSON.stringify(wnbaB.cats));
  ok('every table cites its feed source', boards.every(b=>/core\.api\.espn/.test(b.src)));
  // THE HEADING IS NOT THE DATA. Pinning the table to one league still
  // prints the room's league in the heading — correct label, wrong numbers,
  // which is worse than an obvious mismatch. So assert the CATEGORIES are
  // ones that league actually has.
  const MUST={EPL:'Goals', MLS:'Goals', WNBA:'Points Per Game',
              MLB:'Home Runs', NFL:'Passing Yards'};
  const wrong=boards.filter(b=>!b.cats.includes(MUST[b.code]));
  ok('the DATA matches the league, not just the heading',
     wrong.length===0,
     wrong.map(b=>b.code+' lacks "'+MUST[b.code]+'" · has '+b.cats.slice(0,2).join('/')).join(' | '));
  const NEVER={WNBA:'Goals', MLB:'Points Per Game', NFL:'Goals', EPL:'Home Runs', MLS:'Passing Yards'};
  ok('and carries no other sport\'s category',
     boards.every(b=>!b.cats.includes(NEVER[b.code])),
     boards.filter(b=>b.cats.includes(NEVER[b.code])).map(b=>b.code).join(','));
  ok('no leaderboard is empty', boards.every(b=>b.rows>=5), boards.map(b=>b.rows).join(','));

  // ---- THE SLATE IS A PICKER ON HOME ------------------------------
  await p.locator('nav [data-t="home"]').click(); await p.waitForTimeout(240);
  const order=await p.evaluate(()=>[...document.querySelectorAll('#v > *')].slice(0,3)
    .map(e=>e.className||e.tagName.toLowerCase()));
  ok('the slate sits ABOVE the hero', /railhd/.test(order[0]) && /railwrap/.test(order[1])
     && /hero/.test(order[2]), order.join(' -> '));
  const roomBefore=await p.evaluate(()=>ACTIVE);
  await p.locator('[data-g="3"]').first().click(); await p.waitForTimeout(240);
  ok('tapping the slate does NOT move you out of your room',
     (await p.evaluate(()=>ACTIVE))===roomBefore && (await p.evaluate(()=>tab))==='home');
  ok('but the hero below follows the tap',
     (await p.locator('.hero .fc .nm').first().innerText())==='REVOLUTION',
     await p.locator('.hero .fc .nm').first().innerText());
  ok('and the button names where it would take you',
     /Enter NE at CLB/.test(await p.locator('#enterRoom').innerText()),
     await p.locator('#enterRoom').innerText());
  await p.locator('#enterRoom').click(); await p.waitForTimeout(280);
  ok('entering is what actually moves you',
     (await p.evaluate(()=>tab))==='game' && (await p.evaluate(()=>ACTIVE))===3);

  // ---- VOICE SITS ON THE INPUT, IN BOTH MODES ---------------------
  ok('the mic is on the room input', await p.locator('#roomMic').count()===1);
  ok('still exactly one text input beside it', await p.locator('#v input.inp').count()===1);
  await p.locator('[data-rm="ask"]').click(); await p.waitForTimeout(240);
  ok('the mic is there in ASK mode too', await p.locator('#roomMic').count()===1);
  ok('the placeholder offers voice first',
     /out loud|Say it/.test(await p.locator('#roomIn').getAttribute('placeholder')),
     await p.locator('#roomIn').getAttribute('placeholder'));

  // ---- THE WATCHLIST IS A CHOICE ----------------------------------
  await p.locator('nav [data-t="home"]').click(); await p.waitForTimeout(200);
  await p.locator('[data-g="0"]').first().click(); await p.waitForTimeout(200);
  await p.locator('#enterRoom').click(); await p.waitForTimeout(300);
  const w=await p.evaluate(async()=>{
    const R=ROOMS[ACTIVE]; R.wpick=[];
    return {opts:document.querySelectorAll('[data-w]').length,
            cap:WATCH_PICKS, priced:Object.keys(WATCHSET)};
  });
  ok('there are more options than slots', w.opts>w.cap, w.opts+' options, '+w.cap+' slots');
  const picks=await p.evaluate(async()=>{
    for (const i of [0,1,2,3]){ const b=document.querySelector('[data-w="'+i+'"]');
      if(b && !b.disabled) b.click(); await new Promise(r=>setTimeout(r,90)); }
    return ROOMS[ACTIVE].wpick.length;
  });
  ok('you cannot take more than three', picks===3, 'took '+picks);
  // EVERY league, not just the one that was measured first. The rule is the
  // same everywhere: no free points, nothing unmeasurable, rarer pays more,
  // and the price is 5/rate — so a wrong rate shows up as a wrong price.
  const wall=await p.evaluate(()=>{
    const bad=[];
    Object.keys(WATCHSET).forEach(k=>{
      const W=WATCHSET[k];
      if(W.items.length<5) bad.push(k+' has only '+W.items.length+' items');
      if(W.n<15) bad.push(k+' measured on only '+W.n+' games');
      W.items.forEach(it=>{
        const rate=it[1]/W.n;
        if(rate>=0.9) bad.push(k+' free point: '+it[0]);
        if(rate<=0.02) bad.push(k+' unmeasurable: '+it[0]);
        const want=Math.min(40,Math.max(5,Math.round(5/rate)));
        if(it[2]!==want) bad.push(k+' "'+it[0]+'" priced '+it[2]+' should be '+want);
      });
      for(let i=1;i<W.items.length;i++){
        if(W.items[i][1]>W.items[i-1][1]) bad.push(k+' not ordered by rarity');
        if(W.items[i][2]<W.items[i-1][2]) bad.push(k+' a rarer item pays less');
      }
      if(!W.src) bad.push(k+' cites no source');
    });
    return bad;
  });
  ok('every league is priced from measured rates', wall.length===0, wall.slice(0,3).join(' · '));
  // PRICED IS NOT SHIPPED. Four leagues had a fully measured table that no
  // room ever rendered, because watchCard() was called from roomPre() only.
  // The data being right is not the claim; the screen showing it is.
  const wlSeen=[];
  for (const i of [0,1,2,3,4]){
    await p.locator('nav [data-t="home"]').click(); await p.waitForTimeout(170);
    await p.locator('[data-g="'+i+'"]').first().click(); await p.waitForTimeout(180);
    await p.locator('#enterRoom').click(); await p.waitForTimeout(270);
    wlSeen.push(await p.evaluate(()=>({code:GAMES[ACTIVE].code, state:GAMES[ACTIVE].state,
      rows:document.querySelectorAll('[data-w]').length})));
  }
  ok('every league RENDERS its watchlist, in every room state',
     wlSeen.every(x=>x.rows>0), wlSeen.map(x=>x.code+'/'+x.state+':'+x.rows).join(' '));
  const cap=await p.evaluate(()=>WATCH_PICKS);   // page global, not a Node one
  ok('a settled room shows what you took, not the whole menu',
     wlSeen.filter(x=>x.state!=='pre').every(x=>x.rows>0 && x.rows<=cap),
     wlSeen.map(x=>x.code+'/'+x.state+':'+x.rows).join(' ')+' cap='+cap);
  ok('all five leagues have a watchlist',
     await p.evaluate(()=>['epl','mls','wnba','mlb','nfl'].every(k=>WATCHSET[k])));
  // EPL and MLS are both soccer and must NOT share a table.
  ok('soccer is priced per league, not per sport',
     await p.evaluate(()=>{
       const a=WATCHSET.epl.items.find(x=>/corners/i.test(x[0]));
       const b=WATCHSET.mls.items.find(x=>/corners/i.test(x[0]));
       return a && b && a[2]!==b[2]; }));

  // ---- EVERYTHING: a directory that tells the truth -----------------
  await p.locator('#burg').click(); await p.waitForTimeout(230);
  await p.locator('[data-m="every"]').click(); await p.waitForTimeout(320);
  const ev=await p.evaluate(()=>{
    const rows=[...document.querySelectorAll('.evr')];
    return {n:rows.length,
      labelled: rows.every(r=>r.querySelector('.evs')),
      live: rows.filter(r=>r.querySelector('.evs.live')).length,
      // A row marked live must actually GO somewhere; a row that is not
      // live must not pretend to. That is the whole contract of the page.
      liveWithoutRoute: rows.filter(r=>r.querySelector('.evs.live') && !r.hasAttribute('data-ev')).length,
      // PLANNED must be inert. PARTIAL may be clickable — it exists, it is
      // just unfinished, and sending someone to it is honest.
      plannedButClickable: rows.filter(r=>{
        const s=r.querySelector('.evs');
        return s && !s.classList.contains('live') && !s.classList.contains('partial')
               && r.hasAttribute('data-ev'); }).length,
      secs:[...document.querySelectorAll('#v .lab')].length};
  });
  ok('every row carries a state label', ev.labelled, ev.n+' rows');
  ok('the page covers the whole product', ev.n>=20 && ev.secs>=5, ev.n+' rows in '+ev.secs+' sections');
  ok('nothing is listed as live without somewhere to go',
     ev.liveWithoutRoute===0, ev.liveWithoutRoute+' live rows go nowhere');
  ok('nothing unbuilt is clickable', ev.plannedButClickable===0,
     ev.plannedButClickable+' planned rows are tappable');
  ok('planned work is named, not hidden', ev.live < ev.n, ev.live+' live of '+ev.n);

  ok('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
  await b.close();
  console.log(`\n${fail?'RED':'GREEN'}   ${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})();
