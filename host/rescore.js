#!/usr/bin/env node
/* =====================================================================
   Recompute a finished night's stored totals from its submissions.
   ---------------------------------------------------------------------
   For repairing a night that ended with a stale `pts` — the GN11 case,
   where a prediction card settled on the phone seconds after the runner's
   last scoring pass and the total was never recomputed.

       NIGHT_ID=... node host/rescore.js            # dry run, writes nothing
       NIGHT_ID=... node host/rescore.js --apply    # writes

   IT ONLY EVER RAISES OR CORRECTS `pts`, and it computes through the SAME
   AUTO.tally the Control Room and the runner use — recomputing with a
   second implementation would prove nothing about the one that scored the
   night. The client lanes (predPts/catchPts/caughtPts) are read, never
   written: they belong to the device and this has no business inventing
   them.

   Dry run is the default on purpose. This writes to real player records on
   a night that is already over, and nobody should be able to do that by
   forgetting a flag.
   ================================================================== */
const admin = require('firebase-admin');
const fs = require('fs'), vm = require('vm'), path = require('path');

const NIGHT = process.env.NIGHT_ID || '';
const APPLY = process.argv.includes('--apply');
const die = (m) => { console.error('FATAL: ' + m); process.exit(1); };
if (!NIGHT) die('NIGHT_ID is not set');
if (!process.env.FIREBASE_SERVICE_ACCOUNT) die('FIREBASE_SERVICE_ACCOUNT is not set');

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();

function loadAuto() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const S = '/* @host-shared:start', E = '/* @host-shared:end */';
  if (src.indexOf(S) < 0 || src.indexOf(E) < 0) die('the @host-shared sentinels are missing from admin.html');
  const ctx = vm.createContext({ console, fetch: () => { throw new Error('no network'); } });
  vm.runInContext(src.slice(src.indexOf(S), src.indexOf(E) + E.length), ctx, { filename: 'host-shared' });
  if (!ctx.AUTO || typeof ctx.AUTO.tally !== 'function') die('the shared block produced no usable AUTO.tally');
  return ctx.AUTO;
}

(async () => {
  const AUTO = loadAuto();

  /* Read the LIVE collections, not the archive. The archive is a snapshot;
     the live documents are what the board actually serves. */
  const roundsSnap = await db.collection(`nights/${NIGHT}/rounds`).get();
  const rounds = [];
  for (const d of roundsSnap.docs) {
    const r = Object.assign({ id: d.id }, d.data());
    const subsSnap = await db.collection(`nights/${NIGHT}/rounds/${d.id}/subs`).get();
    r.__subs = {}; subsSnap.forEach(s => { r.__subs[s.id] = s.data(); });
    rounds.push(r);
  }
  const scored = rounds.filter(r => r.state === 'scored');
  const subs = {}; rounds.forEach(r => { subs[r.id] = r.__subs; });

  const playersSnap = await db.collection(`nights/${NIGHT}/players`).get();
  const players = {}; playersSnap.forEach(d => { players[d.id] = d.data(); });

  if (!Object.keys(players).length) die(`no players in ${NIGHT}`);
  console.log(`\n${NIGHT} — ${scored.length} scored round(s), ${Object.keys(players).length} player(s)`);
  console.log(APPLY ? 'MODE: APPLY — this will write\n' : 'MODE: dry run — nothing will be written\n');

  const tally = AUTO.tally(scored, players, subs);
  const changes = [];
  console.log('  player            stored   recomputed   change');
  for (const [uid, p] of Object.entries(players)) {
    const stored = Number(p.pts || 0);
    const now = Number(((tally || {})[uid] || {}).pts || 0);
    const name = p.name || uid.slice(0, 6);
    const delta = now - stored;
    console.log(`  ${String(name).padEnd(16)} ${String(stored).padStart(5)}   ${String(now).padStart(10)}   ${delta === 0 ? '—' : (delta > 0 ? '+' : '') + delta}`);
    if (delta !== 0) changes.push({ uid, name, stored, now });
  }

  if (!changes.length) { console.log('\nnothing to correct — every stored total already matches.'); process.exit(0); }
  console.log(`\n${changes.length} player(s) would change.`);
  if (!APPLY) { console.log('Re-run with --apply to write.'); process.exit(0); }

  for (const c of changes) {
    await db.doc(`nights/${NIGHT}/players/${c.uid}`).set({ pts: c.now }, { merge: true });
    console.log(`  wrote ${c.name}: ${c.stored} -> ${c.now}`);
  }
  /* Leave a trail. A score that changes after a night is over should be
     explainable later without anyone having to remember this happened. */
  await db.doc(`nights/${NIGHT}`).set({
    rescoredAt: admin.firestore.FieldValue.serverTimestamp(),
    rescoredNote: `recomputed ${changes.length} total(s) from submissions via AUTO.tally`
  }, { merge: true });
  console.log('\ndone — and the night document records that this happened.');
  process.exit(0);
})().catch(e => die((e && e.stack) || String(e)));
