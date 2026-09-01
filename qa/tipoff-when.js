/* qa/tipoff-when.js — the day's email schedule.

   Exists because of a bug that was never a crash: on 31 Aug the tip-off
   email was pinned to 09:13 draft / 10:45 send, and 23 of the 26 Premier
   League rooms this product has hosted kicked off BEFORE that send. The
   product invited people to matches that had already finished. Nothing
   failed, nothing logged, and the only detector said "warn".

   The subtle one, and the reason this file asserts ordering: moving the
   SEND earlier without moving the DRAFT produces a send that comes due at
   05:30 and finds no draft, because the draft job does not run until
   09:13. That is the same dark morning, reached by a new route, and it
   would have looked like a fix.                                        */
const { dayPlan, hhmm } = require('../host/tipoff-when.js');

/* WRITTEN OUT AS LITERALS ON PURPOSE. These started as imports of the
   module's own constants, and the floor check was then a tautology: the
   sabotage run moved FLOOR_DRAFT_PT to 0 and the assertion moved with it,
   so zero checks went red while the guard was gone. A test that reads its
   expected value out of the thing it is testing cannot fail. */
const DEFAULT_SEND_PT = 10 * 60 + 45;   /* 10:45 — the schedule this replaced */
const FLOOR_DRAFT_PT  =  3 * 60 + 30;   /* 03:30 — the 03:00 slate build, plus margin */

let pass = 0, fail = 0;
const ok  = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); }
                        else { fail++; console.log('  FAIL ' + m); } };

/* A PT wall-clock time on a fixed date, as the feed would give it. */
const at = (pt, day) => {
  const [h, m] = pt.split(':').map(Number);
  return new Date(Date.UTC(2026, 8, day || 5, h + 7, m)).toISOString();
};
const NOON = new Date(Date.UTC(2026, 8, 5, 19, 0));

/* Every Premier League kickoff this product has actually hosted, plus the
   two CFB mornings on the schedule. These are the real shapes, not invented. */
const REAL = [
  ['EPL 4:30am   (x2)',  ['04:30']],
  ['EPL 6:00am   (x4)',  ['06:00']],
  ['EPL 7:00am  (x12)',  ['07:00']],
  ['EPL 8:30am   (x2)',  ['08:30']],
  ['EPL 9:30am   (x3)',  ['09:30']],
  ['CFB 9:00am 5+12 Sep', ['09:00']],
  ['EPL noon     (x3)',  ['12:00']],
  ['WNBA 7pm  (ordinary)', ['19:00']],
  ['mixed 7am + 7pm',    ['07:00', '19:00']],
];

console.log('--- the send must beat the first whistle ---');
for (const [label, tips] of REAL) {
  const p = dayPlan(tips.map((t) => at(t)), NOON);
  const firstTip = Math.min(...tips.map((t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; }));
  ok(p.sendPT < firstTip,
     `${label}: send ${hhmm(p.sendPT)} is before the ${hhmm(firstTip)} kickoff`);
}

console.log('--- the four jobs stay in order, or the day goes dark ---');
for (const [label, tips] of REAL) {
  const p = dayPlan(tips.map((t) => at(t)), NOON);
  ok(p.draftPT < p.checkPT && p.checkPT < p.sendPT && p.sendPT < p.verifyPT,
     `${label}: draft ${hhmm(p.draftPT)} < check ${hhmm(p.checkPT)} < send ${hhmm(p.sendPT)} < verify ${hhmm(p.verifyPT)}`);
}

console.log('--- an ordinary evening is EXACTLY what it was before 1 Sept ---');
{
  const p = dayPlan([at('19:00')], NOON);
  ok(p.sendPT === DEFAULT_SEND_PT, `ordinary night still sends at ${hhmm(DEFAULT_SEND_PT)}`);
  ok(!p.early, 'ordinary night is not flagged early');
  ok(p.draftPT === DEFAULT_SEND_PT - 22, 'draft keeps its 22-minute lead on the send');
  ok(p.checkPT === p.draftPT + 15, 'check keeps its 15-minute lead on the draft');
  ok(p.verifyPT === p.sendPT + 10, 'verify keeps its 10-minute lag on the send');
}

console.log('--- a slate the feed mangled must not decide the day gets no email ---');
for (const [label, tips] of [['empty slate', []], ['blank strings', ['', '']],
                             ['junk', ['not-a-date', 'null']],
                             ['one good, one junk', ['x', at('07:00')]]]) {
  const p = dayPlan(tips, NOON);
  ok(p.sendPT <= DEFAULT_SEND_PT && p.draftPT >= FLOOR_DRAFT_PT,
     `${label}: falls back to a sane ${hhmm(p.draftPT)} / ${hhmm(p.sendPT)}`);
}
ok(dayPlan(['x', at('07:00')], NOON).sendPT === dayPlan([at('07:00')], NOON).sendPT,
   'one unreadable row does not hide the real kickoff next to it');

console.log('--- the floor: there is no slate to write from before 03:00 ---');
for (const t of ['00:30', '03:00', '04:30']) {
  const p = dayPlan([at(t)], NOON);
  ok(p.draftPT >= FLOOR_DRAFT_PT,
     `${t} kickoff: draft ${hhmm(p.draftPT)} is not before the ${hhmm(FLOOR_DRAFT_PT)} floor`);
}

console.log('--- never later than the schedule it replaced ---');
for (const [label, tips] of REAL) {
  const p = dayPlan(tips.map((t) => at(t)), NOON);
  ok(p.sendPT <= DEFAULT_SEND_PT, `${label}: send ${hhmm(p.sendPT)} never slips past ${hhmm(DEFAULT_SEND_PT)}`);
}

console.log('--- dueness is a function of now, not of the file ---');
{
  const tips = [at('07:00')];
  const before = dayPlan(tips, new Date(Date.UTC(2026, 8, 5, 11, 0)));  /* 04:00 PT */
  const after  = dayPlan(tips, new Date(Date.UTC(2026, 8, 5, 13, 0)));  /* 06:00 PT */
  ok(!before.draftDue && !before.sendDue, '04:00 PT on a 7am day: nothing is due yet');
  ok(after.draftDue && after.sendDue, '06:00 PT on a 7am day: draft and send are both due');
  ok(!dayPlan([at('19:00')], new Date(Date.UTC(2026, 8, 5, 16, 0))).sendDue,
     '09:00 PT on an ordinary night: the send is NOT due (it was, under the old 09:35 fire)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
