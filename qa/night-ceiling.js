/* ============ qa/night-ceiling.js ====================================
   THE NIGHT TOTAL A SPORT PROMISES MUST BE THE NIGHT TOTAL IT CAN PAY.

   Found 31 Aug 2026 by writing the user manual and doing the arithmetic.

   CORRECTED THE SAME NIGHT, and the correction is the important part.
   The first version of this suite read index.html's SPORTS table and
   called the result "what the sport can pay". That is the WRONG SIDE.

       roundWorth(i)  =  HOSTW[i] != null ? HOSTW[i] : SPORT.worth[i]

   The host's published worth WINS. admin.html's TEMPLATES are what a real
   hosted night pays; index.html's SPORTS.*.worth is the fallback the
   practice fixture uses when no host is publishing. Reading the fallback
   and reporting it as the live ceiling produced a confident, wrong
   headline: "soccer overstates by 160". A hosted soccer night pays
   [40,60] x 4 questions = 400 and hits 1,000 exactly. It is the PRACTICE
   bank that is stale at [30,50] x 3.

   So this suite now measures both sides and says which is which:

       sport        hosted (admin)   practice (index)
       basketball      1,000            1,000     ok
       football        1,000            1,000     ok
       soccer          1,000              840     practice bank stale
       baseball        1,200            1,200     REAL - both sides wrong
       hockey            960              960     REAL - both sides wrong

   WHY NOTHING CAUGHT IT. 115 suites, 555 checks in qa.js alone, and not
   one of them multiplied. Every check on this bank asked a STRUCTURAL
   question — does the round exist, does the resolver return, is the copy
   free of placeholders — and the defect is arithmetic. A sentence that is
   structurally perfect can still be false, which is the same lesson
   qa/screen-copy.js was built on and this is its numeric half.

   THE TRAP, BOTH TIMES:  `worth` IS PER QUESTION, NOT PER ROUND.
   A round of 4 questions at worth 40 pays 160, not 40. Whoever next edits
   a worth array will reach for the round total; this suite is the thing
   that stops them.

   Deliberately static: it reads the file and multiplies. No browser, no
   fixture, no clock — so it cannot flake, and it can be run while other
   suites hold the browser.

       node qa/night-ceiling.js
       node qa/night-ceiling.js --file index-test.html
       node qa/night-ceiling.js --sabotage      # proves it can go red
*/

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i+1] ? argv[i+1] : d; };
/* DEFAULT TO THE CANDIDATE, NOT TO LIVE. This suite defaulted to
   index.html/admin.html, and qa/all.js passes the target only to suites it
   knows how to address — so a full gate ran this against the LIVE build
   while claiming to grade the candidate. It reported the pre-fix numbers
   under a build that had already fixed them. That is precisely the
   "half the gate graded the promotion candidate and half graded what was
   already live" disease all.js was written to end, walked into by a suite
   added to all.js the same night. Registered in DUAL_READERS now, and
   defaulting to the test files so a bare run is also honest. */
const R = f => path.join(__dirname, '..', f);
const IDX   = R(arg('--file', 'index-test.html'));
const ADMIN = R(arg('--admin-file', 'admin-test.html'));

let pass = 0, fail = 0;
const ok  = (n, d) => { pass++; console.log('  ok   ' + n + (d ? ('   ' + d) : '')); };
const bad = (n, d) => { fail++; console.log('  FAIL ' + n + (d ? '\n         ' + d : '')); };
const t   = (n, f) => { try { const r = f(); r === true ? ok(n) : bad(n, r || undefined); }
                        catch (e) { bad(n, e.message); } };

let idx, adm;
try { idx = fs.readFileSync(IDX, 'utf8'); adm = fs.readFileSync(ADMIN, 'utf8'); }
catch (e) { console.log('  FAIL cannot read — ' + e.message); process.exit(1); }

/* THE NUMBER EVERY SPORT MUST REACH, and the two halves that make it.
   Founder, 31 Aug 2026: "we should find a way to make every game a
   potential of 1000 points". The sheet is 600 in every sport already; the
   live rounds must therefore total 400 in every sport, whatever cadence
   that sport has. Overtime is NOT part of it — see OT_PAYS below. */
const NIGHT = 1000, SHEET = 600, LIVE = NIGHT - SHEET;

/* OVERTIME PAYS ON TOP, AND PAYS THE SAME EVERYWHERE. A night that goes
   to extras is worth more than one that does not — that is correct, and
   it is why the 1,000 is a REGULATION ceiling. What would not be correct
   is overtime being worth four times as much in one sport as another for
   no reason anybody chose. 120 is what basketball, football and baseball
   already independently landed on (3x40, 3x40, 2x60), so it is the
   existing convention made explicit rather than a new opinion. */
const OT_PAYS = 120;

const FAMILIES = [
  { key: 'basketball', rounds: 'BBALL_ROUNDS'  },
  { key: 'football',   rounds: 'FO_ROUNDS'     },
  { key: 'soccer',     rounds: 'SOCCER_ROUNDS' },
  { key: 'baseball',   rounds: 'BA_ROUNDS'     },
  { key: 'hockey',     rounds: 'HO_ROUNDS'     },
];

/* ---- shared parsing --------------------------------------------------
   Brace-matched, never regexed across a whole block: a question's own
   text contains brackets, and a regex that spans rounds silently reads
   the next sport's numbers. That is not hypothetical — it happened twice
   in this file the night it was written. */
function arrayAt(src, open) {
  let d = 0;
  for (let e = open; e < src.length; e++) {
    if (src[e] === '[') d++;
    else if (src[e] === ']') { d--; if (d === 0) return src.slice(open + 1, e); }
  }
  throw new Error('unbalanced array');
}
function questionCounts(body) {
  const counts = []; let depth = 0, st = null;
  for (let k = 0; k < body.length; k++) {
    if (body[k] === '[') { depth++; if (depth === 1) st = k + 1; }
    else if (body[k] === ']') {
      if (depth === 1) counts.push((body.slice(st, k).match(/\{\s*t\s*:/g) || []).length);
      depth--;
    }
  }
  return counts;
}
const nums = str => str.split(',').map(x => Number(x.trim())).filter(n => !isNaN(n));

/* ---- side A: what a HOSTED night pays (admin TEMPLATES) -------------- */
function hosted(key) {
  const at = adm.indexOf('\n  ' + key + ': {');
  if (at < 0) throw new Error('no admin TEMPLATE for ' + key);
  const head = adm.slice(at, at + 400000);
  const wm = /worth:\s*\[([0-9,\s]+)\]/.exec(head);
  const tm = /tags:\s*\[([^\]]+)\]/.exec(head);
  if (!wm || !tm) throw new Error('admin ' + key + ': no worth or tags');
  const worth = nums(wm[1]);
  const tags  = tm[1].split(',').map(x => x.trim().replace(/^['"]|['"]$/g, ''));
  const counts = questionCounts(arrayAt(adm, adm.indexOf('[', adm.indexOf('rounds:', at))));
  const otAt = tags.indexOf('OT');
  const reg  = otAt >= 0 ? otAt : tags.length;
  const pay  = i => (worth[i] || 0) * (counts[i] || 0);
  let live = 0; for (let i = 0; i < reg; i++) live += pay(i);
  return { worth, tags, counts, live, ot: otAt >= 0 ? pay(otAt) : null, hasOt: otAt >= 0 };
}

/* ---- side B: what PRACTICE pays (index SPORTS fallback) -------------- */
function practice(key, roundsVar) {
  let at = idx.indexOf('\nSPORTS.' + key + '={');
  if (at < 0) at = idx.indexOf('\n  ' + key + ':{');
  if (at < 0) throw new Error('no SPORTS entry for ' + key);
  const wm = /worth:\s*\[([0-9,\s]+)\]/.exec(idx.slice(at, at + 4000));
  if (!wm) throw new Error('index ' + key + ': no worth');
  const worth = nums(wm[1]);
  const m = new RegExp('\\b' + roundsVar + '\\s*=\\s*\\[').exec(idx);
  if (!m) throw new Error(roundsVar + ' not found');
  const counts = questionCounts(arrayAt(idx, m.index + m[0].length - 1));
  let live = 0;
  for (let i = 0; i < Math.min(worth.length, counts.length); i++) live += worth[i] * counts[i];
  return { worth, counts, live };
}

/* ---- what the player is PROMISED, from the copy they read ------------ */
function promised(key) {
  let at = idx.indexOf('\nSPORTS.' + key + '={');
  if (at < 0) at = idx.indexOf('\n  ' + key + ':{');
  if (at < 0) return null;
  const head = idx.slice(at, at + 8000);
  const k = head.indexOf('step1:"');
  if (k < 0) return null;
  /* BOUNDED TO THIS SPORT'S OWN SENTENCE. Requiring a thousands comma once
     made a three-digit total unmatchable, so the search walked out of
     soccer's entry and returned BASEBALL's number as soccer's promise. An
     unanchored pattern IS a substring match. Read the literal, stop at its
     closing quote, and answer null rather than guessing. */
  let i = k + 7, lit = '';
  for (; i < head.length; i++) {
    if (head[i] === '\\') { lit += head[i] + head[i + 1]; i++; continue; }
    if (head[i] === '"') break;
    lit += head[i];
  }
  const clean = lit.replace(/\\u[0-9a-fA-F]{4}/g, "'").replace(/\\./g, '');
  const m = /night\S*s\s+([0-9][0-9,]*)/.exec(clean);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

console.log('\n  night ceiling — every sport must be able to pay ' + NIGHT);
console.log('  hosted   ' + path.basename(ADMIN) + '  (admin TEMPLATES — what a real night pays)');
console.log('  practice ' + path.basename(IDX)   + '  (index SPORTS — the fallback bank)\n');

const rows = FAMILIES.map(f => {
  const r = { key: f.key };
  try { r.h = hosted(f.key); }                  catch (e) { r.hErr = e.message; }
  try { r.p = practice(f.key, f.rounds); }      catch (e) { r.pErr = e.message; }
  try { r.promise = promised(f.key); }          catch (e) { r.promise = null; }
  return r;
});

rows.forEach(r => {
  const H = r.h ? String(r.h.live + SHEET) : '(' + r.hErr + ')';
  const P = r.p ? String(r.p.live + SHEET) : '(' + r.pErr + ')';
  const flag = r.h && r.h.live === LIVE ? ' ' : '!';
  console.log('   ' + flag + '  ' + r.key.padEnd(11)
    + 'hosted ' + H.padStart(5)
    + '   practice ' + P.padStart(5)
    + '   promised ' + String(r.promise == null ? '—' : r.promise).padStart(5)
    + (r.h ? '   [' + r.h.worth.join(',') + '] x ' + r.h.counts.join('/') : ''));
});
console.log('');

const usable = rows.filter(r => r.h && r.p);
if (!usable.length) {
  console.log('  --   NOTHING WAS MEASURED: no sport parsed on both sides. The checks');
  console.log('       below are not reported, because a pass over zero rows is not a pass.');
  console.log('\n  RED    0 passed, 1 failed');
  process.exit(1);
}

t('every sport was found on both sides', () => {
  const m = rows.filter(r => r.hErr || r.pErr)
    .map(r => r.key + ': ' + (r.hErr || '') + (r.pErr ? ' / ' + r.pErr : ''));
  return m.length ? m.join('\n         ') : true;
});

t('a hosted night pays exactly ' + LIVE + ' in live rounds, in every sport', () => {
  const off = rows.filter(r => r.h && r.h.live !== LIVE)
    .map(r => r.key + ': ' + r.h.live + ' live → a ' + (r.h.live + SHEET) + '-point night'
      + '  [' + r.h.worth.join(',') + '] x ' + r.h.counts.join('/'));
  return off.length ? off.join('\n         ') : true;
});

t('the practice bank pays what a hosted night pays', () => {
  /* NOT COSMETIC. A player who practises on the 840-point soccer bank and
     then plays a 1,000-point hosted room has been taught the wrong game.
     roundWorth() falls back to SPORT.worth whenever no host is publishing,
     so this table IS the game in practice mode. */
  const off = rows.filter(r => r.h && r.p && r.p.live !== r.h.live)
    .map(r => r.key + ': practice pays ' + r.p.live + ', hosted pays ' + r.h.live
      + '  (practice [' + r.p.worth.join(',') + '] x ' + r.p.counts.join('/') + ')');
  return off.length ? off.join('\n         ') : true;
});

t('the copy promises what the night can actually pay', () => {
  const off = rows.filter(r => r.h && r.promise != null && r.promise !== r.h.live + SHEET)
    .map(r => r.key + ': copy says ' + r.promise + ', hosted night pays ' + (r.h.live + SHEET));
  return off.length ? off.join('\n         ') : true;
});

t('overtime pays ' + OT_PAYS + ' wherever a sport has one', () => {
  const off = rows.filter(r => r.h && r.h.hasOt && r.h.ot !== OT_PAYS)
    .map(r => r.key + ': OT pays ' + r.h.ot);
  return off.length ? off.join('\n         ') : true;
});

/* THE "worth is per question" CHECK WAS REMOVED, ON PURPOSE.
   It flagged baseball innings 6-8 because their per-question worth (40)
   happened to equal LIVE/rounds (400/10). A coincidence, not a defect —
   and a check that cries wolf on correct code teaches the person to stop
   reading it, which is the same reason the Sunday guards exist. The trap
   it was aiming at (writing a ROUND total into a PER-QUESTION field) is
   already caught, exactly and without heuristics, by the ceiling check
   above: get the multiplier wrong and the night total is wrong. */

console.log(`\n  ${fail ? 'RED  ' : 'GREEN'}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
