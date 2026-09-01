#!/usr/bin/env node
/* =====================================================================
   PUBLISH ONE DAILY QUESTION. One a day, the same one for everybody.
   ---------------------------------------------------------------------
   The product only exists on game nights. Four rooms today, none tomorrow
   — and the first person outside the building to play it said so in his
   own words: "come, go — I'm hunting around." This is the thing to open
   on a Tuesday.

   ONE QUESTION, SHARED. Not a personalised quiz. A quiz is something you
   do alone; one question everybody gets is something to talk about.

   ============ IT REFUSES MORE THAN IT PUBLISHES ======================
   A records question is keyed BY HAND. No feed will ever contradict it,
   the backtest cannot measure its spread, and no resolver will void it —
   so if it is wrong it is wrong forever, confidently, in the one part of
   the product that is supposed to be beyond argument.

   Everything below is therefore a refusal:

     no answer         -> refuse. `a` must name which option is true.
     no source         -> refuse. somebody must have CHECKED it.
     already asked     -> refuse. a repeat inside the window is a bug.
     nothing ready     -> refuse LOUDLY and publish nothing, rather than
                          reach for the least-bad unchecked entry.

   Publishing nothing is a fine outcome. Publishing a wrong record is not.

       node host/daily-pick.js              # say what it would do
       node host/daily-pick.js --apply
       node host/daily-pick.js --status     # what is ready, what is not
   ================================================================== */
const fs = require('fs');
const path = require('path');
const { BANK, stem, ready } = require('./daily-bank.js');

const APPLY  = process.argv.includes('--apply');
const STATUS = process.argv.includes('--status');
const LOG    = path.join(process.env.HOME, 'gamenight-logs', 'daily.log');
/* Days before a question may come round again. */
const COOLDOWN = 90;

function log(line){
  const m = `${new Date().toISOString()}  ${line}\n`;
  process.stdout.write(m);
  try { fs.appendFileSync(LOG, m); } catch (_) {}
}
const todayPT = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

/* ---- status: the honest state of the bank -------------------------- */
if (STATUS) {
  const ok = BANK.filter(ready), no = BANK.filter(e => !ready(e));
  console.log(`\n  ${BANK.length} question(s) in the bank · ${ok.length} publishable · ${no.length} not\n`);
  no.forEach(e => {
    const missing = [];
    if (!Number.isInteger(e.a)) missing.push('no answer');
    if (!String(e.src || '').trim()) missing.push('no source');
    console.log(`  NOT READY  ${e.id.padEnd(8)} "${stem(e)}"  — ${missing.join(', ')}`);
  });
  if (ok.length) { console.log('');
    ok.forEach(e => console.log(`  ready      ${e.id.padEnd(8)} "${stem(e)}"  -> ${e.o[e.a]}`)); }
  console.log('\n  A question is publishable only when somebody has checked it and said where.\n');
  process.exit(0);
}

(async () => {
  const date = todayPT();
  log(`=== daily-pick ${date} ${APPLY ? '(APPLY)' : '(dry run)'} ===`);

  const pool = BANK.filter(ready);
  if (!pool.length) {
    log(`REFUSING: ${BANK.length} question(s) in the bank and NONE is publishable.`);
    log('  Every entry needs an answer (`a`) and a source (`src`). Run --status to see which.');
    log('  Nothing published. A day with no question beats a wrong record.');
    process.exit(2);
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { log('REFUSE: FIREBASE_SERVICE_ACCOUNT is not set.'); process.exit(1); }
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  const db = admin.firestore();

  /* Already done today? Idempotent on purpose — a cron that fires twice
     must not swap the question out from under anybody mid-answer. */
  const ref = db.doc(`daily/${date}`);
  const cur = await ref.get();
  if (cur.exists) {
    log(`already published for ${date}: "${(cur.data() || {}).q}" — nothing to do.`);
    process.exit(0);
  }

  /* What has been asked recently, so nothing repeats inside the window. */
  const since = new Date(Date.now() - COOLDOWN * 864e5).toISOString().slice(0, 10);
  const recent = await db.collection('daily').where('__name__', '>=', since).get();
  const used = new Set(); recent.forEach(d => { const v = d.data() || {}; if (v.id) used.add(v.id); });
  log(`${pool.length} publishable · ${used.size} asked in the last ${COOLDOWN} days`);

  const fresh = pool.filter(e => !used.has(e.id));
  if (!fresh.length) {
    log(`REFUSING: every publishable question has been asked inside ${COOLDOWN} days.`);
    log('  Add to the bank rather than repeating one — a question somebody remembers is not a question.');
    process.exit(2);
  }

  /* Oldest-unused first, deterministically. No randomness: a picker that
     cannot be re-run to the same answer cannot be debugged. */
  const pick = fresh[0];
  const doc = {
    id: pick.id, league: pick.league, n: pick.n,
    q: stem(pick), o: pick.o, a: pick.a,
    who: pick.who || '', when: pick.when || '', src: pick.src,
    at: admin.firestore.FieldValue.serverTimestamp(), by: 'daily-pick.js',
  };

  log(`pick: ${pick.id} — "${doc.q}"`);
  doc.o.forEach((o, i) => log(`   ${i === pick.a ? '->' : '  '} ${String.fromCharCode(65 + i)}  ${o}`));
  log(`   source: ${pick.src}`);

  if (!APPLY) { log('dry run — nothing written. Add --apply.'); process.exit(0); }

  await ref.set(doc);
  /* VERIFY THE EFFECT, NOT THE CALL. Read it back: this project has twice
     believed a write that never landed. */
  const back = await ref.get();
  if (!back.exists || (back.data() || {}).id !== pick.id) {
    log('WROTE BUT COULD NOT READ IT BACK — the question is not live.');
    process.exit(2);
  }
  log(`published daily/${date} — verified by reading it back.`);
  process.exit(0);
})().catch(e => { log('CRASHED: ' + ((e && e.stack) || e)); process.exit(1); });
