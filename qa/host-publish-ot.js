#!/usr/bin/env node
/* =====================================================================
   Does the overtime template survive the trip through both publishers?
   ---------------------------------------------------------------------
   Added 17 Aug 2026. The runner can instantiate an `ot` template per
   overtime period, but only if a publisher actually writes one. There are
   TWO publishers — publishPlan() in admin.html's Control Room and
   host/publish.js — and they must agree about which round is overtime, or
   the Control Room and the script produce different plans for the same
   night. That is B2 with a different hat on, so both call one shared
   splitOtRound() and this checks the real function.

       node qa/host-publish-ot.js
   ================================================================== */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');

const src = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const S = '/* @host-shared:start', E = '/* @host-shared:end */';
const ctx = vm.createContext({ console, fetch: () => { throw new Error('no net'); } });
vm.runInContext(src.slice(src.indexOf(S), src.indexOf(E) + E.length), ctx, { filename: 'hs' });
const A = ctx.AUTO;

let fail = 0;
const ok = id => console.log(`  \x1b[32m✓\x1b[0m ${id}`);
const bad = (id, why) => { fail++; console.log(`  \x1b[31m✗ ${id}\x1b[0m — ${why}`); };
const eq = (id, got, want) => got === want ? ok(id) : bad(id, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
const same = (id, got, want) => JSON.stringify(got) === JSON.stringify(want) ? ok(id) : bad(id, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);

/* ---- which tags count as overtime ---------------------------------- */
console.log('\nwhich round is the overtime round');
for (const t of ['OT', 'ot', 'OT2', 'OT3', ' OT ', 'OT 2']) eq(`ottag.yes.${JSON.stringify(t)}`, A.isOtTag(t), true);
/* A tag that merely CONTAINS "ot" must not be swallowed — "Bot", "Shot"
   and a hockey period called "OT-ish" would each silently remove a
   regulation round from the plan, which is the worst possible failure here:
   a quarter that never opens and no error anywhere. */
for (const t of ['Q1', '1H', 'FT', '1st', 'Bot', 'Shot', 'Hot', 'OTX', '', null, undefined])
  eq(`ottag.no.${JSON.stringify(t)}`, A.isOtTag(t), false);

/* ---- the split ------------------------------------------------------ */
console.log('\nsplitting the plan');
const q = n => Array.from({ length: n }, (_, i) => ({ t: 'q' + i, o: ['a', 'b'], r: 'someResolver', k: null }));
{
  const reg4 = [
    { tag: 'Q1', name: 'Quarter 1', worth: 10, qs: q(4) },
    { tag: 'Q2', name: 'Quarter 2', worth: 20, qs: q(4) },
    { tag: 'Q3', name: 'Quarter 3', worth: 30, qs: q(4) },
    { tag: 'Q4', name: 'Quarter 4', worth: 40, qs: q(4) },
  ];
  const noOt = A.splitOtRound(reg4);
  eq('split.no-ot-round-leaves-four', noOt.rounds.length, 4);
  eq('split.no-ot-round-has-no-template', noOt.ot, null);

  const withOt = A.splitOtRound(reg4.concat([{ tag: 'OT', name: 'Overtime', worth: 50, qs: q(2) }]));
  eq('split.regulation-drops-to-four', withOt.rounds.length, 4);
  same('split.regulation-tags-intact', withOt.rounds.map(r => r.tag), ['Q1','Q2','Q3','Q4']);
  /* GUARD BEFORE DEREFERENCING. Sabotaging the split so it drops the
     overtime round without building a template made this file die on
     `withOt.ot.qs` with a TypeError: a non-zero exit, but no named failure
     and nothing telling the reader WHICH claim broke. A test that fails by
     crashing is the same sin as code that fails in silence — see the fail.*
     category in qa.js. Assert the template exists first, then read it. */
  const hasTpl = !!withOt.ot;
  eq('split.an-authored-ot-round-becomes-a-template', hasTpl, true);
  eq('split.template-carries-its-questions', hasTpl ? withOt.ot.qs.length : null, 2);
  eq('split.template-carries-its-worth', hasTpl ? withOt.ot.worth : null, 50);
  /* The template must NOT carry a tag or a name. roundTagFor() re-derives
     those per period, and a template stamped "OT" would put that label on
     the SECOND overtime too. */
  eq('split.template-has-no-tag',  hasTpl ? withOt.ot.tag  : 'MISSING', undefined);
  eq('split.template-has-no-name', hasTpl ? withOt.ot.name : 'MISSING', undefined);

  /* AN EMPTY OVERTIME ROUND IS NOT A TEMPLATE. It is also not a hard stop:
     regulation rounds will open, so an empty one blocks the publish (B28);
     an overtime round only opens if the game goes there. */
  const emptyOt = A.splitOtRound(reg4.concat([{ tag: 'OT', worth: 50, qs: [] }]));
  eq('split.empty-ot-publishes-no-template', emptyOt.ot, null);
  eq('split.empty-ot-does-not-eat-a-quarter', emptyOt.rounds.length, 4);

  /* Only the first overtime round becomes the template — a config listing
     OT and OT2 separately should not silently drop OT2's questions into
     nowhere while pretending both were published. */
  const twoOt = A.splitOtRound(reg4.concat([
    { tag: 'OT',  worth: 50, qs: q(2) },
    { tag: 'OT2', worth: 60, qs: q(3) },
  ]));
  eq('split.first-ot-wins', twoOt.ot ? twoOt.ot.qs.length : null, 2);
  eq('split.no-ot-round-survives-into-regulation', twoOt.rounds.length, 4);
}

/* ---- both publishers use the SAME function ------------------------- */
console.log('\nboth publishers, one predicate');
{
  const adminSrc = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const pubSrc = fs.readFileSync(path.join(ROOT, 'host/publish.js'), 'utf8');
  eq('publishers.control-room-calls-splitOtRound', /AUTO\.splitOtRound\(/.test(adminSrc), true);
  eq('publishers.script-calls-splitOtRound',       /AUTO\.splitOtRound\(/.test(pubSrc), true);
  /* Neither may carry its own idea of what an overtime tag looks like. */
  const ownRegex = /\/\^ot[\\s\\d*]*\$?\/i/i;
  eq('publishers.script-has-no-private-ot-regex',
    !ownRegex.test(pubSrc.replace(/isOtTag/g, '')), true);
  eq('publishers.control-room-writes-ot-onto-the-plan', /planDoc\.ot\s*=/.test(adminSrc), true);
  eq('publishers.script-writes-ot-onto-the-plan',       /planDoc\.ot\s*=/.test(pubSrc), true);
  /* And the absence has to be SAID, not skipped — the whole reason overtime
     went missing for eleven nights is that nothing mentioned it. */
  eq('publishers.control-room-warns-when-no-template', /no overtime round is configured/i.test(adminSrc), true);
  eq('publishers.script-warns-when-no-template',       /no overtime round configured/i.test(pubSrc), true);
}

/* ---- the round the runner builds from that template ---------------- */
console.log('\nthe published template reaches the runner');
{
  const { roundSlots } = require(path.join(ROOT, 'host/run.js'));
  const FX = path.join(ROOT, '..', '.claude/skills/stats-gametime/references/multisport/fixtures/wnba.json');
  if (!fs.existsSync(FX)) console.log('  – wnba fixture absent, skipped');
  else {
    const w = JSON.parse(fs.readFileSync(FX, 'utf8'));
    const reg4 = ['Q1','Q2','Q3','Q4'].map((tag, i) => ({ tag, worth: (i+1)*10, qs: q(4) }));
    const split = A.splitOtRound(reg4.concat([{ tag: 'OT', worth: 50, qs: q(2) }]));
    /* Exactly what publishPlan writes: rounds + ot. */
    const plan = { rounds: split.rounds, ot: split.ot };
    const slots = roundSlots(A, w, plan);
    eq('endtoend.gn11-gets-five-rounds', slots.length, 5);
    const d4 = slots[4] && slots[4].def;
    eq('endtoend.fifth-round-has-a-definition', !!d4, true);
    eq('endtoend.fifth-is-overtime', d4 ? d4.tag : null, 'OT');
    eq('endtoend.overtime-uses-the-authored-worth', d4 ? d4.worth : null, 50);
    eq('endtoend.overtime-uses-the-authored-questions', d4 ? d4.qs.length : null, 2);
    /* And a double overtime reuses the same authored set. */
    const ot2 = JSON.parse(JSON.stringify(w));
    ot2.header.competitions[0].status = { period: 6, type: { completed: true } };
    const six = roundSlots(A, ot2, plan);
    eq('endtoend.double-overtime-reuses-one-template', six.length, 6);
    const d5 = six[5] && six[5].def;
    eq('endtoend.second-overtime-is-OT2', d5 ? d5.tag : null, 'OT2');
    eq('endtoend.second-overtime-same-questions', d5 ? d5.qs.length : null, 2);
    /* With no template published, overtime slots still EXIST so the runner
       can flag them — they just carry nothing. A missing slot is a silent
       skip, which is the failure this whole change exists to end. */
    const bare = roundSlots(A, w, { rounds: split.rounds });
    eq('endtoend.no-template-still-shows-the-slot', bare.length, 5);
    eq('endtoend.no-template-slot-is-empty', bare[4].def, null);
  }
}

console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
