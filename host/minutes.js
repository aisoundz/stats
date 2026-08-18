#!/usr/bin/env node
/* =====================================================================
   MINUTES — the only number this product lives or dies by.
   ---------------------------------------------------------------------
   The positioning is that a sportsbook pays you for being RIGHT and STATS
   pays you for PAYING ATTENTION. That makes minutes-with-the-app-open the
   core metric, and the competitive set the second screen — not DraftKings.

   index.html has been writing one telemetry doc per player per night since
   before Game Night #11, at nights/{nightId}/telemetry/{uid}. Nothing has
   ever read it. Collected-and-unread is worse than un-instrumented, because
   it feels solved.

   TWO THINGS THIS GETS RIGHT, both learned the hard way:

   1. MINUTES ARE SUMMED ACROSS ROOMS, per human, per night. A player who
      moves between rooms writes a doc in each. Reading one understates
      exactly the room-switchers the slate was built for.

   2. A MEDIAN, NOT A MEAN. One person leaving a tab open for four hours
      moves a mean and tells you nothing about the room. p25/median/p75 is
      what a session actually looks like.

   It reports what it HAS. A night with no telemetry is reported as no
   telemetry, never as zero minutes — see the ONE FACT, MANY COPIES rule:
   an absence and a zero are different facts and must not share a cell.

     node host/minutes.js                    # every night in the archive
     node host/minutes.js --night gn13-…     # one night
     node host/minutes.js --days 14          # recent nights only
   ================================================================== */
const admin = require('firebase-admin');

const ARG = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const ONE_NIGHT = ARG('night', null);
const DAYS = Number(ARG('days', 0)) || 0;

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('FATAL: FIREBASE_SERVICE_ACCOUNT is not set.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[i];
};
/* A night id carries its own date: gn13-2026-08-19-min-gs, slate-2026-08-22-… */
const dateOf = (id) => (String(id).match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';

(async () => {
  let ids = [];
  if (ONE_NIGHT) ids = [ONE_NIGHT];
  else {
    const snap = await db.collection('nights').get();
    ids = snap.docs.map(d => d.id);
  }
  if (DAYS > 0) {
    const cut = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
    ids = ids.filter(id => !dateOf(id) || dateOf(id) >= cut);
  }
  ids.sort((a, b) => String(dateOf(a) + a).localeCompare(String(dateOf(b) + b)));

  /* uid -> which nights they have appeared on, so "new" is a fact about a
     person's history and not about this night's document count. */
  const seenBefore = new Set();
  const rows = [];

  for (const id of ids) {
    const tel = await db.collection(`nights/${id}/telemetry`).get();
    if (tel.empty) { rows.push({ id, none: true }); continue; }

    /* SUM PER HUMAN. One doc per room, and a night is the person's whole
       evening, not their longest single room. */
    const byUid = new Map();
    tel.docs.forEach(d => {
      const v = d.data() || {};
      const uid = v.uid || d.id;
      const cur = byUid.get(uid) || { mins: 0, rooms: 0, name: '', sessions: 0, build: '' };
      cur.mins += Number(v.mins) || 0;
      cur.rooms += 1;
      cur.sessions = Math.max(cur.sessions, Number(v.sessions) || 1);
      cur.name = cur.name || v.name || '';
      cur.build = v.build || cur.build;
      byUid.set(uid, cur);
    });

    const mins = [...byUid.values()].map(v => v.mins);
    const fresh = [...byUid.keys()].filter(u => !seenBefore.has(u)).length;
    [...byUid.keys()].forEach(u => seenBefore.add(u));

    rows.push({
      id, humans: byUid.size, fresh,
      p25: pct(mins, 25), med: pct(mins, 50), p75: pct(mins, 75),
      max: Math.max(...mins),
      switchers: [...byUid.values()].filter(v => v.rooms > 1).length,
      returners: [...byUid.values()].filter(v => v.sessions > 1).length,
      top: [...byUid.values()].sort((a, b) => b.mins - a.mins).slice(0, 3)
    });
  }

  console.log('\n══ MINUTES WITH THE APP OPEN ══\n');
  console.log('night'.padEnd(30), 'ppl'.padStart(4), 'new'.padStart(4),
              'p25'.padStart(5), 'med'.padStart(5), 'p75'.padStart(5), 'max'.padStart(5),
              'switch'.padStart(7), 'back'.padStart(5));
  console.log('-'.repeat(84));
  let any = false;
  rows.forEach(r => {
    if (r.none) { console.log(r.id.padEnd(30), '   —  no telemetry written for this night'); return; }
    any = true;
    console.log(r.id.padEnd(30),
      String(r.humans).padStart(4), String(r.fresh).padStart(4),
      String(r.p25).padStart(5), String(r.med).padStart(5), String(r.p75).padStart(5),
      String(r.max).padStart(5), String(r.switchers).padStart(7), String(r.returners).padStart(5));
  });

  if (!any) {
    console.log('\nNo night in range has any telemetry. That is an absence, not a zero:');
    console.log('either nobody played, or SB.trkWrite never ran. Check a night you know had');
    console.log('players before concluding anything about engagement.\n');
    process.exit(0);
  }

  /* THE HEADLINE, and deliberately only what the data supports. */
  const live = rows.filter(r => !r.none);
  const allMed = live.map(r => r.med).filter(v => v != null);
  console.log('\n── what this says ──');
  console.log(`nights with telemetry : ${live.length} of ${rows.length}`);
  console.log(`distinct humans ever  : ${seenBefore.size}`);
  console.log(`median session, typical night : ${pct(allMed, 50)} min`);
  const sw = live.reduce((a, r) => a + r.switchers, 0);
  console.log(`room-switchers, all nights    : ${sw}` +
    (sw === 0 ? '   ← nobody has ever moved between rooms; the slate is unproven from the player side' : ''));
  console.log('');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
