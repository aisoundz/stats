/* NIGHT DEBRIEF — the two numbers, read from the archive.
   Round completion, and how far the server's recomputed score is from the
   score actually stored on each player. Nothing here is estimated: if a
   fact is not in the archive it is reported as unknown rather than guessed. */
const admin = require('firebase-admin');
const fs = require('fs'), vm = require('vm'), path = require('path');
const NIGHT = process.env.NIGHT_ID || 'gn11-2026-08-16-ind-atl';

const creds = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(creds) });
const db = admin.firestore();

/* AUTO.tally out of admin.html — the same function the Control Room and the
   runner both use. Recomputing with a second implementation would prove
   nothing about the one that actually scored the night. */
function loadAuto() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const S = '/* @host-shared:start', E = '/* @host-shared:end */';
  const ctx = vm.createContext({ console, fetch: () => { throw new Error('no net'); } });
  vm.runInContext(src.slice(src.indexOf(S), src.indexOf(E) + E.length), ctx, { filename: 'hs' });
  return ctx.AUTO;
}

(async () => {
  const AUTO = loadAuto();
  /* The header used to read "GAME NIGHT #11" for every night this was
     ever pointed at, because it was written to debrief exactly one. A
     literal that was true once and silently rots is the same defect as
     the baked BB_GAME night and the rotted hero fixture — and "Game Night
     #N has one owner" was a whole commit on 22 Aug. The night names
     itself. */
  console.log(`\n══ ${NIGHT} ══\n`);

  // ---- the archive -------------------------------------------------
  const snaps = await db.collection(`nights/${NIGHT}/archive`).get();
  if (snaps.empty) { console.log('NO ARCHIVE for this night — cannot debrief from data.'); process.exit(1); }
  const stamps = snaps.docs.map(d => d.id).sort();
  const arc = snaps.docs.find(d => d.id === stamps[stamps.length - 1]).data();
  console.log(`archive snapshots : ${stamps.length}  (using the last, ${stamps[stamps.length - 1]})`);
  console.log(`written by        : ${arc.by || 'unknown'}   why: ${arc.why || 'unknown'}`);

  const rounds = arc.rounds || [];

  /* ============ THE ARCHIVE IS ARRAYS; tally() WANTS UID MAPS =========
     22 Aug. This file reported that Sam scored 80 and Courtside 0, when the
     only submission in the room belonged to Courtside and the game had
     already scored him 85 — correctly, on the right uid.

     run.js writes the archive as ARRAYS: players is [{uid,...}] and
     subs[roundId] is [{uid, picks, banks}]. AUTO.tally() reads both as
     objects KEYED BY UID — Object.keys(players) to build its output rows,
     and perRound[uid] to find a player's picks.

     Hand it an array and Object.keys returns "0","1","2" — the POSITIONS.
     So tally built rows keyed by index, looked up the first submission at
     index "0", found the row for the first player in the array, and
     credited them. Every submission in a round landed on whoever happened
     to be listed first. It agreed perfectly whenever everyone scored zero,
     which is most nights, which is why it went unnoticed — and it was the
     one number in this file that exists to catch scoring bugs.

     Convert once, here, and let tally see the shape it was written for. */
  const byUid = (v) => Array.isArray(v)
    ? v.reduce((m, x) => { if (x && x.uid) m[x.uid] = x; return m; }, {})
    : (v || {});
  const subsRaw = arc.subs || {};
  const subs = Object.keys(subsRaw).reduce((m, rid) => { m[rid] = byUid(subsRaw[rid]); return m; }, {});
  const players = byUid(arc.players);

  // ---- NUMBER 1: round completion ----------------------------------
  const scored = rounds.filter(r => r.state === 'scored');
  const open = rounds.filter(r => r.state && r.state !== 'scored');
  console.log(`\n─ ROUND COMPLETION ─`);
  console.log(`  rounds in the archive : ${rounds.length}`);
  rounds.forEach(r => {
    const q = (r.questions || []).length, k = (r.key || []).filter(x => x != null).length;
    console.log(`    ${String(r.tag || r.id || '?').padEnd(6)} state=${String(r.state).padEnd(8)} questions=${q} keyed=${k}` +
                (r.needsHuman ? `  needsHuman: ${r.needsHuman}` : ''));
  });
  const pct = rounds.length ? Math.round(100 * scored.length / rounds.length) : 0;
  console.log(`  → ${scored.length} of ${rounds.length} rounds scored  (${pct}%)`);
  if (open.length) console.log(`  → still open: ${open.map(r => r.tag).join(', ')}`);

  // ---- NUMBER 2: recomputed vs stored ------------------------------
  console.log(`\n─ SCORE AGREEMENT (recomputed from submissions vs stored) ─`);
  const uids = Object.keys(players);
  /* Hoisted so the machine-readable line at the end can reach it. */
  var AGREED = null;
  if (!uids.length) console.log('  no player rows in the archive');
  else {
    const tally = AUTO.tally(scored, players, subs);
    let agree = 0, diff = 0;
    AGREED = 0;
    /* ============ COMPARE THE NUMBER THE BOARD ACTUALLY SHOWS ========
       This read `players[uid].pts` and called it the stored score. It is
       not the score: SB.nightTotal() in index.html — the one function both
       the board and the rank come through — composes the total from the
       LANES, livePts + predPts + catchPts + caughtPts, and never reads
       `pts` unless livePts is missing entirely.

       `pts` is a legacy field that any writer can leave behind. On 22 Aug
       Courtside's row carried pts=85 with every lane at zero except
       livePts=80, so this file reported the server disagreeing by 5 about
       a player it had scored perfectly. The five points were a lane that
       contributed at scoring time and was later zeroed without the total
       being rewritten — drift in a field nothing authoritative reads.

       So: compose the stored side the same way the board does, and report
       a `pts` that has drifted away from its own lanes separately, because
       that IS worth knowing — it is just not a scoring disagreement.

       NOTE speed is deliberately absent from both sides. Neither
       nightTotal() nor tally() counts it toward a night total. */
    /* MIRRORS nightTotal() IN index.html, INCLUDING THE caughtSrv
       PREFERENCE. From 26 Aug the runner publishes its own graded caught
       lane as `caughtSrv`, because caughtPts is client-owned and two
       writers for one fact is what caused the bug in the first place. If
       this function did not prefer it too, every server-graded catch
       would show up here as "drift" — a debrief inventing failures is
       worse than no debrief, and this is the third copy of this sum. */
    const lanes = (v) => Number(v.livePts || 0) + Number(v.predPts || 0)
                       + Number(v.catchPts || 0)
                       + ((typeof v.caughtSrv === 'number' && isFinite(v.caughtSrv))
                            ? v.caughtSrv : Number(v.caughtPts || 0));
    const drifted = [];
    uids.forEach(uid => {
      const v = players[uid] || {};
      const stored = (v.livePts != null) ? lanes(v) : Number(v.pts || 0);
      const recomputed = Number(((tally || {})[uid] || {}).pts || 0);
      const name = v.name || uid.slice(0, 6);
      const ok = stored === recomputed;
      ok ? agree++ : diff++;
      if (ok) AGREED++;
      if (v.livePts != null && Number(v.pts || 0) !== lanes(v))
        drifted.push(`${name}: pts=${Number(v.pts || 0)} but its lanes sum to ${lanes(v)}`);
      console.log(`    ${String(name).padEnd(14)} stored=${String(stored).padStart(5)}  recomputed=${String(recomputed).padStart(5)}  ${ok ? 'agree' : '← DIFFERS by ' + (recomputed - stored)}`);
    });
    if (drifted.length) {
      /* ============ THIS MESSAGE WAS WRONG, AND IT COST A MONTH ========
         It used to end "so this is not a wrong score on anyone's screen.
         It is a stale number." That reading assumed `pts` is the rotted
         field and the lanes are the truth.

         On 25 Aug it printed, correctly:

             Courtside: pts=90 but its lanes sum to 80

         and called it harmless. It was not. The runner had graded a catch
         worth 10, folded it into `pts`, and published no lane for it — so
         `pts=90` was the RIGHT number and the lane sum of 80 was the wrong
         one, and the board, which composes from lanes, showed 80. The
         detection worked perfectly and the conclusion sent everybody away.

         Drift means the two disagree. It does NOT say which is right, and
         a tool that guesses is worse than one that reports. */
      console.log(`\n  pts AND ITS OWN LANES DISAGREE — one of them is wrong:`);
      console.log(`  the board and every rank compose from the LANES (nightTotal),`);
      console.log(`  the archive and this file's totals read pts. If a lane the`);
      console.log(`  server grades is missing, pts is the correct one and the`);
      console.log(`  player's screen is short. Check before calling it cosmetic —`);
      console.log(`  on 25 Aug this exact line was a real 10 points and was dismissed.`);
      drifted.forEach(d => console.log(`    ${d}`));

      /* ============ AND THEN GO AND LOOK, 28 Aug ======================
         The block above is a real detector with a real incident behind
         it, and it was still not enough — because everything it reads is
         the ARCHIVE, a snapshot the runner writes at one instant. The
         runner updates `pts` and the lane fields at slightly different
         moments, so a snapshot taken mid-grade freezes a row whose two
         halves disagree, and this file then reported that frozen
         disagreement in the present tense.

         28 Aug, five rooms: it reported four players short by 5 to 15
         points, and it was read as "the board under-reported 40 points
         tonight" and told to the founder that way. Every one of those
         rows had already reconciled in the LIVE player doc — Dog Bird's
         archive held caughtPts=75 with pts=390, and the live row holds
         caughtSrv=90, which is 390 exactly. Nobody's screen was ever
         short.

         A detector that cannot tell a stale snapshot from a live fault
         produces exactly one behaviour: the next real one gets dismissed.
         So it now finishes the job it starts — read the live row and say
         whether the night settled. */
      const live = db.collection(`nights/${NIGHT}/players`);
      let unreconciled = 0;
      for (const uid of uids) {
        const v = players[uid] || {};
        if (v.livePts == null || Number(v.pts || 0) === lanes(v)) continue;
        const name = v.name || uid.slice(0, 6);
        let now = null;
        try { const d = await live.doc(uid).get(); now = d.exists ? d.data() : null; } catch (_) {}
        if (!now) { console.log(`    ${name}: LIVE ROW MISSING — cannot say whether it settled`); unreconciled++; continue; }
        const nPts = Number(now.pts || 0), nLanes = lanes(now);
        if (nPts === nLanes) {
          console.log(`    ${name}: settled live at ${nPts} — the archive was taken mid-grade, no screen was short`);
        } else {
          unreconciled++;
          console.log(`    ${name}: STILL DISAGREES LIVE — pts=${nPts}, lanes=${nLanes}. THIS ONE IS REAL.`);
        }
      }
      console.log(unreconciled
        ? `  → ${unreconciled} row(s) still disagree in the live data. Do not dismiss these.`
        : `  → every drifted row reconciled live. The archive was a snapshot, not a fault.`);
    }
    console.log(`  → ${agree} of ${uids.length} players agree`);
    console.log(`  NOTE: this is server-side only. pred/catch/caught points settle on the`);
    console.log(`  phone, so "what the player's SCREEN showed" still needs a human to report.`);
  }

  // ---- participation ------------------------------------------------
  console.log(`\n─ PARTICIPATION ─`);
  const perRound = scored.map(r => Object.keys(subs[r.id] || {}).length);
  console.log(`  seats in the room     : ${uids.length}`);
  console.log(`  submissions per round : ${perRound.join(' · ') || 'none'}`);
  console.log(`  callit questions      : ${(arc.callit || []).length || Object.keys(arc.callit || {}).length || 0}`);

  // ---- errors --------------------------------------------------------
  const errs = await db.collection(`nights/${NIGHT}/errors`).get();
  console.log(`\n─ ERRORS LOGGED BY PLAYERS ─`);
  console.log(`  ${errs.size} error document(s)`);
  errs.docs.slice(0, 8).forEach(d => {
    const e = d.data();
    console.log(`    ${String(e.where || e.tag || '?').padEnd(14)} ${String(e.msg || e.message || '').slice(0, 90)}`);
  });
  if (errs.size === 0) {
    console.log('  Zero errors is a FINDING, not a clean bill of health: it can mean');
    console.log('  nothing threw, or that the failure never surfaced. GN11 logged zero');
    console.log('  while a real tab-switch problem was being reported live.');
  }
  /* ============ ONE LINE A MACHINE CAN KEEP ==========================
     Round completion and score agreement were THE two headline numbers,
     and both stopped being reported after 19 Aug — the last figure on
     record is "1 of 4 players agree". Reconstructing the month from
     runner logs on 26 Aug is what a missing ledger costs.

     Everything above is for a human reading one night. This line is for
     host/debrief-nightly.sh to append to a file, so the trend exists
     without anybody deciding to look. Tab-separated, stable column
     order, and it prints even when a section had nothing to say —
     "unknown" is a value, and a gap in the ledger must be visible rather
     than absent. */
  const F = (x) => (x == null ? 'unknown' : String(x));
  console.log('\nMETRICS\t' + [
    NIGHT,
    'rounds=' + F(scored.length) + '/' + F(rounds.length),
    'completion=' + F(pct) + '%',
    'seats=' + F(uids.length),
    'agree=' + F(AGREED) + '/' + F(uids.length),
    'errors=' + F(errs.size)
  ].join('\t'));
  process.exit(0);
})().catch(e => { console.error('debrief failed: ' + (e && e.stack || e)); process.exit(1); });
