#!/usr/bin/env node
/* A Caught It card that is finished must not come back.
 *
 *   node qa/caught-stale.js [index.html]
 *
 * Founder, 21 Aug 2026: "when i switch between screens it shows an old
 * caught it and is usually the same one."
 *
 * Two separate faults produced one symptom, and both are the house disease:
 * a fact with an owner kept somewhere else and allowed to drift.
 *
 *  1. `ciStash` puts an unanswered card into `PCI.pending` so it can be
 *     handed back after a quarter question. It stashed a SETTLED one too,
 *     and `ciFlush` re-rendered whatever it found with no state check. A
 *     card taken off screen unanswered, which then resolved while it sat in
 *     the queue, came back as a finished result. `paintNav` calls ciFlush on
 *     every single navigation, so it came back on every tab change. THE
 *     SAME ONE, because one stale question sat in the queue.
 *
 *  2. `ciFlush` returned early when the screen disallowed the card WITHOUT
 *     clearing `pending`, so the debt survived for the life of the page.
 *
 *  3. `paintNav` hid the card only on screens where Caught It is not allowed
 *     at all, so a finished result on Gametime was carried verbatim onto
 *     Stats and the Board.
 *
 * These are static checks against the shipped file. They are deliberately
 * about the RULES rather than a rendered pixel, because the rule is the part
 * that was wrong, and a browser check here would need a live question, a
 * settle, and a tab change to reproduce something a reader can see in eight
 * lines of source.
 */
const fs = require('fs');
const path = require('path');

const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
const src = fs.readFileSync(file, 'utf8');
let fails = 0;

function ck(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name); return; }
  console.log('  FAIL ' + name + (detail ? '  ' + detail : ''));
  fails++;
}

/* Slice to the function before asserting on its contents. Three unanchored
 * searches have gone green over the wrong body in this repo. */
function body(name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return '';
  let i = src.indexOf('{', at), depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(i, j + 1);
}

console.log('caught-stale — a finished card does not come back\n');

const flush = body('ciFlush');
ck('ciFlush exists', !!flush);
ck('ciFlush refuses a card that already resolved',
   /state\s*===\s*'resolved'/.test(flush), 'a settled card is not a debt');
ck('ciFlush refuses a card that was already answered',
   /PCI\.picked\[[^\]]+\]\s*!=\s*null/.test(flush), 'answered is finished');
ck('ciFlush refuses a card whose clock ran out while stashed',
   /locksMs/.test(flush) && /Date\.now\(\)/.test(flush),
   'offering a choice that can no longer be made');
ck('ciFlush clears the debt before the screen test, not after',
   flush.indexOf('PCI.pending=null') < flush.indexOf('if(!ciScreenOk())'),
   'an early return without clearing leaves pending set for the life of the page');

const stash = body('ciStash');
ck('ciStash exists', !!stash);
ck('ciStash only queues a card that is still OPEN',
   /state\s*!==\s*'resolved'/.test(stash), 'it queued settled cards too');
ck('ciStash clears the queue when there is nothing owed',
   /else\s+PCI\.pending\s*=\s*null/.test(stash),
   'otherwise a stale debt outlives the question that created it');

const nav = body('paintNav');
ck('paintNav exists', !!nav);
ck('paintNav hides a SETTLED card when the screen changes',
   /lastScreen/.test(nav), 'a result belongs to the moment it landed');
ck('and it remembers which screen it was on',
   /PCI\.lastScreen\s*=\s*scr/.test(nav));
ck('an OPEN card still travels across tabs',
   /a\.state\s*===\s*'resolved'/.test(nav) || /state==='resolved'/.test(nav),
   'only a finished card is dropped; a live one is a task with a clock on it');

console.log();
if (fails) { console.log(fails + ' FAILED'); process.exit(1); }
console.log('all caught-stale checks pass');
