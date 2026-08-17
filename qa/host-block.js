#!/usr/bin/env node
/* =====================================================================
   Does the @host-shared block still load, and is every resolver still there?
   ---------------------------------------------------------------------
   This does exactly what host/run.js does at startup: slice admin.html
   between the sentinels and evaluate it in a vm context with no document
   and no window. run.js exits non-zero rather than host a night with no
   answers in it; so does this.

       node qa/host-block.js                 # inventory + evaluate
       node qa/host-block.js --expect N      # also fail if fewer than N resolvers
       node qa/host-block.js --baseline f    # fail if any name in f went missing

   WHY IT EXISTS AS ITS OWN FILE. The engine is read out of admin.html
   rather than copied into the runner, which is the right call — one copy
   of the resolvers instead of two that can disagree on the same night.
   The cost of that call is that ANY edit to admin.html can break the
   runner, and the break happens at 6:15pm from cron where nobody is
   watching. This turns that into a five-second check.
   ================================================================== */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const argOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const FILE = argOf('--file') || 'admin.html';
const src = fs.readFileSync(path.join(ROOT, FILE), 'utf8');

const START = '/* @host-shared:start';
const END = '/* @host-shared:end */';
const a = src.indexOf(START), b = src.indexOf(END);
if (a < 0 || b < 0 || b < a) {
  console.error(`FATAL: sentinels not found in ${FILE} (start=${a} end=${b}).`);
  console.error('run.js slices on these exact strings and will refuse to start.');
  process.exit(1);
}
const block = src.slice(a, b + END.length);
console.log(`${FILE}: block is ${block.length} chars, lines ${src.slice(0, a).split('\n').length}–${src.slice(0, b).split('\n').length}`);

/* No document. No window. No require. If the block reaches for any of them
   this throws here instead of at kickoff. */
const ctx = vm.createContext({ console, fetch: () => { throw new Error('no network in this check'); } });
try {
  vm.runInContext(block, ctx, { filename: 'host-shared' });
} catch (e) {
  console.error(`FATAL: the block does not evaluate in bare Node — ${e.message}`);
  console.error('This is the exact failure that leaves a night with no answers in it.');
  process.exit(1);
}

const AUTO = ctx.AUTO;
if (!AUTO) { console.error('FATAL: the block evaluated but defined no AUTO.'); process.exit(1); }
for (const fn of ['fetchFeed', 'resolve', 'periodDone', 'tally', 'sides', 'plays', 'inPeriod', 'clockSec']) {
  if (typeof AUTO[fn] !== 'function') { console.error(`FATAL: AUTO.${fn} is missing or not a function.`); process.exit(1); }
}
if (!AUTO.R || typeof AUTO.R !== 'object') { console.error('FATAL: AUTO.R is missing.'); process.exit(1); }

const names = Object.keys(AUTO.R).filter(k => typeof AUTO.R[k] === 'function').sort();
/* Prefix order matters and the first version got it wrong: with no ^nhl
   branch, twelve hockey resolvers were filed under "basketball" and the
   inventory read 44 basketball / 0 hockey. The count was right and the
   report was a lie, which is the more dangerous of the two. */
const groups = { basketball: [], mlb: [], mls: [], nfl: [], nhl: [] };
names.forEach(n => {
  if (/^mlb/.test(n)) groups.mlb.push(n);
  else if (/^mls/.test(n)) groups.mls.push(n);
  else if (/^nfl/.test(n)) groups.nfl.push(n);
  else if (/^nhl/.test(n)) groups.nhl.push(n);
  else groups.basketball.push(n);
});
console.log(`\nresolvers: ${names.length} total`);
for (const [k, v] of Object.entries(groups)) {
  if (v.length) console.log(`  ${k.padEnd(11)} ${String(v.length).padStart(3)}  ${v.join(' ')}`);
}

let bad = 0;

const baseFile = argOf('--baseline');
if (baseFile) {
  const want = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
  const gone = want.filter(n => names.indexOf(n) < 0);
  if (gone.length) { console.error(`\nFAIL: ${gone.length} resolver(s) went MISSING: ${gone.join(' ')}`); bad++; }
  else console.log(`\nbaseline: all ${want.length} previously-present resolvers still here`);
}

const expect = argOf('--expect');
if (expect && names.length < Number(expect)) {
  console.error(`FAIL: expected at least ${expect} resolvers, found ${names.length}`);
  bad++;
}

if (args.includes('--write-baseline')) {
  const out = argOf('--write-baseline');
  fs.writeFileSync(out, JSON.stringify(names, null, 0));
  console.log(`baseline written to ${out} (${names.length} names)`);
}

console.log(bad ? '\nNOT SAFE' : '\nblock loads clean');
process.exit(bad ? 1 : 0);
