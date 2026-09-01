/* ============ qa/tape.js =============================================
   THE TAPE MUST NEVER BE WORTH POINTS.

   One question a day, about a game that already finished. It is the only
   surface here that does not need a live game — the transferable mechanic
   from the Fliff read: "a reason to open the app when no game is on. We
   have never had one."

   And that is exactly why it is dangerous. Every Tape question can be
   looked up in ten seconds. The moment it pays Points it puts a lookup on
   the same table as somebody who watched live, and this product sells
   attention. The reward is a STREAK, and the streak counts DAYS PLAYED,
   not days right.

   Static: reads the picker and the card. No browser, no network.

       node qa/tape.js
       node qa/tape.js index-test.html
*/
const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2);
const fi = argv.indexOf('--file');
let SRC = (fi >= 0 && argv[fi+1]) ? argv[fi+1] : (argv.find(a => !a.startsWith('-')) || 'index-test.html');
SRC = path.isAbsolute(SRC) ? SRC : path.join(__dirname, '..', SRC);
const PICKER = path.join(__dirname, '..', 'host', 'tape.js');

let pass = 0, fail = 0;
const ok  = (n,d)=>{pass++; console.log('  ok   '+n+(d?('   '+d):''));};
const bad = (n,d)=>{fail++; console.log('  FAIL '+n+(d?'\n         '+d:''));};
const t   = (n,f)=>{ try{ const r=f(); r===true?ok(n):bad(n,r||undefined);}catch(e){bad(n,e.message);} };

let s, p;
try { s = fs.readFileSync(SRC,'utf8'); p = fs.readFileSync(PICKER,'utf8'); }
catch(e){ console.log('  FAIL cannot read — '+e.message); process.exit(1); }

console.log('\n  the Tape — a reason to open the app with no game on');
console.log('  file  '+path.basename(SRC)+'\n');

const card = (() => {
  const i = s.indexOf('var TAPE = null');
  if (i < 0) return '';
  const j = s.indexOf('function renderGametime(){', i);
  return j > i ? s.slice(i, j) : '';
})();

t('the card exists', () => card && s.includes('id="tapeCard"') ? true : 'no Tape card');

t('it never pays Points and never touches the Board', () => {
  /* THE one rule. A lookup must not sit on the same table as somebody
     watching live. */
  const banned = ['S.pts', 'ledgerSet', 'predPts', 'catchPts', 'caughtPts',
                  'recomputeScore', 'pushScore', 'readRoom', 'nightTotal'];
  const hit = banned.filter(w => card.includes(w));
  return hit.length ? 'the Tape references ' + hit.join(', ') + ' — it must never be worth points' : true;
});

t('the streak counts days PLAYED, not days right', () => {
  /* Walks back while a day has an answer stored, with no reference to
     whether that answer was correct. */
  const i = card.indexOf('function tapeStreak');
  const seg = card.slice(i, card.indexOf('function tapeRender'));
  return /answer|right|correct/.test(seg)
    ? 'tapeStreak looks at correctness — the streak must count showing up'
    : (/tapeSaved/.test(seg) ? true : 'tapeStreak does not read the stored days');
});

t('a day can only be answered once', () => {
  /* Otherwise a refresh farms the streak, and re-asks a question the
     player has already seen. Same reason recordStatLine dedupes by night. */
  const i = card.indexOf('function tapeAnswer');
  const seg = card.slice(i, i + 500);
  return /if\(tapeSaved\(day\)\) return/.test(seg)
    ? true : 'tapeAnswer does not refuse a second answer for the same day';
});

t('no document, no card', () => {
  /* A day the picker did not run must leave the page as it was, not show
     an error. */
  const i = card.indexOf('function tapeLoad');
  const seg = card.slice(i, i + 1400);
  /* ASSERTS THE INTENT, NOT THE PUNCTUATION. This used to match the exact
     string `if(!t) return`, which broke the day tapeLoad learned to retry
     a null document — `if(!t){ ...; return; }` — while behaving
     identically. Now it asks the two things that actually matter: there
     is a guard on a falsy document that returns, and the only path that
     paints the card is downstream of that guard. Strictly stronger than
     the literal it replaces: moving tapeRender() above the guard passed
     the old check and fails this one. */
  const guard = seg.search(/if\s*\(\s*!t\s*\)/);
  if (guard < 0) return 'tapeLoad has no guard for a missing document';
  const guardReturns = /if\s*\(\s*!t\s*\)\s*(\{[^]{0,200}?return[^]{0,80}?\}|return)/.test(seg);
  if (!guardReturns) return 'tapeLoad does not return when there is no document';
  const render = seg.indexOf('tapeRender()');
  if (render >= 0 && render < guard) return 'tapeLoad paints the card before checking the document exists';
  return true;
});

t('it sits below the way in', () => {
  const pc = s.indexOf('id="portalCard"'), tc = s.indexOf('id="tapeCard"');
  return (tc > pc && pc > 0) ? true : 'the Tape renders above the practice control';
});

/* ---- the picker ---------------------------------------------------- */
t('the picker refuses a question whose answer is not on the card', () => {
  /* The archive outlives the bank: baseball went from three rounds to
     nine, so mlbRunsBand is in the data and gone from the code. A question
     nobody can get right is worse than no question. */
  return /opts\.indexOf\(ans\) < 0\) continue/.test(p)
    ? true : 'the picker does not check that the true answer is among the options';
});

t('the picker builds options from the bank, not from imagination', () =>
  /optionsByResolver|admin\.html/.test(p) ? true : 'the picker does not read the bank for its options');

t('the picker stays clear of tonight’s teams', () => {
  /* The archive holds games dated today — ESPN dates by ET. Asking about
     NYY @ LAA hours before somebody plays NYY @ LAA invites the wrong
     conclusion. */
  return /todaysTeams/.test(p) ? true : 'the picker does not exclude teams playing tonight';
});

t('the same day always picks the same question', () => {
  /* A refresh handing out a different question would make the streak
     meaningless and let somebody shop for an easy one. */
  return /seed/.test(p) && /seed % sameDay\.length/.test(p)
    ? true : 'the pick is not deterministic for the day';
});

console.log(`\n  ${fail ? 'RED  ' : 'GREEN'}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
