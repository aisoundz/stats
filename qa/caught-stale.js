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
 * THIS SUITE RUNS THE REAL FUNCTIONS AND ASSERTS NOTHING ABOUT THE TEXT.
 * The first version only asserted that certain strings appeared in the
 * source, which would have gone green over
 *
 *     if(q.state==='resolved'){ /* nothing *\/ }
 *
 * a guard written and then ignored — the exact defect class the fix is
 * about, reproduced inside its own check. So all three functions are sliced
 * out of the shipped file with a brace matcher and executed against stubs,
 * and every assertion is about what they DO.
 *
 * paintNav was the last structural holdout and is now lifted too. It is
 * bigger than the other two, but every global it touches is nameable, and
 * "it cannot be lifted" was never a reason to keep a check that a written-
 * and-ignored guard satisfies.
 *
 * Each guard here has been watched failing. Sabotages replayed on a COPY of
 * index.html, never the working file: guard deleted, guard written then
 * ignored, lastScreen comparison dropped for a blanket hide, lastScreen
 * never recorded, and an OPEN card counted as finished. All five go red,
 * and the last one reddens exactly one check — the one that separates
 * "hide what is finished" from "hide everything".
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
const src = fs.readFileSync(file, 'utf8');
let fails = 0;

let passes = 0;
function ck(name, cond, detail) {
  if (cond) { passes++; console.log('  ok   ' + name); return; }
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
/* THIS ONE USED TO BE STRUCTURAL AND THAT WAS THE WEAK SPOT IN THIS FILE.
 * It asserted that /PCI\.lastScreen/ appeared in the body, which a guard
 * written and then ignored satisfies perfectly — the exact hole the rest of
 * this suite was rewritten to close. paintNav is bigger than ciFlush, but
 * every global it touches is nameable, so it can be lifted too.
 *
 * THE TRAP, and it is the reason the stubs below are the way they are:
 * paintNav ALSO hides the card at `if(ci && !ciScreenOk()) display='none'`.
 * Stub ciScreenOk() to false and every "the settled card was hidden" check
 * passes with the travel guard deleted, because something else did the
 * hiding. So ciScreenOk() returns TRUE throughout, and the cases below are
 * chosen so that only the real guard can satisfy all of them at once:
 * same-screen must stay VISIBLE, and an open card must stay visible even
 * across a screen change. A blanket hide fails those two.
 *
 * Nearly every line of paintNav sits in `try{}catch(_){}`, so a stub that
 * throws is swallowed and the check proves nothing. The stubs are therefore
 * total — no getter returns undefined where the code will dereference it. */
const paintNavSrc = body('paintNav');
ck('paintNav could be sliced out of the file', !!paintNavSrc);

function navSandbox(opts) {
  const el = () => ({ style: { display: '', setProperty: function () {} },
                      classList: { toggle: function () {}, remove: function () {},
                                   add: function () {} },
                      querySelectorAll: function () { return []; },
                      getAttribute: function () { return null; } });
  const ci = el();
  ci.style.display = opts.ciDisplay !== undefined ? opts.ciDisplay : 'block';
  const nodes = { botnav: el(), menuBtn: el(), ciCard: ci, pdBar: el() };
  const ctx = {
    document: {
      getElementById: function (id) { return nodes[id] || null; },
      body: { classList: { toggle: function () {}, remove: function () {} } },
      documentElement: { style: { setProperty: function () {} } }
    },
    /* the app's own globals, all total */
    S: { screen: opts.screen, mode: 'live' },
    NAV_HIDE_ON: [],
    map: {},
    PCI: Object.assign({ active: null, picked: {}, pending: null,
                         lastScreen: opts.lastScreen }, opts.PCI || {}),
    leanStripTabs: function () {},
    closeMenu: function () {},
    paintRail: function () {},
    paintGameBar: function () {},
    paintContinueCard: function () {},
    /* TRUE, deliberately. See the note above. */
    ciScreenOk: function () { return true; },
    ciFlush: function () {},
    /* paintNav defers ciFlush by 420ms. Swallow it: this is about paintNav. */
    setTimeout: function () { return 0; },
    ci: ci
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(paintNavSrc, ctx);
  ctx.paintNav();
  return ctx;
}

const settled = { qid: 'q9', state: 'resolved' };
const openq   = { qid: 'q8', state: 'open' };
const voidq   = { qid: 'q7', state: 'void' };

let n = navSandbox({ screen: 'stats', lastScreen: 'gametime',
                     PCI: { active: settled } });
ck('a settled card is hidden when the screen changed under it',
   n.ci.style.display === 'none',
   'the founder saw a finished Gametime result carried onto Stats and the Board');

n = navSandbox({ screen: 'gametime', lastScreen: 'gametime',
                 PCI: { active: settled } });
ck('the SAME settled card stays put on the screen it landed on',
   n.ci.style.display !== 'none',
   'a blanket hide would pass the check above and fail this one');

n = navSandbox({ screen: 'stats', lastScreen: 'gametime',
                 PCI: { active: openq } });
ck('an OPEN card still travels across a screen change',
   n.ci.style.display !== 'none',
   'that one is a live task with a clock on it, not a stale answer');

n = navSandbox({ screen: 'board', lastScreen: 'gametime',
                 PCI: { active: openq, picked: { q8: 1 } } });
ck('a card the player has ANSWERED does not travel',
   n.ci.style.display === 'none',
   'answered is finished, whatever its state field still says');

n = navSandbox({ screen: 'board', lastScreen: 'gametime',
                 PCI: { active: voidq } });
ck('a VOIDED card does not travel either', n.ci.style.display === 'none');

n = navSandbox({ screen: 'stats', lastScreen: null,
                 PCI: { active: settled } });
ck('with no screen recorded yet, nothing is hidden',
   n.ci.style.display !== 'none',
   'the first paint has nothing to compare against and must not guess');

n = navSandbox({ screen: 'board', lastScreen: 'gametime', PCI: { active: settled } });
ck('paintNav records the screen it just painted',
   n.PCI.lastScreen === 'board',
   'without this the comparison above is against a screen two navigations old');

console.log();
if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
/* THE COUNT IS NOT DECORATION. qa/all.js floors each suite's check count in
 * qa/.counts.json and goes red when one shrinks, but it can only do that for
 * a summary line with a number in it. This file used to end "all caught-stale
 * checks pass", so it had no floor at all and could have quietly dropped to a
 * single assertion while the gate still printed ok. */
console.log(passes + ' passed, 0 failed — a settled card does not come back');
