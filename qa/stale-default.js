/* ============ qa/stale-default.js ====================================
   THE APP SHIPS WITH A NIGHT BAKED INTO IT, AND THAT NIGHT GETS OLDER.

   Founder, 21 Aug: "The game night is wrong, it says 13 but its 16."

   Nothing computed 13. BB_GAME — the built-in night this file ships with
   — is gn13-2026-08-19-min-gs, Minnesota at Golden State, tipping on the
   19th. GAME starts as that object and hydrateNight() replaces it from
   the slate a moment later, so on a fast connection nobody sees it. On a
   slow one, a cold cache, or a late slate read, the first screen is a
   three-day-old game wearing tonight's furniture.

   This is the third time this exact shape has cost something: the 4:46am
   date bug (slate/current still pointing at yesterday), the hero fixture
   that rotted overnight, and now the baked night. A constant that was
   true when it was written and gets quietly falser every day.

   So the rule is not "keep the constant fresh" — somebody will forget.
   The rule is that the app must KNOW its default has expired and refuse
   to present it as tonight.
   ================================================================== */
const fs=require('fs'), path=require('path');
/* ============ READ THE BUILD UNDER TEST, NOT ALWAYS THE LIVE ONE ====
   This hardcoded index.html and ignored its argument, so `node
   qa/stale-default.js index-test.html` silently graded the SHIPPED file.
   Found 26 Aug when it reported a failure for a line that had already
   been reverted in the candidate — the suite was right about a file
   nobody had asked it about.

   Exactly the defect fixed for the seven admin suites on 25 Aug: "a
   green gate could promote banks it had never read". A suite that
   ignores the target cannot tell a new break from an inherited one. */
const TARGET=(function(){
  const a=process.argv.slice(2).filter(x=>!x.startsWith('--'));
  return a[0] ? path.resolve(a[0]) : path.join(__dirname,'..','index.html');
})();
const SRC=fs.readFileSync(TARGET,'utf8');
let pass=0, fail=0;
const ok =(n)=>{pass++; console.log('  ok   '+n);};
const bad=(n,d)=>{fail++; console.log('  FAIL '+n+(d?'\n         '+d:''));};
function t(n,f){ try{ f()?ok(n):bad(n); }catch(e){ bad(n,e.message); } }

/* ---- run the real predicate ---------------------------------------- */
const m = SRC.match(/function bakedNightIsStale\(g\)\{[\s\S]*?\n\}/);
if(!m){ bad('bakedNightIsStale exists'); console.log('\n  '+pass+' passed, '+fail+' failed'); process.exit(1); }
const isStale = new Function(m[0]+'; return bakedNightIsStale;')();
const HOUR=3600*1000;

t('the night this build ships with is stale today', ()=>{
  const tip=(SRC.match(/__baked:true,\s*\n\s*nightId:"[^"]*",\s*\n\s*espnEvent:"[^"]*",[^\n]*\n\s*tipISO:"([^"]+)"/)||[])[1]
        || (SRC.match(/const BB_GAME=\{[\s\S]{0,600}?tipISO:"([^"]+)"/)||[])[1];
  if(!tip){ console.log('         could not read BB_GAME.tipISO'); return false; }
  const age=Math.round((Date.now()-Date.parse(tip))/HOUR);
  console.log('         BB_GAME tips '+tip+' — '+age+'h ago');
  /* Not a failure either way; this line exists so the age is PRINTED on
     every gate run. What must hold is the behaviour below. */
  return true;
});
t('a baked night that tipped three days ago is stale', ()=>
  isStale({__baked:true, tipISO:new Date(Date.now()-72*HOUR).toISOString()})===true);
t('a baked night that tipped two hours ago is NOT stale', ()=>
  /* Somebody finishing the board after a 7pm tip is still on tonight. */
  isStale({__baked:true, tipISO:new Date(Date.now()-2*HOUR).toISOString()})===false);
t('a baked night tipping later today is not stale', ()=>
  isStale({__baked:true, tipISO:new Date(Date.now()+4*HOUR).toISOString()})===false);
t('a baked night with no readable date is stale', ()=>
  isStale({__baked:true, tipISO:'not a date'})===true);
t('a HYDRATED night is never stale, however old', ()=>
  /* A real night stays itself the morning after. Only the fallback ages. */
  isStale({tipISO:new Date(Date.now()-400*HOUR).toISOString()})===false);
t('an absent game is not stale', ()=> isStale(null)===false);

/* ---- and the flag has to be set, and cleared ------------------------ */
t('the built-in night declares itself the fallback', ()=>
  /const BB_GAME=\{[\s\S]{0,400}?__baked:true/.test(SRC));
t('hydrating a real night clears the flag', ()=>{
  /* hydrateNight MERGES keys in rather than replacing the object, so a
     flag the incoming night does not carry survives unless deleted. Leave
     it and every hydrated night is judged expired the next day. */
  const i=SRC.indexOf('Object.keys(g).forEach(function(k){ GAME[k] = g[k]; });');
  if(i<0) return false;
  return /delete GAME\.__baked/.test(SRC.slice(i, i+900));
});

/* ---- and nothing may present it as tonight -------------------------- */
t('the night number is withheld when the default has expired', ()=>{
  const f=SRC.match(/function gnOf\(g\)\{[\s\S]*?\n\}/);
  return !!f && /bakedNightIsStale\(g\)\)\s*return ''/.test(f[0]);
});
t('the dateline is withheld when the default has expired', ()=>{
  const f=SRC.match(/function tonightHeadLine\(g\)\{[\s\S]*?\n\}/);
  return !!f && /bakedNightIsStale\(g\)/.test(f[0]);
});
t('the landing does not name last week\'s teams under a loading eyebrow', ()=>
  /var _stale = bakedNightIsStale\(_hg\);/.test(SRC)
  && /if\(_stale\)\{ html\('landingMatch'/.test(SRC));
t('the tip line decides for itself, with no second author', ()=>{
  /* qa.js demands #landingTip have exactly ONE writer. The first version
     of this fix branched at the CALL SITE — set('landingTip', stale ? '' :
     landingTipLine()) — which is precisely the second author that check
     exists to prevent, and it went red within the hour. The knowledge
     belongs inside the one owner. */
  if(/_stale \? '' : landingTipLine\(\)/.test(SRC)){
    console.log('         the call site is branching again');
    return false;
  }
  const f=SRC.match(/function landingTipLine\(\)\{[\s\S]{0,900}/);
  return !!f && /bakedNightIsStale\(/.test(f[0]);
});
t('both eyebrow branches ask, not just the marquee one', ()=>{
  /* The first version of this fix only covered the marquee branch, so a
     plain night still printed "Game Night #13 · Wed · August 19" out of
     GAME.night and GAME.date. */
  const seg=SRC.match(/set\('landingHead',[\s\S]{0,260}?\);/);
  return !!seg && /_stale \?/.test(seg[0]);
});

console.log('\n  '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
