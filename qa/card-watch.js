/* ============ qa/card-watch.js =======================================
   "Is there anything we can do with our screen to keep the engagement"
   / "Make the game more enjoyable" — 21 Aug, live, mid-game.

   The answer was gtCardWatch(): the per-pick live race, moved onto the
   tab a player actually sits on. It fills the 25-minute gap between
   rounds that previously rendered one disabled grey button.

   It is a MIRROR of the Stats-tab version. The failure this file exists
   to prevent is the two disagreeing — a player reading "needs 3 more" on
   one tab and "in front" on the other has been told the app does not know
   what is happening, which is worse than the empty screen it replaced.
   ================================================================== */
const fs=require('fs'), path=require('path');
const SRC=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
let pass=0, fail=0;
const ok =(n)=>{pass++; console.log('  ok   '+n);};
const bad=(n,d)=>{fail++; console.log('  FAIL '+n+(d?'\n         '+d:''));};
function t(n,f){ try{ f()?ok(n):bad(n); }catch(e){ bad(n,e.message); } }

const m = SRC.match(/function gtCardWatch\(\)\{[\s\S]*?\n\}\ntry\{ window\.gtCardWatch/);
if(!m){ bad('gtCardWatch exists'); console.log('\n  '+pass+' passed, '+fail+' failed'); process.exit(1); }
const body = m[0].replace(/\ntry\{ window\.gtCardWatch[\s\S]*$/,'');

/* Build it in a scope holding exactly the globals it is allowed to touch.
   Anything it reaches for that is NOT here throws — which is the point:
   this function runs inside a try/catch on a live screen, so a typo in a
   global name would show up as a silently missing card, forever. */
function build(env){
  const names=['S','GS','GAME','preds','gsIsAbout','sportCfg','gsNum','esc','predRidingPts'];
  return new Function(...names, body+'; return gtCardWatch;')(...names.map(n=>env[n]));
}
const base = () => ({
  S:{mode:'live', predChoices:{reb:'Collier', pts:'Clark'}},
  GS:{box:{ 'Collier':{reb:8}, 'Atkins':{reb:11}, 'Clark':{pts:22}, 'Cloud':{pts:14} }},
  GAME:{}, preds:[{id:'reb',label:'Most rebounds'},{id:'pts',label:'Most points'}],
  gsIsAbout:()=>true,
  sportCfg:()=>({box:{pts:'pts',reb:'reb',ast:'ast',stl:'stl',blk:'blk'}}),
  gsNum:(v)=>(v==null?null:Number(v)),
  esc:(x)=>String(x),
  predRidingPts:()=>600
});

t('it names the player to pass and the exact number needed', ()=>{
  const html = build(base())();
  return /needs 4 more to pass Atkins/.test(html);   // 11 - 8 + 1
});
t('a pick that is in front is not given a chase sentence', ()=>{
  const html = build(base())();
  return /Clark <b>22<\/b>/.test(html) && /in front/.test(html);
});
t('the header counts what is in front and shows the stakes', ()=>{
  const html = build(base())();
  return /1 of 2 in front/.test(html) && /600 riding/.test(html);
});
t('it agrees with the Stats tab arithmetic, exactly', ()=>{
  /* The Stats tab computes `(bestV-val)+1` and calls it "Needs N more to
     take the lead". Recompute here and demand the same N. */
  const html = build(base())();
  const n = (html.match(/needs (\d+) more/)||[])[1];
  return Number(n) === (11 - 8) + 1;
});

/* ---- and the four ways it must stay silent ------------------------- */
t('silent in practice', ()=>{
  const e=base(); e.S.mode='demo'; return build(e)()==='';
});
t('silent when the feed is describing another room', ()=>{
  const e=base(); e.gsIsAbout=()=>false; return build(e)()==='';
});
t('silent before the game produces any of these stats', ()=>{
  const e=base(); e.GS.box={}; return build(e)()==='';
});
t('silent when no picks were made', ()=>{
  const e=base(); e.S.predChoices={}; return build(e)()==='';
});
t('silent when there is no box score at all', ()=>{
  const e=base(); e.GS={}; return build(e)()==='';
});

/* ---- and it must be ON the Gametime screen -------------------------- */
t('it is wired into the Gametime render, above YOUR NIGHT', ()=>{
  const a=SRC.indexOf('out += gtCardWatch()');
  const b=SRC.indexOf('out += gtYourNight()');
  return a>0 && b>a;
});
t('it does not reach for a global that does not exist', ()=>{
  /* The whole body runs inside try/catch on a live screen. A bad name
     would not throw visibly — it would just never render, and nobody
     would file it. `predRiding` vs `predRidingPts` was exactly that,
     caught before it shipped only because this was checked. */
  const used=[...body.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)].map(x=>x[1]);
  const KEYWORD=new Set(['if','for','while','switch','catch','return','typeof','function']);
  const localOk=new Set(['gtCardWatch','filter','map','join','replace','test','esc','Object',
    'keys','forEach','String','Number','gsNum','gsIsAbout','sportCfg','predRidingPts']);
  used.forEach(n=>{ if(KEYWORD.has(n)) localOk.add(n); });
  const missing=used.filter(n=>!localOk.has(n) && !new RegExp('function '+n+'\\b|const '+n+'\\b|var '+n+'\\b|\\b'+n+'\\s*=\\s*SPORT').test(SRC));
  if(missing.length) console.log('         unknown: '+[...new Set(missing)].join(', '));
  return missing.length===0;
});

console.log('\n  '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
