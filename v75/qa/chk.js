const PW=require('/home/higherthan7/stats/node_modules/playwright');
(async()=>{
  const b=await PW.firefox.launch();
  const p=await b.newPage({viewport:{width:390,height:844}});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e.message)));
  p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text());});
  await p.goto('file://'+(process.argv[2]||(__dirname+'/v75.html')),{waitUntil:'load'});
  const ok=(n,c,d)=>console.log((c?'  ok   ':'  FAIL ')+n+(d?'   '+d:''));

  // surface present on home?
  ok('home draws a surface SVG', await p.locator('.hero .srf svg').count()>0);
  ok('sticky room bar exists',   await p.locator('.bar .mt').count()>0);
  ok('nav has 4 icons',          await p.locator('nav button svg').count()===4);

  // enter each room, check state renders
  for(let i=0;i<5;i++){
    // On Home the rail PREVIEWS; entering is a second, deliberate act.
    await p.locator('nav [data-t="home"]').click(); await p.waitForTimeout(150);
    await p.locator('[data-g="'+i+'"]').first().click(); await p.waitForTimeout(180);
    await p.locator('#enterRoom').click(); await p.waitForTimeout(200);
    const st=await p.locator('.hero .gn .st').first().innerText();
    const srf=await p.locator('.hero .srf svg').count();
    const bar=await p.locator('.bar .mt').innerText();
    ok('room '+i+' opens · '+bar.padEnd(11)+' · '+st.padEnd(14)+' · surface='+(srf>0?'yes':'NO'), srf>0);
  }

  // the card stepper on the pre-game room
  await p.locator('nav [data-t="home"]').click(); await p.waitForTimeout(150);
  await p.locator('[data-g="0"]').first().click(); await p.waitForTimeout(180);
  await p.locator('#enterRoom').click(); await p.waitForTimeout(220);
  const need0=await p.locator('#jump').innerText().catch(()=>'');
  ok('unfinished card names what is missing', /still need/i.test(need0), '"'+need0+'"');
  ok('six progress dots', await p.locator('.dots b').count()===6);
  // answer all six
  for(let s=0;s<6;s++){
    const r=p.locator('.qbox .rad').first();
    if(await r.count()) { await r.click(); }
    else { await p.locator('#openpick').click(); await p.waitForTimeout(120);
           await p.locator('.pl').first().click(); }
    await p.waitForTimeout(140);
  }
  const lock=await p.locator('#lockcard').count();
  ok('all six picked → Lock my card appears', lock>0);
  const riding=await p.locator('.lab .r.stake').first().innerText();
  ok('points riding reaches 600', /600/.test(riding), '"'+riding+'"');

  // menu
  await p.locator('#burg').click(); await p.waitForTimeout(160);
  // Assert the sections that must EXIST, not how many there are — a count
  // goes red every time a section is added, which is the third time today.
  const msecs=(await p.locator('.msec').allInnerTexts()).map(x=>x.trim());
  ok('menu carries its sections', ['THE GAME','YOURS'].every(x=>msecs.includes(x)),
     msecs.join(' | '));
  // A count is brittle — it fails every time a row is added. Assert the rows
  // that must EXIST instead, which is the thing that actually matters.
  const rows=(await p.locator('.mrow').allInnerTexts()).join(' | ');
  ok('menu carries the rows that must be there',
     ['Back to my game','How to play','Language','Sign out','Ask STATS','Trash talk']
       .every(r=>rows.includes(r)), rows.replace(/\s+/g,' ').slice(0,110));
  // Assert the JOB, not the wording: the menu must identify which build
  // you are looking at. "Version" became "Build" and this went red while
  // the feature was fine — a value check, not an invariant.
  const ver=await p.locator('#ver').innerText();
  ok('the menu identifies the build', /build/i.test(ver) && /[0-9a-f]{6,}|DEVBUILD/i.test(ver),
     ver.split('\n')[0]);
  await p.locator('#mclose').click(); await p.waitForTimeout(120);

  // tabs
  for(const t of ['stats','board','home']){
    await p.locator('nav [data-t="'+t+'"]').click(); await p.waitForTimeout(180);
    ok('tab '+t+' renders', (await p.locator('#v').innerText()).length>120);
  }
  ok('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await b.close(); process.exit(errs.length?1:0);
})();
