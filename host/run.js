#!/usr/bin/env node
/* =====================================================================
   STATS GAMETIME — THE AUTONOMOUS HOST, SERVER SIDE
   ---------------------------------------------------------------------
   "Why does the laptop have to be open when the game is running through
   the automation. It should be able to do it on its own. Sometimes the
   laptop sleeps and the phone locks."

   Correct, and the browser version was always a staging post. This is the
   same loop with no tab under it: a GitHub Action starts it before tip, it
   runs for the length of a game, and it needs nothing on anybody's desk.

   WHAT IT DOES, once every 20 seconds:

     a quarter has finished        -> push that round to every phone
     the room has answered, or
       the answer window ran out   -> resolve all four from the ESPN feed
     all four resolved             -> post the key, which scores the room
     any one of them did not       -> leave the round open and say so

   AND THE RULE THAT OUTRANKS ALL OF THEM: it does not guess. A key that is
   right about three questions and invented about the fourth marks every
   player wrong while looking, on every screen, exactly like a key that was
   correct. A missing score is a bad night; a confidently wrong one is the
   end of being believed.

   ---------------------------------------------------------------------
   WHERE THE RESOLVERS COME FROM, AND WHY NOT FROM HERE

   They are not in this file. They are read out of `admin.html`, between
   the `@host-shared` sentinels, and evaluated.

   That looks like a hack and it is the opposite. Sixteen resolvers copied
   into a server script would be sixteen chances for the Control Room and
   the runner to answer the same question differently on the same night,
   discovered — if ever — by a player whose score disagreed with itself.
   This product spent a week learning that every serious bug it has had was
   one fact stored in two places. Shipping the fix as a second copy of the
   engine would have been a joke at our own expense.

   One copy. If the sentinels move, this exits non-zero at startup instead
   of running a night with no answers in it.
   ================================================================== */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const NIGHT   = process.env.NIGHT_ID   || '';
const EVENT   = process.env.ESPN_EVENT || '';
const MINUTES = Number(process.env.RUN_MINUTES || 240);
const SPORT   = process.env.SPORT_PATH || 'basketball/wnba';
const ANSWER_MS = Number(process.env.ANSWER_MS || 150000);   // 2m30
const GRACE_MS  = Number(process.env.GRACE_MS  || 20000);
const TICK_MS   = Number(process.env.TICK_MS   || 20000);

/* The lease. Two hosts against one night both call AUTO.tally and race to
   post keys — the worst failure this system has, and until now the only one
   prevented by remembering rather than by code. The heartbeat was already
   being written every tick; nothing ever read it. Now it is a claim. */
const HOST_ID    = `${process.env.HOST_NAME || 'runner'}-${process.pid}-${Date.now().toString(36)}`;
const LEASE_MS   = Number(process.env.LEASE_MS || 60000);
const LEASE_FORCE = process.env.HOST_FORCE === '1';

const log = (kind, msg) =>
  console.log(`${new Date().toISOString().slice(11,19)}  ${kind.padEnd(6)}  ${msg}`);
const die = (msg) => { console.error('FATAL: ' + msg); process.exit(1); };

/* ---- 1. the one copy of the resolver engine ------------------------ */
function loadShared(){
  const file = path.join(__dirname, '..', 'admin.html');
  if(!fs.existsSync(file)) die('admin.html not found at ' + file);
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('/* @host-shared:start');
  const b = src.indexOf('/* @host-shared:end */');
  if(a < 0 || b < 0 || b <= a)
    die('the @host-shared sentinels are missing from admin.html — refusing to run a night with no resolvers');
  const code = src.slice(a, b);
  const sandbox = { console, fetch, Math, Date, Number, String, Array, Object, JSON, RegExp, isFinite, parseInt, parseFloat };
  sandbox.global = sandbox;
  try{ vm.createContext(sandbox); vm.runInContext(code + '\n;AUTO;', sandbox, { timeout: 5000 }); }
  catch(e){ die('the shared block did not evaluate in Node: ' + e.message +
                '\n(no document/window allowed between the sentinels)'); }
  const AUTO = sandbox.AUTO;
  if(!AUTO || typeof AUTO.resolve !== 'function' || typeof AUTO.periodDone !== 'function')
    die('the shared block evaluated but produced no usable AUTO');
  log('boot', `resolver engine loaded from admin.html (${Object.keys(AUTO.R || {}).length} resolvers)`);
  return AUTO;
}

/* ---- 2. Firestore, as the host ------------------------------------- */
function loadDb(){
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if(!raw) die('FIREBASE_SERVICE_ACCOUNT is not set. See host/SETUP.md — this is the one thing that cannot be committed.');
  let creds; try{ creds = JSON.parse(raw); }catch(e){ die('FIREBASE_SERVICE_ACCOUNT is not valid JSON'); }
  const admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(creds) });
  return { db: admin.firestore(), FieldValue: admin.firestore.FieldValue };
}

/* ---- 3. the night's questions, read from the room ------------------
   NOT from a bank in this repo. The Control Room already writes the exact
   questions it pushed into the round document, and a runner that carried
   its own copy of the bank could open a round asking different questions
   from the ones the phones were shown — which is precisely what happened
   to a player on Game Night #7 and cost him the night. The room is the
   source. Where a round has not been pushed yet, the bank comes from the
   night's draft document, which the Control Room publishes for exactly
   this purpose. */
async function readPlan(db){
  const snap = await db.doc(`nights/${NIGHT}/plan/rounds`).get();
  if(!snap.exists)
    die(`nights/${NIGHT}/plan/rounds is missing. Open the Control Room once and press "Publish tonight's plan" — the runner will not invent questions.`);
  const plan = snap.data();
  if(!Array.isArray(plan.rounds) || !plan.rounds.length) die('the published plan has no rounds in it');
  return plan;
}

/* ---- 3b. the lease --------------------------------------------------
   Claimed at boot and renewed on every tick. A second runner started
   against the same night exits at startup with the incumbent named,
   rather than quietly doubling every write for the rest of the game.

   A lease that cannot be broken is its own outage, so it expires: a host
   that has not renewed for LEASE_MS is treated as dead and can be taken
   over. That is the correct default, because the common case is a crashed
   runner being restarted, not two live ones. HOST_FORCE=1 overrides for
   the case where you know better. */
async function claimLease(db, FieldValue){
  const ref = db.doc(`nights/${NIGHT}`);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const h = (snap.exists && snap.data().host) || null;
    if(h && h.id && h.id !== HOST_ID && !LEASE_FORCE){
      const at = h.at && h.at.toMillis ? h.at.toMillis() : 0;
      const age = at ? (Date.now() - at) : Infinity;
      if(age < LEASE_MS)
        throw new Error(
          `another host holds this night: ${h.id} (${h.where || '?'}), last seen ` +
          `${Math.round(age/1000)}s ago. Stop it before starting this one — two hosts ` +
          `race on AUTO.tally and post conflicting keys. Override with HOST_FORCE=1.`);
    }
    tx.set(ref, { host: { auto:true, where:'runner', id:HOST_ID,
                          at: FieldValue.serverTimestamp() } }, { merge:true });
    return true;
  });
}

/* ---- 4. the live score ----------------------------------------------
   The last thing that needed a browser tab open. Everything above this was
   about the ROUNDS — opening them, closing them, keying them — and while
   that moved to the server the score on every phone was still being written
   by a laptop in somebody's kitchen.

   That was the whole complaint. "Sometimes the laptop sleeps and the phone
   locks." A night whose quarters open by themselves but whose scoreboard
   freezes when a lid closes is not automated, it is automated in the half
   nobody notices.

   Identical shape to writeScore() in the Control Room, deliberately: the
   phones already read `nights/{id}.score` and neither they nor the Control
   Room can tell which machine wrote it. Two writers, one document, one
   shape — and because it is a whole-object merge rather than a set of
   fields, the last writer wins cleanly instead of leaving a half-updated
   score behind. */
function periodLabel(sum, plan){
  try{
    const st = sum.header.competitions[0].status;
    const state = (st.type && st.type.state) || '';
    if(state === 'post') return 'Final';
    /* Before tip there is no period to name, and this matters more than it
       looks: the runner starts half an hour early on purpose, and the first
       version of this function read period 0, fell through to rounds[0] and
       would have put "0 — 0 · Q1 in progress" on every phone in the room
       thirty minutes before anybody tipped off. An empty label means "say
       nothing", and saying nothing is correct until the ball is up. */
    if(state !== 'in') return '';
    const per = Number(st.period) || 0;
    /* Overtime runs off the end of the plan. The old Control Room version
       fell back to the first tag here, which would have put "Q1 in
       progress" on every phone during the most exciting five minutes of
       the night. There is no fifth round to play, but the scoreboard still
       has to tell the truth about where the game is. */
    if(per > plan.rounds.length) return (per - plan.rounds.length > 1 ? 'OT' + (per - plan.rounds.length) : 'OT') + ' in progress';
    const tag = per >= 1 && plan.rounds[per - 1] ? plan.rounds[per - 1].tag : (plan.rounds[0] || {}).tag;
    return (tag || 'Q1') + ' in progress';
  }catch(_){ return ''; }
}

async function writeLiveScore(db, FieldValue, sum, plan, last){
  const label = periodLabel(sum, plan);
  /* No label means the game has not started, or the feed came back in a
     shape this cannot read. Either way the honest move is to leave the
     score document alone rather than overwrite it with a guess. */
  if(!label) return last;

  let away = null, home = null;
  try{
    const cs = sum.header.competitions[0].competitors || [];
    const h = cs.find(c => c.homeAway === 'home') || {};
    const a = cs.find(c => c.homeAway === 'away') || {};
    /* Number('') is 0, not NaN — so a feed with an empty score field would
       sail past isFinite() and post a 0 — 0 that looks exactly like a real
       one. Require digits before believing anything. */
    const digits = v => /^\d+$/.test(String(v == null ? '' : v).trim());
    if(!digits(h.score) || !digits(a.score)) return last;
    home = Number(h.score); away = Number(a.score);
  }catch(_){ return last; }
  if(!isFinite(home) || !isFinite(away)) return last;

  const sig = away + '-' + home + '|' + label;
  /* Only write when something actually changed. A basketball game is about
     two hundred ticks long and most of them are the same score as the one
     before; writing every time would be two hundred writes a night for
     maybe sixty real changes, on a free tier, for no benefit to anybody. */
  if(sig === last) return last;

  await db.doc(`nights/${NIGHT}`).set({
    score: { away, home, period: label, note: '', at: FieldValue.serverTimestamp() }
  }, { merge: true });
  log('score', `${away} — ${home}  ${label}`);
  return sig;
}

/* ---- 5. scoring the room --------------------------------------------
   The runner posts keys. Until now, nothing then turned those keys into
   scores unless a human pressed Reveal in the Control Room — so a fully
   automated night would have opened every quarter, keyed every question,
   and left every player on zero. The automation was complete right up to
   the part players can see.

   The arithmetic is NOT in this file. It is `AUTO.tally`, read out of
   admin.html between the @host-shared sentinels, exactly like the sixteen
   resolvers. The Control Room fetches with the web SDK and this fetches
   with the Admin SDK, and both hand identical shapes to the same function.
   A score that came out differently depending on which machine was awake
   would be Game Night #7's question-bank bug wearing a new hat.

   WHAT THIS DOES NOT OWN: predPts and catchPts come off the player
   document, because predictions settle on the phone and Caught It resolves
   there. Round points are now unforgeable. Those two lanes are still
   client-reported and bounded only by the security rules. Said plainly
   here so nobody reads "the server scores it" and believes more than is
   true. */
async function scoreRoom(db, FieldValue, AUTO){
  const roundsSnap = await db.collection(`nights/${NIGHT}/rounds`).get();
  const scored = [];
  roundsSnap.forEach(d => {
    const r = d.data() || {};
    if(r.state === 'scored' && Array.isArray(r.key) && r.key.length){
      scored.push({ id: d.id, key: r.key, worth: (typeof r.worth === 'number' && r.worth > 0) ? r.worth : 1 });
    }
  });
  if(!scored.length) return 0;

  const playersSnap = await db.collection(`nights/${NIGHT}/players`).get();
  const players = {};
  playersSnap.forEach(d => {
    const v = d.data() || {};
    players[d.id] = { predPts: typeof v.predPts === 'number' ? v.predPts : 0,
                      catchPts: typeof v.catchPts === 'number' ? v.catchPts : 0,
                      caughtPts: typeof v.caughtPts === 'number' ? v.caughtPts : 0 };
  });
  if(!Object.keys(players).length) return 0;

  const subs = {};
  for(const rd of scored){
    const ss = await db.collection(`nights/${NIGHT}/rounds/${rd.id}/subs`).get();
    subs[rd.id] = {};
    ss.forEach(d => {
      const v = d.data() || {};
      subs[rd.id][d.id] = { picks: Array.isArray(v.picks) ? v.picks : [],
                            banks: Array.isArray(v.banks) ? v.banks : [] };
    });
  }

  const t = AUTO.tally(scored, players, subs);

  /* Recomputed from the submissions every time rather than added to, so
     running it twice cannot double anybody's score. That is the same
     property the Control Room's version has and it is why this is safe to
     call after every key. */
  let n = 0;
  for(const uid of Object.keys(t)){
    const row = t[uid];
    await db.doc(`nights/${NIGHT}/players/${uid}`).set({
      pts: row.pts, speed: row.speed, roundsDone: row.rounds,
      lastScoredBy: 'runner', lastScoredAt: FieldValue.serverTimestamp()
    }, { merge: true });
    n++;
  }
  log('score', `${n} player${n===1?'':'s'} scored from ${scored.length} round${scored.length===1?'':'s'}`);
  return n;
}

/* ---- 6. the night, kept ---------------------------------------------
   Eight nights have been played and the room's answers survive for none of
   them: zero rounds, zero submissions, across gn5 through gn8. Only the
   player rows are left, which is why a score from Wednesday is still
   readable and the answers behind it are not.

   The Control Room grew a save button this afternoon, and its reset now
   copies everything before it wipes anything. Both of those are real fixes
   and both of them still end in a person remembering. The founder named the
   problem more precisely than that:

     "me as the human might be pressing something wrong, or if its someone
      else they might do it."

   A safeguard that depends on nobody making a mistake is not a safeguard,
   and the mistake does not have to be pressing the wrong button — it can
   just as easily be pressing nothing at all and getting on with the night.
   So the runner saves the night itself: after every quarter it keys, at the
   buzzer, and again if the window closes on a game that never finished. No
   tab, no laptop, nobody remembering.

   Raw picks, not summaries. The question this data will be asked in six
   months is not the question anyone would think to compute tonight, and a
   tally cannot be un-tallied. */
async function archiveNight(db, FieldValue, why){
  const rounds = [], subs = {};
  const rs = await db.collection(`nights/${NIGHT}/rounds`).get();
  for(const d of rs.docs){
    const r = d.data() || {};
    rounds.push({ id: d.id, idx: r.idx == null ? null : r.idx, tag: r.tag || '',
                  name: r.name || '', worth: r.worth == null ? null : r.worth,
                  state: r.state || '', key: Array.isArray(r.key) ? r.key : null,
                  questions: (r.questions || []).map(q => ({ t: q.t || '', o: q.o || [] })) });
    const ss = await db.collection(`nights/${NIGHT}/rounds/${d.id}/subs`).get();
    subs[d.id] = ss.docs.map(x => { const v = x.data() || {};
      return { uid: x.id, picks: Array.isArray(v.picks) ? v.picks : [],
               banks: Array.isArray(v.banks) ? v.banks : [] }; });
  }

  const players = [];
  (await db.collection(`nights/${NIGHT}/players`).get()).forEach(d => { const v = d.data() || {};
    players.push({ uid: d.id, name: v.name || '', pts: v.pts || 0, speed: v.speed || 0,
                   predPts: v.predPts || 0, catchPts: v.catchPts || 0,
                   caughtPts: v.caughtPts || 0, roundsDone: v.roundsDone || 0 }); });

  const callit = [];
  (await db.collection(`nights/${NIGHT}/callit`).get()).forEach(d => { const v = d.data() || {};
    callit.push({ qid: d.id, text: v.text || v.q || '', ans: v.ans != null ? v.ans : null,
                  state: v.state || '' }); });

  const body = { night: NIGHT, why: why || 'runner', by: 'runner',
                 counts: { rounds: rounds.length,
                           subs: Object.keys(subs).reduce((a, k) => a + subs[k].length, 0),
                           players: players.length, callit: callit.length },
                 rounds, subs, players, callit };

  /* A document has a megabyte in it and a night of four rounds is nowhere
     near that, but a silent truncation would be worse than a refusal. */
  const bytes = Buffer.byteLength(JSON.stringify(body));
  if(bytes > 900000){
    log('err', `archive is too large for one document (${bytes} bytes) — NOT saved, tell Claude`);
    return null;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await db.doc(`nights/${NIGHT}/archive/${stamp}`).set(
    Object.assign({ at: FieldValue.serverTimestamp() }, body));
  log('save', `${body.counts.rounds} round(s), ${body.counts.subs} answer set(s), ` +
              `${body.counts.players} player(s) — ${body.why}`);
  return stamp;
}

/* ---- 6b. resolving a round -------------------------------------------
   ONE question that cannot be read must not cost the other three.

   The Control Room has always known this. `closeQuarter()` voids the
   unanswerable question, names it, and scores the rest — "nobody gains a
   point and nobody loses one, so no player is advantaged. The rest score
   normally." `markOf()` returns 'non' for a question with no key, which is
   the encoding that makes an empty entry safe rather than wrong.

   This function used to `break` on the first refusal and abandon the whole
   round. That is incident #6 — the bug that ended every game night before
   #5 — reintroduced on the server, where no human was watching to notice.
   Measured against Game Nights #7 and #8: 15 of 16 questions resolve, and
   the single refusal took a whole round down with it, both nights.

   Voiding IS refusing to guess. Voiding three innocent questions alongside
   the unreadable one is not extra caution; it is just a bigger loss. */
function resolveRound(AUTO, R, sum, period, early){
  const key = [], why = [], voided = [];
  for(let x = 0; x < R.qs.length; x++){
    const q = R.qs[x];
    /* A human's decision travels with the plan and is never resolved over. */
    if(q.k != null && q.k !== ''){ key.push(String(q.k)); why.push(String(q.k) + ' (by hand)'); continue; }
    /* An answer captured at the buzzer beats one computed later. */
    const e = early && early[x];
    if(e != null && e !== ''){ key.push(String(e)); why.push(String(e) + ' (at the buzzer)'); continue; }
    if(!q.r){ key.push(''); why.push('VOID'); voided.push(`Q${x+1} has no resolver`); continue; }
    let res = null;
    try{ res = AUTO.resolve(q.r, sum, period, q.o); }
    catch(err){ key.push(''); why.push('VOID'); voided.push(`Q${x+1} threw: ${err.message}`); continue; }
    if(!res || !res.ok){ key.push(''); why.push('VOID'); voided.push(`Q${x+1} — ${(res && res.why) || 'no answer'}`); continue; }
    key.push(String(res.answer)); why.push(res.answer);
  }
  return { key, why, voided };
}

/* Resolve whatever can be read AT THE BUZZER and keep it.

   "Through three quarters, how many players have reached double figures"
   is a question about a MOMENT, and the box score only holds the present.
   `doubleFiguresBand` knows this and refuses once the game has moved past
   the period being asked about — correctly. But the round does not close
   until 20s of grace plus up to 2m30 of answering have passed, by which
   time the fourth quarter has started and the honest refusal is guaranteed.
   The resolver was never wrong; the fact was being read 170 seconds after
   it stopped being true.

   So read it now, store it, reveal it at close. */
function earlyAnswers(AUTO, R, sum, period){
  const out = [];
  for(let x = 0; x < R.qs.length; x++){
    const q = R.qs[x];
    if(!q.r || (q.k != null && q.k !== '')){ out.push(null); continue; }
    let res = null;
    try{ res = AUTO.resolve(q.r, sum, period, q.o); }catch(_){ res = null; }
    out.push(res && res.ok ? String(res.answer) : null);
  }
  return out;
}

/* ---- 7. the loop ---------------------------------------------------- */
async function main(){
  if(!NIGHT) die('NIGHT_ID is not set');
  if(!EVENT) die('ESPN_EVENT is not set');

  const AUTO = loadShared();
  const { db, FieldValue } = loadDb();
  const plan = await readPlan(db);
  const N = plan.rounds.length;

  try{ await claimLease(db, FieldValue); }
  catch(e){ die('cannot start — ' + ((e && e.message) || e)); }
  log('boot', `lease held as ${HOST_ID}`);
  log('boot', `night ${NIGHT} · event ${EVENT} · ${N} rounds · running for up to ${MINUTES}m`);

  const acted = {}, seenDone = {};
  let lastScoreSig = '';
  const until = Date.now() + MINUTES * 60000;

  while(Date.now() < until){
    try{
      const sum = await AUTO.fetchFeed(EVENT);

      /* The heartbeat, which is also the lease renewal. A room whose host
         has died should be able to say so rather than waiting in silence
         for a quarter that is never coming — and a host that has been
         taken over should stop writing rather than fight. */
      try{ await claimLease(db, FieldValue); }
      catch(e){ die('lost the lease — ' + ((e && e.message) || e)); }

      lastScoreSig = await writeLiveScore(db, FieldValue, sum, plan, lastScoreSig);

      const roundsSnap = await db.collection(`nights/${NIGHT}/rounds`).get();
      const live = {}; roundsSnap.forEach(d => { live[d.id] = d.data(); });
      /* count() bills one read per thousand documents; .get().size billed
         one per PLAYER, every twenty seconds, all night. At ten players
         that was invisible; at a hundred it is ~47k reads and the night
         dies of the free tier's daily cap mid-game. */
      const seats = (await db.collection(`nights/${NIGHT}/players`).count().get()).data().count;
      const now = Date.now();

      for(let i = 0; i < N; i++){
        const rid = 'r' + i, doc = live[rid] || null, R = plan.rounds[i];
        let done = false;
        try{ done = AUTO.periodDone(sum, i + 1); }catch(_){}

        /* ---- OPEN ---------------------------------------------------
           The grace period is not caution for its own sake: ESPN posts the
           end-of-period row a beat before the last plays of that period
           land, and a round opened inside that window asks about plays the
           resolvers cannot see yet. */
        if(!doc && done){
          if(!seenDone[i]){ seenDone[i] = now; continue; }
          if(now - seenDone[i] < GRACE_MS) continue;
          if(acted['push' + i]) continue;
          acted['push' + i] = true;
          const early = earlyAnswers(AUTO, R, sum, i + 1);
          const earlyN = early.filter(v => v != null).length;
          await db.doc(`nights/${NIGHT}/rounds/${rid}`).set({
            seq: Date.now(), idx: i, tag: R.tag, name: R.name, worth: R.worth,
            state: 'live',
            questions: R.qs.map(q => ({ t: q.t, o: q.o })),
            earlyKey: early,
            openedAt: FieldValue.serverTimestamp()
          }, { merge: true });
          log('push', `${R.tag} is live on every phone` +
                      (earlyN ? ` · ${earlyN}/${R.qs.length} already readable at the buzzer` : ''));
          continue;
        }

        /* ---- CLOSE --------------------------------------------------- */
        if(doc && doc.state === 'live' && !acted['key' + i]){
          const opened = doc.openedAt && doc.openedAt.toMillis ? doc.openedAt.toMillis() : 0;
          const waited = opened ? (now - opened) : 0;
          const subs = (await db.collection(`nights/${NIGHT}/rounds/${rid}/subs`).get()).size;
          const everyoneIn = seats > 0 && subs >= seats;
          if(!everyoneIn && waited < ANSWER_MS) continue;
          if(everyoneIn) log('room', `everyone has answered ${R.tag} — closing early`);

          const { key, why, voided } = resolveRound(AUTO, R, sum, i + 1, doc.earlyKey);

          /* EVERY question voided is not a round, it is a feed that never
             arrived. Scoring that would stick the whole room on zero for
             the quarter — the Game #2 bug — so this one case still waits
             for a person. Anything less than total still scores. */
          if(voided.length === R.qs.length){
            if(!acted['held' + i]){
              acted['held' + i] = true;
              await db.doc(`nights/${NIGHT}/rounds/${rid}`).set(
                { needsHuman: voided.join(' · '), needsHumanAt: FieldValue.serverTimestamp() },
                { merge: true });
              log('hold', `${R.tag} needs a human — nothing resolved · ${voided.join(' · ')}`);
            }
            continue;
          }

          acted['key' + i] = true;
          await db.doc(`nights/${NIGHT}/rounds/${rid}`).set({
            seq: Date.now(), state: 'scored', key,
            voided: voided.length ? voided : FieldValue.delete(),
            needsHuman: FieldValue.delete(),
            closedAt: FieldValue.serverTimestamp()
          }, { merge: true });
          /* Logged BEFORE the key, deliberately. `score.the-runner-scores-
             after-it-keys` asserts that log('key') and scoreRoom() stay
             within 400 characters of each other — the invariant being that
             a posted key becomes a score immediately, never a key sitting
             on screen with nobody's total moved. Putting this line between
             them pushed them apart and turned the check red. The check is
             right; the line belongs here. */
          if(voided.length)
            log('void', `${R.tag} — ${voided.length} question(s) voided, nobody gains or loses: ${voided.join(' · ')}`);
          log('key', `${R.tag} scored — ${why.join(' · ')}`);
          /* The key is worthless to a player until it is a number on their
             screen. Score immediately, and never let a scoring failure
             undo a key that is already correct and posted. */
          try{ await scoreRoom(db, FieldValue, AUTO); }
          catch(e){ log('err', 'scoring failed after ' + R.tag + ': ' + ((e && e.message) || e)); }
          /* And keep it. A runner that dies in the third quarter should
             still leave two quarters of answers behind it. */
          try{ await archiveNight(db, FieldValue, 'after-' + R.tag); }
          catch(e){ log('err', 'archive after ' + R.tag + ' failed: ' + ((e && e.message) || e)); }
          continue;
        }
      }

      /* ---- THE BUZZER ------------------------------------------------ */
      let over = false;
      try{ over = !!sum.header.competitions[0].status.type.completed; }catch(_){}
      if(over){
        const allScored = plan.rounds.every((_, k) => (live['r' + k] || {}).state === 'scored');
        if(allScored){
          await db.doc(`nights/${NIGHT}`).set(
            { host: { auto: true, where: 'runner', finishedAt: FieldValue.serverTimestamp() } },
            { merge: true });
          /* Force the final score out even if it matched the last one —
             the difference between "Q4 in progress" and "Final" is the
             whole reason a phone stops waiting. */
          await writeLiveScore(db, FieldValue, sum, plan, '');
          /* One last pass. A round a human settled by hand while the runner
             was up would otherwise never be added to anyone's total, and
             the night would end with the board quietly short. */
          try{ await scoreRoom(db, FieldValue, AUTO); }
          catch(e){ log('err', 'final scoring pass failed: ' + ((e && e.message) || e)); }
          /* The copy that matters. Everything the room did tonight, in one
             document, written before the runner walks away — so that what
             happens to this night afterwards is somebody's choice rather
             than somebody's mistake. */
          try{ await archiveNight(db, FieldValue, 'final-buzzer'); }
          catch(e){ log('err', 'archive at the buzzer failed: ' + ((e && e.message) || e)); }
          log('done', 'final buzzer, every quarter scored — the runner is finished');
          return;
        }
        if(!acted.warnedFinal){
          acted.warnedFinal = true;
          log('hold', 'the game is over but not every quarter is scored — staying up in case a human settles them');
        }
      }
    }catch(e){
      /* A tick that throws must never end the night. The next one is 20
         seconds away and the loop is idempotent, so the usual cost of a
         failed tick is twenty seconds. */
      log('err', (e && e.message) || String(e));
    }
    await new Promise(r => setTimeout(r, TICK_MS));
  }
  /* The other way a night ends: not at a buzzer but at the edge of the
     window, because the game ran long, the feed stalled, or a quarter was
     never settled. That night's answers are worth exactly as much as a
     tidy one's. */
  try{ await archiveNight(db, FieldValue, 'window-closed'); }
  catch(e){ log('err', 'archive at the window close failed: ' + ((e && e.message) || e)); }
  log('done', 'ran out of time — the window closed');
}

/* Run as a program; import as a module. The gate and the shadow test need
   to exercise resolveRound() itself rather than a copy of its logic — a
   test that reimplements the thing it is testing is One Fact, Many Copies
   wearing a lab coat. */
if(require.main === module) main().catch(e => die((e && e.stack) || String(e)));
else module.exports = { resolveRound, earlyAnswers, loadShared };
