/* ============ qa/hustle.js ===========================================
   THE CURRENCY PAYS FOR BEING THERE, NOT FOR BEING RIGHT.

   HUSTLE is the second currency. Points are earned by being RIGHT; HUSTLE
   by SHOWING UP, and that split is the entire reason this is a loyalty
   programme rather than a sweepstakes. It is also the single property a
   lawyer would look at first, which is why it is asserted here rather than
   trusted to a comment.

   The function under test is READ OUT OF host/run.js, the way
   qa/bank-shadow.js reads the engine out of admin.html. A test that keeps
   its own copy of the arithmetic tests the copy.

   Static: no db, no clock, no browser. It cannot flake.

       node qa/hustle.js
*/
const path = require('path');

let computeHustle;
try {
  ({ computeHustle } = require(path.join(__dirname, '..', 'host', 'run.js')));
} catch (e) {
  console.log('  FAIL cannot load host/run.js — ' + e.message);
  process.exit(1);
}

let pass = 0, fail = 0;
const ok  = (n, d) => { pass++; console.log('  ok   ' + n + (d ? ('   ' + d) : '')); };
const bad = (n, d) => { fail++; console.log('  FAIL ' + n + (d ? '\n         ' + d : '')); };
const t   = (n, f) => { try { const r = f(); r === true ? ok(n) : bad(n, r || undefined); }
                        catch (e) { bad(n, e.message); } };

console.log('\n  HUSTLE — the presence ledger\n');

if (typeof computeHustle !== 'function') {
  console.log('  FAIL host/run.js does not export computeHustle');
  process.exit(1);
}

const R = ids => ids.map(id => ({ id }));

t('the function is reachable at all', () => typeof computeHustle === 'function');

t('an answer earns, right or wrong', () => {
  /* THE WHOLE POINT. These picks are deliberately nonsense — no key is
     consulted anywhere in this function, and that is the design. */
  const h = computeHustle(R(['r0']), { r0: { u1: { picks: ['WRONG', 'ALSO WRONG'] } } }, ['u1']);
  return h.u1 === 2 + 2 ? true : `expected 4 (2 answers + 2 for the last round), got ${h.u1}`;
});

t('a player who answered nothing earns nothing', () => {
  const h = computeHustle(R(['r0', 'r1']), { r0: { u1: { picks: [] } }, r1: {} }, ['u1', 'u2']);
  return (h.u1 === 0 && h.u2 === 0) ? true : `u1=${h.u1} u2=${h.u2}, both should be 0`;
});

t('empty and null picks are not answers', () => {
  const h = computeHustle(R(['r0']), { r0: { u1: { picks: [null, '', undefined, 'A'] } } }, ['u1']);
  return h.u1 === 1 + 2 ? true : `expected 3 (one real answer + 2), got ${h.u1}`;
});

t('the finish bonus is 2, and only on the last round', () => {
  const subs = { r0: { u1: { picks: ['A'] } }, r1: { u1: { picks: ['B'] } } };
  const h = computeHustle(R(['r0', 'r1']), subs, ['u1']);
  /* 1 + 1 answers, +2 for having answered in r1 */
  return h.u1 === 4 ? true : `expected 4, got ${h.u1}`;
});

t('leaving early forfeits the finish bonus but keeps the answers', () => {
  const subs = { r0: { u1: { picks: ['A', 'B'] } }, r1: {} };
  const h = computeHustle(R(['r0', 'r1']), subs, ['u1']);
  return h.u1 === 2 ? true : `expected 2 (two answers, no finish bonus), got ${h.u1}`;
});

t('it is RECOMPUTED, not accumulated — running twice cannot double it', () => {
  /* scoreRoom() calls this after every key: nine times a night in baseball,
     per room. If it accumulated, a nine-inning game would pay nine times. */
  const subs = { r0: { u1: { picks: ['A', 'B'] } } };
  const a = computeHustle(R(['r0']), subs, ['u1']);
  const b = computeHustle(R(['r0']), subs, ['u1']);
  const c = computeHustle(R(['r0']), subs, ['u1']);
  return (a.u1 === b.u1 && b.u1 === c.u1) ? true : `${a.u1} then ${b.u1} then ${c.u1}`;
});

t('a nine-inning night pays what the rules say and no more', () => {
  /* Nine rounds, two questions each, a player who answered every one and
     was there at the end: 18 answers + 2. If this ever reads 9x anything,
     the accumulate bug is back. */
  const ids = ['r0','r1','r2','r3','r4','r5','r6','r7','r8'];
  const subs = {}; ids.forEach(id => { subs[id] = { u1: { picks: ['A','B'] } }; });
  const h = computeHustle(R(ids), subs, ['u1']);
  return h.u1 === 20 ? true : `expected 20 (18 answers + 2 finish), got ${h.u1}`;
});

t('no round, no balance — and no crash', () => {
  const h = computeHustle([], {}, ['u1']);
  return h.u1 === 0 ? true : `expected 0, got ${h.u1}`;
});

t('a player with submissions but no player row still resolves', () => {
  /* A seat that appears in subs but not in the uid list must not become
     NaN or undefined — the ledger is written from these keys. */
  const h = computeHustle(R(['r0']), { r0: { ghost: { picks: ['A'] } } }, []);
  return h.ghost === 3 ? true : `expected 3, got ${h.ghost}`;
});

t('accuracy is nowhere in the computation', () => {
  /* Asserted against the SOURCE, not the behaviour: if a future edit reads
     a key or a correct-answer list in here, the presence/accuracy split is
     gone and no amount of arithmetic testing would notice. */
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'host', 'run.js'), 'utf8');
  const i = src.indexOf('function computeHustle(');
  let d = 0, j = src.indexOf('{', i), end = j;
  for (; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) { end = j; break; } }
  }
  const body = src.slice(i, end);
  const banned = ['key', 'correct', 'right', 'grade', 'score'];
  const hit = banned.filter(w => new RegExp('\\b' + w + '\\b').test(body.replace(/\/\*[\s\S]*?\*\//g, '')));
  return hit.length ? 'computeHustle references ' + hit.join(', ') + ' — HUSTLE must not know whether an answer was right' : true;
});

/* ============ AND THE DISPLAY ========================================
   The ledger being right is half of it. These read the player app. */
const fsx = require('fs');
const IDX = path.join(__dirname, '..',
  (() => { const i = process.argv.indexOf('--file'); return i >= 0 && process.argv[i+1] ? process.argv[i+1] : 'index-test.html'; })());
let app = '';
try { app = fsx.readFileSync(IDX, 'utf8'); } catch (_) { app = ''; }

if (!app) {
  console.log('  --   the player app was not readable: the DISPLAY checks did not run.');
  fail++;
} else {
  t('the balance is shown, and labelled HUSTLE', () =>
    app.includes('id="finalHustle"') && /<div class="k">HUSTLE<\/div>/.test(app)
      ? true : 'no #finalHustle tile labelled HUSTLE');

  t('an unknown balance shows a dash, never 0', () => {
    /* Unknown and zero are different facts. The pick sheet already follows
       this rule for an absent player — NOTHING, never 0.0 — and a rules
       deploy that has not happened must not read as "you earned nothing". */
    const i = app.indexOf('id="finalHustle"');
    const seg = app.slice(i, i + 60);
    return /">\s*—\s*</.test(seg) ? true : 'the tile defaults to something other than an em-dash: ' + seg.slice(0, 40);
  });

  t('the app READS the ledger and never writes it', () => {
    /* A balance a phone can write is a balance a phone can forge. The
       rules forbid it, but a client that TRIES is a bug worth catching
       here rather than as a permission error in somebody's console. */
    const i = app.indexOf('SB.hustleFor');
    if (i < 0) return 'no SB.hustleFor';
    const seg = app.slice(i, i + 1400);
    const bad = ['setDoc', 'updateDoc', 'addDoc', 'deleteDoc', 'writeBatch'];
    const hit = bad.filter(w => seg.includes(w));
    return hit.length ? 'SB.hustleFor references ' + hit.join(', ') + ' — it must only read' : true;
  });

  t('the night balance is not faked into a season total', () => {
    /* The ledger is per night. A season number needs a server-maintained
       aggregate; fanning out a read per night to invent one would be both
       expensive and unauditable. */
    const i = app.indexOf('SB.hustleFor');
    const seg = app.slice(i, i + 1400);
    return /for\s*\(|\.map\(|forEach\(/.test(seg)
      ? 'SB.hustleFor loops — it must read exactly one night' : true;
  });
}

console.log(`\n  ${fail ? 'RED  ' : 'GREEN'}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
