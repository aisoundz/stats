const PW=require('/home/higherthan7/stats/node_modules/playwright');
const F=process.argv[2]||(__dirname+'/v75.html');
(async()=>{
  const b=await PW.firefox.launch(); const p=await b.newPage({viewport:{width:390,height:844}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  let pass=0,fail=0;
  const ok=(n,c,d)=>{c?pass++:fail++;console.log((c?'  ok   ':'  FAIL ')+n+(d?'   '+d:''));};
  await p.goto('file://'+F,{waitUntil:'load'}); await p.waitForTimeout(350);

  // ---- IN THIS ROOM ----
  const rc=await p.evaluate(()=>[0,1,2,3,5,44].map(n=>roomCount({here:n})));
  ok('one person reads as a position, not a population',
     rc[0].v==='FIRST' && rc[1].v==='FIRST', JSON.stringify(rc[1]));
  ok('it never claims more than one when there is one',
     !/[2-9]/.test(rc[1].v+' '+rc[1].s), rc[1].v+' / '+rc[1].s);
  ok('two is said in words', rc[2].v==='2' && /one more/.test(rc[2].s), JSON.stringify(rc[2]));
  ok('from three the real count comes back',
     rc[3].v==='3' && rc[4].v==='5' && rc[5].v==='44');
  ok('the count is never inflated', rc.every((x,i)=>{
     const n=[0,1,2,3,5,44][i]; const shown=parseInt(x.v,10);
     return isNaN(shown) ? n<=1 : shown<=Math.max(n,1); }));
  const shown=await p.locator('.hero .sl .v').first().innerText();
  ok('Home hero shows FIRST, not 1', shown==='FIRST', JSON.stringify(shown));

  // ---- TONIGHT vs GAME ----
  // THREE states, because the hero now previews any game on the slate:
  // your room, the featured game, or neither. Saying "game of the night"
  // over a third game would be the same lie as the old WNBA leaderboard.
  ok('on load the hero is your room (it is also the marquee)',
     (await p.locator('.hero .role').innerText())==='YOUR ROOM',
     await p.locator('.hero .role').innerText());
  await p.locator('[data-g="3"]').first().click(); await p.waitForTimeout(240);
  ok('previewing a third game says neither room nor marquee',
     (await p.locator('.hero .role').innerText())==='ON TONIGHT’S SLATE',
     await p.locator('.hero .role').innerText());
  ok('and the bar still shows the room you are IN, not the preview',
     (await p.locator('.bar .mt').innerText())==='ARS v AVL',
     await p.locator('.bar .mt').innerText());
  ok('the bar declares itself a room', (await p.locator('.barlab').innerText())==='ROOM');

  // start in room 0 == marquee -> no reconciler needed
  // Select your OWN room in the picker first — the banner only exists to
  // reconcile a preview that is not the room you are in.
  await p.locator('[data-g="0"]').first().click(); await p.waitForTimeout(220);
  ok('no "you are playing" banner when previewing your own room',
     await p.locator('#backRoom').count()===0);

  // switch to a different room, come back to Home
  await p.locator('[data-g="1"]').first().click(); await p.waitForTimeout(200);
  await p.locator('#enterRoom').click(); await p.waitForTimeout(300);
  ok('room hero declares itself YOUR ROOM',
     (await p.locator('.hero .role').innerText())==='YOUR ROOM');
  ok('room hero role is teal (you), not muted',
     await p.evaluate(()=>document.querySelector('.hero .role').classList.contains('mine')));
  await p.locator('nav [data-t="home"]').click(); await p.waitForTimeout(320);
  await p.locator('[data-g="0"]').first().click(); await p.waitForTimeout(240);
  ok('now Home admits the two differ', await p.locator('#backRoom').count()===1);
  const banner=await p.locator('#backRoom').innerText();
  ok('and it names the room you are actually in', /CIN at CHC/.test(banner), JSON.stringify(banner.replace(/\n/g,' ')));
  ok('the hero still shows the featured game, not your room',
     (await p.locator('.hero .fc .cd').first().innerText())==='ARS');
  ok('the bar still shows your room, not the feature',
     (await p.locator('.bar .mt').innerText())==='CIN v CHC');
  await p.locator('#backRoom').click(); await p.waitForTimeout(320);
  ok('the banner takes you back to your room',
     (await p.evaluate(()=>tab))==='game' && (await p.evaluate(()=>ACTIVE))===1);

  ok('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
  await b.close();
  console.log(`\n${fail?'RED':'GREEN'}   ${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})();
