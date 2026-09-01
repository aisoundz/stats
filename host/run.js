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
/* MODULE SCOPE, and the first attempt was not. It landed inside loadDb()
   because that is where the first require('firebase-admin') happens, so
   PUSH was a local in a function nobody calls from the round loop and
   every push threw "PUSH is not defined" — caught, logged and ignored,
   28 Aug, Q1 of the Commanders room.

   It was VISIBLE only because the silence ratchet made that catch log
   earlier the same morning. The version I wrote first swallowed it, and
   push would have been dead for as long as nobody thought to check. */
const PUSH = require('./push.js');

const NIGHT   = process.env.NIGHT_ID   || '';
const EVENT   = process.env.ESPN_EVENT || '';
const MINUTES = Number(process.env.RUN_MINUTES || 240);
const SPORT   = process.env.SPORT_PATH || 'basketball/wnba';
/* HOW LONG A ROUND STAYS OPEN. Founder, at half time: "the second quarter
   questions never went off. It showed the end score with it having nothing
   on the laptop and tablet." The round HAD opened and scored — the runner's
   own log has `key Q2 scored` — but it was open for two and a half minutes
   and he was watching the game. A player looking at a television is not
   refreshing a phone, and 2m30 is shorter than the break itself.
   Six minutes, and it still closes the moment everyone has answered. */
const ANSWER_MS = Number(process.env.ANSWER_MS || 360000);   // 6m
/* HOW RECENTLY A SEAT MUST HAVE BEEN SEEN TO COUNT AS SOMEBODY WE ARE
   WAITING FOR. Longer than any quarter on purpose: a locked phone stops
   reporting, and shutting a round on somebody who put their handset down
   is a worse bug than the wait this exists to end. See the note at the
   early-close for the night that produced it. */
const PRESENT_MS = Number(process.env.PRESENT_MS || 1500000); // 25m
const GRACE_MS  = Number(process.env.GRACE_MS  || 20000);
/* Caught It is ON by default now that the runner can host it. A room with
   no host for it is a room where `callit:true` tells every phone to watch
   for questions that will never come, which is the state that produced a
   silent green ARMED badge all last night. */
const CALLIT      = String(process.env.CALLIT || '1') !== '0';
const CALLIT_PACE = String(process.env.CALLIT_PACE || 'normal');
const TICK_MS   = Number(process.env.TICK_MS   || 20000);
/* ---- THE EMPTY ROOM, AND WHY IT HAS TO BE ALLOWED TO END -----------
   Running every game of the slate means most rooms will have nobody in
   them, especially in beta. An empty room is not free: it holds a node
   process, renews a lease, fetches a feed and writes a score line every
   twenty seconds for four hours, to an audience of zero. Sixteen of those
   on an NFL Sunday is how a free tier turns into a bill.

   So a SLATE room stands down if nobody has arrived by the time it would
   matter. It does not archive — there is nothing to archive — and it does
   not delete anything: schedule/{id} and the plan stay published, so a
   runner can be started again the moment a person actually shows up.

   OFF BY DEFAULT. The flagship night has an email behind it and a founder
   who may join at half-time; a flagship that stood itself down because the
   room was empty at 7:05 would be the worst bug in this file. It is opt-in,
   and only the slate launcher opts in.                                  */
const IDLE_EXIT_MIN = Number(process.env.IDLE_EXIT_MIN || 0);
const IDLE_EXIT_MS  = IDLE_EXIT_MIN > 0 ? IDLE_EXIT_MIN * 60000 : 0;
const STARTED_AT    = Date.now();
/* MEASURED FROM TIP, NOT FROM STARTUP — and getting this wrong would have
   been the whole feature's worst bug. A slate runner is started before its
   game, and the games on a slate tip hours apart. Counting an idle window
   from when the PROCESS began means a room for a 10pm game, started at 4pm
   with the rest of the slate, stands itself down at 4:45 — hours before
   the first person could possibly have arrived, on a game that had not
   started. The window has to begin when there is something to be late to. */
const TIP_MS = (function(){
  var t = Date.parse(process.env.TIP_ISO || '');
  return isFinite(t) ? t : 0;
})();
const IDLE_FROM = () => Math.max(STARTED_AT, TIP_MS || 0);

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
/* WHICH admin FILE THE ENGINE COMES FROM, and it must be the same one the
   BANK came from. qa/bank-shadow.js takes `--file admin-test.html` so a gate
   grades what is about to ship — its own header records that it once
   hardcoded admin.html and "the gate silently graded the OLD banks". Only
   half of that was fixed: the bank moved to the argument and the ENGINE
   stayed hardcoded here, so a resolver added in admin-test.html did not
   exist when its own questions were graded and every one of them reported
   `silent`, indistinguishable from a resolver that cannot read the feed.
   Found 31 Aug 2026 while adding a per-inning strikeout band: 24 of 160
   answers went missing and the bank looked broken when the engine was
   simply the wrong file. Defaults to admin.html, so host/run.js is
   unchanged — a real night still hosts from the shipped engine. */
function loadShared(adminFile){
  const file = path.join(__dirname, '..', adminFile || 'admin.html');
  if(!fs.existsSync(file)) die((adminFile||'admin.html') + ' not found at ' + file);
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('/* @host-shared:start');
  const b = src.indexOf('/* @host-shared:end */');
  if(a < 0 || b < 0 || b <= a)
    die('the @host-shared sentinels are missing from ' + (adminFile||'admin.html') + ' — refusing to run a night with no resolvers');
  const code = src.slice(a, b);
  const sandbox = { console, fetch, Math, Date, Number, String, Array, Object, JSON, RegExp, isFinite, parseInt, parseFloat };
  sandbox.global = sandbox;
  try{ vm.createContext(sandbox); vm.runInContext(code + '\n;AUTO;', sandbox, { timeout: 5000 }); }
  catch(e){ die('the shared block did not evaluate in Node: ' + e.message +
                '\n(no document/window allowed between the sentinels)'); }
  const AUTO = sandbox.AUTO;
  if(!AUTO || typeof AUTO.resolve !== 'function' || typeof AUTO.periodDone !== 'function')
    die('the shared block evaluated but produced no usable AUTO');
  log('boot', `resolver engine loaded from ${adminFile||'admin.html'} (${Object.keys(AUTO.R || {}).length} resolvers) — sport ${SPORT}`);
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
/* AUTO ARRIVES AS AN ARGUMENT, BECAUSE IT WAS NEVER IN SCOPE HERE.
   Found live on 20 Aug, in the 4th inning, with four people in the room and
   the scoreboard reading "OT in progress".

   The mapping fix forty lines below was written for exactly this bug and
   has never once run. It calls AUTO.roundPeriodsFor(...), AUTO is created
   inside main() at the foot of this file, and every other function that
   needs it takes it as a PARAMETER — resolveRound(AUTO, ...),
   earlyAnswers(AUTO, ...), roundSlots(AUTO, ...). This one did not. So it
   threw ReferenceError on the first line of the try, the catch set bounds
   to null, and it fell through to the one-round-per-period fallback the
   comment itself calls wrong for baseball.

   A try/catch that swallows a ReferenceError turns a fix into decoration.
   The catch stays, because a feed in an unreadable shape must not kill the
   score, but AUTO is now passed in so the good path can actually be taken. */
function periodLabel(AUTO, sum, plan){
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
    /* ============ A ROUND IS NOT A PERIOD =============================
       These two lines assumed one round per period. That is true of
       basketball (4/4), football (4/4), hockey (3/3) and soccer (2/2) —
       and false of BASEBALL, which is 3 rounds across 9 innings.

       So on the first live baseball night this product ever hosted, every
       phone in the room would have read:

           inning 4 -> "OT in progress"      inning 7 -> "OT4 in progress"
           inning 5 -> "OT2 in progress"     inning 9 -> "OT6 in progress"

       Wrong in eight innings of nine, from about the fourth inning until
       the last out, on the scoreboard the player is looking at while the
       game they can see on television is in the 9th.

       roundPeriodsFor() already knows the mapping — run.js walks it to
       decide when a round OPENS — and this function never asked. Note it
       is only meaningful ON a round boundary: roundTagFor(mlb,1) returns
       "-1th-1st". So the label is derived by finding which round's window
       this period falls inside, and overtime is anything past the LAST
       round's period rather than past the round COUNT. */
    var per_ = Number(per) || 0;
    var bounds = null;
    try{ bounds = AUTO.roundPeriodsFor(sum, 0); }catch(_){ bounds = null; }
    if(Array.isArray(bounds) && bounds.length === plan.rounds.length){
      var lastPer = bounds[bounds.length - 1];
      if(per_ > lastPer){
        var extra = per_ - lastPer;
        return (extra > 1 ? 'OT' + extra : 'OT') + ' in progress';
      }
      for(var bi = 0; bi < bounds.length; bi++){
        if(per_ <= bounds[bi]){
          return ((plan.rounds[bi] || {}).tag || 'Q1') + ' in progress';
        }
      }
    }
    /* No mapping available — fall back to the old one-round-per-period
       reading, which is correct for every sport except baseball and is
       what shipped. */
    if(per_ > plan.rounds.length) return (per_ - plan.rounds.length > 1 ? 'OT' + (per_ - plan.rounds.length) : 'OT') + ' in progress';
    const tag = per_ >= 1 && plan.rounds[per_ - 1] ? plan.rounds[per_ - 1].tag : (plan.rounds[0] || {}).tag;
    return (tag || 'Q1') + ' in progress';
  }catch(_){ return ''; }
}

async function writeLiveScore(AUTO, db, FieldValue, sum, plan, last){
  const label = periodLabel(AUTO, sum, plan);
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
/* ============ computeHustle — PURE, so it can be tested ==============
   Lifted out of scoreRoom() because a currency nothing can test is a
   currency that will be wrong quietly. No db, no clock, no network: rounds
   in, submissions in, a balance per player out. qa/hustle.js reads this
   function straight out of this file, the way qa/bank-shadow.js reads the
   engine out of admin.html, so the thing under test is the thing that
   ships rather than a second copy of it.

   IT COUNTS ANSWERS, NOT CORRECT ANSWERS, and that is the rule rather than
   a loose reading of it: HUSTLE pays for being present when the question
   landed. The instant accuracy pays a redeemable currency, the lawyer's
   answer changes.

   RECOMPUTED FROM SCRATCH, never accumulated — the same property that lets
   scoreRoom be called after every key without doubling anyone's score. */
function computeHustle(scored, subs, uids){
  const hustle = {};
  (uids || []).forEach(u => { hustle[u] = 0; });
  const lastRound = (scored && scored.length) ? scored[scored.length - 1].id : null;
  for(const rd of (scored || [])){
    const rs = (subs && subs[rd.id]) || {};
    for(const uid of Object.keys(rs)){
      const picks = (rs[uid] && rs[uid].picks) || [];
      let answered = 0;
      for(const pk of picks){
        if(pk !== null && pk !== undefined && String(pk) !== '') answered++;
      }
      if(!answered) continue;
      hustle[uid] = (hustle[uid] || 0) + answered;   /* +1 an answer, right or wrong */
      if(rd.id === lastRound) hustle[uid] += 2;      /* still there at the buzzer */
    }
  }
  return hustle;
}

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

  /* ============ THE SERVER GRADES WHAT THE SERVER HOLDS ==============
     The promise on record is "submissions are the source of truth", and
     the round lane has always honoured it — recomputed from the subs every
     time, which is why running this twice cannot double anybody. The
     Caught It lane never did. The phone graded itself against its own copy
     of the answer, wrote `caughtPts` onto the player document, and tally()
     read that number straight back out.

     Two independent recounts of 20 August found stored values the server's
     own record of picks cannot justify, all in the same direction: 5 where
     the picks are worth 10, 45 where they are worth 80. The phone is not
     lying — it is a device that backgrounds, loses listeners, misses
     resolutions and keeps a streak across a room switch. It is simply not
     in a position to know.

     Every fact needed is already here: each question in callit carries its
     own resolved `answer`, and every pick is a document under it. So grade
     it, with the same arithmetic the phone uses, from AUTO.CI.caughtFor —
     one definition, so the two cannot drift.

     Ordered by opensAt, because a streak is a claim about CONSECUTIVE
     answers and grading them out of order is a different game, not a
     rounding error. */
  try{
    const ciSnap = await db.collection(`nights/${NIGHT}/callit`).get();
    const qs = [], picksByUid = {};
    const resolved = [];
    ciSnap.forEach(d => {
      const v = d.data() || {};
      if(v.state !== 'resolved') return;
      if(v.answer === undefined || v.answer === null || v.answer === '') return;
      /* No try/catch: a guarded read cannot throw, and a swallowed one here
         would silently sort the questions into the wrong order, which turns
         a streak into a different number rather than an error. */
      const at = (v.opensAt && typeof v.opensAt.toMillis === 'function') ? v.opensAt.toMillis() : 0;
      resolved.push({ qid: d.id, answer: v.answer, at });
    });
    resolved.sort((a,b) => (a.at - b.at) || String(a.qid).localeCompare(String(b.qid)));
    for(const q of resolved){
      qs.push({ qid: q.qid, answer: q.answer });
      const pk = await db.collection(`nights/${NIGHT}/callit/${q.qid}/picks`).get();
      pk.forEach(pd => {
        const pv = pd.data() || {};
        const val = (pv.v !== undefined) ? pv.v : pv.pick;
        (picksByUid[pd.id] = picksByUid[pd.id] || {})[q.qid] = val;
      });
    }
    if(qs.length){
      let moved = 0;
      for(const uid of Object.keys(players)){
        const r = AUTO.CI.caughtFor(qs, picksByUid[uid] || {});
        const was = players[uid].caughtPts;
        if(r.pts !== was){
          moved++;
          log('caught', `${uid.slice(0,8)} caught lane ${was} → ${r.pts}  ` +
                        `(${r.hit}/${r.called} called, best run ${r.best})`);
        }
        players[uid].caughtPts = r.pts;
      }
      log('caught', `graded ${qs.length} resolved question(s) from the server's own picks` +
                    (moved ? ` — ${moved} player total(s) corrected` : ' — every phone agreed'));
    }
  }catch(e){
    /* Loud. If this fails we fall back to the phone's number, which is the
       old behaviour and not a disaster — but silently trusting the device
       again is exactly the thing being fixed, so it has to be visible. */
    log('warn', 'could not grade the caught lane server-side, falling back to the ' +
                'device figure: ' + (e && e.message));
  }

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

  /* ============ HUSTLE — THE PRESENCE LEDGER ==========================
     The second currency. Points are earned by being RIGHT; HUSTLE by
     SHOWING UP. Computed HERE because this is the one place the server
     already holds the submissions, and never on a phone: a balance a
     phone can write is a balance a phone can forge.

     IT COUNTS ANSWERS, NOT CORRECT ANSWERS. `picks` is what the player
     sent, and every entry in it earns whether it was right or wrong. That
     is not a loose reading of the rule, it IS the rule — the currency pays
     for being present when the question landed, and the instant accuracy
     pays a redeemable currency the lawyer's answer changes.

     ITS OWN COLLECTION, for the reason caughtSrv exists rather than
     writing caughtPts: a field the client also owns has two writers, and
     the phone wins the next time it pushes. nights/{id}/hustle/{uid} has
     exactly one writer, this one.

     RECOMPUTED FROM SCRATCH, never added to — the same property that makes
     tally() safe to call after every key. Running it twice cannot double
     anybody's balance.

     TWO OF THE FOUR EARN RULES ARE NOT HERE YET, and are deliberately not
     faked: "+1 seated before the opening whistle" needs a join timestamp
     this function does not read, and "+1 daily claim" is not a game-night
     event at all. They are worth 2 of a possible 5 a night; the two below
     are the ones the server can honestly derive today. */
  const hustle = computeHustle(scored, subs, Object.keys(players));


  /* Recomputed from the submissions every time rather than added to, so
     running it twice cannot double anybody's score. That is the same
     property the Control Room's version has and it is why this is safe to
     call after every key. */
  let n = 0;
  for(const uid of Object.keys(t)){
    const row = t[uid];
    await db.doc(`nights/${NIGHT}/players/${uid}`).set({
      /* livePts is the ONE lane a phone does not own, and publishing it is
         what lets the board compose a total instead of guessing at one.
         See nightTotal() in index.html — GN12 ranked on a double-counted
         sum because `pts` was the only thing ever written. */
      /* ============ AND THE CAUGHT LANE, OR THE BOARD LOSES IT ========
         26 Aug. The block above grades the caught lane server-side and
         corrects `players[uid].caughtPts` IN MEMORY. tally() folds it
         into row.pts, so the TOTAL written here was always right — and
         the lane was not written at all, so the stored `caughtPts` kept
         whatever the phone last put there, which for a server-graded
         catch is 0.

         That matters because the client does not read `pts`. It
         RECOMPOSES the total from the four lanes — nightTotal() in
         index.html is livePts + predPts + catchPts + caughtPts — and
         readRoom() ranks the board on that. So every point this runner
         awarded for a catch was invisible on the board that decides who
         won, and the runner re-detected the same correction on every
         tick forever because nothing ever persisted it.

         Measured on live data before the fix: 08-25 por-dal pts=90 vs
         lanes=80, 08-23 nyc-ne 10 vs 0, 08-22 por-lafc 85 vs 80,
         08-21 nyj-pit 15 vs 10 — the gap is exactly the catch each time.

         The lane persisted ONLY when the device wrote it itself, so this
         hit precisely the players whose catches the server had to grade,
         which is the case server-side grading exists for. This function's
         own comment two lines up says "silently trusting the device again
         is exactly the thing being fixed". Until now it was not.

         WHY A NEW FIELD AND NOT `caughtPts` ITSELF. caughtPts is
         CLIENT-owned: index.html pushes it in SCORE_LANES and
         firestore.rules bounds it as "still client-reported, honestly".
         Writing it here would make two writers for one fact — the exact
         disease this codebase keeps paying for — and the phone would win
         the next time it pushed, mid-game, when the live board matters
         most. That is not hypothetical: "the zeroed local state was then
         pushed back over the server: caughtPts measured going 40 -> 0 in
         the database."

         So this follows the precedent livePts set on the line above, and
         for the same reason: when the server knows something the phone
         cannot, it publishes its OWN lane rather than fighting for the
         phone's. Nothing client-side writes caughtSrv, so it needs no
         rules change to protect it — exactly as livePts needs none. */
      pts: row.pts, livePts: row.live, speed: row.speed, roundsDone: row.rounds,
      caughtSrv: row.caughtPts,
      lastScoredBy: 'runner', lastScoredAt: FieldValue.serverTimestamp()
    }, { merge: true });
    n++;
  }
  log('score', `${n} player${n===1?'':'s'} scored from ${scored.length} round${scored.length===1?'':'s'}`);

  /* ---- and the HUSTLE ledger, published --------------------------------
     READ BEFORE WRITE, and only write a balance that actually MOVED.
     scoreRoom() runs after every key — nine times a night in baseball, per
     room — so blindly re-setting every player each pass would spend
     rounds x players writes a night to say the same number over and over.
     The free tier is 20,000 writes a day and the standing rule is to
     conserve it. Recompute always, persist only on change.

     A failure here must NOT take the score down with it. The points are
     the product; HUSTLE is a loyalty balance, and a currency that cannot
     be written is worth strictly less than a score that does not publish.
     So this is caught, logged loudly, and the function still returns the
     number of players it scored. */
  try{
    const hs = await db.collection(`nights/${NIGHT}/hustle`).get();
    const had = {};
    hs.forEach(d => { const v = d.data() || {}; had[d.id] = typeof v.h === 'number' ? v.h : null; });
    let hw = 0;
    for(const uid of Object.keys(hustle)){
      const want = hustle[uid];
      if(had[uid] === want) continue;
      await db.doc(`nights/${NIGHT}/hustle/${uid}`).set({
        h: want, by: 'runner', at: FieldValue.serverTimestamp()
      }, { merge: true });
      hw++;
    }
    if(hw) log('hustle', `${hw} balance${hw===1?'':'s'} moved`);
  }catch(e){
    log('warn', 'HUSTLE ledger not published this pass — the score is unaffected: ' +
                (e && e.message));
  }

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
    /* livePts BELONGS IN THE ARCHIVE. It was the one lane left out, and it
       is the one the board is built on: SB.nightTotal() composes a night
       from livePts + predPts + catchPts + caughtPts and only falls back to
       `pts` when livePts is missing. Archiving every lane EXCEPT that one
       meant a debrief could never reconstruct the number a player actually
       saw — it had to fall back to `pts`, a legacy field any writer can
       leave stale, and then report a disagreement that was drift rather
       than a scoring error. Found on 22 Aug chasing exactly that. */
    players.push({ uid: d.id, name: v.name || '', pts: v.pts || 0, speed: v.speed || 0,
                   livePts: v.livePts || 0,
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
/* ---- THE ROUND LIST IS NOT A CONSTANT — 17 Aug 2026 -----------------
   Two things were wrong here and both were silent.

   ONE: overtime had no round. The loop was `for(i = 0; i < N; i++)` with N
   fixed at the published length, so a fifth period could not be reached by
   it at all. periodLabel() has always said "OT in progress" on the
   scoreboard and its own comment admits the gap — "There is no fifth round
   to play." Founder's call, extending the GN11 decision to all six sports:
   every overtime period gets its own full round.

   TWO, and this one would have bitten baseball on its first night: the gate
   was called as `AUTO.periodDone(sum, i + 1)`, which assumes round index
   equals period number. That holds for basketball, hockey, football and
   soccer. It is FALSE for baseball, whose three rounds span nine innings —
   round 0 is the 3rd inning, not the 1st. Baseball would have opened round
   one after a single inning and asked about two innings nobody had watched.
   The period a round belongs to now comes from the sport table.

   Overtime questions come from ONE authored `plan.ot` template, reused per
   overtime period. The runner still invents nothing (B2, B28) — a template
   published before tip is not an invention, and a game ending in regulation
   never opens it. */
function roundSlots(AUTO, sum, plan){
  const regPer = AUTO.roundPeriodsFor(sum, 0);          // regulation only
  const slots = plan.rounds.map((def, i) => ({
    i, per: regPer[i] || (i + 1), def, ot: 0
  }));
  const mx = AUTO.maxPeriodIn(sum);
  const regWorths = plan.rounds.map(r => r && r.worth);
  /* DO NOT APPEND A ROUND FOR A PERIOD THE PLAN ALREADY COVERS.
     A night config may list five tags — Q1..Q4 plus OT — in which case the
     existing Write tab already renders a fifth round to author and the plan
     publishes it as rounds[4], mapped to period 5. Appending a template
     round for period 5 on top of that gave the same overtime TWO rounds:
     both open, both score, and the overtime is paid twice. A duplicate
     round is worse than a missing one, because a missing one is at least
     visible as an absence. Authored wins; the template only fills gaps. */
  const covered = {};
  slots.forEach(sl => { covered[sl.per] = true; });
  for(let per = 1; per <= mx; per++){
    const ot = AUTO.otIndexOf(sum, per);
    if(ot <= 0) continue;
    if(covered[per]) continue;
    /* THE PERIOD HAS TO HAVE BEEN PLAYED, and `mx` is not evidence of that.
       mx takes the higher of status.period and the plays; status.period can
       read past the last period actually played, and when it does, this loop
       manufactures an overtime round out of a scoreboard field. That is how a
       70-point "Extra innings" round reached every phone in a nine-inning
       game on 20 Aug, 237ms after the real final round.

       Asking the plays is the independent check. An inning that happened has
       pitches in it. Soccer returns 0 plays for every period and has no
       otFrom, so it never reaches this line. */
    const played = Number(AUTO.playsInPeriod(sum, per)) || 0;
    if(!played){
      log('skip', `${AUTO.roundTagFor(sum, per)} would be period ${per}, but the feed has no plays in it — ` +
                  `the scoreboard says ${mx} and the plays say ${AUTO.playedPeriodMax(sum)}. Not inventing an overtime.`);
      continue;
    }
    const tpl = plan.ot;
    slots.push({
      i: slots.length, per, ot,
      def: (tpl && Array.isArray(tpl.qs) && tpl.qs.length) ? {
        tag:   AUTO.roundTagFor(sum, per),
        name:  AUTO.roundNameFor(sum, per),
        worth: Number(tpl.worth) || AUTO.otWorthFor(sum, per, regWorths),
        qs:    tpl.qs
      } : null
    });
  }
  return slots;
}

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

  /* TELL THE PHONES SOMEBODY IS HOSTING IT. `callit` is the flag the app
     watches; it has been left true on rooms nobody was hosting, which is
     how four people sat waiting on questions that could not come. The
     runner sets it when it takes the room and clears it when it walks
     away, so the flag means what it says. */
  if(CALLIT){
    try{ await db.doc(`nights/${NIGHT}`).set({ callit:true }, { merge:true }); }
    catch(_){}
  }

  const acted = {}, seenDone = {};
  /* ---- CAUGHT IT, HOSTED HERE ---------------------------------------
     Founder, 20 Aug: "make the runner host every room end to end."

     Until tonight Caught It could only run inside an open Control Room tab.
     Close the laptop and it stopped for the night, whatever the runner was
     doing, and one tab could only ever serve one room. On a four-room
     Saturday that is four browser tabs that must all stay awake.

     The decision and the questions now live in AUTO.CI inside the shared
     block, so this is the same implementation the Control Room uses rather
     than a second copy of it. All that is left here is state and writes. */
  let ciKey = null;          // identity of the last play seen; never a sequence number
  let ciCounts = {};         // questions asked per period, for the ORDINARY cap
  let inningEndCount = 0;    // end-of-inning firings, its OWN cap — see the
                              // note above where it is checked. Never mixed
                              // into ciCounts/askedTotal, or a shared pool
                              // reintroduces the 23 Aug bug.
  let ciOpen = null;         // qid currently open
  let ciOpenedAt = 0;
  let ciPending = null;      // {qid, ans, text, at} — the answer, held back
  let ciLastPer = null;      // the period we last saw, so we can spot the turn
  /* The last inning we actually ASKED about. Needed only for the
     game-is-final branch below, which is re-evaluated on every poll for as
     long as the runner stays up after the buzzer — about fifty times on a
     normal night — and would otherwise ask about the 9th fifty times. */
  let ciLastAsked = null;
  let lastFeedSig = '';
  let lastScoreSig = '';
  /* ============ FOUR HOURS OF THE GAME, NOT OF THE PROCESS ==========
     start-slate.sh opens a room LEAD_MIN (30) before its own tip, and this
     counted from the moment the process started — so RUN_MINUTES=240 meant
     tip plus 210, and the last half hour of the budget was spent waiting
     for the game to begin.

     A preseason NFL game runs 3h05 to 3h20. Tonight's 4:00 kickoff would
     have left ten to twenty minutes of margin on the Q4 round and the final
     settlement, and by then the host is in the 7:00 room and nobody is
     watching this log. Extra innings would have eaten the baseball room's
     margin outright.

     When the loop simply exits, nothing opens and nothing is logged as an
     error: the exact silent-success failure this codebase keeps finding.
     Count from the tip when we know it, which is whenever start-slate
     launched us. */
  const until = (TIP_MS || Date.now()) + MINUTES * 60000;
  log('boot', 'this runner will work until ' + new Date(until).toISOString() +
              (TIP_MS ? '  (tip + ' + MINUTES + 'm)' : '  (start + ' + MINUTES + 'm — no TIP_ISO given)'));

  while(Date.now() < until){
    try{
      /* SPORT is passed, not ignored — fixed 17 Aug 2026. It was declared
         at the top of this file and never used, while AUTO.fetchFeed had the
         WNBA path hardcoded. So SPORT_PATH=baseball/mlb was accepted in
         silence and then fetched a basketball game anyway: a wrong-sport
         night that reads on every screen like a feed carrying nothing, which
         is the most expensive kind of wrong there is here. */
      const sum = await AUTO.fetchFeed(EVENT, SPORT);

      /* The heartbeat, which is also the lease renewal. A room whose host
         has died should be able to say so rather than waiting in silence
         for a quarter that is never coming — and a host that has been
         taken over should stop writing rather than fight. */
      try{ await claimLease(db, FieldValue); }
      catch(e){ die('lost the lease — ' + ((e && e.message) || e)); }

      lastScoreSig = await writeLiveScore(AUTO, db, FieldValue, sum, plan, lastScoreSig);

      /* ============ THE FEED, PUBLISHED WHERE A PHONE CAN REACH IT =====
         Founder, mid-game, opening the Stats tab: "why do i not see
         anything in my stats tab. It should have the cool stats and charts
         and progress." It showed "Can't reach the league feed".

         The player app fetched ESPN DIRECTLY FROM THE PHONE. Measured on
         the live site tonight: ESPN answers curl from this machine with a
         200 and an `access-control-allow-origin: *`, and the same request
         from a browser dies with net::ERR_FAILED — from statsgametime.com
         AND from example.com, which is what proves it is not our page and
         not their CORS. Something between a browser and ESPN blocks it:
         tracking protection, an ad blocker, a VPN, a school or office
         network. Any one of those silently kills every stat and chart in
         the product, for a player who has no way to know why.

         The ticker kept working the whole time, because the ticker reads
         OUR database. This runner is already holding the exact JSON the
         Stats tab wanted, fetched server-side where nothing blocks it, and
         it was throwing it away every twenty seconds.

         So publish it. Stored as a STRING on purpose: Firestore rejects an
         array that directly contains another array, and an ESPN summary is
         full of them. A string has no shape rules, and the app parses it
         with the same code it already uses on the live response.

         Trimmed to what the app actually reads — boxscore teams and
         players, the header, leaders, and the tail of the play list —
         because the whole summary can approach the 1MB document ceiling
         and the plays are most of it. */
      try{
        const trimmed = {
          boxscore: { teams: (sum.boxscore || {}).teams || [],
                      players: (sum.boxscore || {}).players || [] },
          header:   sum.header || {},
          leaders:  sum.leaders || [],
          injuries: sum.injuries || [],
          /* Newest last, same order the app expects; 60 is more than any
             screen shows and keeps the document comfortably small. */
          plays:    (sum.plays || []).slice(-60)
        };
        const json = JSON.stringify(trimmed);
        /* Never write something the server will reject: a document over the
           ceiling fails the whole write and takes the score with it. Drop
           the plays first, they are the biggest and the least needed. */
        let payload = json;
        if(payload.length > 900000){
          delete trimmed.plays;
          payload = JSON.stringify(trimmed);
        }
        if(payload.length <= 900000 && payload !== lastFeedSig){
          lastFeedSig = payload;
          await db.doc(`nights/${NIGHT}/feed/latest`).set({
            at: FieldValue.serverTimestamp(),
            event: String(EVENT || ''),
            sport: String(SPORT || ''),
            bytes: payload.length,
            json: payload
          });
          log('feed', `published ${Math.round(payload.length/1024)}kB for the Stats tab`);
        }
      }catch(e){ log('feed', 'could not publish the feed: ' + ((e && e.message) || e)); }

      /* ---- CAUGHT IT ------------------------------------------------
         Runs on the same poll as everything else, writes only to its own
         collection, and can never touch the round scores. Worst case if
         anything in here misbehaves is one question voiding. */
      if(CALLIT){
        try{
          const sportFam = String(SPORT || '').split('/')[0] || 'basketball';
          let cplays = [];
          if(sportFam === 'soccer'){ try{ cplays = AUTO.CI.soccerEvents(sum) || []; }catch(_){ cplays = []; } }
          else { try{ cplays = AUTO.feedPlays(sum) || []; }catch(_){ cplays = []; } }

          if(cplays.length){
            const step = AUTO.CI.freshAfter(cplays, ciKey);
            const firstLook = !ciKey;
            ciKey = step.key;

            /* Release a held answer once its lock window has passed. The
               phones counted down against locksMs; publishing early would
               show the answer to somebody still choosing. */
            if(ciPending && Date.now() >= ciPending.at){
              try{
                const ref = db.doc(`nights/${NIGHT}/callit/${ciPending.qid}`);
                const snap = await ref.get();
                if(snap.exists && (snap.data() || {}).state === 'open'){
                  await ref.set({ state:'resolved', answer: ciPending.ans,
                                  resolveText: ciPending.text || null,
                                  resolvedAt: FieldValue.serverTimestamp() }, { merge:true });
                  log('callit', `answer published — ${ciPending.text || ciPending.ans}`);
                }
              }catch(e){ log('callit', 'could not publish the answer: ' + ((e && e.message) || e)); }
              ciPending = null; ciOpen = null;
            }

            /* Never fire on the backlog: the first look only remembers where
               the game is. Same rule the Control Room has always had. */
            if(!firstLook && !ciOpen && step.fresh.length){
              const per = AUTO.CI.curPeriod(cplays);
              const pace = AUTO.CI.PACES[CALLIT_PACE] || AUTO.CI.PACES.normal;
              /* EIGHT A GAME, PACED AGAINST THE GAME. The old rule was a
                 per-period cap and a fixed gap, which gave basketball eight
                 and soccer two: a sport whose moments are rare never
                 reached the cap. The budget is per GAME now and the floor
                 between questions tightens when the room is behind it. */
              let regPer = 4; try{ regPer = Number(AUTO.regulationPeriods(sum)) || 4; }catch(_){}
              const askedTotal = Object.keys(ciCounts).reduce((n,k)=>n+(ciCounts[k]||0),0);
              const allowed = AUTO.CI.quota(AUTO.CI.perGameFor(sportFam, pace), per, regPer);
              const gap = Date.now() - ciOpenedAt;

              /* ============ A QUESTION AT THE END OF EVERY INNING ========
                 His ask, 22 Aug. Baseball's scoring rounds cover innings
                 1-3, 4-6 and 7-9, so between them sit forty-minute
                 stretches with nothing to answer — most of the game.

                 The turn of the period is the signal, and the question is
                 about the inning that JUST FINISHED, never the one starting:
                 at this instant the new inning has no plays in it, so an
                 ordinary Caught It built against it would be a question
                 about nothing. AUTO.CI.buildInningEnd() is passed the
                 inning that ended and filters every play to it.

                 It also bypasses the RAMP AND THE SHARED CAP. `allowed`
                 grows with the period so a game does not spend its whole
                 budget in the first quarter — sound for ordinary questions,
                 and wrong here for the same reason the ramp is.

                 IT USED TO SHARE THE SHARED CAP TOO, AND THAT WAS A SECOND
                 BUG WITH THE SAME SHAPE. 23 Aug, a real 9-inning game:
                 twelve Caught It questions fired total, matching 'normal'
                 pace's perGameFor exactly, and then NOTHING for the last
                 eighty-five minutes — no 9th inning, nothing else. Two
                 ordinary sawAtBat/sawPitch questions were mixed into that
                 same twelve, so the shared pool ran out three innings
                 early. "A question at the end of every inning" is a
                 guarantee, not a pacing preference, and a guarantee cannot
                 share a budget with something that competes for the same
                 slots — the promise breaks exactly when the game runs
                 long, which is the game most worth watching.

                 So it has its OWN counter now, inningEndCount, checked
                 against its own generous backstop rather than the shared
                 askedTotal. Nine regulation innings plus a realistic run of
                 extras fits inside twenty with room to spare; the number
                 exists only to stop a malformed feed from looping forever,
                 not to pace a real game. The ordinary per-game budget is
                 untouched by this and keeps working exactly as before —
                 the fix is that the two no longer draw from one pool. */
              const INNING_END_CAP = 20;
              let inningEnded = null;
              if(sportFam === 'baseball'){
                if(ciLastPer != null && per > ciLastPer) inningEnded = ciLastPer;
                /* ============ THE LAST INNING HAS NOTHING AFTER IT =======
                   27 Aug. Founder: "I thought baseball asks you a question
                   at the end of each inning." It does, and it works: eight
                   fired on 24 Aug, eight on the 25th, eight on the 23rd.

                   EIGHT. Not nine.

                   The trigger above is a period ADVANCE — inning n is over
                   the moment the feed reports inning n+1. That is right for
                   the first eight and structurally impossible for the last
                   one, because there is no tenth inning to advance to. The
                   game simply ends, and the question about the inning that
                   decided it is the one nobody is ever asked.

                   Checked before assuming: on 25 Aug the home side led 4-3
                   so there was no bottom of the 9th and eight is CORRECT
                   there. But 24 Aug finished 4-1 to the AWAY team, so the
                   home side batted out the 9th and it completed properly.
                   Eight questions, nine innings played.

                   This is the same shape as the Q4 bug and the same shape
                   as the buzzer race: the most valuable moment of the night
                   is the one the trigger cannot reach, because every
                   trigger in this codebase has been written as "when the
                   next thing starts" rather than "when this thing ends".

                   So: when the feed says the game is over, the inning on
                   the field ended too. `ciLastAsked` stops it being asked
                   twice, which matters because this branch is re-evaluated
                   on every poll for as long as the runner stays up after
                   the final — roughly fifty times on a normal night. */
                if(inningEnded == null && per && ciLastAsked !== per){
                  /* Walked rather than wrapped in a try/catch. The deep path
                     legitimately may not exist on a malformed poll, and a
                     silent catch here would have pushed qa/silence.js's
                     ratchet from 52 to 53 — the suite caught it. Safe
                     navigation says the same thing and stays quiet without
                     swallowing anything. */
                  const _c = (sum && sum.header && sum.header.competitions) || [];
                  const _st = (_c[0] || {}).status || {};
                  const over = !!(_st.type && _st.type.completed);
                  if(over){
                    inningEnded = per;
                    log('callit', `the game is final and the ${per}th never turned over — `
                                + 'asking its inning question now, which nothing used to');
                  }
                }
                if(inningEnded != null) ciLastAsked = inningEnded;
                ciLastPer = per;
              }
              const mo = inningEnded != null
                ? { reason: 'inning', stoppage: true }
                : AUTO.CI.moment(sportFam, step.fresh);
              const spacedOut = mo && (inningEnded != null
                ? gap >= 15000                       /* only so two turns cannot collide */
                : gap >= AUTO.CI.floorMs(mo.stoppage, askedTotal, allowed, pace));
              const withinBudget = inningEnded != null
                ? inningEndCount < INNING_END_CAP
                : askedTotal < allowed;
              if(mo && withinBudget && spacedOut){
                const comp = ((sum.header || {}).competitions || [])[0] || {};
                const cs = comp.competitors || [];
                const aw = cs.find(c => c.homeAway === 'away') || cs[0] || {};
                const hm = cs.find(c => c.homeAway === 'home') || cs[1] || {};
                const T = {
                  awayAbbr:(aw.team||{}).abbreviation||'', homeAbbr:(hm.team||{}).abbreviation||'',
                  awayId:(aw.team||{}).id, homeId:(hm.team||{}).id,
                  awayName:(aw.team||{}).displayName||'', homeName:(hm.team||{}).displayName||'',
                  awayScore:aw.score, homeScore:hm.score
                };
                let q = null;
                /* ============ THE NEW BUILDER GETS ITS OWN NET ============
                   These were one try/catch, and that was wrong: a throw
                   inside buildInningEnd() would jump straight past the
                   ordinary builder below, so the moment produced NO
                   question at all rather than falling back to the one that
                   has worked for weeks. New code sharing a catch with
                   proven code drags the proven code down with it — and it
                   fails silently, which is the shape this whole file is
                   organised against.

                   Separate nets. The inning-end question is an addition; if
                   it cannot be built, for any reason, the night carries on
                   exactly as it did before it existed. */
                let firedFromInningEnd = false;
                if(inningEnded != null){
                  try{ q = AUTO.CI.buildInningEnd(sportFam, cplays, T, inningEnded, ciCounts); }
                  catch(e){ log('callit', 'the inning-end builder threw, falling back: ' +
                                          ((e && e.message) || e)); q = null; }
                  if(q) firedFromInningEnd = true;
                }
                if(!q){
                  /* A turn with nothing to ask about (buildInningEnd
                     returned null) falls through to an ordinary question so
                     the moment is not wasted — and THAT question is
                     genuinely ordinary, so it counts against the ordinary
                     budget below, not the inning-end one. */
                  try{ q = AUTO.CI.build(sportFam, cplays, T, per, ciCounts, sum); }
                  catch(e){ log('callit', 'the builder threw: ' + ((e && e.message) || e)); }
                }
                if(q && q.qid){
                  const locks = AUTO.CI.lockMsFor(q.kind);
                  /* The answer NEVER goes in the document the phones read.
                     It is held here and published when the clock is up. */
                  await db.doc(`nights/${NIGHT}/callit/${q.qid}`).set({
                    qid:q.qid, kind:q.kind, prompt:q.prompt, options:q.options,
                    period:q.per, runTeam:q.runTeam || null,
                    state:'open', answer:null, resolveText:null,
                    opensAt: FieldValue.serverTimestamp(), locksMs: locks, seq: Date.now()
                  }, { merge:true });
                  ciOpen = q.qid; ciOpenedAt = Date.now();
                  /* Two separate counters for two separate promises. A
                     genuine inning-end question increments its own count
                     ONLY — it must never eat into the ordinary budget, or
                     the ordinary questions get starved by every inning
                     turn. Everything else, including a fallback that came
                     through here because an inning had nothing to ask
                     about, counts the ordinary way, exactly as before. */
                  if(firedFromInningEnd) inningEndCount++;
                  else ciCounts[per] = (ciCounts[per] || 0) + 1;
                  ciPending = (q.ans != null)
                    ? { qid:q.qid, ans:String(q.ans), text:q.atext || '', at: Date.now() + locks + 1200 }
                    : null;
                  log('callit', `${mo.reason} · ${String(q.prompt||'').slice(0,52)}`);
                }
              }
            }
          }
        }catch(e){ log('callit', 'tick threw: ' + ((e && e.message) || e)); }
      }

      const roundsSnap = await db.collection(`nights/${NIGHT}/rounds`).get();
      const live = {}; roundsSnap.forEach(d => { live[d.id] = d.data(); });
      /* count() bills one read per thousand documents; .get().size billed
         one per PLAYER, every twenty seconds, all night. At ten players
         that was invisible; at a hundred it is ~47k reads and the night
         dies of the free tier's daily cap mid-game. */
      const seats = (await db.collection(`nights/${NIGHT}/players`).count().get()).data().count;
      const now = Date.now();

      /* Stand down on an empty slate room. Checked AFTER the seat count so
         a person who joined one tick ago keeps their night. */
      if(IDLE_EXIT_MS && seats === 0 && (now - IDLE_FROM()) >= IDLE_EXIT_MS){
        log('done', `nobody joined in the ${IDLE_EXIT_MIN} minutes since ` +
                    (TIP_MS ? 'tip-off' : 'this runner started') +
                    ' — standing down. Nothing is archived because nothing happened, and ' +
                    'the room stays published, so this can be started again if someone arrives.');
        return;
      }

      const slots = roundSlots(AUTO, sum, plan);
      /* AN OVERTIME NOBODY CAN ANSWER MUST SAY SO. Silently skipping it is
         this codebase's own A6 — an operation fails and nobody is told —
         and it is exactly how overtime went missing for eleven nights. */
      for(const sl of slots){
        if(sl.ot > 0 && !sl.def && !acted['otwarn' + sl.per]){
          acted['otwarn' + sl.per] = true;
          const why = `${AUTO.roundTagFor(sum, sl.per)} has no questions — publish an "ot" template in the plan`;
          log('err', why);
          try{
            await db.doc(`nights/${NIGHT}`).set(
              { needsHuman: why, needsHumanAt: FieldValue.serverTimestamp() }, { merge: true });
          }catch(_){}
        }
      }

      /* ============ A PERIOD NOBODY PLAYED IS NOT A PERIOD THAT ENDED ==
         Found 20 Aug, minutes after the final out of a 9-inning game that
         finished 2-0: the room held FOUR rounds, and the fourth was OT.

         periodDone answers "is period N over", and at Final it says yes to
         every N, including innings that were never played. Nothing had ever
         noticed because in basketball the OT round only exists in the plan
         when a hand-written night added it, and no automated night had
         reached a final buzzer in a sport with a standing OT template.

         So a room that ends in regulation would push an overtime round to
         every phone, worth 70 points, about innings that do not exist. The
         resolvers would then be asked to read them, and the honest ones
         would void while the band questions answered "none" for a period
         that never happened.

         maxPeriodIn is the feed's own high-water mark. A round whose period
         is past it did not happen, whatever the status says. */
      /* THE PLAYS FIRST, and this is the whole point of the guard.
         This used to read AUTO.maxPeriodIn(sum) — the same call that decides
         which slots exist — so `sl.per > playedTo` compared a number with
         itself and could not be false for any slot it was written to stop.
         playedPeriodMax consults the plays alone, so when the scoreboard runs
         ahead of the game the two disagree and the guard has something to
         say. */
      let playedTo = Number(AUTO.playedPeriodMax(sum)) || 0;
      if(!playedTo){
        try{ playedTo = Number(AUTO.maxPeriodIn(sum)) || 0; }catch(_){}
      }
      /* SOCCER HAS NO PLAY LIST, so maxPeriodIn has nothing to count and
         returns 0 — which would have made the guard above silently inert
         for MLS, protecting four sports out of five. Caught by
         qa/night-per-sport.js on its first run, which is the entire reason
         that suite exists.

         Three fallbacks, in descending order of directness. The header's
         status period is what the scoreboard reads, and it is present in
         most feeds. It is NOT present in soccer's, whose status carries a
         type and nothing else — so the last resort is the only inference
         that is always safe: a match the feed calls completed played at
         least its regulation periods. */
      /* WALKED, NOT CAUGHT. These three were `try{ a.b.c.d }catch(_){}` —
         four silent catches guarding nothing but a missing property, in
         the function that decides whether to open a round for a period
         nobody played. qa/silence.js counts them for a reason: a mute
         catch here would swallow a ReferenceError in AUTO and report it as
         "this game reached period 0", which reads like a quiet feed rather
         than a broken build. A `&&` chain cannot throw and cannot hide a
         real error either. */
      const status = (sum && sum.header && sum.header.competitions
                        && sum.header.competitions[0] && sum.header.competitions[0].status) || null;
      if(!playedTo && status) playedTo = Number(status.period) || 0;
      if(!playedTo && status && status.type && status.type.completed){
        playedTo = Number(AUTO.regulationPeriods(sum)) || 0;
      }

      for(const sl of slots){
        const i = sl.i;
        const rid = 'r' + i, doc = live[rid] || null, R = sl.def;
        if(!R) continue;                       // overtime with no template
        if(playedTo && Number(sl.per) > playedTo){
          if(!acted['unplayed' + i]){
            acted['unplayed' + i] = true;
            log('skip', `${R.tag} covers period ${sl.per}, and this game only reached ${playedTo} — not opening a round for innings nobody played`);
          }
          continue;
        }
        let done = false;
        try{ done = AUTO.periodDone(sum, sl.per); }catch(_){}

        /* ============ WHICH PERIOD IS THIS ROUND ABOUT ================
           ONE answer, used by both the open path and the close path. They
           used to compute it separately: close said `R.p ?? i+1` and open
           said `i + 1` flat. Identical in basketball, football, hockey and
           soccer — the sports where the Nth round IS the Nth period — and
           silently wrong in baseball, whose rounds cover innings 3, 6 and
           9. The early answers were read at innings 1, 2 and 3, stored as
           `earlyKey`, and resolveRound PREFERS a stored early answer, so
           the wrong reading won. Measured on two finished games: 5 of 12
           and 9 of 12 questions keyed wrong, with no void, no warning and
           no exception. A confident wrong answer is worse than a blank.

           R.p first, because publish.js writes it from cfg.periods and it
           is the only thing that knows an inning from a quarter; sl.per
           behind it, which is right for an appended overtime round and for
           every hand-written night. */
        const period = (R.p != null && isFinite(R.p)) ? Number(R.p) : sl.per;

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
          const early = earlyAnswers(AUTO, R, sum, period);
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
          /* ============ AND ON A PHONE THAT IS ASLEEP ==================
             The round document above reaches every screen that is AWAKE.
             This reaches the ones that are not. Founder, 28 Aug: "why do
             we not have notifications to our phone when the quarter
             ends?" — because nothing was ever sending one.

             Deliberately after the write and deliberately not awaited
             into the round's critical path: a push is a nice-to-have
             arriving beside a question the player can already see. If the
             push service is slow or down, the round still opened. */
          try{
            const r = await PUSH.send(db, NIGHT, {
              title: `\u{1F534} ${R.name} is open`,
              body: `${R.qs.length} question(s). Tap to answer.`,
              tag: 'stats-round',
              url: `https://statsgametime.com/?game=${NIGHT}`
            });
            if(r.skipped) log('alert', `no push sent — ${r.skipped}`);
            else log('alert', `pushed ${R.tag} to ${r.sent} device(s)`
                            + (r.pruned ? ` · pruned ${r.pruned} dead` : '')
                            + (r.failed ? ` · ${r.failed} failed` : ''));
          }catch(e){
            log('alert', `push threw and was ignored — ${(e && e.message) || e}`);
          }
          continue;
        }

        /* ---- CLOSE --------------------------------------------------- */
        if(doc && doc.state === 'live' && !acted['key' + i]){
          const opened = doc.openedAt && doc.openedAt.toMillis ? doc.openedAt.toMillis() : 0;
          const waited = opened ? (now - opened) : 0;
          const subs = (await db.collection(`nights/${NIGHT}/rounds/${rid}/subs`).get()).size;

          /* ============ A SEAT IS NOT A PERSON =============================
             27 Aug, founder, the moment the football ended: "The scoring
             takes too long after 4th quarter ends. We filled out our 4th
             quarter but now it takes so long waiting."

             Measured in that room. Three seats, two of them answering:

               Courtside   roundsDone 4   last seen  30m ago
               Danthefan   roundsDone 3   last seen  42m ago
               Smakk       roundsDone 0   last seen 382m ago

             Smakk joined before first pitch and left. He was counted as a
             seat for the whole night, so `subs >= seats` was never true,
             the early close never fired, and every round ran the full
             six-minute fallback. During the game that is invisible — the
             next quarter hides it. After the last one there is nothing
             left to hide it, and six minutes of dead air lands on the
             payoff, which is the worst place in the night to put it.

             So the question stops being "how many ever sat down" and
             becomes "how many are still here". A seat nobody has seen in
             PRESENT_MS is not somebody we are waiting for.

             GENEROUS ON PURPOSE, and this is the number to be careful
             with. A phone that locks stops reporting — `pagehide` is the
             same mechanism that once cost a player their fourth quarter.
             Twenty-five minutes is longer than any quarter, so somebody
             who put their phone down mid-round still counts; only a
             person hours gone is dropped. Smakk was at 382 minutes.

             FAILS TOWARDS WAITING. If no seat has a lastSeen at all — an
             older client, a room mid-migration — `present` is zero and
             the original count stands. Closing a round early on a room we
             cannot assess would take somebody's answer away, and that is
             worse than making everyone wait. */
          let waitingOn = seats;
          if(seats > 0 && subs < seats){
            let present = 0;
            try{
              const ps = await db.collection(`nights/${NIGHT}/players`).get();
              ps.forEach(p => {
                const v = p.data() || {};
                const ls = v.lastSeen && v.lastSeen.toMillis ? v.lastSeen.toMillis() : 0;
                if(ls && (now - ls) <= PRESENT_MS) present++;
              });
            }catch(e){
              /* NOT SILENT, and the ratchet was right to refuse it. If the
                 seat read fails we fall back to waiting the full window,
                 which is the safe answer — but a fallback nobody can see
                 is indistinguishable from the fix never running. */
              present = 0;
              log('room', `could not read seats to see who is still here — `
                        + `waiting the full window instead (${(e && e.message) || e})`);
            }
            if(present > 0 && present < seats){
              waitingOn = present;
              if(!acted['pres' + i]){
                acted['pres' + i] = true;
                log('room', `${R.tag} — ${seats} seat(s) but ${present} still here; `
                          + `not holding the room for ${seats - present} who left`);
              }
            }
          }

          const everyoneIn = waitingOn > 0 && subs >= waitingOn;
          if(!everyoneIn && waited < ANSWER_MS) continue;
          if(everyoneIn) log('room', `everyone still here has answered ${R.tag} — closing early`);

          const { key, why, voided } = resolveRound(AUTO, R, sum, period, doc.earlyKey);

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
        /* Every round that exists, not every round that was PUBLISHED —
           otherwise a game that went to overtime would be declared finished
           with its overtime round still open. */
        const allSlots = roundSlots(AUTO, sum, plan).filter(sl => !!sl.def);
        const allScored = allSlots.every(sl => (live['r' + sl.i] || {}).state === 'scored');
        if(allScored){
          await db.doc(`nights/${NIGHT}`).set(
            { host: { auto: true, where: 'runner', finishedAt: FieldValue.serverTimestamp() } },
            { merge: true });
          /* Force the final score out even if it matched the last one —
             the difference between "Q4 in progress" and "Final" is the
             whole reason a phone stops waiting. */
          await writeLiveScore(AUTO, db, FieldValue, sum, plan, '');
          /* One last pass. A round a human settled by hand while the runner
             was up would otherwise never be added to anyone's total, and
             the night would end with the board quietly short. */
          try{ await scoreRoom(db, FieldValue, AUTO); }
          catch(e){ log('err', 'final scoring pass failed: ' + ((e && e.message) || e)); }

          /* THEN WAIT, AND SCORE ONE MORE TIME.
             GN11, found by debriefing the archive: John Smalls finished on
             320 points and the board showed him 165. His prediction card —
             worth 600 of the night's 1,000 — settled on his PHONE at
             23:34:2x, and the pass above had already run at 23:34:14. The
             runner then archived and walked away, so nothing ever
             recomputed his total. Three other players settled before that
             pass and reconcile to the point; he was the only one who landed
             inside the window, and he lost 155 points to it permanently.

             The cause is structural, not a one-off: `pts` is a stored total
             whose inputs keep moving after it is written. predPts, catchPts
             and caughtPts settle on the device — the server cannot derive
             them — so the last server pass is a snapshot of numbers that are
             still changing. Any player whose card settles in the seconds
             after it loses the difference, on every night, silently.

             This closes the window rather than the hole. The hole is that
             the board trusts a cached total at all; deriving it from the
             lanes at render time is the real fix and is a player-app change.
             Until that lands, waiting out the settle and recomputing costs
             ninety seconds of runner time and buys back whole prediction
             cards. Idempotent, like every other pass — running it twice
             cannot double anybody. */
          const SETTLE_MS = Number(process.env.SETTLE_MS || 90000);
          log('hold', `waiting ${Math.round(SETTLE_MS/1000)}s for prediction cards to settle on the phones, then scoring once more`);
          await new Promise(r => setTimeout(r, SETTLE_MS));
          try{
            await scoreRoom(db, FieldValue, AUTO);
            log('key', 'post-settle scoring pass done — late prediction cards are now in the totals');
          }catch(e){ log('err', 'post-settle scoring pass failed: ' + ((e && e.message) || e)); }

          /* The copy that matters. Everything the room did tonight, in one
             document, written before the runner walks away — so that what
             happens to this night afterwards is somebody's choice rather
             than somebody's mistake. Archived AFTER the settle pass, so the
             archive records the totals players actually finished on. */
          try{ await archiveNight(db, FieldValue, 'final-buzzer'); }
          catch(e){ log('err', 'archive at the buzzer failed: ' + ((e && e.message) || e)); }
          if(CALLIT){
            try{ await db.doc(`nights/${NIGHT}`).set({ callit:false }, { merge:true }); }catch(_){}
          }
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
else module.exports = { resolveRound, earlyAnswers, loadShared, roundSlots, computeHustle };
