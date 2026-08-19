#!/usr/bin/env node
/* =====================================================================
   MAKE THE RAIL MATCH THE MANIFEST.
   ---------------------------------------------------------------------
   `RUN_LEAGUES` keeps an unhosted LEAGUE off the player's rail. It does
   nothing about `MAX_ROOMS`, which caps runners WITHIN a hosted league —
   so switching MLS on would offer eleven matches and host two, and the
   other nine are rooms a person can walk into and sit in all night. That
   is the same bug the RUN_LEAGUES filter was written to stop, one level
   down, and the CTO review called it "only half fixed".

   host/pick-slate.sh already curates the MANIFEST — the list the launcher
   actually starts. But the rail is read from `slate/{date}`, which
   build-slate.js writes separately, so trimming one left the other
   advertising rooms nothing would host.

   This makes the rail agree with the manifest: `slate/{date}.games` is
   rewritten to exactly the rooms in the manifest, plus any flagship
   (which is hosted by its own cron line and never enters a manifest).

   Nothing is deleted. Every `schedule/{nightId}` document stays exactly
   where it was, so the backtest, the archive and tomorrow's data are
   untouched — the games are simply not OFFERED to a human tonight.

       node host/slate-offer.js 2026-08-19             # from the manifest
       node host/slate-offer.js 2026-08-19 --dry-run
   ================================================================== */
const fs=require('fs'), path=require('path'), admin=require('firebase-admin');
const DATE=(process.argv[2]||'').trim();
const DRY=process.argv.includes('--dry-run');
if(!/^\d{4}-\d{2}-\d{2}$/.test(DATE)){ console.error('usage: node host/slate-offer.js YYYY-MM-DD [--dry-run]'); process.exit(1); }

const LOGDIR=process.env.LOGDIR || path.join(process.env.HOME,'gamenight-logs');
const MAN=path.join(LOGDIR, 'slate-all-'+DATE+'.tsv');
if(!fs.existsSync(MAN)){ console.error('no manifest at '+MAN+' — run start-slate.sh --build first'); process.exit(1); }

const keep=new Set();
fs.readFileSync(MAN,'utf8').split('\n').forEach(l=>{
  const c=l.split('\t'); if(c[1]) keep.add(c[1].trim());
});
if(!keep.size){ console.error('the manifest is empty — refusing to empty the rail'); process.exit(1); }

const SA=process.env.FIREBASE_SERVICE_ACCOUNT;
if(!SA){ console.error('FIREBASE_SERVICE_ACCOUNT is not set'); process.exit(1); }
admin.initializeApp({credential:admin.credential.cert(JSON.parse(SA))});
const db=admin.firestore();

(async()=>{
  const ref=db.doc('slate/'+DATE);
  const snap=await ref.get();
  if(!snap.exists){ console.error('no slate/'+DATE); process.exit(1); }
  const games=snap.data().games||[];
  const before=games.length;
  /* A FLAGSHIP IS ALWAYS OFFERED. It is hosted by cron-start-night.sh, it
     never enters a manifest, and dropping it would remove the one game the
     email is about from the picker while its runner hosted it perfectly. */
  const kept=games.filter(g=>g && (g.flagship || keep.has(g.nightId)));
  const dropped=games.filter(g=>g && !(g.flagship || keep.has(g.nightId)));

  console.log('slate/'+DATE);
  console.log('  offered before : '+before);
  kept.forEach(g=>console.log('    keep  '+(g.flagship?'★ ':'  ')+g.nightId+'   '+(g.league||'')));
  dropped.forEach(g=>console.log('    drop     '+g.nightId+'   '+(g.league||'')+'   (built, not hosted — its schedule doc stays)'));
  console.log('  offered after  : '+kept.length+(DRY?'   (dry run — nothing written)':''));

  if(!kept.length){ console.error('  REFUSING: that would leave the rail empty'); process.exit(1); }
  if(DRY) return;
  await ref.set({ games:kept,
                  leagues:[...new Set(kept.map(g=>g.league).filter(Boolean))],
                  flagship:kept.filter(g=>g.flagship).map(g=>g.nightId),
                  at: admin.firestore.FieldValue.serverTimestamp() }, {merge:true});
  console.log('  written.');
})().catch(e=>{ console.error('ERR '+e.message); process.exit(1); });
