#!/usr/bin/env node
/* =====================================================================
   STATS GAMETIME — PUBLISH THE PLAN, WITHOUT A BROWSER
   ---------------------------------------------------------------------
   `host/run.js` refuses to start until `nights/{id}/plan/rounds` exists,
   and until now only the Control Room could write it. That left exactly
   one button between a night and running itself.

   WHY THIS IS NOT A SECOND COPY OF THE BANK. It reads `NIGHTS` and `BANK`
   out of admin.html, exactly the way run.js reads the resolvers out of it.
   admin.html stays the one owner of what the questions are; this is a
   second TRANSPORT, not a second source. If the constants move, this exits
   non-zero rather than publishing something it made up.

   WHAT IT CANNOT SEE, AND WHY THAT MATTERS. The Control Room's publish
   reads `nightDraft()`, which lives in that browser's localStorage. A
   question the host TYPED — rather than one seeded from the bank — exists
   only there. This script publishes the bank as written. That is correct
   for a night set up in advance (which is the whole point of setting one
   up in advance) and wrong for a night edited by hand in the Control Room.

   So it refuses to overwrite an existing plan unless told to. If the
   Control Room published first, the Control Room wins — its version is the
   one with the human's edits in it.

     node host/publish.js                 # publish, refusing to clobber
     node host/publish.js --dry-run       # print exactly what it would write
     node host/publish.js --force         # overwrite an existing plan
   ================================================================== */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const NIGHT = process.env.NIGHT_ID || '';
const DRY   = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
/* "Publish only if nobody has" — the launcher's mode. A plan that is already
   there is a SUCCESS for that caller, not a failure: it means the Control
   Room (or an earlier run) got there first, and its version wins. Without
   this the launcher treated "already published" as fatal and refused to
   start the runner, which would have turned publishing early into a night
   that never began. */
const IF_MISSING = process.argv.includes('--if-missing');
/* Read a real night's config and bank, but write the plan somewhere else.
   The rehearsal SETUP.md asks for — a full night against a finished game —
   needs a night id no player is sitting in, and "point it at Wednesday's
   game" writes to Wednesday's real room otherwise. */
const WRITE_AS = process.env.WRITE_AS || NIGHT;

const log = (kind, msg) =>
  console.log(`${new Date().toISOString().slice(11,19)}  ${kind.padEnd(6)}  ${msg}`);
const die = (msg) => { console.error('FATAL: ' + msg); process.exit(1); };

/* ---- 1. the constants, read from their owner ----------------------- */
function sliceConst(src, decl, name){
  const s = src.indexOf(decl);
  if(s < 0) die(`${decl} not found in admin.html — refusing to guess at the plan`);
  const open = src.indexOf(decl.endsWith('[') ? '[' : '{', s);
  const openCh = src[open], closeCh = openCh === '[' ? ']' : '}';
  let depth = 0, end = -1;
  for(let j = open; j < src.length; j++){
    const c = src[j];
    if(c === openCh) depth++;
    else if(c === closeCh){ depth--; if(depth === 0){ end = j + 1; break; } }
  }
  if(end < 0) die(`could not find the end of ${name} in admin.html`);
  const sb = {}; vm.createContext(sb);
  /* A top-level `const` never becomes a property of the sandbox — B3, the
     same trap that made a safety net which had never once fired. Take the
     completion value instead of reading it back off the context. */
  return vm.runInContext(src.slice(s, end) + `\n;${name};`, sb, { timeout: 5000 });
}

function loadConstants(){
  const file = path.join(__dirname, '..', 'admin.html');
  if(!fs.existsSync(file)) die('admin.html not found at ' + file);
  const src = fs.readFileSync(file, 'utf8');
  const NIGHTS = sliceConst(src, 'const NIGHTS = [', 'NIGHTS');
  const BANK   = sliceConst(src, 'const BANK = {',   'BANK');
  if(!Array.isArray(NIGHTS) || !NIGHTS.length) die('NIGHTS did not evaluate to a list');
  if(!BANK || typeof BANK !== 'object') die('BANK did not evaluate to an object');
  return { NIGHTS, BANK };
}

/* ---- 2. build the plan, in the Control Room's exact shape ---------- */
function buildPlan(NIGHTS, BANK){
  const cfg = NIGHTS.find(n => n.id === NIGHT);
  if(!cfg) die(`no night called "${NIGHT}" in admin.html's NIGHTS. Known: ` +
               NIGHTS.slice(0,4).map(n => n.id).join(', ') + ' …');
  const bank = BANK[NIGHT];
  if(!bank) die(`no question bank for "${NIGHT}" in admin.html's BANK. ` +
                'The Control Room would have nothing to seed from either.');

  const rounds = (cfg.tags || []).map((tag, i) => {
    const qs = (bank[i] || []).map(q => {
      /* k is the ANSWER TEXT, not an index — publishPlan() resolves the
         index through q.o before writing, because "indexes do not survive
         the filter". A bank that stores an index must be converted the
         same way or the runner keys an off-by-one. */
      let k = null;
      if(q.k != null){
        k = (typeof q.k === 'number')
          ? String((q.o || [])[q.k] == null ? '' : (q.o || [])[q.k]).trim()
          : String(q.k).trim();
        if(!k) k = null;
      }
      return {
        t: String(q.t || '').trim(),
        o: (q.o || []).map(o => String(o).trim()).filter(Boolean),
        r: q.r ? String(q.r) : '',
        k
      };
    });
    return { tag, name: (cfg.names || [])[i] || tag, worth: (cfg.worth || [])[i] || 10, qs };
  });

  return { cfg, rounds };
}

/* ---- 3. the same refusals the Control Room makes ------------------- */
function validate(cfg, rounds){
  /* B28, GN9. publishPlan() validated individual questions and never
     noticed a round with NONE, so "4 rounds, 0 questions" published as a
     routine status line and three real players sat looking at a live round
     with nothing in it. A round the runner opens and scores points for,
     with nothing to earn them from, is strictly worse than not opening it. */
  const empty = [];
  rounds.forEach((r, i) => { if(!r.qs.length) empty.push(r.tag || ('round ' + (i+1))); });
  if(empty.length)
    die(`publish blocked — ${empty.join(', ')} ${empty.length===1?'has':'have'} zero questions. ` +
        'The runner will not invent them.');

  const fatal = [], warn = [];
  rounds.forEach(r => r.qs.forEach((q, x) => {
    if(!q.t)            fatal.push(`${r.tag} Q${x+1} has no question text`);
    if(q.o.length < 2)  fatal.push(`${r.tag} Q${x+1} has fewer than two options`);
    if(!q.r && q.k == null)
      warn.push(`${r.tag} Q${x+1} has no resolver and no answer — it will void unless a human sets it`);
  }));
  if(fatal.length) die('publish blocked —\n  ' + fatal.join('\n  '));
  return warn;
}

/* ---- 4. write it -------------------------------------------------- */
async function main(){
  if(!NIGHT) die('NIGHT_ID is not set');
  const { NIGHTS, BANK } = loadConstants();
  const { cfg, rounds } = buildPlan(NIGHTS, BANK);
  const warn = validate(cfg, rounds);

  const nq = rounds.reduce((a, r) => a + r.qs.length, 0);
  log('plan', `${cfg.label || NIGHT}`);
  rounds.forEach(r => {
    log('round', `${r.tag} · ${r.name} · worth ${r.worth} · ${r.qs.length} question(s)`);
    r.qs.forEach((q, x) => log('  q', `Q${x+1} ${q.r ? '[' + q.r + ']' : (q.k != null ? '[by hand]' : '[NO RESOLVER]')} ${q.t}`));
  });
  warn.forEach(w => log('warn', w));

  if(DRY){ log('dry', `would publish ${rounds.length} rounds, ${nq} questions — nothing written`); return; }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if(!raw) die('FIREBASE_SERVICE_ACCOUNT is not set. See host/MACHINE-SETUP.md.');
  let creds; try{ creds = JSON.parse(raw); }catch(_){ die('FIREBASE_SERVICE_ACCOUNT is not valid JSON'); }
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(creds) });
  const db = admin.firestore();
  const ref = db.doc(`nights/${WRITE_AS}/plan/rounds`);
  if(WRITE_AS !== NIGHT) log('note', `writing ${NIGHT}'s plan to ${WRITE_AS} — rehearsal target, not the real room`);

  /* The Control Room's plan carries edits this script cannot see. If one
     is already there, it outranks the bank. */
  const existing = await ref.get();
  if(existing.exists && !FORCE){
    const d = existing.data() || {};
    const who = `${(d.rounds||[]).length} rounds, by ${d.by || 'unknown'}`;
    if(IF_MISSING){
      log('plan', `already published for ${WRITE_AS} (${who}) — leaving it alone, it wins`);
      log('done', 'nothing to do');
      return;
    }
    die(`a plan is already published for ${WRITE_AS} (${who}). ` +
        'It may contain Control Room edits this script cannot see. Use --force to overwrite it.');
  }

  await ref.set({
    rounds,
    at: admin.firestore.FieldValue.serverTimestamp(),
    by: 'publish.js · ' + (creds.client_email || 'service account')
  });
  log('key', `plan published — ${rounds.length} rounds, ${nq} questions` +
             (warn.length ? ` · ${warn.length} will need a human` : ' · every line has a resolver'));
  log('done', 'the runner can take it from here');
}

if(require.main === module) main().catch(e => die((e && e.stack) || String(e)));
else module.exports = { loadConstants, buildPlan, validate };
