#!/usr/bin/env node
/* =====================================================================
   Shadow test: run every resolver against a real finished game and check
   the ones that can be checked against a value computed HERE.
   ---------------------------------------------------------------------
   A resolver checked against itself proves nothing, so every expectation
   below is recomputed from the raw feed in this file rather than by asking
   the resolver what it thinks. Anything that cannot be recomputed cheaply is
   only required to RUN and return a legal option — never to be silently
   trusted.

       node qa/host-resolvers.js /path/to/fixtures

   Fixtures wanted (any subset; missing ones are skipped, not failed):
     wnba.json  nba.json  mlb.json  nfl.json  nhl.json  mls.json
   ================================================================== */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DIR = process.argv[2] || process.env.SPORT_FIXTURES || '';
if (!DIR || !fs.existsSync(DIR)) { console.log('no fixtures dir — skipping.'); process.exit(0); }

const src = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
const S = '/* @host-shared:start', E = '/* @host-shared:end */';
const ctx = vm.createContext({ console, fetch: () => { throw new Error('no net'); } });
vm.runInContext(src.slice(src.indexOf(S), src.indexOf(E) + E.length), ctx, { filename: 'hs' });
const AUTO = ctx.AUTO, R = AUTO.R;

const load = f => { const p = path.join(DIR, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const sidesOf = j => {
  const cs = j.header.competitions[0].competitors;
  return { home: cs.find(c => c.homeAway === 'home').team.displayName,
           away: cs.find(c => c.homeAway === 'away').team.displayName };
};
const bandOf = (n, cuts, opts) => { for (let i = 0; i < cuts.length; i++) if (n <= cuts[i]) return opts[i]; return opts[opts.length - 1]; };

let AGREE = 0, DIS = 0, RAN = 0, SILENT = 0, THREW = 0, ILLEGAL = 0, FAIL = 0;
const problems = [];
/* THE FIRST VERSION OF THIS FILE COULD NOT FAIL on any structural claim.
   Every one of them pushed to `problems`, which was printed and then ignored
   by an exit code computed from DIS+ILLEGAL+THREW only. Sabotaging the NFL
   gate, the hockey plays accessor and nhlPeriodDone all left the run GREEN.
   A printed complaint is not a failing test. must() is the fix. */
function must(cond, msg){ if(!cond){ FAIL++; problems.push('ASSERT: ' + msg); } }
function run(tag, fn, j, p, opts, want) {
  if (typeof fn !== 'function') { problems.push(`${tag}: NO SUCH RESOLVER`); ILLEGAL++; return; }
  let v, err = null;
  try { v = fn(j, p, opts); } catch (e) { err = e.message; }
  if (err) { THREW++; problems.push(`${tag}: THREW ${err}`); return; }
  if (v === null || v === undefined) {
    SILENT++;
    /* Silence is legitimate when nothing was expected. It is NOT legitimate
       when this file computed a real answer from the same feed — that means
       the resolver went blind to data that is demonstrably there. */
    if (want !== undefined) { FAIL++; problems.push(`${tag}: SILENT but truth is "${want}"`); }
    return;
  }
  if (opts.indexOf(v) < 0) { ILLEGAL++; problems.push(`${tag}: ILLEGAL "${v}" not in options`); return; }
  RAN++;
  if (want !== undefined) { if (v === want) AGREE++; else { DIS++; problems.push(`${tag}: got "${v}" want "${want}"`); } }
}

/* ---------------------------- NFL ---------------------------------- */
{
  const j = load('nfl.json');
  if (!j) console.log('nfl.json absent — skipped');
  else {
    const s = sidesOf(j);
    const drives = (j.drives || {}).previous || [];
    const plays = drives.flatMap(d => d.plays || []);
    console.log(`\nNFL  ${s.away} @ ${s.home}  drives=${drives.length} nestedPlays=${plays.length}`);
    /* THE STRUCTURAL ASSERTION, and it is the one that matters most for
       football: there is no top-level plays array. If a future feed change
       adds one, the flatten path stops being exercised and nobody notices. */
    must((j.plays || []).length === 0, 'NFL fixture HAS a top-level plays array — nflPlays() flatten is no longer the only path');
    must(AUTO.feedPlays(j).length === plays.length, `feedPlays() returned ${AUTO.feedPlays(j).length} for football, expected the ${plays.length} nested in drives`);
    const dIn = p => drives.filter(d => { try { return d.start.period.number === p; } catch (_) { return false; } });
    const pIn = p => plays.filter(x => (x.period || {}).number === p);
    for (const p of [1, 2, 3, 4]) {
      const O = { td: ['None', '1', '2', '3 or more'], punt: ['0-1', '2', '3', '4 or more'],
                  to: ['None', '1', '2', '3 or more'], pen: ['0-1', '2-3', '4-5', '6 or more'],
                  lead: [s.away, s.home, 'Tied'], rp: ['Rush', 'Pass', 'Tied'],
                  sc: ['None', '1', '2', '3 or more'] };
      run(`nfl p${p} TDs`,   R.nflTouchdownsBand,    j, p, O.td,   bandOf(dIn(p).filter(d => /touchdown/i.test(d.displayResult || '')).length, [0,1,2], O.td));
      run(`nfl p${p} punts`, R.nflPuntsBand,         j, p, O.punt, bandOf(dIn(p).filter(d => /punt/i.test(d.displayResult || '')).length, [1,2,3], O.punt));
      run(`nfl p${p} TO`,    R.nflTurnoversBand,     j, p, O.to,   bandOf(pIn(p).filter(x => x.isTurnover).length, [0,1,2], O.to));
      run(`nfl p${p} pen`,   R.nflPenaltiesBand,     j, p, O.pen,  bandOf(pIn(p).filter(x => x.isPenalty).length, [1,3,5], O.pen));
      run(`nfl p${p} scDr`,  R.nflScoringDrivesBand, j, p, O.sc,   bandOf(dIn(p).filter(d => d.isScore).length, [0,1,2], O.sc));
      const rush = pIn(p).filter(x => /^rush/i.test((x.type || {}).text || '')).length;
      const pass = pIn(p).filter(x => /^pass/i.test((x.type || {}).text || '')).length;
      run(`nfl p${p} rush/pass`, R.nflMoreRushOrPass, j, p, O.rp, rush > pass ? 'Rush' : (pass > rush ? 'Pass' : 'Tied'));
      const last = plays.filter(x => (x.period || {}).number <= p).slice(-1)[0];
      const want = last ? (last.homeScore > last.awayScore ? s.home : (last.awayScore > last.homeScore ? s.away : 'Tied')) : undefined;
      run(`nfl p${p} lead`, R.nflLeadAfter, j, p, O.lead, want);
      run(`nfl p${p} 1stDrive`, R.nflFirstDriveResult, j, p, ['Touchdown','Field goal','Punt','Turnover','Downs','Missed FG']);
      run(`nfl p${p} longDrive`, R.nflLongestDriveBand, j, p, ['0-20','21-45','46-70','71 or more']);
    }
    run('nfl 1stDowns', R.nflMoreFirstDowns, j, 4, [s.away, s.home, 'Tied']);
    run('nfl yards',    R.nflMoreTotalYards, j, 4, [s.away, s.home, 'Tied']);
    /* BLIND: strip the header shortcut so only the football gate can answer.
       Without this, sabotaging FAMILY.football.done to the basketball gate
       left every check green — the header was doing all the work. */
    const nb = JSON.parse(JSON.stringify(j));
    try { delete nb.header.competitions[0].status; } catch (_) {}
    must(AUTO.periodDone(nb, 1) === true, 'nfl blind: quarter 1 did not read done off its End Period row');
    must(AUTO.periodDone(nb, 4) === true, 'nfl blind: quarter 4 did not read done off End of Game');
    const nbMid = JSON.parse(JSON.stringify(nb));
    nbMid.drives.previous = nbMid.drives.previous.map(d => Object.assign({}, d, {
      plays: (d.plays || []).filter(x => !((x.period || {}).number === 1 && /^End Period$/.test((x.type || {}).text || '')))
    }));
    must(AUTO.periodDone(nbMid, 1) === false, 'nfl blind: quarter 1 still read done with its End Period row removed — the gate is not reading it');
    must(AUTO.sportOf(j) === 'football', `nfl: sportOf said "${AUTO.sportOf(j)}"`);
    console.log(`  periodDone 1..5: ${[1,2,3,4,5].map(p => AUTO.periodDone(j, p)).join(' ')}   sportOf="${AUTO.sportOf(j)}"`);
    console.log(`  feedPlays() sees ${AUTO.feedPlays ? AUTO.feedPlays(j).length : 'n/a'} plays (plays() sees ${(j.plays||[]).length})`);
  }
}

/* ---------------------------- NHL ---------------------------------- */
{
  const j = load('nhl.json');
  if (!j) console.log('nhl.json absent — skipped');
  else {
    const s = sidesOf(j), P = j.plays || [];
    console.log(`\nNHL  ${s.away} @ ${s.home}  plays=${P.length}`);
    const nIn = p => P.filter(x => (x.period || {}).number === p);
    const cnt = (p, t) => nIn(p).filter(x => ((x.type || {}).text || '') === t).length;
    for (const p of [1, 2, 3]) {
      const O = { g: ['None','1','2','3 or more'], sh: ['0-8','9-12','13-16','17 or more'],
                  hit: ['0-12','13-20','21-28','29 or more'], bl: ['0-4','5-8','9-12','13 or more'],
                  gv: ['0-4','5-8','9-12','13 or more'], team: [s.away, s.home, 'Scoreless'],
                  lead: [s.away, s.home, 'Tied'] };
      run(`nhl p${p} goals`, R.nhlGoalsBand,     j, p, O.g,   bandOf(cnt(p,'Goal'), [0,1,2], O.g));
      run(`nhl p${p} shots`, R.nhlShotsBand,     j, p, O.sh,  bandOf(cnt(p,'Shot'), [8,12,16], O.sh));
      run(`nhl p${p} hits`,  R.nhlHitsBand,      j, p, O.hit, bandOf(cnt(p,'Hit'), [12,20,28], O.hit));
      run(`nhl p${p} block`, R.nhlBlockedBand,   j, p, O.bl,  bandOf(cnt(p,'Blocked'), [4,8,12], O.bl));
      run(`nhl p${p} give`,  R.nhlGiveawaysBand, j, p, O.gv,  bandOf(cnt(p,'Giveaway'), [4,8,12], O.gv));
      const g1 = nIn(p).find(x => ((x.type || {}).text || '') === 'Goal');
      const homeId = String(j.header.competitions[0].competitors.find(c => c.homeAway === 'home').team.id);
      run(`nhl p${p} 1stGoal`, R.nhlFirstGoalTeam, j, p, O.team,
        g1 ? (String((g1.team || {}).id) === homeId ? s.home : s.away) : 'Scoreless');
      const last = P.filter(x => (x.period || {}).number <= p).slice(-1)[0];
      run(`nhl p${p} lead`, R.nhlLeadAfter, j, p, O.lead,
        last ? (last.homeScore > last.awayScore ? s.home : (last.awayScore > last.homeScore ? s.away : 'Tied')) : undefined);
      run(`nhl p${p} strength`, R.nhlFirstGoalStrength, j, p, ['Even strength','Power play','Short-handed']);
    }
    run('nhl moreShots', R.nhlMoreShots,    j, 3, [s.away, s.home, 'Tied']);
    run('nhl moreHits',  R.nhlMoreHits,     j, 3, [s.away, s.home, 'Tied']);
    run('nhl faceoffs',  R.nhlMoreFaceoffs, j, 3, [s.away, s.home, 'Tied']);
    run('nhl penalties', R.nhlPenaltiesBand, j, 3, ['0-2','3-4','5-7','8 or more']);
    /* OVERTIME IS THE POINT OF A SEPARATE HOCKEY GATE. "End of OT" carries no
       digit, so basketball's regex cannot see it. Period 4 must read done. */
    const otRow = P.some(x => /End of OT/i.test(String(x.text || '')));
    if (otRow) {
      const blind = JSON.parse(JSON.stringify(j));
      try { delete blind.header.competitions[0].status; } catch (_) {}
      const okOT = AUTO.periodDone(blind, 4) === true;
      const bballBlind = AUTO.bballPeriodDone(blind, 4) === false;
      must(okOT, 'nhl OT: period 4 did not read done off the "End of OT" row');
      must(bballBlind, 'nhl OT: the basketball gate also matched — the case is not discriminating');
      console.log(`  OT row present: hockey gate says ${okOT ? 'done' : 'NOT done'}, basketball gate says ${AUTO.bballPeriodDone(blind,4)}`);
    }
    const hb = JSON.parse(JSON.stringify(j));
    try { delete hb.header.competitions[0].status; } catch (_) {}
    must(AUTO.periodDone(hb, 1) === true, 'nhl blind: period 1 did not read done off its Period End row');
    const hbMid = JSON.parse(JSON.stringify(hb));
    hbMid.plays = hb.plays.filter(x => !((x.period || {}).number === 1 && /^Period End$/.test((x.type || {}).text || '')));
    must(AUTO.periodDone(hbMid, 1) === false, 'nhl blind: period 1 still read done with its Period End row removed');
    must(AUTO.sportOf(j) === 'hockey', `nhl: sportOf said "${AUTO.sportOf(j)}"`);
    console.log(`  periodDone 1..4: ${[1,2,3,4].map(p => AUTO.periodDone(j, p)).join(' ')}   sportOf="${AUTO.sportOf(j)}"`);
  }
}

/* -------------------- NBA reuses basketball ------------------------- */
{
  const j = load('nba.json');
  if (!j) console.log('\nnba.json absent — skipped');
  else {
    const bb = Object.keys(R).filter(n => !/^(mlb|mls|nfl|nhl)/.test(n));
    let ran = 0, threw = 0;
    const s = sidesOf(j);
    const wide = ['Yes','No','Tied',s.away,s.home,'0-2','3-4','5-6','7 or more','Free throw','Three','Layup or dunk','Mid-range jumper'];
    for (const n of bb) for (const p of [1,2,3,4]) {
      try { const v = R[n](j, p, wide); if (v !== null && v !== undefined) ran++; }
      catch (e) { threw++; problems.push(`nba ${n} p${p} THREW ${e.message}`); }
    }
    console.log(`\nNBA  ${s.away} @ ${s.home}  — ${bb.length} basketball resolvers reused, ${ran} produced an answer, ${threw} threw`);
    console.log(`  sportOf="${AUTO.sportOf(j)}"  (must be "basketball" so it reuses the engine)`);
    must(AUTO.sportOf(j) === 'basketball', 'NBA did not read as the basketball family — it would get the wrong gate');
    must(threw === 0, `NBA: ${threw} basketball resolvers threw on an NBA feed`);
  }
}

console.log(`\n${'-'.repeat(64)}`);
console.log(`checked-against-truth: ${AGREE} agree / ${DIS} disagree`);
console.log(`ran ${RAN}   silent ${SILENT}   ILLEGAL ${ILLEGAL}   THREW ${THREW}   FAILED-ASSERTS ${FAIL}`);
if (problems.length) { console.log('\nproblems:'); problems.forEach(p => console.log('  ' + p)); }
process.exit(DIS + ILLEGAL + THREW + FAIL ? 1 : 0);
