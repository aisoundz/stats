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
/* DEFAULT TO THE FIXTURES IN THE REPO, AND SAY SO WHEN THEY ARE MISSING.
   This used to be `|| ''` followed by a silent `process.exit(0)`, so for
   the whole life of this file it printed "no fixtures dir — skipping" and
   returned SUCCESS. Every gate run counted it as a pass. The suite that
   checks 84 resolvers and every overtime path had never once executed, and
   nothing anywhere said so out loud — the exit code said the opposite.
   Now: the repo's own fixtures are the default, and their absence is a
   FAILURE, because "I could not check" and "I checked and it is fine" are
   not the same sentence. */
const DEFAULT_FIX = path.join(ROOT, 'references', 'multisport');
/* argv MINUS the --file pair. Without this, passing `--file admin-test.html`
   makes argv[2] the literal string "--file" and the fixtures directory below
   resolves to nonsense — the suite then fails for a reason that has nothing
   to do with the banks. Caught by a negative control, not by reading. */
const ADMIN_ARGV = (function(){ const a = process.argv.slice(2), i = a.indexOf('--file');
  if(i >= 0) a.splice(i, a[i + 1] ? 2 : 1); return a; })();
const DIR = ADMIN_ARGV[0] || process.env.SPORT_FIXTURES || DEFAULT_FIX;
/* EVERY FIXTURE, NOT JUST THE FOLDER. Requiring only the directory was
   half a fix: deleting nfl.json alone took qa/host-resolvers.js from 65
   checks to 27 and it still printed a green verdict, because each league
   block quietly prints "absent — skipped" and moves on. A fixture set that
   can lose a file and stay green is the same disease as a suite that can
   lose its whole directory and stay green — just quieter. */
const NEED = ['wnba.json','nba.json','mlb.json','nfl.json','nhl.json','mls.json'];
if (!fs.existsSync(DIR)) {
  console.log('NO FIXTURES at ' + DIR);
  console.log('  run:  node references/multisport/fetch.js');
  console.log('  (reporting this as a FAILURE — a check that cannot run has not passed)');
  process.exit(1);
}
{
  const missing = NEED.filter(f => !fs.existsSync(path.join(DIR, f)));
  if (missing.length) {
    console.log('INCOMPLETE FIXTURES at ' + DIR);
    missing.forEach(f => console.log('  missing: ' + f + '   (its checks would be skipped, not failed)'));
    console.log('  run:  node references/multisport/fetch.js');
    process.exit(1);
  }
}

/* WHICH BUILD THIS GRADES. Defaults to admin.html — what host/run.js
   actually reads — so running this suite by hand is unchanged. qa/all.js
   passes `--file admin-test.html` during a gate, so the gate grades what is
   about to ship instead of what already shipped. Same flag and shape as
   host-block.js, which already did this correctly.

   Before this, SIX admin suites hardcoded admin.html, so the full gate
   silently graded the OLD banks: a bank change could pass a green gate
   having never once been read by it. Found 25 Aug when a promoted bank
   change had to be verified by hand. Named flag, not positional, because
   argv[2] is already the fixtures directory here. */
const ADMIN_FILE = (function(){ const a = process.argv.slice(2), i = a.indexOf('--file');
  return (i >= 0 && a[i + 1]) ? a[i + 1] : 'admin.html'; })();
const src = fs.readFileSync(path.join(ROOT, ADMIN_FILE), 'utf8');
const S = '/* @host-shared:start', E = '/* @host-shared:end */';
const ctx = vm.createContext({ console, fetch: () => { throw new Error('no net'); } });
vm.runInContext(src.slice(src.indexOf(S), src.indexOf(E) + E.length), ctx, { filename: 'hs' });
const AUTO = ctx.AUTO, R = AUTO.R;

const load = f => { const p = path.join(DIR, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const sidesOf = j => {
  const cs = j.header.competitions[0].competitors;
  const h = cs.find(c => c.homeAway === 'home'), a = cs.find(c => c.homeAway === 'away');
  /* THE IDS, NOT JUST THE NAMES. Any check that recomputes "which side did
     this" has to start from the team id on the play row — the names are
     what the ANSWER looks like, and mapping one to the other is the step
     where a check quietly stops being independent. */
  return { home: h.team.displayName, away: a.team.displayName,
           homeId: String(h.team.id), awayId: String(a.team.id) };
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

      /* ---- the 21 Aug bank: twelve new resolvers ---------------------
         EVERY EXPECTATION HERE IS RECOMPUTED FROM THE RAW FEED IN THIS
         FILE. That is the whole point of the suite — asking a resolver
         whether it agrees with itself proves nothing — and it matters more
         for this batch than for the drive-result ones, because these read
         down, distance, clock and yardage rather than one clean enum. */
      const GAIN = /^(Rush|Pass Reception|Rushing Touchdown|Passing Touchdown)$/;
      const ty   = x => String(((x.type) || {}).text || '');
      const off  = x => { try { return String(x.start.team.id); } catch (_) { return null; } };
      const nameOf = id => (id === String(s.homeId) ? s.home : s.away);
      /* Spelled out again rather than imported, deliberately: if the
         conversion rule in admin.html is edited, this line is what
         disagrees with it. */
      const conv = x => !!x.scoringPlay ||
        (Number(((x.end) || {}).down) === 1 &&
         String((((x.end) || {}).team || {}).id) === String((((x.start) || {}).team || {}).id));
      const gains = p => pIn(p).filter(x => GAIN.test(ty(x))).map(x => Number(x.statYardage)).filter(n => isFinite(n));
      const secs = x => { const d = String((((x.clock) || {}).displayValue) || '').trim();
        const m = d.match(/^(\d+):(\d+)/); if (m) return +m[1] * 60 + +m[2];
        return /^\d+(\.\d+)?$/.test(d) ? Math.round(+d) : null; };

      const Oq = {
        punt:  [s.home, s.away, 'Nobody punted'],
        gain:  ['19 yards or fewer', '20 to 29', '30 to 44', '45 or more'],
        three: ['None', 'One', 'Two', 'Three or more'],
        expl:  ['None', 'One', 'Two', 'Three or more'],
        td:    ['On the ground', 'Through the air', 'Some other way', 'No touchdown here'],
        twomin:[s.home, s.away, 'Both of them', 'Nobody scored'],
        endpl: ['A kick', 'A kneel-down', 'A pass play', 'A run'],
        rz:    ['A touchdown', 'A field goal', 'They came away empty', 'Nobody got that close'],
        sack:  [s.home, s.away, 'Nobody got sacked'],
        third: ['One or fewer', 'Two', 'Three', 'Four or more'],
        yn:    ['Yes', 'No'],
        fourth:['Nobody went for it', 'Went for it and got it', 'Went for it and came up short', 'Both happened'],
        turn:  [s.home, s.away, 'Neither side turned it over'],
        tos:   ['One or fewer', 'Two or three', 'Four or five', 'Six or more']
      };

      const firstPunt = pIn(p).find(x => ty(x) === 'Punt');
      run(`nfl p${p} 1stPunt`, R.nflFirstPuntTeam, j, p, Oq.punt,
          firstPunt ? nameOf(off(firstPunt)) : 'Nobody punted');

      run(`nfl p${p} longGain`, R.nflLongestGainBand, j, p, Oq.gain,
          gains(p).length ? bandOf(Math.max(...gains(p)), [19, 29, 44], Oq.gain) : undefined);

      run(`nfl p${p} 3andOut`, R.nflThreeAndOutsBand, j, p, Oq.three,
          bandOf(dIn(p).filter(d => Number(d.offensivePlays) <= 3 && /punt/i.test(d.displayResult || '')).length, [0, 1, 2], Oq.three));

      run(`nfl p${p} explosive`, R.nflExplosivePlaysBand, j, p, Oq.expl,
          bandOf(pIn(p).filter(x => GAIN.test(ty(x)) && Number(x.statYardage) >= 20).length, [0, 1, 2], Oq.expl));

      const firstTd = pIn(p).find(x => x.scoringPlay && /touchdown/i.test(String((((x.scoringType) || {}).name) || ty(x))));
      run(`nfl p${p} 1stTD`, R.nflFirstTdKind, j, p, Oq.td,
          !firstTd ? 'No touchdown here'
                   : (ty(firstTd) === 'Rushing Touchdown' ? 'On the ground'
                   : (ty(firstTd) === 'Passing Touchdown' ? 'Through the air' : 'Some other way')));

      /* Only the 2nd and 4th quarters have a two-minute warning at all;
         in the 1st and 3rd this must be SILENT, and undefined truth is how
         that is expressed without excusing silence anywhere else. */
      const wi = pIn(p).findIndex(x => /two-minute warning/i.test(ty(x)));
      let twoWant;
      if (wi >= 0) {
        const after = pIn(p).slice(wi + 1).filter(x => x.scoringPlay);
        const who = [...new Set(after.map(off).filter(Boolean))];
        twoWant = !after.length ? 'Nobody scored' : (who.length > 1 ? 'Both of them' : nameOf(who[0]));
      }
      run(`nfl p${p} 2minScore`, R.nflTwoMinuteScore, j, p, Oq.twomin, twoWant);
      must(wi >= 0 || (p !== 2 && p !== 4), `nfl p${p}: no two-minute warning row in a quarter that must have one`);

      run(`nfl p${p} lastPlay`, R.nflHalfEndPlay, j, p, Oq.endpl);

      /* RUN-ONLY WAS NOT ENOUGH HERE, AND IT COST A WRONG ANSWER.
         nflRedZoneFirstTrip offers "They came away empty" and "Nobody got
         that close" — opposite facts — and for its first hour the
         no-trip branch matched the wrong one, so quarter 3 of this
         fixture, in which no team snapped the ball inside the twenty,
         answered "they came away empty". A legality check cannot see that:
         both strings are legal options. Only a value recomputed here can.
         So the trip is rebuilt from the raw drives below. */
      let rzWant = 'Nobody got that close';
      outer: for (const d of drives) {
        for (const x of (d.plays || [])) {
          if (Number((x.period || {}).number) !== p) continue;
          if (/^(Timeout|Official Timeout|Two-minute warning|End )/.test(ty(x))) continue;
          const e = x.end || {}, y = Number(e.yardsToEndzone);
          if (!isFinite(y) || y > 20) continue;
          if (String((e.team || {}).id) !== String((d.team || {}).id)) continue;
          const r = String(d.displayResult || '');
          rzWant = r === 'Touchdown' ? 'A touchdown' : (r === 'Field Goal' ? 'A field goal' : 'They came away empty');
          break outer;
        }
      }
      run(`nfl p${p} redZone`, R.nflRedZoneFirstTrip, j, p, Oq.rz, rzWant);

      const firstSack = pIn(p).find(x => /\bsacked\b/i.test(String(x.text || '')));
      run(`nfl p${p} 1stSack`, R.nflFirstSackTeam, j, p, Oq.sack,
          firstSack ? nameOf(off(firstSack)) : 'Nobody got sacked');

      const thirds = pIn(p).filter(x => { try { return Number(x.start.down) === 3 && ty(x) !== 'Penalty' && !/^(Timeout|Official Timeout|Two-minute warning|End )/.test(ty(x)); } catch (_) { return false; } });
      run(`nfl p${p} 3rdConv`, R.nflThirdDownConvBand, j, p, Oq.third,
          thirds.length ? bandOf(thirds.filter(conv).length, [1, 2, 3], Oq.third) : undefined);

      run(`nfl p${p} halfOpen`, R.nflHalfOpenScored, j, p, Oq.yn,
          dIn(p).length ? (dIn(p)[0].isScore ? 'Yes' : 'No') : undefined);

      const goFor = pIn(p).filter(x => {
        try { if (Number(x.start.down) !== 4) return false; } catch (_) { return false; }
        const t = ty(x);
        /* END PERIOD ROWS CARRY A DOWN. The quarter-boundary marker
           inherits start.down 4 from the punt that is about to be snapped
           in the next quarter, so leaving it in counts a clock event as a
           failed fourth-down gamble — which is exactly what this check did
           on its first run against quarter 3 of the fixture. */
        if (/^(Punt|Field Goal|Blocked Field Goal|Kickoff|Penalty|Timeout|Official Timeout|Two-minute warning|End )/.test(t)) return false;
        return !/kneel/i.test(String(x.text || ''));
      });
      const made = goFor.filter(conv).length;
      run(`nfl p${p} 4thDown`, R.nflFourthDownOutcome, j, p, Oq.fourth,
          !goFor.length ? 'Nobody went for it'
            : (made && made < goFor.length ? 'Both happened'
            : (made ? 'Went for it and got it' : 'Went for it and came up short')));

      const firstTO = pIn(p).find(x => x.isTurnover);
      run(`nfl p${p} 1stTO`, R.nflFirstTurnoverTeam, j, p, Oq.turn,
          firstTO ? nameOf(off(firstTO)) : 'Neither side turned it over');

      run(`nfl p${p} timeouts`, R.nflTimeoutsBand, j, p, Oq.tos,
          bandOf(pIn(p).filter(x => ty(x) === 'Timeout').length, [1, 3, 5], Oq.tos));

      const late = pIn(p).filter(x => { const c = secs(x); return c !== null && c <= 120; });
      run(`nfl p${p} lateScore`, R.nflLateScore, j, p, Oq.yn,
          late.length ? (late.some(x => x.scoringPlay) ? 'Yes' : 'No') : undefined);
    }
    run('nfl 1stDowns', R.nflMoreFirstDowns, j, 4, [s.away, s.home, 'Tied']);
    run('nfl yards',    R.nflMoreTotalYards, j, 4, [s.away, s.home, 'Tied']);
    /* BLIND: strip the header shortcut so only the football gate can answer.
       Without this, sabotaging FAMILY.football.done to the basketball gate
       left every check green — the header was doing all the work. */
    const nb = JSON.parse(JSON.stringify(j));
    try { delete nb.header.competitions[0].status; } catch (_) {}
    must(AUTO.periodDone(nb, 1) === true, 'nfl blind: quarter 1 did not read done off its End Period row');
    /* Quarter 4 of an OVERTIME game ends with "End of Regulation", not
       "End of Game" — the game ends later, in overtime. Naming the wrong
       row here is what let the type list stay incomplete. */
    must(AUTO.periodDone(nb, 4) === true, 'nfl blind: quarter 4 did not read done off its End of Regulation row');
    /* RESTORED to the original single-signal sabotage. It was briefly
       widened to also strip every later period, because a "a period with
       plays after it is over" clause had been added to nflPeriodDone and
       made this check unfalsifiable. That clause was the wrong fix — it
       could mark every earlier period done off one mistagged row, and in
       run.js the done gate OPENS a round, so a stray row would have opened
       and graded a quarter early. The real bug was a missing token in the
       type list ("End of Regulation"), and with that fixed the row is once
       again the only signal, so removing it must once again say false. */
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
