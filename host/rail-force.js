#!/usr/bin/env node
/* =====================================================================
   MAKE THE RAIL MATCH THE MANIFEST — EVEN OVER A STALE FLAGSHIP STAMP.
   ---------------------------------------------------------------------
   host/slate-offer.js already does "trim slate/{date}.games to the
   manifest", with one exception: "a flagship is always offered", because
   the STANDALONE cron flagship (cron-start-night.sh, its own hardcoded
   NIGHT_ID) never enters a manifest at all and would otherwise get
   dropped by the trim.

   That exception reads `g.flagship` on the SAME per-game objects
   marquee.js also stamps `flagship:true` onto when it marks a game the
   day's "main event" (the ★ in its own output) — a different concept
   reusing the same field name. So once marquee.js features a game and
   that pick is later corrected (a game turns out not to be national,
   like 26 Aug's Cubs @ Diamondbacks and Astros @ Yankees), the stale
   `flagship:true` on the DROPPED entries makes slate-offer.js keep them
   forever, because it cannot tell "the real standalone flagship, which
   is never in a manifest" from "a manifest game marquee.js once starred
   and no longer should".

   The standalone cron flagship isn't in the crontab at all right now
   (checked 24 Aug — no cron-start-night.sh line), so for as long as
   that's true, ANY game in slate/{date}.games not also in the manifest
   is stale, full stop, no exception needed. If the standalone flagship
   ever comes back, this needs the same real distinction slate-offer.js
   needs — a field marquee.js does not also write.

   Usage:
     node host/rail-force.js 2026-08-26              # apply
     node host/rail-force.js 2026-08-26 --dry-run     # show only
   ================================================================== */
const fs = require('fs'), path = require('path'), admin = require('firebase-admin');
const DATE = (process.argv[2] || '').trim();
const DRY = process.argv.includes('--dry-run');
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) { console.error('usage: node host/rail-force.js YYYY-MM-DD [--dry-run]'); process.exit(1); }

const LOGDIR = process.env.LOGDIR || path.join(process.env.HOME, 'gamenight-logs');
const MAN = path.join(LOGDIR, 'slate-all-' + DATE + '.tsv');
if (!fs.existsSync(MAN)) { console.error('no manifest at ' + MAN + ' — run start-slate.sh --build first'); process.exit(1); }

const keep = new Set();
fs.readFileSync(MAN, 'utf8').split('\n').forEach(l => {
  const c = l.split('\t'); if (c[1]) keep.add(c[1].trim());
});
if (!keep.size) { console.error('the manifest is empty — refusing to empty the rail'); process.exit(1); }

const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!SA) { console.error('FIREBASE_SERVICE_ACCOUNT is not set'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA)) });
const db = admin.firestore();

(async () => {
  const ref = db.doc('slate/' + DATE);
  const snap = await ref.get();
  if (!snap.exists) { console.error('no slate/' + DATE); process.exit(1); }
  const games = snap.data().games || [];
  const before = games.length;

  // NO FLAGSHIP EXCEPTION. Manifest membership alone decides.
  const kept = games.filter(g => g && keep.has(g.nightId));
  const dropped = games.filter(g => g && !keep.has(g.nightId));

  console.log('slate/' + DATE);
  console.log('  offered before : ' + before);
  kept.forEach(g => console.log('    keep  ' + (g.flagship ? '★ ' : '  ') + g.nightId + '   ' + (g.league || '')));
  dropped.forEach(g => console.log('    DROP  ' + (g.flagship ? '★ ' : '  ') + g.nightId + '   ' + (g.league || '') +
    (g.flagship ? '   (stale flagship stamp — not in the manifest, dropped anyway)' : '   (not in the manifest)')));
  console.log('  offered after  : ' + kept.length + (DRY ? '   (dry run — nothing written)' : ''));

  if (!kept.length) { console.error('  REFUSING: that would leave the rail empty'); process.exit(1); }
  if (DRY) return;
  await ref.set({
    games: kept,
    leagues: [...new Set(kept.map(g => g.league).filter(Boolean))],
    flagship: kept.filter(g => g.flagship).map(g => g.nightId),
    at: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  console.log('  written.');
})().catch(e => { console.error('ERR ' + e.message); process.exit(1); });
