/* qa/cfb-twomin.js — a question that resolves in one league and is dead
   in another.

   THE TWO-MINUTE WARNING IS AN NFL RULE. College football does not have
   one, so the ESPN feed publishes no such play, and R.nflTwoMinuteScore
   — which anchored on that play and returned null when it was missing —
   was silent on EVERY college game ever shadow-run: 8 of 8, against 0 of
   30 in the NFL. Nothing crashed and nothing logged. The backtest said
   "silent" and silent looks like a quiet night.

   CFB rooms inherit the football bank through
   FAMILY_LEAGUE.football = 'nfl', so this shipped one guaranteed dead
   question into every college room. The 3 Sept slate is 11 of them.

   The fix keys the fallback off THE GAME, NOT THE QUARTER, and that
   distinction is the whole correctness of it — an NFL Q1 has no warning
   row either, because the rule only applies in Q2 and Q4, and there the
   right answer is a VOID. This file asserts both halves. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
const ADMIN = (function(){ const a = process.argv.slice(2), i = a.indexOf('--file');
  return (i >= 0 && a[i + 1]) ? a[i + 1] : 'admin.html'; })();

const src = fs.readFileSync(path.join(ROOT, ADMIN), 'utf8');
const S = '/* @host-shared:start', E = '/* @host-shared:end */';
const ctx = vm.createContext({ console, fetch: () => { throw new Error('no net'); } });
vm.runInContext(src.slice(src.indexOf(S), src.indexOf(E) + E.length), ctx, { filename: 'hs' });
const R = ctx.AUTO.R;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); }
                       else { fail++; console.log('  FAIL ' + m); } };

const fx = (f) => {
  const p = path.join(ROOT, 'references', 'multisport', f);
  if (!fs.existsSync(p)) {
    console.log(`NO FIXTURE ${f} — run: node references/multisport/fetch.js`);
    console.log('  (reporting this as a FAILURE — a check that cannot run has not passed)');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};

const cfb = fx('cfb.json'), nfl = fx('nfl.json');
const sides = (j) => {
  const cs = j.header.competitions[0].competitors;
  const h = cs.find((c) => c.homeAway === 'home'), a = cs.find((c) => c.homeAway === 'away');
  return { home: h.team.displayName, away: a.team.displayName };
};
const opts = (j) => { const s = sides(j);
  return [s.home, s.away, 'Both of them', 'Nobody scored']; };
const playsIn = (j, p) => {
  let out = []; ((j.drives && j.drives.previous) || []).forEach((d) => (d.plays || []).forEach((x) => out.push(x)));
  return out.filter((x) => Number((x.period || {}).number) === Number(p));
};
const warnRows = (j, p) => playsIn(j, p).filter((x) => /two-minute warning/i.test(((x.type || {}).text) || '')).length;

console.log('--- the premise: the feeds really do differ ---');
ok(warnRows(cfb, 2) === 0, 'CFB Q2 has no two-minute-warning row (the rule does not exist)');
ok(warnRows(nfl, 2) > 0,  'NFL Q2 does have one');
ok(warnRows(nfl, 1) === 0, 'NFL Q1 has none either — the rule only applies in Q2 and Q4');

console.log('--- college football must ANSWER ---');
{
  const a = R.nflTwoMinuteScore(cfb, 2, opts(cfb));
  ok(a !== null && a !== undefined,
     `CFB Q2 resolves instead of going silent — got "${a}"`);
  /* Independently recomputed: the only scoring play inside the final 2:00
     of Q2 was a USC touchdown at 0:30. Not read back from the resolver. */
  ok(a === sides(cfb).home,
     `CFB Q2 names the side that actually scored late (${sides(cfb).home})`);
}

console.log('--- the NFL must be untouched, including its voids ---');
{
  const q2 = R.nflTwoMinuteScore(nfl, 2, opts(nfl));
  ok(q2 !== null, `NFL Q2 still resolves through the warning row — got "${q2}"`);
  for (const p of [1, 3]) {
    const v = R.nflTwoMinuteScore(nfl, p, opts(nfl));
    ok(v === null,
       `NFL Q${p} is still a VOID — a quarter with no warning is not "nobody scored"`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
