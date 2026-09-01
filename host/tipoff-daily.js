#!/usr/bin/env node
/* =====================================================================
   THE TIP-OFF DRAFTS ITSELF, EVERY GAME NIGHT.
   ---------------------------------------------------------------------
   31 Aug 2026. Founder: "Where's the email for today?"

   There wasn't one. Arsenal kicked off at 12:00 PM PT with ten
   subscribers who were never told. Both guards worked perfectly — at
   09:28 check-draft.js logged "NO DRAFT. 1 room(s) are on tonight's
   slate and nothing was drafted at 09:13. Nobody will be told there is a
   game", and at 09:35 and 10:45 send-tipoff-auto.js refused twice rather
   than send Saturday's. The alarm rang and nobody was reading the log.

   THE CAUSE WAS ONE CRON LINE:

       26 9 29 8 *  tipoff-ensure.js  .../tipoff-2026-08-29.html  --apply

   Day-of-month 29, month 8, pointed at a file with a date baked into its
   name. It fired once on Saturday and would not fire again this year.
   The two daily jobs around it — check-draft and tipoff-verify — only
   WATCH for a draft. Nothing on this box made one.

   So this is the recurring half, and it generates its own dated file.

   ============ WHAT IT WILL AND WILL NOT DO =========================
   build-tipoff.js says it plainly: "This file assembles; it does not
   compose." EMAIL-VOICE.md governs words and a machine that writes its
   own copy every morning drifts toward whatever was wrong last. That
   rule is kept:

     copy file exists   the approved edition is built and drafted. This
                        is the normal path and nothing about it changed.
     copy file missing  a SCHEDULE-ONLY note is drafted — the rooms, the
                        times, the channel, and a link. No headline
                        claims, no figures, no question, because nobody
                        wrote any. It says so on its face.

   The fallback is not a nice-to-have. tipoff-ensure.js already argues
   the case for its own 0-draft branch: "a missing email is the failure
   that actually costs a night." A note that says only "Arsenal at Villa
   Park, 12:00 PM PT, here is the room" is worth more than silence, and
   it cannot say anything false because it only repeats the slate.

   IT NEVER SENDS. send-tipoff-auto.js does that, later, and it does its
   own verification. This ends with exactly one draft.

       node host/tipoff-daily.js [--apply]
   ================================================================== */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const APPLY = process.argv.includes('--apply');
const HOME = process.env.HOME;
const LOGDIR = path.join(HOME, 'gamenight-logs');
const HOST = __dirname;
const NODE = process.execPath;

function log(m) {
  const line = new Date().toISOString() + '  ' + m;
  console.log(line);
  try { fs.appendFileSync(path.join(LOGDIR, 'tipoff-daily.log'), line + '\n'); } catch (_) {}
}

/* PT, not UTC and not the box's guess. Every date in this project is a
   fact to be checked, and a tip-off that runs on the wrong day is the
   same bug as a stale "tonight". */
function todayPT() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}
function weekdayPT() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'long'
  }).format(new Date());
}

/* TIPOFF_DATE overrides the day, for testing only. A guard nobody has
   watched fire is not a guard: without this the Sunday branch and the
   empty-slate branch could only be reasoned about, never observed. It is
   never set in cron. */
const DATE = process.env.TIPOFF_DATE || todayPT();
const DAY = process.env.TIPOFF_DATE
  ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' })
      .format(new Date(process.env.TIPOFF_DATE + 'T12:00:00Z'))
  : weekdayPT();
log('=== tipoff-daily starting' + (APPLY ? ' (APPLY)' : ' (dry run)') + ' ===');
log('today (PT) = ' + DATE + ' · ' + DAY);

/* Sunday belongs to the weekly note. Same rule send-tipoff-auto.js and
   check-draft.js already keep — three jobs must not disagree about it. */
if (DAY === 'Sunday') {
  log('SKIP: Sunday belongs to the weekly note, not the tip-off (EMAIL-VOICE.md section 8).');
  process.exit(0);
}

/* ---- is there a game at all? ------------------------------------- */
const PROJECT = 'stats-gametime';
const KEY = 'AIzaSyB1g4u3L85sks1Phjz_Tim98urv1-IZBps'; // public web key, same as build-tipoff
async function slate() {
  const url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT
    + '/databases/(default)/documents/slate/' + DATE + '?key=' + KEY;
  const r = await fetch(url);
  if (!r.ok) return null;
  const d = await r.json();
  const f = (d && d.fields) || {};
  const games = ((f.games && f.games.arrayValue && f.games.arrayValue.values) || []);
  return games;
}

(async () => {
  let games = [];
  try { games = (await slate()) || []; }
  catch (e) { log('FATAL: could not read slate/' + DATE + ' — ' + e.message); process.exit(1); }

  if (!games.length) {
    log('SKIP: slate/' + DATE + ' has 0 rooms. No game night, no tip-off.');
    process.exit(0);
  }
  log('slate: ' + games.length + ' room(s) on ' + DATE);

  /* ---- the approved edition, if a person wrote one ---------------- */
  const copyPath = path.join(LOGDIR, 'tipoff-copy-' + DATE + '.json');
  const htmlPath = path.join(LOGDIR, 'tipoff-' + DATE + '.html');
  let approved = fs.existsSync(copyPath);

  if (approved) {
    log('copy: found an approved edition at ' + path.basename(copyPath));
  } else {
    /* ---- the fallback: the slate, and nothing else ---------------- */
    log('copy: NONE for today. Writing a schedule-only note — it repeats the '
      + 'slate and claims nothing, because nobody has written an edition.');
    const n = games.length;
    const fallback = {
      date: DATE,
      when: 'Today',
      signoff: 'kick-off',
      subject: n === 1 ? 'One room today on Stats Gametime'
                       : n + ' rooms today on Stats Gametime',
      headline: n === 1 ? 'One room today.' : n + ' rooms today.',
      paragraphs: [
        'The times and channels are below. Your card locks when the game starts — '
        + 'six picks before it, and the watchlist you set alongside them.',
        'Free to enter, no account needed to play.'
      ],
      buildNote: 'Assembled from tonight’s slate.'
      /* no stats, no question, no settled — nobody wrote them, so this
         note does not pretend to have them. */
    };
    fs.writeFileSync(copyPath, JSON.stringify(fallback, null, 2));
  }

  /* ---- build ------------------------------------------------------ */
  let html;
  try {
    html = execFileSync(NODE, [path.join(HOST, 'build-tipoff.js'), copyPath],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  } catch (e) {
    log('FATAL: build-tipoff failed — ' + (e.stderr || e.message).toString().slice(0, 200));
    process.exit(1);
  }
  fs.writeFileSync(htmlPath, html);
  log('built ' + path.basename(htmlPath) + ' — ' + html.length + ' bytes'
    + (approved ? ' (approved copy)' : ' (schedule-only)'));

  /* ---- shape gate: never draft something malformed ---------------- */
  try {
    execFileSync(NODE, [path.join(HOST, 'email-shape.js'), htmlPath], { encoding: 'utf8' });
    log('shape: passes');
  } catch (e) {
    log('REFUSED: the built email fails email-shape.js. Not drafting a broken note.');
    process.exit(1);
  }

  if (!APPLY) { log('dry run — not touching MailerLite. Re-run with --apply.'); process.exit(0); }

  /* ---- exactly one draft ------------------------------------------ */
  try {
    const out = execFileSync(NODE,
      [path.join(HOST, 'tipoff-ensure.js'), htmlPath, copyPath, '--apply'],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    out.trim().split('\n').forEach((l) => log('  ensure | ' + l.replace(/^\S+\s+/, '')));
  } catch (e) {
    log('FATAL: tipoff-ensure failed — ' + (e.stdout || e.stderr || e.message).toString().slice(0, 300));
    process.exit(1);
  }
  log('DONE. One draft for ' + DATE + '. Nothing was sent.');
})();
