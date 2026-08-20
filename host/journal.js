#!/usr/bin/env node
/* ============ THE DAILY JOURNAL ======================================
   Founder, 20 Aug 2026: "id like to get all the updates and timelines and
   what we worked on and fixed and notes from games and the changes we made
   and project development pipelines and the artifacts... everything that is
   STATS GAMETIME related should be journaled everyday."

   This writes ONE FILE PER DAY into stats/journal/, built from things that
   are already true rather than from anybody's recollection:

     · every commit of that day, with its subject line
     · the build stamps that went live
     · which rooms were on the slate and how many seats each held
     · the game-night logs written or changed that day
     · the QA suites that exist, so coverage is dated

   It writes MARKDOWN INTO THE REPO on purpose. The repo is on GitHub, so
   the journal survives this machine dying — which is the actual reason the
   founder asked for it. Google Drive is the reading copy; git is the
   backup, and it is versioned for free.

   Usage:  node host/journal.js            today
           node host/journal.js 2026-08-19  a specific day
*/

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* Skip flags when looking for the date, or `node host/journal.js --force`
   reads "--force" as the day and exits on the usage line. */
const DATE = process.argv.slice(2).find(a => a[0] !== '-')
          || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) { console.error('usage: node host/journal.js [YYYY-MM-DD]'); process.exit(1); }

const sh = c => { try { return execSync(c, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (_) { return ''; } };
const pretty = new Date(DATE + 'T12:00:00Z').toLocaleDateString('en-US',
  { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/* ---- what shipped ------------------------------------------------- */
const commits = sh(`git log --since="${DATE} 00:00" --until="${DATE} 23:59" --pretty=format:"%h|%s"`)
  .split('\n').filter(Boolean).map(l => { const [h, ...s] = l.split('|'); return { h, s: s.join('|') }; });

/* a build stamp is a commit subject like "kickoff.175 — ..." */
const builds = commits.map(c => (c.s.match(/^([a-z0-9]+\.\d+)\s+—/) || [])[1]).filter(Boolean).reverse();

/* ---- what was written -------------------------------------------- */
const LOGS = path.join(process.env.HOME, 'gamenight-logs');
let notes = [];
try {
  notes = fs.readdirSync(LOGS)
    .filter(f => /\.md$/.test(f))
    .map(f => ({ f, m: fs.statSync(path.join(LOGS, f)).mtime }))
    .filter(x => x.m.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) === DATE)
    .map(x => x.f);
} catch (_) {}

/* ---- how much is checked ------------------------------------------ */
let suites = 0;
try { suites = fs.readdirSync(path.join(ROOT, 'qa')).filter(f => /\.js$/.test(f)).length; } catch (_) {}

/* ---- the night itself, from the database -------------------------- */
async function night() {
  try {
    const { initializeApp, cert } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    const KEY = process.env.HOME + '/.secrets/stats-firebase-admin.json';
    if (!fs.existsSync(KEY)) return null;
    try { initializeApp({ credential: cert(require(KEY)) }); } catch (_) {}
    const db = getFirestore();
    const s = await db.doc('slate/' + DATE).get();
    if (!s.exists) return { rooms: [] };
    const games = (s.data() || {}).games || [];
    const rooms = [];
    for (const g of games) {
      let seats = 0, rounds = 0;
      try { seats  = (await db.collection('nights').doc(g.nightId).collection('players').count().get()).data().count; } catch (_) {}
      try { rounds = (await db.collection('nights').doc(g.nightId).collection('rounds').count().get()).data().count; } catch (_) {}
      rooms.push({ id: g.nightId, gn: g.gn || '', m: (g.awayAbbr || '?') + ' at ' + (g.homeAbbr || '?'),
                   league: (g.league || '').toUpperCase(), tip: g.tipISO || '', seats, rounds });
    }
    return { rooms };
  } catch (_) { return null; }
}

(async () => {
  const n = await night();
  const L = [];
  L.push('# ' + pretty);
  L.push('');
  L.push('*STATS GAMETIME daily journal. Generated from the commit history, the slate and the');
  L.push('game-night logs — not from recollection. `node host/journal.js ' + DATE + '`*');
  L.push('');
  L.push('| | |');
  L.push('|---|---|');
  L.push('| Commits | **' + commits.length + '** |');
  L.push('| Builds deployed | ' + (builds.length ? '**' + builds.join('** → **') + '**' : '—') + ' |');
  L.push('| Rooms on the slate | ' + (n && n.rooms.length ? '**' + n.rooms.length + '**' : '—') + ' |');
  L.push('| QA suites in the repo | ' + suites + ' |');
  L.push('');

  if (n && n.rooms.length) {
    L.push('## The night');
    L.push('');
    L.push('| Game | Room | Tip | Seats | Rounds |');
    L.push('|---|---|---|---|---|');
    n.rooms.forEach(r => {
      const t = r.tip ? new Date(r.tip).toLocaleTimeString('en-US',
        { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }) + ' PT' : '—';
      L.push('| ' + (r.gn ? '**#' + r.gn + '** ' : '') + r.league + ' | ' + r.m + ' | ' + t +
             ' | ' + r.seats + ' | ' + r.rounds + ' |');
    });
    L.push('');
    const played = n.rooms.filter(r => r.rounds > 0).length;
    L.push(played
      ? '_' + played + ' of ' + n.rooms.length + ' room(s) opened at least one round._'
      : '_No rounds opened yet — this was written before or during the night._');
    L.push('');
  }

  if (commits.length) {
    L.push('## What shipped');
    L.push('');
    commits.slice().reverse().forEach(c => L.push('- `' + c.h + '` ' + c.s));
    L.push('');
  } else {
    L.push('## What shipped');
    L.push('');
    L.push('_Nothing committed on this day._');
    L.push('');
  }

  if (notes.length) {
    L.push('## Notes written today');
    L.push('');
    notes.forEach(f => L.push('- `~/gamenight-logs/' + f + '`'));
    L.push('');
  }

  L.push('## Notes');
  L.push('');
  L.push('_Anything worth keeping that the machine cannot see: what a player said, what felt');
  L.push('wrong, what to try next. Add it here by hand — the generator will never overwrite a');
  L.push('day that already has a file unless you pass --force._');
  L.push('');

  const OUT = path.join(ROOT, 'journal', DATE + '.md');
  if (fs.existsSync(OUT) && !process.argv.includes('--force')) {
    console.log('journal for ' + DATE + ' already exists — not overwriting. Pass --force to replace.');
    console.log('  ' + OUT);
    process.exit(0);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, L.join('\n'));
  console.log('wrote ' + OUT + '  (' + commits.length + ' commits, ' +
              (n && n.rooms.length ? n.rooms.length + ' room(s)' : 'no slate') + ')');
})();
