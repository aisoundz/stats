#!/usr/bin/env node
/* =====================================================================
   ACCEPTANCE — does the product still do what it promised?
   ---------------------------------------------------------------------
   The 538 checks in qa/qa.js are a REGRESSION suite. Almost every one is
   named after an incident — deck.the-bar-does-not-sit-on-the-card,
   journey.the-room-you-left-kept-your-card — because each was written the
   night something broke. That suite answers "did anything come back?"

   It cannot answer the other question: "is the thing we promised still
   true?" A promise does not need a bug to stop holding. Nobody has to
   break a line for scoring to quietly start paying somebody who was not
   watching; a resolver changes, a band moves, a default flips, and every
   regression check still passes because none of them was ever about the
   promise.

   So the checks here are named after PROMISES and derived from the
   product's own positioning, not from its incident log:

     · a sportsbook pays you for being RIGHT; this pays you for PAYING
       ATTENTION — so points cannot exist without having answered, and
       time cannot be banked on an answer that was wrong
     · submissions are the source of truth; the player document is a cache
     · round points are unforgeable; the client lanes are bounded, not
       trusted
     · free entry, no wager, ever
     · the four tabs spell the product

   TWO KINDS OF CHECK LIVE HERE, and the split is deliberate.

   The first eleven are PURE: the shared tally, and regexes over the
   shipped markup. They are fast, they need nothing, and they are the
   right shape for a promise that is arithmetic or is copy.

   The last five need A REAL NIGHT — a browser, the app's own boot, its
   own sign-in, its own listeners, against qa/fakebase.js standing in for
   Firestore. They exist because Game Night #13 produced a promise that
   CANNOT be checked any other way. The founder, after playing:

     "If you sign out you should be able to sign back in and you keep
      your points."
     "When I signed out and signed back in I was able to make all new
      picks, so I could watch the game then log out and then pick the
      right people because they already know what happened."

   Nothing in the pure half of this file can see that. AUTO.tally is
   handed submissions and players and grades them correctly; it has no
   idea WHEN the card was filled in. The promise "this pays you for
   paying attention" is not a property of the tally, it is a property of
   the door — and a door has to be opened to be tested.

   WHAT THIS STILL DOES NOT COVER, said plainly so it is not read as more
   than it is: fakebase does not run firestore.rules. A rule that would
   refuse a write in production is simply allowed here, so this file can
   prove what the APP tries to do and never what the SERVER permits.
   Where that difference matters below, it is named at the check.

       node qa/acceptance.js
       node qa/acceptance.js index-test.html
       node qa/acceptance.js --no-browser      # prints what it did not test
   ================================================================== */
const path = require('path');
const { waitReady } = require('./ready.js');
const RUN  = require(path.join(__dirname, '..', 'host', 'run.js'));
const fs   = require('fs');

let pass = 0, fail = 0, untested = 0; const bad = [], skipped = [];
function promise(name, cond, detail){
  if (cond) { pass++; }
  else { fail++; bad.push({ name, detail }); }
}
/* A promise nobody checked is not a promise anybody held. Suites in this
   repo have reported success while running nothing; this counts the gap
   out loud and the exit code takes it seriously. */
function notTested(name, why){ untested++; skipped.push({ name, why }); }
const AUTO = RUN.loadShared();

/* A night, in the shapes AUTO.tally is really handed.
   Two players: one watched, one did not. */
const ROUND = { id:'r0', worth:10, key:['Yes','Lynx','Two','No'] };
const players = {
  watcher: { predPts:150, catchPts:20, caughtPts:5 },
  absent:  { predPts:150, catchPts:20, caughtPts:5 }
};
const subs = {
  r0: {
    /* answered all four, three right, banked time on each */
    watcher: { picks:['Yes','Lynx','Two','Sky'], banks:[9,7,5,4] }
    /* `absent` submitted nothing at all */
  }
};

const t = AUTO.tally([ROUND], players, subs);

/* ---- THE CORE PROMISE ---------------------------------------------- */
promise('acceptance.points-require-having-answered',
  t.absent && t.absent.live === 0 && t.absent.rounds === 0,
  `a player who never submitted came out with ${t.absent && t.absent.live} live points`);

promise('acceptance.a-wrong-answer-pays-nothing',
  t.watcher && t.watcher.live === 3 * ROUND.worth,
  `three of four correct at worth ${ROUND.worth} should pay ${3*ROUND.worth}, paid ${t.watcher && t.watcher.live}`);

promise('acceptance.time-is-only-banked-on-a-correct-answer',
  t.watcher && t.watcher.speed === 9 + 7 + 5,
  `banked ${t.watcher && t.watcher.speed}; the 4 seconds on the WRONG answer must not count — `
  + 'otherwise a fast guess pays the same as watching');

/* A blank is not an answer. Two ways a phone produces one. */
{
  const s2 = { r0: { watcher: { picks:['Yes', null, '', undefined], banks:[9,9,9,9] } } };
  const r = AUTO.tally([ROUND], { watcher: players.watcher }, s2);
  promise('acceptance.a-blank-is-not-an-answer',
    r.watcher.live === ROUND.worth && r.watcher.speed === 9,
    `blank picks paid ${r.watcher.live} points and ${r.watcher.speed} speed — only the one real answer should count`);
}

/* ---- SUBMISSIONS ARE THE SOURCE OF TRUTH --------------------------- */
{
  /* The player document claims a fortune. It must not survive a tally. */
  const liar = { liar: { predPts:150, catchPts:20, caughtPts:5, pts:999999, live:999999, speed:999999 } };
  const r = AUTO.tally([ROUND], liar, { r0: { liar: { picks:['Yes'], banks:[3] } } });
  promise('acceptance.round-points-are-recomputed-not-accepted',
    r.liar.live === ROUND.worth && r.liar.speed === 3,
    `a player row claiming 999999 came out with ${r.liar.live}/${r.liar.speed} — round points must be `
    + 'recomputed from the submissions every time, never read off the player');
}

{
  /* A submission with no player row is a ghost. It scored on Game Night #7. */
  const r = AUTO.tally([ROUND], { watcher: players.watcher },
    { r0: { watcher:{picks:['Yes'],banks:[1]}, ghost:{picks:['Yes','Lynx','Two','No'],banks:[9,9,9,9]} } });
  promise('acceptance.a-submission-with-no-seat-scores-nothing',
    !r.ghost,
    'a submission from a uid with no player row produced a score — that is the ghost row from GN7');
}

/* ---- SCORING TWICE MUST NOT PAY TWICE ------------------------------ */
{
  const a = AUTO.tally([ROUND], players, subs);
  const b = AUTO.tally([ROUND], players, subs);
  promise('acceptance.scoring-is-idempotent',
    JSON.stringify(a) === JSON.stringify(b),
    'two runs of the tally disagreed — the runner scores at the buzzer AND again after the phones '
    + 'settle, so a tally that is not idempotent double-pays the room');
}

/* ---- THE CLIENT LANES ARE CARRIED, NOT INVENTED -------------------- */
promise('acceptance.the-phone-only-lanes-pass-through-untouched',
  t.watcher.predPts === 150 && t.watcher.catchPts === 20 && t.watcher.caughtPts === 5,
  'prediction and Caught It points settle on the device and the server cannot derive them; they '
  + 'must be carried through exactly, neither recomputed nor dropped');

/* ---- A LATER ROUND IS WORTH MORE ----------------------------------- */
{
  const q1 = { id:'r0', worth:10, key:['Yes'] };
  const q4 = { id:'r3', worth:40, key:['Yes'] };
  const s  = { r0:{ p:{picks:['Yes'],banks:[0]} }, r3:{ p:{picks:['Yes'],banks:[0]} } };
  const r  = AUTO.tally([q1,q4], { p:{} }, s);
  promise('acceptance.a-later-round-pays-more',
    r.p.live === 50,
    `the same answer in Q1 and Q4 paid ${r.p.live}; the ladder is what keeps a night alive to the end`);
}

/* ---- THE PRODUCT, AS SHIPPED --------------------------------------- */
/* WHICH BUILD ARE WE PROMISING ABOUT? This hardcoded index.html — the file
   ALREADY LIVE — while the gate around it announced it was judging
   index-test.html, the file about to be promoted. So the suite whose whole
   job is "does it still do what we said it does" was grading the wrong
   copy: you could rename the product in the promotion candidate and every
   promise stayed green. Takes a target now, like the other suites. */
const TARGET = path.resolve(process.argv.find(a => /\.html$/.test(a)) || path.join(__dirname, '..', 'index.html'));
const app = fs.readFileSync(TARGET, 'utf8');

promise('acceptance.the-four-tabs-spell-the-product',
  /Home/.test(app) && /Stats/.test(app) && /Gametime/.test(app) && /Board/.test(app),
  'the middle two tabs are the product name; renaming them is renaming the company');

{
  /* FREE ENTRY IS NOT "NO MONEY ANYWHERE". The positioning is precise: free
     entry, sponsor-funded prizes, and any subscription buys FEATURES, never
     ELIGIBILITY. So a season pass in the app is allowed — my first version
     of this check failed on exactly that and was wrong. What may never
     appear is a path that stops somebody PLAYING until they pay. */
  const gated = /if\s*\(\s*!\s*(paid|isPaid|isPro|hasPass|subscribed|seasonPass)\b/i.test(app)
             || /(requiresPass|mustSubscribe|payToPlay|upgradeToPlay)/i.test(app);
  promise('acceptance.play-is-never-gated-behind-payment',
    !gated,
    'a code path blocks play on a payment or subscription flag — a subscription may buy features, '
    + 'never eligibility, and the moment it buys entry this stops being a free game');
}

{
  /* The compliance posture is CARRIED BY COPY, and copy is the easiest
     thing in a product to quietly delete. Assert it is present rather than
     asserting the absence of betting words — the words "no wager" ARE the
     posture, so a regex hunting for "wager" finds the disclaimer and calls
     it a violation. Mine did. */
  const saysFree  = /free[^.<]{0,30}(skill|attention|entry|to play|no wager)/i.test(app);
  const saysNoWager = /no wager|not gambling|free entry/i.test(app);
  promise('acceptance.the-free-no-wager-posture-is-stated',
    saysFree && saysNoWager,
    'the copy that makes this legibly not-gambling is missing from the player app — it is a '
    + 'compliance posture, not decoration, and nothing else in the product carries it');
}

{
  /* THE LINE IS A BENCHMARK, NEVER A PICK. Showing a sportsbook line is
     allowed and useful; offering it as something to choose is the edge the
     whole positioning sits on. */
  const offersTheLine = /(take the (over|under)|bet the|pick the line|lay the points)/i.test(app);
  promise('acceptance.the-line-is-shown-never-offered',
    !offersTheLine,
    'the app offers a betting line as a choice rather than showing it as a benchmark');
}

/* =====================================================================
   THE PROMISES THAT NEED A NIGHT
   ---------------------------------------------------------------------
   Everything above can be decided from a pure function and a string. The
   five below cannot, and pretending otherwise is how qa/platforms.js was
   green for a year: it drove the app into S.place='play', a value that is
   not in GAME_SCREENS and never has been, so the test and the bug agreed
   with each other about an impossible state and neither was ever wrong.

   The defence against writing that again is that every check here asserts
   something a PLAYER can see — the screen the app landed on, the number
   on the scoreboard, the label on the button — and reaches it through the
   app's own entry points (doSignOut, startPredict, the lobby button, the
   real round listener), never by setting a flag and believing it.
   ================================================================== */
const WANT_BROWSER = !process.argv.includes('--no-browser');

/* TWO SHIMS, AND WHY NEITHER OF THEM IS A WORKAROUND.

   qa/fakebase.js is a stand-in for Google's SDK, and in two places it is
   LESS capable than the real one rather than differently capable:

     · the real GoogleAuthProvider has setCustomParameters(); the fake's
       does not, and SB.googleSignIn() calls it on line one. So every
       Google sign-in in every suite in this repo has been throwing and
       returning {ok:false} — which means no test here has ever executed a
       successful sign-in, and VERIFY_REQUIRED has never been satisfied in
       a test. That is worth reporting on its own.

     · the real linkWithPopup upgrades auth.currentUser IN PLACE (that is
       the entire point of it — index.html says so at SB.googleSignIn).
       The fake returns a user object and leaves currentUser anonymous.

   Rather than patch the fake's exports (ES module bindings are read-only
   from outside, and reaching into another suite's harness is how these
   things rot), the second gap is stepped around FAITHFULLY: the device is
   told it has held a real account before — which is true of every device
   in this report, the founder's included — so googleSignIn takes the
   signInWithPopup branch, which the fake does implement correctly. */
const AUTH_SHIM = async () => {
  const m = await import('https://fakebase.local/10.12.2/firebase-auth.js');
  if (!m.GoogleAuthProvider.prototype.setCustomParameters) {
    m.GoogleAuthProvider.prototype.setCustomParameters = function(){};
  }
};

async function browserPromises(){
  const PW   = require('playwright');
  const FAKE = require('./fakebase.js');
  const F    = require('./fixtures.js');
  const browser = await PW.chromium.launch();

  /* One page = one device. Three of the five checks below need a second
     visit to the same device, which is what a sign-out and a sign-in IS. */
  const device = async () => {
    const ctx = await browser.newContext({ viewport:{width:393,height:852} });
    const pg  = await ctx.newPage();
    const errs = []; pg.on('pageerror', e => errs.push(String(e).split('\n')[0]));
    await FAKE.install(pg, { uid:'player-1' });
    /* A device that has signed in before. See AUTH_SHIM. */
    await pg.addInitScript(() => {
      try { localStorage.setItem('stats_has_account_v1','1'); } catch(_){}
    });
    /* ============ THE NIGHT THIS SUITE PLAYS IS A HYDRATED ONE ========
       From 26 Aug joinNight() refuses to seat anybody into a BAKED night
       that has expired — see qa/stale-seat.js, written after 76 real
       visitors were filed into gn13-2026-08-19-min-gs over the week
       AFTER that game finished.

       This suite loads the app from file:// with no slate to read, so
       GAME stays BB_GAME, and BB_GAME is stale eighteen hours after its
       tip. Left alone, the join-dependent promises below stop testing
       what they claim and start testing the staleness guard.

       Clearing `__baked` is exactly what hydrateNight() does when a real
       night lands, so this models production rather than the one state
       production exists to prevent.

       IT IS AN initScript, NOT A ONE-SHOT evaluate, because freshStart()
       — the sign-out path — ends in location.reload(). A single
       post-boot evaluate is wiped by that reload and GAME comes back
       baked, which is how "a night belongs to the person, not the
       browser session" failed on a build where nothing it covers was
       broken. This runs on every navigation, including that one.

       The poll is deliberate: GAME does not exist at init time. It stops
       at the first success and gives up after 15s rather than spinning. */
    await pg.addInitScript(() => {
      try {
        var t = setInterval(function () {
          try {
            if (typeof GAME !== 'undefined' && GAME) {
              /* Un-baked is no longer enough. joinNight() now asks
                 nightHasExpired(), which is about the TIP, so a fixture
                 night whose tipISO is a week old is refused however the
                 flag reads. Give it a tip an hour ago: the game is over,
                 nobody is locked out, and nothing here is about dates. */
              delete GAME.__baked;
              /* Safe to set page-wide HERE (unlike qa.js, which has pretip
                 checks that need both a pre- and post-tip state): nothing in
                 this file reads the clock, and every join-dependent promise
                 needs a night that has not expired. */
              GAME.tipISO = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
              clearInterval(t);
            }
          } catch (_) {}
        }, 10);
        setTimeout(function () { try { clearInterval(t); } catch (_) {} }, 15000);
      } catch (_) {}
    });
    await pg.route('**/site.api.espn.com/**', r => r.fulfill({
      status:200, contentType:'application/json', body:JSON.stringify(F.LIVE) }));
    await pg.route('**/site.web.api.espn.com/**', r => r.abort());
    await pg.goto('file://' + TARGET, { waitUntil:'domcontentloaded' });
    await waitReady(pg);   /* was await pg.waitForTimeout(2500); — a guess at boot */
    await pg.evaluate(AUTH_SHIM);
    /* The one helper the page gets. __FB.docs is a plain Map, so writing
       to it does NOT wake a listener — a round has to be published the way
       the host publishes one or the app never hears it, and a check that
       poked the Map would be testing nothing. */
    await pg.evaluate(() => {
      window.__publish = function(rid, doc){
        const p = 'nights/' + GAME.nightId + '/rounds/' + rid;
        window.__FB.docs.set(p, doc); window.__FB.fire(p);
      };
    });
    return { pg, ctx, errs };
  };
  const signIn = pg => pg.evaluate(async () => {
    const r = await SB.googleSignIn();
    return { ok:!!(r&&r.ok), verified:SB.verified(), uid:SB.me && SB.me.uid };
  });

  /* ---------------------------------------------------------------
     PROMISE: "A sportsbook pays you for being RIGHT. This pays you for
     PAYING ATTENTION."

     The prediction card is 600 of the 1,000 points on a night and every
     line on it is a question about a game that has not happened. A card
     filled in during the fourth quarter is not a prediction, it is a
     transcript — it pays for having been RIGHT, with certainty, which is
     the one thing this product exists not to do.

     GN13, the founder: "I could watch the game then log out and then pick
     the right people because they already know what happened."
     --------------------------------------------------------------- */
  {
    const { pg, ctx } = await device();
    await signIn(pg);
    await pg.evaluate(async () => {
      setMode('live'); S.name='QA'; S.color='#fff';
      await joinNight();
      startPredict();
    });
    await pg.waitForTimeout(600);
    const locked = await pg.evaluate(async () => {
      preds.forEach(p => { S.predChoices[p.id] = 'BEFORE-' + p.id; });
      lockPredictions();                      // the card is locked, pre-tip
      S.qi = 2; ledgerSet('live_r0', 80, 25, 'live'); recomputeScore(); save();
      await new Promise(x => setTimeout(x, 500));
      const d = window.__FB.docs.get('nights/' + GAME.nightId + '/rounds/rP/subs/player-1');
      return d ? d.picks : null;
    });
    /* The premise, asserted rather than assumed: the card WAS submitted
       before tip. subs/{uid} is create-only in firestore.rules, so from
       this moment the server holds a fact about this night that no
       sign-out can clear — and that is what the lock should be made of. */
    promise('acceptance.the-locked-card-reaches-the-server-before-tip-off',
      Array.isArray(locked) && locked.length === 6 && locked.every(x => /^BEFORE-/.test(x)),
      `the card was locked and the server holds ${JSON.stringify(locked)} — without a submission `
      + 'there is nothing to lock the card against, and the pre-game sheet becomes unauditable');
    /* Three quarters go by. Then the player uses the app's own sign-out
       button — the rare, non-negotiable one on the account row. */
    await Promise.all([
      pg.waitForNavigation({ waitUntil:'domcontentloaded' }).catch(()=>{}),
      pg.evaluate(() => { doSignOut(); })
    ]);
    await pg.waitForTimeout(2600);
    await pg.evaluate(AUTH_SHIM);
    const back = await signIn(pg);

    /* THE PREMISE, ASSERTED. This is the qa/platforms.js trap and it is
       pointed straight at this check: startPredict() refuses to open the
       card at all unless VERIFY_REQUIRED is satisfied, so a sign-in that
       quietly failed would leave the app on the landing page and the
       exploit check would go GREEN for the exact reason the exploit is
       impossible to perform — nobody was signed in. The founder signed
       back in. So must this. */
    promise('acceptance.signing-back-in-returns-you-to-the-same-account',
      back.ok && back.verified && back.uid === 'player-1',
      `after signing out, signing back in gave ok=${back.ok} verified=${back.verified} `
      + `uid=${back.uid}. Every check below this line is meaningless without it: the card only `
      + 'opens for a verified account, so an unverified session would prove the exploit safe by '
      + 'proving nobody could play at all');

    const r = await pg.evaluate(async (was) => {
      /* fakebase's store lives on `window`, so the reload empties it the
         way a new browser session would. Firestore does not forget, and
         neither may this check: the pre-tip submission is put back so the
         app is asked the question a real server would be asked. */
      window.__FB.docs.set('nights/' + GAME.nightId + '/rounds/rP/subs/player-1',
        { name:'QA', picks:was, banks:[100,50,50,50,50,50] });
      S.name='QA'; S.color='#fff'; setMode('live');
      await joinNight();
      startPredict();                         // the app's own front door
      await new Promise(x => setTimeout(x, 900));
      return { screen:S.screen, place:S.place,
               picksOnTheCard:Object.keys(S.predChoices||{}).length };
    }, locked);
    promise('acceptance.the-pre-game-card-cannot-be-filled-in-after-tip-off',
      !(r.screen === 'predict' && r.picksOnTheCard === 0),
      `three quarters into the night, the same signed-in account was handed the prediction sheet `
      + `again (screen=${r.screen}, ${r.picksOnTheCard} picks on it). The card is 600 of the 1,000 `
      + 'points and the only thing holding it shut is S.place in localStorage — which signing out '
      + 'deletes. A lock that lives in a browser is not a lock, and this one pays for being right.');
    await ctx.close();
  }

  /* ---------------------------------------------------------------
     PROMISE: "Submissions are the source of truth; the player document
     is a cache." A cache may be rebuilt; the truth may not be lost. The
     founder states the player-facing half of it exactly: "If you sign out
     you should be able to sign back in and you keep your points."

     Two checks, because there are two different failures hiding in one
     symptom: the score not COMING BACK, and the score being DESTROYED.
     --------------------------------------------------------------- */
  {
    const { pg, ctx } = await device();
    await signIn(pg);
    await pg.evaluate(async () => {
      setMode('live'); S.name='QA'; S.color='#fff'; await joinNight();
    });
    await Promise.all([
      pg.waitForNavigation({ waitUntil:'domcontentloaded' }).catch(()=>{}),
      pg.evaluate(() => { doSignOut(); })
    ]);
    await pg.waitForTimeout(2600);
    await pg.evaluate(AUTH_SHIM);

    const r = await pg.evaluate(async () => {
      /* The night as the SERVER holds it: three rounds graded from this
         player's submissions, plus forty Caught It points they resolved on
         their phone. fakebase loses its store on a reload the way a new
         browser session would, so the seat is restored here to stand for
         a server that never forgot. */
      const nid = GAME.nightId;
      window.__FB.docs.set('nights/' + nid + '/players/player-1',
        { name:'QA', color:'#fff', pts:80, speed:25,
          predPts:0, catchPts:0, caughtPts:40, roundsDone:3 });
      const r = await SB.googleSignIn();
      S.name='QA'; S.color='#fff'; setMode('live');
      await joinNight();
      await new Promise(x => setTimeout(x, 1000));
      const onScreen = { pts:S.pts, speed:S.speed, caughtPts:S.caughtPts||0 };
      /* And now they carry on playing, which is what a person does. */
      await pushScore();
      await new Promise(x => setTimeout(x, 600));
      const seat = window.__FB.docs.get('nights/' + nid + '/players/player-1') || {};
      return { signedIn:!!(r&&r.ok), onScreen,
               seat:{ pts:seat.pts, speed:seat.speed, caughtPts:seat.caughtPts } };
    });
    /* NOT `=== 80`. S.pts is the whole night — live + pred + catch + caught —
       and the seat's `pts` is the graded live lane alone, so an equality
       here would fail on a correct app the moment the Caught It lane came
       back too. The promise is "you keep your points": nothing the server
       holds may be MISSING from the screen. */
    promise('acceptance.a-night-belongs-to-the-person-not-the-browser-session',
      r.onScreen.pts >= 80 && r.onScreen.speed >= 25,
      `the seat held 80 pts / 25 speed and the same signed-in account came back to `
      + `${r.onScreen.pts} pts / ${r.onScreen.speed} speed on screen. The server never lost them — `
      + 'SB.myScore() returns them on request — but the only caller is doResume(), which needs a '
      + 'local save, and signing out deletes it. The score is bound to a session, not to a person '
      + 'and a night, and the screen is the only place a player ever looks.');
    promise('acceptance.signing-out-never-destroys-points-already-earned',
      r.seat.caughtPts === 40,
      `40 Caught It points were on the seat before the sign-out and the seat now holds `
      + `${r.seat.caughtPts}. This is worse than a score that fails to come back: the zeroed local `
      + 'state is pushed over the real one, so signing out and back in DELETES a client lane from '
      + 'the server. predPts and catchPts are on the same push and are lost the same way.');
    await ctx.close();
  }

  /* ---------------------------------------------------------------
     PROMISE: the lobby says, in the product's own words, "The host is
     pushing questions straight to your phone and scoring them here."
     GN13: "The questions were not pushed to my laptop and my tablet at
     the end of Q1. It was sent to my iPhone."

     A round is worth points and points are the night. So the assertion is
     REACHABILITY, not takeover: a device that is signed in and joined may
     be sitting on the Board tab — a screen this app offers and invites
     people to use — and the round must still be answerable when they come
     back. Asserting "the round took over the screen" would be wrong; not
     yanking somebody off the board is deliberate and correct.
     --------------------------------------------------------------- */
  {
    const { pg, ctx } = await device();
    await signIn(pg);
    const r = await pg.evaluate(async () => {
      setMode('live'); S.name='QA'; S.color='#fff'; await joinNight();
      const Q = [{t:'Who scores first?',o:['A','B']},{t:'Lead at the buzzer?',o:['A','B']}];
      go('board');                                   // the laptop, on the Board tab
      await new Promise(x => setTimeout(x, 300));
      __publish('r0', { id:'r0', idx:0, seq:1, state:'live', tag:'Q1',
                        name:'Quarter 1', worth:10, questions:Q });
      await new Promise(x => setTimeout(x, 3400));
      const consumed = !!HR.started['r0'];
      /* They come back to the lobby, which is what the toast told them. */
      renderLobby(0); go('lobby');
      await new Promise(x => setTimeout(x, 400));
      const label = (document.getElementById('lobbyBtn')||{}).textContent || '';
      document.getElementById('lobbyBtn').click();
      await new Promise(x => setTimeout(x, 1200));
      const asked = (rounds[0].q||[]).map(q=>q.t).join(' | ');
      const shown = (document.getElementById('qText')||{}).textContent || '';
      return { consumed, label, screen:S.screen, shown, asked };
    });
    promise('acceptance.a-round-the-host-pushed-stays-answerable',
      r.screen === 'live' && !!r.shown && r.asked.indexOf(r.shown) === 0,
      `a round pushed while this device sat on the Board tab was consumed (HR.started=${r.consumed}) `
      + `and the walk back to the lobby ended on screen "${r.screen}" showing "${r.shown}". The lobby `
      + `button read "${r.label}". A round that reaches a device and cannot be answered on it is a `
      + 'round the player was never offered, and the lobby footer promises the opposite.');
    await ctx.close();
  }

  /* ---------------------------------------------------------------
     PROMISE: scoring twice must not pay twice. The suite already asserts
     this of AUTO.tally, which is the RUNNER's half. The phone has its own
     scoring path — applyHostedScore, the ledger, the save — and it has
     never been asserted at all, while the runner scores at the buzzer and
     again after the phones settle, and Firestore re-delivers a document
     on every touch.

     GN13: "it pushed the answer then it did it again after we put our
     answer." The points survived that; this is the check that says so,
     and the one that would notice the day they stop.
     --------------------------------------------------------------- */
  {
    const { pg, ctx } = await device();
    await signIn(pg);
    const r = await pg.evaluate(async () => {
      setMode('live'); S.name='QA'; S.color='#fff'; await joinNight();
      const Q = [{t:'Who scores first?',o:['A','B']},{t:'Lead at the buzzer?',o:['A','B']}];
      S.screen='lobby'; S.place='lobby';
      __publish('r0', { id:'r0', idx:0, seq:1, state:'live', tag:'Q1',
                        name:'Quarter 1', worth:10, questions:Q });
      await new Promise(x => setTimeout(x, 3400));
      S.liveAnswers[0] = [{choice:'A',bank:9},{choice:'A',bank:8}];   // both right
      S.screen='lobby'; go('lobby');
      const seen = [];
      for (let i = 0; i < 3; i++){
        __publish('r0', { id:'r0', idx:0, seq:1, state:'scored', tag:'Q1',
                          name:'Quarter 1', worth:10, key:['A','A'], touched:i,
                          questions:Q });
        await new Promise(x => setTimeout(x, 700));
        seen.push({ pts:S.pts, speed:S.speed });
      }
      return { seen };
    });
    const [a, b, c] = r.seen;
    promise('acceptance.the-same-key-posted-twice-pays-once',
      a.pts > 0 && a.pts === b.pts && b.pts === c.pts
              && a.speed === b.speed && b.speed === c.speed,
      `the host posted one key three times and the phone paid ${r.seen.map(x=>x.pts+'/'+x.speed).join(' → ')}. `
      + 'A round is scored at the buzzer and again when the phones settle, and a re-delivered '
      + 'document is normal Firestore behaviour, so paying per delivery pays for attention nobody paid.');
    await ctx.close();
  }

  await browser.close();
}

/* -------------------------------------------------------------------- */
const BROWSER_PROMISES = [
  'acceptance.the-locked-card-reaches-the-server-before-tip-off',
  'acceptance.signing-back-in-returns-you-to-the-same-account',
  'acceptance.the-pre-game-card-cannot-be-filled-in-after-tip-off',
  'acceptance.a-night-belongs-to-the-person-not-the-browser-session',
  'acceptance.signing-out-never-destroys-points-already-earned',
  'acceptance.a-round-the-host-pushed-stays-answerable',
  'acceptance.the-same-key-posted-twice-pays-once'
];

(async () => {
  if (WANT_BROWSER) {
    try { await browserPromises(); }
    catch (e) {
      /* An exploded harness is NOT a held promise. Three suites in this
         repo have reported success while running nothing. */
      BROWSER_PROMISES.forEach(n => notTested(n, 'the harness threw: ' + (e && e.message)));
    }
  } else {
    BROWSER_PROMISES.forEach(n => notTested(n, '--no-browser'));
  }

  console.log('\n  ACCEPTANCE — the promises, not the incidents\n');
  bad.forEach(b => {
    console.log(`  ✗ ${b.name}`);
    console.log(`      ${b.detail}\n`);
  });
  skipped.forEach(s => console.log(`  ? ${s.name}\n      NOT TESTED — ${s.why}\n`));
  const verdict = (fail || untested) ? 'RED' : 'GREEN';
  console.log(`  ${verdict}   ${pass} promise(s) held, ${fail} broken`
              + (untested ? `, ${untested} NOT TESTED` : '') + '\n');
  process.exit((fail || untested) ? 1 : 0);
})();
