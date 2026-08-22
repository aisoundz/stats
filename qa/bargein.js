/* ============ qa/bargein.js ==========================================
   "When I use my voice it doesnt listen to my answer until after the full
   question asks. i should be able to talk to it easily. and it doesnt
   take lock in or next."  — 21 Aug, live.

   Voice is the north star, and this file exists because I have now been
   wrong about voice twice by reasoning about it instead of running it.
   These checks execute the real ordering decision.

   THE TRAP: selfEcho() returns true when every content word it heard is a
   word we just said. The words a player answers with ARE words we just
   said — we read the options aloud. So the guard that stops the app
   answering its own question also stopped the player answering it.
   ================================================================== */
const fs=require('fs'), path=require('path');
const SRC=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
let pass=0, fail=0;
const ok =(n)=>{pass++; console.log('  ok   '+n);};
const bad=(n,d)=>{fail++; console.log('  FAIL '+n+(d?'\n         '+d:''));};
function t(n,f){ try{ f()?ok(n):bad(n); }catch(e){ bad(n,e.message); } }

/* ---- 1. the grammar really does carry his two words ---------------- */
const lockRe = (()=>{
  const m=SRC.match(/LOCK:(\/\^[\s\S]*?\/)\s*,/);
  return m ? eval(m[1]) : null;   // the literal out of the source, not a copy
})();
t('the LOCK grammar exists', ()=> !!lockRe);
['lock in','lock it in','lock','next','next question','done','continue'].forEach(w=>{
  t('"'+w+'" is heard as finish-this-question', ()=> lockRe && lockRe.test(w));
});

/* ---- 2. the interrupt list accepts them ---------------------------- */
const blk = SRC.match(/_real = !!\(_m && \([\s\S]{0,260}?\)\);/);
t('the barge-in list exists', ()=> !!blk);
['pick','off','repeat','lock','change'].forEach(k=>{
  t("a '"+k+"' interrupts STATS mid-sentence", ()=> blk && blk[0].indexOf("'"+k+"'")>=0);
});

/* ---- 3. THE ORDER. This is the whole bug. -------------------------- */
t('the action test runs BEFORE the echo guard', ()=>{
  /* Find the interim-result block and prove selfEcho is no longer the
     gate that everything must pass through first. */
  const i = SRC.indexOf('var _real=false;');
  if(i < 0) return false;
  const seg = SRC.slice(i, i + 4200);
  const gateFirst = /if\(_t && !V\.selfEcho\(_t\)\)\{/.test(seg);
  if(gateFirst){ console.log('         selfEcho still gates the whole block'); return false; }
  const mAt = seg.indexOf('V.match(_t,_o)');
  const eAt = seg.indexOf('V.selfEcho(_t)');
  return mAt >= 0 && eAt >= 0 && mAt < eAt;
});
t('a matched action is not overturned by the echo guard afterwards', ()=>{
  const i = SRC.indexOf('var _real=false;');
  const seg = SRC.slice(i, i + 4200);
  /* The echo line must only be able to run when _real is already false. */
  return /if\(!_real && !V\.selfEcho\(_t\)\) _real = false;/.test(seg);
});

/* ---- 4. selfEcho itself is unchanged and still catches real echo ---- */
const se = SRC.match(/V\.selfEcho=function\(said\)\{[\s\S]*?\n  \};/);
t('selfEcho still exists', ()=> !!se);
if(se){
  const V={saidNorm:'lynx or mystics who wins the quarter', speaking:true, spokeAt:Date.now()};
  const norm=(x)=>String(x||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const selfEcho=new Function('V','norm', se[0].replace('V.selfEcho=','return ').replace(/;\s*$/,''))(V,norm);
  t('our own sentence coming back IS still an echo', ()=>
    selfEcho('lynx or mystics who wins the quarter') === true);
  t('a word from the room is not an echo', ()=>
    selfEcho('pass me the remote') === false);
  t('...and a bare option name still reads as echo on its own', ()=>
    /* Which is exactly WHY the order had to change: this is a correct
       echo verdict and a wrong answer verdict, from the same call. The
       fix is not to weaken this — it is to ask about the action first. */
    selfEcho('lynx') === true);
}

console.log('\n  '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
