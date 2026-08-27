#!/usr/bin/env node
/* =====================================================================
   THE FUNNEL — where the ninety fall out.
   ---------------------------------------------------------------------
   Measured against live Firestore on 26 Aug 2026:

       96 people have opened a room
        6 have ever scored a point
        6 came back on more than one date
      9.3 nights, on average, for those six

   That last number is the important one and it changes the diagnosis.
   The people who ACTUALLY PLAY do not leave. The product does not have a
   retention problem, it has an ACTIVATION problem: ninety-four per cent
   never reach a first point, and until now nothing measured where they
   stopped.

   index.html has written a telemetry document per player per night since
   before Game Night #11, at nights/{nightId}/telemetry/{uid}, carrying an
   `events` array. Everything below is read from that. Two events were
   added on 27 Aug to close the gap:

     first_score   fired once per night by recomputeScore() the moment a
                   player's total leaves zero, whatever lane it came from
     arcade_take   fired when the round takes the player into it from
                   another tab — so we can say whether the arcade flow
                   moved the number it was built to move

   WHAT IT REPORTS AND WHAT IT REFUSES TO.
   It reports what it HAS. A night with no telemetry is reported as NO
   TELEMETRY, never as zero players — the same rule host/minutes.js
   states, and for the same reason: a missing measurement and a measured
   zero are different facts and this repo has confused them before.

       node host/funnel.js                  # last 7 nights
       node host/funnel.js --days 30
       node host/funnel.js --night slate-2026-08-27-lad-atl
   ================================================================== */
const admin = require('firebase-admin');

const ARG  = process.argv.slice(2);
const argOf = (f, d) => { const i = ARG.indexOf(f); return (i >= 0 && ARG[i+1]) ? ARG[i+1] : d; };
const DAYS  = Number(argOf('--days', 7));
const ONE   = argOf('--night', '');

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error('FIREBASE_SERVICE_ACCOUNT is not set.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
const db = admin.firestore();

/* The steps, in order. A player counts at a step if ANY of its events
   appears in their night. `night_join` is written by trkNow() at the top
   of joinNight, so it means "tried to take a seat", not "succeeded" —
   which is deliberate: a join that fails is exactly the kind of fallout
   this is looking for. */
const STEPS = [
  { key: 'opened',   label: 'opened the app',        ev: ['app_open'] },
  { key: 'joined',   label: 'took a seat',           ev: ['night_join'] },
  { key: 'carded',   label: 'started a pick card',   ev: ['card_start'] },
  { key: 'answered', label: 'answered a question',   ev: ['round_answer', 'callit_answer'] },
  { key: 'scored',   label: 'SCORED A POINT',        ev: ['first_score'] },
];

function dayOf(nightId){ const m = String(nightId).match(/(\d{4}-\d{2}-\d{2})/); return m ? m[1] : '?'; }

(async () => {
  const nights = await db.collection('nights').get();
  let ids = nights.docs.map(d => d.id);
  if (ONE) ids = ids.filter(i => i === ONE);
  else {
    const cut = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
    ids = ids.filter(i => dayOf(i) >= cut).sort();
  }
  if (!ids.length) { console.log('no nights in range'); process.exit(0); }

  const totals = {}; STEPS.forEach(s => totals[s.key] = new Set());
  const arcadeFrom = {}; let arcadeTotal = 0;
  const noTelemetry = [];
  const rows = [];

  for (const id of ids) {
    const tel = await db.collection(`nights/${id}/telemetry`).get();
    if (tel.empty) { noTelemetry.push(id); continue; }

    const hit = {}; STEPS.forEach(s => hit[s.key] = 0);
    tel.forEach(doc => {
      const v = doc.data() || {};
      const names = new Set((v.events || []).map(e => (e && (e.n || e.name || e.e)) || ''));
      /* app_open is implied by having a telemetry document at all: the
         doc is only written by a page that opened. Counting it from the
         event alone under-reports anybody whose buffer rolled over. */
      names.add('app_open');
      STEPS.forEach(s => {
        if (s.ev.some(n => names.has(n))) { hit[s.key]++; totals[s.key].add(id + '|' + doc.id); }
      });
      (v.events || []).forEach(e => {
        if (e && (e.n || e.name || e.e) === 'arcade_take') {
          arcadeTotal++;
          const from = (e.p && e.p.from) || (e.props && e.props.from) || e.from || '?';
          arcadeFrom[from] = (arcadeFrom[from] || 0) + 1;
        }
      });
    });
    rows.push({ id, seats: tel.size, hit });
  }

  console.log('\n  THE FUNNEL' + (ONE ? '  ·  ' + ONE : `  ·  last ${DAYS} days`) + '\n');

  if (rows.length) {
    console.log('  ' + 'night'.padEnd(30) + STEPS.map(s => s.key.padStart(9)).join(''));
    rows.forEach(r => {
      console.log('  ' + r.id.replace(/^slate-/, '').padEnd(30)
        + STEPS.map(s => String(r.hit[s.key]).padStart(9)).join(''));
    });
  }

  console.log('\n  ACROSS EVERY NIGHT IN RANGE  (a person counts once per night)\n');
  const top = totals[STEPS[0].key].size || 1;
  /* AN EVENT THAT DID NOT EXIST YET IS NOT A ZERO. first_score was added
     on 27 Aug 2026; every night before it has no such event and reporting
     that as "0 scored" would say the product activates nobody, which is
     false and is exactly the mistake this file's own header warns about.
     If NOTHING in range carries the event, say it is unmeasured. */
  const scoredSeen = totals.scored.size > 0;
  let prev = null, prevKey = null;
  STEPS.forEach(s => {
    const n = totals[s.key].size;
    if (s.key === 'scored' && !scoredSeen) {
      console.log('  ' + s.label.padEnd(24) + '    ?' + '     -'
        + '  (not measured before 27 Aug — first_score did not exist)');
      prev = n; prevKey = s.key; return;
    }
    const pctTop = Math.round(100 * n / top);
    const bar = '█'.repeat(Math.max(0, Math.round(pctTop / 3)));
    /* THESE STEPS ARE NOT STRICTLY NESTED and pretending otherwise prints
       a negative loss. A player can start a pick card without a recorded
       night_join — the card is reachable before a seat is taken — so
       `carded` legitimately exceeds `joined`. Report that as what it is
       rather than as minus-three people. */
    let note = '';
    if (prev !== null) {
      if (n > prev) note = `   +${n - prev} more than the step above (these steps are not nested)`;
      else if (prev > 0) note = `   lost ${prev - n} here (${Math.round(100 * (prev - n) / prev)}%)`;
    }
    console.log('  ' + s.label.padEnd(24) + String(n).padStart(5)
      + String(pctTop + '%').padStart(6) + '  ' + bar + note);
    prev = n; prevKey = s.key;
  });

  console.log('\n  THE ARCADE FLOW\n');
  if (!arcadeTotal) {
    console.log('    no arcade_take events yet. Either no round opened while a player was on');
    console.log('    another tab, or the build predates 2026-08-27-comego.229.');
  } else {
    console.log(`    the round took the player in ${arcadeTotal} time(s), from:`);
    Object.keys(arcadeFrom).sort((a,b)=>arcadeFrom[b]-arcadeFrom[a])
      .forEach(k => console.log('      ' + String(k).padEnd(12) + arcadeFrom[k]));
  }

  if (noTelemetry.length) {
    console.log('\n  NO TELEMETRY (reported as unknown, never as zero):');
    noTelemetry.forEach(n => console.log('    ' + n));
  }

  console.log('\n  The number that matters is the last row as a share of the first.'
            + '\n  Read directly from player documents on 26 Aug it was 6 of 96, and the'
            + '\n  six who got there came back 9.3 nights each. Moving that share is'
            + '\n  worth more than any feature. From 27 Aug that row is measured here'
            + '\n  rather than reconstructed by hand.\n');
  process.exit(0);
})().catch(e => { console.error('funnel failed: ' + (e && e.stack || e)); process.exit(1); });
