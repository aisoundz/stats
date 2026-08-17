/* GAME NIGHT #11 DEBRIEF — the two numbers, read from the archive.
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
  console.log(`\n══ GAME NIGHT #11 · ${NIGHT} ══\n`);

  // ---- the archive -------------------------------------------------
  const snaps = await db.collection(`nights/${NIGHT}/archive`).get();
  if (snaps.empty) { console.log('NO ARCHIVE for this night — cannot debrief from data.'); process.exit(1); }
  const stamps = snaps.docs.map(d => d.id).sort();
  const arc = snaps.docs.find(d => d.id === stamps[stamps.length - 1]).data();
  console.log(`archive snapshots : ${stamps.length}  (using the last, ${stamps[stamps.length - 1]})`);
  console.log(`written by        : ${arc.by || 'unknown'}   why: ${arc.why || 'unknown'}`);

  const rounds = arc.rounds || [];
  const subs = arc.subs || {};
  const players = arc.players || {};

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
  if (!uids.length) console.log('  no player rows in the archive');
  else {
    const tally = AUTO.tally(scored, players, subs);
    let agree = 0, diff = 0;
    uids.forEach(uid => {
      const stored = Number((players[uid] || {}).pts || 0);
      const recomputed = Number(((tally || {})[uid] || {}).pts || 0);
      const name = (players[uid] || {}).name || uid.slice(0, 6);
      const ok = stored === recomputed;
      ok ? agree++ : diff++;
      console.log(`    ${String(name).padEnd(14)} stored=${String(stored).padStart(5)}  recomputed=${String(recomputed).padStart(5)}  ${ok ? 'agree' : '← DIFFERS by ' + (recomputed - stored)}`);
    });
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
  process.exit(0);
})().catch(e => { console.error('debrief failed: ' + (e && e.stack || e)); process.exit(1); });
