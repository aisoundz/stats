/* ============ qa/arcade-counter.js ===================================
   THE COUNTER READS THE SCORE. IT MUST NEVER WRITE IT.

   #ayou shows the player their own running total while a question is open
   — the number the whole product is about, and the one number that was
   not on that screen until 31 Aug 2026.

   The obvious way to build it is to call it from wherever points are
   awarded. That is the version this suite exists to prevent. Every
   expensive bug in this file's history is a second writer to a fact that
   already had one:

     B18  Caught It points inside the quarter-questions bar AND on their
          own row, so the breakdown added up to five more than the total
          it was breaking down
     .248 ledgerServerFloor() flooring the COMPOSITE total, collapsing
          four lanes into one — 585 points on screen, 470 in the row
     .248 finishLive() opening with pushScore(), publishing a cold phone's
          zeros over a good row and then reconciling against the damage

   paintYou() is therefore a pure reader: it takes S.pts, diffs it against
   the last value it painted, and animates the difference. It cannot
   double-count, cannot drop a lane, and keeps working if the scoring
   changes underneath it.

   THIS SUITE IS STATIC ON PURPOSE. It reads the file. It needs no browser,
   so it cannot flake and it can run while other suites hold the engines.

       node qa/arcade-counter.js
       node qa/arcade-counter.js --file index-test.html
*/
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const fi = argv.indexOf('--file');
const SRC = path.join(__dirname, '..', fi >= 0 && argv[fi + 1] ? argv[fi + 1] : 'index.html');

let pass = 0, fail = 0;
const ok  = (n, d) => { pass++; console.log('  ok   ' + n + (d ? ('   ' + d) : '')); };
const bad = (n, d) => { fail++; console.log('  FAIL ' + n + (d ? '\n         ' + d : '')); };
const t   = (n, f) => { try { const r = f(); r === true ? ok(n) : bad(n, r || undefined); }
                        catch (e) { bad(n, e.message); } };

let s;
try { s = fs.readFileSync(SRC, 'utf8'); }
catch (e) { console.log('  FAIL cannot read ' + SRC + ' — ' + e.message); process.exit(1); }

console.log('\n  arcade counter — your score, while you play');
console.log('  file  ' + path.basename(SRC) + '\n');

/* Pull the function body once, brace-matched. A regex spanning a function
   this size reads whatever follows it. */
function bodyOf(name) {
  const at = s.indexOf('function ' + name + '(');
  if (at < 0) return null;
  let d = 0, j = s.indexOf('{', at);
  const start = j;
  for (; j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}') { d--; if (d === 0) return s.slice(start, j + 1); }
  }
  return null;
}

t('the counter exists on the play screen', () =>
  s.includes("id: 'ayou'") || s.includes('id="ayou"') || s.includes("el.id = 'ayou'")
    ? true : 'no #ayou node is ever created');

t('it has a style rule, and that rule is not nested inside :root', () => {
  const at = s.indexOf('#ayou{');
  if (at < 0) return 'no #ayou{ rule';
  const ri = s.indexOf(':root{');
  const close = s.indexOf('\n  }\n', ri);
  /* CSS-nesting a rule inside :root parses under the original nesting spec
     but `h1, h2, h3{` needs RELAXED nesting (Safari 17.2+). Two patches on
     31 Aug landed rules inside :root and iOS 16.5-17.1 silently lost them.
     No test could see it: the gate runs one engine version. */
  return at > close ? true : 'the #ayou rule is nested inside :root — iOS 16.5-17.1 will drop it';
});

t('paintYou() is a READER — it never touches the scoring path', () => {
  const b = bodyOf('paintYou');
  if (!b) return 'paintYou() not found';
  /* The exact symbols that own a fact. A counter that calls any of these
     has stopped being a display and become a second writer. */
  const forbidden = ['ledgerSet', 'ledger(', 'recomputeScore', 'pushScore',
                     'ledgerServerFloor', 'ledgerServerReconcile',
                     'S.pts =', 'S.pts=', 'S.speed=', 'S.predPts=',
                     'S.catchPts=', 'S.caughtPts=', 'SB.'];
  const hit = forbidden.filter(f => b.includes(f));
  return hit.length ? 'paintYou() references ' + hit.join(', ') + ' — it must only READ S.pts' : true;
});

t('the first paint is not celebrated as a gain', () => {
  const b = bodyOf('paintYou');
  if (!b) return 'paintYou() not found';
  /* Joining a room mid-night with 340 already banked must not fire a +340.
     The player did not just earn it. */
  return /AYOU_LAST\s*===\s*null/.test(b)
    ? true : 'nothing distinguishes the first paint from a gain — a mid-night join will celebrate the whole total';
});

t('a negative move is never shown as a gain', () => {
  const b = bodyOf('paintYou');
  if (!b) return 'paintYou() not found';
  return /gain\s*>\s*0/.test(b)
    ? true : 'the gain is not guarded as > 0 — a reconcile that lowers a lane would render "+-15"';
});

t('reduced motion is honoured', () =>
  /prefers-reduced-motion[^}]*#ayou/s.test(s) || /#ayou[^{]*\{[^}]*\}[\s\S]{0,900}prefers-reduced-motion/.test(s)
    ? true : 'no prefers-reduced-motion rule covers the counter animation');

console.log(`\n  ${fail ? 'RED  ' : 'GREEN'}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
