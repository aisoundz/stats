const PW=require('/home/higherthan7/stats/node_modules/playwright');
const F=process.argv[2]||'/home/higherthan7/stats/v75/v75.html';
(async()=>{
  const b=await PW.firefox.launch(); const p=await b.newPage({viewport:{width:390,height:844}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  let pass=0,fail=0;
  const ok=(n,c,d)=>{c?pass++:fail++;console.log((c?'  ok   ':'  FAIL ')+n+(d?'   '+d:''));};
  await p.goto('file://'+F,{waitUntil:'load'}); await p.waitForTimeout(300);

  // ---- STAT LINE ----
  await p.locator('nav [data-t="stats"]').click(); await p.waitForTimeout(250);
  // The four tabs are the wordmark — Home · STATS · GAMETIME · Board — so
  // the tab keeps its name and STAT LINE is the SECTION inside it.
  ok('the Stats tab keeps its name', (await p.locator('nav [data-t="stats"]').innerText()).trim()==='Stats');
  ok('STAT LINE is a section inside it, not the tab',
     (await p.locator('.tt').innerText())==='STATS'
     && (await p.locator('#v').innerText()).includes('STAT LINE'));
  const body=await p.locator('#slBody').innerText();
  ok('the number is blanked out of the line', body.includes('?') && !body.includes('£106m'), JSON.stringify(body.slice(0,60)));
  ok('the blank is INLINE, not appended as a trivia prompt',
     !body.includes('The number is'), JSON.stringify(body.slice(-52)));
  ok('a stat line is refused when its number is not in the text',
     await p.evaluate(()=>slReady({n:'99',o:[1],a:0,d:'no number here'}))===false);
  ok('the wire lists stories', await p.locator('[data-nw]').count()>=6);

  // reading a story pays exactly once
  const s0=await p.evaluate(()=>SCORE);
  await p.locator('[data-nw="0"]').click(); await p.waitForTimeout(120);
  const s1=await p.evaluate(()=>SCORE);
  await p.locator('[data-nw="0"]').click(); await p.waitForTimeout(60);
  await p.locator('[data-nw="0"]').click(); await p.waitForTimeout(120);
  const s2=await p.evaluate(()=>SCORE);
  ok('reading pays +1', s1===s0+1, `${s0}→${s1}`);
  ok('re-opening the same story pays nothing', s2===s1, `${s1}→${s2} (farming guard)`);

  // ---- COMBO ----
  const c0=await p.evaluate(()=>COMBO);
  await p.locator('[data-sl="1"]').click(); await p.waitForTimeout(400);   // correct
  const c1=await p.evaluate(()=>COMBO), s3=await p.evaluate(()=>SCORE);
  ok('correct raises the combo', c1===c0+1, `×${c0}→×${c1}`);
  ok('correct pays combo-multiplied', s3>s2+3, `+${s3-s2} (base 3 × ×${c0})`);
  ok('the number is revealed after answering', (await p.locator('#slBody').innerText()).includes('£106m'));

  // ---- ARCADE SKIN ----
  await p.locator('[data-skin="arcade"]').click(); await p.waitForTimeout(250);
  ok('arcade skin applies to body', (await p.evaluate(()=>document.body.className))==='arcade');
  ok('SCORE/COMBO/STREAK counters appear', await p.locator('.arc div').count()===3);
  const bw=await p.evaluate(()=>getComputedStyle(document.querySelector('.card')).borderTopWidth);
  ok('arcade uses 3px borders', bw==='3px', bw);
  await p.locator('[data-skin="broadcast"]').click(); await p.waitForTimeout(200);
  const bw2=await p.evaluate(()=>getComputedStyle(document.querySelector('.card')).borderTopWidth);
  ok('broadcast returns to 1px', bw2==='1px', bw2);

  // ---- YOUR OWN ROOM ----
  await p.locator('nav [data-t="board"]').click(); await p.waitForTimeout(250);
  ok('offers to start your own room', await p.locator('#mkroom').count()===1);
  await p.locator('#mkroom').click(); await p.waitForTimeout(300);
  const code=await p.evaluate(()=>MYROOM&&MYROOM.code);
  ok('room gets a code', /^[A-Z2-9]{5}$/.test(code||''), code);
  ok('code avoids I/O/0/1 (read aloud in a bar)', !/[IO01]/.test(code||''), code);
  ok('share link shown', (await p.locator('.share .lnk').innerText()).includes(code));
  ok('copy + share buttons wired', await p.locator('#cpy').count()===1 && await p.locator('#shr').count()===1);
  ok('QR placeholder says it is not built', (await p.locator('#qrbox').innerText()).includes('ENCODER NOT BUILT'));

  // ---- CONFETTI is gated ----
  const gated=await p.evaluate(()=>{
    const before=COMBO, bs=streak; let r=[];
    COMBO=2; streak=13; r.push(milestone(true, 0));       // nothing special
    COMBO=5; r.push(milestone(true, 0));                  // combo milestone
    COMBO=2; streak=15; r.push(milestone(true, 0));       // streak milestone
    COMBO=2; streak=13; r.push(milestone(false, 99999));  // wrong answer
    COMBO=before; streak=bs; return r;
  });
  ok('confetti does NOT fire on an ordinary correct answer', gated[0]===null, JSON.stringify(gated));
  ok('confetti fires on combo ×5', gated[1]==='combo ×5');
  ok('confetti fires on a 15-day run', gated[2]==='15-day run');
  ok('confetti never fires on a wrong answer', gated[3]===null);

  // ---- a WRONG answer must cost the combo ----
  const wrong=await p.evaluate(()=>{ const b=COMBO; COMBO=4; const applied=bumpCombo(false);
    const after=COMBO; COMBO=b; return {applied, after}; });
  ok('wrong answer resets the combo to ×1', wrong.after===1, '×4 → ×'+wrong.after);
  ok('wrong answer applies no multiplier', wrong.applied===0, 'applied ×'+wrong.applied);
  const rightM=await p.evaluate(()=>{ const b=COMBO; COMBO=4; const a=bumpCombo(true);
    const after=COMBO; COMBO=b; return {a,after}; });
  ok('correct answer applies the standing multiplier and raises it', rightM.a===4&&rightM.after===5,
     'applied ×'+rightM.a+', now ×'+rightM.after);

  ok('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
  await b.close();
  console.log(`\n${fail?'RED':'GREEN'}   ${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})();
