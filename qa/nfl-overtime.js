/* ============================================================================
   qa/nfl-overtime.js — THE OVERTIME ROUND NO REAL GAME CAN TEST YET

   publish.js logged, for every NFL night: "football does not have an
   OT-tagged template yet — a game that runs past regulation simply has
   nothing more to answer, which is honest." Honest, and fine for preseason,
   which cannot go to overtime at all. NFL Week 1 is 6 September and
   regular-season games can, so the gap had a date on it.

   The round exists now. Nothing in the 2026 schedule can exercise it:
   preseason has no overtime and the regular season has not started, so
   qa/bank-shadow.js reports all three questions correctly silent across
   eight finished games and proves only that they do not crash.

   AND THE FIXTURE ALREADY HAD ONE. references/multisport/nfl.json is
   Rams 20, Bears 17 — a game that went to overtime and was decided by a
   field goal, after a punt and an interception. Three real OT drives:

       OT drive 1  Punt          (5 plays, 7 yards)
       OT drive 2  Interception  (the turnover)
       OT drive 3  Field Goal    (13 plays, 54 yards, 42-yard kick)

   So the primary check is against a real overtime with known answers, not
   an invention. Synthetic period-5 drives are used only for the band
   boundaries of the longest-gain question and for the no-overtime case,
   where there is nothing real to read.

   ONE BEHAVIOUR IS DELIBERATELY ASSERTED AS-IS, not fixed: with no period 5
   at all, nflFirstTurnoverTeam returns "neither side turned it over" rather
   than going silent — it cannot tell "no overtime happened" from "an
   overtime happened and nobody fumbled". That is safe because the OT round
   is only ever published when a game reaches overtime, and the resolver is
   shared with Q4 where "neither" is the right answer. It is asserted here
   so the day someone opens an OT round early, this file explains why the
   answer looked confident.
   ========================================================================== */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0; const bad = [];
const ok = (c, label, detail) => c ? pass++ : (fail++, bad.push(label + (detail ? '  — ' + detail : '')));

console.log('\n=== NFL OVERTIME ===\n');

const src = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const S = '/* @host-shared:start', E = '/* @host-shared:end */';
const ctx = vm.createContext({ console, fetch: () => { throw new Error('no net'); } });
vm.runInContext(src.slice(src.indexOf(S), src.indexOf(E) + E.length), ctx, { filename: 'host-shared' });
const A = ctx.AUTO;

const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/multisport/nfl.json'), 'utf8'));

/* The three questions exactly as the bank states them, so this cannot drift
   away from what is actually asked. */
const Q = {
  drive:    { r: 'nflFirstDriveResult',  o: ['Touchdown','Field goal','Punt','Turnover','Downs','Missed FG'] },
  gain:     { r: 'nflLongestGainBand',   o: ['Under 20 yards','20 to 29','30 to 44','45 or more'] },
  turnover: { r: 'nflFirstTurnoverTeam', o: ['{HOME}','{AWAY}','Neither side turned it over'] }
};

/* Team names for the {HOME}/{AWAY} tokens, from the real header. */
const comp = ((base.header || {}).competitions || [])[0] || {};
const cs = comp.competitors || [];
const home = cs.find(c => c.homeAway === 'home') || cs[0] || {};
const away = cs.find(c => c.homeAway === 'away') || cs[1] || {};
const HOME = (home.team || {}).displayName || 'Home';
const AWAY = (away.team || {}).displayName || 'Away';
const sub = (o) => o.map(x => String(x).replace('{HOME}', HOME).replace('{AWAY}', AWAY));

console.log('  fixture: ' + AWAY + ' at ' + HOME);

const otDrives = (((base.drives || {}).previous) || [])
  .filter(d => { try { return Number(d.start.period.number) === 5; } catch (_) { return false; } });
console.log('  real overtime drives in the fixture: ' + otDrives.length + '  ' +
            JSON.stringify(otDrives.map(d => d.displayResult || d.result)));
ok(otDrives.length >= 3, 'the fixture contains a real NFL overtime',
   'only ' + otDrives.length + ' period-5 drive(s) — the real-data checks below mean nothing');

const val = x => (x && x.ok) ? x.answer : null;
const ask = (feed, k) => A.resolve(Q[k].r, feed, 5, sub(Q[k].o));

/* ---- 1. THE REAL OVERTIME --------------------------------------------
   Punt, then an interception, then the winning field goal. Every answer
   below is checked against what that game actually did. */
{
  const d = ask(base, 'drive'), g = ask(base, 'gain'), t = ask(base, 'turnover');
  console.log('\n  REAL overtime:  drive=' + val(d) + '   gain=' + val(g) + '   turnover=' + val(t));

  ok(val(d) === 'Punt', 'the first overtime drive is read as a punt',
     'got ' + val(d) + ' — the fixture\'s first OT drive is a Punt');
  ok(val(g) === 'Under 20 yards', 'the longest overtime GAIN is under 20',
     'got ' + val(g) + ' — a 42-yard field goal and a 26-yard kickoff are not gains, ' +
     'and if either leaked in this would say otherwise');
  ok(/bears/i.test(String(val(t) || '')), 'the interception is attributed to the team that threw it',
     'got ' + val(t));

  /* The period filter is what makes an OT round an OT round. Q4 of this
     same game ended in a touchdown; if the two agree, period 5 is not
     being filtered and the round is asking about regulation. */
  const q4 = A.resolve('nflFirstDriveResult', base, 4, sub(Q.drive.o));
  console.log('     (Q4 of the same game: ' + val(q4) + ')');
  ok(val(q4) !== val(d), 'overtime and the fourth quarter give different answers',
     'both say ' + val(d) + ' — period 5 is not being filtered');

  [['drive', d], ['gain', g], ['turnover', t]].forEach(([k, res]) => {
    const a = val(res); if (a === null) return;
    ok(sub(Q[k].o).indexOf(a) >= 0, 'the real ' + k + ' answer is one of its own options',
       JSON.stringify(a) + ' is not in ' + JSON.stringify(sub(Q[k].o)));
  });
}

/* ---- 2. no overtime at all -------------------------------------------- */
{
  const noOT = JSON.parse(JSON.stringify(base));
  noOT.drives.previous = noOT.drives.previous.filter(d => {
    try { return Number(d.start.period.number) !== 5; } catch (_) { return true; } });
  const d = ask(noOT, 'drive'), g = ask(noOT, 'gain'), t = ask(noOT, 'turnover');
  console.log('\n  overtime stripped:  drive=' + val(d) + '  gain=' + val(g) + '  turnover=' + val(t));
  ok(val(d) === null, 'with no overtime, the drive question is silent', String(val(d)));
  ok(val(g) === null,  'with no overtime, the longest-gain question is silent', String(val(g)));
  ok(/neither/i.test(String(val(t) || '')),
     'the turnover question answers "neither" — documented, not a bug (see the header)',
     'behaviour changed: it now returns ' + val(t));
}

/* ---- 2. a real overtime, grafted -------------------------------------- */
const homeId = String((home.team || {}).id || '1');
const awayId = String((away.team || {}).id || '2');

function withOT(result, gainYards, turnoverBy) {
  /* Built on a feed with the REAL overtime removed, so the drive under test
     is the first one — the first version of this appended to the real OT and
     every case came back "Punt", which is the real game's answer and not the
     graft's. A fixture that quietly ignores what you put in it is worse than
     no fixture. */
  const feed = JSON.parse(JSON.stringify(base));
  feed.drives.previous = feed.drives.previous.filter(d => {
    try { return Number(d.start.period.number) !== 5; } catch (_) { return true; } });
  const plays = [
    { period: { number: 5 }, type: { text: 'Rush' }, statYardage: 4,
      start: { team: { id: homeId } } },
    { period: { number: 5 }, type: { text: 'Pass Reception' }, statYardage: gainYards,
      start: { team: { id: homeId } } }
  ];
  if (turnoverBy) plays.push({ period: { number: 5 }, type: { text: 'Interception Return' },
    statYardage: 0, isTurnover: true, start: { team: { id: turnoverBy } } });
  feed.drives.previous.push({
    start: { period: { number: 5 } },
    displayResult: result, result: result,
    offensivePlays: plays.length, yards: gainYards + 4,
    team: { id: homeId },
    plays
  });
  return feed;
}

const cases = [
  { name: 'OT ends in a touchdown, 31-yard gain, no turnover',
    feed: withOT('Touchdown', 31, null),
    drive: 'Touchdown', gain: '30 to 44', turn: /neither/i },
  { name: 'OT ends in a punt, 12-yard gain, no turnover',
    feed: withOT('Punt', 12, null),
    drive: 'Punt', gain: 'Under 20 yards', turn: /neither/i },
  { name: 'OT ends in a field goal, 52-yard gain, home turns it over',
    feed: withOT('Field Goal', 52, homeId),
    drive: 'Field goal', gain: '45 or more', turn: new RegExp(HOME.split(' ').pop(), 'i') },
  { name: 'OT ends on a missed field goal, 24-yard gain',
    feed: withOT('Missed Field Goal', 24, null),
    drive: 'Missed FG', gain: '20 to 29', turn: /neither/i }
];

console.log('\n  --- synthetic overtimes, for the cases the real one does not cover ---');
for (const c of cases) {
  const d = ask(c.feed, 'drive'), g = ask(c.feed, 'gain'), t = ask(c.feed, 'turnover');
  console.log('\n  ' + c.name);
  console.log('     drive=' + val(d) + '   gain=' + val(g) + '   turnover=' + val(t));

  ok(val(d) === c.drive, c.name + ' · the drive result is right',
     'got ' + val(d) + ', expected ' + c.drive);
  ok(val(g) === c.gain, c.name + ' · the longest gain lands in the right band',
     'got ' + val(g) + ', expected ' + c.gain);
  ok(c.turn.test(String(val(t) || '')), c.name + ' · the turnover answer is right',
     'got ' + val(t));

  /* Every answer must be one of the offered options — the exact failure
     bank-shadow exists to catch, checked here for the OT round it cannot
     reach. */
  [['drive', d], ['gain', g], ['turnover', t]].forEach(([k, res]) => {
    const a = (res && res.ok) ? res.answer : null;
    if (a === null) return;
    ok(sub(Q[k].o).indexOf(a) >= 0, c.name + ' · the ' + k + ' answer is one of its own options',
       JSON.stringify(a) + ' is not in ' + JSON.stringify(sub(Q[k].o)));
  });
}

/* ---- 3. the round is wired into the template, at period 5 -------------- */
{
  const ot = /tags:\s*\['Q1','Q2','Q3','Q4','OT'\]/.test(src);
  ok(ot, 'football declares an OT round in its tags');
  ok(/names:\s*\['Quarter 1','Quarter 2','Quarter 3','Quarter 4','Overtime'\]/.test(src),
     'and names it');
  ok(/worth:\s*\[10,20,30,40,40\]/.test(src), 'and gives it a worth');
  /* No `periods` list on football, so the runner's index+1 fallback must be
     what puts this round on period 5. If someone adds a periods list later
     without extending it, the OT round would silently ask about period 1. */
  const fb = src.slice(src.indexOf('football: {'), src.indexOf('football: {') + 400);
  ok(!/periods\s*:/.test(fb),
     'football still has no periods list, so OT resolves at index+1 = 5',
     'a periods list was added — it must include 5 for the OT round or it asks about the wrong period');
}

console.log('');
if (bad.length) { console.log('FAILURES:'); bad.forEach(b => console.log('  ✗ ' + b)); console.log(''); }
if (pass === 0) { console.log('nfl-overtime: RAN NOTHING\n'); process.exit(1); }
console.log('nfl-overtime: ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
