#!/usr/bin/env node
/* =====================================================================
   OVERTIME EXISTS ONLY IF THE GAME WENT THERE.
   ---------------------------------------------------------------------
   The founder asked for overtime twice and was told twice it could not
   ship, because the player app dropped any round past the four it knew
   about. The fix grows the round arrays when the host pushes an overtime
   — and the FIRST thing this suite proves is the thing that made it
   dangerous: a night that ends in regulation must be bit-for-bit the
   night it was before. A dangling fifth round on every normal game would
   be a worse bug than the one being fixed.

       node qa/overtime.js [index.html]
   ================================================================== */
const {chromium}=require('playwright'); const path=require('path');
const TARGET=path.resolve(process.argv[2]||path.join(__dirname,'..','index.html'));
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:393,height:852}});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto('file://'+TARGET,{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>document.body.classList.contains('booted'),{timeout:25000});
  await p.evaluate(()=>{ try{SB.verified=()=>true;}catch(_){} });

  const R={};
  /* ---- a regulation night is untouched ---- */
  R['regulation-still-has-exactly-the-rounds-it-had'] = await p.evaluate(()=>rounds.length===NR && NR===4);
  R['regulation-last-round-is-the-last-round'] = await p.evaluate(()=>isLastRound(NR-1)===true && isLastRound(NR-2)===false);
  R['no-overtime-round-is-offered-after-a-normal-game'] = await p.evaluate(()=>{
    S.mode='live'; S.qi=NR-1; S.nextQ=NR; S.screen='gametime'; S.place='lobby';
    return gtStartRow()==='';               // nothing dangling
  });

  /* ---- the host pushes one ---- */
  R['an-overtime-round-is-accepted-when-pushed'] = await p.evaluate(()=>{
    onHostedRound({ id:'r4', idx:4, tag:'OT', name:'Overtime', state:'live', worth:40,
      questions:[{t:'Who scored first in overtime?',o:['Lynx','Valkyries']}] });
    return rounds.length===5 && rounds[4].q.length===1;
  });
  R['it-is-labelled-overtime-not-quarter-five'] = await p.evaluate(()=>
    roundTag(4)==='OT' && /overtime/i.test(roundName(4)));
  R['it-is-worth-what-the-last-regulation-round-was'] = await p.evaluate(()=>roundWorth(4)===40);
  R['now-it-is-the-last-round'] = await p.evaluate(()=>isLastRound(4)===true && isLastRound(3)===false);
  R['the-answer-arrays-grew-with-it'] = await p.evaluate(()=>
    Array.isArray(S.results[4]) && Array.isArray(S.liveAnswers[4]));
  R['and-now-a-button-appears'] = await p.evaluate(()=>{
    S.qi=4; S.nextQ=4; return gtStartRow()!=='';
  });

  /* ---- a second overtime ---- */
  R['a-second-overtime-is-OT2'] = await p.evaluate(()=>{
    onHostedRound({ id:'r5', idx:5, tag:'OT2', name:'Overtime 2', state:'live', worth:40,
      questions:[{t:'And again?',o:['Yes','No']}] });
    return rounds.length===6 && roundTag(5)==='OT2';
  });

  /* ---- REFUSALS. This is the half that keeps a regulation night safe. ---- */
  /* AIMED AT THE TAG GUARD, NOT THE CAP. The first version of this used
     idx 9, which the MAX_OT cap refuses on its own — so it passed happily
     with the tag check deleted. Use an index the cap would allow (rounds
     is at 6, the cap permits up to NR+MAX_OT-1 = 6) so the only thing that
     can reject it is the tag. */
  R['a-round-past-regulation-with-no-OT-tag-is-dropped'] = await p.evaluate(()=>{
    const before=rounds.length;                    // 6, and idx 6 is inside the cap
    onHostedRound({ id:'r6', idx:6, tag:'Q7', state:'live', questions:[{t:'x',o:['a','b']}] });
    const tagged=rounds.length===before;
    onHostedRound({ id:'r6b', idx:6, state:'live', questions:[{t:'x',o:['a','b']}] }); // no tag at all
    return tagged && rounds.length===before;
  });
  R['a-fourth-overtime-is-refused'] = await p.evaluate(()=>{
    const before=rounds.length;
    onHostedRound({ id:'r7', idx:7, tag:'OT4', state:'live', questions:[{t:'x',o:['a','b']}] });
    return rounds.length===before;
  });
  R['a-nonsense-index-allocates-nothing'] = await p.evaluate(()=>{
    const before=rounds.length;
    ensureRound(9999,'OT'); ensureRound(-1,'OT'); ensureRound(NaN,'OT');
    return rounds.length===before;
  });
  R['growing-twice-is-not-growing-twice'] = await p.evaluate(()=>{
    const before=rounds.length;
    ensureRound(4,'OT'); ensureRound(4,'OT'); ensureRound(5,'OT2');
    return rounds.length===before;
  });
  R['practice-never-goes-to-overtime'] = await p.evaluate(()=>{
    S.mode='demo'; S.qi=NR; S.nextQ=NR; S.screen='gametime'; S.place='lobby';
    return gtStartRow()==='';
  });
  R['no-page-errors'] = errs.length===0;

  await b.close();
  let bad=0;
  Object.keys(R).forEach(k=>{ if(!R[k]) bad++; console.log((R[k]?'  \x1b[32m✓\x1b[0m ':'  \x1b[31m✗\x1b[0m ')+'ot.'+k); });
  if(errs.length) console.log('  page errors: '+errs.slice(0,3).join(' | '));
  console.log('\n'+(bad?('\x1b[31mFAIL — '+bad+' of '+Object.keys(R).length+'\x1b[0m')
                       :('\x1b[32mPASS — all '+Object.keys(R).length+' overtime checks\x1b[0m')));
  process.exit(bad?1:0);
})();
