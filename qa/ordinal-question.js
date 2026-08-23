/* ============================================================================
   qa/ordinal-question.js — A QUESTION THE BROADCAST DELAY CANNOT REACH

   Anis, on baseball: "the question for baseball it's tough to say what was
   the last pitch because the time is different, so it has to be something
   related to the game - who was the second strikeout etc."

   He is describing a fairness bug, not a preference. The ESPN feed runs
   AHEAD of the television — that is why the Caught It lock window was
   widened to 20 seconds — so a question about "that last pitch" or "who is
   at the plate right now" asks about something the viewer has not seen. The
   half-inning question was the worst of them: the feed moves to the bottom
   of the 5th while the screen still shows the top, and somebody watching
   carefully answers WRONG. A question that punishes watching is worse than
   one that gives a free point.

   An ordinal is immune. The second strikeout of a game happened when it
   happened. What makes it a real question is the LAG BUFFER — it is only
   asked once four strikeouts exist, so the one being asked about is well
   behind even a slow stream. Without that it is "the last strikeout"
   wearing an ordinal, and it fails for exactly the same reason.

   Checked against a real 604-play game where the first two strikeouts are
   Winn (2nd inning) and Wetherholt (3rd).
   ========================================================================== */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0; const bad = [];
const ok = (c, label, detail) => c ? pass++ : (fail++, bad.push(label + (detail ? '  — ' + detail : '')));

console.log('\n=== ORDINAL QUESTION ===\n');

const src = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const S = '/* @host-shared:start', E = '/* @host-shared:end */';
const ctx = vm.createContext({ console, fetch: () => { throw new Error('no net'); } });
vm.runInContext(src.slice(src.indexOf(S), src.indexOf(E) + E.length), ctx, { filename: 'host-shared' });
const C = ctx.AUTO.CI;
const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/multisport/mlb.json'), 'utf8'));
const T = { awayAbbr:'ARI', homeAbbr:'ATL', awayId:'1', homeId:'2', awayName:'Arizona', homeName:'Atlanta' };

/* ---- the name parser -------------------------------------------------- */
ok(typeof C.batterOut === 'function', 'the baseball name parser exists');
const names = [
  ['Winn struck out swinging.', 'Winn'],
  ['Wetherholt struck out looking.', 'Wetherholt'],
  ['De La Cruz struck out swinging.', 'De La Cruz'],
  ['Someone makes a 3-pt jumper.', ''],                       // basketball prose
  ['A very long sentence indeed that rambles on and on struck out', '']
];
const nbad = names.filter(([t, w]) => C.batterOut({ text: t }) !== w);
ok(nbad.length === 0, 'it reads the batter and refuses prose',
   nbad.map(([t]) => JSON.stringify(t) + ' -> ' + JSON.stringify(C.batterOut({ text: t }))).join(' · '));

/* ---- the truth, straight from the fixture ----------------------------- */
const ks = (j.plays || []).filter(p => /struck out/i.test(String((p && p.text) || '')));
const secondName = C.batterOut(ks[1]);
console.log('  strikeouts in the fixture: ' + ks.length +
            '   first two: ' + C.batterOut(ks[0]) + ', ' + secondName);
ok(ks.length >= 4, 'the fixture has enough strikeouts to clear the lag buffer', ks.length + ' found');

/* ---- the question, across several rotations --------------------------- */
const seen = [];
for (const per of [3, 4, 5, 6, 7, 8, 9]) {
  const q = C.buildBaseball('baseball', j.plays || [], T, per, { 1: 2 });
  if (!q || q.kind !== 'ordStrikeout') continue;
  seen.push(q);
  const correct = (q.options.find(o => o.v === q.ans) || {}).k;
  ok(correct === secondName, 'period ' + per + ' · the answer IS the second strikeout',
     'said ' + correct + ', the fixture says ' + secondName);
  ok(q.options.length === 3, 'period ' + per + ' · three options', String(q.options.length));
  const ksNames = new Set(ks.map(p => C.batterOut(p)).filter(Boolean));
  ok(q.options.every(o => ksNames.has(o.k)), 'period ' + per + ' · every option is a real batter from this game',
     JSON.stringify(q.options.map(o => o.k)));
  ok(new Set(q.options.map(o => o.k)).size === 3, 'period ' + per + ' · no option is repeated',
     JSON.stringify(q.options.map(o => o.k)));
}
ok(seen.length >= 3, 'the question is produced at all', 'only ' + seen.length + ' built');

/* ---- THE ANSWER MOVES ------------------------------------------------
   Several questions in this file put the correct option first every time,
   which teaches a player that tapping the top one pays. */
const slots = new Set(seen.map(q => q.options.findIndex(o => o.v === q.ans)));
console.log('  answer positions used: ' + JSON.stringify([...slots].sort()));
ok(slots.size > 1, 'the correct answer is not always in the same position',
   'every question put it at index ' + [...slots][0] + ' — a free point wearing three options');

/* ---- THE LAG BUFFER --------------------------------------------------- */
{
  /* Only three strikeouts in the whole game: the second one is nearly the
     latest thing that happened, so a delayed viewer may not have seen it.
     The question must refuse rather than ask. */
  const thin = (j.plays || []).filter(p => !/struck out/i.test(String((p && p.text) || '')))
    .concat(ks.slice(0, 3));
  let asked = 0;
  for (const per of [3, 5, 7, 9]) {
    const q = C.buildBaseball('baseball', thin, T, per, { 1: 2 });
    if (q && q.kind === 'ordStrikeout') asked++;
  }
  ok(asked === 0, 'with only three strikeouts it refuses to ask',
     'asked ' + asked + ' time(s) — without the buffer this is "the last strikeout" with a fancier name');
}

/* ---- and the delay-sensitive question it replaced is gone ------------- */
const shared = src.slice(src.indexOf(S), src.indexOf(E));
ok(!/Who is at the plate right now/.test(shared),
   'the half-inning "right now" question is gone from the host bank',
   'it flips its answer at every half-inning boundary and punishes a delayed viewer');
ok(/ordStrikeout/.test(shared), 'and the ordinal question is in the host bank');

console.log('');
if (bad.length) { console.log('FAILURES:'); bad.forEach(b => console.log('  ✗ ' + b)); console.log(''); }
if (pass === 0) { console.log('ordinal-question: RAN NOTHING\n'); process.exit(1); }
console.log('ordinal-question: ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
