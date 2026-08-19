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

   WHAT THIS DOES NOT COVER, said plainly so it is not read as more than
   it is: it exercises the pure scoring function and the shipped markup.
   It does not drive a live night, does not test the security rules from a
   phone (qa/journey.js and a browser do that), and cannot prove a resolver
   is CORRECT — only that scoring treats its output the way the product
   says it will.

       node qa/acceptance.js
   ================================================================== */
const path = require('path');
const RUN  = require(path.join(__dirname, '..', 'host', 'run.js'));
const fs   = require('fs');

let pass = 0, fail = 0; const bad = [];
function promise(name, cond, detail){
  if (cond) { pass++; }
  else { fail++; bad.push({ name, detail }); }
}
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

/* -------------------------------------------------------------------- */
console.log('\n  ACCEPTANCE — the promises, not the incidents\n');
bad.forEach(b => {
  console.log(`  ✗ ${b.name}`);
  console.log(`      ${b.detail}\n`);
});
console.log(`  ${fail ? 'RED' : 'GREEN'}   ${pass} promise(s) held, ${fail} broken\n`);
process.exit(fail ? 1 : 0);
