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
  const TEMPLATES = sliceConst(src, 'const TEMPLATES = {', 'TEMPLATES');
  if(!Array.isArray(NIGHTS) || !NIGHTS.length) die('NIGHTS did not evaluate to a list');
  if(!BANK || typeof BANK !== 'object') die('BANK did not evaluate to an object');
  if(!TEMPLATES || typeof TEMPLATES !== 'object') die('TEMPLATES did not evaluate to an object');
  return { NIGHTS, BANK, TEMPLATES };
}

/* ---- 2. build the plan, in the Control Room's exact shape ----------

   TWO KINDS OF NIGHT NOW.

   A FLAGSHIP night is written by hand: it has an entry in NIGHTS and a
   bank in BANK, a human chose the questions, and nothing below changes for
   it. That path is byte-for-byte what it was.

   A SLATE night is one of the other games being played tonight. Nobody
   writes it a bank, because writing a bank is exactly the bottleneck that
   kept this product to one room a night while the runner sat idle. It
   takes the per-sport TEMPLATE and substitutes the two team words.

   THE REFUSAL THAT MATTERS: if a {TOKEN} survives substitution it is a
   fatal error, not a warning. An option reading "{HOME}" reaching a
   player's phone is worse than no night at all, and the resolver would
   silently fail to match it — a voided question nobody would report. */
function nickSubst(bank, home, away){
  const swap = (v) => String(v).replace(/\{HOME\}/g, home).replace(/\{AWAY\}/g, away);
  return bank.map(rd => rd.map(q => {
    const c = Object.assign({}, q);
    c.t = swap(c.t);
    c.o = (c.o || []).map(swap);
    /* EVERY LANGUAGE, NOT JUST ENGLISH. A Spanish option reading "{HOME}"
       is exactly as broken as an English one, and it is worse in practice
       because the guard below only ever looked at `t` and `o` — so the
       token sailed through and the Spanish player saw a literal {HOME} on
       a button while the English player saw the team name. Found the first
       time a translated bank was published. */
    Object.keys(c).forEach(k => {
      if(/^t_[a-z]{2}$/.test(k) && typeof c[k] === 'string') c[k] = swap(c[k]);
      else if(/^o_[a-z]{2}$/.test(k) && Array.isArray(c[k])) c[k] = c[k].map(swap);
    });
    return c;
  }));
}

function templateCfg(TEMPLATES){
  const sport = process.env.SPORT || 'basketball';
  const T = TEMPLATES[sport];
  if(!T) die(`no template for sport "${sport}". Known: ` + Object.keys(TEMPLATES).join(', '));
  const home = (process.env.HOME_NICK || '').trim();
  const away = (process.env.AWAY_NICK || '').trim();
  if(!home || !away)
    die(`"${NIGHT}" is not in admin.html's NIGHTS, so it is being built from the ` +
        `${sport} template — which needs HOME_NICK and AWAY_NICK to name the two sides. ` +
        'Neither was set. host/build-slate.js sets both from the scoreboard feed.');
  const cfg = {
    id: NIGHT, away: away, home: home, espn: process.env.ESPN_EVENT || '',
    label: `${away} @ ${home} — from the ${sport} template`,
    tags: T.tags.slice(), names: T.names.slice(), worth: T.worth.slice(),
    periods: (T.periods || []).slice(),
    fromTemplate: sport
  };
  return { cfg, bank: nickSubst(T.rounds, home, away) };
}

function buildPlan(NIGHTS, BANK, TEMPLATES){
  let cfg  = NIGHTS.find(n => n.id === NIGHT);
  let bank = cfg ? BANK[NIGHT] : null;

  if(!cfg || !bank){
    /* A night named in NIGHTS but with no bank is NOT a slate night — it is
       a flagship somebody half-set-up, and quietly templating over it would
       hide the mistake. Say which case this is. */
    if(cfg && !bank)
      log('note', `"${NIGHT}" is in NIGHTS but has no bank — building it from the template instead. ` +
                  'If this was meant to be a hand-written night, that bank is missing.');
    const t = templateCfg(TEMPLATES);
    cfg  = cfg || t.cfg;
    bank = t.bank;
    log('tmpl', `built from the ${t.cfg.fromTemplate} template — ${bank.reduce((a,r)=>a+r.length,0)} questions, ` +
                `home "${t.cfg.home}", away "${t.cfg.away}"`);
  }

  /* No token may survive. */
  const left = [];
  bank.forEach((rd, i) => rd.forEach((q, x) => {
    /* Sweep EVERY language field, not only the English pair. */
    let hay = [q.t].concat(q.o || []);
    Object.keys(q).forEach(k => {
      if(/^t_[a-z]{2}$/.test(k)) hay.push(q[k]);
      else if(/^o_[a-z]{2}$/.test(k) && Array.isArray(q[k])) hay = hay.concat(q[k]);
    });
    hay = hay.join(' | ');
    if(/\{[A-Z]+\}/.test(hay)) left.push(`round ${i+1} Q${x+1}: ${hay}`);
  }));
  if(left.length)
    die('publish blocked — a template token was never substituted:\n  ' + left.join('\n  '));

  /* A TRANSLATED OPTION LIST IS ALL-OR-NOTHING, AND THAT IS CHECKED HERE
     RATHER THAN HOPED FOR. The player falls back to English on a
     length mismatch, so a bad list is not fatal on the phone — but it is a
     bank that LOOKS translated and silently is not, for that one question,
     forever. Say so at publish time, where somebody is watching. */
  const badLen = [];
  bank.forEach((rd, i) => rd.forEach((q, x) => {
    Object.keys(q).forEach(k => {
      const m = /^o_([a-z]{2})$/.exec(k);
      if(!m) return;
      const n = (q.o || []).length, t = Array.isArray(q[k]) ? q[k].length : -1;
      if(t !== n) badLen.push(`round ${i+1} Q${x+1}: ${k} has ${t} option(s), o has ${n} — the whole list will be ignored`);
    });
  }));
  if(badLen.length)
    die('publish blocked — a translated option list does not match its canonical one:\n  ' + badLen.join('\n  '));

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
      /* EVERY t_<lang> / o_<lang> RIDES ALONG. This object literal is the
         fourth place a question gets rebuilt field by field, and B11 was
         exactly one of these lists forgetting `r` — sixteen questions
         published with no resolver while the room said "automated". A
         translation dropped here would be quieter still: the bank would
         publish in English and nothing would error, because a missing
         field looks the same as one nobody set. */
      const out = {
        t: String(q.t || '').trim(),
        o: (q.o || []).map(o => String(o).trim()).filter(Boolean),
        r: q.r ? String(q.r) : '',
        k
      };
      Object.keys(q || {}).forEach(key => {
        if(/^t_[a-z]{2}$/.test(key) && typeof q[key] === 'string')
          out[key] = q[key].trim();
        else if(/^o_[a-z]{2}$/.test(key) && Array.isArray(q[key]))
          out[key] = q[key].map(o => String(o).trim());
      });
      return out;
    });
    /* WHICH PERIOD DOES THIS ROUND ASK ABOUT?
       For basketball the answer is boring and always has been: round 1 is
       Q1, so the runner passes the round index plus one and nobody ever had
       to think about it. Baseball breaks that flat. A round there covers
       THREE innings — after the 3rd, the 6th and the 9th — and mlbSpan(p)
       reads p as the LAST inning of the span. Hand round one a period of 1
       and it resolves against innings -1 to 1: a confident answer about the
       first inning to a question asked about the first three.

       So the period stops being derivable from position and becomes a fact
       the sport declares. It travels ON the round, and run.js falls back to
       index+1 when it is absent — which is every hand-written night, so
       nothing about basketball changes. */
    const r = { tag, name: (cfg.names || [])[i] || tag, worth: (cfg.worth || [])[i] || 10, qs };
    const per = (cfg.periods || [])[i];
    if(per != null) r.p = Number(per);
    return r;
  });

  /* THE OVERTIME ROUND IS A TEMPLATE, NOT A REGULATION ROUND.
     Same split the Control Room's publishPlan() makes, through the SAME
     function — reached out of the shared block via run.js's loadShared()
     rather than re-implemented here. A second copy of "which round is
     overtime" is two chances for this script and the Control Room to
     disagree on a night nobody is watching closely, which is B2 with a
     different hat on. */
  const { loadShared } = require('./run.js');
  const AUTO = loadShared();
  const split = AUTO.splitOtRound(rounds);
  const otConfigured = rounds.filter(r => AUTO.isOtTag(r.tag));

  return { cfg, rounds: split.rounds, ot: split.ot, otConfigured };
}

/* ---- 3. the same refusals the Control Room makes ------------------- */
function validate(cfg, rounds, ot){
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
  /* The overtime template is held to the same per-question rules as any
     round — it just does not hard-stop for being absent. Without this it was
     the one set of questions nobody checked. */
  const toCheck = ot ? rounds.concat([{ tag: 'OT', qs: ot.qs }]) : rounds;
  toCheck.forEach(r => r.qs.forEach((q, x) => {
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
  const { NIGHTS, BANK, TEMPLATES } = loadConstants();
  const { cfg, rounds, ot, otConfigured } = buildPlan(NIGHTS, BANK, TEMPLATES);
  const warn = validate(cfg, rounds, ot);

  const nq = rounds.reduce((a, r) => a + r.qs.length, 0);
  log('plan', `${cfg.label || NIGHT}`);
  rounds.forEach(r => {
    log('round', `${r.tag} · ${r.name} · worth ${r.worth} · ${r.qs.length} question(s)`);
    r.qs.forEach((q, x) => log('  q', `Q${x+1} ${q.r ? '[' + q.r + ']' : (q.k != null ? '[by hand]' : '[NO RESOLVER]')} ${q.t}`));
  });
  warn.forEach(w => log('warn', w));

  if(ot){
    log('ot', `overtime template — ${ot.qs.length} question(s), worth ${ot.worth || 'auto'} · covers OT, OT2 and OT3`);
  } else if(otConfigured.length){
    log('warn', 'an overtime round is configured but has NO questions, so no template will be published. ' +
                'An overtime tonight would open nothing and be flagged for a human.');
  } else {
    /* THE SAME SENTENCE LIVES IN admin.html's publishPlan(). Two copies of
       one piece of advice, and when the advice changed only one of them
       knew — which is this codebase's whole disease, reproduced inside a
       warning about a different bug. Both now say the same thing. */
    /* THE ADVICE HAS TO FIT THE SPORT. This sentence told every night to
       add an 'OT' tag — correct for basketball, and wrong the moment
       baseball started publishing fifteen nights a day, because extras are
       not an overtime round and AUTO.isOtTag does not match 'EXTRAS'. A
       warning that tells you to do something that will not work is worse
       than no warning: it is a confident wrong answer about your own
       build, which is the same failure mode this whole codebase is
       organised against. */
    /* football joined this list on 22 Aug, when the NFL template got an
       OT round (see admin.html, football.tags). Before that the else-branch
       below correctly said football had no template; saying it now would be
       a confident wrong answer about our own build, which is the exact
       thing the paragraph above is about. */
    const otKnown = { basketball:true, hockey:true, football:true };
    const sport = cfg.fromTemplate || 'basketball';
    /* SOCCER WAS IN THIS LIST AND SHOULD NOT HAVE BEEN, for the same
       reason baseball was taken out of it. The advice below — "adding 'OT'
       to this night's tags is the fix" — is correct for basketball and
       hockey, where any tied game goes to an extra period.

       League football is not that. An MLS regular-season match that is
       level at ninety minutes is a draw and ends; there is no extra time
       to answer questions about. Every night on soccer/usa.1 was being
       told to add a round that could never open, on every publish.

       Extra time does exist in knockout football, so this is not "soccer
       has no overtime" — it is that the competition decides, and the
       publisher does not know the competition. So it says what it knows.
       The paragraph above is the standing rule here: a warning that tells
       you to do something that will not work is worse than no warning. */
    if(sport === 'soccer'){
      log('note', `no extra-period round for ${NIGHT}. A LEAGUE match that is level at ` +
                  'full time is a draw and simply ends, so there is nothing more to answer ' +
                  "and that is correct. If this night is a KNOCKOUT tie, extra time is real " +
                  "and an 'OT'-tagged round is the fix — check the competition before adding one.");
    } else if(otKnown[sport]){
      log('warn', `no overtime round configured for ${NIGHT}, so an overtime would be played with nothing ` +
                  `to answer. Adding 'OT' to this night's tags is now safe and is the fix — but only on ` +
                  'player build .129 or later, which is the first one that can receive a fifth round. ' +
                  'On anything earlier the round opens, scores, and reaches nobody.');
    } else {
      log('note', `no extra-period round for ${NIGHT}. ${sport} does not have an OT-tagged template yet — ` +
                  'a game that runs past regulation simply has nothing more to answer, which is honest. ' +
                  'Do not add one by tagging a round "EXTRAS": AUTO.isOtTag would not match it and it ' +
                  'would publish as regulation and open on every game.');
    }
  }
  if(DRY){ log('dry', `would publish ${rounds.length} rounds, ${nq} questions` +
                      (ot ? ` + an overtime template of ${ot.qs.length}` : ' and NO overtime template') +
                      ' — nothing written'); return; }

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
      /* ============ OUR OWN STALE OUTPUT IS NOT A CONTROL ROOM EDIT ====
         This guard exists to protect edits a HUMAN made in the Control
         Room, which this script cannot see. It was also protecting the
         plan THIS SCRIPT wrote days earlier — and the doc records `by`,
         so the two were always distinguishable.

         2 Sept 2026: nights are built days ahead, so slate-2026-09-02
         carried a plan published on 31 Aug — three rounds of three
         innings, from before the every-inning rule landed. run.js builds
         nine per-inning rounds correctly and then deferred to that stale
         plan, every night, forever. The founder got "Innings 7-9 is
         open" in the FOURTH, asking about innings nobody had played, and
         the night ran out of rounds by the 3rd. THIS is the mechanism
         behind the every-inning rule "reverting" repeatedly.

         A human's plan still wins outright. Ours only yields when the
         SHAPE has changed, so a plan that still matches the bank is left
         alone and this stays a no-op on a normal night. */
      const oursAlready = /^publish\.js/.test(String(d.by || ''));
      const shapeChanged = (d.rounds || []).length !== rounds.length;
      if(oursAlready && shapeChanged){
        log('plan', `REFRESHING OUR OWN STALE PLAN for ${WRITE_AS} (${who}) — ` +
                    `the bank now says ${rounds.length} rounds, not ${(d.rounds||[]).length}`);
        /* fall through and write it */
      } else {
        log('plan', `already published for ${WRITE_AS} (${who}) — leaving it alone, it wins`);
        log('done', 'nothing to do');
        return;
      }
    } else {
      die(`a plan is already published for ${WRITE_AS} (${who}). ` +
          'It may contain Control Room edits this script cannot see. Use --force to overwrite it.');
    }
  }

  const planDoc = {
    rounds,
    at: admin.firestore.FieldValue.serverTimestamp(),
    by: 'publish.js · ' + (creds.client_email || 'service account')
  };
  /* Absent is a legitimate value. A night with no overtime questions simply
     has no template, and run.js writes needsHuman if overtime then happens
     rather than opening an empty round or skipping it in silence. */
  if(ot) planDoc.ot = ot;
  await ref.set(planDoc);
  log('key', `plan published — ${rounds.length} rounds, ${nq} questions` +
             (ot ? ` + overtime template (${ot.qs.length})` : ' · NO overtime template') +
             (warn.length ? ` · ${warn.length} will need a human` : ' · every line has a resolver'));
  log('done', 'the runner can take it from here');
}

if(require.main === module) main().catch(e => die((e && e.stack) || String(e)));
else module.exports = { loadConstants, buildPlan, validate };
