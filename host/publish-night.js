#!/usr/bin/env node
/* =====================================================================
   Publish a night's CONFIG — the matchup, the roster and the pick sheet —
   from index.html into Firestore.
   ---------------------------------------------------------------------
   THE PROBLEM THIS EXISTS TO END. Tonight's game lives in three consts
   inside index.html: BB_GAME, BB_ROSTER and BB_PREDS. They describe ONE
   night and must be edited together, and nothing enforces that. Game Night
   #9 is what it costs when they drift — the matchup was updated and the
   roster was not, so the app ran perfectly on the wrong players and the
   founder's note was "the stats are the other game not the right game."
   That is B26, and the standing fix has been discipline.

   It also means every game night is a deploy. At roughly fifteen MLB games
   a night that stops being a discipline problem and becomes arithmetic:
   multi-sport means a schedule, not a constant.

       NIGHT_ID=... node host/publish-night.js            # dry run
       NIGHT_ID=... node host/publish-night.js --apply

   Written to `schedule/{nightId}`. This is a SECOND TRANSPORT, not a second
   source: the values still come from index.html, exactly the way
   host/publish.js reads the question bank out of admin.html rather than
   keeping its own copy. Two sources would be the very bug it is fixing.
   ================================================================== */
const admin = require('firebase-admin');
const fs = require('fs'), vm = require('vm'), path = require('path');

const NIGHT = process.env.NIGHT_ID || '';
const APPLY = process.argv.includes('--apply');
const die = (m) => { console.error('FATAL: ' + m); process.exit(1); };
const log = (k, m) => console.log(`  ${String(k).padEnd(7)} ${m}`);

/* ---- 1. lift the three constants out of index.html ------------------ */
function readConfig() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  /* Slice each declaration and evaluate just those, in a sandbox with no
     DOM. Evaluating the whole file is not an option and re-typing the
     values here would recreate the duplication this is meant to remove. */
  const grab = (name, open, close) => {
    const i = src.indexOf(`const ${name}=`);
    if (i < 0) die(`could not find "const ${name}=" in index.html`);
    let d = 0, j = src.indexOf(open, i);
    if (j < 0) die(`could not find the opening ${open} for ${name}`);
    for (let k = j; k < src.length; k++) {
      if (src[k] === open) d++;
      else if (src[k] === close) { d--; if (d === 0) return src.slice(i, k + 1); }
    }
    die(`unbalanced ${open}${close} while reading ${name}`);
  };
  /* Order matters and so does BB_GROUPS: BB_PREDS references it (and the
     roster) when it builds each pick's options, so slicing the three
     "obvious" constants alone fails with "BB_GROUPS is not defined". That
     is itself the point being made — these declarations are one unit. */
  const code = [
    grab('BB_GAME', '{', '}'),
    grab('BB_ROSTER', '{', '}'),
    grab('BB_GROUPS', '[', ']'),
    grab('BB_PREDS', '[', ']')
  ].join(';\n');
  const ctx = vm.createContext({});
  try { vm.runInContext(code, ctx, { timeout: 5000 }); }
  catch (e) { die('the night constants did not evaluate in bare Node: ' + e.message); }
  return vm.runInContext('({BB_GAME:BB_GAME,BB_ROSTER:BB_ROSTER,BB_GROUPS:BB_GROUPS,BB_PREDS:BB_PREDS})', ctx);
}

/* ---- 2. refuse to publish a night that contradicts itself ----------- */
function validate(cfg) {
  const { BB_GAME: g, BB_ROSTER: r, BB_PREDS: p } = cfg;
  const fatal = [];
  if (!g.nightId) fatal.push('BB_GAME has no nightId');
  if (!g.espnEvent) fatal.push('BB_GAME has no espnEvent');
  if (NIGHT && g.nightId !== NIGHT)
    fatal.push(`NIGHT_ID is "${NIGHT}" but index.html carries "${g.nightId}" — one of them is the wrong night`);
  if (!(r.home || []).length || !(r.away || []).length) fatal.push('a roster side is empty');

  /* THE B26 CHECK, AND IT IS THE REASON THIS FILE EXISTS. The three arrays
     describe one night, so every name the pick sheet offers must exist on
     one of tonight's rosters. When BB_GAME moved on and BB_ROSTER did not,
     this is the assertion that would have caught it before tip. */
  const names = new Set([...(r.home || []), ...(r.away || [])]);
  /* Not every pick offers PLAYERS. The winning-team question offers the two
     teams, and the first version of this check flagged it as a roster
     mismatch — the assertion was wrong, not the config. An option is valid
     if it names a player on one of tonight's rosters OR one of tonight's
     two teams. A stale roster still fails, because its player names will
     not be on the new one, which is the case this is here to catch. */
  const teams = new Set([g.homeName, g.awayName, g.homeAbbr, g.awayAbbr, g.homeNick, g.awayNick].filter(Boolean));
  const known = (v) => names.has(v) || teams.has(v);
  (p || []).forEach(q => {
    if (q.answer && !known(q.answer))
      fatal.push(`pick "${q.id}" answers "${q.answer}", who is on neither roster and is not one of tonight's teams — BB_PREDS and BB_ROSTER disagree about which night this is`);
    (q.opts || []).forEach(o => { if (!known(o)) fatal.push(`pick "${q.id}" offers "${o}", who is on neither roster and is not one of tonight's teams`); });
  });
  return fatal;
}

(async () => {
  const cfg = readConfig();
  const g = cfg.BB_GAME;
  log('night', `${g.nightId}  ${g.awayName} @ ${g.homeName}`);
  log('event', `${g.espnEvent}  tip ${g.tipISO || '(unset)'}  ${g.net || ''}`);
  log('roster', `${(cfg.BB_ROSTER.home || []).length} home · ${(cfg.BB_ROSTER.away || []).length} away`);
  log('picks', `${(cfg.BB_PREDS || []).length} question(s)`);

  const fatal = validate(cfg);
  if (fatal.length) { console.error('\npublish blocked —\n  ' + fatal.join('\n  ')); process.exit(1); }
  log('ok', 'the matchup, the roster and the pick sheet all describe the same night');

  const doc = {
    nightId: g.nightId,
    sport: g.sport || 'basketball',
    league: g.league || 'wnba',
    game: g.game || cfg.BB_GAME,
    roster: cfg.BB_ROSTER,
    preds: cfg.BB_PREDS,
    at: admin.firestore.FieldValue.serverTimestamp(),
    by: 'publish-night.js'
  };
  doc.game = cfg.BB_GAME;

  if (!APPLY) {
    console.log(`\n  dry run — would write schedule/${g.nightId} (${JSON.stringify({ game: doc.game, roster: doc.roster, preds: doc.preds }).length} bytes). Nothing written.`);
    process.exit(0);
  }
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) die('FIREBASE_SERVICE_ACCOUNT is not set');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  await admin.firestore().doc(`schedule/${g.nightId}`).set(doc, { merge: true });
  log('key', `published schedule/${g.nightId}`);
  process.exit(0);
})().catch(e => die((e && e.stack) || String(e)));
