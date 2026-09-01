/* ============ qa/night-ceiling.js ====================================
   THE NIGHT TOTAL A SPORT PROMISES MUST BE THE NIGHT TOTAL IT CAN PAY.

   Found 31 Aug 2026, not by a test but by writing the user manual and
   doing the arithmetic on paper:

       basketball  4 rounds x 4q x [10,20,30,40]           400 + 600 = 1,000  ok
       soccer      2 rounds x 3q x [30,50]                 240 + 600 =   840  SHORT 160
       baseball    9 rounds x 2q x [20,20,30,...,50]       600 + 600 = 1,200  OVER 200

   All three print "600 of the night's 1,000" on their own rules screen.
   Soccer has been overstating what a player can win — by a sixth of the
   night — since the day it shipped. Baseball became 1,200 the evening of
   31 Aug when it went from three rounds to nine: the per-question weights
   were doubled to protect a 600 live ceiling, and the total underneath was
   never re-checked.

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
const fileArg = argv.indexOf('--file');
const SRC = path.join(__dirname, '..',
  fileArg >= 0 && argv[fileArg + 1] ? argv[fileArg + 1] : 'index.html');
const SABOTAGE = argv.includes('--sabotage');

let pass = 0, fail = 0;
const ok  = (n, d) => { pass++; console.log('  ok   ' + n + (d ? ('   ' + d) : '')); };
const bad = (n, d) => { fail++; console.log('  FAIL ' + n + (d ? '\n         ' + d : '')); };
const t   = (n, f) => { try { const r = f(); r === true ? ok(n) : bad(n, r || undefined); }
                        catch (e) { bad(n, e.message); } };

let src;
try { src = fs.readFileSync(SRC, 'utf8'); }
catch (e) { console.log('  FAIL cannot read ' + SRC + ' — ' + e.message); process.exit(1); }

console.log('\n  night ceiling — what each sport promises vs what it can pay');
console.log('  file  ' + path.basename(SRC) + (SABOTAGE ? '   [SABOTAGE]' : ''));

/* ---- the sports, and where each one's three facts live ---------------
   Named explicitly rather than discovered, because a sport this suite
   cannot find must be a LOUD failure. A discovery loop that silently
   matches nothing is how host-resolvers.js "passed" for weeks while
   running nothing at all. */
const SPORTS = [
  { key: 'basketball', rounds: 'BBALL_ROUNDS'  },
  { key: 'soccer',     rounds: 'SOCCER_ROUNDS' },
  { key: 'baseball',   rounds: 'BA_ROUNDS'     },
  { key: 'football',   rounds: 'FO_ROUNDS'     },
  { key: 'hockey',     rounds: 'HO_ROUNDS'     },
];

/* TWO ATTACHMENT FORMS, AND MISSING ONE HID THREE SPORTS. basketball and
   soccer are members of the SPORTS object literal (`\n  key:{`); baseball,
   football and hockey were added later as `SPORTS.key={`. The first draft
   of this suite only knew the literal form and reported "no SPORTS entry
   for baseball" — on the sport whose ceiling had just broken. */
function entryAt(key) {
  let at = src.indexOf('\nSPORTS.' + key + '={');
  if (at < 0) at = src.indexOf('\n  ' + key + ':{');
  return at;
}

/* The prediction sheet is 600 of the night in every sport — that is the
   one number the banks agree on, and it is asserted below rather than
   assumed, so a sport that quietly changes it fails here too. */
const SHEET = 600;

function worthOf(key) {
  /* The worth array lives inside the SPORTS entry for the family. Anchor
     on the family key so a second `worth:[...]` elsewhere in the file
     (admin templates, a comment) cannot be picked up by accident. */
  const at = entryAt(key);
  if (at < 0) throw new Error('no SPORTS entry for ' + key);
  const m = /worth:\s*\[([0-9,\s]+)\]/.exec(src.slice(at, at + 4000));
  if (!m) throw new Error('no worth array for ' + key);
  return m[1].split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
}

function questionsPerRound(varName) {
  /* Count the question objects inside each top-level sub-array of the
     rounds literal. Brace-matched rather than regexed across the whole
     block, because a question's own text contains brackets. */
  const m = new RegExp('\\b' + varName + '\\s*=\\s*\\[').exec(src);
  if (!m) throw new Error(varName + ' not found');
  let i = m.index + m[0].length - 1, d = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '[') d++;
    else if (src[j] === ']') { d--; if (d === 0) break; }
  }
  const body = src.slice(i + 1, j);
  const counts = []; let depth = 0, start = null;
  for (let k = 0; k < body.length; k++) {
    if (body[k] === '[') { depth++; if (depth === 1) start = k + 1; }
    else if (body[k] === ']') { if (depth === 1) counts.push((body.slice(start, k).match(/\{\s*t\s*:/g) || []).length); depth--; }
  }
  return counts;
}

/* ---- the promise, read from the copy a player actually sees ---------- */
function promisedOf(key) {
  const at = entryAt(key);
  if (at < 0) return null;
  /* BOUND TO THIS SPORT'S OWN SENTENCE, NOT A WINDOW NEAR IT.
     Two bugs happened here in one evening, and the second was worse:

       1. `[0-9],?[0-9]{3}` matched the digits inside the escape sequence
          \u2019 and reported soccer as promising 2,019 points.
       2. Requiring the comma fixed that and broke something worse. A
          three-digit total (840, 960) then matched nothing inside the
          sport's own copy, so the search WALKED FORWARD out of soccer's
          entry and returned BASEBALL's 1,200 as soccer's promise. It
          reported a number, confidently, belonging to another sport.

     That is the oldest bug in this repo — an unanchored pattern IS a
     substring match — committed inside the file written to stop it. The
     fix is not a better regex, it is a boundary: read the step1 string
     literal and nothing outside it. If the sentence names no total, the
     answer is null and the caller says so. */
  const head = src.slice(at, at + 8000);
  const k = head.indexOf('step1:"');
  if (k < 0) return null;
  let i = k + 7, lit = '';
  for (; i < head.length; i++) {
    if (head[i] === '\\') { lit += head[i] + head[i + 1]; i++; continue; }
    if (head[i] === '"') break;
    lit += head[i];
  }
  /* Escapes out first, so no \uXXXX can contribute digits. */
  const clean = lit.replace(/\\u[0-9a-fA-F]{4}/g, "'").replace(/\\./g, '');
  const m = /night\S*s\s+([0-9][0-9,]*)/.exec(clean);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

const rows = [];
SPORTS.forEach(sp => {
  let worth, counts, promised, err = null;
  try {
    worth    = worthOf(sp.key);
    counts   = questionsPerRound(sp.rounds);
    promised = promisedOf(sp.key);
  } catch (e) { err = e.message; }
  rows.push({ ...sp, worth, counts, promised, err });
});

/* A round the bank does not have is not scored; a worth the bank does not
   have pays nothing. Pair them index-wise and stop at the shorter, which
   is exactly what the app does. */
function liveCeiling(r) {
  let n = Math.min(r.worth.length, r.counts.length), total = 0;
  for (let i = 0; i < n; i++) total += r.worth[i] * r.counts[i];
  return total;
}

console.log('');
rows.forEach(r => {
  if (r.err) { console.log('  --   ' + r.key + ': ' + r.err); return; }
  const live = liveCeiling(r);
  console.log('       ' + r.key.padEnd(11)
    + String(r.counts.length).padStart(2) + ' rounds x ' + r.counts.join('/') + ' q'
    + '   live ' + String(live).padStart(4)
    + ' + sheet ' + SHEET + ' = ' + String(live + SHEET).padStart(5)
    + '   promised ' + (r.promised == null ? '(none found)' : r.promised));
});
console.log('');

t('every sport was found — worth array, rounds and rules copy', () => {
  const missing = rows.filter(r => r.err);
  return missing.length ? missing.map(r => r.key + ': ' + r.err).join('\n         ') : true;
});

/* GREEN OVER NOTHING IS THE DISEASE THIS REPO ALREADY HAS. The three
   checks below filter errored rows away, so when the parser broke and all
   five sports failed to parse, all three reported `ok` — measuring nothing
   and saying so in the language of success. Exactly host-resolvers.js's
   "no fixtures dir — skipping" + exit(0). The suite was red overall because
   the first check failed, which is luck, not design. */
const usable = rows.filter(r => !r.err);
if (!usable.length) {
  console.log('  --   NOTHING WAS MEASURED: no sport parsed. The checks below are not');
  console.log('       reported, because a pass over zero rows is not a pass.');
  console.log(`\n  RED    ${pass} passed, ${fail} failed`);
  process.exit(1);
}

t('every sport states a night total in its own rules copy', () => {
  const silent = rows.filter(r => !r.err && r.promised == null);
  return silent.length
    ? silent.map(r => r.key + ": step1 names no night total — a player is told nothing").join('\n         ')
    : true;
});

t('what the sport promises is what the sport can pay', () => {
  const off = rows.filter(r => !r.err && r.promised != null)
    .map(r => ({ r, real: liveCeiling(r) + SHEET }))
    .filter(x => x.real !== x.r.promised);
  if (!off.length) return true;
  return off.map(x => x.r.key + ': promises ' + x.r.promised + ', can pay ' + x.real
    + '  (' + (x.real > x.r.promised ? 'understates by ' + (x.real - x.r.promised)
                                     : 'OVERSTATES by ' + (x.r.promised - x.real)) + ')'
  ).join('\n         ');
});

t('no sport overstates — a player is never promised points that cannot exist', () => {
  const over = rows.filter(r => !r.err && r.promised != null && r.promised > liveCeiling(r) + SHEET);
  return over.length
    ? over.map(r => r.key + ': promises ' + r.promised + ', ceiling is ' + (liveCeiling(r) + SHEET)).join('\n         ')
    : true;
});

/* ---- the trap, asserted directly ------------------------------------
   Not a restatement of the check above. This one fails specifically when
   somebody has written a ROUND total into a PER-QUESTION field, which is
   the mistake that caused this bug twice. If any round's worth already
   equals what that round should pay, the array has been misread. */
t('worth is per question, not per round', () => {
  const suspect = [];
  rows.filter(r => !r.err).forEach(r => {
    r.counts.forEach((q, i) => {
      if (q > 1 && r.worth[i] != null && r.worth[i] % q === 0 && r.worth[i] / q === r.worth[i]) suspect.push(r.key + ' round ' + (i + 1));
    });
  });
  return suspect.length ? suspect.join(', ') + ' — worth looks like a round total' : true;
});

if (SABOTAGE) {
  console.log('\n  SABOTAGE — the checks above ran against the real file. Restore a known');
  console.log('  regression to prove they go red, e.g. set soccer worth to [30,50] with a');
  console.log('  step1 promising 1,000 (that IS the live bug and check 3 must fail on it).');
}

console.log(`\n  ${fail ? 'RED  ' : 'GREEN'}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
