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

/* ---- 5. the loop ---------------------------------------------------- */
async function main(){
  if(!NIGHT) die('NIGHT_ID is not set');
  if(!EVENT) die('ESPN_EVENT is not set');

  const AUTO = loadShared();
  const { db, FieldValue } = loadDb();
  const plan = await readPlan(db);
  const N = plan.rounds.length;
  log('boot', `night ${NIGHT} · event ${EVENT} · ${N} rounds · running for up to ${MINUTES}m`);

  const acted = {}, seenDone = {};
  let lastScoreSig = '';
  const until = Date.now() + MINUTES * 60000;

  while(Date.now() < until){
    try{
      const sum = await AUTO.fetchFeed(EVENT);

      /* The heartbeat. A room whose host has died should be able to say so
         rather than waiting in silence for a quarter that is never coming. */
      await db.doc(`nights/${NIGHT}`).set(
        { host: { auto: true, where: 'runner', at: FieldValue.serverTimestamp() } },
        { merge: true });

      lastScoreSig = await writeLiveScore(db, FieldValue, sum, plan, lastScoreSig);

      const roundsSnap = await db.collection(`nights/${NIGHT}/rounds`).get();
      const live = {}; roundsSnap.forEach(d => { live[d.id] = d.data(); });
      const seats = (await db.collection(`nights/${NIGHT}/players`).get()).size;
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
          await db.doc(`nights/${NIGHT}/rounds/${rid}`).set({
            seq: Date.now(), idx: i, tag: R.tag, name: R.name, worth: R.worth,
            state: 'live',
            questions: R.qs.map(q => ({ t: q.t, o: q.o })),
            openedAt: FieldValue.serverTimestamp()
          }, { merge: true });
          log('push', `${R.tag} is live on every phone`);
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

          const key = [], why = [];
          let fail = null;
          for(let x = 0; x < R.qs.length; x++){
            const q = R.qs[x];
            if(q.k != null && q.k !== ''){ key.push(String(q.k)); why.push('set by hand'); continue; }
            if(!q.r){ fail = `Q${x+1} has no resolver`; break; }
            let res; try{ res = AUTO.resolve(q.r, sum, i + 1, q.o); }
            catch(e){ fail = `Q${x+1} threw: ${e.message}`; break; }
            if(!res || !res.ok){ fail = `Q${x+1} — ${(res && res.why) || 'no answer'}`; break; }
            key.push(String(res.answer)); why.push(res.answer);
          }

          if(fail){
            /* NOT a failure of the night. The round stays open, the humans
               can still settle it, and the room is told a person is needed
               rather than being left to wonder. */
            if(!acted['held' + i]){
              acted['held' + i] = true;
              await db.doc(`nights/${NIGHT}/rounds/${rid}`).set(
                { needsHuman: fail, needsHumanAt: FieldValue.serverTimestamp() }, { merge: true });
              log('hold', `${R.tag} needs a human — ${fail}`);
            }
            continue;
          }

          acted['key' + i] = true;
          await db.doc(`nights/${NIGHT}/rounds/${rid}`).set({
            seq: Date.now(), state: 'scored', key,
            needsHuman: FieldValue.delete(),
            closedAt: FieldValue.serverTimestamp()
          }, { merge: true });
          log('key', `${R.tag} scored — ${why.join(' · ')}`);
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
  log('done', 'ran out of time — the window closed');
}

main().catch(e => die((e && e.stack) || String(e)));
