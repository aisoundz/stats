#!/usr/bin/env node
/* A Caught It card that is finished must not come back.
 *
 *   node qa/caught-stale.js [index.html]
 *
 * Founder, 21 Aug 2026: "when i switch between screens it shows an old
 * caught it and is usually the same one."
 *
 * Two faults produced one symptom, and both are the house disease: a fact
 * with an owner kept somewhere else and allowed to drift.
 *
 *  1. `ciStash` puts an unanswered card into `PCI.pending` so it can be
 *     handed back after a quarter question. It stashed a SETTLED one too,
 *     and `ciFlush` re-rendered whatever it found with no state check. A
 *     card taken off screen unanswered, which then resolved while it sat in
 *     the queue, came back as a finished result. `paintNav` calls ciFlush on
 *     every navigation, so it came back on every tab change. THE SAME ONE,
 *     because one stale question sat in the queue.
 *
 *  2. `ciFlush` returned early when the screen disallowed the card WITHOUT
 *     clearing `pending`, so the debt survived for the life of the page.
 *
 *  3. `paintNav` hid the card only where Caught It is not allowed at all, so
 *     a finished result on Gametime was carried onto Stats and the Board.
 *
 * THIS SUITE RUNS THE REAL FUNCTIONS. The first version only asserted that
 * certain text appeared in the source, which would have gone green over
 * `if(q.state==='resolved'){ /* nothing *\/ }` — a guard written and then
 * ignored. That is the exact defect class the fix is about, reproduced
 * inside its own check. So `ciFlush` and `ciStash` are sliced out of the
 * shipped file and executed against stubs, and the assertions are about what
 * they DO. The structural checks that remain are only for paintNav, which
 * cannot be lifted out without the whole nav bar.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
const src = fs.readFileSync(file, 'utf8');
let fails = 0;

function ck(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); return; }
  console.log('  FAIL ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail) : ''));
  fails++;
}

/* Slice to the function before doing anything with it. Three unanchored
 * searches have gone green over the wrong body in this repo. */
function body(name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return '';
  let depth = 0, i = src.indexOf('{', at), j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(at, j + 1);
}

const ciFlushSrc = body('ciFlush');
const ciStashSrc = body('ciStash');
if (!ciFlushSrc || !ciStashSrc) {
  console.log('  FAIL could not slice ciFlush/ciStash out of ' + path.basename(file));
  process.exit(1);
}

/* A sandbox with just enough of the app for these two functions: the state
 * object they read, the screen test they call, and a renderer that records
 * rather than draws. */
function sandbox(opts) {
  opts = opts || {};
  const rendered = [];
  const ctx = {
    PCI: Object.assign({ active: null, picked: {}, pending: null }, opts.PCI || {}),
    ciScreenOk: function () { return opts.screenOk !== false; },
    renderCiCard: function (q) { rendered.push(q); },
    document: {
      getElementById: function () { return opts.card || null; },
      documentElement: { style: { setProperty: function () {} } },
      body: { classList: { remove: function () {} } }
    },
    Date: Date,
    rendered: rendered
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(ciFlushSrc + '\n' + ciStashSrc, ctx);
  return ctx;
}

const OPEN = { qid: 'q1', state: 'open', locksMs: 20000,
               opensAt: { toMillis: function () { return Date.now(); } } };
const RESOLVED = { qid: 'q2', state: 'resolved', locksMs: 20000,
                   opensAt: { toMillis: function () { return Date.now(); } } };
const STALE = { qid: 'q3', state: 'open', locksMs: 20000,
                opensAt: { toMillis: function () { return Date.now() - 120000; } } };

console.log('caught-stale — a finished card does not come back\n');

console.log('== ciFlush: what it hands back ==');
let c = sandbox({ PCI: { pending: OPEN } });
c.ciFlush();
ck('an OPEN unanswered card IS handed back', c.rendered.length === 1, c.rendered.length);
ck('and the debt is cleared once paid', c.PCI.pending === null, c.PCI.pending);

c = sandbox({ PCI: { pending: RESOLVED } });
c.ciFlush();
ck('a RESOLVED card is NOT handed back', c.rendered.length === 0,
   'this is the founder-reported bug: a finished result returning on every tab change');
ck('and it is dropped from the queue', c.PCI.pending === null, c.PCI.pending);

c = sandbox({ PCI: { pending: OPEN, picked: { q1: 2 } } });
c.ciFlush();
ck('a card the player already ANSWERED is not handed back', c.rendered.length === 0);

c = sandbox({ PCI: { pending: STALE } });
c.ciFlush();
ck('a card whose clock ran out while stashed is not handed back', c.rendered.length === 0,
   'it would offer a choice that can no longer be made');
ck('and that one is dropped too', c.PCI.pending === null);

console.log('\n== ciFlush: the screen test must not leak the debt ==');
c = sandbox({ PCI: { pending: OPEN }, screenOk: false });
c.ciFlush();
ck('a disallowed screen does not render it', c.rendered.length === 0);
ck('an OPEN card survives to be offered later', c.PCI.pending !== null,
   'it is genuinely still owed');
c = sandbox({ PCI: { pending: RESOLVED }, screenOk: false });
c.ciFlush();
ck('but a settled card is dropped even on a disallowed screen',
   c.PCI.pending === null,
   'returning early without clearing left it set for the life of the page');

console.log('\n== ciStash: what it queues ==');
const card = { style: { display: 'block' } };
c = sandbox({ PCI: { active: OPEN }, card: card });
c.ciStash();
ck('an OPEN unanswered card is owed back', c.PCI.pending === OPEN);

card.style.display = 'block';
c = sandbox({ PCI: { active: RESOLVED }, card: card });
c.ciStash();
ck('a RESOLVED card is NOT queued', c.PCI.pending === null,
   'queuing a finished card is what ciFlush then re-showed');

card.style.display = 'block';
c = sandbox({ PCI: { active: OPEN, picked: { q1: 1 } }, card: card });
c.ciStash();
ck('an ANSWERED card is not queued either', c.PCI.pending === null);

console.log('\n== paintNav: a settled card does not travel ==');
/* Structural, because lifting paintNav out would need the whole nav bar.
 * Named so a reader knows why this one is weaker than the rest. */
const nav = body('paintNav');
ck('paintNav exists', !!nav);
ck('it compares the screen it last painted', /PCI\.lastScreen/.test(nav),
   'a result belongs to the moment it landed');
ck('it records the screen for next time', /PCI\.lastScreen\s*=\s*scr/.test(nav));
ck('and it only drops a card that is finished',
   /resolved/.test(nav) && /picked/.test(nav),
   'an OPEN card is a live task with a clock on it and must still travel');

console.log();
if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('all caught-stale checks pass');
